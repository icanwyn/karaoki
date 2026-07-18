/**
 * Offset + corrective tap sync (works with existing auto/SRT timings).
 */
export default function SyncToolbar({
  offsetMs,
  onOffsetChange,
  isSyncing,
  syncMode, // 'corrective' | 'full' | null
  syncIndex,
  totalWords,
  nextWord,
  onStartSync,
  onStopSync,
  onTap,
  hasAudio,
  hasWords,
  hasAutoTimings = false,
  disabled = false,
}) {
  const nudge = (delta) => {
    onOffsetChange?.(Math.max(-10000, Math.min(10000, (offsetMs || 0) + delta)));
  };

  return (
    <div className={`sync-toolbar glass-card${isSyncing ? " is-active" : ""}`}>
      <div className="offset-row">
        <label>
          <span>Offset</span>
          <span className="offset-value">
            {offsetMs > 0 ? `+${offsetMs}` : offsetMs} ms
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
        />
        <div className="btn-row offset-nudge">
          <button type="button" className="btn btn-sm" onClick={() => nudge(-500)} disabled={isSyncing || disabled}>
            −0.5s
          </button>
          <button type="button" className="btn btn-sm" onClick={() => nudge(-100)} disabled={isSyncing || disabled}>
            −0.1s
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onOffsetChange?.(0)}
            disabled={!offsetMs || isSyncing}
          >
            Reset
          </button>
          <button type="button" className="btn btn-sm" onClick={() => nudge(100)} disabled={isSyncing || disabled}>
            +0.1s
          </button>
          <button type="button" className="btn btn-sm" onClick={() => nudge(500)} disabled={isSyncing || disabled}>
            +0.5s
          </button>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 10 }}>
        {!isSyncing ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onStartSync}
            disabled={!hasAudio || !hasWords || disabled}
            title={
              hasAutoTimings
                ? "Corrective tap: keep auto timings, Space shifts from this word forward"
                : "Full tap: stamp every word from the start"
            }
          >
            {hasAutoTimings ? "Tap correct" : "Tap sync"}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={onTap}>
              Tap · Space
            </button>
            <button type="button" className="btn btn-sm" onClick={onStopSync}>
              Done
            </button>
            <span className="chip is-next">
              {Math.min(syncIndex + 1, totalWords)}/{totalWords}
              {nextWord ? ` · ${nextWord}` : ""}
            </span>
          </>
        )}
      </div>

      {isSyncing && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          {syncMode === "corrective" ? (
            <>
              <strong>Corrective mode:</strong> play continues with your SRT. When highlight is
              early/late, press <kbd>Space</kbd> on the word you hear — that word and all after
              shift to match. Esc ends.
            </>
          ) : (
            <>
              Press <kbd>Space</kbd> on each word as you hear it. Esc stops.
            </>
          )}
        </p>
      )}
      {!isSyncing && hasAutoTimings && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          Tap correct works <em>with</em> auto/SRT timing — it does not wipe it.
        </p>
      )}
    </div>
  );
}
