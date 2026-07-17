export default function ExportPanel({
  canExport,
  exporting,
  progress,
  downloadUrl,
  downloadName,
  shareUrl,
  error,
  message,
  onExport,
  onCopyShare,
  onCancel,
}) {
  const pct = Math.round((progress || 0) * 100);

  return (
    <div className="export-panel">
      <p className="section-label">Export & share</p>

      <button
        type="button"
        className="btn btn-export btn-block"
        onClick={onExport}
        disabled={!canExport || exporting}
      >
        {exporting ? `Exporting… ${pct}%` : "Export video (WebM)"}
      </button>

      {exporting && (
        <>
          <div className="progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel export
          </button>
        </>
      )}

      {downloadUrl && (
        <a className="export-link" href={downloadUrl} download={downloadName || "karaoki.webm"}>
          ↓ Download {downloadName || "karaoki.webm"}
        </a>
      )}

      <button
        type="button"
        className="btn btn-sm btn-block"
        onClick={onCopyShare}
        disabled={!shareUrl}
      >
        Copy shareable project link
      </button>

      {message && <div className="alert alert-ok">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <p className="hint">
        Export records the stage + audio into a WebM (VP8/VP9) you can re-upload to YouTube.
        Share links store title, lyrics, and timings only — re-upload media after opening a link.
      </p>
    </div>
  );
}
