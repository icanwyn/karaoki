/**
 * Decode audio to mono 16 kHz Float32Array (best for Whisper)
 * and estimate when sound / vocals actually start.
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
 * Find first time (seconds) where RMS energy rises above a fraction of the peak.
 * Used to shift Whisper timestamps when the model ignores instrumental intros.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {{ thresholdRatio?: number, minHoldSec?: number }} [opts]
 * @returns {number}
 */
export function findEnergyOnset(samples, sampleRate, opts = {}) {
  const thresholdRatio = opts.thresholdRatio ?? 0.12;
  const minHoldSec = opts.minHoldSec ?? 0.12;
  const win = Math.max(1, Math.floor(sampleRate * 0.04)); // 40ms
  const holdWins = Math.max(1, Math.ceil(minHoldSec / 0.04));

  let peak = 0;
  const rms = [];
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    const r = Math.sqrt(s / (end - i || 1));
    rms.push(r);
    if (r > peak) peak = r;
  }
  if (peak < 1e-6) return 0;

  const thresh = peak * thresholdRatio;
  let run = 0;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thresh) {
      run += 1;
      if (run >= holdWins) {
        return Math.max(0, ((i - holdWins + 1) * win) / sampleRate);
      }
    } else {
      run = 0;
    }
  }
  return 0;
}

/**
 * Shift word timings so the first word lines up with audio energy onset
 * (when Whisper stamped the first lyric too early/late vs the real track).
 *
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {number} onsetSec
 * @returns {{ words: typeof words, appliedShiftSec: number }}
 */
export function alignWordsToOnset(words, onsetSec) {
  if (!words?.length || !Number.isFinite(onsetSec)) {
    return { words: words || [], appliedShiftSec: 0 };
  }

  const first = words[0].start;
  // Whisper often puts first word near 0 while the vocal starts later (intro).
  // Or vice versa after chunking quirks.
  const shift = onsetSec - first;

  // Only auto-correct meaningful drift (>150ms), cap wild shifts at 45s
  if (Math.abs(shift) < 0.15 || Math.abs(shift) > 45) {
    return { words, appliedShiftSec: 0 };
  }

  // Prefer shifting when first word is early relative to energy (intro case)
  // or moderately late (chunk offset). Always apply within cap.
  const shifted = words.map((w) => ({
    ...w,
    start: Math.max(0, w.start + shift),
    end: Math.max(0.05, w.end + shift),
  }));

  return { words: shifted, appliedShiftSec: shift };
}

/**
 * If Whisper compressed timings into a shorter span than the audible region,
 * optionally leave as-is (stretching lyrics across instrumentals is worse).
 * This only clamps ends that overflow the file duration.
 *
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {number} durationSec
 */
export function clampWordsToDuration(words, durationSec) {
  if (!words?.length || !durationSec) return words || [];
  const maxT = Math.max(0.5, durationSec - 0.02);
  return words.map((w) => ({
    ...w,
    start: Math.min(w.start, maxT),
    end: Math.min(Math.max(w.end, w.start + 0.05), durationSec),
  }));
}
