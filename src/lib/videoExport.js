import { clipAtTime } from "./bgTimeline.js";
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

/**
 * What container the current browser can actually record.
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
 * Export karaoke video: canvas frames + song audio, locked to audio clock.
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
  /** @type {import('./bgTimeline.js').BgClip[]} */
  let clips = Array.isArray(bgClips) ? bgClips.filter((c) => c?.url).map((c) => ({ ...c })) : [];
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
  if (!clips.length) throw new Error("Background image or video is required for export");
  if (!audioUrl) throw new Error("Audio is required for export");
  if (!words?.length) throw new Error("Timed lyrics are required for export");

  // Sort + sanitize word timings for reliable highlight
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

  if (!timedWords.length) {
    throw new Error("No valid timed lyrics to export");
  }

  let format = resolveExportFormat({ preferMp4, forceM4v });
  const mimeType = format.mimeType;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D not available");

  /** @type {Map<string, HTMLImageElement|HTMLVideoElement>} */
  const mediaCache = new Map();
  /** natural media duration for videos (for looping inside a hold slot) */
  const videoNaturalDur = new Map();

  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (clip.type === "video") {
      const v = await loadVideo(clip.url);
      mediaCache.set(clip.id, v);
      const nat =
        Number.isFinite(v.duration) && v.duration > 0.2
          ? Math.min(600, v.duration)
          : 8;
      videoNaturalDur.set(clip.id, nat);
      // Keep user/hold duration; only fill if missing
      if (!Number.isFinite(clip.durationSec) || clip.durationSec < 0.5) {
        clip.durationSec = nat;
      }
    } else {
      mediaCache.set(clip.id, await loadImage(clip.url));
      if (!Number.isFinite(clip.durationSec) || clip.durationSec < 0.5) {
        clip.durationSec = Math.max(1, Number(slideSec) || 5);
      }
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = audioUrl;

  await waitForAudio(audio);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Prefer a finite positive duration; fall back to last lyric + tail
  let duration = Number(audio.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    const last = timedWords[timedWords.length - 1];
    duration = (last?.end || last?.start || 0) + 1.5;
  }
  // Cap runaway metadata (some files report padded length)
  const lastLyricEnd = timedWords[timedWords.length - 1]?.end || 0;
  if (duration > lastLyricEnd + 90 && lastLyricEnd > 30) {
    // keep full audio if intentionally longer, but not wild Infinity-ish
    duration = Math.min(duration, lastLyricEnd + 30);
  }
  if (duration <= 0) throw new Error("Could not determine audio duration");

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  // Route to recorder only — mute speakers
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  source.connect(dest);
  source.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  // Realtime capture at target fps (captureStream(0) is unreliable without requestFrame)
  const canvasStream = canvas.captureStream(fps);
  const videoTrack = canvasStream.getVideoTracks()[0];
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
    recorder.onerror = (e) => reject(e.error || new Error("MediaRecorder failed"));
  });

  let raf = 0;
  let finished = false;
  let activeVideoId = null;

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

  const lines = groupIntoLines(timedWords, lyrics);

  const drawCoverMedia = (sourceEl, sw, sh) => {
    if (!sourceEl || !sw || !sh) return;
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    try {
      ctx.drawImage(sourceEl, dx, dy, dw, dh);
    } catch {
      /* drawImage can throw if frame not ready */
    }
  };

  const pauseAllVideos = (exceptId = null) => {
    for (const [id, el] of mediaCache.entries()) {
      if (id === exceptId) continue;
      if (el instanceof HTMLVideoElement) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      }
    }
  };

  /**
   * Keep background video playing & looping — do NOT seek every frame
   * (seeking every frame freezes decoders around clip end, e.g. ~15s).
   */
  const syncBackground = (t) => {
    const hit = clipAtTime(clips, t);
    if (!hit) {
      pauseAllVideos();
      activeVideoId = null;
      return null;
    }
    const el = mediaCache.get(hit.clip.id);
    if (!el) return null;

    if (hit.clip.type === "video" && el instanceof HTMLVideoElement) {
      el.muted = true;
      el.playsInline = true;
      el.loop = true; // seamless loop for short BGs under long songs
      const nat = videoNaturalDur.get(hit.clip.id) || el.duration || 1;
      const local = ((hit.localT % nat) + nat) % nat;

      if (activeVideoId !== hit.clip.id) {
        pauseAllVideos(hit.clip.id);
        activeVideoId = hit.clip.id;
        try {
          // One seek on clip switch only
          if (Math.abs((el.currentTime || 0) - local) > 0.2) {
            el.currentTime = local;
          }
        } catch {
          /* ignore */
        }
        el.play().catch(() => {});
      } else {
        // Same clip: keep playing; restart if ended/paused; soft-correct big drift only
        if (el.ended || el.paused) {
          try {
            el.currentTime = local;
          } catch {
            /* ignore */
          }
          el.play().catch(() => {});
        } else if (
          Number.isFinite(el.currentTime) &&
          Math.abs(el.currentTime - local) > 1.25
        ) {
          try {
            el.currentTime = local;
          } catch {
            /* ignore */
          }
        }
      }
      return { kind: "video", el };
    }

    pauseAllVideos();
    activeVideoId = null;
    if (el instanceof HTMLImageElement) {
      return { kind: "image", el };
    }
    return null;
  };

  const PREVIEW_LEAD = 5;

  const drawFrame = (t) => {
    const media = syncBackground(t);

    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, width, height);

    if (media?.kind === "video") {
      drawCoverMedia(
        media.el,
        media.el.videoWidth || width,
        media.el.videoHeight || height
      );
    } else if (media?.kind === "image") {
      drawCoverMedia(media.el, media.el.naturalWidth, media.el.naturalHeight);
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

    // lyric bar
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

    const pct = Math.min(1, t / duration);
    ctx.fillStyle = "rgba(201,168,76,0.9)";
    ctx.fillRect(
      0,
      height - Math.max(3, height * 0.0025),
      width * pct,
      Math.max(3, height * 0.0025)
    );

    // Push a frame to the recorder when supported
    try {
      if (videoTrack && typeof videoTrack.requestFrame === "function") {
        videoTrack.requestFrame();
      }
    } catch {
      /* ignore */
    }
  };

  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Prime first frame before recording
    audio.currentTime = 0;
    drawFrame(0);

    recorder.start(200);

    // Must play for MediaElementSource to produce audio samples
    try {
      await audio.play();
    } catch (err) {
      throw new Error(
        "Could not start audio for export. Click the page once and try again."
      );
    }

    await new Promise((resolve, reject) => {
      const onEnded = () => {
        cleanupListeners();
        resolve();
      };
      const onError = () => {
        cleanupListeners();
        reject(new Error("Audio failed during export"));
      };
      const onAbortSig = () => {
        cleanupListeners();
        reject(new DOMException("Aborted", "AbortError"));
      };

      const cleanupListeners = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbortSig);
      };

      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbortSig, { once: true });

      const tick = () => {
        if (finished || signal?.aborted) {
          cleanupListeners();
          resolve();
          return;
        }

        // Strictly audio clock — never wall-clock past the song
        let t = audio.currentTime;
        if (!Number.isFinite(t) || t < 0) t = 0;

        // Hard stop at song end (prevents 5-min file for 4-min song)
        if (audio.ended || t >= duration - 0.02) {
          drawFrame(Math.min(t, duration));
          onProgress?.(1);
          cleanupListeners();
          resolve();
          return;
        }

        // If audio stalls mid-export, nudge play — but do not invent time
        if (audio.paused && !audio.ended) {
          audio.play().catch(() => {});
        }

        drawFrame(t);
        onProgress?.(Math.min(0.99, t / duration));
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    });

    // Final frame + brief drain so encoder flushes last samples
    try {
      drawFrame(Math.min(audio.currentTime || duration, duration));
    } catch {
      /* ignore */
    }
    onProgress?.(1);

    await sleep(180);
    if (recorder.state === "recording") recorder.stop();
    await stopped;

    // Ensure audio is stopped so no trailing silence is held
    try {
      audio.pause();
    } catch {
      /* ignore */
    }

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
      duration,
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

    if (activeIndex >= 0 && globalIndex < activeIndex) {
      color = "rgba(255,255,255,0.82)";
      shadow = "rgba(255,255,255,0.2)";
      shadowBlur = fontSize * 0.15;
    } else if (activeIndex >= 0 && globalIndex === activeIndex) {
      color = highlightHex;
      shadow = highlightGlow;
      shadowBlur = fontSize * 0.55;
    } else {
      color = "rgba(255,255,255,0.48)";
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
    const finish = (ok) => {
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
      finish(true);
    };
    const onErr = () => finish(false);
    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    v.addEventListener("error", onErr);
    setTimeout(() => {
      // Some browsers fire slowly for blob: URLs
      if (v.readyState >= 2) onReady();
    }, 2500);
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
    // Failsafe so export never hangs forever
    setTimeout(() => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) onReady();
    }, 8000);
    audio.load();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
