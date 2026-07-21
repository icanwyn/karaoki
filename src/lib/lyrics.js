/**
 * Tokenize raw lyrics into lines of words (punctuation kept on words).
 * @param {string} text
 * @returns {string[][]}
 */
export function tokenizeLines(text) {
  if (!text || !String(text).trim()) return [];
  return String(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/).filter(Boolean));
}

/**
 * Flatten lines into a single word list.
 * @param {string} text
 * @returns {string[]}
 */
export function flattenWords(text) {
  return tokenizeLines(text).flat();
}

/**
 * Parse LRC / enhanced LRC into timed words.
 * Supports:
 *  [mm:ss.xx] line lyrics
 *  [mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word
 * @param {string} text
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function parseLrc(text) {
  if (!text || !String(text).trim()) return [];

  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const wordTagRe = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;

  /** @type {{ text: string, start: number, end: number }[]} */
  const timed = [];
  /** @type {{ start: number, content: string }[]} */
  const rawLines = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("[ti:") || line.startsWith("[ar:") || line.startsWith("[al:") || line.startsWith("[by:") || line.startsWith("[offset:")) {
      continue;
    }

    const stamps = [];
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line)) !== null) {
      stamps.push({ index: m.index, len: m[0].length, time: toSeconds(m[1], m[2], m[3]) });
    }
    if (!stamps.length) continue;

    const contentStart = stamps[stamps.length - 1].index + stamps[stamps.length - 1].len;
    const content = line.slice(contentStart).trim();
    for (const s of stamps) {
      rawLines.push({ start: s.time, content });
    }
  }

  rawLines.sort((a, b) => a.start - b.start);

  for (let i = 0; i < rawLines.length; i++) {
    const { start, content } = rawLines[i];
    const nextStart = i + 1 < rawLines.length ? rawLines[i + 1].start : start + 4;
    const lineEnd = Math.max(start + 0.15, nextStart);

    // Enhanced LRC word tags
    wordTagRe.lastIndex = 0;
    const wordParts = [];
    let last = 0;
    let wm;
    const hasWordTags = wordTagRe.test(content);
    wordTagRe.lastIndex = 0;

    if (hasWordTags) {
      while ((wm = wordTagRe.exec(content)) !== null) {
        if (wm.index > last) {
          const between = content.slice(last, wm.index).trim();
          if (between) {
            const prev = wordParts[wordParts.length - 1];
            if (prev) prev.text = (prev.text + " " + between).trim();
          }
        }
        const t = toSeconds(wm[1], wm[2], wm[3]);
        wordParts.push({ text: "", start: t });
        last = wm.index + wm[0].length;
        // capture following text until next tag
        const next = content.slice(last);
        const nextTag = next.search(/</);
        const chunk = (nextTag === -1 ? next : next.slice(0, nextTag)).trim();
        if (chunk) {
          wordParts[wordParts.length - 1].text = chunk;
          last += nextTag === -1 ? next.length : nextTag;
        }
      }
      const remaining = content.slice(last).trim();
      if (remaining && wordParts.length) {
        wordParts[wordParts.length - 1].text =
          (wordParts[wordParts.length - 1].text + " " + remaining).trim();
      }

      for (let j = 0; j < wordParts.length; j++) {
        const w = wordParts[j];
        if (!w.text) continue;
        const end =
          j + 1 < wordParts.length
            ? wordParts[j + 1].start
            : lineEnd;
        const tokens = w.text.split(/\s+/).filter(Boolean);
        if (tokens.length === 1) {
          timed.push({ text: tokens[0], start: w.start, end: Math.max(w.start + 0.05, end) });
        } else {
          const span = Math.max(0.05, end - w.start);
          const step = span / tokens.length;
          tokens.forEach((tok, k) => {
            timed.push({
              text: tok,
              start: w.start + k * step,
              end: w.start + (k + 1) * step,
            });
          });
        }
      }
    } else {
      const tokens = content.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const span = Math.max(0.1, lineEnd - start);
      const step = span / tokens.length;
      tokens.forEach((tok, k) => {
        timed.push({
          text: tok,
          start: start + k * step,
          end: start + (k + 1) * step,
        });
      });
    }
  }

  // Normalize ends so they don't overlap badly
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i].end > timed[i + 1].start) {
      timed[i].end = timed[i + 1].start;
    }
    if (timed[i].end <= timed[i].start) {
      timed[i].end = timed[i].start + 0.05;
    }
  }

  return timed;
}

function toSeconds(mm, ss, frac) {
  const minutes = Number(mm) || 0;
  const seconds = Number(ss) || 0;
  let fraction = 0;
  if (frac != null && frac !== "") {
    const f = String(frac);
    // 2 digits → centiseconds, 3 → milliseconds
    fraction = f.length <= 2 ? Number(f) / 100 : Number(f) / 1000;
  }
  return minutes * 60 + seconds + fraction;
}

