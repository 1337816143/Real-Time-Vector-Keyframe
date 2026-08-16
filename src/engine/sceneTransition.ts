import { cloneMaskNode, type SceneMaskNode } from './scene';
import { getSceneState, setMaskEffects, setMaskEffectsSilently } from './sceneStore';
import type { EffectSettings } from './types';

export type SceneTransitionEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface SceneEffectTransition {
  maskId: string;
  startedAt: number;
  durationMs: number;
  easing: SceneTransitionEasing;
  from: EffectSettings;
  to: EffectSettings;
}

const transitions = new Map<string, SceneEffectTransition>();
const listeners = new Set<() => void>();
let animationFrame = 0;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function cloneEffects(effects: EffectSettings): EffectSettings {
  return {
    ...effects,
    effectStack: effects.effectStack.map((node) => ({ ...node })),
  };
}

function ease(t: number, easing: SceneTransitionEasing) {
  const x = clamp01(t);
  if (easing === 'easeIn') return x * x;
  if (easing === 'easeOut') return 1 - (1 - x) * (1 - x);
  if (easing === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  return x;
}

function compatibleStack(a: EffectSettings, b: EffectSettings) {
  return a.effectStack.length === b.effectStack.length
    && a.effectStack.every((node, index) => node.id === b.effectStack[index]?.id && node.type === b.effectStack[index]?.type);
}

function blendEffects(a: EffectSettings, b: EffectSettings, t: number): EffectSettings {
  const near = t < 0.5 ? a : b;
  const stack = compatibleStack(a, b)
    ? a.effectStack.map((node, index) => {
        const next = b.effectStack[index];
        return {
          ...node,
          enabled: t < 0.5 ? node.enabled : next.enabled,
          intensity: lerp(node.intensity, next.intensity, t),
          opacity: lerp(node.opacity, next.opacity, t),
          blendMode: t < 0.5 ? node.blendMode : next.blendMode,
        };
      })
    : near.effectStack.map((node) => ({ ...node }));

  return {
    rgbSplit: lerp(a.rgbSplit, b.rgbSplit, t),
    ripple: lerp(a.ripple, b.ripple, t),
    pixelate: lerp(a.pixelate, b.pixelate, t),
    distortion: lerp(a.distortion, b.distortion, t),
    glow: lerp(a.glow, b.glow, t),
    edgeFxMode: t < 0.5 ? (a.edgeFxMode ?? 'neon') : (b.edgeFxMode ?? 'neon'),
    edgeFxSpeed: lerp(a.edgeFxSpeed ?? 1, b.edgeFxSpeed ?? 1, t),
    edgeFxDensity: lerp(a.edgeFxDensity ?? 1, b.edgeFxDensity ?? 1, t),
    invertMask: t < 0.5 ? a.invertMask : b.invertMask,
    useAlternateMedia: t < 0.5 ? a.useAlternateMedia : b.useAlternateMedia,
    temporalMode: t < 0.5 ? a.temporalMode : b.temporalMode,
    temporalDelayMs: lerp(a.temporalDelayMs, b.temporalDelayMs, t),
    temporalMix: lerp(a.temporalMix, b.temporalMix, t),
    effectStack: stack,
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}

function stopClockIfIdle() {
  if (transitions.size || !animationFrame) return;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function tick(now: number) {
  animationFrame = 0;
  if (!transitions.size) return;

  const completed: SceneEffectTransition[] = [];
  for (const transition of transitions.values()) {
    const raw = (now - transition.startedAt) / Math.max(1, transition.durationMs);
    if (raw >= 1) {
      completed.push(transition);
      continue;
    }
    setMaskEffectsSilently(
      transition.maskId,
      blendEffects(transition.from, transition.to, ease(raw, transition.easing)),
    );
  }

  for (const transition of completed) {
    transitions.delete(transition.maskId);
    setMaskEffects(transition.maskId, transition.to);
  }

  if (completed.length) emit();
  if (transitions.size) animationFrame = requestAnimationFrame(tick);
}

function ensureClock() {
  if (!animationFrame && transitions.size) animationFrame = requestAnimationFrame(tick);
}

export function subscribeSceneTransitions(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSceneTransitions() {
  return [...transitions.values()].map((transition) => ({
    ...transition,
    from: cloneEffects(transition.from),
    to: cloneEffects(transition.to),
  }));
}

export function beginSceneEffectTransition(
  maskId: string,
  to: EffectSettings,
  durationMs = 650,
  easing: SceneTransitionEasing = 'easeInOut',
  now = performance.now(),
) {
  const node = getSceneState().scene.nodes.find((item) => item.id === maskId);
  if (!node) return false;

  transitions.set(maskId, {
    maskId,
    startedAt: now,
    durationMs: Math.min(5000, Math.max(80, durationMs)),
    easing,
    from: cloneEffects(node.effects),
    to: cloneEffects(to),
  });
  emit();
  ensureClock();
  return true;
}

export function cancelSceneEffectTransition(maskId: string, commitTarget = false) {
  const transition = transitions.get(maskId);
  if (!transition) return;
  transitions.delete(maskId);
  if (commitTarget) setMaskEffects(maskId, transition.to);
  else setMaskEffects(maskId, transition.from);
  emit();
  stopClockIfIdle();
}

export function clearSceneTransitions() {
  if (!transitions.size) return;
  const active = [...transitions.values()];
  transitions.clear();
  for (const transition of active) setMaskEffects(transition.maskId, transition.from);
  emit();
  stopClockIfIdle();
}

export function applySceneEffectTransitions(nodes: SceneMaskNode[], now = performance.now()) {
  return nodes.map((node) => {
    const transition = transitions.get(node.id);
    if (!transition) return cloneMaskNode(node);
    const raw = clamp01((now - transition.startedAt) / Math.max(1, transition.durationMs));
    const result = cloneMaskNode(node);
    result.effects = blendEffects(transition.from, transition.to, ease(raw, transition.easing));
    return result;
  });
}
