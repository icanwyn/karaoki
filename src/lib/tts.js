/**
 * ElevenLabs TTS + karaoke word timings.
 * Falls back to multi-voice browser speech when the API is unavailable.
 */

const cache = new Map();

export function tokenizeWords(text) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function estimateWordTimings(text, wordsPerMinute = 130) {
  const words = tokenizeWords(text);
  const secPerWord = 60 / wordsPerMinute;
  let t = 0.05;
  return words.map((word) => {
    const letters = word.replace(/\W/g, "").length || 1;
    const lenFactor = Math.min(1.8, Math.max(0.55, letters / 4.2));
    const punctBoost = /[,;:]$/.test(word) ? 0.1 : /[.!?]"?$/.test(word) ? 0.22 : 0.04;
    const dur = secPerWord * lenFactor;
    const start = t;
    const end = t + dur;
    t = end + punctBoost;
    return { word, start, end };
  });
}

/**
 * Align API timing words 1:1 with on-screen words.
 */
export function alignTimingsToDisplay(displayWords, timedWords, audioDurationSec) {
  if (!displayWords.length) return [];

  const timed = (timedWords || [])
    .map((w) => ({
      word: w.word,
      start: Number(w.start) || 0,
      end: Number(w.end) || Number(w.start) || 0,
    }))
    .filter((w) => Number.isFinite(w.start));

  if (timed.length && Math.abs(timed.length - displayWords.length) <= 3) {
    const out = displayWords.map((word, i) => {
      const src = timed[Math.min(i, timed.length - 1)];
      return {
        word,
        start: src.start,
        end: Math.max(src.end, src.start + 0.06),
      };
    });
    for (let i = 1; i < out.length; i++) {
      if (out[i].start < out[i - 1].start) out[i].start = out[i - 1].end;
      if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.08;
    }
    return out;
  }

  if (timed.length > 1) {
    const t0 = timed[0].start;
    const t1 = timed[timed.length - 1].end || timed[timed.length - 1].start;
    const span = Math.max(0.5, t1 - t0);
    const totalChars = displayWords.reduce((n, w) => n + Math.max(1, w.length), 0);
    let t = t0;
    return displayWords.map((word) => {
      const share = Math.max(1, word.length) / totalChars;
      const dur = span * share;
      const start = t;
      const end = t + dur;
      t = end;
      return { word, start, end };
    });
  }

  if (audioDurationSec > 0) {
    const totalChars = displayWords.reduce((n, w) => n + Math.max(1, w.length), 0);
    let t = 0.02;
    return displayWords.map((word) => {
      const share = Math.max(1, word.length) / totalChars;
      const dur = Math.max(0.07, audioDurationSec * share);
      const start = t;
      const end = Math.min(audioDurationSec, t + dur);
      t = end;
      return { word, start, end };
    });
  }

  return estimateWordTimings(displayWords.join(" "));
}

/** Map character offset in full text → word index */
export function charIndexToWordIndex(text, charIndex) {
  const words = tokenizeWords(text);
  if (!words.length) return -1;
  if (charIndex <= 0) return 0;

  let cursor = 0;
  const normalized = text.trim();
  // Walk original trimmed text
  for (let i = 0; i < words.length; i++) {
    const idx = normalized.indexOf(words[i], cursor);
    if (idx < 0) continue;
    const start = idx;
    const end = idx + words[i].length;
    if (charIndex < end) return i;
    cursor = end;
  }
  return words.length - 1;
}

function cacheKey(text, voiceId) {
  return `${voiceId || "default"}::${text.trim().slice(0, 1800)}`;
}

