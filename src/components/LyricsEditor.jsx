import { useRef } from "react";

/** Minimal caption tools — glass studio aesthetic */
export default function LyricsEditor({
  onAutoFromSong,
  onCancelAuto,
  onLoadSrtFile,
  onDownloadSrt,
  onOpenEditor,
  onClear,
  timedCount,
  hasAudio,
  hasReader,
  autoBusy = false,
  autoProgress = 0,
  autoStatus = "",
}) {
  const srtInputRef = useRef(null);

  return (
    <div className="panel-section panel-section-tight">
      <div className="panel-header" style={{ padding: "0 0 12px", border: "none" }}>
        <h2 className="panel-title">Captions</h2>
        {timedCount > 0 && <span className="chip">{timedCount} words</span>}
      </div>

      <div className="stack-actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => srtInputRef.current?.click()}
          disabled={autoBusy}
        >
          Upload SRT
        </button>
        <button
          type="button"
          className="btn btn-block"
          onClick={onAutoFromSong}
          disabled={!hasAudio || autoBusy}
        >
          {autoBusy
            ? `Working… ${Math.round((autoProgress || 0) * 100)}%`
            : "Generate captions"}
        </button>
      </div>

      {autoBusy && (
        <div className="auto-progress" role="status">
          <div className="auto-progress-bar">
            <div
              className="auto-progress-fill"
              style={{ width: `${Math.round((autoProgress || 0) * 100)}%` }}
            />
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {autoStatus || "Working…"}
          </p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancelAuto}>
            Cancel
          </button>
        </div>
      )}

      {hasReader && (
        <div className="stack-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={onOpenEditor}>
            Edit SRT
          </button>
          <button type="button" className="btn btn-sm" onClick={onDownloadSrt}>
            Download
          </button>
          <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onClear}>
            Clear
          </button>
        </div>
      )}

      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,.vtt,text/plain,text/vtt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onLoadSrtFile?.(f);
        }}
      />
    </div>
  );
}
