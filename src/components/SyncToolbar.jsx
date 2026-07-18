/** Minimal timing: global offset only (plus optional tap sync collapsed). */
export default function SyncToolbar({
  offsetMs,
  onOffsetChange,
  isSyncing,
  onStartSync,
  onStopSync,
  onTap,
  hasAudio,
  hasWords,
  disabled = false,
}) {
  const nudge = (delta) => {
    onOffsetChange?.(Math.max(-10000, Math.min(10000, (offsetMs || 0) + delta)));
  };

  return (
    <div className="sync-toolbar glass-card">
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOffsetChange?.(0)} disabled={!offsetMs || isSyncing}>
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

      <div className="btn-row" style={{ marginTop: 8 }}>
        {!isSyncing ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onStartSync}
            disabled={!hasAudio || !hasWords || disabled}
          >
            Tap sync
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={onTap}>
              Tap
            </button>
            <button type="button" className="btn btn-sm" onClick={onStopSync}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
