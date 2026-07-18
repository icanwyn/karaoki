/**
 * Auto-transcribe audio → lyrics + word timings.
 *
 * Strategy (in order):
 * 1. Server Whisper if OPENAI_API_KEY is configured
 * 2. On-device Whisper (transformers.js) with word timestamps
 * 3. On-device Whisper segment timestamps → split into words
 * 4. Plain transcript text → estimate timings across the active audio window
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

/** @type {Promise<any> | null} */
let pipePromise = null;
let pipeModelId = "";

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

  onProgress?.({ phase: "decode", progress: 0.04, status: "Decoding audio…" });
  let decoded = null;
  try {
    decoded = await decodeMono16k(audioFile);
  } catch (err) {
    onProgress?.({
      phase: "decode",
      progress: 0.05,
      status: `Decode warning: ${shortErr(err)} — continuing…`,
    });
  }
  throwIfAborted(signal);

  const duration = decoded?.duration || durationHint || 0;

  // 1) Server
  if (!preferBrowser) {
    try {
      onProgress?.({ phase: "server", progress: 0.08, status: "Trying server Whisper…" });
      const server = await transcribeViaServer(audioFile, { onProgress, signal });
      if (server?.words?.length || server?.fullText) {
        return finalizeResult(server, decoded, duration, onProgress);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      const msg = String(err?.message || err);
      onProgress?.({
        phase: "fallback",
        progress: 0.12,
        status: /not configured|OPENAI|503/i.test(msg)
          ? "No server API key — running Whisper in your browser…"
          : `Server unavailable — running Whisper in your browser…`,
      });
    }
  }

  // 2) Browser Whisper
  try {
    const browser = await transcribeInBrowser(audioFile, decoded, { onProgress, signal });
    return finalizeResult(browser, decoded, duration, onProgress);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Last resort already handled inside finalize if we had text;
    // if pipeline failed entirely, rethrow with a clear message.
    throw new Error(
      `Auto lyrics failed: ${shortErr(err)}. ` +
        "Try Chrome/Edge, a shorter clip, or paste lyrics and use Auto-time / Tap Sync."
    );
  }
}

/**
 * Merge word timestamps, validate, fall back to window estimate if junk.
 */
function finalizeResult(result, decoded, duration, onProgress) {
  let words = normalizeWords(result.words || []);
  let appliedShiftSec = 0;
  let note = result.note || "";
  let provider = result.provider || "unknown";
  const fullText = (result.fullText || words.map((w) => w.text).join(" ")).trim();

  // Soft positive-only onset fix (won't pull lyrics back to the first drum hit)
  if (words.length && decoded?.samples?.length) {
    const onset = findEnergyOnset(decoded.samples, decoded.sampleRate);
    const aligned = alignWordsToOnset(words, onset);
    words = aligned.words;
    appliedShiftSec = aligned.appliedShiftSec || 0;
  }

  // If timestamps are missing or useless, rebuild from text + active window
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
      // Lead-in guess when we can't analyze energy
      start = Math.min(2, end * 0.05);
      end = end * 0.98;
    }
    words = estimateTimingsInWindow(tokens, start, end);
    note =
      (note ? note + " " : "") +
      "Word timestamps were weak — used energy-window estimate. Refine with offset or Tap Sync.";
    if (!provider.includes("estimate")) provider = `${provider}+estimate`;
  }

  if (duration) words = clampWordsToDuration(words, duration);

  if (!words.length) {
    throw new Error(
      "No lyrics detected in this track. Try a clearer vocal mix, or paste lyrics manually."
    );
  }

  onProgress?.({ phase: "done", progress: 1, status: "Done" });

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

/**
 * Configure transformers env once (WASM from CDN — avoids Vite path breakage).
 */
