/**
 * Decode audio and snap lyric timings so highlights don't fire during silence/intros.
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
 * @returns {{ rms: Float32Array, hopSec: number, peak: number, hop: number }}
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
  return { rms, hopSec: hop / sampleRate, peak, hop };
}

/**
 * First sustained energy rise above a relative threshold.
 */
export function findEnergyOnset(samples, sampleRate, opts = {}) {
  const thresholdRatio = opts.thresholdRatio ?? 0.18;
  const minHoldSec = opts.minHoldSec ?? 0.2;
  const { rms, hopSec, peak } = rmsEnvelope(samples, sampleRate);
  if (peak < 1e-6) return 0;
  const thresh = Math.max(peak * thresholdRatio, 0.008);
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
 * End of leading silence / very quiet intro (seconds).
 * Uses noise floor + peak so quiet intros stay "silent" for highlighting.
 */
export function findLeadingSilenceEnd(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const { rms, hopSec, peak } = rmsEnvelope(samples, sampleRate, 0.04);
  if (peak < 1e-6) return 0;

  // Noise floor ≈ 15th percentile of RMS
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] || 0;

  // Must beat floor and be a real fraction of the track peak
  const thresh = Math.max(floor * 5, peak * 0.18, 0.012);
  const hold = Math.max(1, Math.ceil(0.25 / hopSec)); // 250ms sustained

  let run = 0;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thresh) {
      run += 1;
      if (run >= hold) {
        const t = Math.max(0, (i - hold + 1) * hopSec);
        // Don't claim the whole track is silence
        return Math.min(t, duration * 0.45);
      }
    } else {
      run = 0;
    }
  }
  return 0;
}

/**
 * Singing/music window for plain-text timing estimates.
 * Starts after real content, not at the first noise spike.
 */
export function findActiveWindow(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const silenceEnd = findLeadingSilenceEnd(samples, sampleRate);
  const { rms, hopSec, peak } = rmsEnvelope(samples, sampleRate, 0.08);
  if (peak < 1e-6) return { start: silenceEnd, end: duration };

  const thresh = Math.max(peak * 0.14, 0.01);
  let last = -1;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thresh) last = i;
  }
  let end = last >= 0 ? Math.min(duration, (last + 1) * hopSec + 0.3) : duration;

  // Lead-in after silence; leave a small pad so first word isn't on the attack
  let start = Math.min(silenceEnd + 0.05, duration * 0.4);
  if (end - start < duration * 0.35) {
    end = Math.max(end, Math.min(duration, start + duration * 0.5));
  }
  return { start, end };
}

