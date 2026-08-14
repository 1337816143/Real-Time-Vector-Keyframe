import type { TrailReleaseMode, Vec2 } from './types';

export interface TrailInputPoint extends Vec2 {
  width: number;
}

interface TimedTrailPoint extends TrailInputPoint {
  t: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smooth(points: TimedTrailPoint[]) {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const output: TimedTrailPoint[] = [{ ...points[0] }];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    output.push({
      x: lerp(a.x, b.x, 0.25),
      y: lerp(a.y, b.y, 0.25),
      width: lerp(a.width, b.width, 0.25),
      t: lerp(a.t, b.t, 0.25),
    });
    output.push({
      x: lerp(a.x, b.x, 0.75),
      y: lerp(a.y, b.y, 0.75),
      width: lerp(a.width, b.width, 0.75),
      t: lerp(a.t, b.t, 0.75),
    });
  }
  output.push({ ...points[points.length - 1] });
  return output;
}

function resample(points: TimedTrailPoint[], maxPoints = 40) {
  if (points.length <= maxPoints) return points;
  const output: TimedTrailPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const sourceIndex = Math.round((i / Math.max(1, maxPoints - 1)) * (points.length - 1));
    output.push(points[sourceIndex]);
  }
  return output;
}

export class VectorTrail {
  private points: TimedTrailPoint[] = [];
  private releaseAt = 0;
  private releaseMode: TrailReleaseMode = 'dissipate';

  setReleaseMode(mode: TrailReleaseMode) {
    this.releaseMode = mode;
  }

  getReleaseMode() {
    return this.releaseMode;
  }

  begin() {
    this.points = [];
    this.releaseAt = 0;
  }

  add(point: TrailInputPoint, now = performance.now()) {
    this.releaseAt = 0;
    const previous = this.points[this.points.length - 1];
    if (!previous) {
      this.points.push({ ...point, t: now });
      return;
    }

    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (distance < 0.007) return;

    const segments = Math.min(4, Math.max(1, Math.ceil(distance / 0.025)));
    for (let i = 1; i <= segments; i += 1) {
      const mix = i / segments;
      this.points.push({
        x: lerp(previous.x, point.x, mix),
        y: lerp(previous.y, point.y, mix),
        width: lerp(previous.width, point.width, mix),
        t: lerp(previous.t, now, mix),
      });
    }
    if (this.points.length > 72) this.points.splice(0, this.points.length - 72);
  }

  release(now = performance.now()) {
    if (this.points.length) this.releaseAt = now;
  }

  clear() {
    this.points = [];
    this.releaseAt = 0;
  }

  getPointCount() {
    return this.points.length;
  }

  isReleased() {
    return this.releaseAt > 0;
  }

  private basePath() {
    return resample(smooth(this.points), 40);
  }

  render(now = performance.now()): TrailInputPoint[] {
    if (!this.points.length) return [];
    const base = this.basePath();
    if (!this.releaseAt || this.releaseMode === 'hold') {
      return base.map(({ x, y, width }) => ({ x, y, width }));
    }

    const elapsed = Math.max(0, now - this.releaseAt);

    if (this.releaseMode === 'dissipate') {
      const p = clamp01(elapsed / 1500);
      if (p >= 1) {
        this.clear();
        return [];
      }
      const start = Math.floor(p * base.length * 0.88);
      return base.slice(start).map(({ x, y, width }) => ({ x, y, width: width * (1 - p * 0.48) }));
    }

    if (this.releaseMode === 'close') {
      const p = clamp01(elapsed / 1050);
      if (p >= 1) {
        this.clear();
        return [];
      }
      const keep = Math.max(1, Math.round(base.length * (1 - p)));
      const middle = Math.floor(base.length / 2);
      const start = Math.max(0, middle - Math.floor(keep / 2));
      return base.slice(start, Math.min(base.length, start + keep)).map(({ x, y, width }) => ({
        x,
        y,
        width: width * (1 - p * 0.55),
      }));
    }

    if (this.releaseMode === 'expand') {
      const p = clamp01(elapsed / 1250);
      if (p >= 1) {
        this.clear();
        return [];
      }
      const widthScale = 1 + 2.1 * (1 - Math.pow(1 - p, 2));
      return base.map(({ x, y, width }) => ({ x, y, width: width * widthScale }));
    }

    if (this.releaseMode === 'burst') {
      const p = clamp01(elapsed / 720);
      if (p >= 1) {
        this.clear();
        return [];
      }
      const center = base.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
      center.x /= base.length;
      center.y /= base.length;
      const burst = Math.sin(p * Math.PI) * 0.075;
      return base.map(({ x, y, width }, index) => {
        const dx = x - center.x;
        const dy = y - center.y;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const jitter = Math.sin(index * 2.399 + 0.8) * 0.014 * Math.sin(p * Math.PI);
        return {
          x: x + (dx / length) * burst + (-dy / length) * jitter,
          y: y + (dy / length) * burst + (dx / length) * jitter,
          width: width * (1 + p * 3.4),
        };
      });
    }

    const p = clamp01(elapsed / 900);
    if (p >= 1) {
      this.clear();
      return [];
    }
    return base.map(({ x, y, width }) => ({ x, y, width: width * (1 - p) }));
  }
}
