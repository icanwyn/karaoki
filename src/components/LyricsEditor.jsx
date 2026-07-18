import { useRef } from "react";

export default function LyricsEditor({
  lyrics,
  onChange,
  onParseLrc,
  onAutoTime,
  onClear,
  onAutoFromSong,
  onCancelAuto,
  onLoadSrtFile,
  onDownloadSrt,
  wordCount,
  timedCount,
  hasAudio,
  autoBusy = false,
  autoProgress = 0,
  autoStatus = "",
  hasSrt = false,
}) {
  const srtInputRef = useRef(null);

  return (
    <div className="panel-section">
      <div className="panel-header" style={{ padding: "0 0 10px", border: "none" }}>
        <h2 className="panel-title">Lyrics & captions</h2>
        <span className="chip">
          {timedCount > 0 ? `${timedCount} timed` : `${wordCount} words`}
        </span>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block auto-lyrics-btn"
        onClick={onAutoFromSong}
        disabled={!hasAudio || autoBusy}
        title="Compress audio and get free/server SRT captions with timestamps"
      >
        {autoBusy
          ? `Working… ${Math.round((autoProgress || 0) * 100)}%`
          : "✦ Generate captions (SRT)"}
      </button>

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
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ marginTop: 8 }}
            onClick={onCancelAuto}
          >
            Cancel
          </button>
        </div>
      )}

      <textarea
        className="lyrics-textarea"
        value={lyrics}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`Paste official lyrics OR paste an SRT caption file…

Example SRT:
1
00:00:12,000 --> 00:00:15,500
Hello world this is karaoke

Or plain lyrics, then Sync / Generate captions.`}
        spellCheck={false}
        disabled={autoBusy}
      />

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onAutoTime}
          disabled={!lyrics.trim() || !hasAudio || autoBusy}
          title="Align pasted lyrics using SRT transcription (or parse if text is already SRT)"
        >
          Sync lyrics to audio
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => srtInputRef.current?.click()}
          disabled={autoBusy}
          title="Import timestamps from any free tool that exports SRT/VTT"
        >
          Upload SRT
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onDownloadSrt}
          disabled={!hasSrt && timedCount === 0}
          title="Download current timings as SRT"
        >
          Download SRT
        </button>
        <button type="button" className="btn btn-sm" onClick={onParseLrc} disabled={autoBusy}>
          Parse LRC
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger"
          onClick={onClear}
          disabled={autoBusy}
        >
          Clear
        </button>
      </div>

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

      <p className="hint">
        <strong>New approach — SRT captions (no browser freeze):</strong>
        <br />
        1. Upload song → <strong>Generate captions (SRT)</strong> (server Whisper → timestamps)
        <br />
        2. Or get free SRT elsewhere (CapCut, free Whisper apps, YouTube) →{" "}
        <strong>Upload SRT</strong>
        <br />
        3. Or paste official lyrics → <strong>Sync lyrics to audio</strong>
        <br />
        Audio is compressed before upload (fits free serverless limits).
      </p>
    </div>
  );
}
