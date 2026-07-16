/**
 * Text-to-speech helpers:
 * 1) Prefer ElevenLabs via /api/tts (word timestamps for karaoke)
 * 2) Fallback: browser SpeechSynthesis with estimated word timings
 */

const cache = new Map();

function cacheKey(text) {
  return text.trim().slice(0, 2000);
}

export function tokenizeWords(text) {
  // Keep punctuation attached to words for display; split on whitespace
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Rough timings when ElevenLabs is unavailable */
export function estimateWordTimings(text, wordsPerMinute = 145) {
  const words = tokenizeWords(text);
  const secPerWord = 60 / wordsPerMinute;
  let t = 0.15;
  return words.map((word) => {
    const lenFactor = Math.min(1.6, Math.max(0.55, word.replace(/\W/g, "").length / 5));
    const dur = secPerWord * lenFactor;
    const start = t;
    const end = t + dur;
    t = end + 0.04;
    return { word, start, end };
  });
}

export async function fetchElevenLabsNarration(text) {
  const key = cacheKey(text);
  if (cache.has(key)) return cache.get(key);

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || "TTS request failed");
    err.code = data.error || res.status;
    throw err;
  }

  const result = {
    provider: "elevenlabs",
    audioUrl: `data:${data.contentType || "audio/mpeg"};base64,${data.audioBase64}`,
    words:
      data.words?.length > 0
        ? data.words
        : estimateWordTimings(text),
  };
  cache.set(key, result);
  return result;
}

/**
 * Browser speech synthesis fallback with estimated karaoke timings.
 * Returns a controller: { words, play, pause, stop, getCurrentTime, onend }
 */
export function createBrowserNarration(text) {
  const words = estimateWordTimings(text);
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.92;
  utter.pitch = 1;
  utter.lang = "en-US";

  // Prefer a calm English voice if available
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const preferred =
    voices.find((v) => /Samantha|Google US English|Karen|Moira|Female/i.test(v.name)) ||
    voices.find((v) => v.lang?.startsWith("en")) ||
    null;
  if (preferred) utter.voice = preferred;

  let startWall = 0;
  let pausedAt = 0;
  let playing = false;
  let ended = false;
  let onEndCb = null;
  let onBoundary = null;

  utter.onstart = () => {
    startWall = performance.now() - pausedAt * 1000;
    playing = true;
    ended = false;
  };
  utter.onend = () => {
    playing = false;
    ended = true;
    onEndCb?.();
  };
  utter.onerror = () => {
    playing = false;
    ended = true;
    onEndCb?.();
  };

  // Some browsers fire word boundaries
  utter.onboundary = (ev) => {
    if (ev.name === "word" && typeof onBoundary === "function") {
      onBoundary(ev.charIndex, ev.elapsedTime);
    }
  };

  return {
    provider: "browser",
    words,
    play() {
      if (ended) {
        pausedAt = 0;
        ended = false;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    },
    pause() {
      if (playing) {
        pausedAt = (performance.now() - startWall) / 1000;
        window.speechSynthesis.pause();
        playing = false;
      }
    },
    resume() {
      window.speechSynthesis.resume();
      playing = true;
      startWall = performance.now() - pausedAt * 1000;
    },
    stop() {
      window.speechSynthesis.cancel();
      playing = false;
      pausedAt = 0;
      ended = true;
    },
    getCurrentTime() {
      if (ended) return words[words.length - 1]?.end || 0;
      if (!playing && pausedAt) return pausedAt;
      if (!playing) return 0;
      return Math.max(0, (performance.now() - startWall) / 1000);
    },
    isPlaying: () => playing,
    onEnd(cb) {
      onEndCb = cb;
    },
  };
}

export async function prepareNarration(text) {
  try {
    return await fetchElevenLabsNarration(text);
  } catch (err) {
    // Soft-fail to browser voice so the feature always works
    return {
      provider: "browser",
      audioUrl: null,
      words: estimateWordTimings(text),
      fallbackReason: err.message,
    };
  }
}
