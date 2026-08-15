import { cloneCurve } from './bezier';
import { cloneMaskNode, cloneScene, type MaskSceneGraph, type SceneMaskGeometry, type SceneMaskNode } from './scene';
import type { EffectSettings, MaskTransform, PlaybackMode } from './types';

export type SceneMotionEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface SceneMotionKeyframe {
  t: number;
  node: SceneMaskNode;
  easing?: SceneMotionEasing;
}

export interface SceneMotionLane {
  maskId: string;
  name: string;
  keyframes: SceneMotionKeyframe[];
}

export interface SceneMotionTrack {
  version: 1;
  duration: number;
  template: MaskSceneGraph;
  lanes: SceneMotionLane[];
}

export interface SceneMotionPlaybackRange {
  inMs: number;
  outMs: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function applyEasing(t: number, easing: SceneMotionEasing = 'linear') {
  const x = clamp01(t);
  if (easing === 'easeIn') return x * x;
  if (easing === 'easeOut') return 1 - (1 - x) * (1 - x);
  if (easing === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  return x;
}

function lerpAngle(a: number, b: number, t: number) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function cloneEffects(effects: EffectSettings): EffectSettings {
  return {
    ...effects,
    effectStack: effects.effectStack.map((node) => ({ ...node })),
  };
}

function interpolateTransform(a: MaskTransform, b: MaskTransform, t: number): MaskTransform {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    scale: lerp(a.scale, b.scale, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
  };
}

function compatibleStack(a: EffectSettings, b: EffectSettings) {
  return a.effectStack.length === b.effectStack.length
    && a.effectStack.every((node, index) => node.id === b.effectStack[index]?.id && node.type === b.effectStack[index]?.type);
}

function interpolateEffects(a: EffectSettings, b: EffectSettings, t: number): EffectSettings {
  const near = t < 0.5 ? a : b;
  const stack = compatibleStack(a, b)
    ? a.effectStack.map((node, index) => {
        const next = b.effectStack[index];
        return {
          ...node,
          enabled: t < 0.5 ? node.enabled : next.enabled,
          intensity: lerp(node.intensity, next.intensity, t),
          opacity: lerp(node.opacity, next.opacity, t),
          blendMode: t < 0.5 ? node.blendMode : next.blendMode,
        };
      })
    : near.effectStack.map((node) => ({ ...node }));

  return {
    rgbSplit: lerp(a.rgbSplit, b.rgbSplit, t),
    ripple: lerp(a.ripple, b.ripple, t),
    pixelate: lerp(a.pixelate, b.pixelate, t),
    distortion: lerp(a.distortion, b.distortion, t),
    glow: lerp(a.glow, b.glow, t),
    invertMask: t < 0.5 ? a.invertMask : b.invertMask,
    useAlternateMedia: t < 0.5 ? a.useAlternateMedia : b.useAlternateMedia,
    temporalMode: t < 0.5 ? a.temporalMode : b.temporalMode,
    temporalDelayMs: lerp(a.temporalDelayMs, b.temporalDelayMs, t),
    temporalMix: lerp(a.temporalMix, b.temporalMix, t),
    effectStack: stack,
  };
}

function compatibleCustomGeometry(a: SceneMaskGeometry, b: SceneMaskGeometry) {
  return a.kind === 'custom'
    && b.kind === 'custom'
    && a.curve.anchors.length === b.curve.anchors.length
    && a.curve.anchors.every((anchor, index) => anchor.id === b.curve.anchors[index]?.id);
}

function interpolateGeometry(a: SceneMaskGeometry, b: SceneMaskGeometry, t: number): SceneMaskGeometry {
  if (!compatibleCustomGeometry(a, b)) {
    const source = t < 0.5 ? a : b;
    if (source.kind !== 'custom') return { kind: source.kind };
    return {
      kind: 'custom',
      curve: cloneCurve(source.curve),
      feather: source.feather,
      expansion: source.expansion,
    };
  }

  const left = a as Extract<SceneMaskGeometry, { kind: 'custom' }>;
  const right = b as Extract<SceneMaskGeometry, { kind: 'custom' }>;
  return {
    kind: 'custom',
    feather: lerp(left.feather, right.feather, t),
    expansion: lerp(left.expansion, right.expansion, t),
    curve: {
      version: 1,
      closed: true,
      anchors: left.curve.anchors.map((anchor, index) => {
        const next = right.curve.anchors[index];
        return {
          id: anchor.id,
          linked: t < 0.5 ? anchor.linked : next.linked,
          point: {
            x: lerp(anchor.point.x, next.point.x, t),
            y: lerp(anchor.point.y, next.point.y, t),
          },
          handleIn: {
            x: lerp(anchor.handleIn.x, next.handleIn.x, t),
            y: lerp(anchor.handleIn.y, next.handleIn.y, t),
          },
          handleOut: {
            x: lerp(anchor.handleOut.x, next.handleOut.x, t),
            y: lerp(anchor.handleOut.y, next.handleOut.y, t),
          },
        };
      }),
    },
  };
}

function interpolateNode(a: SceneMaskNode, b: SceneMaskNode, t: number): SceneMaskNode {
  return {
    id: a.id,
    name: t < 0.5 ? a.name : b.name,
    visible: t < 0.5 ? a.visible : b.visible,
    locked: t < 0.5 ? a.locked : b.locked,
    transform: interpolateTransform(a.transform, b.transform, t),
    geometry: interpolateGeometry(a.geometry, b.geometry, t),
    effects: interpolateEffects(a.effects, b.effects, t),
  };
}

function geometryChanged(a: SceneMaskGeometry, b: SceneMaskGeometry) {
  if (a.kind !== b.kind) return true;
  if (a.kind !== 'custom' || b.kind !== 'custom') return false;
  if (Math.abs(a.feather - b.feather) > 0.0005 || Math.abs(a.expansion - b.expansion) > 0.002) return true;
  if (a.curve.anchors.length !== b.curve.anchors.length) return true;
  return a.curve.anchors.some((anchor, index) => {
    const next = b.curve.anchors[index];
    if (!next || anchor.id !== next.id || anchor.linked !== next.linked) return true;
    return Math.hypot(anchor.point.x - next.point.x, anchor.point.y - next.point.y) > 0.004
      || Math.hypot(anchor.handleIn.x - next.handleIn.x, anchor.handleIn.y - next.handleIn.y) > 0.006
      || Math.hypot(anchor.handleOut.x - next.handleOut.x, anchor.handleOut.y - next.handleOut.y) > 0.006;
  });
}

function effectsChanged(a: EffectSettings, b: EffectSettings) {
  const amount = Math.abs(a.rgbSplit - b.rgbSplit)
    + Math.abs(a.ripple - b.ripple)
    + Math.abs(a.distortion - b.distortion)
    + Math.abs(a.pixelate - b.pixelate) * 0.001
    + Math.abs(a.glow - b.glow) * 0.01
    + Math.abs(a.temporalMix - b.temporalMix) * 0.01
    + Math.abs(a.temporalDelayMs - b.temporalDelayMs) * 0.00001;
  if (amount > 0.001) return true;
  if (a.invertMask !== b.invertMask || a.useAlternateMedia !== b.useAlternateMedia || a.temporalMode !== b.temporalMode) return true;
  return JSON.stringify(a.effectStack) !== JSON.stringify(b.effectStack);
}

function meaningfulNodeChange(a: SceneMaskNode, b: SceneMaskNode) {
  const position = Math.hypot(a.transform.x - b.transform.x, a.transform.y - b.transform.y);
  const scale = Math.abs(a.transform.scale - b.transform.scale);
  const rotation = Math.abs(a.transform.rotation - b.transform.rotation);
  return position > 0.004
    || scale > 0.004
    || rotation > 0.018
    || a.visible !== b.visible
    || a.locked !== b.locked
    || geometryChanged(a.geometry, b.geometry)
    || effectsChanged(a.effects, b.effects);
}

function cloneTrack(track: SceneMotionTrack): SceneMotionTrack {
  return {
    version: 1,
    duration: track.duration,
    template: cloneScene(track.template),
    lanes: track.lanes.map((lane) => ({
      maskId: lane.maskId,
      name: lane.name,
      keyframes: lane.keyframes.map((frame) => ({
        t: frame.t,
        node: cloneMaskNode(frame.node),
        easing: frame.easing ?? 'linear',
      })),
    })),
  };
}

function sampleLane(lane: SceneMotionLane, time: number): SceneMaskNode | undefined {
  const frames = lane.keyframes;
  if (!frames.length) return undefined;
  if (frames.length === 1 || time <= frames[0].t) return cloneMaskNode(frames[0].node);
  if (time >= frames[frames.length - 1].t) return cloneMaskNode(frames[frames.length - 1].node);
  const right = frames.findIndex((frame) => frame.t >= time);
  if (right <= 0) return cloneMaskNode(frames[0].node);
  const a = frames[right - 1];
  const b = frames[right];
  const span = Math.max(1, b.t - a.t);
  const mix = applyEasing((time - a.t) / span, a.easing ?? 'linear');
  return interpolateNode(a.node, b.node, mix);
}

export class SceneMotionRecorder {
  private recording = false;
  private playing = false;
  private recordStartedAt = 0;
  private playbackStartedAt = 0;
  private playbackMode: PlaybackMode = 'loop';
  private template?: MaskSceneGraph;
  private working = new Map<string, SceneMotionLane>();
  private lastCaptureAt = new Map<string, number>();
  private track?: SceneMotionTrack;
  private playbackRange: SceneMotionPlaybackRange = { inMs: 0, outMs: 0 };

  start(scene: MaskSceneGraph, now = performance.now()) {
    this.recording = true;
    this.playing = false;
    this.track = undefined;
    this.recordStartedAt = now;
    this.template = cloneScene(scene);
    this.working.clear();
    this.lastCaptureAt.clear();
    this.playbackRange = { inMs: 0, outMs: 0 };
    for (const node of scene.nodes) {
      this.working.set(node.id, {
        maskId: node.id,
        name: node.name,
        keyframes: [{ t: 0, node: cloneMaskNode(node), easing: 'linear' }],
      });
      this.lastCaptureAt.set(node.id, now);
    }
  }

  capture(scene: MaskSceneGraph, now = performance.now()) {
    if (!this.recording || !this.template) return;
    const t = Math.max(0, now - this.recordStartedAt);
    for (const templateNode of this.template.nodes) {
      const node = scene.nodes.find((item) => item.id === templateNode.id);
      const lane = this.working.get(templateNode.id);
      if (!node || !lane) continue;
      const previous = lane.keyframes[lane.keyframes.length - 1]?.node;
      const elapsed = now - (this.lastCaptureAt.get(node.id) ?? -Infinity);
      if (!previous || elapsed >= 180 || (elapsed >= 32 && meaningfulNodeChange(previous, node))) {
        lane.keyframes.push({ t, node: cloneMaskNode(node), easing: 'linear' });
        this.lastCaptureAt.set(node.id, now);
      }
    }
  }

  stop(scene: MaskSceneGraph, now = performance.now()) {
    if (!this.recording || !this.template) return this.getTrack();
    this.capture(scene, now);
    this.recording = false;
    const duration = Math.max(1, now - this.recordStartedAt);
    const lanes = [...this.working.values()].map((lane) => {
      const keyframes = lane.keyframes.map((frame) => ({
        t: frame.t,
        node: cloneMaskNode(frame.node),
        easing: frame.easing ?? 'linear' as SceneMotionEasing,
      }));
      const last = keyframes[keyframes.length - 1];
      if (last && last.t < duration) keyframes.push({ t: duration, node: cloneMaskNode(last.node), easing: 'linear' });
      if (keyframes.length === 1) keyframes.push({ t: duration, node: cloneMaskNode(keyframes[0].node), easing: 'linear' });
      return { maskId: lane.maskId, name: lane.name, keyframes };
    });
    this.track = {
      version: 1,
      duration,
      template: cloneScene(this.template),
      lanes,
    };
    this.playbackRange = { inMs: 0, outMs: duration };
    this.working.clear();
    this.lastCaptureAt.clear();
    return this.getTrack();
  }

  clear() {
    this.recording = false;
    this.playing = false;
    this.template = undefined;
    this.working.clear();
    this.lastCaptureAt.clear();
    this.track = undefined;
    this.playbackRange = { inMs: 0, outMs: 0 };
  }

  loadTrack(track?: SceneMotionTrack) {
    this.recording = false;
    this.playing = false;
    this.template = undefined;
    this.working.clear();
    this.lastCaptureAt.clear();
    this.track = track ? cloneTrack(track) : undefined;
    this.playbackRange = this.track
      ? { inMs: 0, outMs: this.track.duration }
      : { inMs: 0, outMs: 0 };
    return this.getTrack();
  }

  updateKeyframe(maskId: string, index: number, node: SceneMaskNode) {
    if (!this.track || this.recording || this.playing) return false;
    const lane = this.track.lanes.find((item) => item.maskId === maskId);
    const frame = lane?.keyframes[index];
    if (!lane || !frame || node.id !== maskId) return false;
    frame.node = cloneMaskNode(node);
    lane.name = node.name;
    return true;
  }

  deleteKeyframe(maskId: string, index: number) {
    if (!this.track || this.recording || this.playing) return false;
    const lane = this.track.lanes.find((item) => item.maskId === maskId);
    if (!lane || lane.keyframes.length <= 2 || index <= 0 || index >= lane.keyframes.length - 1) return false;
    lane.keyframes.splice(index, 1);
    return true;
  }

  setKeyframeEasing(maskId: string, index: number, easing: SceneMotionEasing) {
    if (!this.track || this.recording || this.playing) return false;
    const frame = this.track.lanes.find((item) => item.maskId === maskId)?.keyframes[index];
    if (!frame) return false;
    frame.easing = easing;
    return true;
  }

  retimeKeyframe(maskId: string, index: number, nextTime: number) {
    if (!this.track || this.recording || this.playing) return false;
    const lane = this.track.lanes.find((item) => item.maskId === maskId);
    if (!lane || index <= 0 || index >= lane.keyframes.length - 1) return false;
    const previous = lane.keyframes[index - 1];
    const next = lane.keyframes[index + 1];
    lane.keyframes[index].t = Math.min(next.t - 1, Math.max(previous.t + 1, nextTime));
    return true;
  }

  setPlaybackRange(inMs: number, outMs: number) {
    if (!this.track) return;
    const duration = this.track.duration;
    const nextIn = Math.min(duration, Math.max(0, inMs));
    const nextOut = Math.min(duration, Math.max(nextIn + 1, outMs));
    this.playbackRange = { inMs: nextIn, outMs: nextOut };
  }

  getPlaybackRange(): SceneMotionPlaybackRange {
    if (!this.track) return { inMs: 0, outMs: 0 };
    const outMs = this.playbackRange.outMs > this.playbackRange.inMs
      ? this.playbackRange.outMs
      : this.track.duration;
    return { inMs: this.playbackRange.inMs, outMs };
  }

  play(mode: PlaybackMode = 'loop', now = performance.now()) {
    if (!this.track || this.track.duration <= 0 || !this.track.lanes.length) return false;
    this.recording = false;
    this.playbackMode = mode;
    this.playbackStartedAt = now;
    this.playing = true;
    return true;
  }

  stopPlayback() {
    this.playing = false;
  }

  isRecording() {
    return this.recording;
  }

  isPlaying() {
    return this.playing;
  }

  getTrack() {
    return this.track ? cloneTrack(this.track) : undefined;
  }

  private resolveTime(now: number) {
    const track = this.track;
    if (!track || track.duration <= 0) return 0;
    const range = this.getPlaybackRange();
    const start = range.inMs;
    const end = Math.max(start + 1, range.outMs);
    const duration = end - start;
    const elapsed = Math.max(0, now - this.playbackStartedAt);

    if (this.playbackMode === 'once') {
      if (elapsed >= duration) {
        this.playing = false;
        return end;
      }
      return start + elapsed;
    }
    if (this.playbackMode === 'reverse') {
      if (elapsed >= duration) {
        this.playing = false;
        return start;
      }
      return end - elapsed;
    }
    if (this.playbackMode === 'pingpong') {
      const phase = elapsed % (duration * 2);
      return phase <= duration ? start + phase : end - (phase - duration);
    }
    return start + (elapsed % duration);
  }

  getCurrentTime(now = performance.now()) {
    if (!this.track) return 0;
    return this.playing ? this.resolveTime(now) : this.getPlaybackRange().inMs;
  }

  getProgress(now = performance.now()) {
    if (!this.track || !this.playing || this.track.duration <= 0) return 0;
    return this.resolveTime(now) / this.track.duration;
  }

  sampleAt(time: number): MaskSceneGraph | undefined {
    const track = this.track;
    if (!track) return undefined;
    const t = Math.min(track.duration, Math.max(0, time));
    const scene = cloneScene(track.template);
    scene.nodes = scene.nodes.map((node) => {
      const lane = track.lanes.find((item) => item.maskId === node.id);
      return lane ? sampleLane(lane, t) ?? node : node;
    });
    return scene;
  }

  sample(now = performance.now()) {
    if (!this.track || !this.playing) return undefined;
    return this.sampleAt(this.resolveTime(now));
  }
}

export const sceneMotionRecorder = new SceneMotionRecorder();
