/**
 * Auto-transcribe audio → lyrics text + word-level timings.
 * Prefers server Whisper (OPENAI_API_KEY) when available; falls back to
 * in-browser Whisper via @huggingface/transformers (no API key).
 */

import {
  alignWordsToOnset,
  clampWordsToDuration,
  decodeMono16k,
  findEnergyOnset,
} from "./audioAlign.js";

const FAR = 1e9;

/**
 * @typedef {{ text: string, start: number, end: number }} TimedWord
 * @typedef {{
 *   lyrics: string,
 *   words: TimedWord[],
 *   provider: 'openai' | 'browser',
 *   fullText: string,
 *   appliedShiftSec?: number,
 * }} TranscribeResult
 */

/**
 * @param {File|Blob} audioFile
 * @param {{
 *   onProgress?: (p: { phase: string, progress?: number, status?: string, file?: string }) => void,
 *   signal?: AbortSignal,
 *   preferBrowser?: boolean,
 * }} [opts]
 * @returns {Promise<TranscribeResult>}
 */
export async function transcribeSong(audioFile, opts = {}) {
  const { onProgress, signal, preferBrowser = false } = opts;
  if (!audioFile) throw new Error("No audio file to transcribe");

  // Always decode once so we can onset-align server or browser results
  onProgress?.({ phase: "decode", progress: 0.05, status: "Decoding audio…" });
  let decoded = null;
  try {
    decoded = await decodeMono16k(audioFile);
  } catch {
    decoded = null;
  }
  throwIfAborted(signal);

  if (!preferBrowser) {
    try {
      onProgress?.({ phase: "server", progress: 0.08, status: "Trying server transcription…" });
      const server = await transcribeViaServer(audioFile, { onProgress, signal });
      if (server?.words?.length) {
        return postAlign(server, decoded, onProgress);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      onProgress?.({
        phase: "fallback",
        progress: 0.12,
        status: err?.message?.includes("not configured")
          ? "No server key — using on-device Whisper…"
          : `Server unavailable (${shortErr(err)}) — using on-device Whisper…`,
      });
    }
  }

  const browser = await transcribeInBrowser(audioFile, decoded, { onProgress, signal });
  return postAlign(browser, decoded, onProgress);
}

/**
 * @param {TranscribeResult} result
 * @param {{ samples: Float32Array, sampleRate: number, duration: number } | null} decoded
 * @param {Function} [onProgress]
 */
function postAlign(result, decoded, onProgress) {
  let words = normalizeWords(result.words || []);
  let appliedShiftSec = 0;

  if (decoded?.samples?.length) {
    onProgress?.({ phase: "align", progress: 0.95, status: "Aligning lyrics to audio onset…" });
    const onset = findEnergyOnset(decoded.samples, decoded.sampleRate);
    const aligned = alignWordsToOnset(words, onset);
    words = aligned.words;
    appliedShiftSec = aligned.appliedShiftSec;
    words = clampWordsToDuration(words, decoded.duration);
  }

  return {
    ...result,
    words,
    lyrics: result.lyrics || wordsToLyrics(words),
    appliedShiftSec,
  };
}

/**
 * @param {File|Blob} audioFile
 * @param {{ onProgress?: Function, signal?: AbortSignal }} opts
 */
async function transcribeViaServer(audioFile, { onProgress, signal } = {}) {
  const form = new FormData();
  const name =
    audioFile instanceof File && audioFile.name
      ? audioFile.name
      : "song.mp3";
  form.append("file", audioFile, name);

  onProgress?.({ phase: "server", progress: 0.15, status: "Uploading audio…" });

  const res = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  onProgress?.({ phase: "server", progress: 0.9, status: "Server done" });
  const words = normalizeWords(data.words || []);
  if (!words.length) throw new Error("Server returned no words");

  return {
    lyrics: data.lyrics || wordsToLyrics(words),
    words,
    provider: "openai",
    fullText: data.text || words.map((w) => w.text).join(" "),
  };
}

/**
 * In-browser Whisper (Xenova). First run downloads the model (~150MB for base.en).
 * @param {File|Blob} audioFile
 * @param {{ samples: Float32Array, sampleRate: number, duration: number } | null} decoded
 * @param {{ onProgress?: Function, signal?: AbortSignal }} opts
 */
async function transcribeInBrowser(audioFile, decoded, { onProgress, signal } = {}) {
  throwIfAborted(signal);
  onProgress?.({ phase: "model", progress: 0.15, status: "Loading Whisper model…" });

  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  throwIfAborted(signal);

  const transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-base.en",
    {
      dtype: "q8",
      progress_callback: (p) => {
        if (!p) return;
        const frac =
          typeof p.progress === "number"
            ? Math.min(0.55, 0.15 + (p.progress / 100) * 0.35)
            : 0.2;
        onProgress?.({
          phase: "model",
          progress: frac,
          status: p.status === "done" ? "Model ready" : `Downloading model… ${p.file || ""}`,
          file: p.file,
        });
      },
    }
  );

  throwIfAborted(signal);
  onProgress?.({ phase: "transcribe", progress: 0.6, status: "Transcribing & aligning words…" });

  // Prefer raw 16 kHz mono — more reliable timestamps than a compressed blob URL
  const input = decoded?.samples?.length
    ? { raw: decoded.samples, sampling_rate: decoded.sampleRate }
    : URL.createObjectURL(audioFile);

  const revoke =
    typeof input === "string"
      ? () => URL.revokeObjectURL(input)
      : () => {};

  try {
    const result = await transcriber(input, {
      return_timestamps: "word",
      chunk_length_s: 20,
      stride_length_s: 3,
      language: "english",
      task: "transcribe",
    });

    throwIfAborted(signal);

    let words = chunksToWords(result);
    if (!words.length) {
      words = segmentsToWords(result);
    }
    if (!words.length) {
      throw new Error(
        "Could not extract words from this track. Try a clearer vocal recording or paste lyrics manually."
      );
    }

    onProgress?.({ phase: "transcribe", progress: 0.9, status: "Transcription complete" });
    return {
      lyrics: wordsToLyrics(words),
      words,
      provider: "browser",
      fullText: (result?.text || words.map((w) => w.text).join(" ")).trim(),
    };
  } finally {
    revoke();
  }
}

