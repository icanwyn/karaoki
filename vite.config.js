import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { charactersToWords } from "./api/tts-shared.js";

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

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
              message: "Set ELEVENLABS_API_KEY in .env.local",
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
          const isStory = body.style === "story";
          const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
          const models = [
            "eleven_flash_v2_5",
            "eleven_turbo_v2_5",
            "eleven_multilingual_v2",
          ];

          let data = null;
          let lastErr = "";
          for (const model_id of models) {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "xi-api-key": apiKey,
                Accept: "application/json",
              },
              body: JSON.stringify({
                text,
                model_id,
                voice_settings: {
                  stability: isStory ? 0.42 : 0.55,
                  similarity_boost: 0.78,
                  style: isStory ? 0.35 : 0.15,
                  use_speaker_boost: true,
                },
              }),
            });
            if (response.ok) {
              data = await response.json();
              break;
            }
            lastErr = await response.text();
          }

          if (!data) {
            res.statusCode = 402;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "elevenlabs_error",
                message: String(lastErr).slice(0, 500),
              })
            );
            return;
          }

          const a = charactersToWords(data.alignment);
          const n = charactersToWords(data.normalized_alignment);
          const target = text.trim().split(/\s+/).length;
          const words =
            n.length && Math.abs(n.length - target) <= Math.abs(a.length - target)
              ? n
              : a.length
                ? a
                : n;

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              audioBase64: data.audio_base64,
              contentType: "audio/mpeg",
              words,
              voiceId,
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
