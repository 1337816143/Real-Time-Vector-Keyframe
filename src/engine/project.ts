import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import { getBezierMaskState, setBezierMaskState } from './bezierStore';
import { cloneScene, createDefaultScene, type MaskSceneGraph, type SceneMaskGeometry, type SceneMaskNode } from './scene';
import { sceneMotionRecorder, type SceneMotionEasing, type SceneMotionTrack } from './sceneMotion';
import { getSceneState, replaceScene } from './sceneStore';
import {
  PRESETS,
  type BezierCurve,
  type EffectBlendMode,
  type EffectNodeType,
  type EffectSettings,
  type EffectTransitionType,
  type GestureState,
  type MaskTransform,
  type MaskType,
  type MotionTrack,
  type PresetId,
  type TemporalMode,
  type TrailReleaseMode,
  type Vec2,
} from './types';

export interface ProjectSnapshot {
  version: 1;
  savedAt: string;
  preset: PresetId;
  mask: {
    type: MaskType;
    transform: MaskTransform;
    trailReleaseMode: TrailReleaseMode;
    customCurve: BezierCurve;
    customFeather: number;
    customExpansion: number;
  };
  effects: EffectSettings;
  carousel: {
    enabled: boolean;
    intervalMs: number;
    transitionType: EffectTransitionType;
    transitionDurationMs: number;
  };
  scene?: {
    enabled: boolean;
    graph: MaskSceneGraph;
  };
  motion?: MotionTrack;
  sceneMotion?: SceneMotionTrack;
}

type ProjectSnapshotInput = Omit<ProjectSnapshot, 'version' | 'savedAt' | 'mask' | 'scene' | 'sceneMotion'> & {
  mask: Omit<ProjectSnapshot['mask'], 'customCurve' | 'customFeather' | 'customExpansion'> & {
    customCurve?: BezierCurve;
    customFeather?: number;
    customExpansion?: number;
  };
  scene?: ProjectSnapshot['scene'];
  sceneMotion?: SceneMotionTrack;
};

const MASK_TYPES: MaskType[] = ['circle', 'blob', 'portal', 'trail', 'custom'];
const TRAIL_MODES: TrailReleaseMode[] = ['hold', 'dissipate', 'close', 'expand', 'burst', 'shrink'];
const TEMPORAL_MODES: TemporalMode[] = ['none', 'timeWindow', 'echo', 'afterImage'];
const TRANSITIONS: EffectTransitionType[] = ['crossFade', 'directionalWipe', 'glitch', 'flash', 'liquid'];
const EFFECT_TYPES: EffectNodeType[] = ['rgbSplit', 'ripple', 'pixelate', 'distortion'];
const BLEND_MODES: EffectBlendMode[] = ['normal', 'add', 'screen', 'multiply'];
const GESTURE_STATES: GestureState[] = ['IDLE', 'HOVER', 'PINCH_START', 'GRABBED', 'DRAGGING', 'TWO_HAND_TRANSFORM', 'RELEASE', 'LOST'];
const SCENE_GEOMETRY = ['circle', 'blob', 'portal', 'custom'] as const;
const SCENE_EASINGS: SceneMotionEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
};

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const bool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function sanitizePoint(value: unknown, fallback: Vec2): Vec2 {
  try {
    const item = object(value);
    return {
      x: clamp(finite(item.x, fallback.x), -1.4, 1.4),
      y: clamp(finite(item.y, fallback.y), -1.4, 1.4),
    };
  } catch {
    return { ...fallback };
  }
}

