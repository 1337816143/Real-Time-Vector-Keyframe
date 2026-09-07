import { VfxRenderer } from './renderer';
import type { RenderState } from './types';

type RecoveryState = {
  goodProbes: number;
  blackProbes: number;
  mirror: boolean;
  lastProbeAt: number;
};

type VideoHealth = {
  frameCount: number;
  lastFrameAt: number;
  lastCurrentTime: number;
  lastAdvanceAt: number;
  callbackStarted: boolean;
  trackId: string;
  streamStartedAt: number;
  constraintAttempted: boolean;
};

const rendererState = new WeakMap<VfxRenderer, RecoveryState>();
const videoHealth = new WeakMap<HTMLVideoElement, VideoHealth>();
const preparedVideos = new WeakSet<HTMLVideoElement>();
const probeCanvas = document.createElement('canvas');
probeCanvas.width = 12;
probeCanvas.height = 12;
const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
let installed = false;
let forceRaw = new URLSearchParams(window.location.search).get('raw') === '1';

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

function showWaitingNote(message = 'Waiting for the first real camera frame…') {
  const note = recoveryNote();
  if (!note || note.dataset.kind === 'camera-paused') return;
  note.dataset.kind = 'camera-waiting';
  note.innerHTML = `<strong>Camera connected</strong><span>${message}</span>`;
  note.onclick = null;
}

function showGpuFallbackNote(message = 'GPU output is invalid · showing raw camera instead') {
  const note = recoveryNote();
  if (!note || note.dataset.kind === 'camera-paused') return;
  note.dataset.kind = 'gpu-fallback';
  note.innerHTML = `<strong>Live camera fallback</strong><span>${message}</span>`;
  note.onclick = null;
}

function syncMirror(video: HTMLVideoElement | null | undefined, mirror: boolean) {
  if (!video) return;
  video.classList.toggle('camera-recovery-mirrored', mirror);
}

function healthFor(video: HTMLVideoElement) {
  let health = videoHealth.get(video);
  if (!health) {
    health = {
      frameCount: 0,
      lastFrameAt: 0,
      lastCurrentTime: 0,
      lastAdvanceAt: 0,
      callbackStarted: false,
      trackId: '',
      streamStartedAt: performance.now(),
      constraintAttempted: false,
    };
    videoHealth.set(video, health);
  }
  return health;
}

function currentVideoTrack(video: HTMLVideoElement) {
  return video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : undefined;
}

function syncTrackHealth(video: HTMLVideoElement, now: number) {
  const health = healthFor(video);
  const track = currentVideoTrack(video);
  const trackId = track?.id ?? '';
  if (trackId && trackId !== health.trackId) {
    health.frameCount = 0;
    health.lastFrameAt = 0;
    health.lastCurrentTime = 0;
    health.lastAdvanceAt = 0;
    health.callbackStarted = false;
    health.trackId = trackId;
    health.streamStartedAt = now;
    health.constraintAttempted = false;
  }
  return health;
}

function startVideoFrameObserver(video: HTMLVideoElement) {
  const health = syncTrackHealth(video, performance.now());
  if (health.callbackStarted) return;
  health.callbackStarted = true;

  const typedVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  };
  if (!typedVideo.requestVideoFrameCallback) return;

  const observedTrackId = health.trackId;
  const observe = () => {
    typedVideo.requestVideoFrameCallback?.(() => {
      const current = healthFor(video);
      if (observedTrackId && current.trackId !== observedTrackId) return;
      current.frameCount += 1;
      current.lastFrameAt = performance.now();
      current.lastCurrentTime = video.currentTime;
      current.lastAdvanceAt = current.lastFrameAt;
      if (video.isConnected && video.srcObject) observe();
    });
  };
  observe();
}

