/**
 * Minimal karaoke stage for SrtReader — lyrics only, no cue list clutter.
 */
import { useMemo } from "react";

export default function SrtReaderView({
  reader,
  currentTime = 0,
  imageUrl,
  stockBg,
  offsetSec = 0,
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

        <div className="srt-reader-main">
          {snap?.waitingForFirst ? (
            <p className="srt-wait">…</p>
          ) : snap?.cue ? (
            <div className="srt-cue srt-cue-current">
              <div className="srt-words">
                {(snap.wordStates.length
                  ? snap.wordStates
                  : [{ text: snap.cue.text, state: "active", fill: snap.cueProgress }]
                ).map((w, i) => (
                  <span
                    key={i}
                    className={`srt-w srt-w-${w.state}`}
                    style={
                      w.state === "active"
                        ? {
                            backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.22) ${w.fill * 100}%, transparent ${w.fill * 100}%)`,
                          }
                        : undefined
                    }
                  >
                    {w.text}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="srt-wait">…</p>
          )}
        </div>
      </div>
    </div>
  );
}
