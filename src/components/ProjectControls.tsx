import { Download, FileJson, Upload } from 'lucide-react';
import './project-controls.css';

export default function ProjectControls({
  message,
  onExport,
  onImport,
}: {
  message: string;
  onExport: () => void;
  onImport: (file?: File) => void | Promise<void>;
}) {
  return (
    <section className="project-controls">
      <div className="project-heading">
        <span className="eyebrow">PROJECT JSON</span>
        <FileJson size={15} />
      </div>
      <button className="secondary-button" onClick={onExport}>
        <Download size={16} /> Export project
      </button>
      <label className="upload-row project-import">
        <Upload size={16} />
        <span>
          <strong>Import project</strong>
          <small>.json · validated locally</small>
        </span>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void onImport(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      {message && <p className="project-message" role="status">{message}</p>}
      <p className="panel-note">
        Project JSON stores mask transform, Effect Stack, Temporal FX, Carousel/transition settings and Motion Track. Uploaded image/video bytes stay local and are never embedded in the JSON.
      </p>
    </section>
  );
}
