import { groupIntoLines, indexForTime, lineIndexForWord } from "./lyrics.js";

/**
 * Export a karaoke WebM by drawing frames to canvas and muxing with audio.
 *
 * @param {Object} opts
 * @param {string} opts.imageUrl
 * @param {string} opts.audioUrl
 * @param {{ text: string, start: number, end: number }[]} opts.words
 * @param {string} [opts.lyrics]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {(p: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Blob>}
 */
export async function exportKaraokeVideo({
  imageUrl,
  audioUrl,
  words,
  lyrics = "",
  width = 1280,
  height = 720,
  onProgress,
  signal,
}) {
  if (!imageUrl) throw new Error("Background image is required for export");
  if (!audioUrl) throw new Error("Audio is required for export");
  if (!words?.length) throw new Error("Timed lyrics are required for export");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  const img = await loadImage(imageUrl);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = audioUrl;

  await waitForAudio(audio);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (duration <= 0) throw new Error("Could not determine audio duration");

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  // Keep audible during export so user can monitor (optional)
  source.connect(audioCtx.destination);

  const fps = 30;
  const canvasStream = canvas.captureStream(fps);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000,
  });

  /** @type {BlobPart[]} */
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (e) => reject(e.error || new Error("MediaRecorder failed"));
  });

  let raf = 0;
  let finished = false;

  const cleanup = async () => {
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    canvasStream.getTracks().forEach((t) => t.stop());
    dest.stream.getTracks().forEach((t) => t.stop());
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    if (audioCtx.state !== "closed") {
      try {
        await audioCtx.close();
      } catch {
        /* ignore */
      }
    }
  };

  const onAbort = () => {
    cleanup();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const lines = groupIntoLines(words, lyrics);

  const drawFrame = (t) => {
    // cover-fit image
    const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.fillStyle = "#0a0612";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, dx, dy, dw, dh);

    // vignette
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.2,
      width / 2,
      height / 2,
      height * 0.85
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(10,6,18,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // lyric bar bottom 20%
    const barH = height * 0.2;
    const barY = height - barH;
    const barGrad = ctx.createLinearGradient(0, barY, 0, height);
    barGrad.addColorStop(0, "rgba(8,4,16,0.15)");
    barGrad.addColorStop(0.35, "rgba(8,4,16,0.72)");
    barGrad.addColorStop(1, "rgba(8,4,16,0.92)");
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, barY, width, barH);

    // top accent line
    ctx.fillStyle = "rgba(255,45,149,0.35)";
    ctx.fillRect(0, barY, width, 2);

    const active = indexForTime(words, t);
    const lineIdx = lineIndexForWord(lines, active);
    const line = lines[lineIdx];
    if (line?.words?.length) {
      drawLyricLine(ctx, line, active, width, barY, barH);
    }

    // progress tick
    const pct = Math.min(1, t / duration);
    ctx.fillStyle = "rgba(45,226,230,0.85)";
    ctx.fillRect(0, height - 3, width * pct, 3);
  };

  const tick = () => {
    if (finished || signal?.aborted) return;
    const t = audio.currentTime || 0;
    drawFrame(t);
    onProgress?.(Math.min(0.99, t / duration));
    if (!audio.ended && !audio.paused) {
      raf = requestAnimationFrame(tick);
    }
  };

  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();
    drawFrame(0);
    recorder.start(250);
    await audio.play();
    raf = requestAnimationFrame(tick);

    await new Promise((resolve, reject) => {
      const onEnded = () => resolve();
      const onError = () => reject(new Error("Audio playback failed during export"));
      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      if (signal) {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      }
    });

    // Final frame
    drawFrame(duration);
    onProgress?.(1);

    // Small drain so last frames encode
    await sleep(200);
    if (recorder.state === "recording") recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    await cleanup();
    signal?.removeEventListener("abort", onAbort);
    return blob;
  } catch (err) {
    await cleanup();
    signal?.removeEventListener("abort", onAbort);
    throw err;
  }
}

function drawLyricLine(ctx, line, activeIndex, width, barY, barH) {
  const fontSize = Math.max(28, Math.min(48, width / 28));
  ctx.font = `700 ${fontSize}px "Space Grotesk", "Inter", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const gap = fontSize * 0.35;
  const metrics = line.words.map((w) => ctx.measureText(w.text).width);
  const total =
    metrics.reduce((a, b) => a + b, 0) + gap * Math.max(0, line.words.length - 1);
  let x = (width - total) / 2;
  const y = barY + barH * 0.52;

  line.words.forEach((w, i) => {
    const globalIndex = line.startIndex + i;
    let color = "rgba(255,255,255,0.45)";
    let shadow = "transparent";
    let shadowBlur = 0;

    if (globalIndex < activeIndex) {
      color = "rgba(255,255,255,0.72)";
      shadow = "rgba(255,255,255,0.25)";
      shadowBlur = 8;
    } else if (globalIndex === activeIndex) {
      color = "#ff2d95";
      shadow = "rgba(45,226,230,0.95)";
      shadowBlur = 22;
    } else {
      color = "rgba(255,255,255,0.4)";
    }

    ctx.shadowColor = shadow;
    ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = color;
    ctx.fillText(w.text, x, y);
    x += metrics[i] + gap;
  });

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load background image"));
    img.src = url;
  });
}

function waitForAudio(audio) {
  return new Promise((resolve, reject) => {
    if (audio.readyState >= 2 && Number.isFinite(audio.duration)) {
      resolve();
      return;
    }
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Failed to load audio for export"));
    };
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("loadedmetadata", onReady);
      audio.removeEventListener("error", onErr);
    };
    audio.addEventListener("canplaythrough", onReady);
    audio.addEventListener("loadedmetadata", onReady);
    audio.addEventListener("error", onErr);
    audio.load();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
