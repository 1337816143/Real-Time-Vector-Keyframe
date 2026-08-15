import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link2, Plus, RotateCcw, Trash2, Unlink2 } from 'lucide-react';
import {
  DEFAULT_BEZIER_CURVE,
  cloneCurve,
  insertAnchorAfter,
  removeAnchor,
  setAnchorLinked,
  updateAnchor,
} from '../engine/bezier';
import type { BezierCurve, Vec2 } from '../engine/types';

interface Props {
  curve: BezierCurve;
  onChange: (curve: BezierCurve) => void;
}

type DragKind = 'point' | 'handleIn' | 'handleOut';

type DragState = {
  id: string;
  kind: DragKind;
  pointerId: number;
};

const svgPoint = (point: Vec2) => ({ x: (point.x + 1) * 50, y: (point.y + 1) * 50 });

function pathData(curve: BezierCurve) {
  if (!curve.anchors.length) return '';
  const first = svgPoint(curve.anchors[0].point);
  let d = `M ${first.x} ${first.y}`;
  curve.anchors.forEach((anchor, index) => {
    const next = curve.anchors[(index + 1) % curve.anchors.length];
    const out = svgPoint(anchor.handleOut);
    const incoming = svgPoint(next.handleIn);
    const end = svgPoint(next.point);
    d += ` C ${out.x} ${out.y}, ${incoming.x} ${incoming.y}, ${end.x} ${end.y}`;
  });
  return `${d} Z`;
}

export default function BezierMaskEditor({ curve, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedId, setSelectedId] = useState(curve.anchors[0]?.id ?? '');
  const [drag, setDrag] = useState<DragState>();
  const selectedIndex = Math.max(0, curve.anchors.findIndex((anchor) => anchor.id === selectedId));
  const selected = curve.anchors[selectedIndex];
  const d = useMemo(() => pathData(curve), [curve]);

  const pointerToLocal = (event: PointerEvent<SVGSVGElement>): Vec2 => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1.4, Math.max(-1.4, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1)),
      y: Math.min(1.4, Math.max(-1.4, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)),
    };
  };

  const beginDrag = (event: PointerEvent<SVGCircleElement>, id: string, kind: DragKind) => {
    event.stopPropagation();
    setSelectedId(id);
    setDrag({ id, kind, pointerId: event.pointerId });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    onChange(updateAnchor(curve, drag.id, drag.kind, pointerToLocal(event)));
  };

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    setDrag(undefined);
  };

  const addAnchor = () => {
    const next = insertAnchorAfter(curve, selectedIndex);
    const inserted = next.anchors[Math.min(selectedIndex + 1, next.anchors.length - 1)];
    onChange(next);
    setSelectedId(inserted.id);
  };

  const deleteAnchor = () => {
    if (!selected || curve.anchors.length <= 3) return;
    const next = removeAnchor(curve, selected.id);
    onChange(next);
    setSelectedId(next.anchors[Math.min(selectedIndex, next.anchors.length - 1)]?.id ?? '');
  };

  const reset = () => {
    const next = cloneCurve(DEFAULT_BEZIER_CURVE);
    onChange(next);
    setSelectedId(next.anchors[0].id);
  };

  return (
    <section className="bezier-editor">
      <div className="bezier-editor-head">
        <div>
          <span className="eyebrow">VECTOR MASK EDITOR</span>
          <strong>Closed cubic Bezier</strong>
        </div>
        <span>{curve.anchors.length} anchors</span>
      </div>

      <svg
        ref={svgRef}
        className="bezier-stage"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <linearGradient id="bezier-mask-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(112, 204, 255, .26)" />
            <stop offset="1" stopColor="rgba(171, 126, 255, .13)" />
          </linearGradient>
        </defs>
        <path d={d} className="bezier-shape" />

        {curve.anchors.map((anchor) => {
          const p = svgPoint(anchor.point);
          const incoming = svgPoint(anchor.handleIn);
          const outgoing = svgPoint(anchor.handleOut);
          const active = anchor.id === selectedId;
          return (
            <g key={anchor.id} className={active ? 'active' : ''}>
              {active && (
                <>
                  <line x1={p.x} y1={p.y} x2={incoming.x} y2={incoming.y} className="bezier-handle-line" />
                  <line x1={p.x} y1={p.y} x2={outgoing.x} y2={outgoing.y} className="bezier-handle-line" />
                  <circle cx={incoming.x} cy={incoming.y} r="2.25" className="bezier-handle" onPointerDown={(event) => beginDrag(event, anchor.id, 'handleIn')} />
                  <circle cx={outgoing.x} cy={outgoing.y} r="2.25" className="bezier-handle" onPointerDown={(event) => beginDrag(event, anchor.id, 'handleOut')} />
                </>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 3.15 : 2.55}
                className="bezier-anchor"
                onPointerDown={(event) => beginDrag(event, anchor.id, 'point')}
              />
            </g>
          );
        })}
      </svg>

      <div className="bezier-toolbar">
        <button type="button" onClick={addAnchor} disabled={curve.anchors.length >= 10}><Plus size={14} /> Add</button>
        <button type="button" onClick={deleteAnchor} disabled={curve.anchors.length <= 3}><Trash2 size={14} /> Delete</button>
        <button
          type="button"
          className={selected?.linked ? 'selected' : ''}
          onClick={() => selected && onChange(setAnchorLinked(curve, selected.id, !selected.linked))}
        >
          {selected?.linked ? <Link2 size={14} /> : <Unlink2 size={14} />}
          {selected?.linked ? 'Linked' : 'Free'}
        </button>
        <button type="button" onClick={reset}><RotateCcw size={14} /> Reset</button>
      </div>
      <p className="panel-note">Drag anchors to reshape the mask. Select an anchor to expose its two cubic control handles. Linked handles mirror around the anchor; switch to Free for asymmetric curves.</p>
    </section>
  );
}
