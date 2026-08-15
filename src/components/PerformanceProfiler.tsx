import { useMemo, useState, useSyncExternalStore } from 'react';
import { BarChart3, Download, RotateCcw, X } from 'lucide-react';
import {
  getPerformanceReport,
  getPerformanceRevision,
  resetPerformanceSamples,
  subscribePerformanceReport,
} from '../engine/performanceReport';
import './PerformanceProfiler.css';

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PerformanceProfiler() {
  const [open, setOpen] = useState(false);
  const revision = useSyncExternalStore(subscribePerformanceReport, getPerformanceRevision, getPerformanceRevision);
  const report = useMemo(() => getPerformanceReport(), [revision]);
  const latest = report.latest;

  if (!latest.timestamp) return null;

  if (!open) {
    return (
      <button type="button" className="performance-profiler-chip" onClick={() => setOpen(true)}>
        <BarChart3 size={13} />
        <span>GPU PROFILER</span>
        <code>{latest.gpuSupported && latest.gpuMs != null ? `${latest.gpuMs.toFixed(1)}ms` : 'GPU N/A'}</code>
      </button>
    );
  }

  return (
    <aside className="performance-profiler-panel glass-panel">
      <div className="performance-profiler-head">
        <div>
          <span className="eyebrow">REAL-DEVICE PROFILER</span>
          <strong>{latest.maskCount} mask{latest.maskCount === 1 ? '' : 's'} · {latest.passCount} passes</strong>
        </div>
        <button type="button" className="icon-button subtle" onClick={() => setOpen(false)}><X size={14} /></button>
      </div>

      <div className="performance-profiler-live">
        <Metric label="FPS" value={`${latest.renderFps}`} />
        <Metric label="GPU" value={latest.gpuSupported ? (latest.gpuMs != null ? `${latest.gpuMs.toFixed(2)} ms` : 'warming') : 'unsupported'} />
        <Metric label="Passes" value={`${latest.passCount}`} />
        <Metric label="Scale" value={`${Math.round(latest.renderScale * 100)}%`} />
      </div>

      {latest.disjoint && <p className="performance-profiler-warning">GPU timer reported a disjoint interval. Those timing samples are discarded.</p>}

      <div className="performance-profiler-table">
        <div className="performance-profiler-row header">
          <span>MASKS</span><span>N</span><span>FPS P50</span><span>GPU P50</span><span>GPU P95</span><span>PASS P50</span>
        </div>
        {report.buckets.length ? report.buckets.map((bucket) => (
          <div className="performance-profiler-row" key={bucket.maskCount}>
            <b>{bucket.maskCount}</b>
            <span>{bucket.samples}</span>
            <span>{bucket.fpsP50.toFixed(0)}</span>
            <span>{bucket.gpuP50 != null ? bucket.gpuP50.toFixed(1) : '—'}</span>
            <span>{bucket.gpuP95 != null ? bucket.gpuP95.toFixed(1) : '—'}</span>
            <span>{bucket.passP50.toFixed(0)}</span>
          </div>
        )) : <p className="panel-note">Collecting samples… Keep a scene running for a few seconds, then try 1 / 2 / 3 / 4 visible masks.</p>}
      </div>

      <div className="performance-profiler-actions">
        <button type="button" onClick={() => resetPerformanceSamples()}><RotateCcw size={12} /> Reset samples</button>
        <button
          type="button"
          onClick={() => downloadJson(`vector-vfx-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, getPerformanceReport())}
        ><Download size={12} /> Export JSON</button>
      </div>

      <p className="panel-note">Samples are collected locally about four times per second and bucketed by visible mask count. GPU time uses `EXT_disjoint_timer_query_webgl2` only when the current browser exposes it; unsupported devices show N/A instead of an estimated value.</p>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
