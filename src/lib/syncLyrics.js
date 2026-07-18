/**
 * Caption-first sync: compress audio → free/server Whisper → SRT → word timings.
 * Never loads in-browser ML (no freeze).
 */

import { compressAudioForUpload } from "./compressAudio.js";
import {
  srtToWords,
  wordsToSrt,
  looksLikeSrt,
  parseSrt,
  refineWordsWithEnergy,
} from "./srt.js";
import { alignLyricsToAsr, alignmentMatchRate, tokenizeLyricWords } from "./alignLyrics.js";
import { energySyncLyrics } from "./energySync.js";
import { decodeMono16k } from "./audioAlign.js";

/**
 * Transcribe song → SRT + timed words (server only).
 * @param {File|Blob} file
 * @param {{
 *   onProgress?: (p: { progress?: number, status?: string }) => void,
 *   signal?: AbortSignal,
 *   prompt?: string,
 * }} [opts]
 */
export async function transcribeToSrt(file, opts = {}) {
  const { onProgress, signal, prompt = "" } = opts;
  if (!file) throw new Error("Upload a song first");

  onProgress?.({ progress: 0.05, status: "Compressing audio for upload…" });
  const compressed = await compressAudioForUpload(file, { onProgress, signal });
  throwIfAborted(signal);

  if (compressed.truncated) {
    onProgress?.({
      progress: 0.4,
      status: `Note: long track trimmed to ~${compressed.duration.toFixed(0)}s for free API limits…`,
    });
  }

  onProgress?.({ progress: 0.45, status: "Uploading for SRT transcription…" });

  const form = new FormData();
  form.append("file", compressed.blob, compressed.filename);
  form.append("format", "srt");
  if (prompt) form.append("prompt", String(prompt).slice(0, 800));

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 120_000);

  let tick = 0.5;
  const prog = setInterval(() => {
    tick = Math.min(0.9, tick + 0.02);
    onProgress?.({ progress: tick, status: "Transcribing → SRT captions…" });
  }, 700);

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

    let srt = data.srt || "";
    let words = Array.isArray(data.words) ? data.words : [];

    if (srt && !words.length) {
      words = srtToWords(srt);
    }
    if (!srt && words.length) {
      srt = wordsToSrt(words);
    }
    if (!words.length && data.text) {
      // last resort: no timestamps
      throw new Error("Got text but no SRT timestamps. Try uploading an .srt file.");
    }
    if (!words.length) {
      throw new Error("Empty transcription. Try a clearer vocal track or upload SRT.");
    }

    onProgress?.({ progress: 1, status: "Done" });
    return {
      srt,
      words,
      text: data.text || words.map((w) => w.text).join(" "),
      lyrics: data.lyrics || cuesToLyrics(srt) || wordsToLines(words),
      provider: data.provider || "server",
      truncated: compressed.truncated,
    };
  } finally {
    clearTimeout(timer);
    clearInterval(prog);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Sync user's lyrics to audio using SRT transcription + alignment,
 * or energy fallback. Also accepts raw SRT as lyricsText.
 */
export async function syncLyricsToAudio(file, lyricsText, opts = {}) {
  const { onProgress, signal, durationHint = 0 } = opts;

  // If user pasted SRT, just parse it — no network
  if (looksLikeSrt(lyricsText)) {
    onProgress?.({ progress: 0.5, status: "Parsing SRT…" });
    const words = srtToWords(lyricsText);
    if (!words.length) throw new Error("Could not parse SRT");
    onProgress?.({ progress: 1, status: "Done" });
    return {
      words,
      srt: lyricsText,
      method: "srt-paste",
      provider: "srt",
      firstAt: words[0].start,
      note: `Loaded ${parseSrt(lyricsText).length} SRT cues → ${words.length} words.`,
      lyrics: cuesToLyrics(lyricsText),
    };
  }

  const refWords = tokenizeLyricWords(lyricsText);
  if (!refWords.length) throw new Error("Paste lyrics or SRT first");
  if (!file) throw new Error("Upload a song first");

  // Try server SRT transcription
  try {
    const cap = await transcribeToSrt(file, {
      onProgress,
      signal,
      prompt: lyricsText,
    });
    throwIfAborted(signal);

    onProgress?.({ progress: 0.92, status: "Aligning your lyrics to SRT times…" });
    await yieldToUi();

    const match = alignmentMatchRate(refWords, cap.words);
    const aligned = alignLyricsToAsr(refWords, cap.words, {
      duration: durationHint || cap.words.at(-1)?.end || 0,
    });

    if (aligned.length && match >= 0.1) {
      return {
        words: aligned,
        srt: wordsToSrt(aligned),
        method: "srt+align",
        provider: cap.provider,
        match,
        firstAt: aligned[0].start,
        note: `SRT from ${cap.provider}, aligned your lyrics (match ~${Math.round(match * 100)}%).`,
        lyrics: lyricsText,
      };
    }

    // Use ASR/SRT words directly if alignment weak but we have captions
    if (cap.words.length) {
      return {
        words: cap.words,
        srt: cap.srt,
        method: "srt-direct",
        provider: cap.provider,
        match,
        firstAt: cap.words[0].start,
        note: `Using transcribed SRT from ${cap.provider} (your text didn't match closely — edit lyrics if needed).`,
        lyrics: cap.lyrics || lyricsText,
      };
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[karaoki] SRT sync failed", err);
    onProgress?.({
      progress: 0.4,
      status: `Caption API failed (${short(err)}) — energy sync…`,
    });
  }

  // Energy fallback
  const energy = await energySyncLyrics(file, refWords, {
    onProgress,
    signal,
    durationHint,
  });
  return {
    words: energy.words,
    srt: wordsToSrt(energy.words),
    method: "energy",
    provider: "energy",
    firstAt: energy.firstAt,
    note: "Timed from audio energy. For better sync, upload an .srt from a free tool.",
    lyrics: lyricsText,
  };
}

/**
 * Apply an uploaded SRT/VTT file.
 * If song audio is provided, refine in-cue word timing with energy so
 * highlights follow the music instead of equal clock ticks.
 *
 * @param {File} file - .srt/.vtt
 * @param {File|Blob|null} [audioFile]
 */
export async function loadSrtFile(file, audioFile = null) {
  const text = await file.text();
  let words = srtToWords(text);
  if (!words.length) throw new Error("No cues found in SRT/VTT file");

  let note = `Imported ${parseSrt(text).length} caption lines (weighted word flow).`;
  if (audioFile) {
    try {
      const decoded = await decodeMono16k(audioFile);
      words = refineWordsWithEnergy(words, decoded.samples, decoded.sampleRate);
      note += " Refined word timing to audio energy inside each line.";
    } catch (err) {
      console.warn("[karaoki] energy refine skipped", err);
      note += " (Audio refine skipped — using weighted SRT split.)";
    }
  } else {
    note += " Upload the song too for music-flow refine inside each line.";
  }

  return {
    words,
    srt: text,
    lyrics: cuesToLyrics(text),
    firstAt: words[0].start,
    note,
  };
}

/**
 * Re-apply energy flow to existing timed words (e.g. after offset tweak or re-import).
 * @param {import('./srt.js').TimedWord[]} words
 * @param {File|Blob} audioFile
 */
export async function refineExistingWithAudio(words, audioFile) {
  if (!words?.length || !audioFile) return words;
  const decoded = await decodeMono16k(audioFile);
  return refineWordsWithEnergy(words, decoded.samples, decoded.sampleRate);
}

function cuesToLyrics(srt) {
  return parseSrt(srt)
    .map((c) => c.text)
    .join("\n");
}

function wordsToLines(words) {
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    if (buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

function yieldToUi() {
  return new Promise((r) => setTimeout(r, 0));
}
function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
function short(err) {
  return String(err?.message || err || "error").slice(0, 80);
}
