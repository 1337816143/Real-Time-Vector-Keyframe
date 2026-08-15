import { getSceneState } from './sceneStore';
import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

let installed = false;

export function installSceneRuntime() {
  if (installed) return;
  installed = true;

  const fallbackRender = VfxRenderer.prototype.render;
  VfxRenderer.prototype.render = function renderSceneAware(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const sceneState = getSceneState();
    if (!sceneState.enabled) return fallbackRender.call(this, camera, alternate, state);
    return this.renderScene(camera, alternate, state, sceneState.scene.nodes);
  };
}
