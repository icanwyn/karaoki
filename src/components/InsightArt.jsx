/**
 * Shan-shui insight illustration with exact caption typography in HTML
 * (image models cannot reliably render the keyword pill text).
 */
export default function InsightArt({ src, keyword, filter }) {
  const label = (keyword || "Meaning").trim();

  return (
    <figure className="insight-art">
      <div className="insight-art-frame">
        <img
          src={src}
          alt={`Shan shui landscape — ${label}`}
          loading="eager"
          decoding="async"
          style={filter ? { filter } : undefined}
        />
        <div className="insight-caption-bar">
          <p className="insight-caption-line">
            Same{" "}
            <span className="insight-keyword-pill">{label}</span>
            . One party. One disappearance.
          </p>
        </div>
      </div>
    </figure>
  );
}
