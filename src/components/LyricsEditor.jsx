import { useRef } from "react";

/** Minimal caption tools — SRT only (no Whisper). */
export default function LyricsEditor({
  onLoadSrtFile,
  onDownloadSrt,
  onOpenEditor,
  onClear,
  timedCount,
  hasReader,
}) {
  const srtInputRef = useRef(null);

  return (
    <div className="panel-section panel-section-tight">
      <div className="panel-header" style={{ padding: "0 0 12px", border: "none" }}>
        <h2 className="panel-title">Captions</h2>
        {timedCount > 0 && <span className="chip">{timedCount} words</span>}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={() => srtInputRef.current?.click()}
      >
        Upload SRT
      </button>

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
