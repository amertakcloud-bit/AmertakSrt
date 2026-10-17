'use strict';
const path = require('node:path');
const os = require('node:os');

// Node 20.12+ អាចអាន .env ដោយខ្លួនឯង (មិនត្រូវការ dotenv)
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[config] មិនអាចអាន .env បាន:', err.code || err.name);
}

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

module.exports = {
  port: int(process.env.PORT, 5000),
  defaultApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  maxFileBytes: int(process.env.MAX_FILE_MB, 100) * 1024 * 1024,
  maxAudioSeconds: int(process.env.MAX_AUDIO_MINUTES, 120) * 60,
  transcribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
  fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash',
  chunkSeconds: Math.min(int(process.env.CHUNK_SECONDS, 1500), 1700),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 30),
  tmpDir: path.join(os.tmpdir(), 'khmer-subtitle-studio'),
  ffmpegPath: process.env.FFMPEG_PATH || '',
  allowedExtensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm', '.aiff', '.aif', '.mp4'],
};
