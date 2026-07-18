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
            : "Transcribe vocals from the song (may mis-hear sung words)"
        }
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
        </div>
      )}

      <textarea
        className="lyrics-textarea"
        value={lyrics}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`Paste official lyrics here (best results)…\n\nThen click “Sync lyrics to audio”.\n\nOr paste LRC with timestamps:\n[00:12.00] Hello world`}
        spellCheck={false}
        disabled={autoBusy}
      />

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onAutoTime}
          disabled={!lyrics.trim() || !hasAudio || autoBusy}
          title={
            !hasAudio
              ? "Upload a song first"
              : "Align your pasted lyrics to the song (listens to the audio)"
          }
        >
          Sync lyrics to audio
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onParseLrc}
          disabled={autoBusy}
        >
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
        <strong>Why this isn’t like ElevenLabs karaoke:</strong> ElevenLabs <em>creates</em> the
        voice from your text and returns exact word times. Here the song already exists — we must
        <em>listen</em> and map your words onto it.
        <br />
        <strong>Best path:</strong> paste official lyrics → <strong>Sync lyrics to audio</strong>{" "}
        (uses Whisper timings + alignment). LRC is still the gold standard. Refine with Global
        offset or Tap Sync.
      </p>
    </div>
  );
}
