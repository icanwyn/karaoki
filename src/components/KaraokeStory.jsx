import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  prepareNarration,
  createBrowserNarration,
  tokenizeWords,
} from "../lib/tts.js";

function activeWordIndex(words, t) {
  if (!words?.length) return -1;
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (t + 0.03 >= words[i].start) idx = i;
    else break;
  }
  if (idx >= 0 && t > (words[idx].end ?? words[idx].start) + 1.2 && idx === words.length - 1) {
    return idx;
  }
  return idx;
}

export default function KaraokeStory({ text, title }) {
  const fullText = useMemo(() => {
    const body = text?.trim() || "";
    return title ? `${title}. ${body}` : body;
  }, [text, title]);

  const displayWords = useMemo(() => tokenizeWords(text || ""), [text]);

  const [status, setStatus] = useState("idle");
  const [provider, setProvider] = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [errorMsg, setErrorMsg] = useState("");

  const audioRef = useRef(null);
  const browserRef = useRef(null);
  const rafRef = useRef(0);
  const timingsRef = useRef([]);
  const offsetRef = useRef(0);
  const preparedRef = useRef(null); // { provider, audioUrl, words }

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
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
    offsetRef.current = 0;
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
    }
  }, [fullText, stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  const tick = useCallback(() => {
    const audio = audioRef.current;
    const browser = browserRef.current;
    let t = 0;
    let running = false;

    if (audio && audio.src && !audio.paused && !audio.ended) {
      t = audio.currentTime;
      running = true;
    } else if (browser && browser.isPlaying()) {
      t = browser.getCurrentTime();
      running = true;
    }

    if (!running) {
      if (audio?.ended || (browser && !browser.isPlaying() && status === "playing")) {
        setStatus("ready");
        setActiveIdx(-1);
      }
      return;
    }

    const narrationIdx = activeWordIndex(timingsRef.current, t);
    const mapped = narrationIdx - offsetRef.current;
    if (mapped < 0) setActiveIdx(-1);
    else if (mapped >= displayWords.length) setActiveIdx(displayWords.length - 1);
    else setActiveIdx(mapped);

    rafRef.current = requestAnimationFrame(tick);
  }, [displayWords.length, status]);

  const startRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  async function ensureReady() {
    if (preparedRef.current) return preparedRef.current;

    setStatus("loading");
    setErrorMsg("");
    const result = await prepareNarration(fullText);

    const titleWordCount = title ? tokenizeWords(`${title}.`).length : 0;
    offsetRef.current = titleWordCount;
    timingsRef.current = result.words || [];

    const prepared = {
      provider: result.provider,
      audioUrl: result.audioUrl || null,
      words: result.words || [],
    };
    preparedRef.current = prepared;
    setProvider(result.provider);
    setStatus("ready");
    return prepared;
  }

  async function handlePlay() {
    try {
      const prepared = await ensureReady();
      stopAll();

      if (prepared.provider === "elevenlabs" && prepared.audioUrl) {
        const audio = audioRef.current;
        audio.src = prepared.audioUrl;
        audio.onended = () => {
          setStatus("ready");
          setActiveIdx(-1);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
        await audio.play();
        setStatus("playing");
        startRaf();
        return;
      }

      // Browser speech fallback
      const browser = createBrowserNarration(fullText);
      browserRef.current = browser;
      if (!timingsRef.current.length) timingsRef.current = browser.words;
      browser.onEnd(() => {
        setStatus("ready");
        setActiveIdx(-1);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      });
      browser.play();
      setStatus("playing");
      startRaf();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err?.message || "Could not prepare audio");
    }
  }

  function handlePause() {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setStatus("paused");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    if (browserRef.current) {
      browserRef.current.pause();
      setStatus("paused");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }

  async function handleResume() {
    if (audioRef.current?.src && status === "paused") {
      await audioRef.current.play();
      setStatus("playing");
      startRaf();
      return;
    }
    if (browserRef.current && status === "paused") {
      browserRef.current.resume();
      setStatus("playing");
      startRaf();
    }
  }

  function handleStop() {
    stopAll();
    setStatus(preparedRef.current ? "ready" : "idle");
  }

  return (
    <div className="karaoke-block">
      <audio ref={audioRef} preload="auto" className="visually-hidden" />

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
          {status === "loading" && "Generating narration…"}
          {status === "playing" &&
            (provider === "elevenlabs"
              ? "ElevenLabs · words glow as they are spoken"
              : "Narrating · words glow as they are spoken")}
          {status === "paused" && "Paused"}
          {status === "ready" &&
            (provider === "elevenlabs"
              ? "Ready · ElevenLabs voice"
              : "Ready · browser voice")}
          {status === "idle" && "Tap Listen for karaoke-style reading"}
          {status === "error" && (errorMsg || "Audio unavailable")}
        </p>
      </div>

      <p className="insight-story karaoke-text" aria-live="off">
        {displayWords.map((word, i) => {
          const isActive = i === activeIdx;
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
