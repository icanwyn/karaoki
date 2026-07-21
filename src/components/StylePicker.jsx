import { HIGHLIGHT_COLORS, LYRIC_FONTS, getLyricFont } from "../lib/lyricStyles.js";

/**
 * Compact font + highlight color picker for karaoke lyrics.
 */
export default function StylePicker({
  fontId = "modern",
  colorId = "sakura",
  onFontChange,
  onColorChange,
}) {
  const activeFont = getLyricFont(fontId);

  return (
    <div className="panel-section panel-section-tight style-picker">
      <div className="panel-header panel-header-inline">
        <h2 className="panel-title">Style</h2>
      </div>

      <p className="section-label">Font</p>
      <div className="style-font-grid" role="listbox" aria-label="Lyric font">
        {LYRIC_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="option"
            aria-selected={fontId === f.id}
            className={`style-font-chip${fontId === f.id ? " is-active" : ""}`}
            style={{ fontFamily: f.family, fontWeight: f.weight || 600 }}
            title={f.label}
            onClick={() => onFontChange?.(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="section-label">Highlight</p>
      <div className="style-color-grid" role="listbox" aria-label="Highlight color">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={colorId === c.id}
            className={`style-color-swatch${colorId === c.id ? " is-active" : ""}`}
            style={{
              background: c.hex,
              boxShadow:
                colorId === c.id
                  ? `0 0 0 2px var(--ink-deep), 0 0 0 4px ${c.hex}`
                  : `0 0 10px ${c.glow}`,
            }}
            title={c.label}
            onClick={() => onColorChange?.(c.id)}
            aria-label={c.label}
          />
        ))}
      </div>

      <p
        className="style-preview"
        style={{
          fontFamily: activeFont.family,
          fontWeight: activeFont.weight || 600,
          color: HIGHLIGHT_COLORS.find((c) => c.id === colorId)?.hex || "#e8a0bf",
        }}
      >
        Karaoke · 歌
      </p>
    </div>
  );
}