/**
 * Assign even timings across duration with small gaps.
 * @param {string[]|string} wordsOrText
 * @param {number} durationSec
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function estimateTimings(wordsOrText, durationSec) {
  const words = Array.isArray(wordsOrText)
    ? wordsOrText.map((w) => (typeof w === "string" ? w : w.text)).filter(Boolean)
    : flattenWords(wordsOrText);

  if (!words.length) return [];
  const duration = Math.max(Number(durationSec) || 0, words.length * 0.2);
  const leadIn = Math.min(0.4, duration * 0.02);
  const usable = Math.max(0.1, duration - leadIn - 0.2);
  const gap = Math.min(0.04, usable / words.length / 8);
  const slot = usable / words.length;

  return words.map((text, i) => {
    const start = leadIn + i * slot;
    const end = start + Math.max(0.08, slot - gap);
    return { text, start, end };
  });
}

/** Starts at or above this are treated as "not yet timed" (manual sync sentinels). */
const UNTAPPED_THRESHOLD = 1e8;

/**
 * Active word index for time t. Returns -1 if none.
 * Ignores untapped sentinel timings so the stage never races through future words.
 * @param {{ start: number, end: number }[]} words
 * @param {number} t
 * @returns {number}
 */
export function indexForTime(words, t) {
  if (!words?.length || t == null || Number.isNaN(t)) return -1;

  // Hard gate: nothing is active before the first timed word
  const firstStart = words[0]?.start;
  if (
    Number.isFinite(firstStart) &&
    firstStart < UNTAPPED_THRESHOLD &&
    t < firstStart - 0.02
  ) {
    return -1;
  }

  // Binary search by start among timed words only
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = words[mid].start;
    if (s >= UNTAPPED_THRESHOLD) {
      hi = mid - 1;
      continue;
    }
    if (s <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return -1;
  if (words[ans].start >= UNTAPPED_THRESHOLD) return -1;

  // Only light up while inside [start, end); do NOT keep the first word
  // glowing through long intros / gaps (that looked like "early highlight").
  const w = words[ans];
  const end = Number.isFinite(w.end) ? w.end : w.start + 0.4;
  if (t >= w.start - 0.02 && t < end + 0.04) return ans;

  // Short gap until next word: keep previous briefly
  if (ans + 1 < words.length) {
    const nextStart = words[ans + 1].start;
    if (
      nextStart < UNTAPPED_THRESHOLD &&
      t < nextStart &&
      nextStart - end < 0.35
    ) {
      return ans;
    }
  }

  // Past last word end — stay on last only for a short tail
  if (ans === words.length - 1 && t < end + 0.5) return ans;
  return -1;
}

/**
 * Group timed words into display lines (by original line breaks when available,
 * otherwise wrap every ~8 words).
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {string} [rawLyrics]
 * @returns {{ words: typeof words, startIndex: number }[]}
 */
export function groupIntoLines(words, rawLyrics) {
  if (!words?.length) return [];

  // Prefer SRT cue lines (word.line) — matches musical phrases, not fixed width
  if (words.some((w) => w.line != null)) {
    /** @type {Map<number, { words: typeof words, startIndex: number }>} */
    const map = new Map();
    words.forEach((w, i) => {
      const L = w.line ?? 0;
      if (!map.has(L)) map.set(L, { words: [], startIndex: i });
      map.get(L).words.push(w);
    });
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, g]) => g);
  }

  if (rawLyrics) {
    const lines = tokenizeLines(rawLyrics);
    if (lines.length) {
      const groups = [];
      let idx = 0;
      for (const line of lines) {
        if (!line.length) continue;
        const slice = words.slice(idx, idx + line.length);
        if (!slice.length) break;
        groups.push({ words: slice, startIndex: idx });
        idx += line.length;
      }
      if (idx < words.length) {
        groups.push({ words: words.slice(idx), startIndex: idx });
      }
      return groups;
    }
  }

  const perLine = 8;
  const groups = [];
  for (let i = 0; i < words.length; i += perLine) {
    groups.push({ words: words.slice(i, i + perLine), startIndex: i });
  }
  return groups;
}

/**
 * Find which line group contains the active word index.
 * @param {{ startIndex: number, words: unknown[] }[]} lines
 * @param {number} activeIndex
 */
export function lineIndexForWord(lines, activeIndex) {
  // No active word (intro / long gap) → no line — never fall back to line 0
  if (!lines?.length || activeIndex == null || activeIndex < 0) return -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (activeIndex >= lines[i].startIndex) return i;
  }
  return -1;
}