function updateModeToggle() {
  const button = document.querySelector<HTMLButtonElement>('.camera-mode-toggle');
  if (!button) return;
  button.dataset.mode = forceRaw ? 'raw' : 'auto';
  button.innerHTML = forceRaw
    ? '<strong>RAW CAMERA</strong><span>GPU bypassed · tap for VFX auto</span>'
    : '<strong>VFX AUTO</strong><span>tap to force raw camera</span>';
}

function ensureModeToggle() {
  const shell = document.querySelector<HTMLElement>('.studio-shell');
  if (!shell) return;
  let button = shell.querySelector<HTMLButtonElement>('.camera-mode-toggle');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'camera-mode-toggle glass-panel';
    button.onclick = () => {
      forceRaw = !forceRaw;
      if (forceRaw) {
        document.querySelectorAll<HTMLCanvasElement>('.vfx-canvas').forEach((canvas) => {
          canvas.dataset.vfxLive = 'false';
        });
        clearRecoveryNote('gpu-fallback');
      }
      updateModeToggle();
    };
    shell.appendChild(button);
  }
  updateModeToggle();
}

function prepareCamera(video: HTMLVideoElement, mirror: boolean) {
  syncMirror(video, mirror);
  syncTrackHealth(video, performance.now());
  startVideoFrameObserver(video);
  ensureModeToggle();
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

function updateFallbackFrameHealth(video: HTMLVideoElement, now: number) {
  const health = syncTrackHealth(video, now);
  if (video.currentTime > 0 && Math.abs(video.currentTime - health.lastCurrentTime) > 0.001) {
    health.frameCount += 1;
    health.lastCurrentTime = video.currentTime;
    health.lastAdvanceAt = now;
  }
  return health;
}

function videoHasRealFrames(video: HTMLVideoElement, now: number) {
  const health = updateFallbackFrameHealth(video, now);
  const dimensionReady = video.videoWidth > 0 && video.videoHeight > 0;
  const dataReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  const recentFrame = health.lastFrameAt > 0
    ? now - health.lastFrameAt < 1800
    : health.lastAdvanceAt > 0 && now - health.lastAdvanceAt < 1800;
  return dimensionReady && dataReady && health.frameCount >= 2 && recentFrame;
}

function attemptConservativeCameraProfile(video: HTMLVideoElement, now: number) {
  const health = syncTrackHealth(video, now);
  if (health.constraintAttempted || now - health.streamStartedAt < 2200 || health.frameCount >= 2) return;
  const track = currentVideoTrack(video);
  if (!track || track.readyState !== 'live') return;

  health.constraintAttempted = true;
  showWaitingNote('No decoded frames yet · applying a 720p / 30fps recovery profile…');
  void track.applyConstraints({
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  }).then(() => video.play()).catch((error) => {
    console.warn('[camera-recovery] conservative camera constraints failed', error);
    showWaitingNote('Camera is active but frames are not arriving. Try switching camera or reloading the Studio.');
  });
}

function sampleVideoLuma(video: HTMLVideoElement) {
  if (!probeContext || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined;
  try {
    probeContext.drawImage(video, 0, 0, probeCanvas.width, probeCanvas.height);
    const pixels = probeContext.getImageData(0, 0, probeCanvas.width, probeCanvas.height).data;
    let total = 0;
    let max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      total += luma;
      max = Math.max(max, luma);
    }
    return { average: total / (pixels.length / 4), max };
  } catch {
    return undefined;
  }
}

function sampleGpuLuma(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  if (canvas.width < 8 || canvas.height < 8) return undefined;
  const width = Math.min(12, canvas.width);
  const height = Math.min(12, canvas.height);
  const x = Math.max(0, Math.floor((canvas.width - width) / 2));
  const y = Math.max(0, Math.floor((canvas.height - height) / 2));
  const pixels = new Uint8Array(width * height * 4);
  try {
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } catch {
    return undefined;
  }
  let total = 0;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    total += luma;
    max = Math.max(max, luma);
  }
  return { average: total / (pixels.length / 4), max };
}

