/**
 * Karaoki SrtReader — custom SRT/WebVTT engine (no browser caption APIs).
 *
 * Responsibilities:
 * - Parse real-world SRT/VTT (indexes, multi-line cues, commas/dots, tags)
 * - Find active cue at playback time (binary search)
 * - Build word timings inside each cue (weighted + optional energy refine)
 * - Export back to SRT
 * - Drive karaoke UI: current/prev/next cue + word fill progress
 */

/**
 * @typedef {{ text: string, start: number, end: number, line?: number, cueIndex?: number }} TimedWord
 * @typedef {{
 *   index: number,
 *   start: number,
 *   end: number,
 *   text: string,
 *   lines: string[],
 *   words: TimedWord[],
 * }} SrtCue
 */

export class SrtReader {
  /** @param {SrtCue[]} cues */
  constructor(cues = []) {
    this.cues = normalizeCues(cues);
    this._words = null;
  }

  /** @param {string} raw */
  static parse(raw) {
    return new SrtReader(parseCues(raw));
  }

  /** @param {File|Blob} file */
  static async fromFile(file) {
    const text = await file.text();
    return SrtReader.parse(text);
  }

  get length() {
    return this.cues.length;
  }

  get isEmpty() {
    return this.cues.length === 0;
  }

  /** Flat word list across all cues (cached). */
  get words() {
    if (!this._words) {
      this._words = this.cues.flatMap((c) => c.words);
    }
    return this._words;
  }

  /** Plain lyrics (one SRT line group per cue). */
  get lyricsText() {
    return this.cues.map((c) => c.text).join("\n");
  }

  /**
   * Binary search: last cue with start <= t.
   * @param {number} t
   * @returns {number} cue index or -1
   */
  cueIndexAt(t) {
    const cues = this.cues;
    if (!cues.length || t == null || Number.isNaN(t)) return -1;

    // Before first cue
    if (t < cues[0].start) return -1;

    let lo = 0;
    let hi = cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return -1;

    // Only "active" while inside [start, end); after end show nothing until next
    // (unless very short gap — keep last cue briefly for continuity)
    const c = cues[ans];
    if (t < c.end + 0.05) return ans;
    if (ans + 1 < cues.length && t < cues[ans + 1].start) {
      // in the gap — prefer next if close, else blank
      if (cues[ans + 1].start - t < 0.12) return ans + 1;
      return -1;
    }
    if (ans === cues.length - 1 && t < c.end + 0.8) return ans;
    return -1;
  }

  /**
   * @param {number} t
   * @returns {SrtCue|null}
   */
  cueAt(t) {
    const i = this.cueIndexAt(t);
    return i >= 0 ? this.cues[i] : null;
  }

  /**
   * Build word highlight states for a cue at time t.
   * @param {SrtCue} cue
   * @param {number} t
   * @param {'active'|'upcoming'|'done'} role
   */
  wordStatesForCue(cue, t, role = "active") {
    /** @type {{ text: string, state: 'past'|'active'|'future', fill: number }[]} */
    const wordStates = [];
    if (!cue?.words?.length) {
      const fallback =
        role === "done" ? "past" : role === "upcoming" ? "future" : "active";
      return {
        wordStates: [{ text: cue?.text || "", state: fallback, fill: role === "done" ? 1 : 0 }],
        wordIndex: -1,
        wordProgress: 0,
        cueProgress: 0,
      };
    }

    // Completed line in the pair (top line after bottom is singing)
    if (role === "done") {
      for (const w of cue.words) {
        wordStates.push({ text: w.text, state: "past", fill: 1 });
      }
      return { wordStates, wordIndex: cue.words.length - 1, wordProgress: 1, cueProgress: 1 };
    }

    // Before this cue's timestamps: all future (still visible)
    if (t < cue.start || role === "upcoming") {
      for (const w of cue.words) {
        wordStates.push({ text: w.text, state: "future", fill: 0 });
      }
      return { wordStates, wordIndex: -1, wordProgress: 0, cueProgress: 0 };
    }

    let wordIndex = -1;
    let wordProgress = 0;
    for (let i = 0; i < cue.words.length; i++) {
      const w = cue.words[i];
      if (t >= w.start && t < w.end + 0.02) {
        wordIndex = i;
        const span = Math.max(0.04, w.end - w.start);
        wordProgress = Math.max(0, Math.min(1, (t - w.start) / span));
      }
    }
    if (wordIndex < 0 && t >= cue.start) {
      for (let i = cue.words.length - 1; i >= 0; i--) {
        if (t >= cue.words[i].start) {
          wordIndex = i;
          wordProgress = t >= cue.words[i].end ? 1 : 0;
          break;
        }
      }
    }

    for (let i = 0; i < cue.words.length; i++) {
      let state = "future";
      let fill = 0;
      if (wordIndex < 0) {
        state = t >= cue.end ? "past" : "future";
      } else if (i < wordIndex) {
        state = "past";
        fill = 1;
      } else if (i === wordIndex) {
        state = "active";
        fill = wordProgress;
      }
      wordStates.push({ text: cue.words[i].text, state, fill });
    }

    const span = Math.max(0.05, cue.end - cue.start);
    const cueProgress = Math.max(0, Math.min(1, (t - cue.start) / span));
    return { wordStates, wordIndex, wordProgress, cueProgress };
  }

