import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Camera,
  CircleDot,
  FlipHorizontal,
  Gauge,
  Hand,
  Pause,
  Radio,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { GestureController } from '../engine/gesture';
import { HandTracker } from '../engine/handTracking';
import { VfxRenderer } from '../engine/renderer';
import {
  DEFAULT_TRANSFORM,
  PRESETS,
  type EffectSettings,
  type EngineDebug,
  type MaskType,
  type PresetId,
  type RenderState,
  type TrackingSnapshot,
} from '../engine/types';

const PRESET_ORDER: PresetId[] = ['multiverse', 'cyber', 'dream', 'freeze', 'slash'];

const initialDebug: EngineDebug = {
  fps: 0,
  trackingFps: 0,
  state: 'IDLE',
  pinchDistance: 0,
  handSpeed: 0,
  mask: { ...DEFAULT_TRANSFORM },
  hands: 0,
  renderScale: 1,
};

function supportedMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function mapRawLandmark(
  x: number,
  y: number,
  mirror: boolean,
  videoWidth: number,
  videoHeight: number,
  viewWidth: number,
  viewHeight: number,
) {
  const sourceAspect = videoWidth / Math.max(1, videoHeight);
  const viewAspect = viewWidth / Math.max(1, viewHeight);
  let px = mirror ? 1 - x : x;
  let py = y;
  if (sourceAspect > viewAspect) {
    const visibleFraction = viewAspect / sourceAspect;
    px = (px - 0.5) / visibleFraction + 0.5;
  } else {
    const visibleFraction = sourceAspect / viewAspect;
    py = (py - 0.5) / visibleFraction + 0.5;
  }
  return { x: px * viewWidth, y: py * viewHeight };
}

