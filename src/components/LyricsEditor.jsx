export default function LyricsEditor({
  lyrics,
  onChange,
  onParseLrc,
  onAutoTime,
  onClear,
  onAutoFromSong,
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
        title={
          !hasAudio
            ? "Upload a song first"
            : "Transcribe vocals and auto-sync word timings"
        }
      >
        {autoBusy
          ? `Generating… ${Math.round((autoProgress || 0) * 100)}%`
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
            {autoStatus || "Working… first run may download the Whisper model."}
          </p>
        </div>
      )}

      <textarea
        className="lyrics-textarea"
        value={lyrics}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`Paste lyrics here, or use Auto lyrics from song…\n\nOne line per phrase works best.\n\nOr paste LRC:\n[00:12.00] Hello world\n[00:15.50] Sing with me`}
        spellCheck={false}
        disabled={autoBusy}
      />

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onParseLrc}
          disabled={autoBusy}
        >
          Parse LRC
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onAutoTime}
          disabled={!lyrics.trim() || !hasDuration || autoBusy}
          title={
            !hasDuration
              ? "Load audio first so we know the duration"
              : "Spread words evenly (rough timing)"
          }
        >
          Auto-time
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
        <strong>Auto lyrics from song</strong> uses free on-device Whisper. It skips silence/intros
        so highlights shouldn’t fire before sound, but sung lyrics are often imperfect. For best
        results: paste official lyrics → <strong>Auto-time</strong>, then nudge with Global offset
        or Tap Sync. LRC files give the cleanest timing.
      </p>
    </div>
  );
}
