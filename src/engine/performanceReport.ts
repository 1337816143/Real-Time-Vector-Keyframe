import { getGpuFrameTelemetry, subscribeGpuFrameTelemetry, type GpuFrameTelemetry } from './gpuProfiler';

export interface PerformanceBucket {
  maskCount: number;
  samples: number;
  fpsP50: number;
  fpsP05: number;
  gpuP50?: number;
  gpuP95?: number;
  passP50: number;
  renderScaleAverage: number;
}

export interface PerformanceReport {
  version: 1;
  generatedAt: string;
  gpuTimerSupported: boolean;
  latest: GpuFrameTelemetry;
  environment: {
    userAgent: string;
    hardwareConcurrency?: number;
    deviceMemoryGb?: number;
    screen?: { width: number; height: number; dpr: number };
  };
  buckets: PerformanceBucket[];
}

type Sample = {
  timestamp: number;
  fps: number;
  gpuMs?: number;
  passes: number;
  maskCount: number;
  scale: number;
};

const MAX_PER_BUCKET = 240;
const MIN_SAMPLE_INTERVAL_MS = 250;
const buckets = new Map<number, Sample[]>();
const listeners = new Set<() => void>();
let lastAcceptedAt = 0;
let lastNotifyAt = 0;
let revision = 0;

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const left = Math.floor(position);
  const right = Math.ceil(position);
  if (left === right) return sorted[left];
  const mix = position - left;
  return sorted[left] + (sorted[right] - sorted[left]) * mix;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function environment(): PerformanceReport['environment'] {
  if (typeof navigator === 'undefined') return { userAgent: 'unknown' };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency || undefined,
    deviceMemoryGb: nav.deviceMemory,
    screen: typeof window !== 'undefined'
      ? { width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio || 1 }
      : undefined,
  };
}

function notify(now: number) {
  revision += 1;
  if (now - lastNotifyAt < 500) return;
  lastNotifyAt = now;
  listeners.forEach((listener) => listener());
}

function acceptTelemetry() {
  const telemetry = getGpuFrameTelemetry();
  if (!telemetry.timestamp || telemetry.timestamp - lastAcceptedAt < MIN_SAMPLE_INTERVAL_MS) return;
  lastAcceptedAt = telemetry.timestamp;
  const maskCount = Math.min(4, Math.max(1, telemetry.maskCount || 1));
  const list = buckets.get(maskCount) ?? [];
  list.push({
    timestamp: telemetry.timestamp,
    fps: telemetry.renderFps,
    gpuMs: telemetry.gpuMs,
    passes: telemetry.passCount,
    maskCount,
    scale: telemetry.renderScale,
  });
  if (list.length > MAX_PER_BUCKET) list.splice(0, list.length - MAX_PER_BUCKET);
  buckets.set(maskCount, list);
  notify(telemetry.timestamp);
}

subscribeGpuFrameTelemetry(acceptTelemetry);

export function subscribePerformanceReport(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPerformanceRevision() {
  return revision;
}

export function resetPerformanceSamples() {
  buckets.clear();
  lastAcceptedAt = 0;
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function getPerformanceReport(): PerformanceReport {
  const latest = getGpuFrameTelemetry();
  const summary = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([maskCount, samples]): PerformanceBucket => {
      const fps = samples.map((sample) => sample.fps).filter(Number.isFinite);
      const gpu = samples.flatMap((sample) => Number.isFinite(sample.gpuMs) ? [sample.gpuMs as number] : []);
      const passes = samples.map((sample) => sample.passes);
      const scales = samples.map((sample) => sample.scale);
      return {
        maskCount,
        samples: samples.length,
        fpsP50: percentile(fps, 0.5),
        fpsP05: percentile(fps, 0.05),
        gpuP50: gpu.length ? percentile(gpu, 0.5) : undefined,
        gpuP95: gpu.length ? percentile(gpu, 0.95) : undefined,
        passP50: percentile(passes, 0.5),
        renderScaleAverage: average(scales),
      };
    });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    gpuTimerSupported: latest.gpuSupported,
    latest: { ...latest },
    environment: environment(),
    buckets: summary,
  };
}
