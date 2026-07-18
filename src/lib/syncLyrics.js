/**
 * Sync known lyrics to a song without freezing the UI.
 *
 * Strategy (never loads browser Whisper / transformers.js):
 * 1. OpenAI Whisper via /api/transcribe (network-only — keeps UI responsive)
 * 2. Align your exact words onto ASR timestamps
 * 3. If server fails → fast energy-based placement (no ML)
 */

import { alignLyricsToAsr, alignmentMatchRate, tokenizeLyricWords } from "./alignLyrics.js";
import { energySyncLyrics } from "./energySync.js";

/**
 * @param {File|Blob} file
 * @param {string} lyricsText
 * @param {{
 *   onProgress?: (p: { progress?: number, status?: string }) => void,
 *   signal?: AbortSignal,
 *   durationHint?: number,
 * }} [opts]
 */
export async function syncLyricsToAudio(file, lyricsText, opts = {}) {
  const { onProgress, signal, durationHint = 0 } = opts;
  const words = tokenizeLyricWords(lyricsText);
  if (!words.length) throw new Error("Paste lyrics first");
  if (!file) throw new Error("Upload a song first");

  // --- 1) Server Whisper only (does not block the main thread like in-browser ML) ---
  try {
    onProgress?.({ progress: 0.08, status: "Uploading to server Whisper…" });
    const asr = await transcribeServerOnly(file, lyricsText, { signal, onProgress });
    throwIfAborted(signal);

    onProgress?.({ progress: 0.88, status: "Aligning your lyrics to timestamps…" });
    await yieldToUi();

    const match = alignmentMatchRate(words, asr.words);
    const aligned = alignLyricsToAsr(words, asr.words, {
      duration: durationHint || asr.words.at(-1)?.end || 0,
    });

    if (aligned.length && match >= 0.12) {
      onProgress?.({ progress: 1, status: "Done" });
      return {
        words: aligned,
        method: "server-whisper+align",
        match,
        provider: "openai",
        firstAt: aligned[0].start,
        note: `Aligned with server Whisper (match ~${Math.round(match * 100)}%).`,
      };
    }

    onProgress?.({
      progress: 0.5,
      status: "Server times were weak — using energy sync…",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[karaoki] server sync failed, using energy", err?.message || err);
    onProgress?.({
      progress: 0.35,
      status: `Server unavailable (${short(err)}) — energy sync…`,
    });
  }

  // --- 2) Energy fallback (always responsive) ---
  const energy = await energySyncLyrics(file, words, {
    onProgress,
    signal,
    durationHint,
  });

  return {
    words: energy.words,
    method: "energy",
    match: 0,
    provider: "energy",
    firstAt: energy.firstAt,
    note: "Timed from audio energy (no ML). Refine with Global offset or Tap Sync.",
  };
}

/**
 * Server-only transcription. Never falls back to browser Whisper.
 */
async function transcribeServerOnly(file, prompt, { signal, onProgress } = {}) {
  const form = new FormData();
  const name = file instanceof File && file.name ? file.name : "song.mp3";
  form.append("file", file, name);
  if (prompt) form.append("prompt", String(prompt).slice(0, 800));

  // Hard timeout so we never hang the UI spinner forever
  const timeoutMs = 120_000;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // Fake progress while waiting on network
  let tick = 0.1;
  const prog = setInterval(() => {
    tick = Math.min(0.8, tick + 0.03);
    onProgress?.({ progress: tick, status: "Server Whisper is processing…" });
  }, 800);

  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    const words = (data.words || [])
      .map((w) => ({
        text: String(w.text || w.word || "").trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
      }))
      .filter((w) => w.text);
    if (!words.length && !data.text) {
      throw new Error("Server returned no words");
    }
    return { words, text: data.text || "" };
  } finally {
    clearTimeout(timer);
    clearInterval(prog);
    signal?.removeEventListener("abort", onAbort);
  }
}

function yieldToUi() {
  return new Promise((r) => setTimeout(r, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function short(err) {
  return String(err?.message || err || "error").slice(0, 60);
}
