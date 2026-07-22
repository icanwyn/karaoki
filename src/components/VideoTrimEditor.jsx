/**
 * Expanded video loop editor: scrub full source, set In/Out, preview loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getClipTrim } from "../lib/bgTimeline.js";

function fmt(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s);
  const tenths = Math.floor((s - whole) * 10);
  if (m > 0) {
    return `${m}:${String(whole).padStart(2, "0")}.${tenths}`;
  }
  return `${whole}.${tenths}s`;
}

/**
 * @param {{
 *   clip: import('../lib/bgTimeline.js').BgClip,
 *   onTrim: (patch: { trimStartSec?: number, trimEndSec?: number, syncHold?: boolean }) => void,
 *   onDuration?: (sec: number) => void,
 *   onClose: () => void,
 * }} props
 */
export default function VideoTrimEditor({ clip, onTrim, onDuration, onClose }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const dragRef = useRef(null); // 'in' | 'out' | 'playhead' | null
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [srcReady, setSrcReady] = useState(0);

  const trim = getClipTrim({
    ...clip,
    sourceDurationSec: clip.sourceDurationSec || srcReady || clip.durationSec,
  });
  const source = Math.max(trim.source, srcReady || 0.25);

  // Load video + metadata
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.playsInline = true;
    v.loop = false;
    v.preload = "auto";
    if (v.src !== clip.url) {
      v.src = clip.url;
      v.load();
    }
    const onMeta = () => {
      const d = Number(v.duration);
      if (Number.isFinite(d) && d > 0) setSrcReady(d);
      try {
        v.currentTime = trim.start;
        setPlayhead(trim.start);
      } catch {
        /* ignore */
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) onMeta();
    return () => v.removeEventListener("loadedmetadata", onMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.url, clip.id]);

  // Loop preview: when playing, wrap Out → In
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const t = v.currentTime || 0;
      setPlayhead(t);
      if (playing && t >= trim.end - 0.04) {
        try {
          v.currentTime = trim.start;
        } catch {
          /* ignore */
        }
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [playing, trim.start, trim.end]);

  const seekTo = useCallback((t) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(source - 0.02, t));
    setPlayhead(clamped);
    if (v) {
      try {
        v.currentTime = clamped;
      } catch {
        /* ignore */
      }
    }
  }, [source]);

  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    // Start from In if outside window
    if (v.currentTime < trim.start || v.currentTime >= trim.end - 0.05) {
      try {
        v.currentTime = trim.start;
      } catch {
        /* ignore */
      }
    }
    try {
      await v.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [playing, trim.start, trim.end]);

  const setInAtPlayhead = () => {
    onTrim?.({
      trimStartSec: Math.min(playhead, trim.end - 0.25),
      trimEndSec: trim.end,
      syncHold: true,
    });
  };

  const setOutAtPlayhead = () => {
    onTrim?.({
      trimStartSec: trim.start,
      trimEndSec: Math.max(playhead, trim.start + 0.25),
      syncHold: true,
    });
  };

  const pct = (t) => `${(Math.max(0, Math.min(1, t / source)) * 100).toFixed(3)}%`;

  const clientXToTime = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return u * source;
  };

  const onTrackPointerDown = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const t = clientXToTime(e.clientX);
    dragRef.current = mode || "playhead";
    if (mode === "in") {
      onTrim?.({
        trimStartSec: Math.min(t, trim.end - 0.25),
        trimEndSec: trim.end,
        syncHold: true,
      });
    } else if (mode === "out") {
      onTrim?.({
        trimStartSec: trim.start,
        trimEndSec: Math.max(t, trim.start + 0.25),
        syncHold: true,
      });
    } else {
      seekTo(t);
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onTrackPointerMove = (e) => {
    if (!dragRef.current) return;
    const t = clientXToTime(e.clientX);
    if (dragRef.current === "in") {
      onTrim?.({
        trimStartSec: Math.min(t, trim.end - 0.25),
        trimEndSec: trim.end,
        syncHold: true,
      });
    } else if (dragRef.current === "out") {
      onTrim?.({
        trimStartSec: trim.start,
        trimEndSec: Math.max(t, trim.start + 0.25),
        syncHold: true,
      });
    } else {
      seekTo(t);
    }
  };

  const onTrackPointerUp = (e) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setInAtPlayhead();
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        setOutAtPlayhead();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(playhead - (e.shiftKey ? 1 : 0.1));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(playhead + (e.shiftKey ? 1 : 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return (
    <div className="video-trim-editor" role="region" aria-label="Loop editor">
      <div className="video-trim-preview-wrap">
        <video
          ref={videoRef}
          className="video-trim-preview"
          muted
          playsInline
          preload="auto"
        />
        <button
          type="button"
          className="video-trim-play"
          onClick={togglePlay}
          aria-label={playing ? "Pause loop preview" : "Play loop preview"}
        >
          {playing ? "Pause" : "Play loop"}
        </button>
      </div>

      <div className="video-trim-times" aria-live="polite">
        <span>Playhead {fmt(playhead)}</span>
        <span className="video-trim-loop-chip">
          Loop {fmt(trim.length)} · {fmt(trim.start)} → {fmt(trim.end)}
        </span>
        <span>File {fmt(source)}</span>
      </div>

      <div
        ref={trackRef}
        className="video-trim-track"
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={source}
        aria-valuenow={playhead}
        aria-valuetext={`Playhead ${fmt(playhead)}, loop ${fmt(trim.start)} to ${fmt(trim.end)}`}
        tabIndex={0}
        onPointerDown={(e) => onTrackPointerDown(e, "playhead")}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        <div className="video-trim-track-bg" />
        <div
          className="video-trim-range"
          style={{ left: pct(trim.start), width: pct(trim.length) }}
        />
        <button
          type="button"
          className="video-trim-handle video-trim-handle-in"
          style={{ left: pct(trim.start) }}
          aria-label={`Loop start ${fmt(trim.start)}`}
          onPointerDown={(e) => onTrackPointerDown(e, "in")}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
        >
          In
        </button>
        <button
          type="button"
          className="video-trim-handle video-trim-handle-out"
          style={{ left: pct(trim.end) }}
          aria-label={`Loop end ${fmt(trim.end)}`}
          onPointerDown={(e) => onTrackPointerDown(e, "out")}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
        >
          Out
        </button>
        <div
          className="video-trim-playhead"
          style={{ left: pct(playhead) }}
          aria-hidden
        />
      </div>

      <div className="video-trim-actions">
        <button type="button" className="btn btn-sm" onClick={setInAtPlayhead}>
          Set In here
        </button>
        <button type="button" className="btn btn-sm" onClick={setOutAtPlayhead}>
          Set Out here
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            onTrim?.({
              trimStartSec: 0,
              trimEndSec: source,
              syncHold: true,
            });
            seekTo(0);
          }}
        >
          Full video
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            const v = videoRef.current;
            if (v) {
              try {
                v.pause();
              } catch {
                /* ignore */
              }
            }
            setPlaying(false);
            onClose?.();
          }}
        >
          Done
        </button>
      </div>

      <p className="hint video-trim-hint">
        Drag <strong>In</strong> / <strong>Out</strong> on the bar, or scrub then
        press <kbd>I</kbd> / <kbd>O</kbd>. Preview plays only the loop.{" "}
        <kbd>Esc</kbd> closes.
      </p>

      <button
        type="button"
        className="btn btn-sm btn-ghost video-trim-advanced-toggle"
        onClick={() => setShowAdvanced((s) => !s)}
      >
        {showAdvanced ? "Hide advanced" : "Advanced · stage hold"}
      </button>
      {showAdvanced && (
        <label className="bg-clip-dur video-trim-hold">
          <span title="How long this clip stays on the song timeline (loops the In–Out segment)">
            Stage hold
          </span>
          <input
            type="number"
            min={0.5}
            max={600}
            step={0.1}
            value={Number((clip.durationSec || trim.length).toFixed(1))}
            onChange={(e) =>
              onDuration?.(Math.max(0.5, Number(e.target.value) || 0.5))
            }
          />
          <span>s</span>
        </label>
      )}
    </div>
  );
}
