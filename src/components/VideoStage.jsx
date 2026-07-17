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
    offsetSec = 0,
  },
  ref
) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getStageElement: () => stageRef.current,
    getCanvas: () => canvasRef.current,
  }));

  const t = (currentTime || 0) + (offsetSec || 0);
  const activeIndex = useMemo(() => indexForTime(words || [], t), [words, t]);
  const lines = useMemo(() => groupIntoLines(words || [], lyrics), [words, lyrics]);
  const lineIdx = lineIndexForWord(lines, activeIndex);
  const activeLine = lines[lineIdx];

  const bgStyle = imageUrl
    ? { backgroundImage: `url(${imageUrl})` }
    : { backgroundImage: stockBackground(stockImageId) };

  return (
    <div className="video-stage" ref={stageRef}>
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

      <div className="lyric-bar" aria-live="polite">
        {activeLine?.words?.length ? (
          <div className="lyric-line">
            {activeLine.words.map((w, i) => {
              const gi = activeLine.startIndex + i;
              let cls = "kw future";
              if (gi < activeIndex) cls = "kw past";
              else if (gi === activeIndex) cls = "kw active";
              return (
                <span key={`${gi}-${w.text}`} className={cls}>
                  {w.text}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="lyric-line">
            <span className="kw future">
              {words?.length
                ? "Ready when you are…"
                : "Add lyrics to light up the stage"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default VideoStage;
