import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Local dev mirror of /api/transcribe — returns SRT from OpenAI or Groq.
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

        const groqKey = env.GROQ_API_KEY;
        const openaiKey = env.OPENAI_API_KEY;
        if (!groqKey && !openaiKey) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "not_configured",
              message: "Set GROQ_API_KEY or OPENAI_API_KEY in .env.local",
            })
          );
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const rawBody = Buffer.concat(chunks);
          const parsed = parseMultipart(rawBody, req.headers["content-type"] || "");
          if (!parsed?.buffer?.length) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "missing_file" }));
            return;
          }

          const providers = [];
          if (groqKey) {
            providers.push({
              name: "groq",
              url: "https://api.groq.com/openai/v1/audio/transcriptions",
              key: groqKey,
              model: "whisper-large-v3",
            });
          }
          if (openaiKey) {
            providers.push({
              name: "openai",
              url: "https://api.openai.com/v1/audio/transcriptions",
              key: openaiKey,
              model: "whisper-1",
            });
          }

          let srt = "";
          let provider = "";
          let lastErr = "";
          for (const p of providers) {
            try {
              const form = new FormData();
              form.append(
                "file",
                new Blob([parsed.buffer], { type: parsed.contentType || "audio/wav" }),
                parsed.filename || "audio.wav"
              );
              form.append("model", p.model);
              form.append("response_format", "srt");
              if (parsed.prompt) form.append("prompt", parsed.prompt.slice(0, 800));

              const openaiRes = await fetch(p.url, {
                method: "POST",
                headers: { Authorization: `Bearer ${p.key}` },
                body: form,
              });
              const text = await openaiRes.text();
              if (!openaiRes.ok) {
                lastErr = text.slice(0, 200);
                continue;
              }
              srt = text.trim();
              provider = p.name;
              break;
            } catch (e) {
              lastErr = e?.message || String(e);
            }
          }

          if (!srt) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "transcription_failed", message: lastErr }));
            return;
          }

          // Minimal SRT → words (same as server)
          const words = [];
          for (const block of srt.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
            const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
            if (!lines.length) continue;
            let i = 0;
            if (/^\d+$/.test(lines[0])) i = 1;
            if (i >= lines.length || !lines[i].includes("-->")) continue;
            const [a, b] = lines[i].split(/\s*-->\s*/);
            const start = parseTs(a);
            const end = parseTs((b || "").split(/\s+/)[0]);
            const cue = lines.slice(i + 1).join(" ");
            const tokens = cue.split(/\s+/).filter(Boolean);
            const span = Math.max(0.12 * tokens.length, end - start);
            const step = span / tokens.length;
            tokens.forEach((tok, k) => {
              const s = start + k * step;
              words.push({ text: tok, start: s, end: s + step * 0.9 });
            });
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              provider,
              srt,
              words,
              text: words.map((w) => w.text).join(" "),
              lyrics: words.map((w) => w.text).join(" "),
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "server_error", message: err?.message }));
        }
      });
    },
  };
}

function parseTs(ts) {
  const s = String(ts || "").trim().replace(",", ".");
  const p = s.split(":");
  if (p.length === 3) return (+p[0] || 0) * 3600 + (+p[1] || 0) * 60 + (+p[2] || 0);
  if (p.length === 2) return (+p[0] || 0) * 60 + (+p[1] || 0);
  return +s || 0;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) {
    return { buffer, filename: "audio.wav", contentType: "audio/wav", prompt: "" };
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const sep = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(sep) + sep.length;
  const out = { buffer: null, filename: "audio.wav", contentType: "audio/wav", prompt: "" };
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(sep, start);
    const end = next === -1 ? buffer.length : next;
    let slice = buffer.subarray(start, end);
    if (slice.length >= 2 && slice[slice.length - 2] === 13 && slice[slice.length - 1] === 10) {
      slice = slice.subarray(0, slice.length - 2);
    }
    let headerEnd = -1;
    for (let i = 0; i < slice.length - 3; i++) {
      if (slice[i] === 13 && slice[i + 1] === 10 && slice[i + 2] === 13 && slice[i + 3] === 10) {
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
        out.buffer = body;
        out.filename = fn?.[1] || "audio.wav";
        out.contentType = typeMatch?.[1]?.trim() || "audio/wav";
      } else if (name === "prompt") {
        out.prompt = body.toString("utf8").replace(/\0/g, "").trim();
      }
    }
    start = next === -1 ? buffer.length : next + sep.length;
  }
  return out.buffer ? out : null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), transcribeDevApi(env)],
  };
});
