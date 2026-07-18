/**
 * Dual-line karaoke: fixed top + bottom pair.
 * Highlight top, then bottom, then wrap to next pair (no slide-up).
 */
import { useMemo } from "react";
import FallingEffects from "./FallingEffects.jsx";

function LyricLine({ line, className = "" }) {
  if (!line?.cue) return null;
  const states = line.wordStates?.length
    ? line.wordStates
    : [{ text: line.cue.text, state: "future", fill: 0 }];

  const roleClass =
    line.role === "active"
      ? "is-singing"
      : line.role === "done"
        ? "is-done"
        : "is-upcoming";

  return (
    <div className={`srt-cue ${className} ${roleClass}`}>
      <div className="srt-words">
        {states.map((w, i) => (
          <span
            key={i}
            className={`srt-w srt-w-${w.state}`}
            style={
              w.state === "active"
                ? {
                    backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.28) ${w.fill * 100}%, transparent ${w.fill * 100}%)`,
                  }
                : undefined
            }
          >
            {w.text}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SrtReaderView({
  reader,
  currentTime = 0,
  imageUrl,
  stockBg,
  offsetSec = 0,
  effect = "none",
}) {
  const t = (currentTime || 0) + (offsetSec || 0);

  const snap = useMemo(() => {
    if (!reader || reader.isEmpty) return null;
    return reader.snapshot(t);
  }, [reader, t]);

  if (!reader || reader.isEmpty) {
    return (
      <div className="srt-reader srt-reader-empty">
        <div className="srt-reader-empty-inner">
          <p>Upload a song and SRT to begin</p>
        </div>
      </div>
    );
  }

  const bgStyle = imageUrl
    ? { backgroundImage: `url(${imageUrl})` }
    : stockBg
      ? { backgroundImage: stockBg }
      : undefined;

  return (
    <div className="srt-reader srt-reader-minimal">
      <div className="srt-reader-stage" style={bgStyle}>
        <div className="srt-reader-stage-dim" />
        <FallingEffects effect={effect} />

        <div className="srt-reader-main srt-reader-dual">
          {/* Fixed top slot — lines 0,2,4… */}
          <LyricLine line={snap?.lineA} className="srt-cue-top" />
          {/* Fixed bottom slot — lines 1,3,5… */}
          {snap?.lineB ? (
            <LyricLine line={snap.lineB} className="srt-cue-bottom" />
          ) : (
            <div className="srt-cue srt-cue-bottom srt-cue-spacer" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
