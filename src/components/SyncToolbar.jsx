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
}) {
  return (
    <div className={`sync-toolbar ${isSyncing ? "is-active" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontFamily: "var(--display)", fontSize: "0.9rem" }}>Tap Sync</strong>
        {isSyncing && (
          <span className="chip is-next">
            {Math.min(syncIndex + 1, totalWords)} / {totalWords}
          </span>
        )}
      </div>

      <p className="hint" style={{ margin: 0 }}>
        Start sync, play the track, then press <kbd>Space</kbd> (or Tap) on each word as you hear
        it. Press <kbd>Esc</kbd> to stop.
      </p>

      <div className="btn-row">
        {!isSyncing ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onStartSync}
            disabled={!hasAudio || !hasWords}
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
          disabled={!hasWords}
        >
          Reset timings
        </button>
      </div>

      {isSyncing && nextWord && (
        <div className="word-preview">
          <span className="chip is-next">Next: {nextWord}</span>
        </div>
      )}

      <div className="offset-row">
        <label>
          <span>Global offset</span>
          <span>{offsetMs > 0 ? `+${offsetMs}` : offsetMs} ms</span>
        </label>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={10}
          value={offsetMs}
          onChange={(e) => onOffsetChange?.(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