/**
 * Main post-process: drop silence hallucinations, delay early stamps,
 * cap word lengths so one word doesn't stay lit forever.
 *
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
export function snapTimingsToAudio(words, samples, sampleRate) {
  if (!words?.length) {
    return { words: [], appliedShiftSec: 0, note: "", dropped: 0 };
  }
  if (!samples?.length) {
    return {
      words: capWordDurations(normalizeOrder(words)),
      appliedShiftSec: 0,
      note: "",
      dropped: 0,
    };
  }

  const duration = samples.length / sampleRate;
  const silenceEnd = findLeadingSilenceEnd(samples, sampleRate);
  let list = normalizeOrder(words);
  let dropped = 0;
  let noteParts = [];

  // 1) Drop words whose center falls in leading silence (Whisper hallucinations)
  if (silenceEnd > 0.35) {
    const kept = list.filter((w) => {
      const mid = (w.start + w.end) / 2;
      return mid >= silenceEnd - 0.2;
    });
    // Keep result if we didn't throw away almost everything
    if (kept.length >= Math.max(3, Math.floor(list.length * 0.4))) {
      dropped = list.length - kept.length;
      list = kept;
      if (dropped) {
        noteParts.push(`Dropped ${dropped} early hallucinated word(s) in silence.`);
      }
    }
  }

  // 2) Shift forward if first lyric is still before content starts
  let appliedShiftSec = 0;
  const contentStart = Math.max(silenceEnd, findEnergyOnset(samples, sampleRate, {
    thresholdRatio: 0.16,
    minHoldSec: 0.22,
  }));

  if (list.length && list[0].start < contentStart - 0.12) {
    appliedShiftSec = contentStart - list[0].start;
    // Cap extreme shifts (very long intros still get shifted up to 45s)
    if (appliedShiftSec > 0.12 && appliedShiftSec < 45) {
      list = list.map((w) => ({
        ...w,
        start: w.start + appliedShiftSec,
        end: w.end + appliedShiftSec,
      }));
      noteParts.push(
        `Delayed lyrics by ${appliedShiftSec.toFixed(2)}s to skip silence/intro.`
      );
    } else {
      appliedShiftSec = 0;
    }
  }

  // 3) If everything is still crushed into the first few seconds of a long track,
  //    rebuild spacing across the active window (keeps word order/text).
  const span =
    list.length > 1
      ? list[list.length - 1].end - list[0].start
      : list[0]?.end - list[0]?.start || 0;

  if (duration > 25 && list.length > 8 && span < Math.min(8, duration * 0.12)) {
    const win = findActiveWindow(samples, sampleRate);
    const texts = list.map((w) => w.text);
    list = estimateTimingsInWindow(texts, win.start, win.end);
    appliedShiftSec = 0;
    noteParts.push("Retimed words across the audible section (model span was too short).");
  }

  list = clampWordsToDuration(capWordDurations(list), duration);

  // 4) Guarantee: nothing lights up before measured content start
  if (list.length && list[0].start < contentStart) {
    const pad = contentStart - list[0].start;
    list = list.map((w) => ({
      ...w,
      start: w.start + pad,
      end: w.end + pad,
    }));
    appliedShiftSec += pad;
  }

  return {
    words: list,
    appliedShiftSec,
    note: noteParts.join(" "),
    dropped,
    silenceEnd,
    contentStart,
  };
}

/** Cap per-word duration; end at next word start. */
export function capWordDurations(words, maxDur = 0.9) {
  if (!words?.length) return [];
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const nextStart =
      i + 1 < out.length ? out[i + 1].start : out[i].start + maxDur;
    const cap = Math.min(out[i].start + maxDur, nextStart);
    out[i].end = Math.max(out[i].start + 0.06, Math.min(out[i].end, cap));
  }
  return out;
}

function normalizeOrder(words) {
  return (words || [])
    .map((w) => ({
      text: String(w.text || "").trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }))
    .filter((w) => w.text)
    .sort((a, b) => a.start - b.start);
}

/**
 * Legacy helper — prefer snapTimingsToAudio.
 */
export function alignWordsToOnset(words, onsetSec) {
  if (!words?.length || !Number.isFinite(onsetSec)) {
    return { words: words || [], appliedShiftSec: 0 };
  }
  const first = words[0].start;
  if (first >= onsetSec - 0.12) return { words, appliedShiftSec: 0 };
  const shift = onsetSec - first;
  if (shift < 0.12 || shift > 45) return { words, appliedShiftSec: 0 };
  return {
    words: words.map((w) => ({
      ...w,
      start: Math.max(0, w.start + shift),
      end: Math.max(0.05, w.end + shift),
    })),
    appliedShiftSec: shift,
  };
}

/**
 * Spread plain words evenly across an active window.
 */
export function estimateTimingsInWindow(texts, startSec, endSec) {
  const words = (texts || []).map((t) => String(t).trim()).filter(Boolean);
  if (!words.length) return [];
  const start = Math.max(0, Number(startSec) || 0);
  const end = Math.max(
    start + words.length * 0.18,
    Number(endSec) || start + words.length * 0.35
  );
  const span = end - start;
  const slot = span / words.length;
  return words.map((text, i) => {
    const s = start + i * slot;
    return { text, start: s, end: s + Math.max(0.08, slot * 0.88) };
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
  if (span < 0.5 && words.length > 4) return false;
  if (durationSec > 20 && span < durationSec * 0.12 && words.length > 8) return false;
  const uniq = new Set(starts.map((s) => s.toFixed(2)));
  if (uniq.size === 1 && words.length > 3) return false;
  // All starting in first 0.3s of a long song → suspicious
  if (durationSec > 20 && min < 0.3 && span < 3 && words.length > 6) return false;
  return true;
}
