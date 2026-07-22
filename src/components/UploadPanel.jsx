import { useCallback, useRef, useState } from "react";
import { getClipTrim, timelineDuration } from "../lib/bgTimeline.js";
import VideoTrimEditor from "./VideoTrimEditor.jsx";

/**
 * Stock stage backdrops — photographic Japanese-inspired + soft gradient fallbacks.
 */
export const STOCK_IMAGES = [
  {
    id: "torii",
    label: "Torii Mist",
    url: "/images/torii-mist.jpg",
  },
  {
    id: "stage-mist",
    label: "Stage Mist",
    url: "/images/stage-mist.jpg",
  },
  {
    id: "night-garden",
    label: "Glass Light",
    url: "/images/stage-night-garden.jpg",
  },
  {
    id: "washi",
    label: "Washi",
    url: "/images/washi.jpg",
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
  const item = STOCK_IMAGES.find((s) => s.id === stockImageId) || STOCK_IMAGES[0];
  if (item.url) return `url(${item.url})`;
  return item.css || `url(/images/torii-mist.jpg)`;
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
  onClipTrim,
  onStockImage,
  onDefaultImageSec,
  addingMedia = false,
}) {
  const [dragAudio, setDragAudio] = useState(false);
  const [dragVisual, setDragVisual] = useState(false);
  /** Expanded video loop editor clip id */
  const [editClipId, setEditClipId] = useState(null);
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
      if (!onAddFiles) {
        console.error("UploadPanel: onAddFiles is not connected");
        return;
      }
      const list = [...(files || [])].filter((f) => {
        if (!f) return false;
        const t = (f.type || "").toLowerCase();
        const n = f.name || "";
        // Accept common image/video types, including HEIC from iPhone photos
        if (t.startsWith("image/") || t.startsWith("video/")) return true;
        return /\.(png|jpe?g|webp|gif|heic|heif|bmp|mp4|webm|mov|m4v|mkv|avi)$/i.test(
          n
        );
      });
      if (list.length) {
        onAddFiles(list);
      } else if (files?.length) {
        // Surface rejection so it doesn't feel like a dead click
        window.alert(
          "Unsupported file type. Use JPG, PNG, WebP, GIF, MP4, WebM, or MOV."
        );
      }
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
            {bgClips.map((clip, i) => {
              const trim =
                clip.type === "video"
                  ? getClipTrim(clip)
                  : { start: 0, end: 0, length: 0, source: 0 };
              const expanded = editClipId === clip.id && clip.type === "video";
              return (
                <li
                  key={clip.id}
                  className={`bg-clip-row${expanded ? " is-expanded" : ""}${
                    clip.type === "video" ? " is-video" : ""
                  }`}
                >
                  <div className="bg-clip-row-main">
                    <button
                      type="button"
                      className="bg-clip-thumb-btn"
                      onClick={() => {
                        if (clip.type !== "video") return;
                        setEditClipId((id) => (id === clip.id ? null : clip.id));
                      }}
                      aria-expanded={expanded}
                      aria-label={
                        clip.type === "video"
                          ? expanded
                            ? `Close loop editor for ${clip.name}`
                            : `Edit loop for ${clip.name}`
                          : clip.name
                      }
                      disabled={clip.type !== "video"}
                    >
                      <div className="bg-clip-thumb">
                        {clip.type === "video" ? (
                          <video src={clip.url} muted playsInline preload="metadata" />
                        ) : (
                          <img src={clip.url} alt="" />
                        )}
                        <span className={`bg-clip-type bg-clip-type-${clip.type}`}>
                          {clip.type === "video" ? "VID" : "IMG"}
                        </span>
                        {clip.type === "video" && (
                          <span className="bg-clip-edit-cue">
                            {expanded ? "Close" : "Edit loop"}
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="bg-clip-meta">
                      <div className="bg-clip-name" title={clip.name}>
                        {i + 1}. {clip.name}
                      </div>
                      {clip.type === "video" ? (
                        <button
                          type="button"
                          className="bg-clip-loop-summary"
                          onClick={() =>
                            setEditClipId((id) => (id === clip.id ? null : clip.id))
                          }
                        >
                          <span className="bg-clip-mini-bar" aria-hidden>
                            <span
                              style={{
                                left: `${(trim.start / Math.max(trim.source, 0.01)) * 100}%`,
                                width: `${(trim.length / Math.max(trim.source, 0.01)) * 100}%`,
                              }}
                            />
                          </span>
                          Loop {trim.length.toFixed(1)}s · tap to edit
                        </button>
                      ) : (
                        <label className="bg-clip-dur">
                          <span>Hold</span>
                          <input
                            type="number"
                            min={0.5}
                            max={600}
                            step={0.1}
                            value={Number((clip.durationSec || 1).toFixed(1))}
                            onChange={(e) =>
                              onClipDuration?.(
                                clip.id,
                                Math.max(0.5, Number(e.target.value) || 0.5)
                              )
                            }
                          />
                          <span>s</span>
                        </label>
                      )}
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
                        onClick={() => {
                          if (editClipId === clip.id) setEditClipId(null);
                          onRemoveClip?.(clip.id);
                        }}
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <VideoTrimEditor
                      clip={clip}
                      onTrim={(patch) => onClipTrim?.(clip.id, patch)}
                      onDuration={(sec) => onClipDuration?.(clip.id, sec)}
                      onClose={() => setEditClipId(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Click a <strong>video</strong> to open the loop editor and drag In/Out.
          </p>

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
