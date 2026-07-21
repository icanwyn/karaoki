import { useCallback, useRef, useState } from "react";
import { timelineDuration } from "../lib/bgTimeline.js";

/**
 * Stock stage backdrops — photographic Japanese-inspired + soft gradient fallbacks.
 */
export const STOCK_IMAGES = [
  {
    id: "stage-mist",
    label: "Stage Mist",
    url: "/images/stage-mist.jpg",
    css: "url(/images/stage-mist.jpg) center / cover no-repeat",
  },
  {
    id: "night-garden",
    label: "Night Garden",
    url: "/images/stage-night-garden.jpg",
    css: "url(/images/stage-night-garden.jpg) center / cover no-repeat",
  },
  {
    id: "torii",
    label: "Torii Mist",
    url: "/images/torii-mist.jpg",
    css: "url(/images/torii-mist.jpg) center / cover no-repeat",
  },
  {
    id: "ink-wash",
    label: "Ink Wash",
    css: "linear-gradient(165deg, #070a12 0%, #141820 45%, #1a2030 100%), radial-gradient(circle at 20% 20%, rgba(232,160,191,0.22), transparent 45%), radial-gradient(circle at 80% 70%, rgba(159,212,216,0.18), transparent 40%)",
  },
  {
    id: "sakura-dusk",
    label: "Sakura Dusk",
    css: "linear-gradient(180deg, #0b1020 0%, #2a1a28 50%, #c97b9b 100%), radial-gradient(circle at 70% 20%, rgba(232,160,191,0.35), transparent 40%)",
  },
  {
    id: "matcha-mist",
    label: "Matcha Mist",
    css: "linear-gradient(160deg, #070a12 0%, #1a2420 55%, #6f9a72 100%), radial-gradient(circle at 30% 80%, rgba(143,188,143,0.3), transparent 45%)",
  },
];

export function stockBackground(stockImageId) {
  const item = STOCK_IMAGES.find((s) => s.id === stockImageId);
  if (!item) return STOCK_IMAGES[0].css;
  if (item.url) return `url(${item.url})`;
  return item.css || STOCK_IMAGES[0].css;
}

export function stockImageUrl(stockImageId) {
  return STOCK_IMAGES.find((s) => s.id === stockImageId)?.url || null;
}