function drawTrackingDebug(
  canvas: HTMLCanvasElement,
  snapshot: TrackingSnapshot | undefined,
  video: HTMLVideoElement,
  mirror: boolean,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (!snapshot) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(142, 224, 255, .62)';
  ctx.fillStyle = 'rgba(216, 249, 255, .9)';
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
  ];
  for (const hand of snapshot.hands) {
    const points = hand.landmarks.map((landmark) =>
      mapRawLandmark(
        landmark.x,
        landmark.y,
        mirror,
        video.videoWidth || 1,
        video.videoHeight || 1,
        rect.width,
        rect.height,
      ),
    );
    ctx.beginPath();
    for (const [a, b] of connections) {
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
    }
    ctx.stroke();
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export default function Studio({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const altVideoRef = useRef<HTMLVideoElement>(null);
  const altImageRef = useRef<HTMLImageElement>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const streamRef = useRef<MediaStream>();
  const trackerRef = useRef<HandTracker>();
  const rendererRef = useRef<VfxRenderer>();
  const gestureRef = useRef(new GestureController(DEFAULT_TRANSFORM));
  const snapshotRef = useRef<TrackingSnapshot>();
  const animationRef = useRef<number>();
  const mediaRecorderRef = useRef<MediaRecorder>();
  const recordingChunksRef = useRef<Blob[]>([]);
  const objectUrlsRef = useRef<string[]>([]);
  const presetRef = useRef<PresetId>('multiverse');
  const debugVisibleRef = useRef(false);
  const tutorialStepRef = useRef(0);
  const mirrorRef = useRef(true);
  const maskTypeRef = useRef<MaskType>('portal');
  const effectsRef = useRef<EffectSettings>({ ...PRESETS.multiverse.effects });
  const trailRef = useRef<Array<{ x: number; y: number; width: number }>>([]);
  const lastTrailReleaseRef = useRef(0);
  const altSourceRef = useRef<TexImageSource>();
  const frozenRef = useRef(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Starting camera…');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [mirror, setMirror] = useState(true);
  const [preset, setPreset] = useState<PresetId>('multiverse');
  const [maskType, setMaskType] = useState<MaskType>('portal');
  const [effects, setEffects] = useState<EffectSettings>({ ...PRESETS.multiverse.effects });
  const [debugVisible, setDebugVisible] = useState(false);
  const [debug, setDebug] = useState<EngineDebug>(initialDebug);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string>();
  const [panel, setPanel] = useState<'mask' | 'effects' | 'gesture' | 'record' | 'settings'>('effects');
  const [panelOpen, setPanelOpen] = useState(true);
  const [trackingReady, setTrackingReady] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [altMediaName, setAltMediaName] = useState('No alternate media');

  const applyPreset = useCallback((id: PresetId) => {
    const next = PRESETS[id];
    presetRef.current = id;
    maskTypeRef.current = next.mask;
    effectsRef.current = { ...next.effects };
    setPreset(id);
    setMaskType(next.mask);
    setEffects({ ...next.effects });
    if (id === 'slash') trailRef.current = [];
    if (id !== 'freeze') frozenRef.current = false;
  }, []);

  const cyclePreset = useCallback((direction: -1 | 1) => {
    const current = PRESET_ORDER.indexOf(presetRef.current);
    const nextIndex = (current + direction + PRESET_ORDER.length) % PRESET_ORDER.length;
    applyPreset(PRESET_ORDER[nextIndex]);
  }, [applyPreset]);

  const captureFreeze = useCallback(() => {
    const video = videoRef.current;
    const freeze = freezeCanvasRef.current;
    if (!video || video.readyState < 2) return;
    freeze.width = video.videoWidth;
    freeze.height = video.videoHeight;
    freeze.getContext('2d')?.drawImage(video, 0, 0);
    frozenRef.current = true;
  }, []);

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    const video = videoRef.current;
    if (!video) return;
    setStatus('loading');
    setStatusMessage('Requesting camera access…');
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setStatus('ready');
      setStatusMessage('Camera ready');
    } catch (error) {
      console.error(error);
      setStatus('error');
      setStatusMessage(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Enable camera access and reload the Studio.'
        : 'Unable to open the camera. It may be unavailable or in use by another app.');
    }
  }, []);

  useEffect(() => {
    debugVisibleRef.current = debugVisible;
  }, [debugVisible]);

  useEffect(() => {
    tutorialStepRef.current = tutorialStep;
  }, [tutorialStep]);

  useEffect(() => {
    mirrorRef.current = mirror;
    trackerRef.current?.setMirrored(mirror);
    rendererRef.current?.setMirror(mirror);
  }, [mirror]);

  useEffect(() => {
    maskTypeRef.current = maskType;
  }, [maskType]);

  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    setMirror(facingMode === 'user');
    void startCamera(facingMode);
  }, [facingMode, startCamera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    let disposed = false;
    let lastFpsUpdate = performance.now();
    let frames = 0;
    let fps = 60;
    let lastDebugUi = 0;
    let lowFpsSeconds = 0;

    try {
      rendererRef.current = new VfxRenderer(canvas);
      rendererRef.current.setMirror(mirrorRef.current);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'WebGL2 initialization failed.');
      return;
    }

    const tracker = new HandTracker();
    tracker.setMirrored(mirrorRef.current);
    trackerRef.current = tracker;
    tracker.init().then(() => {
      if (disposed) {
        tracker.close();
        return;
      }
      setTrackingReady(true);
    }).catch((error) => {
      console.error(error);
      if (!disposed) setTrackingReady(false);
    });

    const frame = (now: number) => {
      if (disposed) return;
      frames += 1;
      const renderer = rendererRef.current;
      const rect = canvas.getBoundingClientRect();
      tracker.setDisplayGeometry(video.videoWidth || 1, video.videoHeight || 1, rect.width, rect.height);
      const snapshot = tracker.detect(video, now, 26);
      if (snapshot) {
        snapshotRef.current = snapshot;
        const gesture = gestureRef.current.update(snapshot, maskTypeRef.current === 'trail', rect.width / Math.max(1, rect.height));
        const advanceTutorial = (next: number) => {
          if (next > tutorialStepRef.current) {
            tutorialStepRef.current = next;
            setTutorialStep(next);
          }
        };
        if (tutorialStepRef.current === 0 && snapshot.hands.length) advanceTutorial(1);
        if (tutorialStepRef.current <= 1 && gesture.pinchStarted) advanceTutorial(2);
        if (tutorialStepRef.current <= 2 && gesture.state === 'DRAGGING') advanceTutorial(3);
        if (tutorialStepRef.current <= 3 && gesture.released) advanceTutorial(4);

        if (gesture.swipe) cyclePreset(gesture.swipe);
        if (gesture.pinchStarted && presetRef.current === 'freeze') captureFreeze();
        if (gesture.pinchStarted && maskTypeRef.current === 'trail') trailRef.current = [];
        if (gesture.trailPoint && maskTypeRef.current === 'trail') {
          const trail = trailRef.current;
          const previous = trail[trail.length - 1];
          if (!previous || Math.hypot(previous.x - gesture.trailPoint.x, previous.y - gesture.trailPoint.y) > 0.012) {
            trail.push(gesture.trailPoint);
            if (trail.length > 48) trail.shift();
          }
        }
        if (gesture.released && maskTypeRef.current === 'trail') lastTrailReleaseRef.current = now;

        const currentPreset = presetRef.current;
        const currentEffects = effectsRef.current;
        if (currentPreset === 'freeze') {
          altSourceRef.current = frozenRef.current ? freezeCanvasRef.current : video;
        }

        const renderState: RenderState = {
          maskType: maskTypeRef.current,
          transform: gesture.transform,
          effects: {
            ...currentEffects,
            rgbSplit: currentEffects.rgbSplit * (1 + Math.min(2.2, gesture.handSpeed * 0.8)),
            distortion: currentEffects.distortion * (1 + Math.min(2.5, gesture.handSpeed)),
          },
          gestureState: gesture.state,
          handSpeed: gesture.handSpeed,
          trail: trailRef.current,
          hoverPoint: gesture.hoverPoint,
          time: now,
        };
        (frame as unknown as { state?: RenderState }).state = renderState;
      }

      if (maskTypeRef.current === 'trail' && lastTrailReleaseRef.current && now - lastTrailReleaseRef.current > 1200 && trailRef.current.length > 1) {
        trailRef.current.shift();
      }

      const lastState = (frame as unknown as { state?: RenderState }).state ?? {
        maskType: maskTypeRef.current,
        transform: { ...DEFAULT_TRANSFORM },
        effects: effectsRef.current,
        gestureState: 'IDLE',
        handSpeed: 0,
        trail: trailRef.current,
        time: now,
      } as RenderState;
      lastState.time = now;
      lastState.maskType = maskTypeRef.current;
      const baseEffects = effectsRef.current;
      lastState.effects = {
        ...baseEffects,
        rgbSplit: baseEffects.rgbSplit * (1 + Math.min(2.2, lastState.handSpeed * 0.8)),
        distortion: baseEffects.distortion * (1 + Math.min(2.5, lastState.handSpeed)),
      };
      lastState.trail = trailRef.current;

      let alternate: TexImageSource | undefined = altSourceRef.current;
      if (presetRef.current === 'freeze') alternate = frozenRef.current ? freezeCanvasRef.current : video;
      renderer?.render(video, alternate, lastState);

      if (debugVisibleRef.current && debugCanvasRef.current) drawTrackingDebug(debugCanvasRef.current, snapshotRef.current, video, mirrorRef.current);
      else if (debugCanvasRef.current) debugCanvasRef.current.getContext('2d')?.clearRect(0, 0, debugCanvasRef.current.width, debugCanvasRef.current.height);

      if (now - lastFpsUpdate >= 1000) {
        fps = Math.round((frames * 1000) / (now - lastFpsUpdate));
        frames = 0;
        lastFpsUpdate = now;
        if (fps < 43) lowFpsSeconds += 1;
        else lowFpsSeconds = Math.max(0, lowFpsSeconds - 1);
        if (lowFpsSeconds >= 3 && renderer) {
          const current = renderer.getRenderScale();
          renderer.setRenderScale(current > 0.82 ? 0.8 : current > 0.68 ? 0.65 : 0.55);
          lowFpsSeconds = 0;
        } else if (fps > 57 && renderer && renderer.getRenderScale() < 1) {
          renderer.setRenderScale(Math.min(1, renderer.getRenderScale() + 0.05));
        }
      }

      if (now - lastDebugUi > 180) {
        const state = (frame as unknown as { state?: RenderState }).state ?? lastState;
        const hand = snapshotRef.current?.hands[0];
        setDebug({
          fps,
          trackingFps: snapshotRef.current?.trackingFps ?? 0,
          state: state.gestureState,
          pinchDistance: hand?.normalizedPinchDistance ?? 0,
          handSpeed: hand?.speed ?? 0,
          mask: state.transform,
          hands: snapshotRef.current?.hands.length ?? 0,
          renderScale: renderer?.getRenderScale() ?? 1,
        });
        lastDebugUi = now;
      }

      animationRef.current = requestAnimationFrame(frame);
    };

    animationRef.current = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      tracker.close();
      rendererRef.current?.dispose();
      rendererRef.current = undefined;
      trackerRef.current = undefined;
    };
  }, [captureFreeze, cyclePreset]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const handleAltMedia = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    setAltMediaName(file.name);
    if (file.type.startsWith('video/')) {
      const video = altVideoRef.current;
      if (!video) return;
      video.src = url;
      video.loop = true;
      video.muted = true;
      void video.play();
      altSourceRef.current = video;
    } else if (file.type.startsWith('image/')) {
      const image = altImageRef.current;
      if (!image) return;
      image.onload = () => { altSourceRef.current = image; };
      image.src = url;
    }
    setEffects((current) => ({ ...current, useAlternateMedia: true }));
  };

  const startRecording = () => {
    const canvas = canvasRef.current;
    if (!canvas || !('captureStream' in canvas) || typeof MediaRecorder === 'undefined') return;
    recordingChunksRef.current = [];
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(undefined);
    const stream = canvas.captureStream(60);
    const mimeType = supportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 12_000_000 } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      setRecordingUrl(url);
      setRecording(false);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start(250);
    mediaRecorderRef.current = recorder;
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
  };

  const resetMask = () => {
    gestureRef.current.setTransform(DEFAULT_TRANSFORM);
    trailRef.current = [];
  };

  const statusClass = status === 'ready' ? 'ok' : status === 'error' ? 'bad' : 'loading';
  const tutorialText = useMemo(() => [
    'Show your hand',
    'Pinch thumb + index finger',
    'Move your hand',
    'Release',
    'Gesture control ready',
  ][tutorialStep], [tutorialStep]);

  return (
    <main className="studio-shell">
      <video ref={videoRef} className="source-media" playsInline muted />
      <video ref={altVideoRef} className="source-media" playsInline muted loop />
      <img ref={altImageRef} className="source-media" alt="" />
      <canvas ref={canvasRef} className="vfx-canvas" />
      <canvas ref={debugCanvasRef} className="tracking-canvas" />

      <header className="studio-topbar glass-panel">
        <button className="brand-button" onClick={onExit} aria-label="Exit studio">
          <span className="brand-mark"><CircleDot size={17} /></span>
          <span>VECTOR KEYFRAME</span>
        </button>
        <div className="topbar-center">
          <span className={`status-pill ${statusClass}`}><i />{statusMessage}</span>
          <span className="privacy-pill">LOCAL CAMERA</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => setMirror((value) => !value)} title="Mirror camera"><FlipHorizontal size={18} /></button>
          <button className="icon-button" onClick={() => setFacingMode((value) => value === 'user' ? 'environment' : 'user')} title="Switch camera"><Camera size={18} /></button>
          <button className={`icon-button ${debugVisible ? 'active' : ''}`} onClick={() => setDebugVisible((value) => !value)} title="Debug HUD"><Gauge size={18} /></button>
        </div>
      </header>

      {status === 'error' && (
        <section className="fatal-card glass-panel">
          <Camera size={26} /><h2>Camera / renderer unavailable</h2><p>{statusMessage}</p>
          <button className="primary-button" onClick={() => void startCamera(facingMode)}>Try again</button>
        </section>
      )}

      {status !== 'error' && tutorialStep < 4 && (
        <div className="tutorial glass-panel"><span>0{tutorialStep + 1}</span><strong>{tutorialText}</strong><small>{trackingReady ? 'Hand tracking active' : 'Loading hand model…'}</small></div>
      )}

      <aside className={`studio-panel glass-panel ${panelOpen ? 'open' : ''}`}>
        <div className="panel-heading">
          <div><span className="eyebrow">LIVE CONTROL</span><h2>{panel === 'mask' ? 'Mask' : panel === 'effects' ? 'Effects' : panel === 'gesture' ? 'Gesture' : panel === 'record' ? 'Record' : 'Settings'}</h2></div>
          <button className="icon-button subtle" onClick={() => setPanelOpen(false)}><X size={18} /></button>
        </div>

        {panel === 'effects' && (
          <>
            <div className="preset-grid">
              {PRESET_ORDER.map((id) => (
                <button key={id} className={`preset-button ${preset === id ? 'selected' : ''}`} onClick={() => applyPreset(id)}>
                  <span>{PRESETS[id].label}</span><small>{id === 'slash' ? 'Trail' : PRESETS[id].mask}</small>
                </button>
              ))}
            </div>
            <label className="upload-row"><Upload size={16} /><span><strong>Alternate world</strong><small>{altMediaName}</small></span><input type="file" accept="image/*,video/*" onChange={(event) => handleAltMedia(event.target.files?.[0])} /></label>
            <Range label="RGB split" value={effects.rgbSplit} min={0} max={0.04} step={0.001} onChange={(value) => setEffects((e) => ({ ...e, rgbSplit: value }))} />
            <Range label="Ripple" value={effects.ripple} min={0} max={0.06} step={0.002} onChange={(value) => setEffects((e) => ({ ...e, ripple: value }))} />
            <Range label="Pixelate" value={effects.pixelate} min={0} max={120} step={4} onChange={(value) => setEffects((e) => ({ ...e, pixelate: value }))} />
            <Range label="Edge glow" value={effects.glow} min={0} max={1.8} step={0.05} onChange={(value) => setEffects((e) => ({ ...e, glow: value }))} />
            <Toggle label="Invert mask" checked={effects.invertMask} onChange={(value) => setEffects((e) => ({ ...e, invertMask: value }))} />
          </>
        )}

        {panel === 'mask' && (
          <>
            <div className="segmented-grid">{(['circle', 'blob', 'portal', 'trail'] as MaskType[]).map((type) => <button key={type} className={maskType === type ? 'selected' : ''} onClick={() => setMaskType(type)}>{type}</button>)}</div>
            <button className="secondary-button" onClick={resetMask}><RotateCcw size={16} /> Reset transform</button>
            <p className="panel-note">Pinch near the mask to grab it. With two hands visible, keep pinching and change hand distance/angle to scale and rotate.</p>
          </>
        )}

        {panel === 'gesture' && (
          <div className="telemetry-list"><Metric label="State" value={debug.state} /><Metric label="Hands" value={String(debug.hands)} /><Metric label="Pinch ratio" value={debug.pinchDistance.toFixed(2)} /><Metric label="Hand speed" value={debug.handSpeed.toFixed(2)} /><p className="panel-note">Pinch ON &lt; 0.38 palm widths · OFF &gt; 0.52. Tracking is intentionally slower than rendering; interpolation keeps the VFX motion smooth.</p></div>
        )}

        {panel === 'record' && (
          <div className="record-panel">
            {!recording ? <button className="record-button" onClick={startRecording}><Radio size={18} /> Start recording</button> : <button className="record-button recording" onClick={stopRecording}><Square size={17} fill="currentColor" /> Stop recording</button>}
            {recordingUrl && <div className="record-preview"><video src={recordingUrl} controls playsInline /><a className="secondary-button" href={recordingUrl} download={`vector-keyframe-${Date.now()}.webm`}>Save WebM</a></div>}
            <p className="panel-note">Recording captures only the final WebGL canvas: camera + mask + effects. Studio UI and debug overlays are excluded.</p>
          </div>
        )}

        {panel === 'settings' && (
          <div className="telemetry-list"><Toggle label="Mirror front camera" checked={mirror} onChange={setMirror} /><Metric label="Render scale" value={`${Math.round(debug.renderScale * 100)}%`} /><Metric label="Render FPS" value={String(debug.fps)} /><Metric label="Tracking FPS" value={String(debug.trackingFps)} /><Toggle label="Tracking debug" checked={debugVisible} onChange={setDebugVisible} /></div>
        )}
      </aside>

      {!panelOpen && <button className="panel-reopen glass-panel" onClick={() => setPanelOpen(true)}><Settings2 size={18} /><span>Controls</span></button>}

      {debugVisible && (
        <div className="debug-hud glass-panel"><div><span>RENDER</span><b>{debug.fps} FPS</b></div><div><span>TRACK</span><b>{debug.trackingFps} FPS</b></div><div><span>STATE</span><b>{debug.state}</b></div><div><span>PINCH</span><b>{debug.pinchDistance.toFixed(2)}</b></div><div><span>VELOCITY</span><b>{debug.handSpeed.toFixed(2)}</b></div><div><span>MASK</span><b>{debug.mask.x.toFixed(2)}, {debug.mask.y.toFixed(2)}</b></div></div>
      )}

      <nav className="studio-dock glass-panel" aria-label="Studio controls">
        <DockButton active={panel === 'mask' && panelOpen} icon={<CircleDot size={19} />} label="Mask" onClick={() => { setPanel('mask'); setPanelOpen(true); }} />
        <DockButton active={panel === 'effects' && panelOpen} icon={<Sparkles size={19} />} label="Effects" onClick={() => { setPanel('effects'); setPanelOpen(true); }} />
        <DockButton active={panel === 'gesture' && panelOpen} icon={<Hand size={19} />} label="Gesture" onClick={() => { setPanel('gesture'); setPanelOpen(true); }} />
        <button className={`dock-record ${recording ? 'active' : ''}`} onClick={recording ? stopRecording : startRecording} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square size={17} fill="currentColor" /> : <span />}</button>
        <DockButton active={panel === 'record' && panelOpen} icon={recording ? <Pause size={19} /> : <Video size={19} />} label="Record" onClick={() => { setPanel('record'); setPanelOpen(true); }} />
        <DockButton active={panel === 'settings' && panelOpen} icon={<Settings2 size={19} />} label="Settings" onClick={() => { setPanel('settings'); setPanelOpen(true); }} />
      </nav>
    </main>
  );
}

function DockButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`dock-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="range-row"><span><b>{label}</b><code>{value.toFixed(step < 1 ? 3 : 0)}</code></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-row"><span>{label}</span><b>{value}</b></div>;
}
