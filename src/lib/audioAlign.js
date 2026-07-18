/**
 * Decode audio and estimate vocal/active regions for lyric timing.
 */

/**
 * @param {File|Blob} file
 * @returns {Promise<{ samples: Float32Array, sampleRate: number, duration: number }>}
 */
export async function decodeMono16k(file) {
  const ab = await file.arrayBuffer();
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

  const mono = mixToMono(decoded);
  const targetRate = 16000;
  const samples =
    decoded.sampleRate === targetRate
      ? mono
      : resampleLinear(mono, decoded.sampleRate, targetRate);

  return {
    samples,
    sampleRate: targetRate,
    duration: samples.length / targetRate,
  };
}

function mixToMono(buffer) {
  const n = buffer.length;
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }
  const out = new Float32Array(n);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i] / ch;
  }
  return out;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/**
 * RMS envelope (one value per hop).
 * @returns {{ rms: Float32Array, hopSec: number, peak: number }}
 */
function rmsEnvelope(samples, sampleRate, hopSec = 0.05) {
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
  return { rms, hopSec: hop / sampleRate, peak };
}

/**
 * First sustained energy rise (music/vocals start). For songs this is often
 * the first beat — do NOT use alone to force-shift Whisper word times.
 */
export function findEnergyOnset(samples, sampleRate, opts = {}) {
  const thresholdRatio = opts.thresholdRatio ?? 0.12;
  const minHoldSec = opts.minHoldSec ?? 0.12;
  const { rms, hopSec, peak } = rmsEnvelope(samples, sampleRate);
  if (peak < 1e-6) return 0;
  const thresh = peak * thresholdRatio;
  const hold = Math.max(1, Math.ceil(minHoldSec / hopSec));
  let run = 0;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thresh) {
      run += 1;
      if (run >= hold) return Math.max(0, (i - hold + 1) * hopSec);
    } else run = 0;
  }
  return 0;
}

/**
 * Estimate a "singing window" [start, end] using energy above a soft floor,
 * ignoring a short head/tail silence. Used when we only have plain text.
 */
export function findActiveWindow(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const { rms, hopSec, peak } = rmsEnvelope(samples, sampleRate, 0.08);
  if (peak < 1e-6) return { start: 0, end: duration };

  const thresh = peak * 0.08;
  let first = -1;
  let last = -1;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thresh) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { start: 0, end: duration };

  // Trim a little padding; keep at least 40% of the track for lyrics
  let start = Math.max(0, first * hopSec - 0.15);
  let end = Math.min(duration, (last + 1) * hopSec + 0.25);
  if (end - start < duration * 0.4) {
    start = Math.min(start, duration * 0.05);
    end = Math.max(end, duration * 0.95);
  }
  return { start, end };
}

/**
 * ONLY shift when Whisper put the first word *before* real energy (rare),
 * by a small amount. Never pull late (correct) lyrics back to the first drum hit —
 * that was destroying auto-sync on normal songs with intros.
 *
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {number} onsetSec
 */
export function alignWordsToOnset(words, onsetSec) {
  if (!words?.length || !Number.isFinite(onsetSec)) {
    return { words: words || [], appliedShiftSec: 0 };
  }

  const first = words[0].start;
  // Only correct the "lyrics stamped during silence before music" case:
  // first word is early, energy starts later → positive shift only.
  if (first >= onsetSec - 0.2) {
    return { words, appliedShiftSec: 0 };
  }

  const shift = onsetSec - first;
  // Cap: intros can be long, but >20s of pure silence stamp is unlikely
  if (shift < 0.2 || shift > 20) {
    return { words, appliedShiftSec: 0 };
  }

  const shifted = words.map((w) => ({
    ...w,
    start: Math.max(0, w.start + shift),
    end: Math.max(0.05, w.end + shift),
  }));
  return { words: shifted, appliedShiftSec: shift };
}

/**
 * Spread plain words evenly across an active window (fallback sync).
 * @param {string[]} texts
 * @param {number} startSec
 * @param {number} endSec
 */
export function estimateTimingsInWindow(texts, startSec, endSec) {
  const words = (texts || []).map((t) => String(t).trim()).filter(Boolean);
  if (!words.length) return [];
  const start = Math.max(0, Number(startSec) || 0);
  const end = Math.max(start + words.length * 0.15, Number(endSec) || start + words.length * 0.35);
  const span = end - start;
  const slot = span / words.length;
  return words.map((text, i) => {
    const s = start + i * slot;
    return { text, start: s, end: s + Math.max(0.08, slot * 0.92) };
  });
}

export function clampWordsToDuration(words, durationSec) {
  if (!words?.length || !durationSec) return words || [];
  const maxT = Math.max(0.5, durationSec - 0.02);
  return words.map((w) => ({
    ...w,
    start: Math.min(Math.max(0, w.start), maxT),
    end: Math.min(Math.max(w.end, w.start + 0.05), durationSec),
  }));
}

/**
 * True if timings look usable (span a meaningful portion of the track).
 */
export function timingsLookValid(words, durationSec) {
  if (!words?.length) return false;
  const starts = words.map((w) => w.start).filter((s) => Number.isFinite(s));
  if (!starts.length) return false;
  const min = Math.min(...starts);
  const max = Math.max(...words.map((w) => w.end || w.start));
  const span = max - min;
  // All piled at 0, or tiny span vs long song → bad
  if (span < 0.5 && words.length > 4) return false;
  if (durationSec > 20 && span < durationSec * 0.15 && words.length > 8) return false;
  // All timestamps identical
  const uniq = new Set(starts.map((s) => s.toFixed(2)));
  if (uniq.size === 1 && words.length > 3) return false;
  return true;
}
