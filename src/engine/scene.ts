import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import { DEFAULT_TRANSFORM, PRESETS, type BezierCurve, type EffectSettings, type MaskTransform } from './types';

export type SceneMaskGeometry =
  | { kind: 'circle' }
  | { kind: 'blob' }
  | { kind: 'portal' }
  | {
      kind: 'custom';
      curve: BezierCurve;
      feather: number;
      expansion: number;
    };

export interface SceneMaskNode {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  transform: MaskTransform;
  geometry: SceneMaskGeometry;
  effects: EffectSettings;
}

export interface MaskSceneGraph {
  version: 1;
  selectedMaskId?: string;
  nodes: SceneMaskNode[];
}

const cloneEffects = (effects: EffectSettings): EffectSettings => ({
  ...effects,
  effectStack: effects.effectStack.map((node) => ({ ...node })),
});

const cloneGeometry = (geometry: SceneMaskGeometry): SceneMaskGeometry => {
  if (geometry.kind !== 'custom') return { kind: geometry.kind };
  return {
    kind: 'custom',
    curve: cloneCurve(geometry.curve),
    feather: geometry.feather,
    expansion: geometry.expansion,
  };
};

export function cloneMaskNode(node: SceneMaskNode): SceneMaskNode {
  return {
    ...node,
    transform: { ...node.transform },
    geometry: cloneGeometry(node.geometry),
    effects: cloneEffects(node.effects),
  };
}

export function cloneScene(scene: MaskSceneGraph): MaskSceneGraph {
  return {
    version: 1,
    selectedMaskId: scene.selectedMaskId,
    nodes: scene.nodes.map(cloneMaskNode),
  };
}

function nodeId() {
  return `mask-${Date.now()}-${Math.round(Math.random() * 99999)}`;
}

export function createSceneMaskNode(
  geometry: SceneMaskGeometry = { kind: 'portal' },
  options: Partial<Omit<SceneMaskNode, 'id' | 'geometry'>> = {},
): SceneMaskNode {
  return {
    id: nodeId(),
    name: options.name ?? 'Mask',
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    transform: { ...(options.transform ?? DEFAULT_TRANSFORM) },
    geometry: cloneGeometry(geometry),
    effects: cloneEffects(options.effects ?? PRESETS.multiverse.effects),
  };
}

export function createDefaultScene(): MaskSceneGraph {
  const node = createSceneMaskNode({ kind: 'portal' }, { name: 'Portal 01' });
  return { version: 1, selectedMaskId: node.id, nodes: [node] };
}

export function createCustomSceneNode(name = 'Custom Mask'): SceneMaskNode {
  return createSceneMaskNode(
    {
      kind: 'custom',
      curve: cloneCurve(DEFAULT_BEZIER_CURVE),
      feather: 0.006,
      expansion: 0,
    },
    { name },
  );
}

export function selectSceneMask(scene: MaskSceneGraph, id?: string): MaskSceneGraph {
  if (id && !scene.nodes.some((node) => node.id === id)) return cloneScene(scene);
  return { ...cloneScene(scene), selectedMaskId: id };
}

export function addSceneMask(scene: MaskSceneGraph, node: SceneMaskNode, maxMasks = 4): MaskSceneGraph {
  const next = cloneScene(scene);
  if (next.nodes.length >= maxMasks) return next;
  const copy = cloneMaskNode(node);
  next.nodes.push(copy);
  next.selectedMaskId = copy.id;
  return next;
}

export function removeSceneMask(scene: MaskSceneGraph, id: string): MaskSceneGraph {
  const next = cloneScene(scene);
  const index = next.nodes.findIndex((node) => node.id === id);
  if (index < 0 || next.nodes.length <= 1) return next;
  next.nodes.splice(index, 1);
  if (next.selectedMaskId === id) {
    next.selectedMaskId = next.nodes[Math.min(index, next.nodes.length - 1)]?.id;
  }
  return next;
}

export function moveSceneMask(scene: MaskSceneGraph, id: string, direction: -1 | 1): MaskSceneGraph {
  const next = cloneScene(scene);
  const index = next.nodes.findIndex((node) => node.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.nodes.length) return next;
  [next.nodes[index], next.nodes[target]] = [next.nodes[target], next.nodes[index]];
  return next;
}

export function updateSceneMask(
  scene: MaskSceneGraph,
  id: string,
  update: (node: SceneMaskNode) => SceneMaskNode,
): MaskSceneGraph {
  const next = cloneScene(scene);
  next.nodes = next.nodes.map((node) => node.id === id ? cloneMaskNode(update(cloneMaskNode(node))) : node);
  return next;
}

export function selectedSceneMask(scene: MaskSceneGraph) {
  return scene.nodes.find((node) => node.id === scene.selectedMaskId);
}
