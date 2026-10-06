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
  private rawPalms = new Map<number, Vec2>();
  private nextHandId = 0;
  private labelVotes = new Map<number, number>();
  private lastDetectAt = 0;
  private lastVideoTime = -1;
  private coordinateEpoch = 0;
  private handCoordinateEpoch = new Map<number, number>();
  private recentDetectTimes: number[] = [];
  private mirrored = true;
  private displaySize: [number, number] = [1, 1];
  private videoSize: [number, number] = [1, 1];

  setMirrored(value: boolean) {
    if (this.mirrored !== value) this.coordinateEpoch += 1;
    this.mirrored = value;
  }

  setDisplayGeometry(videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number) {
    if (this.videoSize[0] !== videoWidth || this.videoSize[1] !== videoHeight ||
        this.displaySize[0] !== viewWidth || this.displaySize[1] !== viewHeight) this.coordinateEpoch += 1;
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

  reset() {
    this.lastDetectAt = 0;
    this.lastVideoTime = -1;
    this.recentDetectTimes = [];
    this.lastFrames.clear();
    this.rawPalms.clear();
    this.labelVotes.clear();
    this.handCoordinateEpoch.clear();
  }

  close() {
    this.landmarker?.close();
    this.landmarker = undefined;
    this.reset();
  }

  detect(video: HTMLVideoElement, now: number, maxFps = 26): TrackingSnapshot | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (now - this.lastDetectAt < 1000 / maxFps || video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    this.lastDetectAt = now;
    const result = this.landmarker.detectForVideo(video, now);
    return this.toSnapshot(result, now);
  }

  private toSnapshot(result: HandLandmarkerResult, now: number): TrackingSnapshot {
    this.recentDetectTimes.push(now);
    while (this.recentDetectTimes.length > 1 && now - this.recentDetectTimes[0] > 1000) this.recentDetectTimes.shift();
    const trackingFps = this.recentDetectTimes.length;

    // Detector array order is not a persistent identity. Solve the tiny (<=2)
    // global assignment against recent raw-image palms before computing velocity.
    const palms = result.landmarks.map((landmarks) => avg(...[0, 5, 9, 17].map((i) => landmarks[i])));
    const prior = [...this.lastFrames.values()].filter((hand) => now - hand.timestamp <= 350);
    const aspect = this.videoSize[0] / this.videoSize[1];
    const cost = (index: number, hand: HandFrame) => {
      const old = this.rawPalms.get(hand.id)!;
      const movement = Math.hypot((palms[index].x - old.x) * aspect, palms[index].y - old.y);
      const label = result.handednesses[index]?.[0];
      const mismatch = label && label.score >= 0.75 && (hand.handednessScore ?? 0) >= 0.75 &&
        hand.handedness !== 'Unknown' && label.categoryName !== hand.handedness;
      // Reliable anatomical labels are identity constraints, not an optional cost.
      // On a confident classification conflict, wait/reacquire instead of swapping IDs.
      return movement > 0.65 || mismatch ? Infinity : movement;
    };
    let bestCost = Infinity;
    let assignment: (HandFrame | undefined)[] = [];
    const choose = (index: number, used: Set<number>, selected: (HandFrame | undefined)[], total: number) => {
      if (index === palms.length) {
        if (total < bestCost) { bestCost = total; assignment = [...selected]; }
        return;
      }
      choose(index + 1, used, [...selected, undefined], total + 0.7);
      for (const hand of prior) {
        if (used.has(hand.id)) continue;
        const nextCost = cost(index, hand);
        if (!Number.isFinite(nextCost)) continue;
        choose(index + 1, new Set([...used, hand.id]), [...selected, hand], total + nextCost);
      }
    };
    choose(0, new Set(), [], 0);

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
      // Image coordinates are normalized independently by width and height.
      // Distances must be measured in one isotropic metric (image-height units).
      const metric = (point: Vec2) => ({ x: point.x * aspect, y: point.y });
      const palmScale = Math.max(0.035, dist(metric(rawIndexMcp), metric(rawPinkyMcp)));
      const pinchDistance = dist(metric(rawThumbTip), metric(rawIndexTip));
      const normalizedPinchDistance = pinchDistance / palmScale;
      const prev = assignment[index];
      const id = prev?.id ?? this.nextHandId++;
      // A missing hand can retain identity across empty/other-hand frames, but
      // its display-space velocity baseline belongs to its own coordinate epoch.
      const recent = prev && this.handCoordinateEpoch.get(id) === this.coordinateEpoch && now - prev.timestamp <= 150 ? prev : undefined;
      const dt = recent ? Math.max(8, now - recent.timestamp) / 1000 : 1 / 30;
      const displayAspect = this.displaySize[0] / this.displaySize[1];
      const rawVelocity = recent
        ? { x: ((palm.x - recent.palm.x) * displayAspect) / dt, y: (palm.y - recent.palm.y) / dt }
        : { x: 0, y: 0 };
      const velocity = recent
        ? { x: recent.velocity.x * 0.58 + rawVelocity.x * 0.42, y: recent.velocity.y * 0.58 + rawVelocity.y * 0.42 }
        : rawVelocity;
      const speed = Math.hypot(velocity.x, velocity.y);
      const category = result.handednesses[index]?.[0];
      const confidence = category?.score ?? 0;
      const vote = category?.categoryName === 'Left' ? confidence : category?.categoryName === 'Right' ? -confidence : 0;
      const oldVote = this.labelVotes.get(id);
      const stableVote = oldVote == null ? vote : oldVote * 0.8 + vote * 0.2;
      this.labelVotes.set(id, stableVote);
      const handedness: HandFrame['handedness'] = Math.abs(stableVote) < 0.35 ? 'Unknown' : stableVote > 0 ? 'Left' : 'Right';
      const frame: HandFrame = {
        id,
        handedness,
        landmarks,
        handednessScore: Math.abs(stableVote),
        indexTip,
        thumbTip,
        palm,
        pinch,
        pinchDistance,
        normalizedPinchDistance,
        velocity,
        speed,
        timestamp: now,
      };
      this.lastFrames.set(id, frame);
      this.handCoordinateEpoch.set(id, this.coordinateEpoch);
      this.rawPalms.set(id, palms[index]);
      return frame;
    });

    for (const [id, frame] of this.lastFrames) {
      if (now - frame.timestamp > 350) {
        this.lastFrames.delete(id); this.rawPalms.delete(id); this.labelVotes.delete(id);
        this.handCoordinateEpoch.delete(id);
      }
    }
    hands.sort((a, b) => a.id - b.id);

    return { hands, timestamp: now, trackingFps };
  }
}
