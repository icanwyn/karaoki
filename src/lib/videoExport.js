import { clipAtTime } from "./bgTimeline.js";
import { groupIntoLines, indexForTime, lineIndexForWord } from "./lyrics.js";

/**
 * Export quality / destination presets.
 * - YouTube accepts high-bitrate WebM and MP4
 * - X prefers H.264 MP4 / M4V (used when the browser can record MP4)
 */
export const EXPORT_PRESETS = [
  {
    id: "hd720",
    label: "720p HD",
    blurb: "Fast · good for X drafts",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 192_000,
    preferMp4: true,
    extHint: "mp4",
  },
  {
    id: "youtube1080",
    label: "1080p YouTube",
    blurb: "Recommended · Full HD",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 16_000_000,
    audioBitsPerSecond: 256_000,
    preferMp4: true,
    extHint: "mp4",
  },
  {
    id: "x1080",
    label: "1080p for X",
    blurb: "MP4/M4V when browser allows",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 192_000,
    preferMp4: true,
    forceM4v: true,
    extHint: "m4v",
  },
  {
    id: "youtube4k",
    label: "4K Ultra",
    blurb: "Max quality · large file",
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitsPerSecond: 45_000_000,
    audioBitsPerSecond: 320_000,
    preferMp4: true,
    extHint: "mp4",
  },
];

export function getExportPreset(id) {
  return EXPORT_PRESETS.find((p) => p.id === id) || EXPORT_PRESETS[1];
}

/**
 * What container the current browser can actually record.
 * @param {{ preferMp4?: boolean }} [opts]
 * @returns {{ mimeType: string, ext: 'mp4'|'m4v'|'webm', isMp4: boolean }}
 */
export function resolveExportFormat(opts = {}) {
  const preferMp4 = opts.preferMp4 !== false;
  const forceM4v = Boolean(opts.forceM4v);

  if (preferMp4) {
    const mp4 = pickMp4MimeType();
    if (mp4) {
      return {
        mimeType: mp4,
        ext: forceM4v ? "m4v" : "mp4",
        isMp4: true,
      };
    }
  }

  const webm = pickWebmMimeType();
  return {
    mimeType: webm,
    ext: "webm",
    isMp4: false,
  };
}

/**
 * Export a karaoke video by drawing frames to canvas and muxing with audio.
 *
 * @param {Object} opts
 * @param {string} opts.imageUrl
 * @param {string} opts.audioUrl
 * @param {{ text: string, start: number, end: number }[]} opts.words
 * @param {string} [opts.lyrics]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.fps]
 * @param {number} [opts.videoBitsPerSecond]
 * @param {number} [opts.audioBitsPerSecond]
 * @param {boolean} [opts.preferMp4]
 * @param {boolean} [opts.forceM4v]
 * @param {(p: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ blob: Blob, mimeType: string, ext: string, width: number, height: number, isMp4: boolean }>}
 */
