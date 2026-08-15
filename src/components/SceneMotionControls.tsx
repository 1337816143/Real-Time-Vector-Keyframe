import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio, Repeat2, Rewind, RotateCcw, Square, Trash2 } from 'lucide-react';
import { sceneMotionRecorder, type SceneMotionTrack } from '../engine/sceneMotion';
import { getSceneState, replaceScene, setSceneEnabled } from '../engine/sceneStore';
import type { PlaybackMode } from '../engine/types';
import SceneMotionTimeline from './SceneMotionTimeline';
import './SceneMotionControls.css';

export default function SceneMotionControls() {
  const [recording, setRecording] = useState(sceneMotionRecorder.isRecording());
  const [playing, setPlaying] = useState(sceneMotionRecorder.isPlaying());
  const [mode, setMode] = useState<PlaybackMode>('loop');
  const [track, setTrack] = useState<SceneMotionTrack | undefined>(() => sceneMotionRecorder.getTrack());
  const [progress, setProgress] = useState(0);
  const wasPlayingRef = useRef(playing);

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

  const startRecording = () => {
    if (!getSceneState().enabled) setSceneEnabled(true);
    sceneMotionRecorder.start(getSceneState().scene);
    setTrack(undefined);
    setProgress(0);
    setRecording(true);
    setPlaying(false);
  };

  const stopRecording = () => {
    const next = sceneMotionRecorder.stop(getSceneState().scene);
    setTrack(next);
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
    setRecording(false);
    setPlaying(false);
    setProgress(0);
    wasPlayingRef.current = false;
  };

  const scrub = (nextProgress: number) => {
    if (!track) return;
    sceneMotionRecorder.stopPlayback();
    const sampled = sceneMotionRecorder.sampleAt(track.duration * Math.min(1, Math.max(0, nextProgress)));
    if (sampled) replaceScene(sampled, true);
    setPlaying(false);
    wasPlayingRef.current = false;
    setProgress(nextProgress);
  };

  const currentTrack = track ?? sceneMotionRecorder.getTrack();
  const keyCount = currentTrack?.lanes.reduce((sum, lane) => sum + lane.keyframes.length, 0) ?? 0;

  return (
    <section className="scene-motion-controls">
      <div className="scene-motion-head">
        <div>
          <span className="eyebrow">SCENE MOTION</span>
          <strong>{recording ? 'Capturing multi-mask lanes' : playing ? `Playing · ${mode}` : 'Identity-preserving keyframes'}</strong>
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

          <SceneMotionTimeline track={currentTrack} progress={progress} onScrub={scrub} />

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

      <p className="panel-note">Each mask ID owns a separate sparse lane. Matching Custom Bezier topology interpolates anchor and handle coordinates; topology changes switch safely at the nearest keyframe. Scene structure is treated as fixed while a track is recording or playing.</p>
    </section>
  );
}
