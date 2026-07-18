import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadPanel, { STOCK_IMAGES } from "./components/UploadPanel.jsx";
import LyricsEditor from "./components/LyricsEditor.jsx";
import SyncToolbar from "./components/SyncToolbar.jsx";
import KaraokePlayer from "./components/KaraokePlayer.jsx";
import VideoStage from "./components/VideoStage.jsx";
import ExportPanel from "./components/ExportPanel.jsx";
import {
  estimateTimings,
  flattenWords,
  indexForTime,
  parseLrc,
} from "./lib/lyrics.js";
import {
  alignLyricsToAsr,
  alignmentMatchRate,
} from "./lib/alignLyrics.js";
import {
  buildShareUrl,
  loadProject,
  readShareFromLocation,
  saveProject,
} from "./lib/storage.js";
import { exportKaraokeVideo } from "./lib/videoExport.js";
import { transcribeSong, UNTAPPED_START } from "./lib/transcribe.js";
import { findActiveWindow, estimateTimingsInWindow, decodeMono16k } from "./lib/audioAlign.js";

function revokeIfBlob(url) {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

/** Paint stock CSS gradient to a PNG data URL for export. */
async function stockToDataUrl(stockImageId, width = 1280, height = 720) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const item = STOCK_IMAGES.find((s) => s.id === stockImageId) || STOCK_IMAGES[0];
  drawProceduralBackdrop(ctx, width, height, item.id);
  return canvas.toDataURL("image/png");
}

