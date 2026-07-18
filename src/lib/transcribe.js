/**
 * Auto-transcribe audio → lyrics + word timings via Whisper.
 *
 * Critical (transformers.js + English-only models):
 * - Pass Float32Array samples at 16 kHz (NOT { raw, sampling_rate })
 * - Do NOT pass `language` or `task` to *.en models (throws → empty result)
 */

import {
  alignWordsToOnset,
  clampWordsToDuration,
  decodeMono16k,
  estimateTimingsInWindow,
  findActiveWindow,
  findEnergyOnset,
  timingsLookValid,
} from "./audioAlign.js";

const FAR = 1e9;
const MODEL_ID = "Xenova/whisper-tiny.en";

/** @type {Promise<any> | null} */
let pipePromise = null;

/**
 * @typedef {{ text: string, start: number, end: number }} TimedWord
 * @typedef {{
 *   lyrics: string,
 *   words: TimedWord[],
 *   provider: string,
 *   fullText: string,
 *   appliedShiftSec?: number,
 *   note?: string,
 * }} TranscribeResult
 */

/**
 * @param {File|Blob} audioFile
 * @param {{
 *   onProgress?: (p: { phase: string, progress?: number, status?: string }) => void,
 *   signal?: AbortSignal,
 *   preferBrowser?: boolean,
 *   durationHint?: number,
 * }} [opts]
 * @returns {Promise<TranscribeResult>}
 */
export async function transcribeSong(audioFile, opts = {}) {
  const { onProgress, signal, preferBrowser = false, durationHint = 0 } = opts;
  if (!audioFile) throw new Error("No audio file to transcribe");

  onProgress?.({ phase: "decode", progress: 0.04, status: "Decoding audio to 16 kHz…" });
  let decoded = null;
  try {
    decoded = await decodeMono16k(audioFile);
  } catch (err) {
    console.warn("[karaoki] decode failed", err);
    onProgress?.({
      phase: "decode",
      progress: 0.05,
      status: `Decode warning: ${shortErr(err)} — will try file URL…`,
    });
  }
  throwIfAborted(signal);

  const duration = decoded?.duration || durationHint || 0;

  // 1) Optional server Whisper
  if (!preferBrowser) {
    try {
      onProgress?.({ phase: "server", progress: 0.08, status: "Trying server Whisper…" });
      const server = await transcribeViaServer(audioFile, { onProgress, signal });
      if (server?.words?.length || server?.fullText) {
        return finalizeResult(server, decoded, duration, onProgress);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      onProgress?.({
        phase: "fallback",
        progress: 0.12,
        status: /not configured|OPENAI|503/i.test(String(err?.message || err))
          ? "No server key — running Whisper in your browser…"
          : "Server unavailable — running Whisper in your browser…",
      });
    }
  }

  // 2) Browser Whisper (must succeed with real samples)
  try {
    const browser = await transcribeInBrowser(audioFile, decoded, { onProgress, signal });
    return finalizeResult(browser, decoded, duration, onProgress);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[karaoki] browser whisper failed", err);
    throw new Error(
      `Auto lyrics failed: ${shortErr(err)}. ` +
        "Use Chrome/Edge, allow model download, or paste lyrics and use Auto-time."
    );
  }
}

function finalizeResult(result, decoded, duration, onProgress) {
  let words = normalizeWords(result.words || []);
  let appliedShiftSec = 0;
  let note = result.note || "";
  let provider = result.provider || "unknown";
  const fullText = (result.fullText || words.map((w) => w.text).join(" ")).trim();

  if (words.length && decoded?.samples?.length) {
    const onset = findEnergyOnset(decoded.samples, decoded.sampleRate);
    const aligned = alignWordsToOnset(words, onset);
    words = aligned.words;
    appliedShiftSec = aligned.appliedShiftSec || 0;
  }

  if ((!timingsLookValid(words, duration) || !words.length) && fullText) {
    onProgress?.({
      phase: "estimate",
      progress: 0.96,
      status: "Rebuilding timings from transcript + audio energy…",
    });
    const tokens = fullText.split(/\s+/).filter(Boolean);
    let start = 0;
    let end = duration || Math.max(30, tokens.length * 0.35);
    if (decoded?.samples?.length) {
      const win = findActiveWindow(decoded.samples, decoded.sampleRate);
      start = win.start;
      end = win.end;
    } else {
      start = Math.min(2, end * 0.05);
      end = end * 0.98;
    }
    words = estimateTimingsInWindow(tokens, start, end);
    note =
      (note ? note + " " : "") +
      "Word timestamps were weak — used energy-window estimate.";
    if (!String(provider).includes("estimate")) provider = `${provider}+estimate`;
  }

  if (duration) words = clampWordsToDuration(words, duration);

  if (!words.length) {
    throw new Error(
      "No lyrics detected (0 words). Instrumental-only tracks and heavy music often return empty — try a vocal-forward mix, or paste lyrics manually."
    );
  }

  onProgress?.({ phase: "done", progress: 1, status: `Done — ${words.length} words` });

  return {
    lyrics: result.lyrics || wordsToLyrics(words),
    words,
    provider,
    fullText: fullText || words.map((w) => w.text).join(" "),
    appliedShiftSec,
    note,
  };
}

async function transcribeViaServer(audioFile, { onProgress, signal } = {}) {
  const form = new FormData();
  const name =
    audioFile instanceof File && audioFile.name ? audioFile.name : "song.mp3";
  form.append("file", audioFile, name);

  onProgress?.({ phase: "server", progress: 0.15, status: "Uploading to Whisper…" });

  const res = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }

  const words = normalizeWords(data.words || []);
  return {
    lyrics: data.lyrics || wordsToLyrics(words),
    words,
    provider: "openai",
    fullText: data.text || words.map((w) => w.text).join(" "),
  };
}

