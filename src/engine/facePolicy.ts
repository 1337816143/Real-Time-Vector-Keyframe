// Shared policy: freshness is a rendering bound, not a measured device latency claim.
export const FACE_MAX_AGE_MS = 250;
export const FACE_INIT_TIMEOUT_MS = 30000;
export const FACE_INPUT_WIDTH = 320;
export const FACE_WARMUP_BUDGET_MS = 200;
export const FACE_COLD_FRAME_TIMEOUT_MS = 15000;
export const FACE_FRAME_TIMEOUT_MS = 3000;

export type FaceActivity = 'off' | 'waiting-camera' | 'raw-camera' | 'active';

/** Do not run face inference during camera setup or explicit RAW preview. */
export function getFaceActivity(requested: boolean, cameraUsable: boolean, rawCamera: boolean): FaceActivity {
  if (!requested) return 'off';
  if (!cameraUsable) return 'waiting-camera';
  return rawCamera ? 'raw-camera' : 'active';
}