function sanitizeCurve(value: unknown): BezierCurve {
  if (!value) return cloneCurve(DEFAULT_BEZIER_CURVE);
  try {
    const item = object(value);
    const raw = Array.isArray(item.anchors) ? item.anchors : [];
    const anchors = raw.slice(0, 10).flatMap((entry, index) => {
      try {
        const anchor = object(entry);
        const fallback = DEFAULT_BEZIER_CURVE.anchors[index % DEFAULT_BEZIER_CURVE.anchors.length];
        return [{
          id: typeof anchor.id === 'string' && anchor.id ? anchor.id : `anchor-${index}`,
          point: sanitizePoint(anchor.point, fallback.point),
          handleIn: sanitizePoint(anchor.handleIn, fallback.handleIn),
          handleOut: sanitizePoint(anchor.handleOut, fallback.handleOut),
          linked: bool(anchor.linked, true),
        }];
      } catch {
        return [];
      }
    });
    if (anchors.length < 3) return cloneCurve(DEFAULT_BEZIER_CURVE);
    return { version: 1, closed: true, anchors };
  } catch {
    return cloneCurve(DEFAULT_BEZIER_CURVE);
  }
}

function sanitizeTransform(value: unknown): MaskTransform {
  const item = object(value);
  return {
    x: clamp(finite(item.x, 0.5), -0.5, 1.5),
    y: clamp(finite(item.y, 0.5), -0.5, 1.5),
    scale: clamp(finite(item.scale, 0.22), 0.03, 1),
    rotation: finite(item.rotation, 0),
  };
}

function sanitizeEffects(value: unknown): EffectSettings {
  const item = object(value);
  const rawStack = Array.isArray(item.effectStack) ? item.effectStack : [];
  const seen = new Set<EffectNodeType>();
  const effectStack = rawStack.flatMap((raw, index) => {
    try {
      const node = object(raw);
      const type = enumValue(node.type, EFFECT_TYPES, 'ripple');
      if (seen.has(type)) return [];
      seen.add(type);
      return [{
        id: typeof node.id === 'string' && node.id ? node.id : `fx-${type}-${index}`,
        type,
        enabled: bool(node.enabled, true),
        intensity: clamp(finite(node.intensity, 1), 0, 3),
        opacity: clamp(finite(node.opacity, 1), 0, 1),
        blendMode: enumValue(node.blendMode, BLEND_MODES, 'normal'),
      }];
    } catch {
      return [];
    }
  });
  for (const type of EFFECT_TYPES) {
    if (!seen.has(type)) effectStack.push({ id: `fx-${type}`, type, enabled: false, intensity: 1, opacity: 1, blendMode: 'normal' });
  }

  return {
    rgbSplit: clamp(finite(item.rgbSplit, 0), 0, 0.2),
    ripple: clamp(finite(item.ripple, 0), 0, 0.2),
    pixelate: clamp(finite(item.pixelate, 0), 0, 240),
    distortion: clamp(finite(item.distortion, 0), 0, 0.2),
    glow: clamp(finite(item.glow, 0.8), 0, 3),
    invertMask: bool(item.invertMask),
    useAlternateMedia: bool(item.useAlternateMedia),
    temporalMode: enumValue(item.temporalMode, TEMPORAL_MODES, 'none'),
    temporalDelayMs: clamp(finite(item.temporalDelayMs, 900), 0, 2500),
    temporalMix: clamp(finite(item.temporalMix, 1), 0, 1),
    effectStack,
  };
}

