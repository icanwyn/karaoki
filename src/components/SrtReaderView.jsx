/**
 * Custom SRT karaoke reader UI — driven by SrtReader engine.
 * Shows prev / current / next cues, progressive word fill, cue list seek.
 */
import { useEffect, useMemo, useRef } from "react";
import { formatSrtTime } from "../lib/SrtReader.js";

export default function SrtReaderView({
  reader,
  currentTime = 0,
  onSeek,
  imageUrl,
  stockBg,
  offsetSec = 0,
}) {
  const listRef = useRef(null);
  const t = (currentTime || 0) + (offsetSec || 0);

  const snap = useMemo(() => {
    if (!reader || reader.isEmpty) return null;
    return reader.snapshot(t);
  }, [reader, t]);

  // Auto-scroll cue list to active row
  useEffect(() => {
    if (!listRef.current || snap?.cueIndex == null || snap.cueIndex < 0) return;
    const el = listRef.current.querySelector(`[data-cue="${snap.cueIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [snap?.cueIndex]);

  if (!reader || reader.isEmpty) {
    return (
      <div className="srt-reader srt-reader-empty">
        <div className="srt-reader-empty-inner">
          <h3>SRT Reader</h3>
          <p>Upload an .srt file or generate captions to open the custom reader.</p>
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
    <div className="srt-reader">
      <div className="srt-reader-stage" style={bgStyle}>
        <div className="srt-reader-stage-dim" />

        {snap?.waitingForFirst ? (
          <div className="srt-reader-main">
            <p className="srt-wait">
              First line in {snap.secondsToFirst.toFixed(1)}s…
            </p>
          </div>
        ) : (
          <div className="srt-reader-main">
            {snap?.prev && (
              <p className="srt-cue srt-cue-prev">{snap.prev.text}</p>
            )}

            <div className="srt-cue srt-cue-current">
              {snap?.cue ? (
                <>
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
                                backgroundImage: `linear-gradient(90deg, rgba(255,45,149,0.45) ${w.fill * 100}%, transparent ${w.fill * 100}%)`,
                              }
                            : undefined
                        }
                      >
                        {w.text}
                      </span>
                    ))}
                  </div>
                  <div className="srt-cue-progress" aria-hidden>
                    <div
                      className="srt-cue-progress-fill"
                      style={{ width: `${(snap.cueProgress || 0) * 100}%` }}
                    />
                  </div>
                  <div className="srt-cue-meta">
                    {formatSrtTime(snap.cue.start)} → {formatSrtTime(snap.cue.end)}
                    <span className="srt-cue-num">#{snap.cue.index}</span>
                  </div>
                </>
              ) : (
                <p className="srt-wait">…</p>
              )}
            </div>

            {snap?.next && (
              <p className="srt-cue srt-cue-next">{snap.next.text}</p>
            )}
          </div>
        )}
      </div>

      <div className="srt-reader-list-wrap">
        <div className="srt-reader-list-head">
          <strong>Cues</strong>
          <span>{reader.length} lines</span>
        </div>
        <ul className="srt-reader-list" ref={listRef}>
          {reader.cues.map((cue, i) => {
            const active = snap?.cueIndex === i;
            const past = snap?.cueIndex != null && i < snap.cueIndex;
            return (
              <li key={cue.index}>
                <button
                  type="button"
                  data-cue={i}
                  className={
                    "srt-list-item" +
                    (active ? " is-active" : "") +
                    (past ? " is-past" : "")
                  }
                  onClick={() => onSeek?.(cue.start)}
                  title="Seek to this line"
                >
                  <span className="srt-list-time">{formatSrtTime(cue.start)}</span>
                  <span className="srt-list-text">{cue.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
