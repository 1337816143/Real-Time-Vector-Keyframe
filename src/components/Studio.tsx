import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Camera,
  CircleDot,
  FlipHorizontal,
  Gauge,
  Hand,
  Pause,
  Play,
  Radio,
  Repeat2,
  Rewind,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import EffectStackEditor from './EffectStackEditor';
import MotionTimeline from './MotionTimeline';
import ProjectControls from './ProjectControls';
import { CrossHandQuadController, cloneQuad, type QuadStatus } from '../engine/crossHandQuad';
import { CameraSession } from '../engine/cameraSession';
import { RecordingSession } from '../engine/recordingSession';
import { GestureController } from '../engine/gesture';
import { FaceTracker, type FaceStatus } from '../engine/faceTracking';
import { nextCyclePreset } from '../engine/presetSelection';
import { HandTracker } from '../engine/handTracking';
import { getSceneState } from '../engine/sceneStore';
import { sceneMotionRecorder } from '../engine/sceneMotion';
import { MotionRecorder } from '../engine/motion';
import { createProjectSnapshot, parseProject, stringifyProject } from '../engine/project';
import { VfxRenderer } from '../engine/renderer';
import { VectorTrail } from '../engine/trail';
import {
  DEFAULT_TRANSFORM,
  PRESETS,
  type EffectSettings,
  type EffectTransitionType,
  type EngineDebug,
  type MaskType,
  type PlaybackMode,
  type PresetId,
  type RenderState,
  type TemporalMode,
  type TrackingSnapshot,
  type TrailReleaseMode,
} from '../engine/types';

const PRESET_ORDER: PresetId[] = ['multiverse', 'spider', 'cyber', 'dream', 'time', 'freeze', 'slash'];
const TEMPORAL_MODES: TemporalMode[] = ['none', 'timeWindow', 'echo', 'afterImage'];
const TRAIL_MODES: TrailReleaseMode[] = ['hold', 'dissipate', 'close', 'expand', 'burst', 'shrink'];
const TRANSITIONS: EffectTransitionType[] = ['crossFade', 'directionalWipe', 'glitch', 'flash', 'liquid'];

const initialDebug: EngineDebug = {
  fps: 0,
  trackingFps: 0,
  state: 'IDLE',
  pinchDistance: 0,
  handSpeed: 0,
  mask: { ...DEFAULT_TRANSFORM },
  hands: 0,
  renderScale: 1,
  historyMs: 0,
};