function sanitizeMotion(value: unknown): MotionTrack | undefined {
  if (!value) return undefined;
  const item = object(value);
  const rawFrames = Array.isArray(item.keyframes) ? item.keyframes : [];
  const keyframes = rawFrames.flatMap((raw) => {
    try {
      const frame = object(raw);
      const interaction = frame.interactionPoint ? object(frame.interactionPoint) : undefined;
      return [{
        t: Math.max(0, finite(frame.t, 0)),
        maskType: enumValue(frame.maskType, MASK_TYPES, 'portal'),
        transform: sanitizeTransform(frame.transform),
        effects: sanitizeEffects(frame.effects),
        gestureState: enumValue(frame.gestureState, GESTURE_STATES, 'IDLE'),
        handSpeed: Math.max(0, finite(frame.handSpeed, 0)),
        interactionPoint: interaction ? {
          x: clamp(finite(interaction.x, 0.5), -0.5, 1.5),
          y: clamp(finite(interaction.y, 0.5), -0.5, 1.5),
        } : undefined,
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => a.t - b.t);
  if (keyframes.length < 2) return undefined;
  const duration = Math.max(finite(item.duration, keyframes[keyframes.length - 1].t), keyframes[keyframes.length - 1].t);
  return { version: 1, duration, keyframes };
}

function sanitizeSceneGeometry(value: unknown): SceneMaskGeometry {
  try {
    const item = object(value);
    const kind = enumValue(item.kind, SCENE_GEOMETRY, 'portal');
    if (kind !== 'custom') return { kind };
    return {
      kind: 'custom',
      curve: sanitizeCurve(item.curve),
      feather: clamp(finite(item.feather, 0.006), 0, 0.08),
      expansion: clamp(finite(item.expansion, 0), -0.45, 0.45),
    };
  } catch {
    return { kind: 'portal' };
  }
}

function sanitizeSceneNode(value: unknown, index: number, forcedId?: string): SceneMaskNode | undefined {
  try {
    const item = object(value);
    const id = forcedId ?? (typeof item.id === 'string' && item.id ? item.id : `mask-import-${index}`);
    return {
      id,
      name: typeof item.name === 'string' && item.name ? item.name.slice(0, 80) : `Mask ${index + 1}`,
      visible: bool(item.visible, true),
      locked: bool(item.locked, false),
      transform: sanitizeTransform(item.transform),
      geometry: sanitizeSceneGeometry(item.geometry),
      effects: sanitizeEffects(item.effects),
    };
  } catch {
    return undefined;
  }
}

function sanitizeSceneGraph(value: unknown): MaskSceneGraph | undefined {
  try {
    const graphRaw = object(value);
    const rawNodes = Array.isArray(graphRaw.nodes) ? graphRaw.nodes : [];
    const nodes = rawNodes.slice(0, 4).flatMap((raw, index): SceneMaskNode[] => {
      const node = sanitizeSceneNode(raw, index);
      return node ? [node] : [];
    });
    if (!nodes.length) return undefined;
    if (!nodes.some((node) => node.visible)) nodes[0].visible = true;
    const selectedCandidate = typeof graphRaw.selectedMaskId === 'string' ? graphRaw.selectedMaskId : undefined;
    const selectedMaskId = nodes.some((node) => node.id === selectedCandidate) ? selectedCandidate : nodes[0].id;
    return { version: 1, selectedMaskId, nodes };
  } catch {
    return undefined;
  }
}

function sanitizeScene(value: unknown): { enabled: boolean; graph: MaskSceneGraph } | undefined {
  if (!value) return undefined;
  try {
    const container = object(value);
    const graph = sanitizeSceneGraph(container.graph);
    if (!graph) return undefined;
    return { enabled: bool(container.enabled, false), graph };
  } catch {
    return undefined;
  }
}

function sanitizeSceneMotion(value: unknown): SceneMotionTrack | undefined {
  if (!value) return undefined;
  try {
    const item = object(value);
    const template = sanitizeSceneGraph(item.template);
    if (!template) return undefined;
    const templateIds = new Set(template.nodes.map((node) => node.id));
    const rawLanes = Array.isArray(item.lanes) ? item.lanes : [];
    const lanes = rawLanes.slice(0, 4).flatMap((rawLane, laneIndex) => {
      try {
        const lane = object(rawLane);
        const maskId = typeof lane.maskId === 'string' ? lane.maskId : '';
        if (!maskId || !templateIds.has(maskId)) return [];
        const rawFrames = Array.isArray(lane.keyframes) ? lane.keyframes : [];
        const keyframes = rawFrames.slice(0, 2400).flatMap((rawFrame, frameIndex) => {
          try {
            const frame = object(rawFrame);
            const node = sanitizeSceneNode(frame.node, frameIndex, maskId);
            if (!node) return [];
            return [{
              t: Math.max(0, finite(frame.t, 0)),
              node,
              easing: enumValue(frame.easing, SCENE_EASINGS, 'linear'),
            }];
          } catch {
            return [];
          }
        }).sort((a, b) => a.t - b.t);
        if (keyframes.length < 2) return [];
        return [{
          maskId,
          name: typeof lane.name === 'string' && lane.name ? lane.name.slice(0, 80) : `Lane ${laneIndex + 1}`,
          keyframes,
        }];
      } catch {
        return [];
      }
    });
    if (!lanes.length) return undefined;
    const lastTime = Math.max(...lanes.map((lane) => lane.keyframes[lane.keyframes.length - 1]?.t ?? 0));
    const duration = Math.max(1, finite(item.duration, lastTime), lastTime);
    return { version: 1, duration, template, lanes };
  } catch {
    return undefined;
  }
}

export function createProjectSnapshot(input: ProjectSnapshotInput): ProjectSnapshot {
  const bezierState = getBezierMaskState();
  const sceneState = getSceneState();
  const customCurve = input.mask.customCurve ?? bezierState.curve;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    ...input,
    mask: {
      ...input.mask,
      type: bezierState.enabled ? 'custom' : input.mask.type,
      transform: { ...input.mask.transform },
      customCurve: cloneCurve(customCurve),
      customFeather: clamp(input.mask.customFeather ?? bezierState.feather, 0, 0.08),
      customExpansion: clamp(input.mask.customExpansion ?? bezierState.expansion, -0.45, 0.45),
    },
    effects: {
      ...input.effects,
      effectStack: input.effects.effectStack.map((node) => ({ ...node })),
    },
    scene: input.scene ?? {
      enabled: sceneState.enabled,
      graph: cloneScene(sceneState.scene),
    },
    motion: input.motion ? {
      version: 1,
      duration: input.motion.duration,
      keyframes: input.motion.keyframes.map((frame) => ({
        ...frame,
        transform: { ...frame.transform },
        effects: {
          ...frame.effects,
          effectStack: frame.effects.effectStack.map((node) => ({ ...node })),
        },
        interactionPoint: frame.interactionPoint ? { ...frame.interactionPoint } : undefined,
      })),
    } : undefined,
    sceneMotion: input.sceneMotion ?? sceneMotionRecorder.getTrack(),
  };
}

export function stringifyProject(project: ProjectSnapshot) {
  return JSON.stringify(project, null, 2);
}

export function parseProject(text: string): ProjectSnapshot {
  const root = object(JSON.parse(text));
  if (root.version !== 1) throw new Error('Unsupported project version');
  const mask = object(root.mask);
  const carousel = object(root.carousel ?? {});
  const presetFallback = 'multiverse' as PresetId;
  const preset = typeof root.preset === 'string' && root.preset in PRESETS ? root.preset as PresetId : presetFallback;
  const maskType = enumValue(mask.type, MASK_TYPES, PRESETS[preset].mask);
  const customCurve = sanitizeCurve(mask.customCurve);
  const customFeather = clamp(finite(mask.customFeather, 0.006), 0, 0.08);
  const customExpansion = clamp(finite(mask.customExpansion, 0), -0.45, 0.45);
  setBezierMaskState({
    curve: customCurve,
    enabled: maskType === 'custom',
    feather: customFeather,
    expansion: customExpansion,
  });

  const scene = sanitizeScene(root.scene);
  if (scene) replaceScene(scene.graph, scene.enabled);
  else replaceScene(createDefaultScene(), false);

  const sceneMotion = sanitizeSceneMotion(root.sceneMotion);
  sceneMotionRecorder.loadTrack(sceneMotion);

  return {
    version: 1,
    savedAt: typeof root.savedAt === 'string' ? root.savedAt : new Date().toISOString(),
    preset,
    mask: {
      type: maskType,
      transform: sanitizeTransform(mask.transform),
      trailReleaseMode: enumValue(mask.trailReleaseMode, TRAIL_MODES, 'dissipate'),
      customCurve,
      customFeather,
      customExpansion,
    },
    effects: sanitizeEffects(root.effects),
    carousel: {
      enabled: bool(carousel.enabled),
      intervalMs: clamp(finite(carousel.intervalMs, 3500), 1200, 30000),
      transitionType: enumValue(carousel.transitionType, TRANSITIONS, 'crossFade'),
      transitionDurationMs: clamp(finite(carousel.transitionDurationMs, 650), 80, 5000),
    },
    scene,
    motion: sanitizeMotion(root.motion),
    sceneMotion,
  };
}
