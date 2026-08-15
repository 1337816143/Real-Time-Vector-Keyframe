import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import { getBezierMaskState, setBezierMaskState } from './bezierStore';
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
  motion?: MotionTrack;
}

type ProjectSnapshotInput = Omit<ProjectSnapshot, 'version' | 'savedAt' | 'mask'> & {
  mask: Omit<ProjectSnapshot['mask'], 'customCurve' | 'customFeather' | 'customExpansion'> & {
    customCurve?: BezierCurve;
    customFeather?: number;
    customExpansion?: number;
  };
};

const MASK_TYPES: MaskType[] = ['circle', 'blob', 'portal', 'trail', 'custom'];
const TRAIL_MODES: TrailReleaseMode[] = ['hold', 'dissipate', 'close', 'expand', 'burst', 'shrink'];
const TEMPORAL_MODES: TemporalMode[] = ['none', 'timeWindow', 'echo', 'afterImage'];
const TRANSITIONS: EffectTransitionType[] = ['crossFade', 'directionalWipe', 'glitch', 'flash', 'liquid'];
const EFFECT_TYPES: EffectNodeType[] = ['rgbSplit', 'ripple', 'pixelate', 'distortion'];
const BLEND_MODES: EffectBlendMode[] = ['normal', 'add', 'screen', 'multiply'];
const GESTURE_STATES: GestureState[] = ['IDLE', 'HOVER', 'PINCH_START', 'GRABBED', 'DRAGGING', 'TWO_HAND_TRANSFORM', 'RELEASE', 'LOST'];

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

export function createProjectSnapshot(input: ProjectSnapshotInput): ProjectSnapshot {
  const bezierState = getBezierMaskState();
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
    motion: sanitizeMotion(root.motion),
  };
}
