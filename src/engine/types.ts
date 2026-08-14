import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type GestureState =
  | 'IDLE'
  | 'HOVER'
  | 'PINCH_START'
  | 'GRABBED'
  | 'DRAGGING'
  | 'TWO_HAND_TRANSFORM'
  | 'RELEASE'
  | 'LOST';

export type MaskType = 'circle' | 'blob' | 'portal' | 'trail';
export type TemporalMode = 'none' | 'timeWindow' | 'echo' | 'afterImage';
export type PlaybackMode = 'once' | 'loop' | 'reverse' | 'pingpong';
export type TrailReleaseMode = 'hold' | 'dissipate' | 'close' | 'expand' | 'burst' | 'shrink';
export type EffectNodeType = 'rgbSplit' | 'ripple' | 'pixelate' | 'distortion';
export type EffectBlendMode = 'normal' | 'add' | 'screen' | 'multiply';
export type PresetId = 'multiverse' | 'cyber' | 'dream' | 'time' | 'freeze' | 'slash';

export interface Vec2 {
  x: number;
  y: number;
}

export interface HandFrame {
  id: number;
  handedness: 'Left' | 'Right' | 'Unknown';
  landmarks: NormalizedLandmark[];
  palm: Vec2;
  pinch: Vec2;
  pinchDistance: number;
  normalizedPinchDistance: number;
  velocity: Vec2;
  speed: number;
  timestamp: number;
}

export interface TrackingSnapshot {
  hands: HandFrame[];
  timestamp: number;
  trackingFps: number;
}

export interface MaskTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface EffectNode {
  id: string;
  type: EffectNodeType;
  enabled: boolean;
  intensity: number;
  opacity: number;
  blendMode: EffectBlendMode;
}

export interface EffectSettings {
  rgbSplit: number;
  ripple: number;
  pixelate: number;
  distortion: number;
  glow: number;
  invertMask: boolean;
  useAlternateMedia: boolean;
  temporalMode: TemporalMode;
  temporalDelayMs: number;
  temporalMix: number;
  effectStack: EffectNode[];
}

export interface EngineDebug {
  fps: number;
  trackingFps: number;
  state: GestureState;
  pinchDistance: number;
  handSpeed: number;
  mask: MaskTransform;
  hands: number;
  renderScale: number;
  historyMs: number;
}

export interface RenderState {
  maskType: MaskType;
  transform: MaskTransform;
  effects: EffectSettings;
  gestureState: GestureState;
  handSpeed: number;
  trail: Array<Vec2 & { width: number }>;
  hoverPoint?: Vec2;
  time: number;
}

export interface MotionKeyframe {
  t: number;
  maskType: MaskType;
  transform: MaskTransform;
  effects: EffectSettings;
  gestureState: GestureState;
  handSpeed: number;
  interactionPoint?: Vec2;
}

export interface MotionTrack {
  version: 1;
  duration: number;
  keyframes: MotionKeyframe[];
}

export const DEFAULT_TRANSFORM: MaskTransform = {
  x: 0.5,
  y: 0.5,
  scale: 0.22,
  rotation: 0,
};

const ALL_EFFECTS: EffectNodeType[] = ['rgbSplit', 'ripple', 'pixelate', 'distortion'];

function stack(order: EffectNodeType[], enabled: EffectNodeType[] = order): EffectNode[] {
  const finalOrder = [...order, ...ALL_EFFECTS.filter((type) => !order.includes(type))];
  return finalOrder.map((type) => ({
    id: `fx-${type}`,
    type,
    enabled: enabled.includes(type),
    intensity: 1,
    opacity: 1,
    blendMode: 'normal',
  }));
}

const fx = (
  partial: Partial<EffectSettings> = {},
): EffectSettings => ({
  rgbSplit: 0,
  ripple: 0,
  pixelate: 0,
  distortion: 0,
  glow: 0.8,
  invertMask: false,
  useAlternateMedia: false,
  temporalMode: 'none',
  temporalDelayMs: 900,
  temporalMix: 1,
  effectStack: stack(['ripple', 'distortion', 'rgbSplit', 'pixelate'], []),
  ...partial,
  effectStack: partial.effectStack?.map((node) => ({ ...node })) ?? stack(['ripple', 'distortion', 'rgbSplit', 'pixelate'], []),
});

export const PRESETS: Record<PresetId, { label: string; mask: MaskType; effects: EffectSettings }> = {
  multiverse: {
    label: 'Multiverse Portal',
    mask: 'portal',
    effects: fx({
      rgbSplit: 0.006,
      ripple: 0.018,
      distortion: 0.012,
      glow: 1,
      useAlternateMedia: true,
      effectStack: stack(['ripple', 'distortion', 'rgbSplit', 'pixelate'], ['ripple', 'distortion', 'rgbSplit']),
    }),
  },
  cyber: {
    label: 'Cyber Reality',
    mask: 'blob',
    effects: fx({
      rgbSplit: 0.018,
      ripple: 0.006,
      pixelate: 72,
      distortion: 0.02,
      glow: 0.85,
      effectStack: stack(['pixelate', 'rgbSplit', 'distortion', 'ripple'], ['pixelate', 'rgbSplit', 'distortion']),
    }),
  },
  dream: {
    label: 'Dream Window',
    mask: 'blob',
    effects: fx({
      rgbSplit: 0.004,
      ripple: 0.035,
      distortion: 0.008,
      glow: 0.55,
      temporalMode: 'afterImage',
      temporalDelayMs: 420,
      temporalMix: 0.32,
      effectStack: stack(['ripple', 'rgbSplit', 'distortion', 'pixelate'], ['ripple', 'rgbSplit']),
    }),
  },
  time: {
    label: 'Time Window',
    mask: 'portal',
    effects: fx({
      glow: 0.92,
      ripple: 0.008,
      temporalMode: 'timeWindow',
      temporalDelayMs: 1100,
      temporalMix: 1,
      effectStack: stack(['ripple', 'distortion', 'rgbSplit', 'pixelate'], ['ripple']),
    }),
  },
  freeze: {
    label: 'Freeze World',
    mask: 'circle',
    effects: fx({
      glow: 0.9,
      invertMask: true,
      useAlternateMedia: true,
      effectStack: stack(['rgbSplit', 'ripple', 'distortion', 'pixelate'], []),
    }),
  },
  slash: {
    label: 'Vector Slash',
    mask: 'trail',
    effects: fx({
      rgbSplit: 0.012,
      ripple: 0.01,
      distortion: 0.024,
      glow: 1.2,
      useAlternateMedia: true,
      effectStack: stack(['distortion', 'rgbSplit', 'ripple', 'pixelate'], ['distortion', 'rgbSplit', 'ripple']),
    }),
  },
};
