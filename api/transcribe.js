/**
 * Vercel serverless: OpenAI Whisper transcription with word timestamps.
 * Requires OPENAI_API_KEY. Without it, the client falls back to browser Whisper.
 *
 * POST multipart/form-data with field "file" (audio).
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BYTES = 24 * 1024 * 1024; // Whisper limit ~25MB

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
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "not_configured",
        message: "OPENAI_API_KEY not configured — client will use on-device Whisper",
      })
    );
    return;
  }

  try {
    const { buffer, filename, contentType } = await readMultipartFile(req);
    if (!buffer?.length) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "missing_file", message: "Audio file is required" }));
      return;
    }
    if (buffer.length > MAX_BYTES) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "file_too_large",
          message: "Audio must be under 24MB for server transcription. Try browser mode or compress the file.",
        })
      );
      return;
    }

    const form = new FormData();
    const blob = new Blob([buffer], { type: contentType || "audio/mpeg" });
    form.append("file", blob, filename || "audio.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const raw = await openaiRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }

    if (!openaiRes.ok) {
      res.statusCode = openaiRes.status === 401 ? 401 : 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "openai_error",
          message: data?.error?.message || String(raw).slice(0, 400),
        })
      );
      return;
    }

    const words = (data.words || []).map((w) => ({
      text: String(w.word || w.text || "").trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    })).filter((w) => w.text);

    // Fallback: distribute segment timings if word-level missing
    let timed = words;
    if (!timed.length && Array.isArray(data.segments)) {
      timed = [];
      for (const seg of data.segments) {
        const tokens = String(seg.text || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (!tokens.length) continue;
        const s = Number(seg.start) || 0;
        const e = Number(seg.end) || s + tokens.length * 0.3;
        const step = Math.max(0.05, (e - s) / tokens.length);
        tokens.forEach((tok, i) => {
          timed.push({
            text: tok,
            start: s + i * step,
            end: s + (i + 1) * step,
          });
        });
      }
    }

    const lyrics = wordsToLyrics(timed);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        text: data.text || "",
        words: timed,
        lyrics,
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "server_error",
        message: err?.message || "Transcription failed",
      })
    );
  }
}

function wordsToLyrics(words) {
  if (!words?.length) return "";
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    const gap =
      i + 1 < words.length ? words[i + 1].start - words[i].end : Number.POSITIVE_INFINITY;
    if (gap > 0.55 || buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

/**
 * Minimal multipart parser for a single file field named "file".
 */
async function readMultipartFile(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    // Raw body fallback
    return {
      buffer,
      filename: "audio.mp3",
      contentType: contentType || "application/octet-stream",
    };
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const parts = splitMultipart(buffer, boundary);
  for (const part of parts) {
    if (!/name="file"/i.test(part.headers)) continue;
    const nameMatch = /filename="([^"]*)"/i.exec(part.headers);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(part.headers);
    return {
      buffer: part.body,
      filename: nameMatch?.[1] || "audio.mp3",
      contentType: typeMatch?.[1]?.trim() || "application/octet-stream",
    };
  }
  return { buffer: null, filename: null, contentType: null };
}

function splitMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(sep) + sep.length;
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break; // --
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(sep, start);
    const end = next === -1 ? buffer.length : next;
    let slice = buffer.subarray(start, end);
    // trim trailing CRLF
    if (slice.length >= 2 && slice[slice.length - 2] === 13 && slice[slice.length - 1] === 10) {
      slice = slice.subarray(0, slice.length - 2);
    }
    const headerEnd = indexOfDoubleCrlf(slice);
    if (headerEnd !== -1) {
      const headers = slice.subarray(0, headerEnd).toString("utf8");
      const body = slice.subarray(headerEnd + 4);
      parts.push({ headers, body });
    }
    start = next === -1 ? buffer.length : next + sep.length;
  }
  return parts;
}

function indexOfDoubleCrlf(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}
