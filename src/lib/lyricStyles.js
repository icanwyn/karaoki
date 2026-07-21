/**
 * Lyric appearance presets — fonts + highlight colors for stage & export.
 */

/** @typedef {{ id: string, label: string, family: string, weight?: string, canvasFamily: string }} LyricFont */
/** @typedef {{ id: string, label: string, hex: string, glow: string, fill: string }} HighlightColor */

/** @type {LyricFont[]} */
export const LYRIC_FONTS = [
  {
    id: "modern",
    label: "Modern",
    family: '"Space Grotesk", "Inter", system-ui, sans-serif',
    weight: "600",
    canvasFamily: "Space Grotesk",
  },
  {
    id: "clean",
    label: "Clean",
    family: '"Inter", system-ui, -apple-system, sans-serif',
    weight: "600",
    canvasFamily: "Inter",
  },
  {
    id: "serif",
    label: "Serif",
    family: '"Playfair Display", Georgia, serif',
    weight: "600",
    canvasFamily: "Playfair Display",
  },
  {
    id: "calligraphy",
    label: "Calligraphy",
    family: '"Great Vibes", "Segoe Script", cursive',
    weight: "400",
    canvasFamily: "Great Vibes",
  },
  {
    id: "brush",
    label: "Brush",
    family: '"Ma Shan Zheng", "Zhi Mang Xing", cursive',
    weight: "400",
    canvasFamily: "Ma Shan Zheng",
  },
  {
    id: "mincho",
    label: "Mincho",
    family: '"Shippori Mincho", "Noto Serif JP", "Times New Roman", serif',
    weight: "600",
    canvasFamily: "Shippori Mincho",
  },
  {
    id: "bold",
    label: "Bold",
    family: '"Bebas Neue", "Arial Narrow", Impact, sans-serif',
    weight: "400",
    canvasFamily: "Bebas Neue",
  },
  {
    id: "soft",
    label: "Soft",
    family: '"Quicksand", "Inter", system-ui, sans-serif',
    weight: "600",
    canvasFamily: "Quicksand",
  },
  {
    id: "script",
    label: "Script",
    family: '"Pacifico", "Brush Script MT", cursive',
    weight: "400",
    canvasFamily: "Pacifico",
  },
  {
    id: "hand",
    label: "Hand",
    family: '"Caveat", "Segoe Print", cursive',
    weight: "600",
    canvasFamily: "Caveat",
  },
];

/** @type {HighlightColor[]} */
export const HIGHLIGHT_COLORS = [
  {
    id: "sakura",
    label: "Sakura",
    hex: "#e8a0bf",
    glow: "rgba(232, 160, 191, 0.9)",
    fill: "rgba(232, 160, 191, 0.32)",
  },
  {
    id: "gold",
    label: "Gold",
    hex: "#c9a84c",
    glow: "rgba(201, 168, 76, 0.9)",
    fill: "rgba(201, 168, 76, 0.32)",
  },
  {
    id: "matcha",
    label: "Matcha",
    hex: "#8fbc8f",
    glow: "rgba(143, 188, 143, 0.9)",
    fill: "rgba(143, 188, 143, 0.32)",
  },
  {
    id: "cyan",
    label: "Mist",
    hex: "#9fd4d8",
    glow: "rgba(159, 212, 216, 0.9)",
    fill: "rgba(159, 212, 216, 0.32)",
  },
  {
    id: "white",
    label: "White",
    hex: "#ffffff",
    glow: "rgba(255, 255, 255, 0.85)",
    fill: "rgba(255, 255, 255, 0.28)",
  },
  {
    id: "coral",
    label: "Coral",
    hex: "#ff7a6e",
    glow: "rgba(255, 122, 110, 0.9)",
    fill: "rgba(255, 122, 110, 0.32)",
  },
  {
    id: "lavender",
    label: "Lavender",
    hex: "#b8a4e8",
    glow: "rgba(184, 164, 232, 0.9)",
    fill: "rgba(184, 164, 232, 0.32)",
  },
  {
    id: "amber",
    label: "Amber",
    hex: "#f0b429",
    glow: "rgba(240, 180, 41, 0.9)",
    fill: "rgba(240, 180, 41, 0.32)",
  },
  {
    id: "rose",
    label: "Rose",
    hex: "#ff6b9d",
    glow: "rgba(255, 107, 157, 0.9)",
    fill: "rgba(255, 107, 157, 0.32)",
  },
  {
    id: "ice",
    label: "Ice",
    hex: "#a8e6ff",
    glow: "rgba(168, 230, 255, 0.9)",
    fill: "rgba(168, 230, 255, 0.32)",
  },
];

export function getLyricFont(id) {
  return LYRIC_FONTS.find((f) => f.id === id) || LYRIC_FONTS[0];
}

export function getHighlightColor(id) {
  return HIGHLIGHT_COLORS.find((c) => c.id === id) || HIGHLIGHT_COLORS[0];
}

/** CSS variables object for stage containers */
export function lyricStyleVars(fontId, colorId) {
  const font = getLyricFont(fontId);
  const color = getHighlightColor(colorId);
  return {
    "--lyric-font": font.family,
    "--lyric-weight": font.weight || "600",
    "--lyric-highlight": color.hex,
    "--lyric-highlight-glow": color.glow,
    "--lyric-highlight-fill": color.fill,
  };
}

/** Ensure Google fonts are ready for canvas export */
export async function ensureLyricFontsLoaded(fontId) {
  const font = getLyricFont(fontId);
  if (!document?.fonts?.load) return;
  try {
    await document.fonts.load(`${font.weight || 600} 48px "${font.canvasFamily}"`);
    await document.fonts.ready;
  } catch {
    /* ignore — fallback system font will be used */
  }
}
