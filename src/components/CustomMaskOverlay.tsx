import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Shapes } from 'lucide-react';
import BezierMaskEditor from './BezierMaskEditor';
import './CustomMaskOverlay.css';
import {
  getBezierMaskState,
  setBezierCurve,
  setBezierExpansion,
  setBezierFeather,
  setCustomMaskEnabled,
  subscribeBezierMask,
} from '../engine/bezierStore';

export default function CustomMaskOverlay() {
  const state = useSyncExternalStore(subscribeBezierMask, getBezierMaskState, getBezierMaskState);
  const [open, setOpen] = useState(false);

  return (
    <aside className={`custom-mask-overlay glass-panel ${open ? 'open' : ''}`}>
      <div className="custom-mask-overlay-head">
        <button
          className={`custom-mask-enable ${state.enabled ? 'active' : ''}`}
          onClick={() => setCustomMaskEnabled(!state.enabled)}
          type="button"
        >
          <Shapes size={15} />
          <span>
            <b>Custom Mask</b>
            <small>{state.enabled ? 'GPU mask active' : 'Click to activate'}</small>
          </span>
          <i />
        </button>
        <button
          className="icon-button subtle"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Collapse custom mask editor' : 'Open custom mask editor'}
        >
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div className="custom-mask-editor-body">
          <BezierMaskEditor curve={state.curve} onChange={setBezierCurve} />
          <label className="custom-mask-range">
            <span><b>Expansion</b><code>{state.expansion.toFixed(3)}</code></span>
            <input type="range" min={-0.45} max={0.45} step={0.01} value={state.expansion} onChange={(event) => setBezierExpansion(Number(event.target.value))} />
            <small>Negative values contract the signed-distance boundary; positive values expand it.</small>
          </label>
          <label className="custom-mask-range">
            <span><b>Feather</b><code>{state.feather.toFixed(3)}</code></span>
            <input type="range" min={0} max={0.08} step={0.002} value={state.feather} onChange={(event) => setBezierFeather(Number(event.target.value))} />
            <small>Controls the actual signed-distance blend band at the mask edge.</small>
          </label>
        </div>
      )}
    </aside>
  );
}
