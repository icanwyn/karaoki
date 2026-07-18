/**
 * Auto-transcribe audio → lyrics + word timings via Whisper.
 *
 * Critical (transformers.js + English-only models):
 * - Pass Float32Array samples at 16 kHz (NOT { raw, sampling_rate })
 * - Do NOT pass `language` or `task` to *.en models (throws → empty result)
 */

import {
  clampWordsToDuration,
  decodeMono16k,
  estimateTimingsInWindow,
  findActiveWindow,
  snapTimingsToAudio,
  timingsLookValid,
} from "./audioAlign.js";

const FAR = 1e9;
// base.en is more accurate than tiny for sung lyrics (still free, still local).
// Fall back to tiny if base fails to load.
const MODEL_CANDIDATES = [
  { id: "Xenova/whisper-base.en", dtypes: ["fp32", "fp16"] },
  { id: "Xenova/whisper-tiny.en", dtypes: ["fp32", "fp16"] },
];

/** @type {Promise<any> | null} */
let pipePromise = null;
let activeDtype = "";
let activeModelId = "";

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
  const {
    onProgress,
    signal,
    preferBrowser = false,
    durationHint = 0,
    /** Known lyrics to guide Whisper + for forced alignment on the client */
    prompt = "",
  } = opts;
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
      const server = await transcribeViaServer(audioFile, {
        onProgress,
        signal,
        prompt,
      });
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

  // Rebuild if timestamps are junk / crushed into the intro
  if ((!timingsLookValid(words, duration) || !words.length) && fullText) {
    onProgress?.({
      phase: "estimate",
      progress: 0.92,
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
      start = Math.min(3, end * 0.08);
      end = end * 0.98;
    }
    words = estimateTimingsInWindow(tokens, start, end);
    note =
      (note ? note + " " : "") +
      "Word timestamps were weak — used energy-window estimate.";
    if (!String(provider).includes("estimate")) provider = `${provider}+estimate`;
  }

  // Snap to silence/content so highlights never fire before the track has sound
  if (words.length && decoded?.samples?.length) {
    onProgress?.({
      phase: "align",
      progress: 0.96,
      status: "Aligning lyrics after silence / intro…",
    });
    const snapped = snapTimingsToAudio(
      words,
      decoded.samples,
      decoded.sampleRate
    );
    words = snapped.words;
    appliedShiftSec = snapped.appliedShiftSec || 0;
    if (snapped.note) note = (note ? note + " " : "") + snapped.note;
  } else if (duration) {
    words = clampWordsToDuration(words, duration);
  }

  if (!words.length) {
    throw new Error(
      "No lyrics detected (0 words). Instrumental-only tracks and heavy music often return empty — try a vocal-forward mix, or paste lyrics manually."
    );
  }

  // Rebuild display lyrics from final word list so text matches timed words
  const lyrics = wordsToLyrics(words);

  onProgress?.({
    phase: "done",
    progress: 1,
    status: `Done — ${words.length} words (first at ${words[0].start.toFixed(1)}s)`,
  });

  return {
    lyrics,
    words,
    provider,
    fullText: fullText || words.map((w) => w.text).join(" "),
    appliedShiftSec,
    note,
    firstWordAt: words[0].start,
  };
}

async function transcribeViaServer(audioFile, { onProgress, signal, prompt = "" } = {}) {
  const form = new FormData();
  const name =
    audioFile instanceof File && audioFile.name ? audioFile.name : "song.mp3";
  form.append("file", audioFile, name);
  if (prompt) form.append("prompt", String(prompt).slice(0, 800));

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
        env.backends.onnx.wasm.simd = true;
      }
    } catch {
      /* ignore */
    }

    let lastErr = null;
    for (const model of MODEL_CANDIDATES) {
      for (const dtype of model.dtypes) {
        try {
          onProgress?.({
            phase: "model",
            progress: 0.16,
            status: `Loading ${model.id.split("/").pop()} (${dtype})…`,
          });

          const pipe = await pipeline("automatic-speech-recognition", model.id, {
            dtype,
            progress_callback: (p) => {
              if (!p) return;
              const pct = typeof p.progress === "number" ? p.progress : 0;
              const frac = Math.min(0.55, 0.16 + (pct / 100) * 0.36);
              onProgress?.({
                phase: "model",
                progress: frac,
                status:
                  p.status === "done"
                    ? `Model ready (${model.id.split("/").pop()} / ${dtype})`
                    : `Downloading model… ${Math.round(pct)}%`,
              });
            },
          });

          onProgress?.({
            phase: "model",
            progress: 0.56,
            status: `Warming up ONNX session…`,
          });
          // Short non-silent chirp — pure silence sometimes confuses warm-up
          const warm = new Float32Array(16000);
          for (let i = 0; i < warm.length; i++) {
            warm[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.02;
          }
          await pipe(warm);

          activeDtype = dtype;
          activeModelId = model.id;
          console.info("[karaoki] whisper session ready", {
            model: model.id,
            dtype,
          });
          return pipe;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[karaoki] ${model.id} / ${dtype} failed`,
            err?.message || err
          );
          onProgress?.({
            phase: "model",
            progress: 0.18,
            status: `${dtype} failed — trying next…`,
          });
        }
      }
    }

    throw lastErr || new Error("Could not create Whisper ONNX session");
  })().catch((err) => {
    pipePromise = null;
    activeDtype = "";
    activeModelId = "";
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
      provider: activeModelId
        ? `browser-whisper/${activeModelId.split("/").pop()}/${activeDtype}`
        : "browser-whisper",
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