  /**
   * Snapshot for dual-line karaoke UI (fixed top/bottom pair).
   *
   * Lines stay put: highlight top (cues 0,2,4…), then bottom (1,3,5…),
   * then wrap to the next pair — bottom does NOT slide up to top.
   *
   * From music start: show first pair with top line ready.
   * @param {number} t
   */
  snapshot(t) {
    const PREVIEW_LEAD = 5; // show first line only this many seconds early
    const cues = this.cues;
    const empty = {
      time: t,
      cueIndex: -1,
      pairStart: -1,
      lineA: null,
      lineB: null,
      cue: null,
      next: null,
      prev: null,
      wordIndex: -1,
      wordProgress: 0,
      wordStates: [],
      cueProgress: 0,
      waitingForFirst: false,
      showDots: false,
      previewIntro: false,
      inGap: false,
      secondsToFirst: 0,
    };

    if (!cues.length) return empty;

    const firstStart = cues[0].start;

    // Far before first lyric — three dots only (no first line, no countdown)
    if (t < firstStart - PREVIEW_LEAD - 0.02) {
      return {
        ...empty,
        waitingForFirst: true,
        showDots: true,
        secondsToFirst: firstStart - t,
      };
    }

    // 5s lead-in: introduce ONLY the first line (upcoming), never other lines
    if (t < firstStart - 0.02) {
      const topCue = cues[0];
      const a = this.wordStatesForCue(topCue, t, "upcoming");
      return {
        ...empty,
        cueIndex: 0,
        pairStart: 0,
        cue: topCue,
        next: cues[1] || null,
        lineA: {
          cue: topCue,
          ...a,
          role: "upcoming",
        },
        lineB: null,
        previewIntro: true,
        waitingForFirst: true,
        secondsToFirst: firstStart - t,
      };
    }

    let idx = this.cueIndexAt(t);

    // Long instrumental / inter-line gap: stay blank until the next cue
    // (short tails still kept by cueIndexAt's end+0.05 grace)
    if (idx < 0) {
      // Between cues or after last
      let lastEnded = -1;
      for (let i = cues.length - 1; i >= 0; i--) {
        if (t >= cues[i].end) {
          lastEnded = i;
          break;
        }
      }
      // If we're past some cue end and not yet in the next, blank
      if (lastEnded >= 0) {
        const next = cues[lastEnded + 1];
        if (!next || t < next.start - 0.02) {
          return {
            ...empty,
            inGap: true,
            prev: cues[lastEnded],
            next: next || null,
          };
        }
      }
      // Fallback blank rather than forcing line 0
      return { ...empty, inGap: true };
    }

    // Pair: (0,1) then (2,3) then (4,5)…
    const pairStart = Math.floor(idx / 2) * 2;
    const topCue = cues[pairStart];
    const bottomCue = pairStart + 1 < cues.length ? cues[pairStart + 1] : null;

    // Which line in the pair is singing?
    const topRole =
      idx > pairStart ? "done" : idx === pairStart ? "active" : "upcoming";
    const bottomRole =
      !bottomCue
        ? null
        : idx > pairStart + 1
          ? "done"
          : idx === pairStart + 1
            ? "active"
            : "upcoming";

    const a = this.wordStatesForCue(topCue, t, topRole);
    const b = bottomCue
      ? this.wordStatesForCue(bottomCue, t, bottomRole)
      : null;

    return {
      time: t,
      cueIndex: idx,
      pairStart,
      cue: idx === pairStart ? topCue : bottomCue || topCue,
      next: bottomCue,
      prev: pairStart > 0 ? cues[pairStart - 1] : null,
      lineA: {
        cue: topCue,
        ...a,
        role: topRole,
      },
      lineB: bottomCue
        ? {
            cue: bottomCue,
            ...b,
            role: bottomRole,
          }
        : null,
      wordIndex: (idx === pairStart ? a : b)?.wordIndex ?? -1,
      wordProgress: (idx === pairStart ? a : b)?.wordProgress ?? 0,
      wordStates: (idx === pairStart ? a : b)?.wordStates ?? [],
      cueProgress: (idx === pairStart ? a : b)?.cueProgress ?? 0,
      waitingForFirst: false,
      inGap: false,
      secondsToFirst: 0,
    };
  }

