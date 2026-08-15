const listeners = new Set<() => void>();

export function subscribeSceneMotionTrack(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySceneMotionTrackChanged() {
  listeners.forEach((listener) => listener());
}
