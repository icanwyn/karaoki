export default function LyricsEditor({
  lyrics,
  onChange,
  onParseLrc,
  onAutoTime,
  onClear,
  wordCount,
  timedCount,
  hasDuration,
}) {
  return (
    <div className="panel-section">
      <div className="panel-header" style={{ padding: "0 0 10px", border: "none" }}>
        <h2 className="panel-title">Lyrics</h2>
        <span className="chip">
          {timedCount > 0 ? `${timedCount} timed` : `${wordCount} words`}
        </span>
      </div>

      <textarea
        className="lyrics-textarea"
        value={lyrics}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`Paste lyrics here…\n\nOne line per phrase works best.\n\nOr paste LRC:\n[00:12.00] Hello world\n[00:15.50] Sing with me`}
        spellCheck={false}
      />

      <div className="btn-row">
        <button type="button" className="btn btn-sm btn-primary" onClick={onParseLrc}>
          Parse LRC
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onAutoTime}
          disabled={!lyrics.trim() || !hasDuration}
          title={!hasDuration ? "Load audio first so we know the duration" : "Spread words evenly"}
        >
          Auto-time
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onClear}>
          Clear
        </button>
      </div>

      <p className="hint">
        Plain text: each line becomes a phrase on stage. LRC timestamps (
        <code>[mm:ss.xx]</code>) are split into words automatically. Use Auto-time for a quick
        first pass, then refine with Tap Sync.
      </p>
    </div>
  );
}
