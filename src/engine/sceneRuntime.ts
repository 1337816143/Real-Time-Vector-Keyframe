import { applyEffectSequence, effectSequenceRenderTime } from './effectSequence';
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
    const visible = sceneState.scene.nodes.some((node) => node.visible);
    if (!sceneState.enabled || !visible) return fallbackRender.call(this, camera, alternate, state);
    const timeMs = effectSequenceRenderTime(state.time);
    const nodes = applyEffectSequence(sceneState.scene.nodes, timeMs).map((node) => ({
      ...node,
      effects: {
        ...node.effects,
        glow: 0,
        effectStack: node.effects.effectStack.map((effect) => ({ ...effect })),
      },
    }));
    return this.renderScene(camera, alternate, state, nodes);
  };
}
