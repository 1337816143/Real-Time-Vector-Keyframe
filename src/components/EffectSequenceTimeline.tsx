import { useRef, type PointerEvent } from 'react';
import type { EffectSequenceClip } from '../engine/effectSequence';
import type { SceneMaskNode } from '../engine/scene';
import './EffectSequenceTimeline.css';

type DragMode = 'move' | 'start' | 'end';

type DragState = {
  id: string;
  mode: DragMode;
  startX: number;
  width: number;
  originalStart: number;
  originalEnd: number;
};

export default function EffectSequenceTimeline({
  duration,
  previewMs,
  clips,
  nodes,
  onPreview,
  onUpdate,
}: {
  duration: number;
  previewMs: number;
  clips: EffectSequenceClip[];
  nodes: SceneMaskNode[];
  onPreview: (timeMs: number) => void;
  onUpdate: (id: string, patch: Partial<Omit<EffectSequenceClip, 'id'>>) => void;
}) {
  const dragRef = useRef<DragState>();
  const percent = (timeMs: number) => duration > 0 ? Math.min(100, Math.max(0, timeMs / duration * 100)) : 0;

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onPreview(ratio * duration);
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, clip: EffectSequenceClip, mode: DragMode) => {
    event.stopPropagation();
    const track = event.currentTarget.closest('.effect-sequence-lane-track') as HTMLElement | null;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    dragRef.current = {
      id: clip.id,
      mode,
      startX: event.clientX,
      width: Math.max(1, rect.width),
      originalStart: clip.startMs,
      originalEnd: clip.endMs,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.currentTarget.dataset.clipId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const deltaMs = (event.clientX - drag.startX) / drag.width * duration;
    if (drag.mode === 'move') {
      const span = drag.originalEnd - drag.originalStart;
      const startMs = Math.min(Math.max(0, drag.originalStart + deltaMs), Math.max(0, duration - span));
      onUpdate(drag.id, { startMs, endMs: startMs + span });
      return;
    }
    if (drag.mode === 'start') {
      onUpdate(drag.id, { startMs: Math.min(drag.originalEnd - 1, Math.max(0, drag.originalStart + deltaMs)) });
      return;
    }
    onUpdate(drag.id, { endMs: Math.max(drag.originalStart + 1, Math.min(duration, drag.originalEnd + deltaMs)) });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = undefined;
  };

  return (
    <div className="effect-sequence-timeline">
      <div className="effect-sequence-ruler">
        <span>0.0s</span>
        <span>{(duration / 2000).toFixed(1)}s</span>
        <span>{(duration / 1000).toFixed(1)}s</span>
      </div>
      <div className="effect-sequence-lanes">
        {nodes.map((node) => {
          const laneClips = clips.filter((clip) => clip.maskId === node.id);
          return (
            <div className="effect-sequence-lane" key={node.id}>
              <div className="effect-sequence-lane-label">
                <b>{node.name}</b>
                <span>{laneClips.length} clips</span>
              </div>
              <div className="effect-sequence-lane-track" onPointerDown={scrub}>
                {laneClips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`effect-sequence-bar ${clip.enabled ? '' : 'disabled'}`}
                    style={{ left: `${percent(clip.startMs)}%`, width: `${Math.max(.6, percent(clip.endMs) - percent(clip.startMs))}%` }}
                    title={`${clip.name} · ${(clip.startMs / 1000).toFixed(2)}–${(clip.endMs / 1000).toFixed(2)}s`}
                  >
                    <button
                      type="button"
                      className="effect-sequence-handle start"
                      data-clip-id={clip.id}
                      onPointerDown={(event) => beginDrag(event, clip, 'start')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    />
                    <button
                      type="button"
                      className="effect-sequence-bar-body"
                      data-clip-id={clip.id}
                      onPointerDown={(event) => beginDrag(event, clip, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    >
                      <span>{clip.name}</span>
                    </button>
                    <button
                      type="button"
                      className="effect-sequence-handle end"
                      data-clip-id={clip.id}
                      onPointerDown={(event) => beginDrag(event, clip, 'end')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    />
                  </div>
                ))}
                <span className="effect-sequence-playhead" style={{ left: `${percent(previewMs)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
