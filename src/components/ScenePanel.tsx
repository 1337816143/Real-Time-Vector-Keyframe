import { useState, useSyncExternalStore } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers3,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import BezierMaskEditor from './BezierMaskEditor';
import EffectSequenceEditor from './EffectSequenceEditor';
import EffectStackEditor from './EffectStackEditor';
import SceneMotionControls from './SceneMotionControls';
import './ScenePanel.css';
import {
  addMask,
  clearTrailGeometry,
  getSceneState,
  moveMask,
  removeMask,
  selectMask,
  setCustomMaskGeometry,
  setMaskEffectPreset,
  setMaskEffects,
  setSceneEnabled,
  subscribeScene,
  updateMask,
} from '../engine/sceneStore';
import { sceneMotionRecorder } from '../engine/sceneMotion';
import { PRESETS, type PresetId } from '../engine/types';

const EFFECT_PRESETS: PresetId[] = ['multiverse', 'cyber', 'dream', 'time', 'freeze', 'slash'];

export default function ScenePanel() {
  const state = useSyncExternalStore(subscribeScene, getSceneState, getSceneState);
  const [open, setOpen] = useState(false);
  const [motionBusy, setMotionBusy] = useState(false);
  const selected = state.scene.nodes.find((node) => node.id === state.scene.selectedMaskId);
  const topologyLocked = motionBusy || sceneMotionRecorder.isRecording() || sceneMotionRecorder.isPlaying();

  return (
    <aside className={`scene-panel glass-panel ${open ? 'open' : ''}`}>
      <div className="scene-panel-head">
        <button
          type="button"
          className={`scene-enable ${state.enabled ? 'active' : ''}`}
          disabled={topologyLocked && state.enabled}
          onClick={() => setSceneEnabled(!state.enabled)}
        >
          <Layers3 size={16} />
          <span>
            <b>Multi-Mask Scene</b>
            <small>{state.enabled ? `${state.scene.nodes.length} masks · GPU scene active` : 'Single-mask mode'}</small>
          </span>
          <i />
        </button>
        <button className="icon-button subtle" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {open && (
        <div className="scene-panel-body">
          <div className="scene-add-row">
            <span>Add</span>
            {(['circle', 'blob', 'portal', 'trail', 'custom'] as const).map((kind) => (
              <button key={kind} type="button" disabled={topologyLocked || state.scene.nodes.length >= 4} onClick={() => addMask(kind)}>
                <Plus size={11} /> {kind}
              </button>
            ))}
          </div>

          <div className="scene-node-list">
            {state.scene.nodes.map((node, index) => {
              const active = node.id === state.scene.selectedMaskId;
              return (
                <div key={node.id} className={`scene-node ${active ? 'selected' : ''}`}>
                  <button type="button" className="scene-node-main" onClick={() => selectMask(node.id)}>
                    <span className="scene-node-index">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <b>{node.name}</b>
                      <small>{node.geometry.kind}{node.geometry.kind === 'trail' ? ` · ${node.geometry.points.length} pts` : ''} · {node.effects.effectStack.filter((effect) => effect.enabled).length} FX</small>
                    </span>
                  </button>
                  <div className="scene-node-actions">
                    <button type="button" title={node.visible ? 'Hide mask' : 'Show mask'} onClick={() => updateMask(node.id, { visible: !node.visible })}>{node.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    <button type="button" title={node.locked ? 'Unlock gesture transform' : 'Lock gesture transform'} onClick={() => updateMask(node.id, { locked: !node.locked })}>{node.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                    <button type="button" title="Move down" disabled={topologyLocked || index === 0} onClick={() => moveMask(node.id, -1)}><ArrowDown size={13} /></button>
                    <button type="button" title="Move up" disabled={topologyLocked || index === state.scene.nodes.length - 1} onClick={() => moveMask(node.id, 1)}><ArrowUp size={13} /></button>
                    <button type="button" title="Delete mask" disabled={topologyLocked || state.scene.nodes.length <= 1} onClick={() => removeMask(node.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <section className="scene-selected-editor">
              <div className="scene-selected-head">
                <div>
                  <span className="eyebrow">SELECTED MASK</span>
                  <strong>{selected.name}</strong>
                </div>
                <span>{selected.geometry.kind === 'trail'
                  ? selected.locked ? 'Trail locked' : 'Pinch draws · two hands transform'
                  : selected.locked ? 'Gesture transform locked' : 'Pinch controls this node'}</span>
              </div>

              <label className="scene-preset-select">
                <span>Effect preset</span>
                <select key={selected.id} defaultValue={selected.geometry.kind === 'trail' ? 'slash' : 'multiverse'} onChange={(event) => setMaskEffectPreset(selected.id, event.target.value as PresetId)}>
                  {EFFECT_PRESETS.map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
                </select>
              </label>

              <div className="scene-effect-amounts">
                <SceneRange label="RGB split" value={selected.effects.rgbSplit} min={0} max={0.04} step={0.001} onChange={(value) => setMaskEffects(selected.id, { ...selected.effects, rgbSplit: value })} />
                <SceneRange label="Ripple" value={selected.effects.ripple} min={0} max={0.06} step={0.002} onChange={(value) => setMaskEffects(selected.id, { ...selected.effects, ripple: value })} />
                <SceneRange label="Pixelate" value={selected.effects.pixelate} min={0} max={120} step={4} onChange={(value) => setMaskEffects(selected.id, { ...selected.effects, pixelate: value })} />
                <SceneRange label="Distortion" value={selected.effects.distortion} min={0} max={0.06} step={0.002} onChange={(value) => setMaskEffects(selected.id, { ...selected.effects, distortion: value })} />
                <SceneRange label="Edge glow" value={selected.effects.glow} min={0} max={1.8} step={0.05} onChange={(value) => setMaskEffects(selected.id, { ...selected.effects, glow: value })} />
              </div>

              <EffectStackEditor effects={selected.effects} onChange={(effects) => setMaskEffects(selected.id, effects)} />

              {selected.geometry.kind === 'trail' && (
                <div className="scene-custom-editor">
                  <div className="scene-selected-head">
                    <div>
                      <span className="eyebrow">VECTOR TRAIL PATH</span>
                      <strong>{selected.geometry.points.length} local points</strong>
                    </div>
                    <span>Single-hand Pinch redraws</span>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => clearTrailGeometry(selected.id)}>
                    <Trash2 size={13} /> Clear trail path
                  </button>
                  <p className="panel-note">The path is stored in node-local coordinates. Draw with one pinching hand; use two pinching hands to move, scale or rotate the completed Trail as one Scene node.</p>
                </div>
              )}

              {selected.geometry.kind === 'custom' && (
                <div className="scene-custom-editor">
                  <BezierMaskEditor
                    curve={selected.geometry.curve}
                    onChange={(curve) => setCustomMaskGeometry(selected.id, { curve })}
                  />
                  <label className="scene-range">
                    <span><b>Expansion</b><code>{selected.geometry.expansion.toFixed(3)}</code></span>
                    <input
                      type="range"
                      min={-0.45}
                      max={0.45}
                      step={0.01}
                      value={selected.geometry.expansion}
                      onChange={(event) => setCustomMaskGeometry(selected.id, { expansion: Number(event.target.value) })}
                    />
                  </label>
                  <label className="scene-range">
                    <span><b>Feather</b><code>{selected.geometry.feather.toFixed(3)}</code></span>
                    <input
                      type="range"
                      min={0}
                      max={0.08}
                      step={0.002}
                      value={selected.geometry.feather}
                      onChange={(event) => setCustomMaskGeometry(selected.id, { feather: Number(event.target.value) })}
                    />
                  </label>
                </div>
              )}
            </section>
          )}

          <SceneMotionControls onBusyChange={setMotionBusy} />
          <EffectSequenceEditor />

          <p className="panel-note">Scene order runs from bottom to top. Circle / Blob / Portal / Custom / Trail nodes all participate in the same GPU Scene, Motion lanes, Effect Sequence and recording pipeline.</p>
        </div>
      )}
    </aside>
  );
}

function SceneRange({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="scene-range">
      <span><b>{label}</b><code>{step >= 1 ? value.toFixed(0) : value.toFixed(3)}</code></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
