import { cloneMaskNode, type SceneMaskNode } from './scene';
import { sceneMotionRecorder } from './sceneMotion';
import { PRESETS, type EffectSettings, type PresetId } from './types';

export interface EffectSequenceClip {
  id: string;
  name: string;
  enabled: boolean;
  maskId: string;
  startMs: number;
  endMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  presetId: PresetId;
  intensity: number;
}

export interface EffectSequenceTrack {
  version: 1;
  clips: EffectSequenceClip[];
}

let track: EffectSequenceTrack = { version: 1, clips: [] };
let previewTimeMs = 0;
const listeners = new Set<() => void>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function clipId() {
  return `seq-${Date.now()}-${Math.round(Math.random() * 99999)}`;
}

function cloneClip(clip: EffectSequenceClip): EffectSequenceClip {
  return { ...clip };
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeEffectSequence(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEffectSequenceTrack(): EffectSequenceTrack {
  return { version: 1, clips: track.clips.map(cloneClip) };
}

export function replaceEffectSequence(next?: EffectSequenceTrack) {
  track = next
    ? { version: 1, clips: next.clips.slice(0, 32).map(cloneClip) }
    : { version: 1, clips: [] };
  emit();
}

export function getEffectSequencePreviewTime() {
  return previewTimeMs;
}

export function setEffectSequencePreviewTime(timeMs: number) {
  previewTimeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
}

export function effectSequenceRenderTime(now: number) {
  return sceneMotionRecorder.isPlaying() ? sceneMotionRecorder.getCurrentTime(now) : previewTimeMs;
}

export function addEffectSequenceClip(maskId: string, durationMs: number, atMs = previewTimeMs) {
  const duration = Math.max(1, durationMs);
  const startMs = clamp(atMs, 0, Math.max(0, duration - 1));
  const endMs = Math.min(duration, Math.max(startMs + 1, startMs + Math.min(1200, Math.max(300, duration * 0.25))));
  const index = track.clips.length + 1;
  const clip: EffectSequenceClip = {
    id: clipId(),
    name: `Effect Clip ${String(index).padStart(2, '0')}`,
    enabled: true,
    maskId,
    startMs,
    endMs,
    fadeInMs: Math.min(180, Math.max(0, (endMs - startMs) * 0.2)),
    fadeOutMs: Math.min(180, Math.max(0, (endMs - startMs) * 0.2)),
    presetId: 'cyber',
    intensity: 1,
  };
  track = { version: 1, clips: [...track.clips, clip].slice(0, 32) };
  emit();
  return cloneClip(clip);
}

export function updateEffectSequenceClip(id: string, patch: Partial<Omit<EffectSequenceClip, 'id'>>) {
  const source = track.clips.find((clip) => clip.id === id);
  if (!source) return;
  const startMs = Math.max(0, patch.startMs ?? source.startMs);
  const endMs = Math.max(startMs + 1, patch.endMs ?? source.endMs);
  const span = endMs - startMs;
  const next: EffectSequenceClip = {
    ...source,
    ...patch,
    id: source.id,
    name: (patch.name ?? source.name).slice(0, 80),
    startMs,
    endMs,
    fadeInMs: clamp(patch.fadeInMs ?? source.fadeInMs, 0, span),
    fadeOutMs: clamp(patch.fadeOutMs ?? source.fadeOutMs, 0, span),
    intensity: clamp(patch.intensity ?? source.intensity, 0, 2),
  };
  track = { version: 1, clips: track.clips.map((clip) => clip.id === id ? next : clip) };
  emit();
}

export function removeEffectSequenceClip(id: string) {
  const clips = track.clips.filter((clip) => clip.id !== id);
  if (clips.length === track.clips.length) return;
  track = { version: 1, clips };
  emit();
}

export function moveEffectSequenceClip(id: string, direction: -1 | 1) {
  const clips = track.clips.slice();
  const index = clips.findIndex((clip) => clip.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= clips.length) return;
  [clips[index], clips[target]] = [clips[target], clips[index]];
  track = { version: 1, clips };
  emit();
}

function clipWeight(clip: EffectSequenceClip, timeMs: number) {
  if (!clip.enabled || timeMs < clip.startMs || timeMs > clip.endMs) return 0;
  const span = Math.max(1, clip.endMs - clip.startMs);
  const local = timeMs - clip.startMs;
  const remaining = clip.endMs - timeMs;
  const fadeIn = clamp(clip.fadeInMs, 0, span);
  const fadeOut = clamp(clip.fadeOutMs, 0, span);
  const inWeight = fadeIn > 0 ? clamp(local / fadeIn, 0, 1) : 1;
  const outWeight = fadeOut > 0 ? clamp(remaining / fadeOut, 0, 1) : 1;
  return clamp(Math.min(inWeight, outWeight) * clip.intensity, 0, 1);
}

function blendEffects(base: EffectSettings, target: EffectSettings, weight: number): EffectSettings {
  if (weight <= 0) return {
    ...base,
    effectStack: base.effectStack.map((node) => ({ ...node })),
  };
  const targetByType = new Map(target.effectStack.map((node) => [node.type, node]));
  const effectStack = base.effectStack.map((node) => {
    const desired = targetByType.get(node.type);
    if (!desired) return { ...node };
    return {
      ...node,
      enabled: node.enabled || (desired.enabled && weight > 0.02),
      intensity: lerp(node.intensity, desired.intensity, weight),
      opacity: desired.enabled ? lerp(node.opacity, desired.opacity, weight) : lerp(node.opacity, 0, weight),
      blendMode: weight >= 0.5 ? desired.blendMode : node.blendMode,
    };
  });

  return {
    rgbSplit: lerp(base.rgbSplit, target.rgbSplit, weight),
    ripple: lerp(base.ripple, target.ripple, weight),
    pixelate: lerp(base.pixelate, target.pixelate, weight),
    distortion: lerp(base.distortion, target.distortion, weight),
    glow: lerp(base.glow, target.glow, weight),
    edgeFxMode: weight >= 0.5 ? (target.edgeFxMode ?? 'neon') : (base.edgeFxMode ?? 'neon'),
    edgeFxSpeed: lerp(base.edgeFxSpeed ?? 1, target.edgeFxSpeed ?? 1, weight),
    edgeFxDensity: lerp(base.edgeFxDensity ?? 1, target.edgeFxDensity ?? 1, weight),
    invertMask: weight >= 0.5 ? target.invertMask : base.invertMask,
    useAlternateMedia: weight >= 0.5 ? target.useAlternateMedia : base.useAlternateMedia,
    temporalMode: weight >= 0.5 ? target.temporalMode : base.temporalMode,
    temporalDelayMs: lerp(base.temporalDelayMs, target.temporalDelayMs, weight),
    temporalMix: lerp(base.temporalMix, target.temporalMix, weight),
    effectStack,
  };
}

export function applyEffectSequence(nodes: SceneMaskNode[], timeMs: number) {
  if (!track.clips.length) return nodes;
  const byMask = new Map<string, EffectSequenceClip[]>();
  for (const clip of track.clips) {
    const weight = clipWeight(clip, timeMs);
    if (weight <= 0) continue;
    const bucket = byMask.get(clip.maskId) ?? [];
    bucket.push(clip);
    byMask.set(clip.maskId, bucket);
  }
  if (!byMask.size) return nodes;

  return nodes.map((source) => {
    const clips = byMask.get(source.id);
    if (!clips?.length) return source;
    const node = cloneMaskNode(source);
    let effects = node.effects;
    for (const clip of clips) {
      const weight = clipWeight(clip, timeMs);
      effects = blendEffects(effects, PRESETS[clip.presetId].effects, weight);
    }
    node.effects = effects;
    return node;
  });
}