export async function exportKaraokeVideo({
  imageUrl,
  imageUrls = null,
  videoUrl = null,
  /** @type {import('./bgTimeline.js').BgClip[]|null} */
  bgClips = null,
  slideSec = 5,
  audioUrl,
  words,
  lyrics = "",
  width = 1920,
  height = 1080,
  fps = 30,
  videoBitsPerSecond = 16_000_000,
  audioBitsPerSecond = 256_000,
  preferMp4 = true,
  forceM4v = false,
  fontFamily = "Space Grotesk",
  fontWeight = "600",
  highlightHex = "#e8a0bf",
  highlightGlow = "rgba(232, 160, 191, 0.9)",
  onProgress,
  signal,
}) {
  // Normalize to a clip timeline
  /** @type {import('./bgTimeline.js').BgClip[]} */
  let clips = Array.isArray(bgClips) ? bgClips.filter((c) => c?.url) : [];
  if (!clips.length && videoUrl) {
    clips = [{ id: "v0", type: "video", url: videoUrl, name: "video", durationSec: 8 }];
  }
  if (!clips.length) {
    const urls = (imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : []).filter(Boolean);
    clips = urls.map((url, i) => ({
      id: `img${i}`,
      type: "image",
      url,
      name: `image-${i}`,
      durationSec: Math.max(1, Number(slideSec) || 5),
    }));
  }
  if (!clips.length) {
    throw new Error("Background image or video is required for export");
  }
  if (!audioUrl) throw new Error("Audio is required for export");
  if (!words?.length) throw new Error("Timed lyrics are required for export");

  let format = resolveExportFormat({ preferMp4, forceM4v });
  const mimeType = format.mimeType;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D not available");

  /** @type {Map<string, HTMLImageElement|HTMLVideoElement>} */
  const mediaCache = new Map();

  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (clip.type === "video") {
      const v = await loadVideo(clip.url);
      mediaCache.set(clip.id, v);
      // Prefer real video length when available
      if (Number.isFinite(v.duration) && v.duration > 0.2) {
        clip.durationSec = Math.min(600, v.duration);
      }
    } else {
      mediaCache.set(clip.id, await loadImage(clip.url));
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.muted = true; // silent export — no speakers
  audio.volume = 0;
  audio.src = audioUrl;

  await waitForAudio(audio);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (duration <= 0) throw new Error("Could not determine audio duration");

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // Unmute element for WebAudio graph only — still not connected to speakers
  audio.muted = false;
  audio.volume = 1;
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0; // hard-mute any accidental speaker path
  source.connect(dest);
  source.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  const canvasStream = canvas.captureStream(fps);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  // Cap bitrate on low-end devices if MediaRecorder rejects huge values
  const recorderOpts = {
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond,
  };

  let recorder;
  try {
    recorder = new MediaRecorder(combined, recorderOpts);
  } catch {
    // Retry with safer bitrate / mime
    const fallback = pickWebmMimeType();
    recorder = new MediaRecorder(combined, {
      mimeType: fallback,
      videoBitsPerSecond: Math.min(videoBitsPerSecond, 12_000_000),
      audioBitsPerSecond: 192_000,
    });
    format.mimeType = fallback;
    format.ext = "webm";
    format.isMp4 = false;
  }

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
    for (const el of mediaCache.values()) {
      if (el instanceof HTMLVideoElement) {
        try {
          el.pause();
          el.removeAttribute("src");
          el.load();
        } catch {
          /* ignore */
        }
      }
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

  const drawCoverMedia = (sourceEl, sw, sh) => {
    if (!sourceEl || !sw || !sh) return;
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.drawImage(sourceEl, dx, dy, dw, dh);
  };

  let activeVideoId = null;

  const pauseAllVideos = () => {
    for (const el of mediaCache.values()) {
      if (el instanceof HTMLVideoElement) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      }
    }
    activeVideoId = null;
  };

  /** Seek video and wait for the frame (prevents freeze at clip end ~7s). */
  const seekVideo = (video, timeSec) =>
    new Promise((resolve) => {
      if (!video) {
        resolve();
        return;
      }
      const dur = Number.isFinite(video.duration) && video.duration > 0.05
        ? video.duration
        : null;
      let target = Math.max(0, timeSec || 0);
      if (dur) {
        // Loop within natural media length if hold is longer than file
        target = target % dur;
        if (target >= dur - 0.04) target = Math.max(0, dur - 0.05);
      }
      if (Math.abs((video.currentTime || 0) - target) < 0.04) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener("seeked", finish);
        video.removeEventListener("error", finish);
        resolve();
      };
      video.addEventListener("seeked", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      try {
        video.pause();
        video.currentTime = target;
      } catch {
        finish();
        return;
      }
      // Safety timeout if seeked never fires
      setTimeout(finish, 400);
    });

  const prepareBackground = async (t) => {
    const hit = clipAtTime(clips, t);
    if (!hit) {
      pauseAllVideos();
      return null;
    }
    const el = mediaCache.get(hit.clip.id);
    if (!el) return null;

    if (hit.clip.type === "video" && el instanceof HTMLVideoElement) {
      el.muted = true;
      el.playsInline = true;
      el.loop = false; // we control looping via localT % duration
      if (activeVideoId !== hit.clip.id) {
        pauseAllVideos();
        activeVideoId = hit.clip.id;
      }
      await seekVideo(el, hit.localT);
      return { kind: "video", el };
    }

    pauseAllVideos();
    if (el instanceof HTMLImageElement) {
      return { kind: "image", el };
    }
    return null;
  };

  const drawBackground = (media) => {
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, width, height);
    if (!media) return;
    if (media.kind === "video") {
      drawCoverMedia(
        media.el,
        media.el.videoWidth || width,
        media.el.videoHeight || height
      );
    } else if (media.kind === "image") {
      drawCoverMedia(media.el, media.el.naturalWidth, media.el.naturalHeight);
    }
  };

  const PREVIEW_LEAD = 5;

  const drawFrame = (t, media) => {
    drawBackground(media);

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
    grad.addColorStop(1, "rgba(7,10,18,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // lyric bar bottom 20%
    const barH = height * 0.2;
    const barY = height - barH;
    const barGrad = ctx.createLinearGradient(0, barY, 0, height);
    barGrad.addColorStop(0, "rgba(7,10,18,0.12)");
    barGrad.addColorStop(0.35, "rgba(7,10,18,0.72)");
    barGrad.addColorStop(1, "rgba(7,10,18,0.92)");
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, barY, width, barH);

    // soft sakura hairline
    ctx.fillStyle = "rgba(232,160,191,0.35)";
    ctx.fillRect(0, barY, width, Math.max(2, height * 0.002));

    const firstStart = words[0]?.start;
    const active = indexForTime(words, t);

    if (active >= 0) {
      const lineIdx = lineIndexForWord(lines, active);
      const line = lineIdx >= 0 ? lines[lineIdx] : null;
      if (line?.words?.length) {
        drawLyricLine(ctx, line, active, width, height, barY, barH, {
          fontFamily,
          fontWeight,
          highlightHex,
          highlightGlow,
        });
      }
    } else if (
      Number.isFinite(firstStart) &&
      t >= firstStart - PREVIEW_LEAD &&
      t < firstStart - 0.02 &&
      lines[0]?.words?.length
    ) {
      // 5s intro: first line only, all upcoming (dim)
      drawLyricLine(ctx, lines[0], -1, width, height, barY, barH, {
        fontFamily,
        fontWeight,
        highlightHex,
        highlightGlow,
      });
    } else if (
      Number.isFinite(firstStart) &&
      t < firstStart - PREVIEW_LEAD
    ) {
      // ··· only
      const fontSize = Math.max(28, Math.min(height * 0.05, width / 24));
      ctx.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 0;
      ctx.fillText("···", width / 2, barY + barH * 0.52);
      ctx.textAlign = "left";
    }

    // progress tick
    const pct = Math.min(1, t / duration);
    ctx.fillStyle = "rgba(201,168,76,0.9)";
    ctx.fillRect(
      0,
      height - Math.max(3, height * 0.0025),
      width * pct,
      Math.max(3, height * 0.0025)
    );
  };

  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Silent realtime capture: audio graph only feeds MediaRecorder
    recorder.start(250);
    await audio.play();

    // Drive by wall clock synced to muted audio — avoids video.play() freezes
    const wallStart = performance.now();
    const audioStart = audio.currentTime || 0;

    await new Promise((resolve, reject) => {
      const onAbortSig = () =>
        reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", onAbortSig, { once: true });

      const step = async () => {
        if (finished || signal?.aborted) {
          signal?.removeEventListener("abort", onAbortSig);
          resolve();
          return;
        }

        // Prefer audio clock when available; fall back to wall clock
        let t = audio.currentTime || 0;
        if (!Number.isFinite(t) || t < 0) t = 0;
        // If audio stalls, keep advancing from wall clock
        const wallT = audioStart + (performance.now() - wallStart) / 1000;
        if (audio.paused || Math.abs(wallT - t) > 1.25) {
          t = Math.min(duration, wallT);
          try {
            if (Math.abs((audio.currentTime || 0) - t) > 0.35) {
              audio.currentTime = t;
            }
            if (audio.paused) await audio.play().catch(() => {});
          } catch {
            /* ignore */
          }
        }

        if (t >= duration - 0.04 || audio.ended) {
          try {
            const media = await prepareBackground(duration);
            drawFrame(duration, media);
          } catch {
            drawFrame(duration, null);
          }
          onProgress?.(1);
          signal?.removeEventListener("abort", onAbortSig);
          resolve();
          return;
        }

        try {
          const media = await prepareBackground(t);
          drawFrame(t, media);
        } catch {
          drawFrame(t, null);
        }
        onProgress?.(Math.min(0.99, t / duration));

        // ~fps pacing; async seeks may take longer — that's ok
        raf = requestAnimationFrame(() => {
          step().catch(reject);
        });
      };

      step().catch(reject);
    });

    await sleep(320);
    if (recorder.state === "recording") recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: format.mimeType || "video/webm" });
    await cleanup();
    signal?.removeEventListener("abort", onAbort);
    return {
      blob,
      mimeType: format.mimeType,
      ext: format.ext,
      width,
      height,
      isMp4: format.isMp4,
    };
  } catch (err) {
    await cleanup();
    signal?.removeEventListener("abort", onAbort);
    throw err;
  }
}

