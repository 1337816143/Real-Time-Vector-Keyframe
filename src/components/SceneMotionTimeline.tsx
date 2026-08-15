import type { PointerEvent } from 'react';
import type { SceneMotionTrack } from '../engine/sceneMotion';
import './SceneMotionTimeline.css';

interface Props {
  track: SceneMotionTrack;
  progress: number;
  onScrub: (progress: number) => void;
}

export default function SceneMotionTimeline({ track, progress, onScrub }: Props) {
  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onScrub(next);
  };

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
                if (event.buttons === 1) scrub(event);
              }}
            >
              <i className="scene-motion-progress" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
              {lane.keyframes.map((frame, index) => (
                <button
                  type="button"
                  key={`${lane.maskId}-${frame.t}-${index}`}
                  className="scene-motion-key"
                  style={{ left: `${track.duration > 0 ? frame.t / track.duration * 100 : 0}%` }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onScrub(track.duration > 0 ? frame.t / track.duration : 0);
                  }}
                  title={`${(frame.t / 1000).toFixed(2)} s`}
                />
              ))}
              <span className="scene-motion-playhead" style={{ left: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
