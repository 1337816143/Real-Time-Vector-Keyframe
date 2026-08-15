import { sampleClosedCurve } from './bezier';
import { getBezierMaskState } from './bezierStore';
import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

let installed = false;

export function installCustomMaskRuntime() {
  if (installed) return;
  installed = true;

  const originalRender = VfxRenderer.prototype.render;
  VfxRenderer.prototype.render = function renderWithCustomMask(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const bezier = getBezierMaskState();
    if (!bezier.enabled && state.maskType !== 'custom') {
      return originalRender.call(this, camera, alternate, state);
    }

    const customState: RenderState = {
      ...state,
      maskType: 'custom',
      customMask: sampleClosedCurve(bezier.curve, 64),
    };
    return originalRender.call(this, camera, alternate, customState);
  };
}
