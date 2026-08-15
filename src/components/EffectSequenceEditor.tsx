import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import {
  addEffectSequenceClip,
  getEffectSequencePreviewTime,
  getEffectSequenceTrack,
  moveEffectSequenceClip,
  removeEffectSequenceClip,
  setEffectSequencePreviewTime,
  subscribeEffectSequence,
  updateEffectSequenceClip,
  type EffectSequenceTrack,
} from '../engine/effectSequence';
import { sceneMotionRecorder } from '../engine/sceneMotion';
import { getSceneState, replaceScene, subscribeScene } from '../engine/sceneStore';
import { PRESETS, type PresetId } from '../engine/types';
import './EffectSequenceEditor.css';

const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export default function EffectSequenceEditor() {
  const sceneState = useSyncExternalStore(subscribeScene, getSceneState, getSceneState);
  const [sequence, setSequence] = useState<EffectSequenceTrack>(() => getEffectSequenceTrack());
  const [previewMs, setPreviewMs] = useState(() => getEffectSequencePreviewTime());
  const motion = sceneMotionRecorder.getTrack();
  const duration = motion?.duration ?? 0;

  useEffect(() => subscribeEffectSequence(() => setSequence(getEffectSequenceTrack())), []);

  const preview = (timeMs: number) => {
    if (!motion) return;
    const next = Math.min(duration, Math.max(0, timeMs));
    setPreviewMs(next);
    setEffectSequencePreviewTime(next);
    const sampled = sceneMotionRecorder.sampleAt(next);
    if (sampled) replaceScene(sampled, true);
  };

  const addClip = () => {
    if (!motion || sequence.clips.length >= 32) return;
    const maskId = sceneState.scene.selectedMaskId ?? sceneState.scene.nodes[0]?.id;
    if (!maskId) return;
    addEffectSequenceClip(maskId, duration, previewMs);
  };

  return (
    <section className="effect-sequence-editor">
      <div className="effect-sequence-head">
        <div>
          <span className="eyebrow">EFFECT SEQUENCE</span>
          <strong>Time-ranged per-mask effect clips</strong>
        </div>
        <span>{sequence.clips.length}/32 clips</span>
      </div>

      {!motion ? (
        <p className="panel-note">Record a Scene Motion track first. Effect Sequence uses that timeline as its absolute clock and never rewrites motion keyframes.</p>
      ) : (
        <>
          <div className="effect-sequence-preview">
            <span><b>Preview time</b><code>{(previewMs / 1000).toFixed(2)} / {(duration / 1000).toFixed(2)} s</code></span>
            <input type="range" min={0} max={duration} step={10} value={Math.min(duration, previewMs)} onChange={(event) => preview(Number(event.target.value))} />
          </div>

          <button type="button" className="effect-sequence-add" disabled={sequence.clips.length >= 32} onClick={addClip}>
            <Plus size={13} /> Add clip at playhead
          </button>

          <div className="effect-sequence-list">
            {sequence.clips.map((clip, index) => {
              const span = Math.max(1, clip.endMs - clip.startMs);
              return (
                <article key={clip.id} className={`effect-sequence-clip ${clip.enabled ? '' : 'disabled'}`}>
                  <div className="effect-sequence-clip-head">
                    <button type="button" title={clip.enabled ? 'Disable clip' : 'Enable clip'} onClick={() => updateEffectSequenceClip(clip.id, { enabled: !clip.enabled })}>
                      {clip.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <input
                      aria-label="Clip name"
                      value={clip.name}
                      maxLength={80}
                      onChange={(event) => updateEffectSequenceClip(clip.id, { name: event.target.value })}
                    />
                    <div>
                      <button type="button" disabled={index === 0} title="Move earlier in overlay order" onClick={() => moveEffectSequenceClip(clip.id, -1)}><ArrowUp size={12} /></button>
                      <button type="button" disabled={index === sequence.clips.length - 1} title="Move later in overlay order" onClick={() => moveEffectSequenceClip(clip.id, 1)}><ArrowDown size={12} /></button>
                      <button type="button" title="Delete clip" onClick={() => removeEffectSequenceClip(clip.id)}><Trash2 size={12} /></button>
                    </div>
                  </div>

                  <div className="effect-sequence-grid">
                    <label>
                      <span>Mask</span>
                      <select value={clip.maskId} onChange={(event) => updateEffectSequenceClip(clip.id, { maskId: event.target.value })}>
                        {sceneState.scene.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Preset</span>
                      <select value={clip.presetId} onChange={(event) => updateEffectSequenceClip(clip.id, { presetId: event.target.value as PresetId })}>
                        {PRESET_IDS.map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
                      </select>
                    </label>
                  </div>

                  <SequenceRange
                    label="Start"
                    value={clip.startMs}
                    max={Math.max(0, clip.endMs - 1)}
                    display={`${(clip.startMs / 1000).toFixed(2)}s`}
                    onChange={(startMs) => updateEffectSequenceClip(clip.id, { startMs })}
                  />
                  <SequenceRange
                    label="End"
                    value={Math.min(duration, clip.endMs)}
                    min={Math.min(duration, clip.startMs + 1)}
                    max={duration}
                    display={`${(clip.endMs / 1000).toFixed(2)}s`}
                    onChange={(endMs) => updateEffectSequenceClip(clip.id, { endMs })}
                  />
                  <SequenceRange
                    label="Fade in"
                    value={Math.min(span, clip.fadeInMs)}
                    max={span}
                    display={`${clip.fadeInMs.toFixed(0)}ms`}
                    onChange={(fadeInMs) => updateEffectSequenceClip(clip.id, { fadeInMs })}
                  />
                  <SequenceRange
                    label="Fade out"
                    value={Math.min(span, clip.fadeOutMs)}
                    max={span}
                    display={`${clip.fadeOutMs.toFixed(0)}ms`}
                    onChange={(fadeOutMs) => updateEffectSequenceClip(clip.id, { fadeOutMs })}
                  />
                  <SequenceRange
                    label="Intensity"
                    value={clip.intensity}
                    min={0}
                    max={2}
                    step={0.02}
                    display={`${Math.round(clip.intensity * 100)}%`}
                    onChange={(intensity) => updateEffectSequenceClip(clip.id, { intensity })}
                  />
                </article>
              );
            })}
          </div>
        </>
      )}

      <p className="panel-note">Clips are evaluated in list order. Fade weight blends numeric Effect/Temporal parameters and effect-node opacity on a render-only copy of the target mask. Transform, geometry and stored Scene Motion keyframes are untouched.</p>
    </section>
  );
}

function SequenceRange({
  label,
  value,
  min = 0,
  max,
  step = 10,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="effect-sequence-range">
      <span><b>{label}</b><code>{display}</code></span>
      <input type="range" min={min} max={Math.max(min, max)} step={step} value={Math.min(Math.max(value, min), Math.max(min, max))} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
