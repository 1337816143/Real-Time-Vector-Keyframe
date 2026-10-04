import type { TrackingSnapshot, Vec2 } from './types';

export type QuadPoints = [Vec2, Vec2, Vec2, Vec2];
export type QuadStatus = 'waiting' | 'tracking' | 'holding' | 'lost' | 'invalid';
export interface CrossHandQuadFrame {
  /** Semantic order only: Left Index, Right Index, Right Thumb, Left Thumb. */
  points?: QuadPoints;
  opacity: number;
  status: QuadStatus;
  timestamp: number;
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const finitePoint = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 8 && Math.abs(p.y) <= 8;
const crosses = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
  const ab1 = orient(a, b, c), ab2 = orient(a, b, d), cd1 = orient(c, d, a), cd2 = orient(c, d, b);
  return ab1 * ab2 <= 0 && cd1 * cd2 <= 0;
};

/** Simple convex OR concave quads are valid. Never reorder corners or take a hull. */
export function validQuad(points: readonly Vec2[], aspect = 1, minEdge = 0.006, minTwiceArea = 0.0002) {
  if (points.length !== 4 || !points.every(finitePoint) || !Number.isFinite(aspect) || aspect <= 0) return false;
  const p = points.map((point) => ({ x: point.x * aspect, y: point.y }));
  if (p.some((point, i) => Math.hypot(point.x - p[(i + 1) % 4].x, point.y - p[(i + 1) % 4].y) < minEdge)) return false;
  if (crosses(p[0], p[1], p[2], p[3]) || crosses(p[1], p[2], p[3], p[0])) return false;
  const twiceArea = p.reduce((sum, a, i) => { const b = p[(i + 1) % 4]; return sum + a.x * b.y - b.x * a.y; }, 0);
  return Math.abs(twiceArea) >= minTwiceArea;
}

/** Persistence checks topology only; visual-size thresholds depend on the live viewport. */
export function validQuadTopology(points: readonly Vec2[]) { return validQuad(points, 1, 1e-8, 1e-10); }

export function quadFromHands(snapshot: TrackingSnapshot): QuadPoints | undefined {
  const left = snapshot.hands.filter((h) => h.handedness === 'Left' && (h.handednessScore ?? 1) >= 0.55);
  const right = snapshot.hands.filter((h) => h.handedness === 'Right' && (h.handednessScore ?? 1) >= 0.55);
  if (left.length !== 1 || right.length !== 1 || left[0].id === right[0].id) return undefined;
  const points = [left[0].indexTip, right[0].indexTip, right[0].thumbTip, left[0].thumbTip];
  return points.every((point): point is Vec2 => Boolean(point) && finitePoint(point!))
    ? points.map((p) => ({ ...p! })) as QuadPoints : undefined;
}

export function cloneQuad(frame?: CrossHandQuadFrame): CrossHandQuadFrame | undefined {
  return frame ? { ...frame, points: frame.points?.map((point) => ({ ...point })) as QuadPoints | undefined } : undefined;
}

/** Input freshness is independent of render FPS; held shapes expire without new inference. */
export class CrossHandQuadController {
  private last?: CrossHandQuadFrame;
  private lastInputAt = -Infinity;
  private invalid = false;
  update(snapshot: TrackingSnapshot, aspect = 1) {
    if (snapshot.timestamp <= this.lastInputAt) return;
    this.lastInputAt = snapshot.timestamp;
    const incoming = quadFromHands(snapshot);
    this.invalid = Boolean(incoming) && !validQuad(incoming!, aspect);
    if (!incoming || this.invalid) return;
    let points = incoming;
    const old = this.last;
    if (old?.points && snapshot.timestamp - old.timestamp < 150) {
      const dt = Math.max(1, snapshot.timestamp - old.timestamp);
      const moved = Math.max(...points.map((point, i) => Math.hypot((point.x - old.points![i].x) * aspect, point.y - old.points![i].y)));
      const alpha = moved >= 0.02 ? 1 : 1 - Math.exp(-dt / 18);
      const smoothed = points.map((point, i) => ({x: old.points![i].x + (point.x-old.points![i].x)*alpha, y: old.points![i].y + (point.y-old.points![i].y)*alpha})) as QuadPoints;
      // Do not create an invalid intermediate shape while smoothing valid input.
      if (validQuad(smoothed, aspect)) points = smoothed;
    }
    this.last = { points, opacity: 1, status: 'tracking', timestamp: snapshot.timestamp };
  }
  sample(now: number): CrossHandQuadFrame {
    if (!this.last) return { opacity: 0, status: this.invalid ? 'invalid' : 'waiting', timestamp: this.lastInputAt };
    const age = Math.max(0, now - this.last.timestamp);
    const opacity = age <= 100 ? 1 : Math.max(0, 1 - (age - 100) / 150);
    const status: QuadStatus = this.invalid ? 'invalid' : age <= 60 ? 'tracking' : age <= 100 ? 'holding' : 'lost';
    return { ...cloneQuad(this.last)!, opacity, status };
  }
  reset() { this.last = undefined; this.lastInputAt = -Infinity; this.invalid = false; }
}
