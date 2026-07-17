const STORAGE_KEY = "karaoki:project:v1";

/**
 * @typedef {Object} ProjectData
 * @property {string} projectTitle
 * @property {string} lyrics
 * @property {{ text: string, start: number, end: number }[]} timedWords
 * @property {string|null} stockImageId
 * @property {number} [offset]
 * @property {number} [duration]
 * @property {number} [savedAt]
 */

/**
 * Persist project metadata (not media blobs).
 * @param {ProjectData} data
 */
export function saveProject(data) {
  try {
    const payload = {
      projectTitle: data.projectTitle || "Untitled",
      lyrics: data.lyrics || "",
      timedWords: Array.isArray(data.timedWords) ? data.timedWords : [],
      stockImageId: data.stockImageId ?? null,
      offset: data.offset ?? 0,
      duration: data.duration ?? 0,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {ProjectData|null}
 */
export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return {
      projectTitle: data.projectTitle || "Untitled",
      lyrics: data.lyrics || "",
      timedWords: Array.isArray(data.timedWords) ? data.timedWords : [],
      stockImageId: data.stockImageId ?? null,
      offset: data.offset ?? 0,
      duration: data.duration ?? 0,
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearProject() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Compress project share payload to URL-safe base64.
 * Audio/image files cannot fit in a URL — only lyrics, timings, title, stock id.
 * @param {Object} data
 * @returns {string}
 */
export function encodeSharePayload(data) {
  const payload = {
    v: 1,
    t: data.projectTitle || "Untitled",
    l: data.lyrics || "",
    w: (data.timedWords || []).map((w) => [
      w.text,
      round3(w.start),
      round3(w.end),
    ]),
    s: data.stockImageId ?? null,
    o: data.offset ?? 0,
  };
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

/**
 * @param {string} encoded
 * @returns {ProjectData|null}
 */
export function decodeSharePayload(encoded) {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    const json = fromBase64Url(encoded.trim());
    const data = JSON.parse(json);
    if (!data || data.v !== 1) return null;
    return {
      projectTitle: data.t || "Untitled",
      lyrics: data.l || "",
      timedWords: Array.isArray(data.w)
        ? data.w.map((row) => ({
            text: String(row[0] ?? ""),
            start: Number(row[1]) || 0,
            end: Number(row[2]) || 0,
          }))
        : [],
      stockImageId: data.s ?? null,
      offset: data.o ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Build a shareable URL for the current origin.
 * @param {Object} data
 */
export function buildShareUrl(data) {
  const encoded = encodeSharePayload(data);
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `p=${encoded}`;
  return url.toString();
}

/**
 * Read share payload from location hash if present.
 */
export function readShareFromLocation() {
  const hash = window.location.hash || "";
  const m = hash.match(/[#&]p=([^&]+)/);
  if (!m) return null;
  return decodeSharePayload(decodeURIComponent(m[1]));
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
