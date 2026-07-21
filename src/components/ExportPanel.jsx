import { EXPORT_PRESETS, resolveExportFormat } from "../lib/videoExport.js";

/** Compact export quality + share row. */
export default function ExportPanel({
  canExport,
  exporting,
  progress,
  downloadUrl,
  downloadName,
  shareUrl,
  error,
  message,
  exportPresetId = "youtube1080",
  onExportPresetChange,
  onExport,
  onCopyShare,
  onCancel,
}) {
  const pct = Math.round((progress || 0) * 100);
  const preset =
    EXPORT_PRESETS.find((p) => p.id === exportPresetId) || EXPORT_PRESETS[1];
  const formatPreview = resolveExportFormat({
    preferMp4: preset.preferMp4,
    forceM4v: preset.forceM4v,
  });

  return (
    <div className="export-panel export-panel-compact">
      <div className="panel-header panel-header-inline">
        <h2 className="panel-title">Export</h2>
        <span className="chip export-format-chip">
          {formatPreview.ext.toUpperCase()}
        </span>
      </div>

      <div className="export-compact-row">
        <select
          className="export-select"
          value={exportPresetId}
          onChange={(e) => onExportPresetChange?.(e.target.value)}
          disabled={exporting}
          aria-label="Export quality"
        >
          {EXPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.width}×{p.height}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-export btn-sm"
          onClick={onExport}
          disabled={!canExport || exporting}
        >
          {exporting ? `${pct}%` : "Go"}
        </button>
      </div>

      {exporting && (
        <div className="export-compact-progress">
          <div className="progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      <div className="export-compact-actions">
        {downloadUrl ? (
          <a className="export-link" href={downloadUrl} download={downloadName || "karaoki.mp4"}>
            ↓ {downloadName || "Download"}
          </a>
        ) : null}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onCopyShare}
          disabled={!shareUrl}
        >
          Share link
        </button>
      </div>

      {message && <div className="alert alert-ok export-alert-sm">{message}</div>}
      {error && <div className="alert alert-error export-alert-sm">{error}</div>}
    </div>
  );
}
