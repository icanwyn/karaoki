/**
 * Stitched background timeline: ordered image + video clips.
 *
 * @typedef {{
 *   id: string,
 *   type: 'image' | 'video',
 *   url: string,
 *   name: string,
 *   durationSec: number,
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
    // Timeout so a hung probe never blocks upload UI
    setTimeout(() => done(defaultSec), 8000);
    v.src = url;
  });
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
 * @returns {{ clip: BgClip, index: number, localT: number, total: number } | null}
 */
export function clipAtTime(clips, t) {
  if (!clips?.length) return null;
  const total = timelineDuration(clips);
  if (total <= 0) {
    return { clip: clips[0], index: 0, localT: 0, total: 0 };
  }
  let u = ((Number(t) || 0) % total + total) % total;
  for (let i = 0; i < clips.length; i++) {
    const d = Math.max(0.25, Number(clips[i].durationSec) || 5);
    if (u < d) {
      return { clip: clips[i], index: i, localT: u, total };
    }
    u -= d;
  }
  const last = clips.length - 1;
  return {
    clip: clips[last],
    index: last,
    localT: 0,
    total,
  };
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
  // Treat HEIC/unknown image extensions as images (browser may or may not render them)
  if (isVideo) {
    const durationSec = await probeVideoDuration(url, 8);
    return {
      id,
      type: "video",
      url,
      name: name || "video",
      durationSec,
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