async function getTranscriber(onProgress) {
  if (pipePromise) return pipePromise;

  pipePromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    try {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
      }
    } catch {
      /* ignore */
    }

    onProgress?.({
      phase: "model",
      progress: 0.18,
      status: "Loading Whisper model (first run downloads ~40–75MB)…",
    });

    return pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: "q8",
      progress_callback: (p) => {
        if (!p) return;
        const pct = typeof p.progress === "number" ? p.progress : 0;
        const frac = Math.min(0.55, 0.18 + (pct / 100) * 0.35);
        onProgress?.({
          phase: "model",
          progress: frac,
          status:
            p.status === "done"
              ? "Model ready"
              : `Downloading model… ${Math.round(pct)}%`,
        });
      },
    });
  })().catch((err) => {
    pipePromise = null;
    throw err;
  });

  return pipePromise;
}

/**
 * Run ASR. English-only model: never pass language/task.
 * Preferred input: Float32Array @ 16kHz.
 */
async function transcribeInBrowser(audioFile, decoded, { onProgress, signal } = {}) {
  throwIfAborted(signal);
  const transcriber = await getTranscriber(onProgress);
  throwIfAborted(signal);

  onProgress?.({
    phase: "transcribe",
    progress: 0.58,
    status: "Transcribing vocals (1–3 min on CPU for full songs)…",
  });

  // Build best audio input
  /** @type {Float32Array | string | null} */
  let primary = null;
  let blobUrl = null;

  if (decoded?.samples?.length) {
    primary = decoded.samples; // Float32Array @ 16kHz
  } else {
    blobUrl = URL.createObjectURL(audioFile);
    primary = blobUrl;
  }

  try {
    let result = null;
    let lastErr = null;

    // Attempt A: word timestamps
    try {
      result = await transcriber(primary, {
        return_timestamps: "word",
        chunk_length_s: 30,
        stride_length_s: 5,
      });
    } catch (err) {
      lastErr = err;
      console.warn("[karaoki] word timestamps failed", err);
      onProgress?.({
        phase: "transcribe",
        progress: 0.65,
        status: "Word mode failed — trying segment timestamps…",
      });
    }

    // Attempt B: segment timestamps
    if (!hasUsableResult(result)) {
      try {
        result = await transcriber(primary, {
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
        });
      } catch (err) {
        lastErr = err;
        console.warn("[karaoki] segment timestamps failed", err);
      }
    }

    // Attempt C: plain text only
    if (!hasUsableResult(result)) {
      try {
        result = await transcriber(primary, {
          chunk_length_s: 30,
          stride_length_s: 5,
        });
      } catch (err) {
        lastErr = err;
        console.warn("[karaoki] plain ASR failed", err);
      }
    }

    // Attempt D: if we used samples and got nothing, try blob URL (or vice versa)
    if (!hasUsableResult(result)) {
      let alt = null;
      if (typeof primary !== "string") {
        blobUrl = blobUrl || URL.createObjectURL(audioFile);
        alt = blobUrl;
      } else if (decoded?.samples?.length) {
        alt = decoded.samples;
      }
      if (alt) {
        onProgress?.({
          phase: "transcribe",
          progress: 0.75,
          status: "Retrying with alternate audio format…",
        });
        try {
          result = await transcriber(alt, {
            return_timestamps: "word",
            chunk_length_s: 30,
            stride_length_s: 5,
          });
        } catch (err) {
          lastErr = err;
          try {
            result = await transcriber(alt);
          } catch (err2) {
            lastErr = err2;
          }
        }
      }
    }

    if (!hasUsableResult(result)) {
      throw lastErr || new Error("Whisper returned empty text (0 words)");
    }

    throwIfAborted(signal);
    const parsed = parseWhisperResult(result);
    console.info("[karaoki] whisper ok", {
      textLen: parsed.fullText.length,
      words: parsed.words.length,
      preview: parsed.fullText.slice(0, 80),
    });

    if (!parsed.words.length && !parsed.fullText) {
      throw new Error(
        "Whisper returned empty text. The track may be instrumental or too noisy for the free model."
      );
    }

    onProgress?.({
      phase: "transcribe",
      progress: 0.9,
      status: `Parsed ${parsed.words.length || "text"}…`,
    });

    return {
      lyrics: wordsToLyrics(parsed.words) || wrapTextAsLyrics(parsed.fullText),
      words: parsed.words,
      provider: "browser-whisper",
      fullText: parsed.fullText,
      note: parsed.note,
    };
  } finally {
    if (blobUrl) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

function hasUsableResult(result) {
  if (!result) return false;
  if (String(result.text || "").trim()) return true;
  if (Array.isArray(result.chunks) && result.chunks.length) return true;
  return false;
}

function wrapTextAsLyrics(text) {
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  for (let i = 0; i < tokens.length; i += 8) {
    lines.push(tokens.slice(i, i + 8).join(" "));
  }
  return lines.join("\n");
}

/**
 * Accept word chunks, segment chunks, or plain text from transformers output.
 */
function parseWhisperResult(result) {
  const fullText = String(result?.text || "").trim();
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];

  if (!chunks.length) {
    // Plain text only — caller will estimate timings
    return {
      words: [],
      fullText,
      note: fullText ? "No timestamps from model — will estimate." : "",
    };
  }

  const tokenCounts = chunks.map((c) =>
    String(c.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
  );
  const avgTokens =
    tokenCounts.reduce((a, b) => a + b, 0) / Math.max(1, tokenCounts.length);
  const wordLevel = avgTokens <= 1.35;

  /** @type {TimedWord[]} */
  const words = [];

  for (const c of chunks) {
    const raw = String(c.text || "").trim();
    if (!raw) continue;
    const tokens = raw.split(/\s+/).filter(Boolean);
    let s = Array.isArray(c.timestamp) ? c.timestamp[0] : null;
    let e = Array.isArray(c.timestamp) ? c.timestamp[1] : null;

    // null timestamps are common at edges — chain from previous end
    if (!Number.isFinite(s)) {
      s = words.length ? words[words.length - 1].end : 0;
    }
    if (!Number.isFinite(e)) {
      e = s + Math.max(0.2, tokens.length * 0.28);
    }
    if (e < s) e = s + 0.15;

    if (wordLevel || tokens.length === 1) {
      const text = cleanToken(tokens[0] || raw);
      if (text) words.push({ text, start: s, end: Math.max(s + 0.05, e) });
    } else {
      const weights = tokens.map((t) => Math.max(1, t.length));
      const totalW = weights.reduce((a, b) => a + b, 0) || 1;
      const span = Math.max(0.08, e - s);
      let cursor = s;
      tokens.forEach((tok, i) => {
        const wSpan = (weights[i] / totalW) * span;
        const wEnd = i === tokens.length - 1 ? e : cursor + wSpan;
        const text = cleanToken(tok);
        if (text) {
          words.push({
            text,
            start: cursor,
            end: Math.max(cursor + 0.05, wEnd),
          });
        }
        cursor = wEnd;
      });
    }
  }

  const cleaned = normalizeWords(words);
  let note = "";
  if (!wordLevel) note = "Used segment timestamps (split into words).";

  return {
    words: cleaned,
    fullText: fullText || cleaned.map((w) => w.text).join(" "),
    note,
  };
}

export function normalizeWords(words) {
  const cleaned = (words || [])
    .map((w) => ({
      text: cleanToken(w.text),
      start: Number.isFinite(Number(w.start)) ? Number(w.start) : 0,
      end: Number.isFinite(Number(w.end)) ? Number(w.end) : 0,
    }))
    .filter((w) => w.text);

  cleaned.sort((a, b) => a.start - b.start);

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i].end <= cleaned[i].start) {
      cleaned[i].end = cleaned[i].start + 0.12;
    }
    if (i < cleaned.length - 1 && cleaned[i].end > cleaned[i + 1].start) {
      cleaned[i].end = Math.max(cleaned[i].start + 0.04, cleaned[i + 1].start);
    }
  }
  return cleaned;
}

export function wordsToLyrics(words) {
  if (!words?.length) return "";
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    const gap =
      i + 1 < words.length ? words[i + 1].start - words[i].end : Number.POSITIVE_INFINITY;
    if (gap > 0.55 || buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

function cleanToken(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  // Keep apostrophes inside words (don't, it's)
  const stripped = s.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").trim();
  return stripped || s;
}

function shortErr(err) {
  return String(err?.message || err || "error").slice(0, 160);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export const UNTAPPED_START = FAR;
