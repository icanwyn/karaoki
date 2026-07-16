import BookSpine from "./BookSpine.jsx";

export default function Bookshelf({ title, books, onOpenBook }) {
  if (!books.length) return null;

  return (
    <section className="bookshelf" aria-labelledby={`shelf-${title}`}>
      <div className="shelf-header">
        <h2 className="shelf-title" id={`shelf-${title}`}>
          <span aria-hidden="true" />
          {title}
        </h2>
        <span className="shelf-count">
          {books.length} {books.length === 1 ? "volume" : "volumes"}
        </span>
      </div>
      <div className="shelf-row">
        <div className="books-row" role="list">
          {books.map((book) => (
            <div key={book.id} role="listitem">
              <BookSpine book={book} onOpen={onOpenBook} />
            </div>
          ))}
        </div>
        <div className="shelf-plank" aria-hidden="true" />
      </div>
    </section>
  );
}