  /**
   * Rebuild in-cue word timings from character weights.
   * @returns {SrtReader}
   */
  rebuildWeightedWords() {
    for (const cue of this.cues) {
      const tokens = tokenize(cue.text);
      cue.words = placeWeighted(tokens, cue.start, cue.end, cue.index - 1);
    }
    this._words = null;
    return this;
  }

  /**
   * Refine word boundaries using audio energy inside each cue.
   * @param {Float32Array} samples
   * @param {number} sampleRate
   * @returns {SrtReader}
   */
  refineWithEnergy(samples, sampleRate) {
    if (!samples?.length) return this;
    for (const cue of this.cues) {
      if (!cue.words?.length) continue;
      cue.words = redistributeByEnergy(
        cue.words,
        cue.start,
        cue.end,
        samples,
        sampleRate,
        cue.index - 1
      );
    }
    this._words = null;
    return this;
  }

  /**
   * Shift all cues (and words) by delta seconds.
   * @param {number} deltaSec
   * @returns {SrtReader}
   */
  shift(deltaSec) {
    const d = Number(deltaSec) || 0;
    if (!d) return this;
    for (const cue of this.cues) {
      cue.start = Math.max(0, cue.start + d);
      cue.end = Math.max(cue.start + 0.05, cue.end + d);
      for (const w of cue.words) {
        w.start = Math.max(0, w.start + d);
        w.end = Math.max(w.start + 0.04, w.end + d);
      }
    }
    this._words = null;
    return this;
  }

  /** Reindex cues + invalidate word cache */
  _reindex() {
    this.cues.forEach((c, i) => {
      c.index = i + 1;
      for (const w of c.words || []) {
        w.line = i;
        w.cueIndex = i;
      }
    });
    this._words = null;
    return this;
  }

  /**
   * Edit cue text and rebuild weighted words (keeps start/end times).
   * @param {number} index 0-based
   * @param {string} text
   */
  updateCueText(index, text) {
    const cue = this.cues[index];
    if (!cue) return this;
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return this.removeCueAt(index);
    cue.text = cleaned;
    cue.lines = cleaned.split(/\n/).map((l) => l.trim()).filter(Boolean);
    cue.words = placeWeighted(tokenize(cleaned), cue.start, cue.end, index);
    this._words = null;
    return this;
  }

