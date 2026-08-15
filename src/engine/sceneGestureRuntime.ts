import { GestureController } from './gesture';
import { sceneMotionRecorder } from './sceneMotion';
import {
  appendTrailPointSilently,
  clearTrailGeometry,
  getSceneState,
  replaceTrailGeometry,
  selectedMask,
  setMaskTransformSilently,
} from './sceneStore';

let installed = false;

export function installSceneGestureRuntime() {
  if (installed) return;
  installed = true;

  const originalUpdate = GestureController.prototype.update;
  GestureController.prototype.update = function updateSceneMask(...args: Parameters<GestureController['update']>) {
    const sceneState = getSceneState();
    const selected = selectedMask();
    const scenePlayback = sceneMotionRecorder.isPlaying();
    const editable = sceneState.enabled && selected && !selected.locked && !scenePlayback;
    const selectedTrail = editable && selected.geometry.kind === 'trail';
    const baseTransform = selectedTrail ? { ...selected.transform } : undefined;

    if (editable) this.setTransform(selected.transform);

    const runtimeArgs = [...args] as Parameters<GestureController['update']>;
    if (selectedTrail) runtimeArgs[1] = true;
    const result = originalUpdate.apply(this, runtimeArgs);

    if (!editable || !selected) return result;

    if (selectedTrail && baseTransform) {
      if (result.pinchStarted) clearTrailGeometry(selected.id, false);

      if (result.state === 'TWO_HAND_TRANSFORM') {
        setMaskTransformSilently(selected.id, result.transform);
        return result;
      }

      if (result.trailPoint) appendTrailPointSilently(selected.id, result.trailPoint);
      if (result.released && selected.geometry.kind === 'trail') {
        replaceTrailGeometry(selected.id, selected.geometry.points);
      }
      this.setTransform(baseTransform);
      result.transform = { ...baseTransform };
      return result;
    }

    setMaskTransformSilently(selected.id, result.transform);
    return result;
  };
}
