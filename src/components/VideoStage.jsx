import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  groupIntoLines,
  indexForTime,
  lineIndexForWord,
} from "../lib/lyrics.js";
import { stockBackground } from "./UploadPanel.jsx";

const VideoStage = forwardRef(function VideoStage(
  {
    imageUrl,
    stockImageId,
    words,
    lyrics,
    currentTime,
    isSyncing = false,
    syncIndex = 0,
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

  const firstStart = words?.[0]?.start;
  const beforeLyrics =
    !isSyncing &&
    Number.isFinite(firstStart) &&
    firstStart > 0.15 &&
    (currentTime || 0) < firstStart - 0.02;

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
      : 0;

  const lineIdx = lineIndexForWord(lines, focusIndex);
  const activeLine = lines[lineIdx];

  const bgStyle = imageUrl
    ? { backgroundImage: `url(${imageUrl})` }
    : { backgroundImage: stockBackground(stockImageId) };

  const waitSec =
    beforeLyrics && Number.isFinite(firstStart)
      ? Math.max(0, firstStart - (currentTime || 0))
      : 0;

  return (
    <div className={`video-stage${isSyncing ? " is-syncing" : ""}`} ref={stageRef}>
      <div className="stage-bg" style={bgStyle} />
      <canvas ref={canvasRef} width={1280} height={720} style={{ display: "none" }} />

      {!imageUrl && !stockImageId && (
        <div className="stage-placeholder">
          <div>
            <h3>Your stage</h3>
            <p>Upload a background image or pick a stock backdrop to start the show.</p>
          </div>
        </div>
      )}

      {isSyncing && (
        <div className="sync-badge" aria-live="polite">
          Tap sync · word {Math.min(syncIndex + 1, words?.length || 0)} / {words?.length || 0}
        </div>
      )}

      <div className="lyric-bar" aria-live="polite">
        {beforeLyrics ? (
          <div className="lyric-line lyric-wait">
            <span className="kw future">
              Lyrics start in {waitSec.toFixed(1)}s…
            </span>
          </div>
        ) : activeLine?.words?.length ? (
          <div className="lyric-line">
            {activeLine.words.map((w, i) => {
              const gi = activeLine.startIndex + i;
              let cls = "kw future";
              if (isSyncing) {
                if (gi < syncIndex) cls = "kw past";
                else if (gi === syncIndex) cls = "kw next";
                else cls = "kw future";
              } else if (activeIndex < 0) {
                cls = "kw future";
              } else if (gi < activeIndex) {
                cls = "kw past";
              } else if (gi === activeIndex) {
                cls = "kw active";
              }
              return (
                <span key={`w-${gi}`} className={cls}>
                  {w.text}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="lyric-line">
            <span className="kw future">
              {words?.length
                ? isSyncing
                  ? "Tap Space on each word as you hear it"
                  : "Ready when you are…"
                : "Add lyrics or auto-generate from your song"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default VideoStage;
