/**
 * SRT / VTT parse & export for karaoke timing.
 * Words are timed with character/syllable weights so they don't tick like a metronome.
 */

/**
 * @typedef {{ text: string, start: number, end: number, line?: number }} TimedWord
 * @typedef {{ index: number, start: number, end: number, text: string }} SrtCue
 */

/**
 * Parse SRT or WebVTT into cues.
 * @param {string} raw
 * @returns {SrtCue[]}
 */
export function parseSrt(raw) {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return [];

  let body = text;
  if (/^WEBVTT/i.test(body)) {
    body = body.replace(/^WEBVTT[^\n]*\n+/, "");
  }

  const blocks = body.split(/\n\s*\n/);
  /** @type {SrtCue[]} */
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    if (i >= lines.length) continue;

    const timeLine = lines[i];
    const m = timeLine.match(
      /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/
    );
    if (!m) continue;

    const parts = timeLine.split(/\s*-->\s*/);
    const start = parseTimestamp(parts[0]);
    const end = parseTimestamp(parts[1].split(/\s+/)[0]);
    const cueText = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]+\}/g, "")
      .trim();
    if (!cueText || !Number.isFinite(start)) continue;
    cues.push({
      index: cues.length + 1,
      start,
      end: Number.isFinite(end) && end > start ? end : start + 1.5,
      text: cueText,
    });
  }

  return cues;
}

/**
 * Relative weight for how long a word "should" take when singing.
 * Longer / multi-syllable words hold longer; tiny words are quick.
 */
