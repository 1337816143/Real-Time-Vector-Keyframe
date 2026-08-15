import { sceneMotionRecorder } from './sceneMotion';
import { getSceneState } from './sceneStore';
import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

let installed = false;

export function installSceneMotionRuntime() {
  if (installed) return;
  installed = true;

  const previousRender = VfxRenderer.prototype.render;
  VfxRenderer.prototype.render = function renderWithSceneMotion(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const sceneState = getSceneState();
    let renderState = state;

    if (sceneState.enabled) {
      if (sceneMotionRecorder.isRecording()) {
        sceneMotionRecorder.capture(sceneState.scene, state.time);
      }

      if (sceneMotionRecorder.isPlaying()) {
        const sampled = sceneMotionRecorder.sample(state.time);
        if (sampled) sceneState.scene = sampled;
        renderState = {
          ...state,
          handSpeed: 0,
          hoverPoint: undefined,
          gestureState: 'IDLE',
        };
      }
    }

    return previousRender.call(this, camera, alternate, renderState);
  };
}
