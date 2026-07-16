function isLightColor(hex) {
  if (!hex || !hex.startsWith("#")) return false;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

export default function BookSpine({ book, onOpen }) {
  const light = isLightColor(book.color);

  return (
    <button
      type="button"
      className={`book-spine${light ? " light" : ""}`}
      style={{ backgroundColor: book.color }}
      onClick={() => onOpen(book)}
      aria-label={`Open ${book.title} by ${book.author}`}
      title={`${book.title} — ${book.author}`}
    >
      <span className="spine-accent" aria-hidden="true" />
      <span className="spine-band top" aria-hidden="true" />
      <span className="spine-title">{book.title}</span>
      <span className="spine-band bottom" aria-hidden="true" />
    </button>
  );
}
