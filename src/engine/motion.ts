import type {
  EffectSettings,
  MotionKeyframe,
  MotionTrack,
  PlaybackMode,
  RenderState,
} from './types';

function cloneEffects(effects: EffectSettings): EffectSettings {
  return { ...effects };
}

function cloneFrame(frame: MotionKeyframe): MotionKeyframe {
  return {
    ...frame,
    transform: { ...frame.transform },
    effects: cloneEffects(frame.effects),
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function angleLerp(a: number, b: number, t: number) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function meaningfulChange(a: MotionKeyframe, b: MotionKeyframe) {
  const position = Math.hypot(a.transform.x - b.transform.x, a.transform.y - b.transform.y);
  const scale = Math.abs(a.transform.scale - b.transform.scale);
  const rotation = Math.abs(a.transform.rotation - b.transform.rotation);
  const effectDelta =
    Math.abs(a.effects.rgbSplit - b.effects.rgbSplit) +
    Math.abs(a.effects.ripple - b.effects.ripple) +
    Math.abs(a.effects.distortion - b.effects.distortion) +
    Math.abs(a.effects.glow - b.effects.glow) * 0.02 +
    Math.abs(a.effects.temporalMix - b.effects.temporalMix) * 0.02;
  return position > 0.004 || scale > 0.004 || rotation > 0.018 || effectDelta > 0.001 || a.gestureState !== b.gestureState;
}

export class MotionRecorder {
  private recording = false;
  private recordStartedAt = 0;
  private lastCaptureAt = 0;
  private working: MotionKeyframe[] = [];
  private track?: MotionTrack;

  private playing = false;
  private playbackStartedAt = 0;
  private playbackMode: PlaybackMode = 'loop';

  start(now = performance.now()) {
    this.recording = true;
    this.playing = false;
    this.recordStartedAt = now;
    this.lastCaptureAt = -Infinity;
    this.working = [];
  }

  capture(state: RenderState, now = performance.now()) {
    if (!this.recording) return;
    const t = Math.max(0, now - this.recordStartedAt);
    const frame: MotionKeyframe = {
      t,
      maskType: state.maskType,
      transform: { ...state.transform },
      effects: cloneEffects(state.effects),
      gestureState: state.gestureState,
      handSpeed: state.handSpeed,
    };
    const previous = this.working[this.working.length - 1];
    const elapsed = now - this.lastCaptureAt;
    if (!previous || elapsed >= 140 || (elapsed >= 32 && meaningfulChange(previous, frame))) {
      this.working.push(frame);
      this.lastCaptureAt = now;
    }
  }

  stop(now = performance.now()) {
    if (!this.recording) return this.track;
    this.recording = false;
    const duration = Math.max(0, now - this.recordStartedAt);
    if (this.working.length === 1) {
      this.working.push({ ...cloneFrame(this.working[0]), t: Math.max(1, duration) });
    }
    if (this.working.length >= 2) {
      const final = this.working[this.working.length - 1];
      final.t = Math.max(final.t, duration);
      this.track = {
        version: 1,
        duration: final.t,
        keyframes: this.working.map(cloneFrame),
      };
    }
    this.working = [];
    return this.track;
  }

  clear() {
    this.recording = false;
    this.playing = false;
    this.working = [];
    this.track = undefined;
  }

  play(mode: PlaybackMode = 'loop', now = performance.now()) {
    if (!this.track || this.track.keyframes.length < 2) return false;
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
    return this.track;
  }

  getProgress(now = performance.now()) {
    if (!this.track || !this.playing || this.track.duration <= 0) return 0;
    return this.resolveTime(now) / this.track.duration;
  }

  private resolveTime(now: number) {
    const track = this.track;
    if (!track || track.duration <= 0) return 0;
    const elapsed = Math.max(0, now - this.playbackStartedAt);
    const duration = track.duration;

    if (this.playbackMode === 'once') {
      if (elapsed >= duration) {
        this.playing = false;
        return duration;
      }
      return elapsed;
    }
    if (this.playbackMode === 'reverse') {
      if (elapsed >= duration) {
        this.playing = false;
        return 0;
      }
      return duration - elapsed;
    }
    if (this.playbackMode === 'pingpong') {
      const phase = elapsed % (duration * 2);
      return phase <= duration ? phase : duration * 2 - phase;
    }
    return elapsed % duration;
  }

  sample(now = performance.now()): MotionKeyframe | undefined {
    const track = this.track;
    if (!track || !this.playing || track.keyframes.length < 2) return undefined;
    const t = this.resolveTime(now);
    const frames = track.keyframes;
    let right = frames.findIndex((frame) => frame.t >= t);
    if (right <= 0) return cloneFrame(frames[0]);
    if (right < 0) return cloneFrame(frames[frames.length - 1]);
    const a = frames[right - 1];
    const b = frames[right];
    const span = Math.max(1, b.t - a.t);
    const mix = Math.min(1, Math.max(0, (t - a.t) / span));

    return {
      t,
      maskType: mix < 0.5 ? a.maskType : b.maskType,
      transform: {
        x: lerp(a.transform.x, b.transform.x, mix),
        y: lerp(a.transform.y, b.transform.y, mix),
        scale: lerp(a.transform.scale, b.transform.scale, mix),
        rotation: angleLerp(a.transform.rotation, b.transform.rotation, mix),
      },
      effects: {
        rgbSplit: lerp(a.effects.rgbSplit, b.effects.rgbSplit, mix),
        ripple: lerp(a.effects.ripple, b.effects.ripple, mix),
        pixelate: lerp(a.effects.pixelate, b.effects.pixelate, mix),
        distortion: lerp(a.effects.distortion, b.effects.distortion, mix),
        glow: lerp(a.effects.glow, b.effects.glow, mix),
        invertMask: mix < 0.5 ? a.effects.invertMask : b.effects.invertMask,
        useAlternateMedia: mix < 0.5 ? a.effects.useAlternateMedia : b.effects.useAlternateMedia,
        temporalMode: mix < 0.5 ? a.effects.temporalMode : b.effects.temporalMode,
        temporalDelayMs: lerp(a.effects.temporalDelayMs, b.effects.temporalDelayMs, mix),
        temporalMix: lerp(a.effects.temporalMix, b.effects.temporalMix, mix),
      },
      gestureState: mix < 0.5 ? a.gestureState : b.gestureState,
      handSpeed: lerp(a.handSpeed, b.handSpeed, mix),
    };
  }
}
