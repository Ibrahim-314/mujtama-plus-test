/* Speech-to-text adapter (Phase 14): Arabic transcription through any OpenAI-compatible
 * /audio/transcriptions endpoint — OpenAI Whisper (OPENAI_API_KEY) or a self-hosted
 * faster-whisper / whisper.cpp server (WHISPER_URL). Without either, transcription is "unavailable". */
const fs = require("node:fs"); const { secret } = require("./secrets");
function createASR() {
  const url = process.env.WHISPER_URL || (secret("OPENAI_API_KEY") ? "https://api.openai.com/v1/audio/transcriptions" : null);
  const key = secret("OPENAI_API_KEY") || secret("WHISPER_API_KEY");
  return {
    available: !!url,
    async transcribe(file, { lang = "ar" } = {}) {
      if (!url) return null;
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(file)]), "audio.m4a"); form.append("model", process.env.WHISPER_MODEL || "whisper-1"); form.append("language", lang); form.append("response_format", "verbose_json");
      const r = await fetch(url, { method: "POST", body: form, headers: key ? { Authorization: "Bearer " + key } : {} });
      if (!r.ok) throw new Error("asr " + r.status);
      const j = await r.json();
      return { text: j.text || "", segments: (j.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text })) };
    }
  };
}
module.exports = { createASR };
