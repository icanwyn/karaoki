/**
 * Stage backdrop from a stitched clip timeline (images + videos in order).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { clipAtTime } from "../lib/bgTimeline.js";

export default function StageBackground({
  clips = [],
  stockBg = null,
  currentTime = 0,
  isPlaying = false,
  className = "stage-bg",
}) {
  const videoRef = useRef(null);
  const active = useMemo(
    () => (clips?.length ? clipAtTime(clips, currentTime) : null),
    [clips, currentTime]
  );
  const activeClip = active?.clip || null;
  const [imgReady, setImgReady] = useState(true);

  // Load/swap video when active clip changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip || activeClip.type !== "video") {
      if (v) {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    v.muted = true;
    v.playsInline = true;
    v.loop = false; // timeline owns stitching; don't infinite-loop one clip alone

    const wantSrc = activeClip.url;
    if (v.dataset.clipUrl !== wantSrc) {
      v.dataset.clipUrl = wantSrc;
      v.src = wantSrc;
      v.load();
    }

    const localT = active?.localT || 0;
    const onMeta = () => {
      try {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          const target = Math.min(Math.max(0, localT), Math.max(0, v.duration - 0.05));
          if (Math.abs((v.currentTime || 0) - target) > 0.35) {
            v.currentTime = target;
          }
        }
      } catch {
        /* ignore */
      }
    };
    v.addEventListener("loadeddata", onMeta, { once: true });
    onMeta();

    const run = async () => {
      try {
        if (isPlaying) {
          if (v.paused) await v.play().catch(() => {});
        } else {
          v.pause();
        }
      } catch {
        /* ignore */
      }
    };
    run();

    return () => v.removeEventListener("loadeddata", onMeta);
  }, [activeClip?.url, activeClip?.type, active?.localT, isPlaying, activeClip]);

  // Soft seek while same video stays active
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip || activeClip.type !== "video" || !isPlaying) return;
    const localT = active?.localT || 0;
    if (!Number.isFinite(v.duration) || v.duration <= 0) return;
    const target = Math.min(Math.max(0, localT), Math.max(0, v.duration - 0.05));
    if (Math.abs((v.currentTime || 0) - target) > 0.5) {
      try {
        v.currentTime = target;
      } catch {
        /* ignore */
      }
    }
  }, [active?.localT, activeClip, isPlaying]);

  if (activeClip?.type === "video") {
    return (
      <div className={`${className} stage-bg-media`}>
        <video
          ref={videoRef}
          className="stage-bg-video"
          muted
          playsInline
          preload="auto"
        />
      </div>
    );
  }

  if (activeClip?.type === "image") {
    return (
      <div className={`${className} stage-bg-media stage-bg-slideshow`}>
        <div
          className={`stage-bg-slide is-active${imgReady ? "" : " is-loading"}`}
          style={{ backgroundImage: `url(${activeClip.url})` }}
          onLoadCapture={() => setImgReady(true)}
        />
      </div>
    );
  }

  // Stock fallback
  return (
    <div
      className={className}
      style={
        stockBg
          ? {
              backgroundImage: stockBg.includes("gradient")
                ? stockBg
                : stockBg.startsWith("url")
                  ? stockBg
                  : `url(${stockBg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    />
  );
}
