import { EXPORT_PRESETS, resolveExportFormat } from "../lib/videoExport.js";

const FADE_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 0.5, label: "0.5s" },
  { value: 1, label: "1s" },
  { value: 1.5, label: "1.5s" },
  { value: 2, label: "2s" },
  { value: 3, label: "3s" },
];

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
  fadeInSec = 1,
  fadeOutSec = 1,
  onFadeInChange,
  onFadeOutChange,
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

      <div className="export-fade-row">
        <label className="export-fade-label">
          <span>Fade in</span>
          <select
            className="export-select export-select-sm"
            value={fadeInSec}
            onChange={(e) => onFadeInChange?.(Number(e.target.value))}
            disabled={exporting}
            aria-label="Fade in duration"
          >
            {FADE_OPTIONS.map((o) => (
              <option key={`in-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="export-fade-label">
          <span>Fade out</span>
          <select
            className="export-select export-select-sm"
            value={fadeOutSec}
            onChange={(e) => onFadeOutChange?.(Number(e.target.value))}
            disabled={exporting}
            aria-label="Fade out duration"
          >
            {FADE_OPTIONS.map((o) => (
              <option key={`out-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
