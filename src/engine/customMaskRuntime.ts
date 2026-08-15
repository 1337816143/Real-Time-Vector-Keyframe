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

    if (bezier.enabled) {
      const customState: RenderState = {
        ...state,
        maskType: 'custom',
        customMask: sampleClosedCurve(bezier.curve, 64),
        customFeather: bezier.feather,
        customExpansion: bezier.expansion,
      };
      return originalRender.call(this, camera, alternate, customState);
    }

    if (state.maskType === 'custom') {
      return originalRender.call(this, camera, alternate, {
        ...state,
        maskType: 'portal',
        customMask: undefined,
        customFeather: undefined,
        customExpansion: undefined,
      });
    }

    return originalRender.call(this, camera, alternate, state);
  };
}
