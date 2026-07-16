/**
 * Shan-shui insight art pool.
 * Each of the 1000 insight pages gets a unique visual combination:
 *   base landscape (from Imagine) + filter variant + unique keyword caption.
 *
 * Exact caption text is rendered in HTML (models garble fixed typography).
 */

// Installed pool: public/images/insights/shan-001.jpg …
export const SHAN_SHUI_COUNT = 31;

export const INSIGHT_ART = Array.from({ length: SHAN_SHUI_COUNT }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return `/images/insights/shan-${n}.jpg`;
});

/** Subtle grade variants — no layout cost, multiplies uniqueness of the pool */
export const ART_FILTERS = [
  "contrast(1.04) saturate(0.92)",
  "contrast(1.1) saturate(0.85) brightness(1.02)",
  "contrast(0.96) brightness(1.06) saturate(0.9)",
  "contrast(1.08) saturate(0.78) brightness(0.98)",
  "contrast(1.02) saturate(1.05) brightness(1.01)",
  "contrast(1.12) saturate(0.7)",
  "contrast(0.94) saturate(0.95) brightness(1.04)",
  "contrast(1.06) saturate(0.88) brightness(0.97)",
  "contrast(1.0) saturate(0.82) brightness(1.03)",
  "contrast(1.14) saturate(0.75) brightness(0.99)",
];

/** Global page index 0..999 for bookNumber 1..100, insightIndex 0..9 */
export function insightPageIndex(bookNumber, insightIndex) {
  const b = Math.max(1, Number(bookNumber) || 1);
  const i = Math.max(0, Number(insightIndex) || 0);
  return (b - 1) * 10 + i;
}

/**
 * Unique art assignment for each of 1000 pages.
 * Spreads across the pool so adjacent pages rarely share the same base.
 */
export function getInsightImage(bookNumber, insightIndex) {
  const page = insightPageIndex(bookNumber, insightIndex);
  const pool = INSIGHT_ART.length || 1;
  // Coprime step spreads images across consecutive pages
  const idx = (page * 7 + bookNumber * 3) % pool;
  return INSIGHT_ART[idx];
}

export function getInsightArtFilter(bookNumber, insightIndex) {
  const page = insightPageIndex(bookNumber, insightIndex);
  return ART_FILTERS[page % ART_FILTERS.length];
}

/** Keyword for the red pill — from insight title */
export function getInsightKeyword(insight) {
  if (!insight) return "Meaning";
  const title = (insight.title || "").trim();
  if (!title) return "Meaning";
  // Prefer a short evocative phrase (first 3–5 words)
  const words = title.split(/\s+/);
  if (words.length <= 4) return title;
  // Drop leading articles
  const cleaned = title.replace(/^(the|a|an)\s+/i, "");
  const parts = cleaned.split(/\s+/);
  if (parts.length <= 3) return cleaned;
  return parts.slice(0, 3).join(" ");
}

// Back-compat alias
export { INSIGHT_ART as default };
