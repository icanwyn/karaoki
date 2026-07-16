/**
 * Vercel serverless: ElevenLabs TTS with character alignment for karaoke.
 * Set ELEVENLABS_API_KEY in Vercel project env (and optionally ELEVENLABS_VOICE_ID).
 */

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel — calm, clear narration

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

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
      message:
        "ELEVENLABS_API_KEY is not configured. Add it in Vercel env or .env.local.",
    });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const text = (body.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    // Cap length for cost/latency
    const clipped = text.slice(0, 2500);
    const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      body: JSON.stringify({
        text: clipped,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: "elevenlabs_error",
        message: errText.slice(0, 500),
      });
    }

    const data = await response.json();
    const words = charactersToWords(data.alignment || data.normalized_alignment);

    return res.status(200).json({
      audioBase64: data.audio_base64,
      contentType: "audio/mpeg",
      words,
      alignment: data.alignment,
    });
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "TTS failed",
    });
  }
}
