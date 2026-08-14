import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Power } from 'lucide-react';
import type { EffectBlendMode, EffectNode, EffectSettings } from '../engine/types';
import './effect-stack.css';

const BLENDS: EffectBlendMode[] = ['normal', 'add', 'screen', 'multiply'];

const LABELS: Record<EffectNode['type'], string> = {
  rgbSplit: 'RGB Split',
  ripple: 'Ripple',
  pixelate: 'Pixelate',
  distortion: 'Distortion',
};

function replaceNode(settings: EffectSettings, id: string, patch: Partial<EffectNode>): EffectSettings {
  return {
    ...settings,
    effectStack: settings.effectStack.map((node) => node.id === id ? { ...node, ...patch } : { ...node }),
  };
}

export default function EffectStackEditor({
  effects,
  onChange,
}: {
  effects: EffectSettings;
  onChange: (next: EffectSettings) => void;
}) {
  const [selectedId, setSelectedId] = useState(effects.effectStack[0]?.id ?? '');

  useEffect(() => {
    if (!effects.effectStack.some((node) => node.id === selectedId)) {
      setSelectedId(effects.effectStack[0]?.id ?? '');
    }
  }, [effects.effectStack, selectedId]);

  const selected = effects.effectStack.find((node) => node.id === selectedId);

  const move = (id: string, delta: -1 | 1) => {
    const index = effects.effectStack.findIndex((node) => node.id === id);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= effects.effectStack.length) return;
    const stack = effects.effectStack.map((node) => ({ ...node }));
    [stack[index], stack[nextIndex]] = [stack[nextIndex], stack[index]];
    onChange({ ...effects, effectStack: stack });
  };

  return (
    <section className="effect-stack-editor">
      <div className="stack-heading">
        <span className="eyebrow">EFFECT STACK · GPU ORDER</span>
        <small>Top → bottom</small>
      </div>

      <div className="effect-stack-list">
        {effects.effectStack.map((node, index) => (
          <div key={node.id} className={`effect-node ${selectedId === node.id ? 'selected' : ''} ${node.enabled ? '' : 'disabled'}`}>
            <button
              className={`effect-node-main ${selectedId === node.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(node.id)}
              title="Edit this effect node"
            >
              <span className="effect-node-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{LABELS[node.type]}</span>
              <small>{node.blendMode}</small>
            </button>
            <div className="effect-node-actions">
              <button
                className={`icon-button subtle ${node.enabled ? 'active' : ''}`}
                onClick={() => onChange(replaceNode(effects, node.id, { enabled: !node.enabled }))}
                title={node.enabled ? 'Disable effect' : 'Enable effect'}
              ><Power size={14} /></button>
              <button className="icon-button subtle" disabled={index === 0} onClick={() => move(node.id, -1)} title="Move up"><ArrowUp size={14} /></button>
              <button className="icon-button subtle" disabled={index === effects.effectStack.length - 1} onClick={() => move(node.id, 1)} title="Move down"><ArrowDown size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="effect-node-detail">
          <div className="metric-row"><span>Selected node</span><b>{LABELS[selected.type]}</b></div>
          <StackRange
            label="Node intensity"
            value={selected.intensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(value) => onChange(replaceNode(effects, selected.id, { intensity: value }))}
          />
          <StackRange
            label="Node opacity"
            value={selected.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => onChange(replaceNode(effects, selected.id, { opacity: value }))}
          />
          <span className="eyebrow">BLEND MODE</span>
          <div className="segmented-grid effect-blends">
            {BLENDS.map((blend) => (
              <button
                key={blend}
                className={selected.blendMode === blend ? 'selected' : ''}
                onClick={() => onChange(replaceNode(effects, selected.id, { blendMode: blend }))}
              >{blend}</button>
            ))}
          </div>
        </div>
      )}

      <p className="panel-note">Each enabled row is a separate WebGL render pass. Reordering nodes changes which texture the next shader receives, so the result is materially order-dependent.</p>
    </section>
  );
}

function StackRange({
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
    <label className="range-row">
      <span><b>{label}</b><code>{value.toFixed(2)}</code></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
