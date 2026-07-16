/** High-quality Japanese ink illustrations for insight pages */
export const INSIGHT_ART = Array.from({ length: 24 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `/images/insights/insight-${n}.jpg`;
});

/**
 * Stable image assignment for each book insight page.
 * Mixes book number + insight index so adjacent pages rarely repeat.
 */
export function getInsightImage(bookNumber, insightIndex) {
  const pool = INSIGHT_ART.length;
  const idx =
    (Math.abs((bookNumber || 1) * 17 + (insightIndex || 0) * 7) +
      (bookNumber || 1) +
      (insightIndex || 0)) %
    pool;
  return INSIGHT_ART[idx];
}
