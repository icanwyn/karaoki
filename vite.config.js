import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Local dev mirror of /api/transcribe (OpenAI Whisper with word timestamps).
 */
function transcribeDevApi(env) {
  return {
    name: "transcribe-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/transcribe")) return next();

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const apiKey = env.OPENAI_API_KEY;
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "not_configured",
              message:
                "OPENAI_API_KEY not configured — client will use on-device Whisper",
            })
          );
          return;
        }

        try {
          // Reuse the same handler logic by dynamic import of the api module is awkward
          // in ESM middleware; implement a thin OpenAI proxy here.
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const rawBody = Buffer.concat(chunks);
          const contentType = req.headers["content-type"] || "";

          // Forward multipart body as-is to OpenAI when possible
          // Rebuild FormData from buffer is complex; parse file field simply:
          const parsed = parseMultipart(rawBody, contentType);
          if (!parsed?.buffer?.length) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "missing_file", message: "Audio file required" }));
            return;
          }

          const form = new FormData();
          form.append(
            "file",
            new Blob([parsed.buffer], {
              type: parsed.contentType || "audio/mpeg",
            }),
            parsed.filename || "audio.mp3"
          );
          form.append("model", "whisper-1");
          form.append("response_format", "verbose_json");
          form.append("timestamp_granularities[]", "word");

          const openaiRes = await fetch(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: form,
            }
          );
          const text = await openaiRes.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: text };
          }

          if (!openaiRes.ok) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "openai_error",
                message: data?.error?.message || String(text).slice(0, 400),
              })
            );
            return;
          }

          const words = (data.words || [])
            .map((w) => ({
              text: String(w.word || w.text || "").trim(),
              start: Number(w.start) || 0,
              end: Number(w.end) || 0,
            }))
            .filter((w) => w.text);

          const lyrics = wordsToLyrics(words);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              text: data.text || "",
              words,
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
      });
    },
  };
}

function wordsToLyrics(words) {
  if (!words?.length) return "";
  const lines = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i].text);
    const gap =
      i + 1 < words.length
        ? words[i + 1].start - words[i].end
        : Number.POSITIVE_INFINITY;
    if (gap > 0.55 || buf.length >= 8 || i === words.length - 1) {
      lines.push(buf.join(" "));
      buf = [];
    }
  }
  return lines.join("\n");
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) {
    return {
      buffer,
      filename: "audio.mp3",
      contentType: contentType || "application/octet-stream",
    };
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
      if (/name="file"/i.test(headers)) {
        const nameMatch = /filename="([^"]*)"/i.exec(headers);
        const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
        return {
          buffer: slice.subarray(headerEnd + 4),
          filename: nameMatch?.[1] || "audio.mp3",
          contentType: typeMatch?.[1]?.trim() || "application/octet-stream",
        };
      }
    }
    start = next === -1 ? buffer.length : next + sep.length;
  }
  return null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), transcribeDevApi(env)],
    optimizeDeps: {
      exclude: ["@huggingface/transformers"],
    },
    worker: {
      format: "es",
    },
  };
});
