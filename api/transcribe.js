/**
 * Server transcription → SRT + word timings.
 *
 * Providers (first available):
 * 1. GROQ_API_KEY  → free-tier Whisper large-v3 (fast)
 * 2. OPENAI_API_KEY → whisper-1
 *
 * Always returns { text, srt, words, provider }.
 */

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const MAX_BYTES = 4.2 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed" });
    return;
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!groqKey && !openaiKey) {
    json(res, 503, {
      error: "not_configured",
      message:
        "Set GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY on Vercel.",
    });
    return;
  }

  try {
    const parts = await readMultipart(req);
    const filePart = parts.file;
    if (!filePart?.buffer?.length) {
      json(res, 400, { error: "missing_file", message: "Audio file required" });
      return;
    }
    if (filePart.buffer.length > MAX_BYTES) {
      json(res, 413, {
        error: "file_too_large",
        message: `Audio too large (${(filePart.buffer.length / 1024 / 1024).toFixed(1)}MB). App should compress first.`,
      });
      return;
    }

    const prompt = String(parts.fields.prompt || "").trim().slice(0, 800);
    const format = String(parts.fields.format || "srt").toLowerCase(); // srt | verbose

    let result;
    let lastErr = "";

    // Prefer Groq (free, fast) when configured
    if (groqKey) {
      try {
        result = await runWhisperApi({
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model: "whisper-large-v3",
          filePart,
          prompt,
          format,
          provider: "groq",
        });
      } catch (e) {
        lastErr = e?.message || String(e);
        console.error("[transcribe] groq failed", lastErr);
      }
    }

    if (!result && openaiKey) {
      try {
        result = await runWhisperApi({
          baseUrl: "https://api.openai.com/v1",
          apiKey: openaiKey,
          model: "whisper-1",
          filePart,
          prompt,
          format,
          provider: "openai",
        });
      } catch (e) {
        lastErr = e?.message || String(e);
        console.error("[transcribe] openai failed", lastErr);
      }
    }

    if (!result) {
      json(res, 502, {
        error: "transcription_failed",
        message: lastErr || "All providers failed",
      });
      return;
    }

    json(res, 200, result);
  } catch (err) {
    console.error("[transcribe]", err);
    json(res, 500, {
      error: "server_error",
      message: err?.message || "Transcription failed",
    });
  }
}

async function runWhisperApi({
  baseUrl,
  apiKey,
  model,
  filePart,
  prompt,
  format,
  provider,
}) {
  // Prefer SRT — simple, widely supported, has phrase timestamps
  const form = new FormData();
  const blob = new Blob([filePart.buffer], {
    type: filePart.contentType || "audio/wav",
  });
  form.append("file", blob, filePart.filename || "audio.wav");
  form.append("model", model);
  form.append("response_format", "srt");
  if (prompt) form.append("prompt", prompt);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) {
    let msg = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* keep */
    }
    throw new Error(`${provider}: ${msg}`);
  }

  // Groq/OpenAI with response_format=srt return plain text SRT
  const srt = raw.trim();
  if (!srt || (!srt.includes("-->") && srt.length < 10)) {
    // Some providers might still return JSON — try parse
    try {
      const j = JSON.parse(raw);
      if (j.text) {
        return {
          provider,
          text: j.text,
          srt: textToRoughSrt(j.text),
          words: textToRoughWords(j.text),
        };
      }
    } catch {
      /* fall through */
    }
    throw new Error(`${provider}: empty SRT response`);
  }

  const words = srtToWordsServer(srt);
  const text = words.map((w) => w.text).join(" ");

  return {
    provider,
    text,
    srt,
    words,
    lyrics: wordsToLines(words),
  };
}

function srtToWordsServer(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  const blocks = text.split(/\n\s*\n/);
  const words = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    if (i >= lines.length) continue;
    const timeLine = lines[i];
    if (!timeLine.includes("-->")) continue;
    const [a, b] = timeLine.split(/\s*-->\s*/);
    const start = parseTs(a);
    const end = parseTs((b || "").split(/\s+/)[0]);
    const cueText = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!cueText) continue;
    const tokens = cueText.split(/\s+/).filter(Boolean);
    const span = Math.max(0.12 * tokens.length, (end || start + 1) - start);
    const step = span / tokens.length;
    tokens.forEach((tok, k) => {
      const s = start + k * step;
      words.push({
        text: tok.replace(/^["'([{]+|["',.!?;:)\]}]+$/g, "") || tok,
        start: s,
        end: s + Math.max(0.06, step * 0.9),
      });
    });
  }
  return words;
}

function parseTs(ts) {
  const s = String(ts || "")
    .trim()
    .replace(",", ".");
  const p = s.split(":");
  if (p.length === 3) {
    return (
      (Number(p[0]) || 0) * 3600 +
      (Number(p[1]) || 0) * 60 +
      (Number(p[2]) || 0)
    );
  }
  if (p.length === 2) return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
  return Number(s) || 0;
}

function wordsToLines(words) {
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    const gap =
      i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    if (gap > 0.55 || buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

function textToRoughSrt(text) {
  const words = text.split(/\s+/).filter(Boolean);
  // fake 0.35s/word
  let t = 0;
  let out = "";
  let n = 1;
  for (let i = 0; i < words.length; i += 8) {
    const chunk = words.slice(i, i + 8);
    const start = t;
    const end = t + chunk.length * 0.35;
    out += `${n++}\n${fmt(start)} --> ${fmt(end)}\n${chunk.join(" ")}\n\n`;
    t = end + 0.2;
  }
  return out;
}

function textToRoughWords(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({
      text: w,
      start: i * 0.35,
      end: i * 0.35 + 0.3,
    }));
}

function fmt(sec) {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

async function readMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const out = { file: null, fields: {} };
  if (!boundaryMatch) {
    out.file = {
      buffer,
      filename: "audio.wav",
      contentType: "application/octet-stream",
    };
    return out;
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const sep = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(sep) + sep.length;
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(sep, start);
    const end = next === -1 ? buffer.length : next;
    let slice = buffer.subarray(start, end);
    if (
      slice.length >= 2 &&
      slice[slice.length - 2] === 13 &&
      slice[slice.length - 1] === 10
    ) {
      slice = slice.subarray(0, slice.length - 2);
    }
    let headerEnd = -1;
    for (let i = 0; i < slice.length - 3; i++) {
      if (
        slice[i] === 13 &&
        slice[i + 1] === 10 &&
        slice[i + 2] === 13 &&
        slice[i + 3] === 10
      ) {
        headerEnd = i;
        break;
      }
    }
    if (headerEnd !== -1) {
      const headers = slice.subarray(0, headerEnd).toString("utf8");
      const body = slice.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/i.exec(headers);
      const name = nameMatch?.[1];
      if (name === "file") {
        const fn = /filename="([^"]*)"/i.exec(headers);
        const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
        out.file = {
          buffer: body,
          filename: fn?.[1] || "audio.wav",
          contentType: typeMatch?.[1]?.trim() || "audio/wav",
        };
      } else if (name) {
        out.fields[name] = body.toString("utf8").replace(/\0/g, "").trim();
      }
    }
    start = next === -1 ? buffer.length : next + sep.length;
  }
  return out;
}