function chunksToWords(result) {
  const chunks = result?.chunks;
  if (!Array.isArray(chunks) || !chunks.length) return [];

  /** @type {TimedWord[]} */
  const words = [];
  for (const c of chunks) {
    const raw = String(c.text || "").trim();
    if (!raw) continue;
    const [s, e] = Array.isArray(c.timestamp) ? c.timestamp : [null, null];
    const tokens = raw.split(/\s+/).filter(Boolean);
    const start = Number.isFinite(s) ? s : words.length ? words[words.length - 1].end : 0;
    const end = Number.isFinite(e) ? e : start + Math.max(0.2, tokens.length * 0.25);
    if (tokens.length === 1) {
      words.push({
        text: cleanToken(tokens[0]),
        start,
        end: Math.max(start + 0.05, end),
      });
    } else {
      // Phrase-level timestamp: distribute words by relative character length
      const weights = tokens.map((t) => Math.max(1, t.length));
      const totalW = weights.reduce((a, b) => a + b, 0);
      const span = Math.max(0.08, end - start);
      let cursor = start;
      tokens.forEach((tok, i) => {
        const wSpan = (weights[i] / totalW) * span;
        const wEnd = i === tokens.length - 1 ? end : cursor + wSpan;
        words.push({
          text: cleanToken(tok),
          start: cursor,
          end: Math.max(cursor + 0.05, wEnd),
        });
        cursor = wEnd;
      });
    }
  }
  return normalizeWords(words);
}

function segmentsToWords(result) {
  if (Array.isArray(result?.chunks) && result.chunks.length) {
    return chunksToWords(result);
  }
  return [];
}

/**
 * @param {TimedWord[]} words
 * @returns {TimedWord[]}
 */
export function normalizeWords(words) {
  const cleaned = (words || [])
    .map((w) => ({
      text: cleanToken(w.text),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }))
    .filter((w) => w.text);

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
    const pauseBreak = gap > 0.55;
    const lengthBreak = buf.length >= 8;
    if (pauseBreak || lengthBreak || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

function cleanToken(t) {
  return String(t || "")
    .replace(/^[\s"'([{]+|[\s"'.,!?;:)\]}]+$/g, "")
    .trim() || String(t || "").trim();
}

function shortErr(err) {
  return String(err?.message || err || "error").slice(0, 80);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** Sentinel used for untapped words during manual sync (never matches playhead). */
export const UNTAPPED_START = FAR;
