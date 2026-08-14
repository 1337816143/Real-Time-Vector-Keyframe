import { useMemo } from 'react';
import type { MotionTrack } from '../engine/types';
import './motion-timeline.css';

function formatTime(ms: number) {
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

export default function MotionTimeline({
  track,
  progress,
  playing,
  onScrub,
}: {
  track?: MotionTrack;
  progress: number;
  playing: boolean;
  onScrub: (timeMs: number) => void;
}) {
  const duration = Math.max(1, track?.duration ?? 1);
  const playheadMs = Math.min(duration, Math.max(0, progress * duration));
  const ticks = useMemo(() => {
    if (!track) return [];
    const tickCount = duration > 12000 ? 5 : duration > 5000 ? 4 : 3;
    return Array.from({ length: tickCount + 1 }, (_, index) => (duration * index) / tickCount);
  }, [duration, track]);

  if (!track || track.keyframes.length < 2) {
    return (
      <section className="motion-timeline empty">
        <span className="eyebrow">KEYFRAME TIMELINE</span>
        <p>Record a motion performance to generate the first timeline.</p>
      </section>
    );
  }

  return (
    <section className="motion-timeline">
      <div className="timeline-heading">
        <span className="eyebrow">KEYFRAME TIMELINE</span>
        <small>{track.keyframes.length} keys · {formatTime(track.duration)}</small>
      </div>

      <div className="timeline-ruler" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${(tick / duration) * 100}%` }}>
            <i />
            <b>{formatTime(tick)}</b>
          </span>
        ))}
      </div>

      <div className="timeline-track">
        <div className="timeline-progress" style={{ width: `${(playheadMs / duration) * 100}%` }} />
        <div className={`timeline-playhead ${playing ? 'playing' : ''}`} style={{ left: `${(playheadMs / duration) * 100}%` }} />
        {track.keyframes.map((frame, index) => (
          <button
            key={`${frame.t}-${index}`}
            className={`timeline-key key-${frame.maskType}`}
            style={{ left: `${Math.min(100, Math.max(0, (frame.t / duration) * 100))}%` }}
            onClick={() => onScrub(frame.t)}
            title={`${formatTime(frame.t)} · ${frame.maskType} · ${frame.gestureState}`}
            aria-label={`Preview keyframe ${index + 1} at ${formatTime(frame.t)}`}
          />
        ))}
        <input
          className="timeline-scrubber"
          type="range"
          min={0}
          max={duration}
          step={Math.max(1, Math.round(duration / 1000))}
          value={playheadMs}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Scrub motion timeline"
        />
      </div>

      <div className="timeline-status">
        <span>{formatTime(playheadMs)}</span>
        <span>{playing ? 'PLAYING' : 'SCRUB READY'}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </section>
  );
}
