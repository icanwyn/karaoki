/** Shared alignment helper for Vite dev middleware + serverless */

export function charactersToWords(alignment) {
  if (!alignment) return [];

  const chars = alignment.characters || alignment.chars || [];
  const starts =
    alignment.character_start_times_seconds ||
    alignment.characterStartTimesSeconds ||
    [];
  const ends =
    alignment.character_end_times_seconds ||
    alignment.characterEndTimesSeconds ||
    [];

  if (!chars.length) return [];

  const maxT = Math.max(0, ...starts.map(Number), ...ends.map(Number));
  const scale = maxT > 500 ? 0.001 : 1;

  const words = [];
  let current = "";
  let start = null;
  let end = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const s = (starts[i] ?? 0) * scale;
    const e = (ends[i] ?? s) * scale;

    if (ch === "" || /\s/.test(ch)) {
      if (current) {
        words.push({ word: current, start, end });
        current = "";
        start = null;
        end = null;
      }
      continue;
    }

    if (!current) start = s;
    current += ch;
    end = e;
  }

  if (current) words.push({ word: current, start, end });
  return words;
}
