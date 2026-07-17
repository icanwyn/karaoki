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
        Refine auto timings: press <kbd>Space</kbd> (or Tap) on each word as you hear it. The stage
        stays locked to the current line — no racing words. <kbd>Esc</kbd> stops.
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
          disabled={isSyncing}
        />
      </div>
    </div>
  );
}
