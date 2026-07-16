import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  prepareNarration,
  createBrowserNarration,
  tokenizeWords,
  alignTimingsToDisplay,
} from "../lib/tts.js";

function indexForTime(words, t) {
  if (!words?.length) return -1;
  // Binary-ish scan: last word where start <= t
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t + 0.02) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export default function KaraokeStory({ text, reader }) {
  // Narrate ONLY the story body so display words === timing words
  const storyText = useMemo(() => (text || "").trim(), [text]);
  const displayWords = useMemo(() => tokenizeWords(storyText), [storyText]);

  const [status, setStatus] = useState("idle"); // idle|loading|ready|playing|paused|error
  const [provider, setProvider] = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [errorMsg, setErrorMsg] = useState("");
  const [voiceLabel, setVoiceLabel] = useState(reader?.name || "Storyteller");

  const audioRef = useRef(null);
  const browserRef = useRef(null);
  const rafRef = useRef(0);
  const timingsRef = useRef([]);
  const preparedRef = useRef(null);
  const playingRef = useRef(false);

  const clearRaf = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const stopAll = useCallback(() => {
    clearRaf();
    playingRef.current = false;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    if (browserRef.current) {
      browserRef.current.stop();
      browserRef.current = null;
    }
    setActiveIdx(-1);
  }, []);

  useEffect(() => {
    stopAll();
    setStatus("idle");
    setProvider(null);
    setErrorMsg("");
    preparedRef.current = null;
    timingsRef.current = [];
    setVoiceLabel(reader?.name || "Storyteller");
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }, [storyText, reader?.id, stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  const updateHighlight = useCallback((t) => {
    const idx = indexForTime(timingsRef.current, t);
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, []);

  const tick = useCallback(() => {
    if (!playingRef.current) return;

    const audio = audioRef.current;
    const browser = browserRef.current;

    if (audio && audio.src && !audio.paused && !audio.ended) {
      updateHighlight(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (browser && browser.isPlaying()) {
      updateHighlight(browser.getCurrentTime());
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // ended
    playingRef.current = false;
    setStatus("ready");
    setActiveIdx(-1);
  }, [updateHighlight]);

  const startLoop = useCallback(() => {
    clearRaf();
    playingRef.current = true;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // Also wire timeupdate as a reliable secondary path
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (!playingRef.current) return;
      updateHighlight(audio.currentTime);
    };
    const onPlay = () => {
      playingRef.current = true;
      setStatus("playing");
      startLoop();
    };
    const onPause = () => {
      // distinguish pause vs end via ended flag in handlers
    };
    const onEnded = () => {
      playingRef.current = false;
      clearRaf();
      setStatus("ready");
      setActiveIdx(-1);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [updateHighlight, startLoop]);

  async function ensureReady() {
    if (preparedRef.current) return preparedRef.current;

    setStatus("loading");
    setErrorMsg("");

    const result = await prepareNarration(storyText, {
      voiceId: reader?.id,
      voiceName: reader?.name,
    });

    let words = result.words || [];
    // Guarantee 1:1 with display words
    words = alignTimingsToDisplay(displayWords, words, 0);
    timingsRef.current = words;

    const prepared = {
      provider: result.provider,
      audioUrl: result.audioUrl || null,
      words,
      voiceName: result.voiceName || reader?.name || "Storyteller",
    };
    preparedRef.current = prepared;
    setProvider(result.provider);
    setVoiceLabel(prepared.voiceName);
    setStatus("ready");
    return prepared;
  }

  async function handlePlay() {
    try {
      const prepared = await ensureReady();

      // Don't call stopAll() in a way that clears timings — only stop playback
      clearRaf();
      playingRef.current = false;
      if (browserRef.current) {
        browserRef.current.stop();
        browserRef.current = null;
      }

      if (prepared.provider === "elevenlabs" && prepared.audioUrl) {
        const audio = audioRef.current;
        if (!audio) throw new Error("Audio element missing");

        // Reset and load
        audio.pause();
        audio.src = prepared.audioUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          const ok = () => {
            cleanup();
            resolve();
          };
          const bad = () => {
            cleanup();
            reject(new Error("Audio failed to load"));
          };
          const cleanup = () => {
            audio.removeEventListener("canplay", ok);
            audio.removeEventListener("error", bad);
          };
          audio.addEventListener("canplay", ok, { once: true });
          audio.addEventListener("error", bad, { once: true });
          setTimeout(ok, 1200);
        });

        // Refine timings with real duration once known
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
          const refined = alignTimingsToDisplay(
            displayWords,
            prepared.words,
            audio.duration
          );
          // If API timings look valid (span most of duration), keep them;
          // otherwise redistribute using duration.
          const lastEnd = prepared.words[prepared.words.length - 1]?.end || 0;
          if (lastEnd < audio.duration * 0.5 || prepared.words.length !== displayWords.length) {
            // Scale API times to duration if we have them
            if (prepared.words.length && lastEnd > 0) {
              const scale = audio.duration / lastEnd;
              timingsRef.current = prepared.words.map((w, i) => ({
                word: displayWords[i] || w.word,
                start: w.start * scale,
                end: w.end * scale,
              }));
              // pad/trim
              if (timingsRef.current.length !== displayWords.length) {
                timingsRef.current = refined;
              }
            } else {
              timingsRef.current = refined;
            }
          } else {
            timingsRef.current = prepared.words.map((w, i) => ({
              word: displayWords[i] || w.word,
              start: w.start,
              end: w.end,
            }));
          }
        }

        setStatus("playing");
        playingRef.current = true;
        await audio.play();
        startLoop();
        return;
      }

      // Browser fallback
      const browser = createBrowserNarration(storyText);
      browserRef.current = browser;
      timingsRef.current = alignTimingsToDisplay(
        displayWords,
        browser.words,
        0
      );
      browser.onEnd(() => {
        playingRef.current = false;
        clearRaf();
        setStatus("ready");
        setActiveIdx(-1);
      });
      setStatus("playing");
      browser.play();
      startLoop();
    } catch (err) {
      playingRef.current = false;
      setStatus("error");
      setErrorMsg(err?.message || "Could not prepare audio");
    }
  }

  function handlePause() {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      playingRef.current = false;
      clearRaf();
      setStatus("paused");
      return;
    }
    if (browserRef.current) {
      browserRef.current.pause();
      playingRef.current = false;
      clearRaf();
      setStatus("paused");
    }
  }

  async function handleResume() {
    const audio = audioRef.current;
    if (audio?.src && status === "paused") {
      setStatus("playing");
      playingRef.current = true;
      await audio.play();
      startLoop();
      return;
    }
    if (browserRef.current && status === "paused") {
      browserRef.current.resume();
      setStatus("playing");
      playingRef.current = true;
      startLoop();
    }
  }

  function handleStop() {
    stopAll();
    setStatus(preparedRef.current ? "ready" : "idle");
  }

  return (
    <div className="karaoke-block">
      <audio ref={audioRef} preload="auto" className="visually-hidden" playsInline />

      <div className="listen-bar">
        <div className="listen-actions">
          {status !== "playing" ? (
            <button
              type="button"
              className="listen-btn primary"
              onClick={status === "paused" ? handleResume : handlePlay}
              disabled={status === "loading"}
            >
              {status === "loading"
                ? "Preparing voice…"
                : status === "paused"
                  ? "Resume"
                  : "▶ Listen"}
            </button>
          ) : (
            <button type="button" className="listen-btn primary" onClick={handlePause}>
              ⏸ Pause
            </button>
          )}
          {(status === "playing" || status === "paused") && (
            <button type="button" className="listen-btn ghost" onClick={handleStop}>
              Stop
            </button>
          )}
        </div>
        <p className="listen-meta">
          {status === "loading" && `Summoning ${voiceLabel}…`}
          {status === "playing" &&
            `Read by ${voiceLabel} · follow the glowing words`}
          {status === "paused" && "Paused"}
          {status === "ready" &&
            (provider === "elevenlabs"
              ? `Ready · ${voiceLabel}`
              : `Ready · ${voiceLabel} (browser)`)}
          {status === "idle" &&
            `Tap Listen · read by ${voiceLabel}`}
          {status === "error" && (errorMsg || "Audio unavailable")}
        </p>
      </div>

      <p className="insight-story karaoke-text" aria-live="off">
        {displayWords.map((word, i) => {
          const isActive = i === activeIdx && (status === "playing" || status === "paused");
          const isPast =
            activeIdx >= 0 &&
            i < activeIdx &&
            (status === "playing" || status === "paused");
          return (
            <span
              key={`${i}-${word}`}
              className={
                "k-word" +
                (isActive ? " is-active" : "") +
                (isPast ? " is-past" : "")
              }
              data-i={i}
            >
              {word}
              {i < displayWords.length - 1 ? " " : ""}
            </span>
          );
        })}
      </p>
    </div>
  );
}