function formatDur(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Media: song audio + stitched visual timeline (multi image + multi video).
 */
export default function UploadPanel({
  audioFile,
  audioUrl,
  bgClips = [],
  stockImageId,
  defaultImageSec = 5,
  onAudio,
  onAddFiles,
  onRemoveClip,
  onClearClips,
  onMoveClip,
  onClipDuration,
  onStockImage,
  onDefaultImageSec,
  addingMedia = false,
}) {
  const [dragAudio, setDragAudio] = useState(false);
  const [dragVisual, setDragVisual] = useState(false);
  const audioInputRef = useRef(null);
  const mediaInputRef = useRef(null);

  const handleAudioFiles = useCallback(
    (files) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) {
        return;
      }
      onAudio?.(file);
    },
    [onAudio]
  );

  const handleMediaFiles = useCallback(
    (files) => {
      const list = [...(files || [])].filter(
        (f) =>
          f.type.startsWith("image/") ||
          f.type.startsWith("video/") ||
          /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mkv)$/i.test(f.name)
      );
      if (list.length) onAddFiles?.(list);
    },
    [onAddFiles]
  );

  const total = timelineDuration(bgClips);
  const hasClips = bgClips.length > 0;

  return (
    <div className="panel-section">
      <div className="panel-header panel-header-inline">
        <h2 className="panel-title">Media</h2>
      </div>

      <p className="section-label">Song audio</p>
      <div
        className={`dropzone ${dragAudio ? "is-drag" : ""} ${audioFile || audioUrl ? "has-file" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragAudio(true);
        }}
        onDragLeave={() => setDragAudio(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragAudio(false);
          handleAudioFiles(e.dataTransfer.files);
        }}
        onClick={() => audioInputRef.current?.click()}
      >
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          onChange={(e) => handleAudioFiles(e.target.files)}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="dropzone-icon">♪</div>
        <div className="dropzone-title">
          {audioFile ? "Replace audio" : "Drop audio or click"}
        </div>
        <div className="dropzone-sub">MP3, WAV, M4A, OGG</div>
        {(audioFile || audioUrl) && (
          <div className="file-chip">
            <span>{audioFile?.name || "Audio loaded"}</span>
          </div>
        )}
      </div>

      <p className="section-label">Visual timeline (stitch)</p>
      <div
        className={`dropzone ${dragVisual ? "is-drag" : ""} ${hasClips ? "has-file" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragVisual(true);
        }}
        onDragLeave={() => setDragVisual(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragVisual(false);
          handleMediaFiles(e.dataTransfer.files);
        }}
        onClick={() => mediaInputRef.current?.click()}
      >
        <div className="dropzone-icon">▣</div>
        <div className="dropzone-title">
          {addingMedia ? "Adding…" : "Drop images & videos"}
        </div>
        <div className="dropzone-sub">Multi · MP4/WebM/MOV + PNG/JPG · plays in order</div>
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v"
          multiple
          hidden
          onChange={(e) => {
            handleMediaFiles(e.target.files);
            e.target.value = "";
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {hasClips && (
        <div className="bg-media-card">
          <div className="bg-media-card-head">
            <span className="chip">
              {bgClips.length} clip{bgClips.length === 1 ? "" : "s"} · {formatDur(total)}
            </span>
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onClearClips}>
              Clear
            </button>
          </div>

          <ul className="bg-clip-list">
            {bgClips.map((clip, i) => (
              <li key={clip.id} className="bg-clip-row">
                <div className="bg-clip-thumb">
                  {clip.type === "video" ? (
                    <video src={clip.url} muted playsInline preload="metadata" />
                  ) : (
                    <img src={clip.url} alt="" />
                  )}
                  <span className={`bg-clip-type bg-clip-type-${clip.type}`}>
                    {clip.type === "video" ? "VID" : "IMG"}
                  </span>
                </div>
                <div className="bg-clip-meta">
                  <div className="bg-clip-name" title={clip.name}>
                    {i + 1}. {clip.name}
                  </div>
                  <label className="bg-clip-dur">
                    <span>Hold</span>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      step={0.5}
                      value={Number(clip.durationSec.toFixed(1))}
                      onChange={(e) =>
                        onClipDuration?.(clip.id, Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                    <span>s</span>
                  </label>
                </div>
                <div className="bg-clip-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={i === 0}
                    onClick={() => onMoveClip?.(clip.id, -1)}
                    title="Move earlier"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={i === bgClips.length - 1}
                    onClick={() => onMoveClip?.(clip.id, 1)}
                    title="Move later"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-danger"
                    onClick={() => onRemoveClip?.(clip.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <label className="slide-sec-row">
            <span>New images default</span>
            <input
              type="range"
              min={2}
              max={15}
              step={1}
              value={defaultImageSec}
              onChange={(e) => onDefaultImageSec?.(Number(e.target.value))}
            />
            <span className="offset-value">{defaultImageSec}s</span>
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Clips play in order and loop for the full song. Reorder with ↑↓.
          </p>
        </div>
      )}

      <p className="section-label">Or pick a stock backdrop</p>
      <div className="stock-grid">
        {STOCK_IMAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`stock-swatch ${
              !hasClips && stockImageId === s.id ? "is-selected" : ""
            }`}
            style={
              s.url
                ? {
                    backgroundImage: `url(${s.url})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { background: s.css }
            }
            title={s.label}
            onClick={() => onStockImage?.(s.id)}
          >
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <p className="hint">
        Custom timeline overrides stock. Export stitches the same sequence.
      </p>
    </div>
  );
}