  /**
   * Set absolute start/end for a cue; scale word times inside proportionally.
   * @param {number} index
   * @param {number} startSec
   * @param {number} endSec
   */
  updateCueTimes(index, startSec, endSec) {
    const cue = this.cues[index];
    if (!cue) return this;
    let start = Math.max(0, Number(startSec) || 0);
    let end = Math.max(start + 0.08, Number(endSec) || start + 1);
    // Don't overlap neighbors
    if (index > 0) {
      const prev = this.cues[index - 1];
      if (start < prev.start + 0.05) start = prev.start + 0.05;
      if (start < prev.end) {
        // allow slight overlap fix by pushing start
        start = Math.max(start, prev.start + 0.05);
      }
    }
    if (index < this.cues.length - 1) {
      const next = this.cues[index + 1];
      if (end > next.end - 0.05) end = Math.max(start + 0.08, next.end - 0.05);
      if (end > next.start) end = Math.max(start + 0.08, next.start);
    }

    const oldStart = cue.start;
    const oldEnd = cue.end;
    const oldSpan = Math.max(0.05, oldEnd - oldStart);
    const newSpan = end - start;

    cue.start = start;
    cue.end = end;
    if (cue.words?.length) {
      cue.words = cue.words.map((w) => {
        const rel0 = (w.start - oldStart) / oldSpan;
        const rel1 = (w.end - oldStart) / oldSpan;
        return {
          ...w,
          start: start + rel0 * newSpan,
          end: start + rel1 * newSpan,
          line: index,
          cueIndex: index,
        };
      });
    } else {
      cue.words = placeWeighted(tokenize(cue.text), start, end, index);
    }
    this._words = null;
    return this;
  }

  /**
   * Nudge a cue (and its words) by delta seconds.
   * @param {number} index
   * @param {number} deltaSec
   */
  nudgeCue(index, deltaSec) {
    const cue = this.cues[index];
    if (!cue || !deltaSec) return this;
    return this.updateCueTimes(index, cue.start + deltaSec, cue.end + deltaSec);
  }

