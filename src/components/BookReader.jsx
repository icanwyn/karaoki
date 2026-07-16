import { useEffect, useCallback } from "react";

export default function BookReader({ book, page, onPageChange, onClose }) {
  const totalInsights = book.insights?.length || 0;
  // page 0 = cover, 1..N = insights
  const maxPage = totalInsights;
  const isCover = page === 0;
  const insight = !isCover ? book.insights[page - 1] : null;

  const goPrev = useCallback(() => {
    onPageChange(Math.max(0, page - 1));
  }, [page, onPageChange]);

  const goNext = useCallback(() => {
    onPageChange(Math.min(maxPage, page + 1));
  }, [page, maxPage, onPageChange]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goPrev, goNext]);

  return (
    <div
      className="reader-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${book.title} by ${book.author}`}
    >
      <div className="reader">
        <div className="reader-top">
          <span className="reader-nav-label">
            {isCover
              ? "Frontispiece"
              : `Insight ${page} of ${totalInsights}`}
          </span>
          <button
            type="button"
            className="reader-close"
            onClick={onClose}
            aria-label="Close book"
          >
            ×
          </button>
        </div>

        <div className="reader-body">
          {isCover ? (
            <div className="book-cover">
              <div className="cover-ornament" aria-hidden="true" />
              <p className="cover-shelf">{book.shelf}</p>
              <h2 className="cover-title">{book.title}</h2>
              <p className="cover-author">{book.author}</p>
              <p className="cover-year">{book.year}</p>
              <p className="cover-tagline">“{book.tagline}”</p>
              <div className="cover-art">
                <img
                  src="/images/open-book.jpg"
                  alt=""
                  loading="lazy"
                />
              </div>
              <p className="cover-essence">{book.essence}</p>
              <button
                type="button"
                className="open-btn"
                onClick={() => onPageChange(1)}
              >
                Begin reading →
              </button>
            </div>
          ) : (
            <article className="insight-page" key={page}>
              <p className="insight-number">
                {String(page).padStart(2, "0")}
              </p>
              <h3 className="insight-title">{insight.title}</h3>
              <p className="insight-story">{insight.story}</p>
            </article>
          )}
        </div>

        <div className="reader-footer">
          <button
            type="button"
            className="nav-btn"
            onClick={goPrev}
            disabled={page === 0}
          >
            ← Prev
          </button>

          <div className="page-dots" role="tablist" aria-label="Pages">
            <button
              type="button"
              className={`page-dot cover-dot${page === 0 ? " active" : ""}`}
              onClick={() => onPageChange(0)}
              aria-label="Cover"
              title="Cover"
            />
            {book.insights.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`page-dot${page === i + 1 ? " active" : ""}`}
                onClick={() => onPageChange(i + 1)}
                aria-label={`Insight ${i + 1}`}
                title={`Insight ${i + 1}`}
              />
            ))}
          </div>

          <button
            type="button"
            className="nav-btn"
            onClick={goNext}
            disabled={page >= maxPage}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
