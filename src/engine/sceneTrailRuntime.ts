import { sceneTrailToWorld, type SceneMaskNode } from './scene';
import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

type SceneStateBuilder = (base: RenderState, node: SceneMaskNode) => RenderState;
type RendererWithBuilder = {
  stateForSceneNode?: SceneStateBuilder;
};

let installed = false;

export function installSceneTrailRuntime() {
  if (installed) return;
  installed = true;

  const prototype = VfxRenderer.prototype as unknown as RendererWithBuilder;
  const original = prototype.stateForSceneNode;
  if (!original) return;

  prototype.stateForSceneNode = function sceneTrailState(base: RenderState, node: SceneMaskNode) {
    const state = original.call(this, base, node);
    if (node.geometry.kind !== 'trail') return state;
    return {
      ...state,
      maskType: 'trail',
      trail: sceneTrailToWorld(node.geometry.points, node.transform).slice(-32),
      customMask: undefined,
      customFeather: undefined,
      customExpansion: undefined,
    };
  };
}
