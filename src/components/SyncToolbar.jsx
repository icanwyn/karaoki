/**
 * Corrective tap sync (offset removed — edit SRT times in the right panel).
 */
export default function SyncToolbar({
  isSyncing,
  syncMode, // 'corrective' | 'full' | null
  syncIndex,
  totalWords,
  nextWord,
  onStartSync,
  onStopSync,
  onTap,
  onResetToSrt,
  canResetToSrt = false,
  hasAudio,
  hasWords,
  hasAutoTimings = false,
  disabled = false,
}) {
  return (
    <div className={`sync-toolbar glass-card${isSyncing ? " is-active" : ""}`}>
      <div className="panel-header panel-header-inline" style={{ paddingBottom: 8 }}>
        <h2 className="panel-title">Sync</h2>
      </div>

      <div className="btn-row">
        {!isSyncing ? (
          <>
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
            <button
              type="button"
              className="btn btn-sm"
              onClick={onResetToSrt}
              disabled={!canResetToSrt || isSyncing || disabled}
              title="Restore the last uploaded SRT"
            >
              Reset to SRT
            </button>
          </>
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
              Press <kbd>Space</kbd> on the <strong>Next</strong> word as you hear it. That word
              snaps to now; later words shift. Edit precise times in Captions. <kbd>Esc</kbd> /
              Done saves.
            </>
          ) : (
            <>
              Press <kbd>Space</kbd> on each word. Esc stops.
            </>
          )}
        </p>
      )}
    </div>
  );
}
