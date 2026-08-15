import { GestureController } from './gesture';
import { getSceneState, selectedMask, setMaskTransformSilently } from './sceneStore';

let installed = false;

export function installSceneGestureRuntime() {
  if (installed) return;
  installed = true;

  const originalUpdate = GestureController.prototype.update;
  GestureController.prototype.update = function updateSceneMask(...args: Parameters<GestureController['update']>) {
    const sceneState = getSceneState();
    const selected = selectedMask();

    if (sceneState.enabled && selected && !selected.locked) {
      this.setTransform(selected.transform);
    }

    const result = originalUpdate.apply(this, args);

    if (sceneState.enabled && selected && !selected.locked) {
      setMaskTransformSilently(selected.id, result.transform);
    }

    return result;
  };
}
