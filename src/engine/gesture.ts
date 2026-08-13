import type { GestureState, HandFrame, MaskTransform, TrackingSnapshot, Vec2 } from './types';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export interface GestureUpdate {
  state: GestureState;
  transform: MaskTransform;
  hoverPoint?: Vec2;
  handSpeed: number;
  swipe: -1 | 0 | 1;
  pinchStarted: boolean;
  released: boolean;
  trailPoint?: Vec2 & { width: number };
}

export class GestureController {
  private state: GestureState = 'IDLE';
  private transform: MaskTransform;
  private pinchActive = false;
  private grabOffset: Vec2 = { x: 0, y: 0 };
  private lastSeenAt = 0;
  private lastUpdateAt = performance.now();
  private twoHandBase?: { distance: number; angle: number; center: Vec2; transform: MaskTransform };
  private lastSwipeAt = 0;

  readonly pinchOn = 0.38;
  readonly pinchOff = 0.52;
  readonly lostPredictMs = 150;
  readonly lostReleaseMs = 400;

  constructor(initial: MaskTransform) {
    this.transform = { ...initial };
  }

  setTransform(next: MaskTransform) {
    this.transform = { ...next };
  }

  getState() {
    return this.state;
  }

  update(snapshot: TrackingSnapshot, allowGrabAnywhere = false, viewportAspect = 1): GestureUpdate {
    const now = snapshot.timestamp || performance.now();
    const dt = Math.max(1, now - this.lastUpdateAt);
    this.lastUpdateAt = now;
    const hands = snapshot.hands;
    let swipe: -1 | 0 | 1 = 0;
    let pinchStarted = false;
    let released = false;
    let hoverPoint: Vec2 | undefined;
    let handSpeed = 0;
    let trailPoint: (Vec2 & { width: number }) | undefined;

    if (hands.length === 0) {
      const lostFor = now - this.lastSeenAt;
      if (lostFor <= this.lostPredictMs && this.pinchActive) {
        this.state = 'LOST';
      } else if (lostFor > this.lostReleaseMs) {
        if (this.pinchActive) released = true;
        this.pinchActive = false;
        this.twoHandBase = undefined;
        this.state = 'IDLE';
      } else {
        this.state = 'LOST';
      }
      return { state: this.state, transform: { ...this.transform }, handSpeed, swipe, pinchStarted, released };
    }

    this.lastSeenAt = now;
    const primary = hands[0];
    hoverPoint = primary.pinch;
    handSpeed = primary.speed;

    const isPinching = this.pinchActive
      ? primary.normalizedPinchDistance < this.pinchOff
      : primary.normalizedPinchDistance < this.pinchOn;

    const metric = (point: Vec2): Vec2 => ({ x: point.x * viewportAspect, y: point.y });

    if (!this.pinchActive && isPinching) {
      const nearMask = distance(metric(primary.pinch), metric(this.transform)) < Math.max(0.105, this.transform.scale * 1.55);
      if (allowGrabAnywhere || nearMask) {
        this.pinchActive = true;
        pinchStarted = true;
        this.state = 'PINCH_START';
        this.grabOffset = {
          x: this.transform.x - primary.pinch.x,
          y: this.transform.y - primary.pinch.y,
        };
      }
    }

    if (this.pinchActive && !isPinching) {
      this.pinchActive = false;
      released = true;
      this.twoHandBase = undefined;
      this.state = 'RELEASE';
    }

    if (hands.length >= 2 && this.pinchActive && hands[1].normalizedPinchDistance < this.pinchOff) {
      const a = hands[0].pinch;
      const b = hands[1].pinch;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.max(0.001, distance(metric(a), metric(b)));
      const theta = angle(metric(a), metric(b));

      if (!this.twoHandBase) {
        this.twoHandBase = { distance: d, angle: theta, center, transform: { ...this.transform } };
      }

      const base = this.twoHandBase;
      const targetScale = Math.min(0.62, Math.max(0.08, base.transform.scale * (d / base.distance)));
      const targetRotation = base.transform.rotation + (theta - base.angle);
      const targetX = base.transform.x + (center.x - base.center.x);
      const targetY = base.transform.y + (center.y - base.center.y);
      const smoothing = 1 - Math.exp(-dt / 70);
      this.transform.x = lerp(this.transform.x, targetX, smoothing);
      this.transform.y = lerp(this.transform.y, targetY, smoothing);
      this.transform.scale = lerp(this.transform.scale, targetScale, smoothing);
      this.transform.rotation = lerpAngle(this.transform.rotation, targetRotation, smoothing);
      this.state = 'TWO_HAND_TRANSFORM';
    } else if (this.pinchActive) {
      this.twoHandBase = undefined;
      const targetX = primary.pinch.x + this.grabOffset.x;
      const targetY = primary.pinch.y + this.grabOffset.y;
      const adaptive = Math.min(0.72, 0.26 + Math.min(primary.speed * 0.75, 0.46));
      this.transform.x = lerp(this.transform.x, targetX, adaptive);
      this.transform.y = lerp(this.transform.y, targetY, adaptive);
      this.state = this.state === 'PINCH_START' ? 'GRABBED' : 'DRAGGING';
      trailPoint = {
        x: primary.pinch.x,
        y: primary.pinch.y,
        width: Math.min(0.085, 0.022 + primary.speed * 0.055),
      };
    } else {
      this.state = 'HOVER';
    }

    if (!this.pinchActive && primary.speed > 0.9 && now - this.lastSwipeAt > 650) {
      const vx = primary.velocity.x;
      if (Math.abs(vx) > Math.abs(primary.velocity.y) * 1.3) {
        swipe = vx > 0 ? 1 : -1;
        this.lastSwipeAt = now;
      }
    }

    return { state: this.state, transform: { ...this.transform }, hoverPoint, handSpeed, swipe, pinchStarted, released, trailPoint };
  }
}
