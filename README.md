# Karaoki

Modern karaoke studio in the browser. Upload a song and stage image, paste lyrics (or LRC), auto-time or tap-sync words, preview with glowing word highlights, and export a WebM video for YouTube.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build
npm run preview
```

## How to use

1. **Upload audio** — MP3, WAV, M4A, or OGG in the Media panel.
2. **Pick a backdrop** — upload an image or choose a stock neon gradient.
3. **Paste lyrics** — plain text (one phrase per line) or LRC with `[mm:ss.xx]` tags.
4. **Time the words**
   - **Parse LRC** if you pasted timed lyrics.
   - **Auto-time** to spread words evenly across the song duration.
   - **Tap Sync** — Start sync, then press `Space` (or **Tap word**) on each word as you hear it. `Esc` stops sync.
5. **Offset** — nudge all timings with the global offset slider.
6. **Play** — words light up (hot pink / cyan glow) in the lyric bar on the bottom 20% of the stage.
7. **Export** — records stage + audio to a downloadable **WebM** (VP8/VP9 + Opus when supported).
8. **Share** — copy a project link with title, lyrics, timings, and stock backdrop id. Recipients re-upload audio/image (media is not embedded in the URL).

Projects also auto-save metadata to `localStorage`.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Framework: Vite (or leave defaults). Build command: `npm run build`. Output: `dist`.
4. `vercel.json` already rewrites SPA routes to `index.html`.

```bash
npx vercel
```

## Stack

- React 18 + Vite
- Canvas + MediaRecorder export
- Space Grotesk + Inter (Google Fonts)

## Notes

- Export needs a Chromium-based browser with `MediaRecorder` + `captureStream` support.
- Cross-origin media without CORS may fail during export; local file uploads work best.
- Share links can get long for large timed lyric sets; prefer local save for huge projects.
