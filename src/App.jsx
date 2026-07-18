import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadPanel, { STOCK_IMAGES, stockBackground } from "./components/UploadPanel.jsx";
import LyricsEditor from "./components/LyricsEditor.jsx";
import SyncToolbar from "./components/SyncToolbar.jsx";
import KaraokePlayer from "./components/KaraokePlayer.jsx";
import VideoStage from "./components/VideoStage.jsx";
import SrtReaderView from "./components/SrtReaderView.jsx";
import SrtEditor from "./components/SrtEditor.jsx";
import EffectsPicker from "./components/EffectsPicker.jsx";
import FallingEffects from "./components/FallingEffects.jsx";
import ExportPanel from "./components/ExportPanel.jsx";
import { SrtReader } from "./lib/SrtReader.js";
import {
  estimateTimings,
  flattenWords,
  indexForTime,
  parseLrc,
} from "./lib/lyrics.js";
import {
  buildShareUrl,
  loadProject,
  readShareFromLocation,
  saveProject,
} from "./lib/storage.js";
import { exportKaraokeVideo } from "./lib/videoExport.js";
import { UNTAPPED_START } from "./lib/constants.js";
import { loadSrtFile } from "./lib/syncLyrics.js";
import { wordsToSrt } from "./lib/srt.js";
import { decodeMono16k } from "./lib/audioAlign.js";

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
  /** @type {[import('./lib/SrtReader.js').SrtReader|null, Function]} */
  const [srtReader, setSrtReader] = useState(null);
  const [showSrtEditor, setShowSrtEditor] = useState(false);
  const [stageEffect, setStageEffect] = useState("none");
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

  const audioRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const exportAbortRef = useRef(null);
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

  const resolveAudioFile = useCallback(async () => {
    if (audioFile) return audioFile;
    if (!audioUrl) return null;
    try {
      const res = await fetch(audioUrl);
      const blob = await res.blob();
      return new File([blob], "song.audio", { type: blob.type || "audio/mpeg" });
    } catch {
      return null;
    }
  }, [audioFile, audioUrl]);

  const handleClearLyrics = useCallback(() => {
    setLyrics("");
    setTimedWords([]);
    setSrtReader(null);
    setShowSrtEditor(false);
    setIsSyncing(false);
    setSyncIndex(0);
    setSyncBaseWords([]);
  }, []);

  /** Keep timedWords in sync when user edits the SrtReader */
  const handleSrtReaderChange = useCallback((reader) => {
    setSrtReader(reader);
    if (!reader || reader.isEmpty) {
      setTimedWords([]);
      setLyrics("");
      setShowSrtEditor(false);
      return;
    }
    setTimedWords(reader.words);
    setLyrics(reader.lyricsText);
  }, []);

  const handleResetTimings = useCallback(() => {
    if (!wordList.length) {
      setTimedWords([]);
      return;
    }
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

  const handleLoadSrtFile = useCallback(
    async (file) => {
      try {
        setExportError("");
        setExportMessage("Loading SRT…");
        const song = await resolveAudioFile();
        const result = await loadSrtFile(file, song);
        if (result.reader) setSrtReader(result.reader);
        setLyrics(result.lyrics);
        setTimedWords(result.words);
        setOffsetMs(0);
        setExportMessage(
          `✓ ${result.note} Edit SRT to trim junk · Offset if early/late.`
        );
        setStatus("play");
        setMode("play");
      } catch (err) {
        setExportError(err?.message || "Failed to load SRT");
      }
    },
    [resolveAudioFile]
  );

  const handleDownloadSrt = useCallback(() => {
    let srt = "";
    if (srtReader && !srtReader.isEmpty) {
      // Apply global offset into export for convenience
      if (offsetSec) {
        const clone = SrtReader.fromJSON(srtReader.toJSON());
        clone.shift(offsetSec);
        srt = clone.toSrt();
      } else {
        srt = srtReader.toSrt();
      }
    } else {
      const words = timedWords.filter((w) => w.start < UNTAPPED_START / 2);
      if (!words.length) {
        setExportError("No timed words to export as SRT.");
        return;
      }
      srt = wordsToSrt(
        offsetSec
          ? words.map((w) => ({
              ...w,
              start: w.start + offsetSec,
              end: w.end + offsetSec,
            }))
          : words
      );
    }
    const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectTitle || "karaoki").replace(/[^\w\-]+/g, "_")}.srt`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMessage("SRT downloaded.");
  }, [srtReader, timedWords, projectTitle, offsetSec]);

  const hasAutoTimings = useMemo(
    () =>
      timedWords.some(
        (w) =>
          Number.isFinite(w.start) &&
          w.start < UNTAPPED_START / 2 &&
          (w.start > 0.001 || timedWords.length > 3)
      ),
    [timedWords]
  );

  /** Apply one corrective tap: word i starts at t; later words keep relative spacing. */
  const applyCorrectiveTap = useCallback((words, i, t) => {
    const n = words.length;
    if (i < 0 || i >= n) return words;
    const next = words.map((w) => ({ ...w }));
    const oldStart = Number(next[i].start) || 0;
    const delta = t - oldStart;

    // Shift this word and everything after by the same delta (keeps auto rhythm)
    for (let j = i; j < n; j++) {
      next[j] = {
        ...next[j],
        start: Math.max(0, (Number(next[j].start) || 0) + delta),
        end: Math.max(0.05, (Number(next[j].end) || 0) + delta),
      };
    }

    // Snap tapped word to exact now
    next[i] = { ...next[i], text: words[i].text, start: t };

    // End cleanly at next word — NEVER stretch a long hold (that caused "stuck")
    if (i + 1 < n) {
      // If next word landed at/before now, push the remainder slightly after now
      if (next[i + 1].start <= t + 0.06) {
        const push = t + 0.08 - next[i + 1].start;
        for (let j = i + 1; j < n; j++) {
          next[j] = {
            ...next[j],
            start: next[j].start + push,
            end: next[j].end + push,
          };
        }
      }
      next[i].end = Math.max(t + 0.05, next[i + 1].start);
    } else {
      next[i].end = t + 0.28;
    }

    if (i > 0) {
      next[i - 1] = {
        ...next[i - 1],
        end: Math.max(next[i - 1].start + 0.04, Math.min(next[i - 1].end, t)),
      };
    }

    // Light monotonic pass — do not re-stretch durations
    for (let j = 0; j < n - 1; j++) {
      if (next[j].end > next[j + 1].start) {
        next[j].end = next[j + 1].start;
      }
      if (next[j].end <= next[j].start) {
        next[j].end = Math.min(next[j].start + 0.05, next[j + 1].start);
      }
    }
    const last = n - 1;
    if (next[last].end <= next[last].start) {
      next[last].end = next[last].start + 0.2;
    }
    return next;
  }, []);

  /**
   * Tap sync in tandem with SRT/auto timings:
   * - If timings exist → corrective (keep auto; Space = this word now + advance)
   * - Else → full stamp from start
   */
  const handleStartSync = useCallback(async () => {
    const existing = timedWords
      .filter((w) => w.text)
      .map((w) => ({ ...w }));
    if (!existing.length && !wordList.length) {
      setExportError("Upload an SRT first.");
      return;
    }

    const audio = audioRef.current;
    const t0 = audio?.currentTime ?? currentTime ?? 0;
    const corrective =
      existing.length > 0 &&
      existing.some((w) => Number.isFinite(w.start) && w.start < UNTAPPED_START / 2);

    if (corrective) {
      const base = existing.map((w) => ({ ...w }));
      // Start at the word that should be active now (or the next one)
      let startIdx = indexForTime(base, t0);
      if (startIdx < 0) {
        startIdx = 0;
        for (let i = 0; i < base.length; i++) {
          if (base[i].start >= t0 - 0.05) {
            startIdx = i;
            break;
          }
          startIdx = i;
        }
      }

      setSyncBaseWords(base);
      syncBaseRef.current = base;
      setTimedWords(base);
      setSyncIndex(startIdx);
      setIsSyncing(true);
      setStatus("sync");
      setMode("sync");
      setExportError("");
      setExportMessage(
        `Tap correct: Space when you hear “${base[startIdx]?.text}” — then it jumps to the next word.`
      );

      if (audio && audioUrl && audio.paused) {
        try {
          await audio.play();
        } catch {
          setExportError("Press Play, then Space.");
        }
      }
      return;
    }

    const texts = existing.length
      ? existing.map((w) => w.text)
      : wordList;
    const base = texts.map((text) => ({
      text,
      start: UNTAPPED_START,
      end: UNTAPPED_START + 0.05,
    }));
    setSyncBaseWords(base);
    syncBaseRef.current = base;
    setTimedWords(base);
    setSyncIndex(0);
    setIsSyncing(true);
    setStatus("sync");
    setMode("sync");
    setExportMessage("Full tap: Space on each word from the start.");
    setExportError("");

    if (audio && audioUrl) {
      try {
        audio.currentTime = 0;
        setCurrentTime(0);
        await audio.play();
      } catch {
        setExportError("Press Play, then Tap.");
      }
    }
  }, [wordList, timedWords, audioUrl, currentTime]);

  const handleStopSync = useCallback(() => {
    setTimedWords((prev) => {
      const real = prev.filter(
        (w) => w.text && Number.isFinite(w.start) && w.start < UNTAPPED_START / 2
      );
      if (real.length) {
        const sealed = sealWordEnds(real, audioRef.current?.duration || 0);
        const r = SrtReader.fromWords(sealed);
        setSrtReader(r);
        setLyrics(r.lyricsText);
        return sealed;
      }
      return prev;
    });
    setIsSyncing(false);
    setStatus("play");
    setMode("play");
    setExportMessage("Tap correct saved.");
  }, []);

  const handleTap = useCallback(() => {
    if (!isSyncingRef.current) return;
    const audio = audioRef.current;
    const t = Math.max(0, audio?.currentTime ?? currentTime);
    // Always read latest list from ref (updated every tap)
    let base = syncBaseRef.current;
    if (!base?.length) base = timedWordsRef.current || [];
    let i = syncIndexRef.current;

    if (!base.length) return;
    if (i >= base.length) {
      setIsSyncing(false);
      setStatus("play");
      setMode("play");
      return;
    }

    const corrective =
      Number.isFinite(base[i]?.start) && base[i].start < UNTAPPED_START / 2;

    if (corrective) {
      const oldStart = base[i].start;
      const delta = t - oldStart;
      const next = applyCorrectiveTap(base, i, t);
      const nextIdx = i + 1;

      syncBaseRef.current = next;
      timedWordsRef.current = next;
      setSyncBaseWords(next);
      setTimedWords(next);
      setSyncIndex(nextIdx);

      try {
        setSrtReader(SrtReader.fromWords(next));
      } catch {
        /* ignore */
      }

      if (nextIdx >= next.length) {
        setIsSyncing(false);
        setStatus("play");
        setMode("play");
        setExportMessage(
          `Done. Last fix ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}s on “${base[i].text}”.`
        );
      } else {
        setExportMessage(
          `“${base[i].text}” @ ${t.toFixed(2)}s (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}s). Next → “${next[nextIdx].text}”`
        );
      }
      return;
    }

    // Full stamp mode
    const next = base.map((w) => ({ ...w }));
    next[i] = { text: base[i].text, start: t, end: t + 0.35 };
    if (i > 0 && next[i - 1].start < UNTAPPED_START / 2) {
      next[i - 1] = {
        ...next[i - 1],
        end: Math.max(next[i - 1].start + 0.05, t),
      };
    }
    const nextIdx = i + 1;
    syncBaseRef.current = next;
    setSyncBaseWords(next);
    setTimedWords(next);
    setSyncIndex(nextIdx);

    if (nextIdx >= next.length) {
      const sealed = sealWordEnds(next, audio?.duration || 0);
      setTimedWords(sealed);
      setSrtReader(SrtReader.fromWords(sealed));
      setIsSyncing(false);
      setStatus("play");
      setMode("play");
      setExportMessage("Sync complete.");
    }
  }, [currentTime, applyCorrectiveTap]);

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
      // Allow seek during corrective sync (tandem with auto)
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = t;
      setCurrentTime(t);
      if (isSyncingRef.current && syncBaseRef.current?.length) {
        // Re-anchor corrective index to the seek position
        const base = syncBaseRef.current;
        let startIdx = 0;
        for (let i = 0; i < base.length; i++) {
          if (base[i].start <= t + 0.05) startIdx = i;
          if (base[i].start > t + 0.15) break;
        }
        setSyncIndex(startIdx);
      }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <button
            type="button"
            className="btn btn-export"
            onClick={handleExport}
            disabled={!canExport || exporting}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      <main className="studio studio-clean">
        <aside className="panel panel-left glass-panel">
          <div className="panel-body">
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
            <LyricsEditor
              onClear={handleClearLyrics}
              onLoadSrtFile={handleLoadSrtFile}
              onDownloadSrt={handleDownloadSrt}
              onOpenEditor={() => setShowSrtEditor(true)}
              timedCount={timedWords.filter((w) => w.start < UNTAPPED_START / 2).length}
              hasReader={Boolean(srtReader && !srtReader.isEmpty)}
            />
            <EffectsPicker value={stageEffect} onChange={setStageEffect} />
            <SyncToolbar
              isSyncing={isSyncing}
              syncMode={
                isSyncing
                  ? hasAutoTimings ||
                    syncBaseWords.some((w) => w.start < UNTAPPED_START / 2)
                    ? "corrective"
                    : "full"
                  : null
              }
              syncIndex={syncIndex}
              totalWords={syncBaseWords.length || timedWords.length}
              nextWord={
                isSyncing && syncBaseWords[syncIndex]
                  ? syncBaseWords[syncIndex].text
                  : null
              }
              offsetMs={offsetMs}
              onOffsetChange={setOffsetMs}
              onStartSync={handleStartSync}
              onStopSync={handleStopSync}
              onTap={handleTap}
              hasAudio={Boolean(audioUrl)}
              hasWords={wordList.length > 0 || timedWords.length > 0}
              hasAutoTimings={hasAutoTimings || Boolean(srtReader && !srtReader.isEmpty)}
            />
            {(exportError || exportMessage || shareMessage || downloadUrl || exporting) && (
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
            )}
          </div>
        </aside>

        <section className="panel panel-center glass-panel">
          <div className="stage-wrap">
            {srtReader && !srtReader.isEmpty ? (
              <SrtReaderView
                reader={srtReader}
                currentTime={currentTime}
                offsetSec={offsetSec}
                imageUrl={imageUrl}
                stockBg={stockBackground(stockImageId)}
                effect={stageEffect}
              />
            ) : (
              <div className="stage-with-fx">
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
                <FallingEffects effect={stageEffect} />
              </div>
            )}
            <KaraokePlayer
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onTogglePlay={togglePlay}
              onSeek={handleSeek}
              disabled={!audioUrl}
              activeWordIndex={activeWordIndex}
              totalWords={displayWords.length}
              seekDisabled={isSyncing}
            />
          </div>
        </section>
      </main>

      {showSrtEditor && srtReader && (
        <div className="modal-backdrop" onClick={() => setShowSrtEditor(false)}>
          <div className="modal-sheet glass-panel" onClick={(e) => e.stopPropagation()}>
            <SrtEditor
              reader={srtReader}
              onChange={handleSrtReaderChange}
              onClose={() => setShowSrtEditor(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