  /**
   * Rebuild from a flat timed-word list (preserves line grouping when present).
   * @param {{ text: string, start: number, end: number, line?: number }[]} words
   */
  static fromWords(words) {
    if (!words?.length) return new SrtReader([]);
    const hasLines = words.some((w) => w.line != null);
    if (hasLines) {
      const map = new Map();
      for (const w of words) {
        const L = w.line ?? 0;
        if (!map.has(L)) map.set(L, []);
        map.get(L).push({ ...w });
      }
      const cues = [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, group], i) => ({
          index: i + 1,
          start: group[0].start,
          end: group[group.length - 1].end,
          text: group.map((g) => g.text).join(" "),
          words: group.map((g) => ({ ...g, line: i, cueIndex: i })),
        }));
      return new SrtReader(cues);
    }
    // One word per cue-ish: group ~8 words
    const cues = [];
    for (let i = 0; i < words.length; i += 8) {
      const group = words.slice(i, i + 8);
      cues.push({
        index: cues.length + 1,
        start: group[0].start,
        end: group[group.length - 1].end,
        text: group.map((g) => g.text).join(" "),
        words: group,
      });
    }
    return new SrtReader(cues);
  }

  /**
   * Shift all words from index i onward by delta (for corrective tap sync).
   * @param {number} wordIndex
   * @param {number} deltaSec
   */
  shiftWordsFrom(wordIndex, deltaSec) {
    const words = this.words;
    if (!words.length || !deltaSec) return this;
    const next = words.map((w, i) => {
      if (i < wordIndex) return { ...w };
      return {
        ...w,
        start: Math.max(0, w.start + deltaSec),
        end: Math.max(0.05, w.end + deltaSec),
      };
    });
    // seal previous end
    if (wordIndex > 0) {
      next[wordIndex - 1] = {
        ...next[wordIndex - 1],
        end: Math.min(next[wordIndex - 1].end, next[wordIndex].start),
      };
    }
    const rebuilt = SrtReader.fromWords(next);
    this.cues = rebuilt.cues;
    this._words = null;
    return this;
  }

  /**
   * @param {number} index 0-based
   */
  removeCueAt(index) {
    if (index < 0 || index >= this.cues.length) return this;
    this.cues.splice(index, 1);
    return this._reindex();
  }

  /**
   * Insert a new cue at `index` (0 = before first, length = append).
   * Auto-fills times from neighboring gaps when start/end omitted —
   * useful for missing phrases between existing lines.
   *
   * @param {number} index 0-based insert position
   * @param {{ text?: string, start?: number, end?: number }} [opts]
   * @returns {number} new cue index
   */
  insertCueAt(index, opts = {}) {
    const i = Math.max(0, Math.min(this.cues.length, Number(index) || 0));
    const text =
      String(opts.text ?? "New phrase")
        .replace(/\s+/g, " ")
        .trim() || "New phrase";

    let start = Number(opts.start);
    let end = Number(opts.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      ({ start, end } = this._suggestInsertTimes(i));
    }

    start = Math.max(0, start);
    end = Math.max(start + 0.25, end);

    // If we land on top of the next cue, gently push later cues forward
    if (i < this.cues.length && end > this.cues[i].start - 0.02) {
      const push = end + 0.05 - this.cues[i].start;
      if (push > 0) {
        for (let j = i; j < this.cues.length; j++) {
          const c = this.cues[j];
          c.start += push;
          c.end += push;
          for (const w of c.words || []) {
            w.start += push;
            w.end += push;
          }
        }
      }
    }

    // Don't start before previous end
    if (i > 0) {
      const prev = this.cues[i - 1];
      if (start < prev.end) {
        start = prev.end + 0.02;
        if (end <= start) end = start + 1.2;
      }
    }

    const cue = {
      index: i + 1,
      start,
      end,
      text,
      lines: [text],
      words: placeWeighted(tokenize(text), start, end, i),
    };
    this.cues.splice(i, 0, cue);
    this._reindex();
    return i;
  }

  /**
   * Insert after cue `index` (or append if last).
   * @param {number} index 0-based cue to insert after
   * @param {{ text?: string, start?: number, end?: number }} [opts]
   * @returns {number} new cue index
   */
  insertCueAfter(index, opts = {}) {
    const after = Math.max(-1, Math.min(this.cues.length - 1, Number(index)));
    return this.insertCueAt(after + 1, opts);
  }

  /**
   * Suggest start/end for a cue inserted at position i.
   * Prefers empty gaps between neighbors for missing phrases.
   * @param {number} i
   * @returns {{ start: number, end: number }}
   */
  _suggestInsertTimes(i) {
    if (!this.cues.length) {
      return { start: 0, end: 2 };
    }

    // Append after last
    if (i >= this.cues.length) {
      const last = this.cues[this.cues.length - 1];
      const span = Math.max(1.2, Math.min(3, last.end - last.start));
      const start = last.end + 0.08;
      return { start, end: start + span };
    }

    // Before first
    if (i === 0) {
      const first = this.cues[0];
      if (first.start >= 1.2) {
        const end = Math.max(0.4, first.start - 0.08);
        const start = Math.max(0, end - Math.min(2.5, first.start * 0.6));
        return { start, end };
      }
      // No room before: squeeze a short intro and push later (handled in insert)
      return { start: 0, end: 1.2 };
    }

    // Between prev and next — use the gap (missing phrase case)
    const prev = this.cues[i - 1];
    const next = this.cues[i];
    const gap = next.start - prev.end;

    if (gap >= 0.45) {
      const pad = Math.min(0.08, gap * 0.1);
      let start = prev.end + pad;
      let end = next.start - pad;
      // Cap very long instrumental gaps to a readable line length
      if (end - start > 4) {
        start = prev.end + pad;
        end = start + 2.5;
      }
      if (end - start < 0.35) {
        end = start + 0.8;
      }
      return { start, end };
    }

    // Tight gap: insert a short line starting at prev.end (will push next)
    const start = prev.end + 0.04;
    return { start, end: start + 1.4 };
  }

  /** Remove first n cues (junk intros from free generators). */
  trimHead(n = 1) {
    const count = Math.max(0, Math.min(this.cues.length, Number(n) || 0));
    if (count) this.cues.splice(0, count);
    return this._reindex();
  }

  /** Remove last n cues (junk outros). */
  trimTail(n = 1) {
    const count = Math.max(0, Math.min(this.cues.length, Number(n) || 0));
    if (count) this.cues.splice(this.cues.length - count, count);
    return this._reindex();
  }

  /**
   * Drop empty / near-empty cues and common generator junk.
   */
  cleanJunk() {
    const junk =
      /^(thanks for watching|subscribe|like and subscribe|music|\[music\]|♪|instrumental|www\.|http)/i;
    this.cues = this.cues.filter((c) => {
      const t = (c.text || "").trim();
      if (!t || t.length < 2) return false;
      if (junk.test(t)) return false;
      return true;
    });
    return this._reindex();
  }

  /**
   * Restructure so every Capitalized word starts a new line.
   * Fixes free-generator SRTs that glue two sentences into one cue.
   * Word timestamps are preserved; only line boundaries change.
   *
   * Example: "hello world This is fine" →
   *   line1: "hello world"
   *   line2: "This is fine"
   *
   * @param {{ keepSingleLetter?: boolean }} [opts]
   *   keepSingleLetter: if false (default), single-letter caps like "I" still start a line.
   */
  restructureByCapital(opts = {}) {
    const words = this.words.slice().sort((a, b) => a.start - b.start);
    if (!words.length) return this;

    /** @type {TimedWord[][]} */
    const groups = [];
    let current = [];

    for (const w of words) {
      const text = String(w.text || "").trim();
      const startsCapital = startsWithCapital(text);

      if (current.length > 0 && startsCapital) {
        groups.push(current);
        current = [{ ...w }];
      } else {
        current.push({ ...w });
      }
    }
    if (current.length) groups.push(current);

    this.cues = groups.map((group, i) => {
      const start = group[0].start;
      const end = Math.max(
        group[group.length - 1].end,
        start + 0.1
      );
      const text = group.map((g) => g.text).join(" ");
      // Keep original word times (don't re-weight — preserves music flow)
      const cueWords = group.map((g) => ({
        text: g.text,
        start: g.start,
        end: g.end,
        line: i,
        cueIndex: i,
      }));
      return {
        index: i + 1,
        start,
        end,
        text,
        lines: [text],
        words: cueWords,
      };
    });

    void opts;
    this._words = null;
    return this;
  }

  /** Serialize to classic SRT. */
  toSrt() {
    let out = "";
    this.cues.forEach((c, i) => {
      out += `${i + 1}\n`;
      out += `${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n`;
      out += `${c.lines?.length ? c.lines.join("\n") : c.text}\n\n`;
    });
    return out.trim() + "\n";
  }

  /** JSON-serializable dump for localStorage. */
  toJSON() {
    return {
      cues: this.cues.map((c) => ({
        index: c.index,
        start: c.start,
        end: c.end,
        text: c.text,
        lines: c.lines,
        words: c.words,
      })),
    };
  }

  static fromJSON(data) {
    return new SrtReader(data?.cues || []);
  }
}

