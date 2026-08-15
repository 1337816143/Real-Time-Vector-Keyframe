import { getGpuFrameTelemetry } from './gpuProfiler';
import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

type QualityState = {
  cap: number;
  pressureScore: number;
  recoveryScore: number;
  lastEvaluationAt: number;
};

const states = new WeakMap<VfxRenderer, QualityState>();
let installed = false;

function stateFor(renderer: VfxRenderer) {
  let state = states.get(renderer);
  if (!state) {
    state = { cap: 1, pressureScore: 0, recoveryScore: 0, lastEvaluationAt: 0 };
    states.set(renderer, state);
  }
  return state;
}

function lowerCap(current: number, severe: boolean) {
  if (severe) {
    if (current > 0.82) return 0.8;
    if (current > 0.68) return 0.65;
    return 0.55;
  }
  if (current > 0.9) return 0.85;
  if (current > 0.75) return 0.72;
  if (current > 0.6) return 0.6;
  return 0.55;
}

export function installAdaptiveQualityRuntime() {
  if (installed) return;
  installed = true;

  const originalRender = VfxRenderer.prototype.render;
  const originalSetRenderScale = VfxRenderer.prototype.setRenderScale;
  const originalDispose = VfxRenderer.prototype.dispose;

  VfxRenderer.prototype.setRenderScale = function cappedRenderScale(value: number) {
    const state = stateFor(this);
    return originalSetRenderScale.call(this, Math.min(value, state.cap));
  };

  VfxRenderer.prototype.render = function renderWithGpuAwareQuality(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    renderState: RenderState,
  ) {
    const result = originalRender.call(this, camera, alternate, renderState);
    const now = renderState.time || performance.now();
    const quality = stateFor(this);
    if (now - quality.lastEvaluationAt < 900) return result;
    quality.lastEvaluationAt = now;

    const telemetry = getGpuFrameTelemetry();
    const gpuValid = telemetry.gpuSupported && telemetry.gpuMs != null && !telemetry.disjoint;
    const gpuMs = gpuValid ? telemetry.gpuMs as number : undefined;
    const fps = telemetry.renderFps;
    const gpuPressure = gpuMs != null && gpuMs > 18.5;
    const gpuSevere = gpuMs != null && gpuMs > 27;
    const fpsPressure = fps > 0 && fps < 43;
    const pressure = gpuPressure || fpsPressure;

    if (pressure) {
      quality.pressureScore += gpuSevere ? 2 : 1;
      quality.recoveryScore = 0;
      if (quality.pressureScore >= 2) {
        quality.cap = lowerCap(quality.cap, gpuSevere);
        originalSetRenderScale.call(this, Math.min(this.getRenderScale(), quality.cap));
        quality.pressureScore = 0;
      }
      return result;
    }

    quality.pressureScore = Math.max(0, quality.pressureScore - 1);
    const gpuHeadroom = gpuMs == null || gpuMs < 12.5;
    const fpsHeadroom = fps >= 57;
    if (gpuHeadroom && fpsHeadroom) {
      quality.recoveryScore += 1;
      if (quality.recoveryScore >= 4 && quality.cap < 1) {
        quality.cap = Math.min(1, quality.cap + 0.05);
        quality.recoveryScore = 0;
      }
    } else {
      quality.recoveryScore = Math.max(0, quality.recoveryScore - 1);
    }

    return result;
  };

  VfxRenderer.prototype.dispose = function disposeAdaptiveQuality() {
    states.delete(this);
    return originalDispose.call(this);
  };
}
