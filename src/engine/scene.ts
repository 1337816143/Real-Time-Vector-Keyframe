import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import { DEFAULT_TRANSFORM, PRESETS, type BezierCurve, type EffectSettings, type MaskTransform, type Vec2 } from './types';

export type SceneTrailPoint = Vec2 & { width: number };

export type SceneMaskGeometry =
  | { kind: 'circle' }
  | { kind: 'blob' }
  | { kind: 'portal' }
  | { kind: 'trail'; points: SceneTrailPoint[] }
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
  if (geometry.kind === 'custom') {
    return {
      kind: 'custom',
      curve: cloneCurve(geometry.curve),
      feather: geometry.feather,
      expansion: geometry.expansion,
    };
  }
  if (geometry.kind === 'trail') {
    return {
      kind: 'trail',
      points: geometry.points.map((point) => ({ ...point })),
    };
  }
  return { kind: geometry.kind };
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

export function createTrailSceneNode(name = 'Vector Trail'): SceneMaskNode {
  return createSceneMaskNode(
    { kind: 'trail', points: [] },
    {
      name,
      effects: PRESETS.slash.effects,
      transform: { x: 0.5, y: 0.5, scale: 0.22, rotation: 0 },
    },
  );
}

export function worldTrailPointToLocal(point: SceneTrailPoint, transform: MaskTransform): SceneTrailPoint {
  const scale = Math.max(0.03, transform.scale);
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const c = Math.cos(-transform.rotation);
  const s = Math.sin(-transform.rotation);
  return {
    x: (dx * c - dy * s) / scale,
    y: (dx * s + dy * c) / scale,
    width: point.width / scale,
  };
}

export function sceneTrailPointToWorld(point: SceneTrailPoint, transform: MaskTransform): SceneTrailPoint {
  const x = point.x * transform.scale;
  const y = point.y * transform.scale;
  const c = Math.cos(transform.rotation);
  const s = Math.sin(transform.rotation);
  return {
    x: transform.x + x * c - y * s,
    y: transform.y + x * s + y * c,
    width: Math.max(0.002, point.width * transform.scale),
  };
}

export function sceneTrailToWorld(points: SceneTrailPoint[], transform: MaskTransform) {
  return points.map((point) => sceneTrailPointToWorld(point, transform));
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