function gpuLooksLikeBlackFrame(
  cameraSample: { average: number; max: number } | undefined,
  gpuSample: { average: number; max: number } | undefined,
) {
  if (!cameraSample || !gpuSample) return false;
  const cameraClearlyVisible = cameraSample.average > 5 || cameraSample.max > 18;
  const gpuEssentiallyBlack = gpuSample.average < 0.8 && gpuSample.max < 3;
  return cameraClearlyVisible && gpuEssentiallyBlack;
}

export function installCameraRecoveryRuntime() {
  if (installed) return;
  installed = true;

  const previousRender = VfxRenderer.prototype.render;
  const previousSetMirror = VfxRenderer.prototype.setMirror;

  VfxRenderer.prototype.setMirror = function setMirrorWithCameraFallback(value: boolean) {
    const state = rendererState.get(this) ?? { goodProbes: 0, blackProbes: 0, mirror: value, lastProbeAt: 0 };
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
    const recovery = rendererState.get(this) ?? { goodProbes: 0, blackProbes: 0, mirror: true, lastProbeAt: 0 };
    rendererState.set(this, recovery);
    prepareCamera(camera, recovery.mirror);

    const now = performance.now();
    const realFrames = videoHasRealFrames(camera, now);
    if (!realFrames) {
      recovery.goodProbes = 0;
      canvas.dataset.vfxLive = 'false';
      attemptConservativeCameraProfile(camera, now);
      if (camera.srcObject && camera.readyState >= HTMLMediaElement.HAVE_METADATA) {
        if (camera.paused) showResumeNote(camera);
        else {
          const health = healthFor(camera);
          showWaitingNote(
            now - health.streamStartedAt > 5200
              ? 'Camera is active but no decoded frames are arriving. Try switching camera or reloading the Studio.'
              : 'Waiting for the first real camera frame…',
          );
        }
      }
    }

    if (forceRaw) {
      canvas.dataset.vfxLive = 'false';
      if (realFrames) {
        clearRecoveryNote('gpu-fallback');
        clearRecoveryNote('camera-waiting');
      }
      return undefined;
    }

    try {
      const result = previousRender.call(this, camera, alternate, state);
      const gl = canvas.getContext('webgl2');
      const gpuContextReady = Boolean(gl) && !gl!.isContextLost();

      if (!realFrames || !gpuContextReady) {
        recovery.goodProbes = 0;
        canvas.dataset.vfxLive = 'false';
        if (realFrames && !gpuContextReady) showGpuFallbackNote('WebGL2 context is unavailable or lost');
        return result;
      }

      if (now - recovery.lastProbeAt >= 260) {
        recovery.lastProbeAt = now;
        const cameraSample = sampleVideoLuma(camera);
        const gpuSample = sampleGpuLuma(gl!, canvas);
        const blackFrame = gpuLooksLikeBlackFrame(cameraSample, gpuSample);

        if (blackFrame) {
          recovery.blackProbes += 1;
          recovery.goodProbes = 0;
        } else {
          recovery.blackProbes = 0;
          recovery.goodProbes += 1;
        }

        if (recovery.blackProbes >= 2) {
          canvas.dataset.vfxLive = 'false';
          showGpuFallbackNote(
            `VFX canvas produced a black frame while the camera contains image data${cameraSample ? ` · camera ${cameraSample.average.toFixed(1)}` : ''}`,
          );
        } else if (recovery.goodProbes >= 2) {
          canvas.dataset.vfxLive = 'true';
          clearRecoveryNote('gpu-fallback');
          clearRecoveryNote('camera-waiting');
        }
      }

      return result;
    } catch (error) {
      recovery.goodProbes = 0;
      recovery.blackProbes += 1;
      canvas.dataset.vfxLive = 'false';
      const detail = error instanceof Error ? error.message : 'WebGL render error';
      console.error('[camera-recovery] VFX render failed; keeping camera preview alive.', error);
      showGpuFallbackNote(detail.slice(0, 120));
      return undefined;
    }
  };
}
