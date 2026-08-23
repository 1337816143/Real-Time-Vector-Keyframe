import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

type RecoveryState = {
  goodFrames: number;
  mirror: boolean;
};

const rendererState = new WeakMap<VfxRenderer, RecoveryState>();
const preparedVideos = new WeakSet<HTMLVideoElement>();
let installed = false;

function rendererCanvas(renderer: VfxRenderer) {
  return (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
}

function primaryCameraVideo() {
  return document.querySelector<HTMLVideoElement>('.studio-shell > video.source-media:first-of-type');
}

function recoveryNote() {
  const shell = document.querySelector<HTMLElement>('.studio-shell');
  if (!shell) return undefined;
  let note = shell.querySelector<HTMLButtonElement>('.camera-recovery-note');
  if (!note) {
    note = document.createElement('button');
    note.type = 'button';
    note.className = 'camera-recovery-note glass-panel';
    shell.appendChild(note);
  }
  return note;
}

function clearRecoveryNote(kind?: string) {
  const note = document.querySelector<HTMLButtonElement>('.camera-recovery-note');
  if (!note) return;
  if (kind && note.dataset.kind !== kind) return;
  note.remove();
}

function showResumeNote(video: HTMLVideoElement) {
  const note = recoveryNote();
  if (!note) return;
  note.dataset.kind = 'camera-paused';
  note.innerHTML = '<strong>Camera is ready but paused</strong><span>Tap to resume the live preview</span>';
  note.onclick = () => {
    void video.play().then(() => clearRecoveryNote('camera-paused')).catch(() => undefined);
  };
}

function showGpuFallbackNote(message = 'GPU effects paused · showing live camera fallback') {
  const note = recoveryNote();
  if (!note || note.dataset.kind === 'camera-paused') return;
  note.dataset.kind = 'gpu-fallback';
  note.innerHTML = `<strong>Live camera fallback</strong><span>${message}</span>`;
  note.onclick = null;
}

function syncMirror(video: HTMLVideoElement | undefined, mirror: boolean) {
  if (!video) return;
  video.classList.toggle('camera-recovery-mirrored', mirror);
}

function prepareCamera(video: HTMLVideoElement, mirror: boolean) {
  syncMirror(video, mirror);
  if (preparedVideos.has(video)) return;
  preparedVideos.add(video);

  video.autoplay = true;
  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;

  const resume = () => {
    if (!video.srcObject || video.readyState < HTMLMediaElement.HAVE_METADATA || !video.paused) return;
    void video.play().catch(() => showResumeNote(video));
  };

  video.addEventListener('loadedmetadata', resume);
  video.addEventListener('canplay', resume);
  video.addEventListener('playing', () => {
    video.dataset.cameraLive = 'true';
    clearRecoveryNote('camera-paused');
  });
  video.addEventListener('pause', () => {
    if (video.srcObject && document.visibilityState === 'visible') showResumeNote(video);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });

  resume();
}

export function installCameraRecoveryRuntime() {
  if (installed) return;
  installed = true;

  const previousRender = VfxRenderer.prototype.render;
  const previousSetMirror = VfxRenderer.prototype.setMirror;

  VfxRenderer.prototype.setMirror = function setMirrorWithCameraFallback(value: boolean) {
    const state = rendererState.get(this) ?? { goodFrames: 0, mirror: value };
    state.mirror = value;
    rendererState.set(this, state);
    syncMirror(primaryCameraVideo(), value);
    return previousSetMirror.call(this, value);
  };

  VfxRenderer.prototype.render = function renderWithCameraRecovery(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const canvas = rendererCanvas(this);
    const recovery = rendererState.get(this) ?? { goodFrames: 0, mirror: true };
    rendererState.set(this, recovery);
    prepareCamera(camera, recovery.mirror);

    try {
      const result = previousRender.call(this, camera, alternate, state);
      const gl = canvas.getContext('webgl2');
      const cameraReady = camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && camera.videoWidth > 0
        && camera.videoHeight > 0;
      const gpuReady = Boolean(gl) && !gl!.isContextLost() && gl!.getError() === gl!.NO_ERROR;

      if (cameraReady && gpuReady) {
        recovery.goodFrames += 1;
        if (recovery.goodFrames >= 2) {
          canvas.dataset.vfxLive = 'true';
          clearRecoveryNote('gpu-fallback');
        }
      } else {
        recovery.goodFrames = 0;
        canvas.dataset.vfxLive = 'false';
        if (cameraReady && !gpuReady) showGpuFallbackNote();
      }
      return result;
    } catch (error) {
      recovery.goodFrames = 0;
      canvas.dataset.vfxLive = 'false';
      const detail = error instanceof Error ? error.message : 'WebGL render error';
      console.error('[camera-recovery] VFX render failed; keeping camera preview alive.', error);
      showGpuFallbackNote(detail.slice(0, 120));
      return undefined;
    }
  };
}