function drawProceduralBackdrop(ctx, w, h, id) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  const palettes = {
    "neon-city": ["#1a0533", "#4c0519", "#0f172a"],
    "purple-haze": ["#0a0612", "#1a0b2e", "#2e1065"],
    "cyan-wave": ["#020617", "#0e7490", "#2de2e6"],
    "sunset-stage": ["#1e1b4b", "#7c2d12", "#fb7185"],
    galaxy: ["#020617", "#1e1b4b", "#4c1d95"],
    velvet: ["#450a0a", "#701a75", "#1e1b4b"],
  };
  const p = palettes[id] || palettes["neon-city"];
  g.addColorStop(0, p[0]);
  g.addColorStop(0.5, p[1]);
  g.addColorStop(1, p[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const orbs = [
    { x: 0.2, y: 0.3, r: 0.35, c: "rgba(255,45,149,0.45)" },
    { x: 0.8, y: 0.65, r: 0.3, c: "rgba(45,226,230,0.35)" },
    { x: 0.5, y: 0.15, r: 0.25, c: "rgba(168,85,247,0.35)" },
  ];
  for (const o of orbs) {
    const rg = ctx.createRadialGradient(
      w * o.x,
      h * o.y,
      0,
      w * o.x,
      h * o.y,
      Math.max(w, h) * o.r
    );
    rg.addColorStop(0, o.c);
    rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
}

function applyOffset(words, offsetSec) {
  if (!offsetSec) return words;
  return words.map((w) => ({
    ...w,
    start: w.start + offsetSec,
    end: w.end + offsetSec,
  }));
}

function wordsToLyricsSafe(words) {
  if (!words?.length) return "";
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    if (buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

/** Seal word ends so they meet the next start cleanly. */
function sealWordEnds(words, duration = 0) {
  const fixed = words.map((w) => ({ ...w }));
  for (let j = 0; j < fixed.length - 1; j++) {
    if (
      !Number.isFinite(fixed[j].start) ||
      fixed[j].start >= UNTAPPED_START / 2
    ) {
      continue;
    }
    const nextStart = fixed[j + 1].start;
    if (nextStart < UNTAPPED_START / 2) {
      fixed[j].end = Math.max(fixed[j].start + 0.05, nextStart);
    }
  }
  if (fixed.length) {
    const last = fixed[fixed.length - 1];
    if (last.start < UNTAPPED_START / 2) {
      const dur = duration || last.end;
      fixed[fixed.length - 1] = {
        ...last,
        end: Math.max(last.start + 0.15, Math.min(dur || last.start + 0.6, last.start + 1.2)),
      };
    }
  }
  return fixed;
}

export default function App() {
  const [projectTitle, setProjectTitle] = useState("Untitled karaoke");
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [stockImageId, setStockImageId] = useState("neon-city");
  const [lyrics, setLyrics] = useState("");
  const [timedWords, setTimedWords] = useState([]);
  const [status, setStatus] = useState("edit");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState("edit");
  const [offsetMs, setOffsetMs] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncIndex, setSyncIndex] = useState(0);
  const [syncBaseWords, setSyncBaseWords] = useState([]);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const [autoBusy, setAutoBusy] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoStatus, setAutoStatus] = useState("");

  const audioRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const exportAbortRef = useRef(null);
  const autoAbortRef = useRef(null);
  const isSyncingRef = useRef(false);
  const syncIndexRef = useRef(0);
  const syncBaseRef = useRef([]);
  const timedWordsRef = useRef([]);

  useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);
  useEffect(() => {
    syncIndexRef.current = syncIndex;
  }, [syncIndex]);
  useEffect(() => {
    syncBaseRef.current = syncBaseWords;
  }, [syncBaseWords]);
  useEffect(() => {
    timedWordsRef.current = timedWords;
  }, [timedWords]);

  // Hydrate from share link or localStorage
  useEffect(() => {
    const shared = readShareFromLocation();
    const local = shared || loadProject();
    if (!local) return;
    setProjectTitle(local.projectTitle || "Untitled karaoke");
    setLyrics(local.lyrics || "");
    setTimedWords(local.timedWords || []);
    if (local.stockImageId) setStockImageId(local.stockImageId);
    if (local.offset) setOffsetMs(Math.round(local.offset * 1000));
    if (shared) {
      setExportMessage(
        "Loaded project from share link. Re-upload audio & image to play/export."
      );
    }
  }, []);

  // Autosave metadata
  useEffect(() => {
    const t = setTimeout(() => {
      saveProject({
        projectTitle,
        lyrics,
        timedWords,
        stockImageId,
        offset: offsetMs / 1000,
        duration,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [projectTitle, lyrics, timedWords, stockImageId, offsetMs, duration]);

  // Audio element lifecycle
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
      if (isSyncingRef.current) {
        // Seal whatever was tapped and leave sync mode
        setTimedWords((prev) => sealWordEnds(prev, audio.duration || 0));
        setIsSyncing(false);
        setStatus("edit");
        setMode("edit");
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audioRef.current = null;
    };
  }, []);

  // Bind audio URL
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioUrl) {
      audio.src = audioUrl;
      audio.load();
    } else {
      audio.removeAttribute("src");
      audio.load();
      setDuration(0);
    }
  }, [audioUrl]);

  // rAF clock while playing
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  const offsetSec = offsetMs / 1000;
  const displayWords = useMemo(
    () => applyOffset(timedWords, offsetSec),
    [timedWords, offsetSec]
  );

  const activeWordIndex = useMemo(() => {
    if (isSyncing) return Math.max(syncIndex - 1, -1);
    return indexForTime(displayWords, currentTime);
  }, [displayWords, currentTime, isSyncing, syncIndex]);

  const wordList = useMemo(() => flattenWords(lyrics), [lyrics]);

  const handleAudio = useCallback((file) => {
    setAudioFile(file);
    setAudioUrl((prev) => {
      revokeIfBlob(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const handleImage = useCallback((file) => {
    setImageFile(file);
    setImageUrl((prev) => {
      revokeIfBlob(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const handleStockImage = useCallback((id) => {
    setStockImageId(id);
    setImageFile(null);
    setImageUrl((prev) => {
      revokeIfBlob(prev);
      return null;
    });
  }, []);

  const handleParseLrc = useCallback(() => {
    const parsed = parseLrc(lyrics);
    if (parsed.length) {
      setTimedWords(parsed);
      setExportMessage(`Parsed ${parsed.length} timed words from LRC.`);
      setExportError("");
      setStatus("edit");
      return;
    }
    if (wordList.length && duration > 0) {
      setTimedWords(estimateTimings(wordList, duration));
      setExportMessage("No LRC tags found — applied auto timings from plain lyrics.");
    } else if (wordList.length) {
      setTimedWords(
        wordList.map((text) => ({
          text,
          start: UNTAPPED_START,
          end: UNTAPPED_START + 0.05,
        }))
      );
      setExportMessage("No LRC tags found. Load audio and Auto-time, or use Tap Sync.");
    } else {
      setExportError("Nothing to parse — paste lyrics or LRC first.");
    }
  }, [lyrics, wordList, duration]);

  /**
   * Sync *your* lyrics to the song audio.
   * Unlike ElevenLabs (which invents audio + timestamps together), songs need
   * forced alignment: hear the track → map your words onto those times.
   * Old "Auto-time" only spread words evenly and ignored the recording.
   */
  const handleAutoTime = useCallback(async () => {
    if (!wordList.length) {
      setExportError("Paste lyrics first.");
      return;
    }
    if (!duration && !audioFile && !audioUrl) {
      setExportError("Load audio first.");
      return;
    }

    // Resolve file for Whisper
    let file = audioFile;
    if (!file && audioUrl) {
      try {
        const res = await fetch(audioUrl);
        const blob = await res.blob();
        file = new File([blob], "song.audio", { type: blob.type || "audio/mpeg" });
      } catch {
        /* fall through */
      }
    }

    // No audio blob → silence-aware even spread only (legacy fallback)
    if (!file) {
      if (!duration) {
        setExportError("Load audio so we can sync.");
        return;
      }
      setTimedWords(estimateTimings(wordList, duration));
      setExportError("");
      setExportMessage(
        `Evenly timed ${wordList.length} words (no audio file for alignment). Re-upload the song and click Sync again for real sync.`
      );
      return;
    }

    if (autoBusy) return;
    autoAbortRef.current?.abort();
    const ac = new AbortController();
    autoAbortRef.current = ac;

    setAutoBusy(true);
    setAutoProgress(0.05);
    setAutoStatus("Listening to song to align your lyrics…");
    setExportError("");
    setExportMessage("");
    audioRef.current?.pause();

    try {
      // 1) ASR with word times (OpenAI Whisper if key set), guided by your lyrics
      const result = await transcribeSong(file, {
        signal: ac.signal,
        durationHint: duration || 0,
        prompt: lyrics,
        onProgress: (p) => {
          if (typeof p.progress === "number") setAutoProgress(p.progress * 0.85);
          if (p.status) setAutoStatus(p.status);
        },
      });

      setAutoStatus("Mapping your lyrics onto the audio…");
      setAutoProgress(0.9);

      const asrWords = result.words || [];
      let aligned = alignLyricsToAsr(wordList, asrWords, {
        duration: duration || result.words?.at?.(-1)?.end || 0,
      });

      // If ASR is useless, fall back to energy-window even spacing of *your* words
      const match = alignmentMatchRate(wordList, asrWords);
      if (!aligned.length || (match < 0.15 && asrWords.length < wordList.length * 0.2)) {
        setAutoStatus("Weak vocal match — spacing your lyrics over the audible section…");
        try {
          const decoded = await decodeMono16k(file);
          const win = findActiveWindow(decoded.samples, decoded.sampleRate);
          aligned = estimateTimingsInWindow(wordList, win.start, win.end);
        } catch {
          aligned = estimateTimings(wordList, duration || 180);
        }
        setTimedWords(aligned);
        setExportMessage(
          `Synced ${aligned.length} of your words with a rough energy map ` +
            `(ASR match ${(match * 100).toFixed(0)}% — vocals may be hard to hear). ` +
            `Use Global offset or Tap Sync to refine.`
        );
      } else {
        // Keep the lyrics text the user typed; only timings change
        setTimedWords(aligned);
        const first = aligned[0];
        setExportMessage(
          `✓ Aligned ${aligned.length} of your lyrics to the audio ` +
            `(${result.provider}, match ~${(match * 100).toFixed(0)}%). ` +
            `First word at ${first.start.toFixed(1)}s. ` +
            `This is the karaoke equivalent of ElevenLabs timestamps — but for a real song. ` +
            `Nudge with Global offset if still early/late overall.`
        );
      }

      setExportError("");
      setOffsetMs(0);
      setStatus("play");
      setMode("play");
    } catch (err) {
      console.error("[karaoki] sync lyrics failed", err);
      if (err?.name === "AbortError") {
        setExportMessage("Sync cancelled.");
      } else {
        // Last resort: even timing so the user isn't stuck
        if (duration && wordList.length) {
          setTimedWords(estimateTimings(wordList, duration));
          setExportError(
            `${err?.message || "Align failed"} — fell back to even timing. Try Tap Sync.`
          );
        } else {
          setExportError(err?.message || "Could not sync lyrics to audio");
        }
      }
    } finally {
      setAutoBusy(false);
      setAutoProgress(0);
      setAutoStatus("");
      autoAbortRef.current = null;
    }
  }, [wordList, duration, audioFile, audioUrl, autoBusy, lyrics]);

  const handleClearLyrics = useCallback(() => {
    setLyrics("");
    setTimedWords([]);
    setIsSyncing(false);
    setSyncIndex(0);
    setSyncBaseWords([]);
  }, []);

  const handleResetTimings = useCallback(() => {
    if (!wordList.length) {
      setTimedWords([]);
      return;
    }
    // Untapped sentinel — never matches playhead, so stage won't race
    setTimedWords(
      wordList.map((text) => ({
        text,
        start: UNTAPPED_START,
        end: UNTAPPED_START + 0.05,
      }))
    );
    setSyncIndex(0);
    setExportMessage("Timings cleared — ready for Tap Sync.");
  }, [wordList]);

  const handleAutoFromSong = useCallback(async () => {
    if (autoBusy) return;

    // Resolve a real Blob/File even if only a blob: URL remains
    let file = audioFile;
    if (!file && audioUrl) {
      try {
        const res = await fetch(audioUrl);
        const blob = await res.blob();
        file = new File([blob], "song.audio", { type: blob.type || "audio/mpeg" });
      } catch {
        /* fall through */
      }
    }
    if (!file) {
      setExportError("Upload a song first, then click Auto lyrics from song.");
      return;
    }

    autoAbortRef.current?.abort();
    const ac = new AbortController();
    autoAbortRef.current = ac;

    setAutoBusy(true);
    setAutoProgress(0.02);
    setAutoStatus("Starting auto lyrics…");
    setExportError("");
    setExportMessage("");
    setIsSyncing(false);
    audioRef.current?.pause();
    setStatus("edit");
    setMode("edit");

    try {
      const result = await transcribeSong(file, {
        signal: ac.signal,
        durationHint: duration || 0,
        onProgress: (p) => {
          if (typeof p.progress === "number") setAutoProgress(p.progress);
          if (p.status) setAutoStatus(p.status);
        },
      });

      let words = result.words || [];
      if (!words.length && result.fullText) {
        const tokens = flattenWords(result.fullText);
        words = estimateTimings(tokens, duration || 180);
      }
      if (!words.length) {
        throw new Error("No words returned. Try another track or paste lyrics.");
      }

      const lyricsText = result.lyrics || wordsToLyricsSafe(words);
      setLyrics(lyricsText);
      setTimedWords(words);
      setOffsetMs(0);

      const first = words[0];
      const last = words[words.length - 1];
      const span = (last?.end ?? 0) - (first?.start ?? 0);
      const providerLabel =
        result.provider === "openai"
          ? "server Whisper"
          : result.provider?.includes("estimate")
            ? "Whisper + timing estimate"
            : "on-device Whisper";

      const extra = [result.note, result.appliedShiftSec && Math.abs(result.appliedShiftSec) >= 0.2
        ? `Shifted +${result.appliedShiftSec.toFixed(2)}s to match audio start.`
        : ""]
        .filter(Boolean)
        .join(" ");

      setExportMessage(
        `✓ Auto-synced ${words.length} words (${providerLabel}). ` +
          `First highlight at ${first.start.toFixed(1)}s · span ${span.toFixed(1)}s. ` +
          `${extra} ` +
          `Free Whisper often mis-hears sung lyrics — paste official lyrics + Auto-time for accuracy, ` +
          `or Tap Sync. Global offset if everything is still early/late together.`
      );
      setExportError("");
      setStatus("play");
      setMode("play");
    } catch (err) {
      console.error("[karaoki] auto lyrics failed", err);
      if (err?.name === "AbortError") {
        setExportMessage("Auto lyrics cancelled.");
      } else {
        setExportError(err?.message || "Auto lyrics failed");
      }
    } finally {
      setAutoBusy(false);
      setAutoProgress(0);
      setAutoStatus("");
      autoAbortRef.current = null;
    }
  }, [audioFile, audioUrl, autoBusy, duration]);

  const handleStartSync = useCallback(async () => {
    const texts =
      wordList.length > 0
        ? wordList
        : timedWords.map((w) => w.text).filter(Boolean);
    if (!texts.length) {
      setExportError("Add lyrics before syncing (or run Auto lyrics from song).");
      return;
    }

    // All words start as untapped sentinels — playhead cannot race through them
    const base = texts.map((text) => ({
      text,
      start: UNTAPPED_START,
      end: UNTAPPED_START + 0.05,
    }));

    setSyncBaseWords(base);
    setTimedWords(base);
    setSyncIndex(0);
    setIsSyncing(true);
    setStatus("sync");
    setMode("sync");
    setExportMessage("Sync mode: press Space on each word as you hear it. Esc to stop.");
    setExportError("");

    const audio = audioRef.current;
    if (audio && audioUrl) {
      try {
        audio.currentTime = 0;
        setCurrentTime(0);
        await audio.play();
      } catch {
        setExportError("Could not autoplay — press Play, then Tap.");
      }
    }
  }, [wordList, timedWords, audioUrl]);

  const handleStopSync = useCallback(() => {
    setTimedWords((prev) => sealWordEnds(prev, audioRef.current?.duration || 0));
    setIsSyncing(false);
    setStatus("edit");
    setMode("edit");
    audioRef.current?.pause();
  }, []);

  const handleTap = useCallback(() => {
    if (!isSyncingRef.current) return;
    const audio = audioRef.current;
    const t = audio?.currentTime ?? currentTime;
    const base = syncBaseRef.current;
    const i = syncIndexRef.current;
    if (!base.length || i >= base.length) {
      setIsSyncing(false);
      setStatus("edit");
      setMode("edit");
      return;
    }

    const start = Math.max(0, t);

    // Only stamp the tapped word. Leave the rest as UNTAPPED_START so
    // indexForTime never advances through provisional times (the old glitch).
    setTimedWords((prev) => {
      const next =
        prev.length === base.length
          ? prev.map((w) => ({ ...w }))
          : base.map((w) => ({ ...w }));

      next[i] = {
        text: base[i].text,
        start,
        // Hold until next tap (or seal on finish)
        end: start + 0.8,
      };
      if (i > 0 && next[i - 1].start < UNTAPPED_START / 2) {
        next[i - 1] = {
          ...next[i - 1],
          end: Math.max(next[i - 1].start + 0.05, start),
        };
      }
      return next;
    });

    const nextIdx = i + 1;
    setSyncIndex(nextIdx);

    if (nextIdx >= base.length) {
      setIsSyncing(false);
      setStatus("play");
      setMode("play");
      setExportMessage("Sync complete — play back to review.");
      setTimedWords((prev) => sealWordEnds(prev, audioRef.current?.duration || 0));
    }
  }, [currentTime]);

  // Space / Esc for sync
  useEffect(() => {
    const onKey = (e) => {
      if (!isSyncingRef.current) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleTap();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleStopSync();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleTap, handleStopSync]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    // Don't leave sync mode accidentally mid-sync via play toggle
    if (audio.paused) {
      try {
        await audio.play();
        if (!isSyncingRef.current) {
          setStatus("play");
          setMode("play");
        }
      } catch {
        setExportError("Playback blocked — interact with the page and try again.");
      }
    } else {
      audio.pause();
    }
  }, [audioUrl]);

  const handleSeek = useCallback(
    (t) => {
      // Seeking during sync would desync taps — block it
      if (isSyncingRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = t;
      setCurrentTime(t);
    },
    []
  );

  const canExport = Boolean(
    audioUrl && timedWords.length > 0 && (imageUrl || stockImageId)
  );

  const handleExport = useCallback(async () => {
    if (!canExport || exporting) return;
    setExporting(true);
    setExportProgress(0);
    setExportError("");
    setExportMessage("");
    setStatus("export");
    setMode("export");
    revokeIfBlob(downloadUrl);
    setDownloadUrl(null);

    const ac = new AbortController();
    exportAbortRef.current = ac;
    audioRef.current?.pause();

    try {
      let bgUrl = imageUrl;
      if (!bgUrl) {
        bgUrl = await stockToDataUrl(stockImageId);
      }
      // Drop untapped sentinels if any remain
      const words = applyOffset(
        timedWords.filter((w) => w.start < UNTAPPED_START / 2),
        offsetSec
      );
      if (!words.length) {
        throw new Error("No timed words to export — run Auto lyrics or Tap Sync first.");
      }
      const blob = await exportKaraokeVideo({
        imageUrl: bgUrl,
        audioUrl,
        words,
        lyrics,
        width: 1280,
        height: 720,
        onProgress: setExportProgress,
        signal: ac.signal,
      });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setExportMessage("Export ready — download your WebM below.");
      setStatus("edit");
      setMode("edit");
    } catch (err) {
      if (err?.name === "AbortError") {
        setExportMessage("Export cancelled.");
      } else {
        setExportError(err?.message || "Export failed");
      }
      setStatus("edit");
      setMode("edit");
    } finally {
      setExporting(false);
      exportAbortRef.current = null;
    }
  }, [
    canExport,
    exporting,
    downloadUrl,
    imageUrl,
    stockImageId,
    timedWords,
    offsetSec,
    audioUrl,
    lyrics,
  ]);

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  const handleCopyShare = useCallback(async () => {
    const url = buildShareUrl({
      projectTitle,
      lyrics,
      timedWords: timedWords.filter((w) => w.start < UNTAPPED_START / 2),
      stockImageId,
      offset: offsetSec,
    });
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Share link copied! Recipients re-upload media to play.");
      setExportError("");
    } catch {
      window.prompt("Copy this share link:", url);
    }
  }, [projectTitle, lyrics, timedWords, stockImageId, offsetSec]);

  useEffect(() => {
    return () => {
      revokeIfBlob(audioUrl);
      revokeIfBlob(imageUrl);
      revokeIfBlob(downloadUrl);
      autoAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusTone =
    status === "sync"
      ? "sync"
      : status === "export"
        ? "export"
        : status === "play"
          ? "play"
          : "";

  const nextWord =
    isSyncing && syncBaseWords[syncIndex] ? syncBaseWords[syncIndex].text : null;

  const downloadName = `${(projectTitle || "karaoki")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 48)}.webm`;

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo" title="Karaoki Studio">
          <div className="logo-mark" aria-hidden="true">
            ♪
          </div>
          <div className="logo-text">
            Karaoki
            <span className="logo-sub">Studio</span>
          </div>
        </div>

        <input
          className="header-title"
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
          placeholder="Project title"
          aria-label="Project title"
        />

        <div className="header-actions">
          <span className="status-chip" data-tone={statusTone || undefined}>
            {mode}
          </span>
          <button
            type="button"
            className="btn btn-export"
            onClick={handleExport}
            disabled={!canExport || exporting || autoBusy}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      <main className="studio">
        <UploadPanel
          audioFile={audioFile}
          imageFile={imageFile}
          audioUrl={audioUrl}
          imageUrl={imageUrl}
          stockImageId={stockImageId}
          onAudio={handleAudio}
          onImage={handleImage}
          onStockImage={handleStockImage}
        />

        <section className="panel panel-center">
          <div className="stage-wrap">
            <VideoStage
              ref={stageRef}
              imageUrl={imageUrl}
              stockImageId={stockImageId}
              words={displayWords}
              lyrics={lyrics}
              currentTime={currentTime}
              isSyncing={isSyncing}
              syncIndex={syncIndex}
            />
            <KaraokePlayer
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onTogglePlay={togglePlay}
              onSeek={handleSeek}
              disabled={!audioUrl || autoBusy}
              activeWordIndex={activeWordIndex}
              totalWords={displayWords.length}
              seekDisabled={isSyncing}
            />
          </div>
        </section>

        <aside className="panel panel-right">
          <div className="panel-body">
            <LyricsEditor
              lyrics={lyrics}
              onChange={setLyrics}
              onParseLrc={handleParseLrc}
              onAutoTime={handleAutoTime}
              onClear={handleClearLyrics}
              onAutoFromSong={handleAutoFromSong}
              wordCount={wordList.length}
              timedCount={timedWords.filter((w) => w.start < UNTAPPED_START / 2).length}
              hasDuration={duration > 0}
              hasAudio={Boolean(audioFile || audioUrl)}
              autoBusy={autoBusy}
              autoProgress={autoProgress}
              autoStatus={autoStatus}
            />

            <SyncToolbar
              isSyncing={isSyncing}
              syncIndex={syncIndex}
              totalWords={syncBaseWords.length || wordList.length}
              nextWord={nextWord}
              offsetMs={offsetMs}
              onOffsetChange={setOffsetMs}
              onStartSync={handleStartSync}
              onStopSync={handleStopSync}
              onResetTimings={handleResetTimings}
              onTap={handleTap}
              hasAudio={Boolean(audioUrl)}
              hasWords={wordList.length > 0 || timedWords.length > 0}
              disabled={autoBusy}
            />

            <ExportPanel
              canExport={canExport}
              exporting={exporting}
              progress={exportProgress}
              downloadUrl={downloadUrl}
              downloadName={downloadName}
              shareUrl
              error={exportError}
              message={exportMessage || shareMessage}
              onExport={handleExport}
              onCopyShare={handleCopyShare}
              onCancel={handleCancelExport}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
