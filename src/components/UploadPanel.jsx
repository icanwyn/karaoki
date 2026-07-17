import { useCallback, useRef, useState } from "react";

export const STOCK_IMAGES = [
  {
    id: "neon-city",
    label: "Neon City",
    css: "linear-gradient(145deg, #1a0533 0%, #4c0519 40%, #0f172a 100%), radial-gradient(circle at 20% 30%, rgba(255,45,149,0.55), transparent 40%), radial-gradient(circle at 80% 70%, rgba(45,226,230,0.4), transparent 35%)",
  },
  {
    id: "purple-haze",
    label: "Purple Haze",
    css: "radial-gradient(ellipse at 30% 20%, #7c3aed 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, #ff2d95 0%, transparent 45%), linear-gradient(160deg, #0a0612, #1a0b2e 60%, #2e1065)",
  },
  {
    id: "cyan-wave",
    label: "Cyan Wave",
    css: "linear-gradient(180deg, #020617 0%, #0e7490 50%, #2de2e6 100%), radial-gradient(circle at 50% 100%, rgba(255,45,149,0.35), transparent 50%)",
  },
  {
    id: "sunset-stage",
    label: "Sunset",
    css: "linear-gradient(180deg, #1e1b4b 0%, #7c2d12 45%, #fb7185 75%, #fde68a 100%)",
  },
  {
    id: "galaxy",
    label: "Galaxy",
    css: "radial-gradient(circle at 25% 25%, #e879f9 0%, transparent 25%), radial-gradient(circle at 75% 40%, #22d3ee 0%, transparent 20%), radial-gradient(circle at 50% 80%, #ff2d95 0%, transparent 30%), linear-gradient(160deg, #020617, #1e1b4b)",
  },
  {
    id: "velvet",
    label: "Velvet",
    css: "linear-gradient(135deg, #450a0a 0%, #701a75 40%, #1e1b4b 100%), radial-gradient(circle at 70% 20%, rgba(255,45,149,0.5), transparent 40%)",
  },
];

/**
 * CSS gradient backgrounds used when no file/image URL is set.
 * stockImageId maps to STOCK_IMAGES.
 */
export function stockBackground(stockImageId) {
  const item = STOCK_IMAGES.find((s) => s.id === stockImageId);
  return item?.css || STOCK_IMAGES[0].css;
}

export default function UploadPanel({
  audioFile,
  imageFile,
  audioUrl,
  imageUrl,
  stockImageId,
  onAudio,
  onImage,
  onStockImage,
}) {
  const [dragAudio, setDragAudio] = useState(false);
  const [dragImage, setDragImage] = useState(false);
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

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

  const handleImageFiles = useCallback(
    (files) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
        return;
      }
      onImage?.(file);
    },
    [onImage]
  );

  return (
    <div className="panel panel-left">
      <div className="panel-header">
        <h2 className="panel-title">Media</h2>
      </div>
      <div className="panel-body">
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

        <p className="section-label">Stage image</p>
        <div
          className={`dropzone ${dragImage ? "is-drag" : ""} ${imageFile || imageUrl ? "has-file" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragImage(true);
          }}
          onDragLeave={() => setDragImage(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragImage(false);
            handleImageFiles(e.dataTransfer.files);
          }}
          onClick={() => imageInputRef.current?.click()}
        >
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp"
            onChange={(e) => handleImageFiles(e.target.files)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="dropzone-icon">▣</div>
          <div className="dropzone-title">
            {imageFile ? "Replace image" : "Drop image or click"}
          </div>
          <div className="dropzone-sub">PNG, JPG, WEBP</div>
          {(imageFile || imageUrl) && (
            <div className="file-chip">
              <span>{imageFile?.name || "Custom image"}</span>
            </div>
          )}
        </div>

        <p className="section-label">Or pick a stock backdrop</p>
        <div className="stock-grid">
          {STOCK_IMAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`stock-swatch ${stockImageId === s.id && !imageUrl ? "is-selected" : ""}`}
              style={{ background: s.css }}
              title={s.label}
              onClick={() => onStockImage?.(s.id)}
            >
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        <p className="hint">
          Tip: export uses your uploaded image when available; otherwise the selected stock
          gradient is rendered as the stage background.
        </p>
      </div>
    </div>
  );
}
