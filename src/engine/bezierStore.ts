import { DEFAULT_BEZIER_CURVE, cloneCurve } from './bezier';
import type { BezierCurve } from './types';

type BezierMaskState = {
  enabled: boolean;
  curve: BezierCurve;
};

let state: BezierMaskState = {
  enabled: false,
  curve: cloneCurve(DEFAULT_BEZIER_CURVE),
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

export function resetBezierMask() {
  state = {
    enabled: false,
    curve: cloneCurve(DEFAULT_BEZIER_CURVE),
  };
  emit();
}
