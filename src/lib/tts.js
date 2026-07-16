/**
 * ElevenLabs TTS + karaoke word timings.
 * Falls back to browser speech if the API is unavailable.
 */

const cache = new Map();

export function tokenizeWords(text) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function estimateWordTimings(text, wordsPerMinute = 135) {
  const words = tokenizeWords(text);
  const secPerWord = 60 / wordsPerMinute;
  let t = 0.12;
  return words.map((word) => {
    const letters = word.replace(/\W/g, "").length || 1;
    const lenFactor = Math.min(1.75, Math.max(0.5, letters / 4.5));
    // Story pacing: slightly longer pauses after punctuation
    const punctBoost = /[,;:]$/.test(word) ? 0.08 : /[.!?]"?$/.test(word) ? 0.18 : 0.03;
    const dur = secPerWord * lenFactor;
    const start = t;
    const end = t + dur;
    t = end + punctBoost;
    return { word, start, end };
  });
}

/**
 * Align API timing words to the exact display word list so karaoke indices match 1:1.
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

  // Perfect or near-perfect match: zip by index
  if (timed.length && Math.abs(timed.length - displayWords.length) <= 2) {
    const out = displayWords.map((word, i) => {
      const src = timed[Math.min(i, timed.length - 1)];
      return {
        word,
        start: src.start,
        end: Math.max(src.end, src.start + 0.05),
      };
    });
    // Ensure strictly non-decreasing starts (fixes occasional API jitter)
    for (let i = 1; i < out.length; i++) {
      if (out[i].start < out[i - 1].start) {
        out[i].start = out[i - 1].end;
      }
      if (out[i].end <= out[i].start) {
        out[i].end = out[i].start + 0.08;
      }
    }
    return out;
  }

  // Different lengths: stretch API timeline across display words by character weight
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

  // Estimate from audio duration if known
  if (audioDurationSec > 0) {
    const totalChars = displayWords.reduce((n, w) => n + Math.max(1, w.length), 0);
    let t = 0.05;
    return displayWords.map((word) => {
      const share = Math.max(1, word.length) / totalChars;
      const dur = Math.max(0.08, audioDurationSec * share);
      const start = t;
      const end = Math.min(audioDurationSec, t + dur);
      t = end;
      return { word, start, end };
    });
  }

  return estimateWordTimings(displayWords.join(" "));
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
      // Storytelling style hint for the server
      style: "story",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || "TTS request failed");
    err.code = data.error || res.status;
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
    voiceName: data.voiceName || voiceName || "Storyteller",
  };
  cache.set(key, result);
  return result;
}

export function createBrowserNarration(text) {
  const words = estimateWordTimings(text);
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.9;
  utter.pitch = 1;
  utter.lang = "en-US";

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

export async function prepareNarration(text, options = {}) {
  try {
    return await fetchElevenLabsNarration(text, options);
  } catch (err) {
    return {
      provider: "browser",
      audioUrl: null,
      words: estimateWordTimings(text),
      voiceName: "Browser",
      fallbackReason: err.message,
    };
  }
}
