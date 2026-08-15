import { cloneCurve } from './bezier';
import { cloneScene, createCustomSceneNode, createDefaultScene, createSceneMaskNode, type MaskSceneGraph, type SceneMaskGeometry, type SceneMaskNode } from './scene';
import { PRESETS, type BezierCurve, type EffectSettings, type MaskTransform, type PresetId } from './types';

export interface RealtimeSceneState {
  enabled: boolean;
  scene: MaskSceneGraph;
}

let state: RealtimeSceneState = {
  enabled: false,
  scene: createDefaultScene(),
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getSceneState(): RealtimeSceneState {
  return state;
}

export function subscribeScene(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSceneEnabled(enabled: boolean) {
  if (state.enabled === enabled) return;
  state = { ...state, enabled };
  emit();
}

export function replaceScene(scene: MaskSceneGraph, enabled = state.enabled) {
  state = { enabled, scene: cloneScene(scene) };
  emit();
}

export function selectMask(id: string) {
  if (!state.scene.nodes.some((node) => node.id === id) || state.scene.selectedMaskId === id) return;
  state = { ...state, scene: { ...state.scene, selectedMaskId: id } };
  emit();
}

export function addMask(kind: SceneMaskGeometry['kind']) {
  if (state.scene.nodes.length >= 4) return;
  const geometry: SceneMaskGeometry = kind === 'custom'
    ? createCustomSceneNode().geometry
    : { kind } as SceneMaskGeometry;
  const node = createSceneMaskNode(geometry, {
    name: `${kind[0].toUpperCase()}${kind.slice(1)} ${String(state.scene.nodes.length + 1).padStart(2, '0')}`,
    effects: PRESETS.multiverse.effects,
  });
  state = {
    ...state,
    scene: {
      ...state.scene,
      selectedMaskId: node.id,
      nodes: [...state.scene.nodes.map((item) => ({ ...item })), node],
    },
  };
  emit();
}

export function removeMask(id: string) {
  if (state.scene.nodes.length <= 1) return;
  const index = state.scene.nodes.findIndex((node) => node.id === id);
  if (index < 0) return;
  const nodes = state.scene.nodes.filter((node) => node.id !== id);
  const selectedMaskId = state.scene.selectedMaskId === id
    ? nodes[Math.min(index, nodes.length - 1)]?.id
    : state.scene.selectedMaskId;
  state = { ...state, scene: { ...state.scene, nodes, selectedMaskId } };
  emit();
}

export function moveMask(id: string, direction: -1 | 1) {
  const nodes = state.scene.nodes.slice();
  const index = nodes.findIndex((node) => node.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= nodes.length) return;
  [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
  state = { ...state, scene: { ...state.scene, nodes } };
  emit();
}

export function updateMask(id: string, patch: Partial<Pick<SceneMaskNode, 'name' | 'visible' | 'locked'>>) {
  state = {
    ...state,
    scene: {
      ...state.scene,
      nodes: state.scene.nodes.map((node) => node.id === id ? { ...node, ...patch } : node),
    },
  };
  emit();
}

export function setMaskEffectPreset(id: string, preset: PresetId) {
  const source = PRESETS[preset];
  setMaskEffects(id, source.effects);
}

export function setMaskEffects(id: string, effects: EffectSettings) {
  state = {
    ...state,
    scene: {
      ...state.scene,
      nodes: state.scene.nodes.map((node) => node.id === id ? {
        ...node,
        effects: {
          ...effects,
          effectStack: effects.effectStack.map((effect) => ({ ...effect })),
        },
      } : node),
    },
  };
  emit();
}

export function setCustomMaskGeometry(
  id: string,
  patch: Partial<{ curve: BezierCurve; feather: number; expansion: number }>,
) {
  state = {
    ...state,
    scene: {
      ...state.scene,
      nodes: state.scene.nodes.map((node) => {
        if (node.id !== id || node.geometry.kind !== 'custom') return node;
        return {
          ...node,
          geometry: {
            kind: 'custom',
            curve: patch.curve ? cloneCurve(patch.curve) : node.geometry.curve,
            feather: Math.min(0.08, Math.max(0, patch.feather ?? node.geometry.feather)),
            expansion: Math.min(0.45, Math.max(-0.45, patch.expansion ?? node.geometry.expansion)),
          },
        };
      }),
    },
  };
  emit();
}

export function setMaskEffectsSilently(id: string, effects: EffectSettings) {
  const node = state.scene.nodes.find((item) => item.id === id);
  if (!node) return;
  node.effects = {
    ...effects,
    effectStack: effects.effectStack.map((effect) => ({ ...effect })),
  };
}

export function setMaskTransformSilently(id: string, transform: MaskTransform) {
  const node = state.scene.nodes.find((item) => item.id === id);
  if (!node) return;
  node.transform = { ...transform };
}

export function selectedMask() {
  return state.scene.nodes.find((node) => node.id === state.scene.selectedMaskId);
}
