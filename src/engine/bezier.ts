import type { BezierAnchor, BezierCurve, Vec2 } from './types';

const clamp = (value: number, min = -1.4, max = 1.4) => Math.min(max, Math.max(min, value));
const point = (x: number, y: number): Vec2 => ({ x, y });

export const DEFAULT_BEZIER_CURVE: BezierCurve = {
  version: 1,
  closed: true,
  anchors: [
    { id: 'top', point: point(0, -0.82), handleIn: point(-0.42, -0.82), handleOut: point(0.42, -0.82), linked: true },
    { id: 'right', point: point(0.88, 0), handleIn: point(0.88, -0.42), handleOut: point(0.88, 0.42), linked: true },
    { id: 'bottom', point: point(0, 0.82), handleIn: point(0.42, 0.82), handleOut: point(-0.42, 0.82), linked: true },
    { id: 'left', point: point(-0.88, 0), handleIn: point(-0.88, 0.42), handleOut: point(-0.88, -0.42), linked: true },
  ],
};

export function cloneCurve(curve: BezierCurve): BezierCurve {
  return {
    version: 1,
    closed: true,
    anchors: curve.anchors.map((anchor) => ({
      ...anchor,
      point: { ...anchor.point },
      handleIn: { ...anchor.handleIn },
      handleOut: { ...anchor.handleOut },
    })),
  };
}

function cubic(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: a.x * mt2 * mt + b.x * 3 * mt2 * t + c.x * 3 * mt * t2 + d.x * t2 * t,
    y: a.y * mt2 * mt + b.y * 3 * mt2 * t + c.y * 3 * mt * t2 + d.y * t2 * t,
  };
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentEstimate(a: BezierAnchor, b: BezierAnchor) {
  return distance(a.point, a.handleOut) + distance(a.handleOut, b.handleIn) + distance(b.handleIn, b.point);
}

export function sampleClosedCurve(curve: BezierCurve, maxPoints = 64): Vec2[] {
  const anchors = curve.anchors;
  if (anchors.length < 3) return [];
  const estimates = anchors.map((anchor, index) => segmentEstimate(anchor, anchors[(index + 1) % anchors.length]));
  const total = Math.max(0.001, estimates.reduce((sum, value) => sum + value, 0));
  const desired = Math.max(anchors.length * 4, Math.min(maxPoints, Math.round(total * 20)));
  const points: Vec2[] = [];

  anchors.forEach((anchor, index) => {
    const next = anchors[(index + 1) % anchors.length];
    const steps = Math.max(3, Math.round(desired * estimates[index] / total));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      points.push(cubic(anchor.point, anchor.handleOut, next.handleIn, next.point, t));
    }
  });

  if (points.length <= maxPoints) return points;
  const reduced: Vec2[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    reduced.push(points[Math.floor(i * points.length / maxPoints)]);
  }
  return reduced;
}

export function updateAnchor(
  curve: BezierCurve,
  id: string,
  kind: 'point' | 'handleIn' | 'handleOut',
  next: Vec2,
): BezierCurve {
  const result = cloneCurve(curve);
  const anchor = result.anchors.find((item) => item.id === id);
  if (!anchor) return result;
  const value = { x: clamp(next.x), y: clamp(next.y) };

  if (kind === 'point') {
    const dx = value.x - anchor.point.x;
    const dy = value.y - anchor.point.y;
    anchor.point = value;
    anchor.handleIn = { x: clamp(anchor.handleIn.x + dx), y: clamp(anchor.handleIn.y + dy) };
    anchor.handleOut = { x: clamp(anchor.handleOut.x + dx), y: clamp(anchor.handleOut.y + dy) };
    return result;
  }

  anchor[kind] = value;
  if (anchor.linked) {
    const opposite = kind === 'handleIn' ? 'handleOut' : 'handleIn';
    anchor[opposite] = {
      x: clamp(anchor.point.x * 2 - value.x),
      y: clamp(anchor.point.y * 2 - value.y),
    };
  }
  return result;
}

export function setAnchorLinked(curve: BezierCurve, id: string, linked: boolean): BezierCurve {
  const result = cloneCurve(curve);
  const anchor = result.anchors.find((item) => item.id === id);
  if (!anchor) return result;
  anchor.linked = linked;
  if (linked) {
    anchor.handleIn = {
      x: clamp(anchor.point.x * 2 - anchor.handleOut.x),
      y: clamp(anchor.point.y * 2 - anchor.handleOut.y),
    };
  }
  return result;
}

export function insertAnchorAfter(curve: BezierCurve, index: number): BezierCurve {
  if (curve.anchors.length >= 10) return cloneCurve(curve);
  const result = cloneCurve(curve);
  const count = result.anchors.length;
  const i = Math.max(0, Math.min(count - 1, index));
  const j = (i + 1) % count;
  const a = result.anchors[i];
  const b = result.anchors[j];

  const p0 = a.point;
  const p1 = a.handleOut;
  const p2 = b.handleIn;
  const p3 = b.point;
  const p01 = point((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const p12 = point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const p23 = point((p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
  const p012 = point((p01.x + p12.x) / 2, (p01.y + p12.y) / 2);
  const p123 = point((p12.x + p23.x) / 2, (p12.y + p23.y) / 2);
  const mid = point((p012.x + p123.x) / 2, (p012.y + p123.y) / 2);

  a.handleOut = p01;
  b.handleIn = p23;
  const inserted: BezierAnchor = {
    id: `anchor-${Date.now()}-${Math.round(Math.random() * 9999)}`,
    point: mid,
    handleIn: p012,
    handleOut: p123,
    linked: true,
  };
  result.anchors.splice(i + 1, 0, inserted);
  return result;
}

export function removeAnchor(curve: BezierCurve, id: string): BezierCurve {
  if (curve.anchors.length <= 3) return cloneCurve(curve);
  const result = cloneCurve(curve);
  result.anchors = result.anchors.filter((anchor) => anchor.id !== id);
  return result;
}
