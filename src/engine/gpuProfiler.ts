import { applyEffectSequence, effectSequenceRenderTime } from './effectSequence';
import { VfxRenderer } from './renderer';
import { getSceneState } from './sceneStore';
import type { EffectSettings, RenderState } from './types';

export interface GpuFrameTelemetry {
  timestamp: number;
  gpuSupported: boolean;
  gpuMs?: number;
  disjoint: boolean;
  renderFps: number;
  passCount: number;
  maskCount: number;
  renderScale: number;
}

type TimerExt = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingQuery = {
  query: WebGLQuery;
  startedAt: number;
};

let latest: GpuFrameTelemetry = {
  timestamp: 0,
  gpuSupported: false,
  disjoint: false,
  renderFps: 0,
  passCount: 0,
  maskCount: 0,
  renderScale: 1,
};

const listeners = new Set<() => void>();
const profilers = new WeakMap<VfxRenderer, FrameProfiler>();
let installed = false;

export function getGpuFrameTelemetry() {
  return latest;
}

export function subscribeGpuFrameTelemetry(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: GpuFrameTelemetry) {
  latest = next;
  listeners.forEach((listener) => listener());
}

function rendererCanvas(renderer: VfxRenderer) {
  return (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
}

function activePasses(effects: EffectSettings) {
  return effects.effectStack.filter((node) => node.enabled && node.opacity > 0 && node.intensity > 0).length;
}

function edgeEnabled(effects: EffectSettings) {
  return (effects.edgeFxMode ?? 'neon') !== 'none' && effects.glow > 0.001;
}

function countPasses(state: RenderState) {
  const sceneState = getSceneState();
  const visible = sceneState.enabled
    ? sceneState.scene.nodes.filter((node) => node.visible).slice(0, 4)
    : [];

  if (!visible.length) {
    return {
      maskCount: 1,
      passCount: 2 + activePasses(state.effects) + (edgeEnabled(state.effects) ? 1 : 0),
    };
  }

  const timeMs = effectSequenceRenderTime(state.time);
  const effective = applyEffectSequence(visible, timeMs);
  let passCount = 0;
  for (const node of effective) {
    passCount += 2 + activePasses(node.effects);
    if (edgeEnabled(node.effects)) passCount += 1;
  }
  return { maskCount: effective.length, passCount };
}

class FrameProfiler {
  private ext?: TimerExt;
  private pending: PendingQuery[] = [];
  private frameIndex = 0;
  private lastFrameAt = performance.now();
  private fpsEma = 60;
  private lastGpuMs?: number;
  private disjoint = false;

  constructor(private renderer: VfxRenderer, private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null ?? undefined;
  }

  begin(now: number) {
    this.poll(now);
    this.frameIndex += 1;
    const delta = Math.max(1, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const instantFps = Math.min(240, 1000 / delta);
    this.fpsEma += (instantFps - this.fpsEma) * 0.12;

    if (!this.ext || this.frameIndex % 5 !== 0 || this.pending.length >= 6) return undefined;
    const query = this.gl.createQuery();
    if (!query) return undefined;
    try {
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
      return query;
    } catch {
      this.gl.deleteQuery(query);
      return undefined;
    }
  }

  end(query: WebGLQuery | undefined, state: RenderState, now: number) {
    if (query && this.ext) {
      try {
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        this.pending.push({ query, startedAt: now });
      } catch {
        this.gl.deleteQuery(query);
      }
    }

    const counts = countPasses(state);
    publish({
      timestamp: now,
      gpuSupported: Boolean(this.ext),
      gpuMs: this.lastGpuMs,
      disjoint: this.disjoint,
      renderFps: Math.round(this.fpsEma),
      passCount: counts.passCount,
      maskCount: counts.maskCount,
      renderScale: this.renderer.getRenderScale(),
    });
  }

  private poll(now: number) {
    if (!this.ext || !this.pending.length) return;
    const disjoint = Boolean(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    this.disjoint = disjoint;
    const keep: PendingQuery[] = [];

    for (const item of this.pending) {
      const available = Boolean(this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE));
      if (!available && now - item.startedAt < 3000) {
        keep.push(item);
        continue;
      }
      if (available && !disjoint) {
        const nanoseconds = Number(this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT));
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
          this.lastGpuMs = nanoseconds / 1_000_000;
        }
      }
      this.gl.deleteQuery(item.query);
    }
    this.pending = keep;
  }

  dispose() {
    for (const item of this.pending) this.gl.deleteQuery(item.query);
    this.pending = [];
  }
}

export function installGpuProfilerRuntime() {
  if (installed) return;
  installed = true;

  const previousRender = VfxRenderer.prototype.render;
  const previousDispose = VfxRenderer.prototype.dispose;

  VfxRenderer.prototype.render = function renderWithGpuTelemetry(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const canvas = rendererCanvas(this);
    let profiler = profilers.get(this);
    if (!profiler && canvas) {
      const gl = canvas.getContext('webgl2');
      if (gl) {
        profiler = new FrameProfiler(this, gl);
        profilers.set(this, profiler);
      }
    }

    const now = state.time || performance.now();
    const query = profiler?.begin(now);
    try {
      return previousRender.call(this, camera, alternate, state);
    } finally {
      profiler?.end(query, state, now);
    }
  };

  VfxRenderer.prototype.dispose = function disposeWithGpuTelemetry() {
    profilers.get(this)?.dispose();
    profilers.delete(this);
    return previousDispose.call(this);
  };
}
