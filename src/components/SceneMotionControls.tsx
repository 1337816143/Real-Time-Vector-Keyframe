import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio, Repeat2, Rewind, RotateCcw, Save, Square, Trash2 } from 'lucide-react';
import {
  sceneMotionRecorder,
  type SceneMotionEasing,
  type SceneMotionPlaybackRange,
  type SceneMotionTrack,
} from '../engine/sceneMotion';
import { subscribeSceneMotionTrack } from '../engine/sceneMotionEvents';
import { getSceneState, replaceScene, setSceneEnabled } from '../engine/sceneStore';
import type { PlaybackMode } from '../engine/types';
import SceneMotionTimeline, { type SceneMotionKeySelection } from './SceneMotionTimeline';
import './SceneMotionControls.css';

const EASINGS: { id: SceneMotionEasing; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In-Out' },
];

export default function SceneMotionControls({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [recording, setRecording] = useState(sceneMotionRecorder.isRecording());
  const [playing, setPlaying] = useState(sceneMotionRecorder.isPlaying());
  const [mode, setMode] = useState<PlaybackMode>('loop');
  const [track, setTrack] = useState<SceneMotionTrack | undefined>(() => sceneMotionRecorder.getTrack());
  const [progress, setProgress] = useState(0);
  const [selectedKey, setSelectedKey] = useState<SceneMotionKeySelection>();
  const [range, setRange] = useState<SceneMotionPlaybackRange>(() => sceneMotionRecorder.getPlaybackRange());
  const wasPlayingRef = useRef(playing);

  useEffect(() => {
    onBusyChange?.(recording || playing);
  }, [onBusyChange, playing, recording]);

  useEffect(() => subscribeSceneMotionTrack(() => {
    setTrack(sceneMotionRecorder.getTrack());
    setRecording(sceneMotionRecorder.isRecording());
    setPlaying(sceneMotionRecorder.isPlaying());
    setProgress(0);
    setSelectedKey(undefined);
    setRange(sceneMotionRecorder.getPlaybackRange());
    wasPlayingRef.current = sceneMotionRecorder.isPlaying();
  }), []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextRecording = sceneMotionRecorder.isRecording();
      const nextPlaying = sceneMotionRecorder.isPlaying();
      if (wasPlayingRef.current && !nextPlaying) {
        replaceScene(getSceneState().scene, true);
      }
      wasPlayingRef.current = nextPlaying;
      setRecording(nextRecording);
      setPlaying(nextPlaying);
      setProgress(nextPlaying ? sceneMotionRecorder.getProgress() : (current) => current);
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  const refreshTrack = () => {
    setTrack(sceneMotionRecorder.getTrack());
    setRange(sceneMotionRecorder.getPlaybackRange());
  };

  const startRecording = () => {
    if (!getSceneState().enabled) setSceneEnabled(true);
    sceneMotionRecorder.start(getSceneState().scene);
    setTrack(undefined);
    setSelectedKey(undefined);
    setRange({ inMs: 0, outMs: 0 });
    setProgress(0);
    setRecording(true);
    setPlaying(false);
  };

  const stopRecording = () => {
    const next = sceneMotionRecorder.stop(getSceneState().scene);
    setTrack(next);
    setRange(sceneMotionRecorder.getPlaybackRange());
    setRecording(false);
    setProgress(0);
  };

  const play = (nextMode: PlaybackMode) => {
    if (!getSceneState().enabled) setSceneEnabled(true);
    setMode(nextMode);
    if (sceneMotionRecorder.play(nextMode)) {
      setPlaying(true);
      wasPlayingRef.current = true;
    }
  };

  const stopPlayback = () => {
    sceneMotionRecorder.stopPlayback();
    replaceScene(getSceneState().scene, true);
    setPlaying(false);
    wasPlayingRef.current = false;
  };

  const clear = () => {
    sceneMotionRecorder.clear();
    setTrack(undefined);
    setSelectedKey(undefined);
    setRange({ inMs: 0, outMs: 0 });
    setRecording(false);
    setPlaying(false);
    setProgress(0);
    wasPlayingRef.current = false;
  };

  const currentTrack = track ?? sceneMotionRecorder.getTrack();

  const scrub = (nextProgress: number) => {
    if (!currentTrack) return;
    sceneMotionRecorder.stopPlayback();
    const normalized = Math.min(1, Math.max(0, nextProgress));
    const sampled = sceneMotionRecorder.sampleAt(currentTrack.duration * normalized);
    if (sampled) replaceScene(sampled, true);
    setPlaying(false);
    wasPlayingRef.current = false;
    setProgress(normalized);
  };

  const retime = (selection: SceneMotionKeySelection, timeMs: number) => {
    if (!currentTrack || playing) return;
    if (sceneMotionRecorder.retimeKeyframe(selection.maskId, selection.index, timeMs)) {
      refreshTrack();
      const nextTrack = sceneMotionRecorder.getTrack();
      const nextFrame = nextTrack?.lanes.find((lane) => lane.maskId === selection.maskId)?.keyframes[selection.index];
      if (nextTrack && nextFrame) setProgress(nextFrame.t / nextTrack.duration);
    }
  };

  const setPlaybackRange = (next: SceneMotionPlaybackRange) => {
    if (!currentTrack || playing) return;
    sceneMotionRecorder.setPlaybackRange(next.inMs, next.outMs);
    setRange(sceneMotionRecorder.getPlaybackRange());
  };

  const selectedLane = selectedKey && currentTrack
    ? currentTrack.lanes.find((lane) => lane.maskId === selectedKey.maskId)
    : undefined;
  const selectedFrame = selectedKey && selectedLane ? selectedLane.keyframes[selectedKey.index] : undefined;
  const selectedSceneNode = selectedKey
    ? getSceneState().scene.nodes.find((node) => node.id === selectedKey.maskId)
    : undefined;
  const selectedBoundary = Boolean(selectedFrame && selectedLane && (
    selectedKey?.index === 0 || selectedKey?.index === selectedLane.keyframes.length - 1
  ));

  const updateSelectedKey = () => {
    if (!selectedKey || !selectedSceneNode) return;
    if (sceneMotionRecorder.updateKeyframe(selectedKey.maskId, selectedKey.index, selectedSceneNode)) refreshTrack();
  };

  const deleteSelectedKey = () => {
    if (!selectedKey) return;
    if (sceneMotionRecorder.deleteKeyframe(selectedKey.maskId, selectedKey.index)) {
      setSelectedKey(undefined);
      refreshTrack();
    }
  };

  const setSelectedEasing = (easing: SceneMotionEasing) => {
    if (!selectedKey) return;
    if (sceneMotionRecorder.setKeyframeEasing(selectedKey.maskId, selectedKey.index, easing)) refreshTrack();
  };

  const keyCount = currentTrack?.lanes.reduce((sum, lane) => sum + lane.keyframes.length, 0) ?? 0;

  return (
    <section className="scene-motion-controls">
      <div className="scene-motion-head">
        <div>
          <span className="eyebrow">SCENE MOTION</span>
          <strong>{recording ? 'Capturing multi-mask lanes' : playing ? `Playing · ${mode}` : 'Editable identity-preserving keyframes'}</strong>
        </div>
        <span>{currentTrack ? `${currentTrack.lanes.length} lanes · ${keyCount} keys` : 'No track'}</span>
      </div>

      {!recording ? (
        <button type="button" className="scene-motion-record" onClick={startRecording} disabled={playing}>
          <Radio size={14} /> Record Scene Motion
        </button>
      ) : (
        <button type="button" className="scene-motion-record active" onClick={stopRecording}>
          <Square size={13} fill="currentColor" /> Stop Capture
        </button>
      )}

      {currentTrack && !recording && (
        <>
          <div className="scene-motion-metrics">
            <span><b>Duration</b><code>{(currentTrack.duration / 1000).toFixed(2)} s</code></span>
            <span><b>Progress</b><code>{Math.round(progress * 100)}%</code></span>
          </div>

          <SceneMotionTimeline
            track={currentTrack}
            progress={progress}
            range={range.outMs > 0 ? range : { inMs: 0, outMs: currentTrack.duration }}
            selected={selectedKey}
            onScrub={scrub}
            onSelectKeyframe={setSelectedKey}
            onRetimeKeyframe={retime}
          />

          <div className="scene-motion-range-editor">
            <div className="scene-motion-range-head">
              <span>Playback range</span>
              <code>{(range.inMs / 1000).toFixed(2)}s → {((range.outMs || currentTrack.duration) / 1000).toFixed(2)}s</code>
            </div>
            <label>
              <span>IN</span>
              <input
                type="range"
                min={0}
                max={currentTrack.duration}
                step={10}
                value={range.inMs}
                disabled={playing}
                onChange={(event) => setPlaybackRange({ inMs: Number(event.target.value), outMs: range.outMs || currentTrack.duration })}
              />
            </label>
            <label>
              <span>OUT</span>
              <input
                type="range"
                min={0}
                max={currentTrack.duration}
                step={10}
                value={range.outMs || currentTrack.duration}
                disabled={playing}
                onChange={(event) => setPlaybackRange({ inMs: range.inMs, outMs: Number(event.target.value) })}
              />
            </label>
          </div>

          {selectedKey && selectedFrame && selectedLane && (
            <div className="scene-motion-key-inspector">
              <div className="scene-motion-key-inspector-head">
                <span><b>{selectedLane.name}</b><small>Key {selectedKey.index + 1} · {(selectedFrame.t / 1000).toFixed(3)} s</small></span>
                <code>{selectedBoundary ? 'BOUNDARY' : 'EDITABLE'}</code>
              </div>
              <label>
                <span>Segment easing</span>
                <select
                  value={selectedFrame.easing ?? 'linear'}
                  disabled={playing}
                  onChange={(event) => setSelectedEasing(event.target.value as SceneMotionEasing)}
                >
                  {EASINGS.map((easing) => <option key={easing.id} value={easing.id}>{easing.label}</option>)}
                </select>
              </label>
              {!selectedBoundary && (
                <label>
                  <span>Key time</span>
                  <input
                    type="range"
                    min={selectedLane.keyframes[selectedKey.index - 1].t + 1}
                    max={selectedLane.keyframes[selectedKey.index + 1].t - 1}
                    step={1}
                    value={selectedFrame.t}
                    disabled={playing}
                    onChange={(event) => retime(selectedKey, Number(event.target.value))}
                  />
                </label>
              )}
              <div className="scene-motion-key-actions">
                <button type="button" disabled={playing || !selectedSceneNode} onClick={updateSelectedKey}><Save size={12} /> Update from current scene</button>
                <button type="button" className="danger" disabled={playing || selectedBoundary} onClick={deleteSelectedKey}><Trash2 size={12} /> Delete key</button>
              </div>
            </div>
          )}

          <div className="scene-motion-playback">
            <button type="button" className={playing && mode === 'once' ? 'selected' : ''} onClick={() => play('once')}><Play size={12} /> Once</button>
            <button type="button" className={playing && mode === 'loop' ? 'selected' : ''} onClick={() => play('loop')}><Repeat2 size={12} /> Loop</button>
            <button type="button" className={playing && mode === 'reverse' ? 'selected' : ''} onClick={() => play('reverse')}><Rewind size={12} /> Reverse</button>
            <button type="button" className={playing && mode === 'pingpong' ? 'selected' : ''} onClick={() => play('pingpong')}><RotateCcw size={12} /> Ping Pong</button>
          </div>

          <div className="scene-motion-actions">
            {playing && <button type="button" onClick={stopPlayback}><Pause size={13} /> Stop playback</button>}
            <button type="button" onClick={clear}><Trash2 size={13} /> Clear track</button>
          </div>
        </>
      )}

      <p className="panel-note">Select a key to edit it. Interior keys can be dragged horizontally to retime them; boundary keys keep the lane duration stable. Easing belongs to the segment leaving a key, and In/Out limits are respected by Once, Loop, Reverse and Ping Pong playback.</p>
    </section>
  );
}
