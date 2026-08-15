import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Shapes } from 'lucide-react';
import BezierMaskEditor from './BezierMaskEditor';
import './BezierMaskEditor.css';
import './CustomMaskOverlay.css';
import {
  getBezierMaskState,
  setBezierCurve,
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
      {open && <BezierMaskEditor curve={state.curve} onChange={setBezierCurve} />}
    </aside>
  );
}
