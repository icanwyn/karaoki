import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

function charactersToWords(alignment) {
  if (!alignment?.characters?.length) return [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let current = "";
  let start = null;
  let end = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const s = starts[i] ?? 0;
    const e = ends[i] ?? s;
    if (/\s/.test(ch)) {
      if (current) {
        words.push({ word: current, start, end });
        current = "";
        start = null;
        end = null;
      }
      continue;
    }
    if (!current) start = s;
    current += ch;
    end = e;
  }
  if (current) words.push({ word: current, start, end });
  return words;
}

/** Local dev middleware mirroring /api/tts for ElevenLabs */
function elevenLabsDevApi(env) {
  return {
    name: "elevenlabs-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/tts")) return next();

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

        const apiKey = env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "missing_api_key",
              message:
                "Set ELEVENLABS_API_KEY in .env.local for ElevenLabs (browser voice will be used as fallback).",
            })
          );
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};
          const text = (body.text || "").trim().slice(0, 2500);
          if (!text) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "text is required" }));
            return;
          }

          const voiceId =
            body.voiceId || env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
          const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": apiKey,
              Accept: "application/json",
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.55,
                similarity_boost: 0.75,
                style: 0.15,
                use_speaker_boost: true,
              },
            }),
          });

          const data = await response.json().catch(async () => ({
            message: await response.text(),
          }));

          if (!response.ok) {
            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "elevenlabs_error",
                message: String(data.message || data.detail || "TTS failed").slice(
                  0,
                  500
                ),
              })
            );
            return;
          }

          const words = charactersToWords(
            data.alignment || data.normalized_alignment
          );
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              audioBase64: data.audio_base64,
              contentType: "audio/mpeg",
              words,
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "server_error",
              message: err?.message || "TTS failed",
            })
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), elevenLabsDevApi(env)],
  };
});
