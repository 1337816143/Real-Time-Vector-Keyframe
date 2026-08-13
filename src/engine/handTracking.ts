import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandFrame, TrackingSnapshot, Vec2 } from './types';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

const avg = (...points: Vec2[]): Vec2 => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export class HandTracker {
  private landmarker?: HandLandmarker;
  private lastFrames = new Map<number, HandFrame>();
  private lastDetectAt = 0;
  private recentDetectTimes: number[] = [];
  private mirrored = true;
  private displaySize: [number, number] = [1, 1];
  private videoSize: [number, number] = [1, 1];

  setMirrored(value: boolean) {
    this.mirrored = value;
  }

  setDisplayGeometry(videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number) {
    this.videoSize = [Math.max(1, videoWidth), Math.max(1, videoHeight)];
    this.displaySize = [Math.max(1, viewWidth), Math.max(1, viewHeight)];
  }

  private mapToDisplay(point: Vec2): Vec2 {
    const sourceAspect = this.videoSize[0] / this.videoSize[1];
    const viewAspect = this.displaySize[0] / this.displaySize[1];
    let x = this.mirrored ? 1 - point.x : point.x;
    let y = point.y;
    if (sourceAspect > viewAspect) {
      const visibleFraction = viewAspect / sourceAspect;
      x = (x - 0.5) / visibleFraction + 0.5;
    } else {
      const visibleFraction = sourceAspect / viewAspect;
      y = (y - 0.5) / visibleFraction + 0.5;
    }
    return { x, y };
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = {
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      });
    }
  }

  close() {
    this.landmarker?.close();
    this.landmarker = undefined;
  }

  detect(video: HTMLVideoElement, now: number, maxFps = 26): TrackingSnapshot | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (now - this.lastDetectAt < 1000 / maxFps) return null;
    this.lastDetectAt = now;
    const result = this.landmarker.detectForVideo(video, now);
    return this.toSnapshot(result, now);
  }

  private toSnapshot(result: HandLandmarkerResult, now: number): TrackingSnapshot {
    this.recentDetectTimes.push(now);
    while (this.recentDetectTimes.length > 1 && now - this.recentDetectTimes[0] > 1000) this.recentDetectTimes.shift();
    const trackingFps = this.recentDetectTimes.length;

    const hands: HandFrame[] = result.landmarks.map((landmarks, index) => {
      const rawPt = (i: number): Vec2 => ({ x: landmarks[i].x, y: landmarks[i].y });
      const pt = (i: number): Vec2 => this.mapToDisplay(rawPt(i));
      const wrist = pt(0);
      const thumbTip = pt(4);
      const indexTip = pt(8);
      const indexMcp = pt(5);
      const middleMcp = pt(9);
      const pinkyMcp = pt(17);
      const palm = avg(wrist, indexMcp, middleMcp, pinkyMcp);
      const pinch = avg(thumbTip, indexTip);
      const rawIndexMcp = rawPt(5);
      const rawPinkyMcp = rawPt(17);
      const rawThumbTip = rawPt(4);
      const rawIndexTip = rawPt(8);
      const palmScale = Math.max(0.035, dist(rawIndexMcp, rawPinkyMcp));
      const pinchDistance = dist(rawThumbTip, rawIndexTip);
      const normalizedPinchDistance = pinchDistance / palmScale;
      const prev = this.lastFrames.get(index);
      const dt = prev ? Math.max(8, now - prev.timestamp) / 1000 : 1 / 30;
      const displayAspect = this.displaySize[0] / this.displaySize[1];
      const rawVelocity = prev
        ? { x: ((palm.x - prev.palm.x) * displayAspect) / dt, y: (palm.y - prev.palm.y) / dt }
        : { x: 0, y: 0 };
      const velocity = prev
        ? { x: prev.velocity.x * 0.58 + rawVelocity.x * 0.42, y: prev.velocity.y * 0.58 + rawVelocity.y * 0.42 }
        : rawVelocity;
      const speed = Math.hypot(velocity.x, velocity.y);
      const handedness = (result.handednesses[index]?.[0]?.categoryName as HandFrame['handedness']) ?? 'Unknown';
      const frame: HandFrame = {
        id: index,
        handedness,
        landmarks,
        palm,
        pinch,
        pinchDistance,
        normalizedPinchDistance,
        velocity,
        speed,
        timestamp: now,
      };
      this.lastFrames.set(index, frame);
      return frame;
    });

    for (const key of [...this.lastFrames.keys()]) {
      if (key >= hands.length) this.lastFrames.delete(key);
    }

    return { hands, timestamp: now, trackingFps };
  }
}
