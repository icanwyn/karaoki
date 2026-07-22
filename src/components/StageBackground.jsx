/**
 * Stage backdrop from a stitched clip timeline (images + videos in order).
 * Videos honor trimStart/trimEnd for seamless loop segments.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { clipAtTime, getClipTrim, mediaTimeFromLocalT } from "../lib/bgTimeline.js";

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
    // Native loop is whole-file; we wrap at trim bounds ourselves
    v.loop = false;

    const wantSrc = activeClip.url;
    if (v.dataset.clipUrl !== wantSrc) {
      v.dataset.clipUrl = wantSrc;
      v.src = wantSrc;
      v.load();
    }

    const mediaTime =
      active?.mediaTime ?? mediaTimeFromLocalT(activeClip, active?.localT || 0);
    const { start, end } = getClipTrim(activeClip);

    const seekIntoTrim = () => {
      try {
        const target = Math.min(Math.max(mediaTime, start), Math.max(start, end - 0.05));
        if (Math.abs((v.currentTime || 0) - target) > 0.2) {
          v.currentTime = target;
        }
      } catch {
        /* ignore */
      }
    };

    v.addEventListener("loadeddata", seekIntoTrim, { once: true });
    seekIntoTrim();

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

    return () => v.removeEventListener("loadeddata", seekIntoTrim);
  }, [
    activeClip?.url,
    activeClip?.type,
    activeClip?.trimStartSec,
    activeClip?.trimEndSec,
    active?.localT,
    active?.mediaTime,
    isPlaying,
    activeClip,
  ]);

  // Soft-sync + wrap inside trim window while playing
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip || activeClip.type !== "video") return;

    const { start, end } = getClipTrim(activeClip);
    const mediaTime =
      active?.mediaTime ?? mediaTimeFromLocalT(activeClip, active?.localT || 0);

    const onTimeUpdate = () => {
      // Seamless loop within trim
      if (v.currentTime >= end - 0.04 || v.currentTime < start - 0.02) {
        try {
          v.currentTime = start;
        } catch {
          /* ignore */
        }
        if (isPlaying && v.paused) v.play().catch(() => {});
      }
    };

    v.addEventListener("timeupdate", onTimeUpdate);

    if (isPlaying) {
      // Correct big drift vs song timeline (e.g. after tab freeze)
      if (
        Number.isFinite(v.currentTime) &&
        Math.abs(v.currentTime - mediaTime) > 0.65
      ) {
        try {
          v.currentTime = Math.min(Math.max(mediaTime, start), end - 0.05);
        } catch {
          /* ignore */
        }
      }
      if (v.paused) v.play().catch(() => {});
    } else {
      v.pause();
      // Scrub with song when paused
      try {
        const target = Math.min(Math.max(mediaTime, start), end - 0.05);
        if (Math.abs((v.currentTime || 0) - target) > 0.12) {
          v.currentTime = target;
        }
      } catch {
        /* ignore */
      }
    }

    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [
    active?.localT,
    active?.mediaTime,
    activeClip,
    isPlaying,
    currentTime,
  ]);

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