export async function fetchElevenLabsNarration(text, { voiceId, voiceName } = {}) {
  const key = cacheKey(text, voiceId);
  if (cache.has(key)) return cache.get(key);

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId,
      style: "story",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data.message === "string"
        ? data.message
        : data.error || "TTS request failed";
    const err = new Error(msg);
    err.code = data.error || res.status;
    err.raw = data;
    throw err;
  }

  const displayWords = tokenizeWords(text);
  const rawWords = Array.isArray(data.words) ? data.words : [];
  const words = alignTimingsToDisplay(displayWords, rawWords, 0);

  const result = {
    provider: "elevenlabs",
    audioUrl: `data:${data.contentType || "audio/mpeg"};base64,${data.audioBase64}`,
    words,
    rawWords,
    voiceId: data.voiceId || voiceId,
    voiceName: voiceName || "Storyteller",
  };
  cache.set(key, result);
  return result;
}

/**
 * Pick a distinct browser voice for each book so fallback isn't always identical.
 */
export function pickBrowserVoice(seed = 0) {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const all = window.speechSynthesis.getVoices() || [];
  const english = all.filter((v) => /^en([-_]|$)/i.test(v.lang || ""));
  const pool = english.length ? english : all;
  if (!pool.length) return null;
  const idx = Math.abs(Number(seed) || 0) % pool.length;
  return pool[idx];
}

/**
 * Browser narration with:
 * - estimated word timings (always)
 * - SpeechSynthesis boundary events when available (best karaoke)
 * - wall-clock time that starts immediately on play() (not waiting for onstart)
 */
export function createBrowserNarration(text, { seed = 0, rate = 0.92 } = {}) {
  const words = estimateWordTimings(text);
  const utter = new SpeechSynthesisUtterance(text);
  // Distinct pacing per book even if OS has few voices
  const s = Math.abs(Number(seed) || 0);
  utter.rate = Math.min(1.05, Math.max(0.82, rate + ((s % 7) - 3) * 0.025));
  utter.pitch = Math.min(1.2, Math.max(0.85, 1 + ((s % 9) - 4) * 0.04));
  utter.lang = "en-US";

  const voice = pickBrowserVoice(seed);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || "en-US";
  }

  let startWall = 0;
  let pausedAt = 0;
  let playing = false;
  let ended = false;
  let onEndCb = null;
  let onWordCb = null; // (wordIndex) => void

  utter.onstart = () => {
    // Re-anchor to speech engine start if it fires
    if (!playing) startWall = performance.now() - pausedAt * 1000;
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

  utter.onboundary = (ev) => {
    if (ev.name === "word" || ev.name === "Word") {
      const idx = charIndexToWordIndex(text, ev.charIndex ?? 0);
      onWordCb?.(idx);
    }
  };

  return {
    provider: "browser",
    words,
    voiceName: voice?.name || "System voice",
    play() {
      ended = false;
      pausedAt = 0;
      // Start clock immediately so karaoke works even before onstart
      startWall = performance.now();
      playing = true;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      window.speechSynthesis.speak(utter);
    },
    pause() {
      if (!playing) return;
      pausedAt = (performance.now() - startWall) / 1000;
      playing = false;
      try {
        window.speechSynthesis.pause();
      } catch {
        /* ignore */
      }
    },
    resume() {
      startWall = performance.now() - pausedAt * 1000;
      playing = true;
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    },
    stop() {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      playing = false;
      pausedAt = 0;
      ended = true;
    },
    getCurrentTime() {
      if (ended) return words[words.length - 1]?.end || 0;
      if (!playing) return pausedAt || 0;
      return Math.max(0, (performance.now() - startWall) / 1000);
    },
    isPlaying: () => playing && !ended,
    hasEnded: () => ended,
    onEnd(cb) {
      onEndCb = cb;
    },
    onWord(cb) {
      onWordCb = cb;
    },
  };
}

export async function prepareNarration(text, options = {}) {
  try {
    return await fetchElevenLabsNarration(text, options);
  } catch (err) {
    // Browser multi-voice fallback — still story-like karaoke
    const seed = options.seed ?? 0;
    const voice = pickBrowserVoice(seed);
    return {
      provider: "browser",
      audioUrl: null,
      words: estimateWordTimings(text),
      voiceId: options.voiceId,
      voiceName: options.voiceName || voice?.name || "System",
      fallbackReason: err.message,
      seed,
    };
  }
}

/** Preload voices (Chrome loads async) */
export function warmSpeechVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