function drawLyricLine(
  ctx,
  line,
  activeIndex,
  width,
  height,
  barY,
  barH,
  style = {}
) {
  const {
    fontFamily = "Space Grotesk",
    fontWeight = "600",
    highlightHex = "#e8a0bf",
    highlightGlow = "rgba(232, 160, 191, 0.9)",
  } = style;
  // Calligraphy scripts need a bit more size to stay readable
  const isScript = /Great Vibes|Ma Shan Zheng|Pacifico|Caveat/i.test(fontFamily);
  const fontSize = Math.max(
    28,
    Math.min(height * (isScript ? 0.058 : 0.048), width / (isScript ? 22 : 26))
  );
  ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Inter", system-ui, sans-serif`;
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
    let color = "rgba(255,255,255,0.42)";
    let shadow = "transparent";
    let shadowBlur = 0;

    if (globalIndex < activeIndex) {
      color = "rgba(255,255,255,0.78)";
      shadow = "rgba(255,255,255,0.2)";
      shadowBlur = fontSize * 0.2;
    } else if (globalIndex === activeIndex) {
      color = highlightHex;
      shadow = highlightGlow;
      shadowBlur = fontSize * 0.5;
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

function pickMp4MimeType() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return null;
}

function pickWebmMimeType() {
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

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.loop = true;
    const onReady = () => {
      cleanup();
      // Decode first frame
      v.pause();
      v.currentTime = 0;
      resolve(v);
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Failed to load background video"));
    };
    const cleanup = () => {
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      v.removeEventListener("error", onErr);
    };
    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    v.addEventListener("error", onErr);
    v.src = url;
    v.load();
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
