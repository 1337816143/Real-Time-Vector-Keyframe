import type { PointerEvent } from 'react';
import type { SceneMotionPlaybackRange, SceneMotionTrack } from '../engine/sceneMotion';
import './SceneMotionTimeline.css';

export interface SceneMotionKeySelection {
  maskId: string;
  index: number;
}

interface Props {
  track: SceneMotionTrack;
  progress: number;
  range: SceneMotionPlaybackRange;
  selected?: SceneMotionKeySelection;
  onScrub: (progress: number) => void;
  onSelectKeyframe: (selection: SceneMotionKeySelection) => void;
  onRetimeKeyframe: (selection: SceneMotionKeySelection, timeMs: number) => void;
}

export default function SceneMotionTimeline({
  track,
  progress,
  range,
  selected,
  onScrub,
  onSelectKeyframe,
  onRetimeKeyframe,
}: Props) {
  const position = (timeMs: number) => track.duration > 0 ? Math.min(1, Math.max(0, timeMs / track.duration)) : 0;

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onScrub(next);
  };

  const retime = (event: PointerEvent<HTMLButtonElement>, selection: SceneMotionKeySelection) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onRetimeKeyframe(selection, next * track.duration);
  };

  const rangeStart = position(range.inMs) * 100;
  const rangeEnd = position(range.outMs) * 100;

  return (
    <div className="scene-motion-timeline">
      <div className="scene-motion-ruler">
        <span>0.0s</span>
        <span>{(track.duration / 2000).toFixed(1)}s</span>
        <span>{(track.duration / 1000).toFixed(1)}s</span>
      </div>
      <div className="scene-motion-lanes">
        {track.lanes.map((lane) => (
          <div className="scene-motion-lane" key={lane.maskId}>
            <div className="scene-motion-lane-label">
              <b>{lane.name}</b>
              <span>{lane.keyframes.length} keys</span>
            </div>
            <div
              className="scene-motion-lane-track"
              onPointerDown={scrub}
              onPointerMove={(event) => {
                if (event.buttons === 1 && event.target === event.currentTarget) scrub(event);
              }}
            >
              <i className="scene-motion-range-shade left" style={{ width: `${rangeStart}%` }} />
              <i className="scene-motion-range-shade right" style={{ left: `${rangeEnd}%` }} />
              <i className="scene-motion-range-line in" style={{ left: `${rangeStart}%` }} />
              <i className="scene-motion-range-line out" style={{ left: `${rangeEnd}%` }} />
              <i className="scene-motion-progress" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
              {lane.keyframes.map((frame, index) => {
                const selection = { maskId: lane.maskId, index };
                const active = selected?.maskId === lane.maskId && selected.index === index;
                const fixed = index === 0 || index === lane.keyframes.length - 1;
                return (
                  <button
                    type="button"
                    key={`${lane.maskId}-${index}`}
                    className={`scene-motion-key ${active ? 'selected' : ''} ${fixed ? 'fixed' : ''}`}
                    style={{ left: `${position(frame.t) * 100}%` }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      onSelectKeyframe(selection);
                      onScrub(position(frame.t));
                    }}
                    onPointerMove={(event) => {
                      if (!fixed && event.currentTarget.hasPointerCapture(event.pointerId)) retime(event, selection);
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    title={`${(frame.t / 1000).toFixed(2)} s · ${frame.easing ?? 'linear'}${fixed ? ' · boundary key' : ' · drag to retime'}`}
                  />
                );
              })}
              <span className="scene-motion-playhead" style={{ left: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
