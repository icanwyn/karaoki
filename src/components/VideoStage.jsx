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
    /** When true, highlight by syncIndex instead of playhead (prevents race/glitch). */
    isSyncing = false,
    /** Index of the next word waiting to be tapped (0-based). */
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

  // During tap-sync: freeze to the line of the next word; never chase provisional times.
  // During play: normal playhead index.
  const activeIndex = useMemo(() => {
    if (!words?.length) return -1;
    if (isSyncing) {
      // Last confirmed word is syncIndex - 1; show that as active (or -1 at start).
      return Math.min(Math.max(syncIndex - 1, -1), words.length - 1);
    }
    return indexForTime(words, currentTime || 0);
  }, [words, currentTime, isSyncing, syncIndex]);

  const focusIndex = isSyncing
    ? Math.min(Math.max(syncIndex, 0), Math.max(0, (words?.length || 1) - 1))
    : activeIndex;

  const lineIdx = lineIndexForWord(lines, focusIndex < 0 ? 0 : focusIndex);
  const activeLine = lines[lineIdx];

  const bgStyle = imageUrl
    ? { backgroundImage: `url(${imageUrl})` }
    : { backgroundImage: stockBackground(stockImageId) };

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
        {activeLine?.words?.length ? (
          <div className="lyric-line">
            {activeLine.words.map((w, i) => {
              const gi = activeLine.startIndex + i;
              let cls = "kw future";
              if (isSyncing) {
                if (gi < syncIndex) cls = "kw past";
                else if (gi === syncIndex) cls = "kw next";
                else cls = "kw future";
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