async function getTranscriber(onProgress) {
  const modelId = "Xenova/whisper-tiny.en"; // smaller/faster; reliable in browsers
  if (pipePromise && pipeModelId === modelId) return pipePromise;

  pipeModelId = modelId;
  pipePromise = (async () => {
    const transformers = await import("@huggingface/transformers");
    const { pipeline, env } = transformers;

    env.allowLocalModels = false;
    env.useBrowserCache = true;
    // Critical for Vite/prod: load ORT WASM from the package CDN, not broken hashed assets
    try {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
        // Let the library fetch compatible WASM; proxy via jsDelivr if needed
        const ver = transformers?.env ? "" : "";
        void ver;
      }
    } catch {
      /* ignore */
    }

    onProgress?.({ phase: "model", progress: 0.18, status: "Loading Whisper model (first run downloads ~75MB)…" });

    return pipeline("automatic-speech-recognition", modelId, {
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
    pipeModelId = "";
    throw err;
  });

  return pipePromise;
}

async function transcribeInBrowser(audioFile, decoded, { onProgress, signal } = {}) {
  throwIfAborted(signal);

  const transcriber = await getTranscriber(onProgress);
  throwIfAborted(signal);

  onProgress?.({
    phase: "transcribe",
    progress: 0.58,
    status: "Transcribing (this can take 1–3 min on CPU)…",
  });

  // Prefer blob URL — most compatible path across transformers versions
  const url = URL.createObjectURL(audioFile);
  let result;
  try {
    // Attempt 1: word timestamps
    try {
      result = await transcriber(url, {
        return_timestamps: "word",
        chunk_length_s: 30,
        stride_length_s: 5,
        language: "english",
        task: "transcribe",
      });
    } catch (wordErr) {
      onProgress?.({
        phase: "transcribe",
        progress: 0.62,
        status: "Word mode failed — trying segment timestamps…",
      });
      result = await transcriber(url, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: "english",
        task: "transcribe",
      });
    }

    // If raw samples available and result is empty, try raw input once
    if (!result?.text && !result?.chunks?.length && decoded?.samples?.length) {
      onProgress?.({
        phase: "transcribe",
        progress: 0.7,
        status: "Retrying with decoded PCM audio…",
      });
      try {
        result = await transcriber(
          { raw: decoded.samples, sampling_rate: decoded.sampleRate },
          {
            return_timestamps: "word",
            chunk_length_s: 30,
            stride_length_s: 5,
            language: "english",
            task: "transcribe",
          }
        );
      } catch {
        result = await transcriber(
          { raw: decoded.samples, sampling_rate: decoded.sampleRate },
          {
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
            language: "english",
            task: "transcribe",
          }
        );
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  throwIfAborted(signal);

  const parsed = parseWhisperResult(result);
  if (!parsed.words.length && !parsed.fullText) {
    throw new Error(
      "Whisper returned empty text. The track may be instrumental-only or too noisy."
    );
  }

  onProgress?.({ phase: "transcribe", progress: 0.9, status: "Parsing word timings…" });

  return {
    lyrics: wordsToLyrics(parsed.words) || parsed.fullText,
    words: parsed.words,
    provider: "browser-whisper",
    fullText: parsed.fullText,
    note: parsed.note,
  };
}

/**
 * Accept word chunks, segment chunks, or plain text from transformers output.
 */
function parseWhisperResult(result) {
  const fullText = String(result?.text || "").trim();
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];

  if (!chunks.length) {
    return { words: [], fullText, note: fullText ? "No timestamps from model." : "" };
  }

  // Detect word-level vs segment-level: average tokens per chunk
  const tokenCounts = chunks.map((c) =>
    String(c.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
  );
  const avgTokens = tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length;
  const wordLevel = avgTokens <= 1.35;

  /** @type {TimedWord[]} */
  const words = [];
  let nullTs = 0;

  for (const c of chunks) {
    const raw = String(c.text || "").trim();
    if (!raw) continue;
    const tokens = raw.split(/\s+/).filter(Boolean);
    let s = Array.isArray(c.timestamp) ? c.timestamp[0] : null;
    let e = Array.isArray(c.timestamp) ? c.timestamp[1] : null;
    if (!Number.isFinite(s)) {
      nullTs += 1;
      s = words.length ? words[words.length - 1].end : 0;
    }
    if (!Number.isFinite(e)) {
      e = s + Math.max(0.2, tokens.length * 0.28);
    }
    if (e < s) e = s + 0.15;

    if (wordLevel || tokens.length === 1) {
      words.push({
        text: cleanToken(tokens[0] || raw),
        start: s,
        end: Math.max(s + 0.05, e),
      });
    } else {
      // Distribute words inside the segment by character weight
      const weights = tokens.map((t) => Math.max(1, t.length));
      const totalW = weights.reduce((a, b) => a + b, 0) || 1;
      const span = Math.max(0.08, e - s);
      let cursor = s;
      tokens.forEach((tok, i) => {
        const wSpan = (weights[i] / totalW) * span;
        const wEnd = i === tokens.length - 1 ? e : cursor + wSpan;
        words.push({
          text: cleanToken(tok),
          start: cursor,
          end: Math.max(cursor + 0.05, wEnd),
        });
        cursor = wEnd;
      });
    }
  }

  const cleaned = normalizeWords(words);
  let note = "";
  if (!wordLevel) note = "Used segment timestamps (split into words).";
  if (nullTs > chunks.length * 0.5) {
    note = (note ? note + " " : "") + "Many missing timestamps.";
  }

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
  const stripped = s.replace(/^[\s"'([{]+|[\s"'.,!?;:)\]}]+$/g, "").trim();
  return stripped || s;
}

function shortErr(err) {
  return String(err?.message || err || "error").slice(0, 120);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export const UNTAPPED_START = FAR;