export function wordWeight(token) {
  const raw = String(token || "");
  const clean = raw.replace(/[^a-zA-Z0-9']/g, "");
  if (!clean) return 0.5;
  // syllable-ish: vowel groups
  const syllables = Math.max(1, (clean.toLowerCase().match(/[aeiouy]+/g) || []).length);
  const letters = clean.length;
  let w = letters * 0.55 + syllables * 0.9;
  // trailing punctuation / commas → hold slightly before next
  if (/[,;:—–-]$/.test(raw)) w += 0.45;
  if (/[.!?…]$/.test(raw)) w += 0.35;
  // very short function words
  if (letters <= 2) w *= 0.72;
  return Math.max(0.35, w);
}

/**
 * Split cue text into tokens keeping punctuation on words.
 * @param {string} text
 */
export function tokenizeCue(text) {
  return String(text || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Place words inside [start, end] using relative weights (musical phrasing, not clock ticks).
 * @param {string[]} tokens
 * @param {number} start
 * @param {number} end
 * @param {number} [line]
 * @returns {TimedWord[]}
 */
export function placeWeightedWords(tokens, start, end, line) {
  if (!tokens.length) return [];
  const weights = tokens.map(wordWeight);
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;

  // Leave a tiny breathe at cue edges so first/last words don't slam on/off
  const span = Math.max(0.08 * tokens.length, end - start);
  const pad = Math.min(0.06, span * 0.04);
  const usable = Math.max(0.05, span - pad * 2);
  let cursor = start + pad;

  /** @type {TimedWord[]} */
  const words = [];
  tokens.forEach((tok, k) => {
    const share = (weights[k] / totalW) * usable;
    // ~12% of each word slot is a soft gap into the next (feels less robotic)
    const gap = k < tokens.length - 1 ? Math.min(0.05, share * 0.12) : 0;
    const hold = Math.max(0.05, share - gap);
    const text = tok.replace(/^["“(]+|["”)]+$/g, "") || tok;
    words.push({
      text,
      start: cursor,
      end: cursor + hold,
      line: line ?? 0,
    });
    cursor += share;
  });

  // Snap last end to cue end - pad
  if (words.length) {
    words[words.length - 1].end = Math.max(
      words[words.length - 1].start + 0.05,
      end - pad
    );
  }
  return words;
}

/**
 * Convert SRT/VTT → word-level timings with weighted (not equal) in-cue spacing.
 * @param {string} raw
 * @returns {TimedWord[]}
 */
export function srtToWords(raw) {
  const cues = parseSrt(raw);
  /** @type {TimedWord[]} */
  const words = [];
  for (let ci = 0; ci < cues.length; ci++) {
    const cue = cues[ci];
    const tokens = tokenizeCue(cue.text);
    if (!tokens.length) continue;
    words.push(...placeWeightedWords(tokens, cue.start, cue.end, ci));
  }
  return sealWords(words);
}

/**
 * After loading SRT, refine word boundaries inside each cue using audio energy
 * so highlights follow the "flow" of the music, not equal clock ticks.
 *
 * @param {TimedWord[]} words - from srtToWords (must have .line)
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {TimedWord[]}
 */
export function refineWordsWithEnergy(words, samples, sampleRate) {
  if (!words?.length || !samples?.length) return words || [];

  // Group by line/cue
  /** @type {Map<number, TimedWord[]>} */
  const byLine = new Map();
  for (const w of words) {
    const line = w.line ?? 0;
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push({ ...w });
  }

  /** @type {TimedWord[]} */
  const out = [];
  for (const [, group] of byLine) {
    if (!group.length) continue;
    const cueStart = group[0].start;
    const cueEnd = group[group.length - 1].end;
    const refined = redistributeByEnergy(group, cueStart, cueEnd, samples, sampleRate);
    out.push(...refined);
  }
  return sealWords(out);
}

/**
 * @param {TimedWord[]} group
 * @param {number} cueStart
 * @param {number} cueEnd
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
function redistributeByEnergy(group, cueStart, cueEnd, samples, sampleRate) {
  const n = group.length;
  if (n <= 1) return group;

  const i0 = Math.max(0, Math.floor(cueStart * sampleRate));
  const i1 = Math.min(samples.length, Math.ceil(cueEnd * sampleRate));
  if (i1 - i0 < n * 8) {
    // too little audio — keep weighted placement
    return placeWeightedWords(
      group.map((g) => g.text),
      cueStart,
      cueEnd,
      group[0].line
    );
  }

  // RMS envelope inside cue
  const hop = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms
  const frames = [];
  let peak = 0;
  for (let i = i0; i < i1; i += hop) {
    const end = Math.min(i1, i + hop);
    let s = 0;
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    const r = Math.sqrt(s / (end - i || 1));
    frames.push(r);
    if (r > peak) peak = r;
  }
  if (peak < 1e-8) {
    return placeWeightedWords(
      group.map((g) => g.text),
      cueStart,
      cueEnd,
      group[0].line
    );
  }

  // Boost above noise so quiet gaps don't steal time; blend with character weights
  const floor = peak * 0.08;
  const energy = frames.map((r) => Math.max(0, r - floor) + peak * 0.02);
  const totalE = energy.reduce((a, b) => a + b, 0) || 1;

  // Cumulative energy 0..1 across cue
  const cum = new Array(energy.length);
  let run = 0;
  for (let i = 0; i < energy.length; i++) {
    run += energy[i];
    cum[i] = run / totalE;
  }

  // Each word targets a share of cumulative energy proportional to weight
  const weights = group.map((g) => wordWeight(g.text));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const targets = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += weights[k] / totalW;
    targets.push(acc);
  }

  // Map target cumulative energy → time
  const times = [cueStart];
  for (let k = 0; k < n - 1; k++) {
    const t = targets[k];
    let fi = 0;
    while (fi < cum.length && cum[fi] < t) fi += 1;
    const frac = fi / Math.max(1, cum.length);
    const time = cueStart + frac * (cueEnd - cueStart);
    times.push(Math.max(times[times.length - 1] + 0.04, time));
  }
  times.push(cueEnd);

  return group.map((g, k) => ({
    text: g.text,
    start: times[k],
    end: Math.max(times[k] + 0.05, times[k + 1] - 0.01),
    line: g.line,
  }));
}

function sealWords(words) {
  const out = (words || [])
    .map((w) => ({ ...w }))
    .filter((w) => w.text)
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && out[i].start < out[i - 1].end) {
      out[i].start = out[i - 1].end;
    }
    if (out[i].end <= out[i].start) {
      out[i].end = out[i].start + 0.08;
    }
    if (i < out.length - 1 && out[i].end > out[i + 1].start) {
      out[i].end = Math.max(out[i].start + 0.04, out[i + 1].start);
    }
  }
  return out;
}

/**
 * @param {TimedWord[]} words
 * @returns {string}
 */
export function wordsToSrt(words) {
  if (!words?.length) return "";

  // Prefer original SRT lines via .line
  /** @type {Map<number, TimedWord[]>} */
  const byLine = new Map();
  let useLines = words.some((w) => w.line != null);
  if (useLines) {
    for (const w of words) {
      const L = w.line ?? 0;
      if (!byLine.has(L)) byLine.set(L, []);
      byLine.get(L).push(w);
    }
  }

  /** @type {{ start: number, end: number, text: string }[]} */
  const cues = [];
  if (useLines && byLine.size) {
    for (const [, group] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      if (!group.length) continue;
      cues.push({
        start: group[0].start,
        end: group[group.length - 1].end,
        text: group.map((g) => g.text).join(" "),
      });
    }
  } else {
    let buf = [];
    let cueStart = words[0].start;
    const flush = (end) => {
      if (!buf.length) return;
      cues.push({
        start: cueStart,
        end: Math.max(end, cueStart + 0.3),
        text: buf.join(" "),
      });
      buf = [];
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!buf.length) cueStart = w.start;
      buf.push(w.text);
      const gap =
        i + 1 < words.length ? words[i + 1].start - w.end : Number.POSITIVE_INFINITY;
      if (buf.length >= 8 || gap > 0.55 || i === words.length - 1) flush(w.end);
    }
  }

  let out = "";
  cues.forEach((c, idx) => {
    out += `${idx + 1}\n`;
    out += `${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n`;
    out += `${c.text}\n\n`;
  });
  return out.trim() + "\n";
}

/**
 * @param {string} text
 */
export function looksLikeSrt(text) {
  const t = String(text || "");
  return (
    /-->/.test(t) &&
    (/\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/.test(t) ||
      /\d{1,2}:\d{2}[.,]\d{1,3}/.test(t) ||
      /^WEBVTT/im.test(t))
  );
}

/**
 * @param {string} ts
 * @returns {number}
 */
export function parseTimestamp(ts) {
  const s = String(ts || "")
    .trim()
    .replace(",", ".");
  const parts = s.split(":");
  if (parts.length === 3) {
    return (
      (Number(parts[0]) || 0) * 3600 +
      (Number(parts[1]) || 0) * 60 +
      (Number(parts[2]) || 0)
    );
  }
  if (parts.length === 2) {
    return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
  }
  return Number(s) || 0;
}

/**
 * @param {number} sec
 */
export function formatSrtTime(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}
