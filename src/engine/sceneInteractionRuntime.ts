import { getSceneState } from './sceneStore';
import { VfxRenderer } from './renderer';
import type { SceneMaskNode } from './scene';
import type { RenderState } from './types';

type SceneStateBuilder = (base: RenderState, node: SceneMaskNode) => RenderState;
type RendererPrototypeWithSceneBuilder = VfxRenderer['prototype'] & {
  stateForSceneNode?: SceneStateBuilder;
};

let installed = false;

export function installSceneInteractionRuntime() {
  if (installed) return;
  installed = true;

  const prototype = VfxRenderer.prototype as RendererPrototypeWithSceneBuilder;
  const original = prototype.stateForSceneNode;
  if (!original) return;

  prototype.stateForSceneNode = function selectedMaskReactiveState(base: RenderState, node: SceneMaskNode) {
    const state = original.call(this, base, node);
    const selectedMaskId = getSceneState().scene.selectedMaskId;
    if (node.id === selectedMaskId) return state;

    return {
      ...state,
      handSpeed: 0,
      hoverPoint: undefined,
      gestureState: 'IDLE',
    };
  };
}
