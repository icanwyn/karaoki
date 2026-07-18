/**
 * Compress audio for serverless upload (Vercel hobby body limit ~4.5MB).
 * Outputs mono PCM WAV at a sample rate chosen to fit under maxBytes.
 */

const MAX_UPLOAD_BYTES = 3.2 * 1024 * 1024; // stay under 4.5MB with form overhead

/**
 * @param {File|Blob} file
 * @param {{
 *   onProgress?: (p: { progress: number, status: string }) => void,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<{ blob: Blob, filename: string, duration: number, sampleRate: number }>}
 */
export async function compressAudioForUpload(file, opts = {}) {
  const { onProgress, signal } = opts;
  onProgress?.({ progress: 0.05, status: "Decoding audio for upload…" });
  throwIfAborted(signal);

  const ab = await file.arrayBuffer();
  throwIfAborted(signal);

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(ab.slice(0));
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }

  const duration = decoded.duration || decoded.length / decoded.sampleRate;
  onProgress?.({ progress: 0.35, status: "Compressing to mono WAV…" });
  await yieldToUi();
  throwIfAborted(signal);

  // Choose sample rate so PCM fits limit
  // bytes ≈ sampleRate * 2 * duration
  let sampleRate = 16000;
  const maxRate = Math.floor(MAX_UPLOAD_BYTES / (2 * Math.max(1, duration)));
  if (maxRate < 16000) sampleRate = Math.max(8000, maxRate);
  if (maxRate < 8000) {
    // truncate duration to fit 8kHz
    sampleRate = 8000;
  }

  const maxSamples = Math.floor(MAX_UPLOAD_BYTES / 2);
  const targetLen = Math.min(
    Math.floor(duration * sampleRate),
    maxSamples
  );

  // Mix mono
  const ch = decoded.numberOfChannels;
  const srcLen = decoded.length;
  const mono = new Float32Array(srcLen);
  for (let c = 0; c < ch; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < srcLen; i++) mono[i] += data[i] / ch;
  }

  // Resample
  const ratio = decoded.sampleRate / sampleRate;
  const samples = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(srcLen - 1, i0 + 1);
    const t = src - i0;
    samples[i] = mono[i0] * (1 - t) + mono[i1] * t;
  }

  onProgress?.({ progress: 0.7, status: "Encoding WAV…" });
  await yieldToUi();

  const wav = encodeWav(samples, sampleRate);
  const blob = new Blob([wav], { type: "audio/wav" });

  onProgress?.({
    progress: 1,
    status: `Ready (${(blob.size / 1024 / 1024).toFixed(1)} MB, ${sampleRate} Hz)`,
  });

  return {
    blob,
    filename: "karaoke-upload.wav",
    duration: targetLen / sampleRate,
    sampleRate,
    originalDuration: duration,
    truncated: targetLen / sampleRate < duration - 0.5,
  };
}

/**
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
function encodeWav(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function yieldToUi() {
  return new Promise((r) => setTimeout(r, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
