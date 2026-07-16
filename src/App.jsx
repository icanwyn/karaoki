import { useMemo, useState } from "react";
import { books, SHELVES } from "./data/books.js";
import Bookshelf from "./components/Bookshelf.jsx";
import BookReader from "./components/BookReader.jsx";

export default function App() {
  const [query, setQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState("All");
  const [openBook, setOpenBook] = useState(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((b) => {
      const shelfOk = activeShelf === "All" || b.shelf === activeShelf;
      if (!shelfOk) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.tagline.toLowerCase().includes(q) ||
        b.shelf.toLowerCase().includes(q)
      );
    });
  }, [query, activeShelf]);

  const byShelf = useMemo(() => {
    const map = {};
    for (const shelf of SHELVES) map[shelf] = [];
    for (const book of filtered) {
      if (!map[book.shelf]) map[book.shelf] = [];
      map[book.shelf].push(book);
    }
    return map;
  }, [filtered]);

  const shelfCounts = useMemo(() => {
    const counts = { All: books.length };
    for (const shelf of SHELVES) counts[shelf] = 0;
    for (const b of books) {
      counts[b.shelf] = (counts[b.shelf] || 0) + 1;
    }
    return counts;
  }, []);

  function openBookHandler(book) {
    setOpenBook(book);
    setPage(0);
  }

  function closeBook() {
    setOpenBook(null);
    setPage(0);
  }

  return (
    <>
      <header className="site-header">
        <button type="button" className="brand" onClick={() => {
          setQuery("");
          setActiveShelf("All");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-title">Way of Life</span>
            <span className="brand-sub">A library of meaning</span>
          </span>
        </button>

        <div className="header-actions">
          <span className="count-pill">{books.length} volumes</span>
          <div className="search-wrap">
            <span className="search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              placeholder="Search title or author…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search books"
            />
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>
            One hundred books
            <br />
            <em>on how to live</em>
          </h1>
          <p className="lead">
            A quiet digital library of the essential works on meaning, presence,
            and the art of a life well lived — distilled into ten story-shaped
            insights each.
          </p>
          <div className="hero-meta">
            <span className="meta-chip">
              <strong>100</strong>&nbsp;books
            </span>
            <span className="meta-chip">
              <strong>1,000</strong>&nbsp;insights
            </span>
            <span className="meta-chip">Ink · Glass · Washi</span>
          </div>
        </div>
        <div className="hero-art">
          <img
            src="/images/torii-mist.jpg"
            alt="Japanese ink wash of a path through mist"
          />
          <span className="seal" aria-hidden="true">
            道
          </span>
        </div>
      </section>

      <nav className="shelf-nav" aria-label="Shelves">
        {["All", ...SHELVES].map((shelf) => (
          <button
            key={shelf}
            type="button"
            className={`shelf-chip${activeShelf === shelf ? " active" : ""}`}
            onClick={() => setActiveShelf(shelf)}
          >
            {shelf}
            <span className="chip-count">{shelfCounts[shelf] || 0}</span>
          </button>
        ))}
      </nav>

      <main className="library">
        {filtered.length === 0 ? (
          <p className="empty-state">No volumes match your search.</p>
        ) : activeShelf === "All" ? (
          SHELVES.map((shelf) => (
            <Bookshelf
              key={shelf}
              title={shelf}
              books={byShelf[shelf] || []}
              onOpenBook={openBookHandler}
            />
          ))
        ) : (
          <Bookshelf
            title={activeShelf}
            books={byShelf[activeShelf] || []}
            onOpenBook={openBookHandler}
          />
        )}
      </main>

      <footer className="site-footer">
        <p>Live deliberately. Read slowly. Keep what remains.</p>
        <span>Way of Life · A curated library of meaning</span>
      </footer>

      {openBook && (
        <BookReader
          book={openBook}
          page={page}
          onPageChange={setPage}
          onClose={closeBook}
        />
      )}
    </>
  );
}