/* ========================= Parser ========================= */

/**
 * @param {string} raw
 * @returns {SrtCue[]}
 */
export function parseCues(raw) {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!text) return [];

  let body = text;
  // WebVTT
  if (/^WEBVTT/i.test(body)) {
    body = body
      .replace(/^WEBVTT[^\n]*\n/, "")
      .replace(/^(NOTE|STYLE|REGION)[\s\S]*?(\n\n|$)/gm, "");
  }

  // Normalize: some files use single newlines only between blocks poorly
  const blocks = body.split(/\n\s*\n+/);
  /** @type {SrtCue[]} */
  const cues = [];

  for (const block of blocks) {
    const rawLines = block.split("\n");
    const lines = [];
    for (const L of rawLines) {
      const t = L.trim();
      if (t) lines.push(t);
    }
    if (!lines.length) continue;

    let i = 0;
    // cue number
    if (/^\d+$/.test(lines[0])) i = 1;
    if (i >= lines.length) continue;

    // optional WebVTT cue id
    if (i < lines.length && !/-->/.test(lines[i]) && i + 1 < lines.length && /-->/.test(lines[i + 1])) {
      i += 1;
    }

    const timeLine = lines[i];
    if (!/-->/.test(timeLine)) continue;

    const tm = timeLine.match(
      /((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/
    );
    if (!tm) continue;

    const start = parseTimestamp(tm[1]);
    const end = parseTimestamp(tm[2]);
    const textLines = lines
      .slice(i + 1)
      .map(stripTags)
      .filter(Boolean);
    if (!textLines.length || !Number.isFinite(start)) continue;

    const joined = textLines.join(" ").replace(/\s+/g, " ").trim();
    const lineIdx = cues.length;
    const tokens = tokenize(joined);
    const cueEnd = Number.isFinite(end) && end > start ? end : start + Math.max(1.2, tokens.length * 0.35);

    cues.push({
      index: lineIdx + 1,
      start,
      end: cueEnd,
      text: joined,
      lines: textLines,
      words: placeWeighted(tokens, start, cueEnd, lineIdx),
    });
  }

  // sort + fix overlapping cue ends
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    cues[i].index = i + 1;
    if (i < cues.length - 1 && cues[i].end > cues[i + 1].start) {
      cues[i].end = Math.max(cues[i].start + 0.1, cues[i + 1].start);
      // rebuild words for clamped end
      cues[i].words = placeWeighted(
        tokenize(cues[i].text),
        cues[i].start,
        cues[i].end,
        i
      );
    }
  }

  return cues;
}

