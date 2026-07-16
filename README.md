# Way of Life — A Library of Meaning

A beautifully designed digital library curating **100 essential books** on how to live with more meaning. Each volume opens into a Japanese ink-and-washi reader with **10 story-form insights** distilled from the work.

## Design

- **Apple glass**: frosted translucent panels, soft blur, quiet chrome
- **Japanese rice paper**: washi texture, sumi ink, vermillion seal accents
- Books arranged on wooden shelves by theme; click a spine to open the reader

## Stack

- React 18 + Vite
- Static content (no backend required)
- Deployable on Vercel as a static SPA

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Project structure

```
src/
  App.jsx                 # Library shell, search, shelves
  components/
    Bookshelf.jsx         # Shelf row of spines
    BookSpine.jsx         # Individual book spine
    BookReader.jsx        # Cover + insight pages
  data/
    books.js              # Aggregates all volumes
    books-1-25.js         # Content batches
    ...
public/images/            # Imagine-generated art assets
```

## License

Content is original paraphrased literary essence for educational curation. Book titles and authors remain the property of their respective rights holders.
