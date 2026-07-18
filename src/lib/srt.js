/**
 * SRT / VTT parse & export for karaoke timing.
 */

/**
 * @typedef {{ text: string, start: number, end: number }} TimedWord
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

  // Strip WebVTT header
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
    // optional index line
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
 * Convert SRT/VTT cues → word-level timings (even split inside each cue).
 * @param {string} raw
 * @returns {TimedWord[]}
 */
export function srtToWords(raw) {
  const cues = parseSrt(raw);
  /** @type {TimedWord[]} */
  const words = [];
  for (const cue of cues) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const span = Math.max(0.12 * tokens.length, cue.end - cue.start);
    const step = span / tokens.length;
    tokens.forEach((tok, k) => {
      const s = cue.start + k * step;
      words.push({
        text: tok.replace(/^["'([{]+|["',.!?;:)\]}]+$/g, "") || tok,
        start: s,
        end: s + Math.max(0.06, step * 0.92),
      });
    });
  }
  // seal overlaps
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].end > words[i + 1].start) {
      words[i].end = Math.max(words[i].start + 0.05, words[i + 1].start);
    }
  }
  return words.filter((w) => w.text);
}

/**
 * @param {TimedWord[]} words
 * @param {string} [title]
 * @returns {string}
 */
export function wordsToSrt(words, title = "") {
  if (!words?.length) return "";
  // Group ~8 words or by ~3s gap into cues
  const cues = [];
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
    if (buf.length >= 8 || gap > 0.55 || i === words.length - 1) {
      flush(w.end);
    }
  }

  let out = title ? `WEBVTT\n\n` : "";
  // always emit classic SRT
  out = "";
  cues.forEach((c, idx) => {
    out += `${idx + 1}\n`;
    out += `${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n`;
    out += `${c.text}\n\n`;
  });
  return out.trim() + "\n";
}

/**
 * Detect if textarea content looks like SRT/VTT.
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
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const sec = Number(parts[2]) || 0;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const sec = Number(parts[1]) || 0;
    return m * 60 + sec;
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
