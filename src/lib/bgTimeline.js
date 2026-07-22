/**
 * Stitched background timeline: ordered image + video clips.
 *
 * Video clips can be trimmed (trimStart → trimEnd) for seamless loops.
 * Hold (durationSec) is how long the clip stays on the song timeline;
 * the trimmed segment loops inside that hold if hold > segment length.
 *
 * @typedef {{
 *   id: string,
 *   type: 'image' | 'video',
 *   url: string,
 *   name: string,
 *   durationSec: number,
 *   sourceDurationSec?: number,
 *   trimStartSec?: number,
 *   trimEndSec?: number,
 * }} BgClip
 */

/**
 * Probe video duration (seconds). Falls back to defaultSec.
 * @param {string} url
 * @param {number} [defaultSec]
 * @returns {Promise<number>}
 */
export function probeVideoDuration(url, defaultSec = 8) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    const done = (sec) => {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
      resolve(sec);
    };
    v.onloadedmetadata = () => {
      const d = Number(v.duration);
      if (Number.isFinite(d) && d > 0.2 && d < 36000) {
        done(Math.min(600, d));
      } else {
        done(defaultSec);
      }
    };
    v.onerror = () => done(defaultSec);
    setTimeout(() => done(defaultSec), 8000);
    v.src = url;
  });
}

/**
 * Normalized trim window for a video clip.
 * @param {BgClip} clip
 * @returns {{ start: number, end: number, length: number, source: number }}
 */
export function getClipTrim(clip) {
  const source = Math.max(
    0.25,
    Number(clip?.sourceDurationSec) ||
      Number(clip?.trimEndSec) ||
      Number(clip?.durationSec) ||
      8
  );
  let start = Math.max(0, Number(clip?.trimStartSec) || 0);
  let end = Number(clip?.trimEndSec);
  if (!Number.isFinite(end) || end <= 0) end = source;
  end = Math.min(source, end);
  if (start >= end - 0.15) {
    start = Math.max(0, end - 0.5);
  }
  if (start >= end) {
    start = 0;
    end = source;
  }
  return { start, end, length: Math.max(0.25, end - start), source };
}

/**
 * Map time inside a hold slot (localT) → media currentTime within the trim window.
 * Loops the trim segment when hold is longer than the segment.
 * @param {BgClip} clip
 * @param {number} localT
 */
export function mediaTimeFromLocalT(clip, localT) {
  if (clip?.type !== "video") return 0;
  const { start, length } = getClipTrim(clip);
  const u = ((Number(localT) || 0) % length + length) % length;
  return start + u;
}

/**
 * Total length of one full pass through the clip list.
 * @param {BgClip[]} clips
 */
export function timelineDuration(clips) {
  if (!clips?.length) return 0;
  return clips.reduce((s, c) => s + Math.max(0.25, Number(c.durationSec) || 5), 0);
}

/**
 * Which clip is active at song time t (loops the full stitch).
 * @param {BgClip[]} clips
 * @param {number} t
 * @returns {{ clip: BgClip, index: number, localT: number, mediaTime: number, total: number } | null}
 */
export function clipAtTime(clips, t) {
  if (!clips?.length) return null;
  const total = timelineDuration(clips);
  if (total <= 0) {
    const clip = clips[0];
    return {
      clip,
      index: 0,
      localT: 0,
      mediaTime: mediaTimeFromLocalT(clip, 0),
      total: 0,
    };
  }
  let u = ((Number(t) || 0) % total + total) % total;
  for (let i = 0; i < clips.length; i++) {
    const d = Math.max(0.25, Number(clips[i].durationSec) || 5);
    if (u < d) {
      const clip = clips[i];
      return {
        clip,
        index: i,
        localT: u,
        mediaTime: mediaTimeFromLocalT(clip, u),
        total,
      };
    }
    u -= d;
  }
  const last = clips.length - 1;
  const clip = clips[last];
  return {
    clip,
    index: last,
    localT: 0,
    mediaTime: mediaTimeFromLocalT(clip, 0),
    total,
  };
}

/**
 * Clamp and apply trim; optionally sync hold to segment length.
 * @param {BgClip} clip
 * @param {{ trimStartSec?: number, trimEndSec?: number, syncHold?: boolean }} patch
 */
export function applyClipTrim(clip, patch = {}) {
  if (!clip || clip.type !== "video") return clip;
  const source = Math.max(
    0.25,
    Number(clip.sourceDurationSec) || Number(clip.durationSec) || 8
  );
  let start =
    patch.trimStartSec != null
      ? Number(patch.trimStartSec)
      : Number(clip.trimStartSec) || 0;
  let end =
    patch.trimEndSec != null
      ? Number(patch.trimEndSec)
      : Number(clip.trimEndSec) || source;

  start = Math.max(0, Math.min(source - 0.25, start));
  end = Math.max(start + 0.25, Math.min(source, end));

  const length = end - start;
  const next = {
    ...clip,
    sourceDurationSec: source,
    trimStartSec: start,
    trimEndSec: end,
  };
  if (patch.syncHold !== false) {
    // Default: hold matches the loop segment for seamless single-clip loops
    next.durationSec = Math.max(0.25, length);
  }
  return next;
}

/**
 * @param {File} file
 * @param {string} id
 * @param {string} url
 * @param {number} [imageDefaultSec]
 * @returns {Promise<BgClip>}
 */
export async function fileToBgClip(file, id, url, imageDefaultSec = 5) {
  const type = (file?.type || "").toLowerCase();
  const name = file?.name || "";
  const isVideo =
    type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name);
  if (isVideo) {
    const sourceDurationSec = await probeVideoDuration(url, 8);
    return {
      id,
      type: "video",
      url,
      name: name || "video",
      sourceDurationSec,
      trimStartSec: 0,
      trimEndSec: sourceDurationSec,
      // Hold defaults to full file (user can shorten trim for a seamless loop)
      durationSec: sourceDurationSec,
    };
  }
  return {
    id,
    type: "image",
    url,
    name: name || "image",
    durationSec: Math.max(1, Number(imageDefaultSec) || 5),
  };
}

export function makeClipId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function formatClipTime(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m <= 0) return `${s.toFixed(1)}s`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}.${String(Math.round((s % 1) * 10))}`;
}
