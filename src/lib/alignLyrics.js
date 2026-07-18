/**
 * Align *known* lyrics to ASR word timestamps (forced-alignment style).
 *
 * ElevenLabs karaoke works because TTS *emits* timestamps with the audio.
 * Songs need the opposite: map your words onto times heard in the recording.
 *
 * Approach:
 * 1. Normalize tokens (lowercase, strip punctuation)
 * 2. Needleman–Wunsch global alignment of reference ↔ ASR sequences
 * 3. Transfer start/end from matched ASR words; interpolate gaps
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeLyricWords(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * @param {string} w
 */
export function normalizeToken(w) {
  return String(w || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/^'+|'+$/g, "");
}

/**
 * @typedef {{ text: string, start: number, end: number }} TimedWord
 */

/**
 * Align reference lyric words to ASR timed words.
 *
 * @param {string[]|string} referenceWordsOrText - your official lyrics
 * @param {TimedWord[]} asrWords - whisper (or other) timed tokens
 * @param {{ duration?: number }} [opts]
 * @returns {TimedWord[]}
 */
export function alignLyricsToAsr(referenceWordsOrText, asrWords, opts = {}) {
  const refRaw = Array.isArray(referenceWordsOrText)
    ? referenceWordsOrText.filter(Boolean)
    : tokenizeLyricWords(referenceWordsOrText);

  if (!refRaw.length) return [];
  if (!asrWords?.length) {
    return evenly(refRaw, opts.duration || refRaw.length * 0.35);
  }

  const ref = refRaw.map((text) => ({
    text,
    norm: normalizeToken(text),
  }));
  const asr = asrWords
    .map((w) => ({
      text: w.text,
      norm: normalizeToken(w.text),
      start: Number(w.start) || 0,
      end: Number(w.end) || Number(w.start) || 0,
    }))
    .filter((w) => w.norm);

  if (!asr.length) {
    return evenly(refRaw, opts.duration || refRaw.length * 0.35);
  }

  // Needleman–Wunsch (cap size — huge lyric sheets use greedy align instead of freezing UI)
  const n = ref.length;
  const m = asr.length;
  if (n * m > 400_000) {
    return greedyAlign(refRaw, asr, opts.duration);
  }
  const MATCH = 2;
  const MISMATCH = -1;
  const GAP = -1;

  /** @type {number[][]} */
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  /** @type {number[][]} */
  const bt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  // 0=diag, 1=up (gap asr), 2=left (gap ref)

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * GAP;
    bt[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * GAP;
    bt[0][j] = 2;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1].norm === asr[j - 1].norm;
      // soft match: prefix / contains for sung elongations
      const soft =
        !same &&
        ref[i - 1].norm.length > 2 &&
        asr[j - 1].norm.length > 2 &&
        (ref[i - 1].norm.startsWith(asr[j - 1].norm.slice(0, 3)) ||
          asr[j - 1].norm.startsWith(ref[i - 1].norm.slice(0, 3)) ||
          ref[i - 1].norm.includes(asr[j - 1].norm) ||
          asr[j - 1].norm.includes(ref[i - 1].norm));
      const score = same ? MATCH : soft ? 1 : MISMATCH;
      const diag = dp[i - 1][j - 1] + score;
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;
      if (diag >= up && diag >= left) {
        dp[i][j] = diag;
        bt[i][j] = 0;
      } else if (up >= left) {
        dp[i][j] = up;
        bt[i][j] = 1;
      } else {
        dp[i][j] = left;
        bt[i][j] = 2;
      }
    }
  }

  /** @type {(number|null)[]} */
  const asrIndexForRef = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bt[i][j] === 0) {
      asrIndexForRef[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || bt[i][j] === 1)) {
      // ref word with no asr match
      i -= 1;
    } else {
      j -= 1;
    }
  }

  /** @type {(TimedWord|null)[]} */
  const timed = refRaw.map((text) => ({ text, start: NaN, end: NaN }));

  for (let r = 0; r < n; r++) {
    const ai = asrIndexForRef[r];
    if (ai == null) continue;
    timed[r] = {
      text: refRaw[r],
      start: asr[ai].start,
      end: Math.max(asr[ai].end, asr[ai].start + 0.06),
    };
  }

  // Interpolate unmatched runs between anchors
  let lastAnchor = -1;
  for (let r = 0; r <= n; r++) {
    const isEnd = r === n;
    const isAnchor = !isEnd && Number.isFinite(timed[r].start);
    if (!isAnchor && !isEnd) continue;

    const nextAnchor = isEnd ? n : r;
    if (lastAnchor + 1 < nextAnchor) {
      const gapStart =
        lastAnchor >= 0
          ? timed[lastAnchor].end
          : asr[0].start;
      const gapEnd = isEnd
        ? asr[asr.length - 1].end
        : timed[nextAnchor].start;
      const count = nextAnchor - lastAnchor - 1;
      const span = Math.max(0.05 * count, gapEnd - gapStart);
      const step = span / count;
      const base = gapStart;
      for (let k = 0; k < count; k++) {
        const idx = lastAnchor + 1 + k;
        const s = base + k * step;
        timed[idx] = {
          text: refRaw[idx],
          start: s,
          end: s + Math.max(0.06, step * 0.9),
        };
      }
    }
    if (isAnchor) lastAnchor = r;
  }

  // Final pass: enforce monotonic non-overlapping
  for (let r = 0; r < n; r++) {
    if (!Number.isFinite(timed[r].start)) {
      const prev = r > 0 ? timed[r - 1].end : asr[0].start;
      timed[r] = {
        text: refRaw[r],
        start: prev,
        end: prev + 0.2,
      };
    }
    if (r > 0 && timed[r].start < timed[r - 1].end) {
      timed[r].start = timed[r - 1].end;
    }
    if (timed[r].end <= timed[r].start) {
      timed[r].end = timed[r].start + 0.08;
    }
    if (r < n - 1 && Number.isFinite(timed[r + 1].start) && timed[r].end > timed[r + 1].start) {
      timed[r].end = Math.max(timed[r].start + 0.05, timed[r + 1].start);
    }
  }

  return timed;
}

