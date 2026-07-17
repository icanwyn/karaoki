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
3. **Get lyrics + auto-sync**
   - **✦ Auto lyrics from song** — transcribes vocals and stamps each word to the audio.
     - With `OPENAI_API_KEY` set (Vercel env or `.env.local`), uses server Whisper.
     - Without a key, uses **on-device Whisper** in the browser (first run downloads the model).
   - Or **paste lyrics** / LRC, then **Parse LRC** or **Auto-time**.
4. **Refine timings** (optional)
   - **Tap Sync** — Start sync, press `Space` on each word as you hear it. The stage stays locked to the current line (no racing words). `Esc` stops.
   - **Offset** — nudge all timings with the global offset slider.
5. **Play** — words light up (hot pink / cyan glow) in the lyric bar on the bottom 20% of the stage.
6. **Export** — records stage + audio to a downloadable **WebM** (VP8/VP9 + Opus when supported).
7. **Share** — copy a project link with title, lyrics, timings, and stock backdrop id. Recipients re-upload audio/image (media is not embedded in the URL).

Projects also auto-save metadata to `localStorage`.

### Notes on auto lyrics

- Works best with **clear vocals** (karaoke / acapella / lightly mixed tracks). Heavy instrumentals reduce accuracy.
- Browser model is English-optimized (`whisper-base.en`). For other languages, set `OPENAI_API_KEY` for multilingual Whisper.
- Server uploads are limited to ~24MB.

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
