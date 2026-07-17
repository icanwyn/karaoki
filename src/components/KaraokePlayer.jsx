function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function KaraokePlayer({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  disabled,
  activeWordIndex,
  totalWords,
  seekDisabled = false,
}) {
  return (
    <div className="player">
      <div className="player-row">
        <button
          type="button"
          className="play-btn"
          onClick={onTogglePlay}
          disabled={disabled}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>

        <div className="seek-wrap">
          <input
            className="seek"
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(currentTime || 0, duration || 0)}
            onChange={(e) => onSeek?.(Number(e.target.value))}
            disabled={disabled || seekDisabled}
            title={seekDisabled ? "Seek disabled during tap sync" : undefined}
          />
          <div className="time-row">
            <span>{formatTime(currentTime)}</span>
            <span>
              {totalWords > 0
                ? `Word ${activeWordIndex >= 0 ? activeWordIndex + 1 : "—"} / ${totalWords}`
                : "No timings"}
            </span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
