import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link2, Pencil, Plus, RotateCcw, Trash2, Unlink2 } from 'lucide-react';
import {
  DEFAULT_BEZIER_CURVE,
  cloneCurve,
  curveFromFreehand,
  insertAnchorAfter,
  removeAnchor,
  setAnchorLinked,
  updateAnchor,
} from '../engine/bezier';
import type { BezierCurve, Vec2 } from '../engine/types';
import './BezierMaskEditor.css';

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
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

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
  const [drawing, setDrawing] = useState(false);
  const [drawPointerId, setDrawPointerId] = useState<number>();
  const [freehand, setFreehand] = useState<Vec2[]>([]);
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
    if (drawing) return;
    event.stopPropagation();
    setSelectedId(id);
    setDrag({ id, kind, pointerId: event.pointerId });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginFreehand = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const next = pointerToLocal(event);
    setFreehand([next]);
    setDrawPointerId(event.pointerId);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    if (drawing && drawPointerId === event.pointerId) {
      const next = pointerToLocal(event);
      setFreehand((current) => !current.length || distance(current[current.length - 1], next) >= 0.015 ? [...current, next] : current);
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    onChange(updateAnchor(curve, drag.id, drag.kind, pointerToLocal(event)));
  };

  const endPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (drawing && drawPointerId === event.pointerId) {
      if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
      const nextCurve = freehand.length >= 4 ? curveFromFreehand(freehand) : curve;
      if (freehand.length >= 4) {
        onChange(nextCurve);
        setSelectedId(nextCurve.anchors[0]?.id ?? '');
      }
      setFreehand([]);
      setDrawPointerId(undefined);
      setDrawing(false);
      return;
    }
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
    setDrawing(false);
    setFreehand([]);
  };

  const freehandPoints = freehand.map(svgPoint).map((item) => `${item.x},${item.y}`).join(' ');

  return (
    <section className="bezier-editor">
      <div className="bezier-editor-head">
        <div>
          <span className="eyebrow">VECTOR MASK EDITOR</span>
          <strong>{drawing ? 'Draw a closed silhouette' : 'Closed cubic Bezier'}</strong>
        </div>
        <span>{curve.anchors.length} anchors</span>
      </div>

      <svg
        ref={svgRef}
        className={`bezier-stage ${drawing ? 'drawing' : ''}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerDown={beginFreehand}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <defs>
          <linearGradient id="bezier-mask-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(112, 204, 255, .26)" />
            <stop offset="1" stopColor="rgba(171, 126, 255, .13)" />
          </linearGradient>
        </defs>
        <path d={d} className="bezier-shape" />
        {freehandPoints && <polyline points={freehandPoints} className="bezier-freehand" />}

        {!drawing && curve.anchors.map((anchor) => {
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
        <button type="button" className={drawing ? 'selected' : ''} onClick={() => { setDrawing((value) => !value); setFreehand([]); }}><Pencil size={14} /> Draw</button>
        <button type="button" onClick={addAnchor} disabled={drawing || curve.anchors.length >= 10}><Plus size={14} /> Add</button>
        <button type="button" onClick={deleteAnchor} disabled={drawing || curve.anchors.length <= 3}><Trash2 size={14} /> Delete</button>
        <button
          type="button"
          disabled={drawing}
          className={selected?.linked ? 'selected' : ''}
          onClick={() => selected && onChange(setAnchorLinked(curve, selected.id, !selected.linked))}
        >
          {selected?.linked ? <Link2 size={14} /> : <Unlink2 size={14} />}
          {selected?.linked ? 'Linked' : 'Free'}
        </button>
        <button type="button" onClick={reset}><RotateCcw size={14} /> Reset</button>
      </div>
      <p className="panel-note">Use Draw for a fast silhouette: the stroke is resampled into a small editable cubic curve. Then drag anchors or handles for precise cleanup. Linked handles stay tangent; Free handles allow asymmetric corners.</p>
    </section>
  );
}
