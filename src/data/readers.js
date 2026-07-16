/**
 * Storyteller voices available on this ElevenLabs account.
 * One reader is assigned per book (stable random from book number).
 */
export const STORYTELLERS = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", style: "warm captivating storyteller" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", style: "velvety literary actress" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", style: "deep resonant comforting" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", style: "mature reassuring" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", style: "steady broadcaster" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", style: "knowledgeable calm" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", style: "smooth trustworthy" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", style: "wise mature balanced" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", style: "laid-back resonant" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", style: "playful bright warm" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", style: "charming down-to-earth" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", style: "clear engaging educator" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", style: "relaxed optimist" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", style: "relaxed neutral" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", style: "professional warm" },
  { id: "deC6NEXcbavaVWbzjgzb", name: "Phuong", style: "smooth comforting gentle" },
  { id: "a3AkyqGG4v8Pg7SWQ0Y3", name: "Ngan", style: "cute bubbly authentic" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", style: "deep confident" },
];

/** Stable "random" reader per book number */
export function getBookReader(bookNumber = 1) {
  const n = Math.abs(Number(bookNumber) || 1);
  const idx = (n * 2654435761) >>> 0; // Knuth multiplicative hash
  return STORYTELLERS[idx % STORYTELLERS.length];
}
