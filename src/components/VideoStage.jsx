import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  groupIntoLines,
  indexForTime,
  lineIndexForWord,
} from "../lib/lyrics.js";
import { lyricStyleVars } from "../lib/lyricStyles.js";
import { stockBackground } from "./UploadPanel.jsx";
import StageBackground from "./StageBackground.jsx";

const VideoStage = forwardRef(function VideoStage(
  {
    bgClips = [],
    isPlaying = false,
    stockImageId,
    words,
    lyrics,
    currentTime,
    isSyncing = false,
    syncIndex = 0,
    fontId = "modern",
    colorId = "sakura",
  },
  ref
) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getStageElement: () => stageRef.current,
    getCanvas: () => canvasRef.current,
  }));

  const lines = useMemo(
    () => groupIntoLines(words || [], lyrics),
    [words, lyrics]
  );

  const PREVIEW_LEAD = 5;
  const firstStart = words?.[0]?.start;
  const tNow = currentTime || 0;
  const beforeLyrics =
    !isSyncing &&
    Number.isFinite(firstStart) &&
    firstStart > 0.15 &&
    tNow < firstStart - 0.02;
  /** Far intro: only ··· */
  const showDots =
    beforeLyrics && Number.isFinite(firstStart) && tNow < firstStart - PREVIEW_LEAD;
  /** Last 5s before first lyric: show first line only (dim) */
  const previewFirstLine =
    beforeLyrics &&
    Number.isFinite(firstStart) &&
    tNow >= firstStart - PREVIEW_LEAD;

  const activeIndex = useMemo(() => {
    if (!words?.length) return -1;
    if (isSyncing) {
      return Math.min(Math.max(syncIndex - 1, -1), words.length - 1);
    }
    return indexForTime(words, currentTime || 0);
  }, [words, currentTime, isSyncing, syncIndex]);

  const focusIndex = isSyncing
    ? Math.min(Math.max(syncIndex, 0), Math.max(0, (words?.length || 1) - 1))
    : activeIndex >= 0
      ? activeIndex
      : previewFirstLine
        ? 0
        : -1;

  const lineIdx = lineIndexForWord(lines, focusIndex);
  const activeLine = lineIdx >= 0 ? lines[lineIdx] : null;
  const previewLine = previewFirstLine && lines[0] ? lines[0] : null;

  // 0–1 progress through the active word (smooth karaoke fill)
  const wordProgress = useMemo(() => {
    if (isSyncing || activeIndex < 0 || !words?.[activeIndex]) return 0;
    const w = words[activeIndex];
    const span = Math.max(0.05, (w.end ?? w.start + 0.3) - w.start);
    const t = currentTime || 0;
    return Math.max(0, Math.min(1, (t - w.start) / span));
  }, [words, activeIndex, currentTime, isSyncing]);

  const styleVars = useMemo(
    () => lyricStyleVars(fontId, colorId),
    [fontId, colorId]
  );
  const fillColor = styleVars["--lyric-highlight-fill"];
  const hasVisual = (bgClips && bgClips.length > 0) || Boolean(stockImageId);

  return (
    <div
      className={`video-stage${isSyncing ? " is-syncing" : ""}`}
      ref={stageRef}
      style={styleVars}
    >
      <StageBackground
        clips={bgClips}
        stockBg={stockBackground(stockImageId)}
        currentTime={currentTime}
        isPlaying={isPlaying}
        className="stage-bg"
      />
      <canvas ref={canvasRef} width={1280} height={720} style={{ display: "none" }} />

      {!hasVisual && (
        <div className="stage-placeholder">
          <div>
            <h3>Your stage</h3>
            <p>Upload images &amp; videos, or pick a stock backdrop to start the show.</p>
          </div>
        </div>
      )}

      {isSyncing && (
        <div className="sync-badge" aria-live="polite">
          Tap sync · word {Math.min(syncIndex + 1, words?.length || 0)} / {words?.length || 0}
        </div>
      )}

      <div className="lyric-bar" aria-live="polite">
        {showDots ? (
          <div className="lyric-line lyric-wait">
            <span className="kw future srt-dots">···</span>
          </div>
        ) : previewFirstLine && previewLine?.words?.length ? (
          <div className="lyric-line lyric-preview">
            {previewLine.words.map((w, i) => (
              <span key={`p-${i}`} className="kw future">
                {w.text}
              </span>
            ))}
          </div>
        ) : isSyncing && activeLine?.words?.length ? (
          <div className="lyric-line">
            {activeLine.words.map((w, i) => {
              const gi = activeLine.startIndex + i;
              let cls = "kw future";
              if (gi < syncIndex) cls = "kw past";
              else if (gi === syncIndex) cls = "kw next";
              return (
                <span key={`w-${gi}`} className={cls}>
                  {w.text}
                </span>
              );
            })}
          </div>
        ) : activeIndex >= 0 && activeLine?.words?.length ? (
          <div className="lyric-line">
            {activeLine.words.map((w, i) => {
              const gi = activeLine.startIndex + i;
              let cls = "kw future";
              let fill = 0;
              if (gi < activeIndex) {
                cls = "kw past";
                fill = 1;
              } else if (gi === activeIndex) {
                cls = "kw active";
                fill = wordProgress;
              }
              return (
                <span
                  key={`w-${gi}`}
                  className={cls}
                  style={
                    cls === "kw active"
                      ? {
                          backgroundImage: `linear-gradient(90deg, ${fillColor} ${fill * 100}%, transparent ${fill * 100}%)`,
                        }
                      : undefined
                  }
                >
                  {w.text}
                </span>
              );
            })}
          </div>
        ) : !words?.length ? (
          <div className="lyric-line">
            <span className="kw future">Add lyrics or upload an SRT</span>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default VideoStage;
