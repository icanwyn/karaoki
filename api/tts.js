/**
 * Vercel serverless: ElevenLabs TTS with character alignment for karaoke.
 * Env: ELEVENLABS_API_KEY
 */

import { charactersToWords } from "./tts-shared.js";

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George — warm storyteller

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "missing_api_key",
      message: "ELEVENLABS_API_KEY is not configured.",
    });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const text = (body.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const clipped = text.slice(0, 2500);
    const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
    const isStory = body.style === "story";

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;

    // Prefer flash (cheapest), then turbo, then multilingual
    const models = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"];
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
          text: clipped,
          model_id,
          voice_settings: {
            // Storytelling: a bit more expressive, steady
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
      // try next model
    }

    if (!data) {
      return res.status(402).json({
        error: "elevenlabs_error",
        message: String(lastErr).slice(0, 500),
      });
    }

    const alignment = data.normalized_alignment || data.alignment;
    let words = charactersToWords(alignment);

    // Prefer normalized if it produced more sensible word count
    if (data.alignment && data.normalized_alignment) {
      const a = charactersToWords(data.alignment);
      const n = charactersToWords(data.normalized_alignment);
      const target = clipped.trim().split(/\s+/).length;
      words =
        Math.abs(n.length - target) <= Math.abs(a.length - target) ? n : a;
    }

    return res.status(200).json({
      audioBase64: data.audio_base64,
      contentType: "audio/mpeg",
      words,
      voiceId,
    });
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "TTS failed",
    });
  }
}
