import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  prepareNarration,
  createBrowserNarration,
  tokenizeWords,
  alignTimingsToDisplay,
  warmSpeechVoices,
} from "../lib/tts.js";

function indexForTime(words, t) {
  if (!words?.length) return -1;
  let ans = -1;
  for (let i = 0; i < words.length; i++) {
    if ((words[i].start ?? 0) <= t + 0.04) ans = i;
    else break;
  }
  return ans;
}

export default function KaraokeStory({ text, reader, bookNumber = 1 }) {
  const storyText = useMemo(() => (text || "").trim(), [text]);
  const displayWords = useMemo(() => tokenizeWords(storyText), [storyText]);

  const [status, setStatus] = useState("idle");
  const [provider, setProvider] = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [errorMsg, setErrorMsg] = useState("");
  const [voiceLabel, setVoiceLabel] = useState(reader?.name || "Storyteller");
  const [fallbackNote, setFallbackNote] = useState("");

  const audioRef = useRef(null);
  const browserRef = useRef(null);
  const timerRef = useRef(0);
  const timingsRef = useRef([]);
  const preparedRef = useRef(null);
  const playingRef = useRef(false);
  const statusRef = useRef("idle");

  const setPlayStatus = (s) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    warmSpeechVoices();
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = 0;
    }
  };

  const stopPlayback = useCallback(() => {
    clearTimer();
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
    stopPlayback();
    setPlayStatus("idle");
    setProvider(null);
    setErrorMsg("");
    setFallbackNote("");
    preparedRef.current = null;
    timingsRef.current = [];
    setVoiceLabel(reader?.name || "Storyteller");
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
      try {
        audioRef.current.load();
      } catch {
        /* ignore */
      }
    }
  }, [storyText, reader?.id, bookNumber, stopPlayback]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const paint = useCallback((idx) => {
    if (idx < 0) {
      setActiveIdx(-1);
      return;
    }
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, []);

  const startHighlightLoop = useCallback(() => {
    clearTimer();
    playingRef.current = true;

    // ~12fps highlight updates — smooth enough, less layout thrash
    timerRef.current = window.setInterval(() => {
      if (!playingRef.current) return;

      const audio = audioRef.current;
      const browser = browserRef.current;

      if (audio && audio.src && !audio.paused && !audio.ended) {
        paint(indexForTime(timingsRef.current, audio.currentTime));
        return;
      }

      if (browser) {
        if (browser.hasEnded?.()) {
          playingRef.current = false;
          clearTimer();
          setPlayStatus("ready");
          paint(-1);
          return;
        }
        paint(indexForTime(timingsRef.current, browser.getCurrentTime()));
        return;
      }

      if (audio?.ended) {
        playingRef.current = false;
        clearTimer();
        setPlayStatus("ready");
        paint(-1);
      }
    }, 80);
  }, [paint]);

  // Native audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (!playingRef.current) return;
      paint(indexForTime(timingsRef.current, audio.currentTime));
    };
    const onEnded = () => {
      playingRef.current = false;
      clearTimer();
      setPlayStatus("ready");
      paint(-1);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [paint]);

  async function ensureReady() {
    if (preparedRef.current) return preparedRef.current;

    setPlayStatus("loading");
    setErrorMsg("");
    setFallbackNote("");

    const result = await prepareNarration(storyText, {
      voiceId: reader?.id,
      voiceName: reader?.name,
      seed: bookNumber * 17 + (reader?.id?.length || 0),
    });

    const words = alignTimingsToDisplay(
      displayWords,
      result.words || [],
      0
    );
    timingsRef.current = words;

    const prepared = {
      provider: result.provider,
      audioUrl: result.audioUrl || null,
      words,
      voiceName: result.voiceName || reader?.name || "Storyteller",
      voiceId: result.voiceId || reader?.id,
      fallbackReason: result.fallbackReason || "",
      seed: result.seed ?? bookNumber,
    };
    preparedRef.current = prepared;
    setProvider(result.provider);
    setVoiceLabel(prepared.voiceName);

    if (result.provider === "browser" && result.fallbackReason) {
      setFallbackNote(
        "ElevenLabs quota low — using a distinct system voice for this book"
      );
    }

    setPlayStatus("ready");
    return prepared;
  }

  async function handlePlay() {
    try {
      const prepared = await ensureReady();

      // Stop prior playback without wiping timings
      clearTimer();
      playingRef.current = false;
      if (browserRef.current) {
        browserRef.current.stop();
        browserRef.current = null;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
      }

      // ─── ElevenLabs path ───
      if (prepared.provider === "elevenlabs" && prepared.audioUrl) {
        if (!audio) throw new Error("Audio element missing");

        audio.src = prepared.audioUrl;
        audio.load();

        await new Promise((resolve) => {
          const done = () => {
            audio.removeEventListener("canplaythrough", done);
            audio.removeEventListener("loadeddata", done);
            resolve();
          };
          audio.addEventListener("canplaythrough", done, { once: true });
          audio.addEventListener("loadeddata", done, { once: true });
          setTimeout(done, 1500);
        });

        // Fit timings to real duration
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0.2) {
          const lastEnd =
            prepared.words[prepared.words.length - 1]?.end || 0;
          if (lastEnd > 0.05) {
            const scale = audio.duration / lastEnd;
            timingsRef.current = prepared.words.map((w, i) => ({
              word: displayWords[i] || w.word,
              start: w.start * scale,
              end: w.end * scale,
            }));
          } else {
            timingsRef.current = alignTimingsToDisplay(
              displayWords,
              prepared.words,
              audio.duration
            );
          }
        }

        setPlayStatus("playing");
        playingRef.current = true;
        // Force first word on immediately
        paint(0);
        startHighlightLoop();
        await audio.play();
        return;
      }

      // ─── Browser multi-voice path ───
      const browser = createBrowserNarration(storyText, {
        seed: prepared.seed ?? bookNumber,
        rate: 0.9,
      });
      browserRef.current = browser;
      timingsRef.current = alignTimingsToDisplay(
        displayWords,
        browser.words,
        0
      );
      setVoiceLabel(
        reader?.name
          ? `${reader.name} · ${browser.voiceName}`
          : browser.voiceName
      );

      browser.onWord((idx) => {
        if (playingRef.current) paint(idx);
      });
      browser.onEnd(() => {
        playingRef.current = false;
        clearTimer();
        setPlayStatus("ready");
        paint(-1);
      });

      setPlayStatus("playing");
      playingRef.current = true;
      paint(0);
      browser.play();
      startHighlightLoop();
    } catch (err) {
      playingRef.current = false;
      setPlayStatus("error");
      setErrorMsg(err?.message || "Could not prepare audio");
    }
  }

  function handlePause() {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      playingRef.current = false;
      clearTimer();
      setPlayStatus("paused");
      return;
    }
    if (browserRef.current) {
      browserRef.current.pause();
      playingRef.current = false;
      clearTimer();
      setPlayStatus("paused");
    }
  }

  async function handleResume() {
    const audio = audioRef.current;
    if (audio?.src && statusRef.current === "paused") {
      setPlayStatus("playing");
      playingRef.current = true;
      startHighlightLoop();
      await audio.play();
      return;
    }
    if (browserRef.current && statusRef.current === "paused") {
      browserRef.current.resume();
      setPlayStatus("playing");
      playingRef.current = true;
      startHighlightLoop();
    }
  }

  function handleStop() {
    stopPlayback();
    setPlayStatus(preparedRef.current ? "ready" : "idle");
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
          {status === "loading" && `Summoning ${reader?.name || "reader"}…`}
          {status === "playing" && (
            <>
              <span className="listen-live">●</span> {voiceLabel}
              {provider === "elevenlabs" ? " · karaoke on" : " · karaoke on"}
            </>
          )}
          {status === "paused" && "Paused"}
          {status === "ready" &&
            (provider === "elevenlabs"
              ? `Ready · ${voiceLabel} (ElevenLabs)`
              : `Ready · ${voiceLabel}`)}
          {status === "idle" && `Tap Listen · ${reader?.name || "Storyteller"}`}
          {status === "error" && (errorMsg || "Audio unavailable")}
        </p>
      </div>

      {fallbackNote && status !== "error" && (
        <p className="listen-fallback">{fallbackNote}</p>
      )}

      <p
        className={`insight-story karaoke-text${status === "playing" || status === "paused" ? " is-reading" : ""}`}
        aria-live="off"
      >
        {displayWords.map((word, i) => {
          const reading = status === "playing" || status === "paused";
          const isActive = reading && i === activeIdx;
          const isPast = reading && activeIdx >= 0 && i < activeIdx;
          return (
            <span
              key={`${i}-${word}`}
              className={
                "k-word" +
                (isActive ? " is-active" : "") +
                (isPast ? " is-past" : "")
              }
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