function cloneEffects(effects: EffectSettings): EffectSettings {
  return {
    ...effects,
    effectStack: effects.effectStack.map((node) => ({ ...node })),
  };
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

function temporalLabel(mode: TemporalMode) {
  if (mode === 'timeWindow') return 'Time Window';
  if (mode === 'afterImage') return 'After Image';
  if (mode === 'echo') return 'Echo';
  return 'None';
}

function transitionLabel(type: EffectTransitionType) {
  if (type === 'crossFade') return 'Cross Fade';
  if (type === 'directionalWipe') return 'Wipe';
  if (type === 'glitch') return 'Glitch';
  if (type === 'flash') return 'Flash';
  return 'Liquid';
}

export default function Studio({ onExit, onModeChange }: { onExit: () => void; onModeChange: (advanced: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const altVideoRef = useRef<HTMLVideoElement>(null);
  const altImageRef = useRef<HTMLImageElement>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const cameraSessionRef = useRef(new CameraSession());
  const recordingSessionRef = useRef(new RecordingSession());
  const trackerRef = useRef<HandTracker>();
  const faceTrackerRef = useRef(new FaceTracker());
  const rendererRef = useRef<VfxRenderer>();
  const gestureRef = useRef(new GestureController(DEFAULT_TRANSFORM));
  const quadRef = useRef(new CrossHandQuadController());
  const quadScrubRef = useRef<RenderState['quad']>();
  const motionRef = useRef(new MotionRecorder());
  const trailRef = useRef(new VectorTrail());
  const snapshotRef = useRef<TrackingSnapshot>();
  const animationRef = useRef<number>();
  const objectUrlsRef = useRef<string[]>([]);
  const presetRef = useRef<PresetId>('multiverse');
  const debugVisibleRef = useRef(false);
  const tutorialStepRef = useRef(0);
  const mirrorRef = useRef(true);
  const maskTypeRef = useRef<MaskType>('crossHandQuad');
  const effectsRef = useRef<EffectSettings>(cloneEffects(PRESETS.multiverse.effects));
  const transitionTypeRef = useRef<EffectTransitionType>('crossFade');
  const transitionDurationRef = useRef(650);
  const altSourceRef = useRef<TexImageSource>();
  const frozenRef = useRef(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Starting camera…');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [mirror, setMirror] = useState(true);
  const [preset, setPreset] = useState<PresetId>('multiverse');
  const [maskType, setMaskType] = useState<MaskType>('crossHandQuad');
  const [effects, setEffects] = useState<EffectSettings>(() => cloneEffects(PRESETS.multiverse.effects));
  const [debugVisible, setDebugVisible] = useState(false);
  const [debug, setDebug] = useState<EngineDebug>(initialDebug);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string>();
  const [panel, setPanel] = useState<'mask' | 'effects' | 'gesture' | 'record' | 'settings'>('effects');
  const [panelOpen, setPanelOpen] = useState(true);
  const [faceUi, setFaceUi] = useState<{status:FaceStatus;message:string;inferenceMs?:number;delegate?:string}>({status:'off',message:''});
  const [quadPreview, setQuadPreview] = useState(false);
  const [quadStatus, setQuadStatus] = useState<QuadStatus>('waiting');
  const [trackingReady, setTrackingReady] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [trackingRetry, setTrackingRetry] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const [recordingMime, setRecordingMime] = useState('video/webm');
  const [tutorialStep, setTutorialStep] = useState(0);
  const [altMediaName, setAltMediaName] = useState('No alternate media');
  const [motionRecording, setMotionRecording] = useState(false);
  const [motionPlaying, setMotionPlaying] = useState(false);
  const [motionMode, setMotionMode] = useState<PlaybackMode>('loop');
  const [motionFrames, setMotionFrames] = useState(0);
  const [motionDuration, setMotionDuration] = useState(0);
  const [motionProgress, setMotionProgress] = useState(0);
  const [trailReleaseMode, setTrailReleaseMode] = useState<TrailReleaseMode>('dissipate');
  const [trailPoints, setTrailPoints] = useState(0);
  const [carouselEnabled, setCarouselEnabled] = useState(false);
  const [carouselInterval, setCarouselInterval] = useState(3500);
  const [transitionType, setTransitionType] = useState<EffectTransitionType>('crossFade');
  const [transitionDuration, setTransitionDuration] = useState(650);
  const [projectMessage, setProjectMessage] = useState('');

  const captureFreeze = useCallback(() => {
    const video = videoRef.current;
    const freeze = freezeCanvasRef.current;
    if (!video || video.readyState < 2) return;
    freeze.width = video.videoWidth;
    freeze.height = video.videoHeight;
    freeze.getContext('2d')?.drawImage(video, 0, 0);
    frozenRef.current = true;
  }, []);

  const applyPreset = useCallback((id: PresetId, direction: -1 | 1 = 1, animate = true) => {
    if(id==='spider'&&(sceneMotionRecorder.isRecording()||sceneMotionRecorder.isPlaying())){setRecordingError('请先停止场景运动录制或播放，再启用人脸面罩');return;}
    const next = PRESETS[id];
    const nextEffects = cloneEffects(next.effects);
    if (animate && id !== presetRef.current) {
      rendererRef.current?.beginTransition(
        transitionTypeRef.current,
        transitionDurationRef.current,
        direction,
      );
    }
    presetRef.current = id;
    const nextMask = id==='spider'||maskTypeRef.current === 'crossHandQuad' ? 'crossHandQuad' : next.mask;
    maskTypeRef.current = nextMask;
    effectsRef.current = nextEffects;
    setPreset(id);
    setMaskType(nextMask);
    setEffects(nextEffects);
    if (id === 'slash') trailRef.current.begin();
    if (id !== 'freeze') frozenRef.current = false;
    else if (nextMask === 'crossHandQuad') captureFreeze();
  }, [captureFreeze]);

  const cyclePreset = useCallback((direction: -1 | 1) => {
    applyPreset(nextCyclePreset(presetRef.current, direction), direction, true);
  }, [applyPreset]);

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    const video = videoRef.current;
    if (!video) return;
    if (recordingSessionRef.current.isRecording()) {
      recordingSessionRef.current.stop();
      setRecordingError('切换摄像头前已停止录制，片段会保留在录制预览中');
    }
    await cameraSessionRef.current.start(video, mode, (nextStatus, message) => {
      if (nextStatus === 'loading') {
        faceTrackerRef.current.dispose();
        quadRef.current.reset();
        quadScrubRef.current = undefined;
        setQuadPreview(false);
        trackerRef.current?.reset();
        snapshotRef.current = undefined;
        gestureRef.current = new GestureController(gestureRef.current.getTransform());
      }
      setStatus(nextStatus);
      setStatusMessage(message);
    });
  }, []);

  useEffect(() => { debugVisibleRef.current = debugVisible; }, [debugVisible]);
  useEffect(() => { tutorialStepRef.current = tutorialStep; }, [tutorialStep]);
  useEffect(() => {
    mirrorRef.current = mirror;
    trackerRef.current?.setMirrored(mirror);
    rendererRef.current?.setMirror(mirror);
  }, [mirror]);
  useEffect(() => { maskTypeRef.current = maskType; onModeChange(maskType !== 'crossHandQuad'); }, [maskType, onModeChange]);
  useEffect(() => { effectsRef.current = effects; }, [effects]);
  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => { trailRef.current.setReleaseMode(trailReleaseMode); }, [trailReleaseMode]);
  useEffect(() => { transitionTypeRef.current = transitionType; }, [transitionType]);
  useEffect(() => { transitionDurationRef.current = transitionDuration; }, [transitionDuration]);

  useEffect(() => {
    setMirror(true);
    void startCamera(facingMode);
  }, [facingMode, startCamera]);

  useEffect(() => {
    if (!carouselEnabled || status !== 'ready') return;
    const timer = window.setInterval(() => {
      if (!motionRef.current.isPlaying() && !motionRef.current.isRecording()) cyclePreset(1);
    }, Math.max(1200, carouselInterval));
    return () => window.clearInterval(timer);
  }, [carouselEnabled, carouselInterval, cyclePreset, status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    let disposed = false;
    let trackingFailed = false;
    let lastFpsUpdate = performance.now();
    let frames = 0;
    let fps = 60;
    let lastDebugUi = 0;
    let lowFpsSeconds = 0;
    let lastMotionProgress = 0;
    let lastLiveState: RenderState = {
      maskType: maskTypeRef.current,
      transform: { ...DEFAULT_TRANSFORM },
      effects: cloneEffects(effectsRef.current),
      gestureState: 'IDLE',
      handSpeed: 0,
      trail: trailRef.current.render(),
      time: performance.now(),
    };

    try {
      rendererRef.current = new VfxRenderer(canvas);
      rendererRef.current.setMirror(mirrorRef.current);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'WebGL2 initialization failed.');
      return;
    }

    setTrackingReady(false);
    setTrackingError('');
    snapshotRef.current = undefined;
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    quadRef.current.reset();
    gestureRef.current = new GestureController(gestureRef.current.getTransform());
    const tracker = new HandTracker();
    tracker.setMirrored(mirrorRef.current);
    trackerRef.current = tracker;
    tracker.init().then(() => {
      if (disposed) {
        tracker.close();
        return;
      }
      setTrackingReady(true);
      setTrackingError('');
    }).catch((error) => {
      console.error(error);
      if (!disposed) {
        trackingFailed = true;
        setTrackingReady(false);
        setTrackingError('手部模型加载失败，摄像头仍可使用。请检查网络后重试');
      }
    });

    const frame = (now: number) => {
      if (disposed) return;
      frames += 1;
      const renderer = rendererRef.current;
      const rect = canvas.getBoundingClientRect();
      tracker.setDisplayGeometry(video.videoWidth || 1, video.videoHeight || 1, rect.width, rect.height);
      let snapshot: TrackingSnapshot | null = null;
      try {
        snapshot = trackingFailed ? { hands: [], timestamp: now, trackingFps: 0 } : tracker.detect(video, now, 26);
      } catch (error) {
        console.error('[tracking] Detection failed; camera rendering continues.', error);
        trackingFailed = true;
        setTrackingReady(false);
        setTrackingError('手部追踪中断，请重试；摄像头仍可使用');
        tracker.close();
        snapshot = { hands: [], timestamp: now, trackingFps: 0 };
      }

      if (!snapshot && video.readyState < 2) snapshot = { hands: [], timestamp: now, trackingFps: 0 };
      if (snapshot) {
        snapshotRef.current = snapshot;
        quadRef.current.update(snapshot, rect.width / Math.max(1, rect.height));
        const isQuad = maskTypeRef.current === 'crossHandQuad';
        const gesture = isQuad
          ? { state: 'IDLE' as const, transform: gestureRef.current.getTransform(), handSpeed: Math.max(0, ...snapshot.hands.map((h) => h.speed)), swipe: 0 as const, pinchStarted: false, released: false, trailPoint: undefined, hoverPoint: undefined }
          : gestureRef.current.update(snapshot, maskTypeRef.current === 'trail', rect.width / Math.max(1, rect.height));
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

        if (!motionRef.current.isPlaying() && gesture.swipe) cyclePreset(gesture.swipe);
        if (gesture.pinchStarted && presetRef.current === 'freeze') captureFreeze();
        if (!motionRef.current.isPlaying() && gesture.pinchStarted && maskTypeRef.current === 'trail') trailRef.current.begin();
        if (!motionRef.current.isPlaying() && gesture.trailPoint && maskTypeRef.current === 'trail') trailRef.current.add(gesture.trailPoint, now);
        if (!motionRef.current.isPlaying() && gesture.released && maskTypeRef.current === 'trail') trailRef.current.release(now);
        if (presetRef.current === 'freeze') altSourceRef.current = frozenRef.current ? freezeCanvasRef.current : video;

        const baseEffects = effectsRef.current;
        lastLiveState = {
          maskType: maskTypeRef.current,
          transform: { ...gesture.transform },
          effects: {
            ...baseEffects,
            rgbSplit: baseEffects.rgbSplit * (1 + Math.min(2.2, gesture.handSpeed * 0.8)),
            distortion: baseEffects.distortion * (1 + Math.min(2.5, gesture.handSpeed)),
            effectStack: baseEffects.effectStack,
          },
          gestureState: gesture.state,
          handSpeed: gesture.handSpeed,
          trail: trailRef.current.render(now),
          hoverPoint: gesture.hoverPoint,
          time: now,
        };
      } else {
        const baseEffects = effectsRef.current;
        lastLiveState = {
          ...lastLiveState,
          maskType: maskTypeRef.current,
          effects: {
            ...baseEffects,
            rgbSplit: baseEffects.rgbSplit * (1 + Math.min(2.2, lastLiveState.handSpeed * 0.8)),
            distortion: baseEffects.distortion * (1 + Math.min(2.5, lastLiveState.handSpeed)),
            effectStack: baseEffects.effectStack,
          },
          trail: trailRef.current.render(now),
          time: now,
        };
      }

      if (maskTypeRef.current === 'crossHandQuad') {
        lastLiveState.quad = quadScrubRef.current ?? quadRef.current.sample(now);
        const points = lastLiveState.quad.points;
        if (points) lastLiveState.transform = { ...lastLiveState.transform, x: points.reduce((v,p)=>v+p.x,0)/4, y: points.reduce((v,p)=>v+p.y,0)/4 };
        lastLiveState.effects = { ...lastLiveState.effects, invertMask: false };
      } else lastLiveState.quad = undefined;
      motionRef.current.capture(lastLiveState, now);
      let renderState = lastLiveState;
      const playbackFrame = motionRef.current.sample(now);
      if (playbackFrame) {
        const progress = motionRef.current.getProgress(now);
        const wrapped = motionRef.current.isPlaying() && progress + 0.04 < lastMotionProgress;
        if (wrapped && playbackFrame.maskType === 'trail') trailRef.current.begin();
        lastMotionProgress = progress;
        if (playbackFrame.maskType === 'trail' && playbackFrame.interactionPoint && ['PINCH_START', 'GRABBED', 'DRAGGING'].includes(playbackFrame.gestureState)) {
          trailRef.current.add({
            ...playbackFrame.interactionPoint,
            width: Math.min(0.085, 0.022 + playbackFrame.handSpeed * 0.055),
          }, now);
        }
        renderState = {
          ...lastLiveState,
          maskType: playbackFrame.maskType,
          quad: cloneQuad(playbackFrame.quad),
          transform: { ...playbackFrame.transform },
          effects: cloneEffects(playbackFrame.effects),
          gestureState: playbackFrame.gestureState,
          handSpeed: playbackFrame.handSpeed,
          trail: playbackFrame.maskType === 'trail' ? trailRef.current.render(now) : lastLiveState.trail,
          hoverPoint: playbackFrame.interactionPoint,
          time: now,
        };
        if (!motionRef.current.isPlaying()) {
          gestureRef.current.setTransform(playbackFrame.transform);
          if (playbackFrame.maskType === 'trail') trailRef.current.release(now);
        }
      }

      let alternate: TexImageSource | undefined = altSourceRef.current;
      if (presetRef.current === 'freeze') alternate = frozenRef.current ? freezeCanvasRef.current : video;
      renderState = { ...renderState, alternateIsCamera: !alternate || alternate === video || alternate === freezeCanvasRef.current };
      const faceTracker=faceTrackerRef.current;
      const wantsFace=renderState.maskType==='crossHandQuad'&&renderState.effects.faceFx==='spider';
      faceTracker.setEnabled(wantsFace);
      if(wantsFace&&renderState.quad&&renderState.quad.opacity>0&&document.visibilityState!=='hidden')faceTracker.submit(video);
      renderState={...renderState,face:wantsFace?faceTracker.sample(performance.now(),rect.width,rect.height,mirrorRef.current):undefined};
      renderer?.render(video, alternate, renderState);
      if (recordingSessionRef.current.isRecording() && canvas.dataset.vfxLive !== 'true') {
        recordingSessionRef.current.stop();
        setRecordingError('特效画面已中断，已停止录制以避免录入静止或空白画面');
      }

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
        const hand = snapshotRef.current?.hands[0];
        setQuadStatus(renderState.quad?.status ?? 'waiting');
        setFaceUi({status:faceTracker.status,message:faceTracker.message,inferenceMs:faceTracker.inferenceMs,delegate:faceTracker.delegate});
        setDebug({
          fps,
          trackingFps: snapshotRef.current?.trackingFps ?? 0,
          state: renderState.gestureState,
          pinchDistance: hand?.normalizedPinchDistance ?? 0,
          handSpeed: renderState.handSpeed,
          mask: renderState.transform,
          hands: snapshotRef.current?.hands.length ?? 0,
          renderScale: renderer?.getRenderScale() ?? 1,
          historyMs: renderer?.getHistoryDepthMs(now) ?? 0,
        });
        const track = motionRef.current.getTrack();
        setMotionRecording(motionRef.current.isRecording());
        setMotionPlaying(motionRef.current.isPlaying());
        setMotionFrames(track?.keyframes.length ?? 0);
        setMotionDuration(track?.duration ?? 0);
        if (motionRef.current.isPlaying()) setMotionProgress(motionRef.current.getProgress(now));
        setTrailPoints(trailRef.current.getPointCount());
        lastDebugUi = now;
      }

      animationRef.current = requestAnimationFrame(frame);
    };

    animationRef.current = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      faceTrackerRef.current.dispose();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      tracker.close();
      rendererRef.current?.dispose();
      rendererRef.current = undefined;
      trackerRef.current = undefined;
    };
  }, [captureFreeze, cyclePreset, trackingRetry]);

  useEffect(() => () => {
    faceTrackerRef.current.dispose();
    cameraSessionRef.current.dispose();
    recordingSessionRef.current.dispose();
    if (sceneMotionRecorder.isRecording()) sceneMotionRecorder.stop(getSceneState().scene);
    sceneMotionRecorder.stopPlayback();
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
    if (!canvas || canvas.dataset.vfxLive !== 'true') {
      setRecordingError('当前为原始相机或画面尚未就绪。请恢复特效画面后录制');
      return;
    }
    setRecordingError('');
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(undefined);
    const started = recordingSessionRef.current.start(canvas, (blob) => {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      setRecordingMime(blob.type);
      setRecordingUrl(url);
      setRecording(false);
    }, (error) => {
      setRecording(false);
      setRecordingError(error instanceof Error ? error.message : '录制失败，请降低画质后重试');
    });
    setRecording(started);
  };

  const stopRecording = () => recordingSessionRef.current.stop();

  const startMotionRecording = () => {
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    motionRef.current.start();
    setMotionRecording(true);
    setMotionPlaying(false);
  };

  const stopMotionRecording = () => {
    const track = motionRef.current.stop();
    setMotionRecording(false);
    setMotionFrames(track?.keyframes.length ?? 0);
    setMotionDuration(track?.duration ?? 0);
    setMotionProgress(0);
  };

  const playMotion = (mode: PlaybackMode) => {
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    setMotionMode(mode);
    trailRef.current.clear();
    if (motionRef.current.play(mode)) setMotionPlaying(true);
  };

  const stopMotionPlayback = () => {
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    const frame = motionRef.current.sample();
    motionRef.current.stopPlayback();
    if (frame) gestureRef.current.setTransform(frame.transform);
    if (frame?.maskType === 'trail') trailRef.current.release();
    setMotionPlaying(false);
  };

  const clearMotion = () => {
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    motionRef.current.clear();
    setMotionRecording(false);
    setMotionPlaying(false);
    setMotionFrames(0);
    setMotionDuration(0);
    setMotionProgress(0);
  };

  const scrubMotion = (timeMs: number) => {
    const track = motionRef.current.getTrack();
    if (!track || track.duration <= 0) return;
    motionRef.current.stopPlayback();
    setMotionPlaying(false);
    const frame = motionRef.current.sampleAtTime(timeMs);
    if (!frame) return;

    gestureRef.current.setTransform(frame.transform);
    maskTypeRef.current = frame.maskType;
    setMaskType(frame.maskType);
    quadScrubRef.current = cloneQuad(frame.quad);
    setQuadPreview(frame.maskType === 'crossHandQuad');
    const scrubEffects = cloneEffects(frame.effects);
    effectsRef.current = scrubEffects;
    setEffects(scrubEffects);

    trailRef.current.clear();
    if (frame.maskType === 'trail') {
      for (const keyframe of track.keyframes) {
        if (keyframe.t > timeMs) break;
        if (keyframe.interactionPoint && ['PINCH_START', 'GRABBED', 'DRAGGING'].includes(keyframe.gestureState)) {
          trailRef.current.add({
            ...keyframe.interactionPoint,
            width: Math.min(0.085, 0.022 + keyframe.handSpeed * 0.055),
          }, keyframe.t);
        }
      }
    }
    setMotionProgress(Math.min(1, Math.max(0, timeMs / track.duration)));
  };

  const resetMask = () => {
    gestureRef.current.setTransform(DEFAULT_TRANSFORM);
    trailRef.current.clear();
  };

  const exportProject = () => {
    const project = createProjectSnapshot({
      preset: presetRef.current,
      mask: {
        type: maskTypeRef.current,
        transform: gestureRef.current.getTransform(),
        trailReleaseMode,
      },
      effects: cloneEffects(effectsRef.current),
      carousel: {
        enabled: carouselEnabled,
        intervalMs: carouselInterval,
        transitionType,
        transitionDurationMs: transitionDuration,
      },
      motion: motionRef.current.getTrack(),
    });
    const blob = new Blob([stringifyProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vector-keyframe-project-${Date.now()}.json`;
    anchor.click();
    setProjectMessage(`Project exported · ${project.motion?.keyframes.length ?? 0} motion keyframes`);
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const project = parseProject(await file.text());
      rendererRef.current?.beginTransition(
        project.carousel.transitionType,
        project.carousel.transitionDurationMs,
        1,
      );

      presetRef.current = project.preset;
      setPreset(project.preset);
      maskTypeRef.current = project.mask.type;
      setMaskType(project.mask.type);
      gestureRef.current.setTransform(project.mask.transform);
      trailRef.current.clear();
      trailRef.current.setReleaseMode(project.mask.trailReleaseMode);
      setTrailReleaseMode(project.mask.trailReleaseMode);

      const importedEffects = cloneEffects(project.effects);
      const needsExternalMedia = project.preset !== 'freeze' && importedEffects.useAlternateMedia;
      if (needsExternalMedia) importedEffects.useAlternateMedia = false;
      effectsRef.current = importedEffects;
      setEffects(importedEffects);
      quadScrubRef.current = undefined;
      setQuadPreview(false);
      quadRef.current.reset();
      altSourceRef.current = undefined;
      frozenRef.current = false;
      setAltMediaName(needsExternalMedia ? 'Re-select alternate media' : 'No alternate media');

      setCarouselEnabled(project.carousel.enabled);
      setCarouselInterval(project.carousel.intervalMs);
      transitionTypeRef.current = project.carousel.transitionType;
      transitionDurationRef.current = project.carousel.transitionDurationMs;
      setTransitionType(project.carousel.transitionType);
      setTransitionDuration(project.carousel.transitionDurationMs);

      const track = motionRef.current.loadTrack(project.motion);
      setMotionRecording(false);
      setMotionPlaying(false);
      setMotionFrames(track?.keyframes.length ?? 0);
      setMotionDuration(track?.duration ?? 0);
      setMotionProgress(0);

      setProjectMessage(
        needsExternalMedia
          ? `Loaded ${file.name}. Project restored; choose the alternate image/video again.`
          : `Loaded ${file.name}. Project state and motion track restored.`,
      );
    } catch (error) {
      console.error(error);
      setProjectMessage(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed: invalid project file');
    }
  };

  const selectMaskType = (type: MaskType) => {
    if (type === 'crossHandQuad' && (sceneMotionRecorder.isPlaying() || sceneMotionRecorder.isRecording())) {
      setRecordingError('请先停止场景运动录制或播放，再切换四指尖窗口');
      return;
    }
    quadScrubRef.current = undefined;
    setQuadPreview(false);
    setMaskType(type);
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

      <div className="interaction-status">
      <div className="interaction-mode glass-panel" aria-label="交互模式">
        <button className={maskType === 'crossHandQuad' ? 'selected' : ''} onClick={() => selectMaskType('crossHandQuad')}>双手四指尖窗口</button>
        <button className={maskType !== 'crossHandQuad' ? 'selected' : ''} onClick={() => selectMaskType('portal')}>高级蒙版 / 原有功能</button>
        {maskType === 'crossHandQuad' && !quadPreview && <small>{({waiting:'请伸出双手，张开食指与拇指',tracking:'四指尖已连接 · 特效仅在窗口内',holding:'短暂丢手 · 正在等待',lost:'追踪已过期 · 请把双手放回画面',invalid:'四边形交叉或过小 · 请重新展开'})[quadStatus]}</small>}
        {quadPreview && <button onClick={() => { quadScrubRef.current = undefined; setQuadPreview(false); }}>关键帧预览中 · 恢复实时跟手</button>}
      </div>
      {trackingError && (
        <div className="tracking-error glass-panel" role="status">
          <strong>{trackingError}</strong>
          <button onClick={() => setTrackingRetry((value) => value + 1)}>重试手部追踪</button>
        </div>
      )}
      {maskType !== 'crossHandQuad' && !trackingError && status !== 'error' && tutorialStep < 4 && (
        <div className="tutorial glass-panel"><span>0{tutorialStep + 1}</span><strong>{tutorialText}</strong><small>{trackingReady ? 'Hand tracking active' : 'Loading hand model…'}</small></div>
      )}

      {faceUi.status!=='off' && (
        <div className="face-status glass-panel" role="status">
          <strong>蜘蛛英雄面罩 · 单人脸</strong><span>{faceUi.message}</span>
          {faceUi.inferenceMs!=null && <small>后台推理 {faceUi.inferenceMs.toFixed(0)} ms · {faceUi.delegate??'本地'}（非端到端延迟）</small>}
          {faceUi.status==='error'&&<button onClick={()=>faceTrackerRef.current.reset()}>重试人脸追踪</button>}
        </div>
      )}
      </div>
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

      {recordingError && <div className="recording-warning glass-panel" role="alert">{recordingError}</div>}
      <aside className={`studio-panel glass-panel ${panelOpen ? 'open' : ''}`}>
        <div className="panel-heading">
          <div><span className="eyebrow">LIVE CONTROL</span><h2>{panel === 'mask' ? 'Mask' : panel === 'effects' ? 'Effects' : panel === 'gesture' ? 'Gesture + Motion' : panel === 'record' ? 'Record' : 'Settings'}</h2></div>
          <button className="icon-button subtle" onClick={() => setPanelOpen(false)}><X size={18} /></button>
        </div>

        {panel === 'effects' && (
          <>
            <div className="preset-grid">
              {PRESET_ORDER.map((id) => (
                <button key={id} className={`preset-button ${preset === id ? 'selected' : ''}`} onClick={() => applyPreset(id, 1, true)}>
                  <span>{PRESETS[id].label}</span><small>{id === 'slash' ? 'Trail' : PRESETS[id].mask}</small>
                </button>
              ))}
            </div>

            {preset==='spider' && <p className="panel-note">原创程序化2D/2.5D红色面罩、白色眼罩和蛛网，仅在脸部与四指尖窗口交集内显示。首次启用下载人脸模型，图像在浏览器本地处理，不上传人脸或摄像头帧。MediaPipe可能发送性能/使用统计。<a href="https://github.com/google-ai-edge/mediapipe#privacy-notice" target="_blank" rel="noreferrer"> SDK隐私说明</a></p>}
            <span className="eyebrow">EFFECT MODE · CAROUSEL</span>
            <Toggle label="Auto carousel" checked={carouselEnabled} onChange={setCarouselEnabled} />
            {carouselEnabled && <Range label="Carousel interval (ms)" value={carouselInterval} min={1500} max={10000} step={250} onChange={setCarouselInterval} />}
            <span className="eyebrow">PRESET TRANSITION</span>
            <div className="segmented-grid">
              {TRANSITIONS.map((type) => (
                <button key={type} className={transitionType === type ? 'selected' : ''} onClick={() => setTransitionType(type)}>{transitionLabel(type)}</button>
              ))}
            </div>
            <Range label="Transition duration (ms)" value={transitionDuration} min={120} max={1800} step={60} onChange={setTransitionDuration} />

            <label className="upload-row"><Upload size={16} /><span><strong>Alternate world</strong><small>{altMediaName}</small></span><input type="file" accept="image/*,video/*" onChange={(event) => handleAltMedia(event.target.files?.[0])} /></label>
            <Range label="RGB split amount" value={effects.rgbSplit} min={0} max={0.04} step={0.001} onChange={(value) => setEffects((e) => ({ ...e, rgbSplit: value }))} />
            <Range label="Ripple amount" value={effects.ripple} min={0} max={0.06} step={0.002} onChange={(value) => setEffects((e) => ({ ...e, ripple: value }))} />
            <Range label="Pixelate cells" value={effects.pixelate} min={0} max={120} step={4} onChange={(value) => setEffects((e) => ({ ...e, pixelate: value }))} />
            <Range label="Distortion amount" value={effects.distortion} min={0} max={0.06} step={0.002} onChange={(value) => setEffects((e) => ({ ...e, distortion: value }))} />
            <Range label="Edge glow" value={effects.glow} min={0} max={1.8} step={0.05} onChange={(value) => setEffects((e) => ({ ...e, glow: value }))} />

            <EffectStackEditor effects={effects} onChange={setEffects} />

            {preset === 'freeze' && <button className="secondary-button" onClick={captureFreeze}>冻结当前帧 / 更新冻结画面</button>}
            <span className="eyebrow">TEMPORAL FX</span>
            <div className="segmented-grid">
              {TEMPORAL_MODES.map((mode) => <button key={mode} className={effects.temporalMode === mode ? 'selected' : ''} onClick={() => setEffects((e) => ({ ...e, temporalMode: mode }))}>{temporalLabel(mode)}</button>)}
            </div>
            {effects.temporalMode !== 'none' && <Range label="History delay (ms)" value={effects.temporalDelayMs} min={150} max={2000} step={50} onChange={(value) => setEffects((e) => ({ ...e, temporalDelayMs: value }))} />}
            {(effects.temporalMode === 'echo' || effects.temporalMode === 'afterImage') && <Range label="Temporal mix" value={effects.temporalMix} min={0.05} max={1} step={0.05} onChange={(value) => setEffects((e) => ({ ...e, temporalMix: value }))} />}
            {maskType !== 'crossHandQuad' && <Toggle label="Invert mask" checked={effects.invertMask} onChange={(value) => setEffects((e) => ({ ...e, invertMask: value }))} />}
            <p className="panel-note">Manual preset changes, swipe changes and Carousel all snapshot the previous processed GPU texture first. The selected transition is rendered into the final canvas, so recordings include it.</p>
          </>
        )}

        {panel === 'mask' && (
          <>
            <div className="segmented-grid">{(['crossHandQuad', 'circle', 'blob', 'portal', 'trail'] as MaskType[]).map((type) => <button key={type} className={maskType === type ? 'selected' : ''} onClick={() => selectMaskType(type)}>{type}</button>)}</div>
            {maskType === 'trail' && (
              <>
                <span className="eyebrow">TRAIL RELEASE</span>
                <div className="segmented-grid">{TRAIL_MODES.map((mode) => <button key={mode} className={trailReleaseMode === mode ? 'selected' : ''} onClick={() => setTrailReleaseMode(mode)}>{mode}</button>)}</div>
                <Metric label="Raw trail points" value={String(trailPoints)} />
              </>
            )}
            <button className="secondary-button" onClick={resetMask}><RotateCcw size={16} /> Reset transform</button>
            <p className="panel-note">Vector Trail is smoothed before rendering. Release behavior can hold the crack, dissipate it, close from both ends, expand, burst outward, or shrink its width to zero.</p>
          </>
        )}

        {panel === 'gesture' && (
          <div className="telemetry-list">
            <Metric label="State" value={debug.state} />
            <Metric label="Hands" value={String(debug.hands)} />
            <Metric label="Pinch ratio" value={debug.pinchDistance.toFixed(2)} />
            <Metric label="Hand speed" value={debug.handSpeed.toFixed(2)} />
            <Metric label="History buffer" value={`${Math.round(debug.historyMs)} ms`} />
            <span className="eyebrow">MOTION KEYFRAMES</span>
            {!motionRecording ? <button className="secondary-button" onClick={startMotionRecording}><Radio size={16} /> Record motion</button> : <button className="record-button recording" onClick={stopMotionRecording}><Square size={16} fill="currentColor" /> Stop motion capture</button>}
            <Metric label="Keyframes" value={String(motionFrames)} />
            <Metric label="Duration" value={`${(motionDuration / 1000).toFixed(2)} s`} />
            <Metric label="Playback" value={motionPlaying ? `${motionMode} · ${Math.round(motionProgress * 100)}%` : 'stopped'} />
            <MotionTimeline
              track={motionRef.current.getTrack()}
              progress={motionProgress}
              playing={motionPlaying}
              onScrub={scrubMotion}
            />
            {motionFrames > 1 && (
              <>
                <div className="segmented-grid">
                  <button className={motionPlaying && motionMode === 'once' ? 'selected' : ''} onClick={() => playMotion('once')}><Play size={13} /> Once</button>
                  <button className={motionPlaying && motionMode === 'loop' ? 'selected' : ''} onClick={() => playMotion('loop')}><Repeat2 size={13} /> Loop</button>
                  <button className={motionPlaying && motionMode === 'reverse' ? 'selected' : ''} onClick={() => playMotion('reverse')}><Rewind size={13} /> Reverse</button>
                  <button className={motionPlaying && motionMode === 'pingpong' ? 'selected' : ''} onClick={() => playMotion('pingpong')}><RotateCcw size={13} /> Ping Pong</button>
                </div>
                {motionPlaying && <button className="secondary-button" onClick={stopMotionPlayback}><Pause size={16} /> Stop playback</button>}
                <button className="secondary-button" onClick={clearMotion}><Trash2 size={16} /> Clear motion</button>
              </>
            )}
            <p className="panel-note">Motion capture automatically creates sparse keyframes from transform, effect-stack, gesture-state and interaction-point changes. Scrubbing evaluates the same interpolation path as playback; Vector Slash reconstructs its crack up to the selected time.</p>
          </div>
        )}

        {panel === 'record' && (
          <div className="record-panel">
            {!recording ? <button className="record-button" onClick={startRecording}><Radio size={18} /> Start video recording</button> : <button className="record-button recording" onClick={stopRecording}><Square size={17} fill="currentColor" /> Stop recording</button>}
            {recordingUrl && <div className="record-preview"><video src={recordingUrl} controls playsInline /><a className="secondary-button" href={recordingUrl} download={`vector-keyframe-${Date.now()}.${recordingMime.includes('mp4') ? 'mp4' : 'webm'}`}>保存视频</a></div>}
            <p className="panel-note">Video recording captures only the final WebGL canvas: camera + historical/alternate layers + ordered effect passes + transitions + mask + edge VFX. Studio UI and debug overlays are excluded.</p>
          </div>
        )}

        {panel === 'settings' && (
          <div className="telemetry-list">
            <Toggle label="Mirror front camera" checked={mirror} onChange={setMirror} />
            <Metric label="Render scale" value={`${Math.round(debug.renderScale * 100)}%`} />
            <Metric label="Render FPS" value={String(debug.fps)} />
            <Metric label="Tracking FPS" value={String(debug.trackingFps)} />
            <Metric label="Temporal history" value={`${Math.round(debug.historyMs)} ms`} />
            <Toggle label="Tracking debug" checked={debugVisible} onChange={setDebugVisible} />
            <ProjectControls message={projectMessage} onExport={exportProject} onImport={importProject} />
          </div>
        )}
      </aside>

      {!panelOpen && <button className="panel-reopen glass-panel" onClick={() => setPanelOpen(true)}><Settings2 size={18} /><span>Controls</span></button>}

      {debugVisible && (
        <div className="debug-hud glass-panel"><div><span>RENDER</span><b>{debug.fps} FPS</b></div><div><span>TRACK</span><b>{debug.trackingFps} FPS</b></div><div><span>STATE</span><b>{debug.state}</b></div><div><span>PINCH</span><b>{debug.pinchDistance.toFixed(2)}</b></div><div><span>VELOCITY</span><b>{debug.handSpeed.toFixed(2)}</b></div><div><span>HISTORY</span><b>{Math.round(debug.historyMs)}ms</b></div><div><span>TRAIL</span><b>{trailPoints}</b></div><div><span>MASK</span><b>{debug.mask.x.toFixed(2)}, {debug.mask.y.toFixed(2)}</b></div></div>
      )}

      <nav className="studio-dock glass-panel" aria-label="Studio controls">
        <DockButton active={panel === 'mask' && panelOpen} icon={<CircleDot size={19} />} label="Mask" onClick={() => { setPanel('mask'); setPanelOpen(true); }} />
        <DockButton active={panel === 'effects' && panelOpen} icon={<Sparkles size={19} />} label="Effects" onClick={() => { setPanel('effects'); setPanelOpen(true); }} />
        <DockButton active={panel === 'gesture' && panelOpen} icon={<Hand size={19} />} label="Motion" onClick={() => { setPanel('gesture'); setPanelOpen(true); }} />
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
  return <label className="range-row"><span><b>{label}</b><code>{step >= 1 ? value.toFixed(0) : value.toFixed(3)}</code></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-row"><span>{label}</span><b>{value}</b></div>;
}