function evenly(words, durationSec) {
  const duration = Math.max(Number(durationSec) || words.length * 0.3, words.length * 0.15);
  const lead = Math.min(1.5, duration * 0.05);
  const usable = Math.max(0.2, duration - lead - 0.3);
  const slot = usable / words.length;
  return words.map((text, i) => {
    const start = lead + i * slot;
    return { text, start, end: start + Math.max(0.08, slot * 0.9) };
  });
}

/** Linear scan align for very long lyrics (O(n+m), no freeze). */
function greedyAlign(refRaw, asr, duration) {
  /** @type {TimedWord[]} */
  const out = [];
  let j = 0;
  for (let i = 0; i < refRaw.length; i++) {
    const norm = normalizeToken(refRaw[i]);
    let found = -1;
    const limit = Math.min(asr.length, j + 40);
    for (let k = j; k < limit; k++) {
      if (
        asr[k].norm === norm ||
        (norm.length > 2 &&
          asr[k].norm.length > 2 &&
          (asr[k].norm.startsWith(norm.slice(0, 3)) ||
            norm.startsWith(asr[k].norm.slice(0, 3))))
      ) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      out.push({
        text: refRaw[i],
        start: asr[found].start,
        end: Math.max(asr[found].end, asr[found].start + 0.06),
      });
      j = found + 1;
    } else {
      const prev = out.length ? out[out.length - 1].end : asr[0]?.start || 0;
      out.push({ text: refRaw[i], start: prev, end: prev + 0.2 });
    }
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) out[i].start = out[i - 1].end;
    if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.08;
  }
  void duration;
  return out;
}

/**
 * Rough quality of the alignment (0–1): fraction of ref words that matched ASR.
 * @param {string[]|string} referenceWordsOrText
 * @param {TimedWord[]} asrWords
 */
export function alignmentMatchRate(referenceWordsOrText, asrWords) {
  const ref = (Array.isArray(referenceWordsOrText)
    ? referenceWordsOrText
    : tokenizeLyricWords(referenceWordsOrText)
  ).map(normalizeToken).filter(Boolean);
  const asrSet = new Set(
    (asrWords || []).map((w) => normalizeToken(w.text)).filter(Boolean)
  );
  if (!ref.length) return 0;
  let hit = 0;
  for (const w of ref) {
    if (asrSet.has(w)) hit += 1;
    else {
      // soft
      for (const a of asrSet) {
        if (a.length > 2 && w.length > 2 && (a.startsWith(w.slice(0, 3)) || w.startsWith(a.slice(0, 3)))) {
          hit += 0.5;
          break;
        }
      }
    }
  }
  return hit / ref.length;
}
