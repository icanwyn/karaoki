export default function SyncToolbar({
  isSyncing,
  syncIndex,
  totalWords,
  nextWord,
  offsetMs,
  onOffsetChange,
  onStartSync,
  onStopSync,
  onResetTimings,
  onTap,
  hasAudio,
  hasWords,
  disabled = false,
}) {
  const nudge = (delta) => {
    const next = Math.max(-10000, Math.min(10000, (offsetMs || 0) + delta));
    onOffsetChange?.(next);
  };

  return (
    <div className={`sync-toolbar ${isSyncing ? "is-active" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontFamily: "var(--display)", fontSize: "0.9rem" }}>Timing tools</strong>
        {isSyncing && (
          <span className="chip is-next">
            {Math.min(syncIndex + 1, totalWords)} / {totalWords}
          </span>
        )}
      </div>

      <div className="offset-panel">
        <div className="offset-row">
          <label>
            <span>Global offset</span>
            <span className="offset-value">
              {offsetMs > 0 ? `+${offsetMs}` : offsetMs} ms
              <span className="offset-sec">
                {" "}
                ({offsetMs >= 0 ? "+" : ""}
                {(offsetMs / 1000).toFixed(2)}s)
              </span>
            </span>
          </label>
          <input
            type="range"
            min={-10000}
            max={10000}
            step={50}
            value={offsetMs}
            onChange={(e) => onOffsetChange?.(Number(e.target.value))}
            disabled={isSyncing}
            aria-label="Global lyric timing offset in milliseconds"
          />
          <div className="offset-scale">
            <span>Earlier (−)</span>
            <span>Later (+)</span>
          </div>
        </div>

        <div className="btn-row offset-nudge">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => nudge(-500)}
            disabled={isSyncing || disabled}
            title="Highlights 0.5s earlier"
          >
            −0.5s
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => nudge(-100)}
            disabled={isSyncing || disabled}
            title="Highlights 0.1s earlier"
          >
            −0.1s
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onOffsetChange?.(0)}
            disabled={isSyncing || disabled || !offsetMs}
            title="Reset offset to 0"
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => nudge(100)}
            disabled={isSyncing || disabled}
            title="Highlights 0.1s later"
          >
            +0.1s
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => nudge(500)}
            disabled={isSyncing || disabled}
            title="Highlights 0.5s later"
          >
            +0.5s
          </button>
        </div>

        <p className="hint offset-help">
          <strong>What this does:</strong> slides <em>every</em> word earlier or later by the same
          amount — like sliding the lyric track on a timeline. It does not re-detect words.
          <br />
          <strong>Highlights too soon?</strong> push offset <em>positive</em> (Later +).
          <br />
          <strong>Highlights too late?</strong> push offset <em>negative</em> (Earlier −).
          <br />
          Use this when auto-sync is roughly right but consistently early/late. If words are
          scrambled or spaced wrong, use Tap Sync instead.
        </p>
      </div>

      <p className="hint" style={{ margin: "8px 0 0" }}>
        <strong>Tap Sync</strong> — press <kbd>Space</kbd> on each word as you hear it to rebuild
        timings from scratch. <kbd>Esc</kbd> stops.
      </p>

      <div className="btn-row">
        {!isSyncing ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onStartSync}
            disabled={!hasAudio || !hasWords || disabled}
          >
            Start sync
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={onTap}>
              Tap word
            </button>
            <button type="button" className="btn btn-sm" onClick={onStopSync}>
              Stop
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onResetTimings}
          disabled={!hasWords || disabled || isSyncing}
        >
          Reset timings
        </button>
      </div>

      {isSyncing && nextWord && (
        <div className="word-preview">
          <span className="chip is-next">Next: {nextWord}</span>
        </div>
      )}
    </div>
  );
}
