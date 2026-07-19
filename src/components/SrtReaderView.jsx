/**
 * Dual-line karaoke: fixed top + bottom pair.
 * During tap-correct, shows the upcoming word clearly (does not stick).
 */
import { useMemo } from "react";
import FallingEffects from "./FallingEffects.jsx";

function LyricLine({ line, className = "", tapTargetInLine = -1 }) {
  if (!line?.cue) return null;
  let states = line.wordStates?.length
    ? line.wordStates.map((w) => ({ ...w }))
    : [{ text: line.cue.text, state: "future", fill: 0 }];

  // During tap-correct: mark the next word to hit as "next" (cyan)
  if (tapTargetInLine >= 0 && tapTargetInLine < states.length) {
    states = states.map((w, i) => {
      if (i < tapTargetInLine) return { ...w, state: "past", fill: 1 };
      if (i === tapTargetInLine) return { ...w, state: "next", fill: 0 };
      return { ...w, state: "future", fill: 0 };
    });
  }

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
  isSyncing = false,
  tapTargetIndex = -1,
}) {
  const t = (currentTime || 0) + (offsetSec || 0);

  const snap = useMemo(() => {
    if (!reader || reader.isEmpty) return null;
    return reader.snapshot(t);
  }, [reader, t]);

  // Map global word index → which line slot + local index
  const tapMap = useMemo(() => {
    if (!isSyncing || tapTargetIndex < 0 || !reader?.words?.length) {
      return { line: null, local: -1 };
    }
    const w = reader.words[tapTargetIndex];
    if (!w) return { line: null, local: -1 };
    const line = w.line ?? w.cueIndex ?? null;
    if (line == null) return { line: null, local: -1 };
    const cue = reader.cues[line];
    if (!cue) return { line: null, local: -1 };
    // local index within cue
    let local = 0;
    let count = 0;
    for (let i = 0; i < reader.words.length; i++) {
      const wi = reader.words[i];
      const L = wi.line ?? wi.cueIndex ?? 0;
      if (L === line) {
        if (i === tapTargetIndex) {
          local = count;
          break;
        }
        count += 1;
      }
    }
    return { line, local };
  }, [isSyncing, tapTargetIndex, reader]);

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

  const topLineIdx = snap?.pairStart ?? 0;
  const bottomLineIdx = topLineIdx + 1;
  const topTap =
    tapMap.line === topLineIdx ? tapMap.local : -1;
  const bottomTap =
    tapMap.line === bottomLineIdx ? tapMap.local : -1;

  return (
    <div className="srt-reader srt-reader-minimal">
      <div className="srt-reader-stage" style={bgStyle}>
        <div className="srt-reader-stage-dim" />
        <FallingEffects effect={effect} />

        {isSyncing && tapTargetIndex >= 0 && reader.words[tapTargetIndex] && (
          <div className="srt-tap-banner">
            Next tap: <strong>{reader.words[tapTargetIndex].text}</strong>
            <span>
              {" "}
              ({tapTargetIndex + 1}/{reader.words.length})
            </span>
          </div>
        )}

        <div className="srt-reader-main srt-reader-dual">
          <LyricLine
            line={snap?.lineA}
            className="srt-cue-top"
            tapTargetInLine={topTap}
          />
          {snap?.lineB ? (
            <LyricLine
              line={snap.lineB}
              className="srt-cue-bottom"
              tapTargetInLine={bottomTap}
            />
          ) : (
            <div className="srt-cue srt-cue-bottom srt-cue-spacer" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
