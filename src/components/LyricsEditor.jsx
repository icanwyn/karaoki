export default function LyricsEditor({
  lyrics,
  onChange,
  onParseLrc,
  onAutoTime,
  onClear,
  onAutoFromSong,
  onCancelAuto,
  wordCount,
  timedCount,
  hasDuration,
  hasAudio,
  autoBusy = false,
  autoProgress = 0,
  autoStatus = "",
}) {
  return (
    <div className="panel-section">
      <div className="panel-header" style={{ padding: "0 0 10px", border: "none" }}>
        <h2 className="panel-title">Lyrics</h2>
        <span className="chip">
          {timedCount > 0 ? `${timedCount} timed` : `${wordCount} words`}
        </span>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block auto-lyrics-btn"
        onClick={onAutoFromSong}
        disabled={!hasAudio || autoBusy}
        title="Server Whisper only — does not freeze the browser"
      >
        {autoBusy
          ? `Working… ${Math.round((autoProgress || 0) * 100)}%`
          : "✦ Auto lyrics from song"}
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
        placeholder={`Paste official lyrics here…\n\nThen click “Sync lyrics to audio”.\n\nThis stays responsive — no heavy on-device AI.`}
        spellCheck={false}
        disabled={autoBusy}
      />

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onAutoTime}
          disabled={!lyrics.trim() || !hasAudio || autoBusy}
          title="Recommended: align your lyrics using server Whisper or fast energy analysis"
        >
          Sync lyrics to audio
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

      <p className="hint">
        <strong>Recommended:</strong> paste official lyrics → <strong>Sync lyrics to audio</strong>.
        Uses the server (or a fast energy map) — <em>not</em> in-browser Whisper, so the tab
        should stay responsive. LRC files are still the most accurate. Refine with Global offset
        or Tap Sync.
      </p>
    </div>
  );
}