function normalizeCues(cues) {
  return (cues || []).map((c, i) => {
    const text = c.text || (c.lines || []).join(" ") || "";
    const start = Number(c.start) || 0;
    const end = Number(c.end) > start ? Number(c.end) : start + 1;
    const words =
      Array.isArray(c.words) && c.words.length
        ? c.words.map((w) => ({
            text: w.text,
            start: Number(w.start) || start,
            end: Number(w.end) || start + 0.2,
            line: i,
            cueIndex: i,
          }))
        : placeWeighted(tokenize(text), start, end, i);
    return {
      index: c.index || i + 1,
      start,
      end,
      text,
      lines: c.lines?.length ? c.lines : [text],
      words,
    };
  });
}

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function tokenize(text) {
  return String(text || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function wordWeight(token) {
  const raw = String(token || "");
  const clean = raw.replace(/[^a-zA-Z0-9']/g, "");
  if (!clean) return 0.5;
  const syllables = Math.max(1, (clean.toLowerCase().match(/[aeiouy]+/g) || []).length);
  const letters = clean.length;
  let w = letters * 0.55 + syllables * 0.9;
  if (/[,;:—–-]$/.test(raw)) w += 0.45;
  if (/[.!?…]$/.test(raw)) w += 0.35;
  if (letters <= 2) w *= 0.72;
  return Math.max(0.35, w);
}

export function placeWeighted(tokens, start, end, lineIdx) {
  if (!tokens.length) return [];
  const weights = tokens.map(wordWeight);
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.08 * tokens.length, end - start);
  const pad = Math.min(0.05, span * 0.03);
  const usable = Math.max(0.05, span - pad * 2);
  let cursor = start + pad;
  /** @type {TimedWord[]} */
  const words = [];
  tokens.forEach((tok, k) => {
    const share = (weights[k] / totalW) * usable;
    const gap = k < tokens.length - 1 ? Math.min(0.04, share * 0.1) : 0;
    const hold = Math.max(0.05, share - gap);
    const text = tok.replace(/^["“‘(]+|["”’)]+$/g, "") || tok;
    words.push({
      text,
      start: cursor,
      end: cursor + hold,
      line: lineIdx,
      cueIndex: lineIdx,
    });
    cursor += share;
  });
  if (words.length) {
    words[words.length - 1].end = Math.max(
      words[words.length - 1].start + 0.05,
      end - pad
    );
  }
  return words;
}

function redistributeByEnergy(group, cueStart, cueEnd, samples, sampleRate, lineIdx) {
  const n = group.length;
  if (n <= 1) return group;
  const i0 = Math.max(0, Math.floor(cueStart * sampleRate));
  const i1 = Math.min(samples.length, Math.ceil(cueEnd * sampleRate));
  if (i1 - i0 < n * 8) {
    return placeWeighted(
      group.map((g) => g.text),
      cueStart,
      cueEnd,
      lineIdx
    );
  }

  const hop = Math.max(1, Math.floor(sampleRate * 0.02));
  const energy = [];
  let peak = 0;
  for (let i = i0; i < i1; i += hop) {
    const end = Math.min(i1, i + hop);
    let s = 0;
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    const r = Math.sqrt(s / (end - i || 1));
    energy.push(r);
    if (r > peak) peak = r;
  }
  if (peak < 1e-8) {
    return placeWeighted(
      group.map((g) => g.text),
      cueStart,
      cueEnd,
      lineIdx
    );
  }

  const floor = peak * 0.08;
  const boosted = energy.map((r) => Math.max(0, r - floor) + peak * 0.02);
  const totalE = boosted.reduce((a, b) => a + b, 0) || 1;
  const cum = [];
  let run = 0;
  for (const e of boosted) {
    run += e;
    cum.push(run / totalE);
  }

  const weights = group.map((g) => wordWeight(g.text));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const times = [cueStart];
  for (let k = 0; k < n - 1; k++) {
    acc += weights[k] / totalW;
    let fi = 0;
    while (fi < cum.length && cum[fi] < acc) fi += 1;
    const frac = fi / Math.max(1, cum.length);
    const time = cueStart + frac * (cueEnd - cueStart);
    times.push(Math.max(times[times.length - 1] + 0.04, time));
  }
  times.push(cueEnd);

  return group.map((g, k) => ({
    text: g.text,
    start: times[k],
    end: Math.max(times[k] + 0.05, times[k + 1] - 0.01),
    line: lineIdx,
    cueIndex: lineIdx,
  }));
}

/** True if token begins with an uppercase letter (Unicode-aware enough for Latin). */
export function startsWithCapital(text) {
  const s = String(text || "").replace(/^["'“‘(\[]+/, "");
  if (!s) return false;
  const ch = s[0];
  // Letter that is uppercase and not the same when lowercased
  return /[A-ZÀ-ÖØ-Þ]/.test(ch) || (ch !== ch.toLowerCase() && ch === ch.toUpperCase() && /[^\d\W]/.test(ch));
}

export function parseTimestamp(ts) {
  const s = String(ts || "")
    .trim()
    .replace(",", ".");
  // support 00:00:01.000 or 00:01.000 or 1.000
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

/** @deprecated use SrtReader.parse — kept for older imports */
export function parseSrt(raw) {
  return SrtReader.parse(raw).cues;
}

export function srtToWords(raw) {
  return SrtReader.parse(raw).words;
}

export function looksLikeSrt(text) {
  const t = String(text || "");
  return (
    /-->/.test(t) &&
    (/\d{1,2}:\d{2}[.,]\d{1,3}/.test(t) || /^WEBVTT/im.test(t))
  );
}

export function wordsToSrt(words) {
  if (!words?.length) return "";
  // group by line if present
  if (words.some((w) => w.line != null)) {
    const map = new Map();
    for (const w of words) {
      const L = w.line ?? 0;
      if (!map.has(L)) map.set(L, []);
      map.get(L).push(w);
    }
    const reader = new SrtReader(
      [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, group], i) => ({
          index: i + 1,
          start: group[0].start,
          end: group[group.length - 1].end,
          text: group.map((g) => g.text).join(" "),
          words: group,
        }))
    );
    return reader.toSrt();
  }
  // fallback chunk
  const cues = [];
  let buf = [];
  let cueStart = words[0].start;
  const flush = (end) => {
    if (!buf.length) return;
    cues.push({
      index: cues.length + 1,
      start: cueStart,
      end,
      text: buf.join(" "),
      words: [],
    });
    buf = [];
  };
  for (let i = 0; i < words.length; i++) {
    if (!buf.length) cueStart = words[i].start;
    buf.push(words[i].text);
    const gap =
      i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    if (buf.length >= 8 || gap > 0.55 || i === words.length - 1) {
      flush(words[i].end);
    }
  }
  return new SrtReader(cues).toSrt();
}

export function refineWordsWithEnergy(words, samples, sampleRate) {
  const reader = new SrtReader(
    // rebuild cues from line field
    (() => {
      const map = new Map();
      for (const w of words) {
        const L = w.line ?? 0;
        if (!map.has(L)) map.set(L, []);
        map.get(L).push(w);
      }
      return [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, group], i) => ({
          index: i + 1,
          start: group[0].start,
          end: group[group.length - 1].end,
          text: group.map((g) => g.text).join(" "),
          words: group,
        }));
    })()
  );
  reader.refineWithEnergy(samples, sampleRate);
  return reader.words;
}
