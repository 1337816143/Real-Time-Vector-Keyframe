import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import type { BezierCurve } from './types';

type BezierMaskState = {
  enabled: boolean;
  curve: BezierCurve;
  feather: number;
  expansion: number;
};

let state: BezierMaskState = {
  enabled: false,
  curve: cloneCurve(DEFAULT_BEZIER_CURVE),
  feather: 0.006,
  expansion: 0,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getBezierMaskState(): BezierMaskState {
  return state;
}

export function subscribeBezierMask(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCustomMaskEnabled(enabled: boolean) {
  if (state.enabled === enabled) return;
  state = { ...state, enabled };
  emit();
}

export function setBezierCurve(curve: BezierCurve) {
  state = { ...state, curve: cloneCurve(curve) };
  emit();
}

export function setBezierFeather(feather: number) {
  const next = Math.min(0.08, Math.max(0, feather));
  if (state.feather === next) return;
  state = { ...state, feather: next };
  emit();
}

export function setBezierExpansion(expansion: number) {
  const next = Math.min(0.45, Math.max(-0.45, expansion));
  if (state.expansion === next) return;
  state = { ...state, expansion: next };
  emit();
}

export function setBezierMaskState(input: Partial<Pick<BezierMaskState, 'enabled' | 'curve' | 'feather' | 'expansion'>>) {
  state = {
    enabled: input.enabled ?? state.enabled,
    curve: input.curve ? cloneCurve(input.curve) : state.curve,
    feather: Math.min(0.08, Math.max(0, input.feather ?? state.feather)),
    expansion: Math.min(0.45, Math.max(-0.45, input.expansion ?? state.expansion)),
  };
  emit();
}

export function resetBezierMask() {
  state = {
    enabled: false,
    curve: cloneCurve(DEFAULT_BEZIER_CURVE),
    feather: 0.006,
    expansion: 0,
  };
  emit();
}
