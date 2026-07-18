/**
 * Fast, UI-friendly lyric timing from audio energy only.
 * No Whisper / no ML — runs in small chunks with yields so the page stays responsive.
 */

/**
 * @typedef {{ text: string, start: number, end: number }} TimedWord
 */

/**
 * @param {File|Blob} file
 * @param {string[]} words
 * @param {{
 *   onProgress?: (p: { progress: number, status: string }) => void,
 *   signal?: AbortSignal,
 *   durationHint?: number,
 * }} [opts]
 * @returns {Promise<{ words: TimedWord[], method: string, firstAt: number }>}
 */
export async function energySyncLyrics(file, words, opts = {}) {
  const { onProgress, signal, durationHint = 0 } = opts;
  const list = (words || []).map((w) => String(w).trim()).filter(Boolean);
  if (!list.length) throw new Error("No lyrics to sync");

  onProgress?.({ progress: 0.1, status: "Analyzing audio energy…" });
  throwIfAborted(signal);

  const { samples, sampleRate, duration } = await decodeDownsampled(file, signal);
  throwIfAborted(signal);

  onProgress?.({ progress: 0.45, status: "Finding active sections…" });
  await yieldToUi();

  const segments = findActiveSegments(samples, sampleRate);
  await yieldToUi();

  onProgress?.({ progress: 0.7, status: "Placing lyrics on the timeline…" });

  let timed;
  if (!segments.length) {
    // Fallback: skip a short intro, fill most of the track
    const start = Math.min(2, duration * 0.08);
    const end = Math.max(start + 1, duration * 0.92);
    timed = placeEvenly(list, start, end);
  } else {
    timed = placeAcrossSegments(list, segments);
  }

  onProgress?.({ progress: 1, status: "Done" });
  return {
    words: timed,
    method: "energy",
    firstAt: timed[0]?.start ?? 0,
    duration: duration || durationHint,
  };
}

/**
 * Decode audio and aggressively downsample for analysis only (~4kHz mono).
 * Much lighter than full 16k Whisper prep.
 */
async function decodeDownsampled(file, signal) {
  throwIfAborted(signal);
  const ab = await file.arrayBuffer();
  throwIfAborted(signal);

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(ab.slice(0));
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }

  await yieldToUi();
  throwIfAborted(signal);

  // Mix to mono
  const n = decoded.length;
  const ch = decoded.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / ch;
  }

  // Downsample to ~4kHz — enough for energy / silence, ~4× less work
  const targetRate = 4000;
  const ratio = decoded.sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(n / ratio));
  const samples = new Float32Array(outLen);
  // Process in chunks + yield
  const chunk = 50000;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = src - i0;
    samples[i] = mono[i0] * (1 - t) + mono[i1] * t;
    if (i > 0 && i % chunk === 0) {
      await yieldToUi();
      throwIfAborted(signal);
    }
  }

  return {
    samples,
    sampleRate: targetRate,
    duration: n / decoded.sampleRate,
  };
}

/**
 * @returns {{ start: number, end: number, weight: number }[]}
 */
function findActiveSegments(samples, sampleRate) {
  const hopSec = 0.08;
  const hop = Math.max(1, Math.floor(sampleRate * hopSec));
  const n = Math.ceil(samples.length / hop);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = i * hop;
    const b = Math.min(samples.length, a + hop);
    let s = 0;
    for (let j = a; j < b; j++) s += samples[j] * samples[j];
    const r = Math.sqrt(s / (b - a || 1));
    rms[i] = r;
    if (r > peak) peak = r;
  }
  if (peak < 1e-6) return [];

  // Noise floor
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const thresh = Math.max(floor * 4, peak * 0.12, 0.008);

  /** @type {{ start: number, end: number }[]} */
  const raw = [];
  let inSeg = false;
  let segStart = 0;
  for (let i = 0; i < n; i++) {
    const on = rms[i] >= thresh;
    if (on && !inSeg) {
      inSeg = true;
      segStart = i;
    } else if (!on && inSeg) {
      inSeg = false;
      raw.push({ start: segStart * hopSec, end: i * hopSec });
    }
  }
  if (inSeg) raw.push({ start: segStart * hopSec, end: n * hopSec });

  // Merge gaps < 0.6s (instrumental holes inside a verse)
  /** @type {{ start: number, end: number, weight: number }[]} */
  const merged = [];
  for (const seg of raw) {
    if (seg.end - seg.start < 0.2) continue; // drop clicks
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < 0.6) {
      last.end = seg.end;
      last.weight = last.end - last.start;
    } else {
      merged.push({
        start: seg.start,
        end: seg.end,
        weight: seg.end - seg.start,
      });
    }
  }

  // Drop tiny residual segments
  return merged.filter((s) => s.weight >= 0.35);
}

/**
 * Allocate words to segments by duration weight; space evenly inside each.
 * @param {string[]} words
 * @param {{ start: number, end: number, weight: number }[]} segments
 */
function placeAcrossSegments(words, segments) {
  const totalW = segments.reduce((a, s) => a + s.weight, 0) || 1;
  /** @type {TimedWord[]} */
  const out = [];
  let cursor = 0;
  let remaining = words.length;

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const isLast = si === segments.length - 1;
    let count = isLast
      ? remaining
      : Math.max(1, Math.round((words.length * seg.weight) / totalW));
    if (count > remaining) count = remaining;
    // Don't leave last segments empty of words if many remain
    if (!isLast && remaining - count < segments.length - si - 1) {
      count = Math.max(1, remaining - (segments.length - si - 1));
    }
    const slice = words.slice(cursor, cursor + count);
    cursor += count;
    remaining -= count;
    if (!slice.length) continue;

    const pad = Math.min(0.08, seg.weight * 0.05);
    const start = seg.start + pad;
    const end = Math.max(start + slice.length * 0.12, seg.end - pad);
    out.push(...placeEvenly(slice, start, end));
  }

  // Any leftover words (rounding) → append to last segment
  if (cursor < words.length && segments.length) {
    const last = segments[segments.length - 1];
    const rest = words.slice(cursor);
    const t0 = out.length ? out[out.length - 1].end : last.start;
    out.push(...placeEvenly(rest, t0, Math.max(t0 + rest.length * 0.25, last.end)));
  }

  return seal(out);
}

function placeEvenly(words, start, end) {
  const n = words.length;
  if (!n) return [];
  const span = Math.max(n * 0.12, end - start);
  const slot = span / n;
  return words.map((text, i) => {
    const s = start + i * slot;
    return { text, start: s, end: s + Math.max(0.08, slot * 0.88) };
  });
}

function seal(words) {
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && out[i].start < out[i - 1].end) {
      out[i].start = out[i - 1].end;
    }
    if (out[i].end <= out[i].start) {
      out[i].end = out[i].start + 0.1;
    }
    if (i < out.length - 1 && out[i].end > out[i + 1].start) {
      out[i].end = Math.max(out[i].start + 0.05, out[i + 1].start);
    }
  }
  return out;
}

function yieldToUi() {
  return new Promise((r) => setTimeout(r, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
