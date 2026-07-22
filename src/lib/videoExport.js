import { clipAtTime, getClipTrim, mediaTimeFromLocalT } from "./bgTimeline.js";
import { groupIntoLines, indexForTime, lineIndexForWord } from "./lyrics.js";

/**
 * Export quality / destination presets.
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
 * Export karaoke video.
 *
 * Length is hard-capped to the song duration (wall-clock timeout + audio ended).
 * Background videos play/loop — we never seek every frame (that caused freezes/glitches).
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
  /** Fade from black at start (seconds). 0 = off */
  fadeInSec = 0,
  /** Fade to black at end (seconds). 0 = off */
  fadeOutSec = 0,
  onProgress,
  signal,
}) {
  const fadeIn = Math.max(0, Math.min(8, Number(fadeInSec) || 0));
  const fadeOut = Math.max(0, Math.min(8, Number(fadeOutSec) || 0));
  /** @type {import('./bgTimeline.js').BgClip[]} */
  let clips = Array.isArray(bgClips)
    ? bgClips.filter((c) => c?.url).map((c) => ({ ...c }))
    : [];
  if (!clips.length && videoUrl) {
    clips = [{ id: "v0", type: "video", url: videoUrl, name: "video", durationSec: 8 }];
  }
  if (!clips.length) {
    const urls = (imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : []).filter(
      Boolean
    );
    clips = urls.map((url, i) => ({
      id: `img${i}`,
      type: "image",
      url,
      name: `image-${i}`,
      durationSec: Math.max(1, Number(slideSec) || 5),
    }));
  }
  if (!clips.length) throw new Error("Background image or video is required for export");
  if (!audioUrl) throw new Error("Audio is required for export");
  if (!words?.length) throw new Error("Timed lyrics are required for export");

  const timedWords = words
    .map((w) => ({
      text: String(w.text || "").trim(),
      start: Number(w.start),
      end: Number(w.end),
      line: w.line,
      cueIndex: w.cueIndex,
    }))
    .filter((w) => w.text && Number.isFinite(w.start) && w.start >= 0 && w.start < 1e6)
    .map((w) => ({
      ...w,
      end: Number.isFinite(w.end) && w.end > w.start ? w.end : w.start + 0.35,
    }))
    .sort((a, b) => a.start - b.start);

  if (!timedWords.length) throw new Error("No valid timed lyrics to export");

  let format = resolveExportFormat({ preferMp4, forceM4v });
  const mimeType = format.mimeType;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas 2D not available");

  /** @type {Map<string, HTMLImageElement|HTMLVideoElement>} */
  const mediaCache = new Map();

  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (clip.type === "video") {
      const v = await loadVideo(clip.url);
      mediaCache.set(clip.id, v);
      const nat =
        Number.isFinite(v.duration) && v.duration > 0.2
          ? Math.min(600, v.duration)
          : 8;
      if (!Number.isFinite(clip.sourceDurationSec) || clip.sourceDurationSec < 0.5) {
        clip.sourceDurationSec = nat;
      }
      if (!Number.isFinite(clip.trimEndSec) || clip.trimEndSec <= 0) {
        clip.trimStartSec = Number(clip.trimStartSec) || 0;
        clip.trimEndSec = clip.sourceDurationSec;
      }
      if (!Number.isFinite(clip.durationSec) || clip.durationSec < 0.5) {
        const { length } = getClipTrim(clip);
        clip.durationSec = length;
      }
    } else {
      mediaCache.set(clip.id, await loadImage(clip.url));
      if (!Number.isFinite(clip.durationSec) || clip.durationSec < 0.5) {
        clip.durationSec = Math.max(1, Number(slideSec) || 5);
      }
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Decode audio for reliable duration (HTMLAudioElement.duration is often wrong)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let duration = 0;
  let audioBuffer = null;
  try {
    const res = await fetch(audioUrl);
    const ab = await res.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(ab.slice(0));
    duration = audioBuffer.duration;
  } catch {
    /* fall through to element duration */
  }

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.loop = false;
  audio.src = audioUrl;
  await waitForAudio(audio);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (!Number.isFinite(duration) || duration <= 0.05) {
    duration = Number(audio.duration);
  }
  if (!Number.isFinite(duration) || duration <= 0.05) {
    const last = timedWords[timedWords.length - 1];
    duration = (last?.end || last?.start || 60) + 1;
  }
  // Absolute safety cap: never export more than 12 minutes of wall clock
  // (also prevents 35-minute runaway files)
  const MAX_EXPORT_SEC = 12 * 60;
  duration = Math.min(duration, MAX_EXPORT_SEC);

  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  // Export gain (for fade in/out on the recorded track)
  const exportGain = audioCtx.createGain();
  exportGain.gain.value = fadeIn > 0 ? 0 : 1;
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0; // no speakers
  source.connect(exportGain);
  exportGain.connect(dest);
  exportGain.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  const canvasStream = canvas.captureStream(fps);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  let recorder;
  try {
    recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond,
    });
  } catch {
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
    recorder.onerror = (e) =>
      reject(e.error || new Error("MediaRecorder failed"));
  });

  let raf = 0;
  let finished = false;
  let activeVideoId = null;
  let hardStopTimer = 0;

  const cleanup = async () => {
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    if (hardStopTimer) clearTimeout(hardStopTimer);
    try {
      if (recorder.state === "recording" || recorder.state === "paused") {
        recorder.stop();
      }
    } catch {
      /* ignore */
    }
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    canvasStream.getTracks().forEach((t) => t.stop());
    dest.stream.getTracks().forEach((t) => t.stop());
    for (const el of mediaCache.values()) {
      if (el instanceof HTMLVideoElement) {
        try {
          el.pause();
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

  const lines = groupIntoLines(timedWords, lyrics);
  const PREVIEW_LEAD = 5;

  const drawCover = (el, sw, sh) => {
    if (!el || !sw || !sh) return;
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    try {
      ctx.drawImage(el, (width - dw) / 2, (height - dh) / 2, dw, dh);
    } catch {
      /* frame not ready */
    }
  };

  /**
   * Smooth BG video: play inside trim In/Out; wrap at Out → In for seamless loop.
   * Seek only on clip switch or when leaving the trim window.
   */
  const ensureBgPlaying = (t) => {
    const hit = clipAtTime(clips, t);
    if (!hit) return null;
    const el = mediaCache.get(hit.clip.id);
    if (!el) return null;

    if (hit.clip.type === "video" && el instanceof HTMLVideoElement) {
      el.muted = true;
      el.playsInline = true;
      el.loop = false; // wrap ourselves at trim bounds
      const { start, end } = getClipTrim(hit.clip);
      const mediaTime =
        hit.mediaTime ?? mediaTimeFromLocalT(hit.clip, hit.localT || 0);

      if (activeVideoId !== hit.clip.id) {
        if (activeVideoId) {
          const prev = mediaCache.get(activeVideoId);
          if (prev instanceof HTMLVideoElement) {
            try {
              prev.pause();
            } catch {
              /* ignore */
            }
          }
        }
        activeVideoId = hit.clip.id;
        try {
          el.currentTime = Math.min(Math.max(mediaTime, start), end - 0.05);
        } catch {
          /* ignore */
        }
        el.play().catch(() => {});
      } else {
        // Stay inside trim window (seamless loop)
        if (el.currentTime >= end - 0.05 || el.currentTime < start - 0.02) {
          try {
            el.currentTime = start;
          } catch {
            /* ignore */
          }
        } else if (Math.abs((el.currentTime || 0) - mediaTime) > 1.0) {
          // large drift vs song timeline
          try {
            el.currentTime = Math.min(Math.max(mediaTime, start), end - 0.05);
          } catch {
            /* ignore */
          }
        }
        if (el.paused || el.ended) {
          el.play().catch(() => {});
        }
      }
      return { kind: "video", el };
    }

    // Image
    if (activeVideoId) {
      const prev = mediaCache.get(activeVideoId);
      if (prev instanceof HTMLVideoElement) {
        try {
          prev.pause();
        } catch {
          /* ignore */
        }
      }
      activeVideoId = null;
    }
    if (el instanceof HTMLImageElement) return { kind: "image", el };
    return null;
  };

  const drawFrame = (t) => {
    const media = ensureBgPlaying(t);

    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, width, height);

    if (media?.kind === "video") {
      drawCover(
        media.el,
        media.el.videoWidth || width,
        media.el.videoHeight || height
      );
    } else if (media?.kind === "image") {
      drawCover(media.el, media.el.naturalWidth, media.el.naturalHeight);
    }

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

    const barH = height * 0.2;
    const barY = height - barH;
    const barGrad = ctx.createLinearGradient(0, barY, 0, height);
    barGrad.addColorStop(0, "rgba(7,10,18,0.12)");
    barGrad.addColorStop(0.35, "rgba(7,10,18,0.72)");
    barGrad.addColorStop(1, "rgba(7,10,18,0.92)");
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, barY, width, barH);
    ctx.fillStyle = "rgba(232,160,191,0.35)";
    ctx.fillRect(0, barY, width, Math.max(2, height * 0.002));

    const firstStart = timedWords[0]?.start;
    const active = indexForTime(timedWords, t);

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
      drawLyricLine(ctx, lines[0], -1, width, height, barY, barH, {
        fontFamily,
        fontWeight,
        highlightHex,
        highlightGlow,
      });
    } else if (Number.isFinite(firstStart) && t < firstStart - PREVIEW_LEAD) {
      const fontSize = Math.max(28, Math.min(height * 0.05, width / 24));
      ctx.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 0;
      ctx.fillText("···", width / 2, barY + barH * 0.52);
      ctx.textAlign = "left";
    }

    const pct = Math.min(1, Math.max(0, t / duration));
    ctx.fillStyle = "rgba(201,168,76,0.9)";
    ctx.fillRect(
      0,
      height - Math.max(3, height * 0.0025),
      width * pct,
      Math.max(3, height * 0.0025)
    );

    // Fade in / fade out (black overlay + audio gain)
    let fadeAlpha = 0;
    let audioLevel = 1;
    if (fadeIn > 0 && t < fadeIn) {
      const u = Math.max(0, Math.min(1, t / fadeIn));
      fadeAlpha = 1 - u;
      audioLevel = u;
    }
    if (fadeOut > 0 && t > duration - fadeOut) {
      const u = Math.max(0, Math.min(1, (duration - t) / fadeOut));
      fadeAlpha = Math.max(fadeAlpha, 1 - u);
      audioLevel = Math.min(audioLevel, u);
    }
    if (fadeAlpha > 0.001) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fadeAlpha)})`;
      ctx.fillRect(0, 0, width, height);
    }
    try {
      exportGain.gain.value = Math.max(0, Math.min(1, audioLevel));
    } catch {
      /* ignore */
    }
  };

  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();

    audio.loop = false;
    audio.currentTime = 0;
    drawFrame(0);

    // Start recording + playback together
    recorder.start(250);
    const recordStartedAt = performance.now();

    try {
      await audio.play();
    } catch {
      throw new Error(
        "Could not start audio for export. Click the page once, then export again."
      );
    }

    // HARD STOP: MediaRecorder records wall-clock time.
    // Always stop after song duration + small pad, no matter what audio.currentTime says.
    const hardMs = Math.ceil(duration * 1000) + 400;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        if (hardStopTimer) clearTimeout(hardStopTimer);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbortSig);
        resolve();
      };

      const onEnded = () => finish();
      const onError = () => {
        settled = true;
        finished = true;
        reject(new Error("Audio failed during export"));
      };
      const onAbortSig = () => {
        settled = true;
        finished = true;
        reject(new DOMException("Aborted", "AbortError"));
      };

      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbortSig, { once: true });

      hardStopTimer = setTimeout(finish, hardMs);

      const tick = () => {
        if (finished || settled || signal?.aborted) {
          finish();
          return;
        }

        // Elapsed wall clock (authoritative for progress + stop)
        const wallElapsed = (performance.now() - recordStartedAt) / 1000;
        // Prefer audio clock when it's advancing; clamp to duration
        let t = audio.currentTime;
        if (!Number.isFinite(t) || t < 0) t = 0;
        // If audio clock is stuck far behind wall, use wall (keeps BG/lyrics moving)
        // but never invent time past the song duration
        if (audio.paused && !audio.ended) {
          audio.play().catch(() => {});
        }
        if (t < wallElapsed - 0.75 && wallElapsed < duration) {
          // audio lagging — use min so we don't overshoot
          t = Math.min(duration, Math.max(t, wallElapsed * 0.98));
        }
        t = Math.min(t, duration);

        if (wallElapsed >= duration || audio.ended || t >= duration - 0.01) {
          drawFrame(duration);
          onProgress?.(1);
          finish();
          return;
        }

        drawFrame(t);
        onProgress?.(Math.min(0.99, wallElapsed / duration));
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    });

    // Freeze last frame, stop audio immediately so no silence is encoded
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    try {
      drawFrame(duration);
    } catch {
      /* ignore */
    }
    onProgress?.(1);

    // Tiny drain for encoder, then stop recorder ASAP
    await sleep(120);
    if (recorder.state === "recording") {
      recorder.stop();
    }
    await stopped;

    const blob = new Blob(chunks, { type: format.mimeType || "video/webm" });

    // Detach without waiting on full cleanup path delays
    signal?.removeEventListener("abort", onAbort);
    await cleanup();

    return {
      blob,
      mimeType: format.mimeType,
      ext: format.ext,
      width,
      height,
      isMp4: format.isMp4,
      duration,
    };
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    await cleanup();
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
    let color = "rgba(255,255,255,0.48)";
    let shadow = "transparent";
    let shadowBlur = 0;

    if (activeIndex >= 0 && globalIndex < activeIndex) {
      color = "rgba(255,255,255,0.85)";
      shadow = "rgba(255,255,255,0.15)";
      shadowBlur = fontSize * 0.12;
    } else if (activeIndex >= 0 && globalIndex === activeIndex) {
      color = highlightHex;
      shadow = highlightGlow;
      shadowBlur = fontSize * 0.5;
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
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      v.removeEventListener("error", onErr);
      if (ok) resolve(v);
      else reject(new Error("Failed to load background video"));
    };
    const onReady = () => {
      try {
        v.pause();
        v.currentTime = 0;
      } catch {
        /* ignore */
      }
      done(true);
    };
    const onErr = () => done(false);
    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    v.addEventListener("error", onErr);
    setTimeout(() => {
      if (v.readyState >= 2) onReady();
    }, 3000);
    v.src = url;
    v.load();
  });
}

function waitForAudio(audio) {
  return new Promise((resolve, reject) => {
    if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
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
    setTimeout(() => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) onReady();
      else if (audio.readyState >= 1) onReady();
    }, 6000);
    audio.load();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
