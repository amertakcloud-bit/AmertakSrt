'use strict';
const config = require('../config');
const { AppError, redact } = require('../utils/errors');
const { parseTime } = require('../utils/time');

// Google មានទម្រង់ Key ច្រើន ("AIza…" ចាស់, "AQ.…" ថ្មី) ដូច្នេះ Validate តែទម្រង់ទូទៅ។
// ភាពត្រឹមត្រូវពិតប្រាកដត្រូវបានពិនិត្យដោយ Gemini (models.get)។
// មិនកំណត់ Prefix ទេ (AIza…, AQ.…, ឬទម្រង់ថ្មីៗ) — ពិនិត្យតែថាមិនមានដកឃ្លា/តួអក្សរចម្លែក។
const KEY_PATTERN = /^[\x21-\x7E]{8,512}$/;
let SDK;

function loadSdk() {
  if (!SDK) {
    try {
      SDK = require('@google/genai');
    } catch {
      throw new AppError(500, 'SDK_MISSING', 'មិនទាន់ដំឡើង @google/genai។ រត់ "npm install" ជាមុន។');
    }
  }
  return SDK;
}

function checkKeyFormat(key) {
  if (!key || !KEY_PATTERN.test(key)) {
    throw new AppError(401, 'INVALID_API_KEY_FORMAT', 'Gemini API Key មិនត្រឹមត្រូវ (ខ្លីពេក ឬមានដកឃ្លា/តួអក្សរចម្លែក)។ សូមចម្លងឱ្យគ្រប់។');
  }
}

/** Key របស់អ្នកប្រើ (បើមាន) → ជំនួស Key ក្នុង .env */
function resolveKey(userKey) {
  const key = (userKey || '').trim() || config.defaultApiKey;
  if (!key) {
    throw new AppError(401, 'NO_API_KEY', 'មិនមាន Gemini API Key។ បញ្ចូល Key ក្នុង UI ឬកំណត់ GEMINI_API_KEY ក្នុង .env។');
  }
  checkKeyFormat(key);
  return { key, source: (userKey || '').trim() ? 'user' : 'server' };
}

function createClient(key) {
  const { GoogleGenAI } = loadSdk();
  return new GoogleGenAI({ apiKey: key });
}

/** បម្លែង Error ពី SDK → AppError ដែលមិនលេច Key */
function mapError(err) {
  if (err instanceof AppError) return err;
  const raw = redact(err?.message || String(err));
  const status = Number(err?.status || err?.code) || 0;
  const lower = raw.toLowerCase();
  if (status === 401 || lower.includes('api key not valid') || lower.includes('api_key_invalid') || (status === 400 && lower.includes('api key'))) {
    return new AppError(401, 'INVALID_API_KEY', 'Gemini API Key មិនត្រឹមត្រូវ ឬផុតកំណត់។');
  }
  if (status === 403) return new AppError(403, 'KEY_FORBIDDEN', 'Key នេះគ្មានសិទ្ធិប្រើ Model/API នេះ (403)។');
  if (status === 429) return new AppError(429, 'QUOTA_EXCEEDED', 'លើស Quota/Rate limit របស់ Gemini។ សូមរង់ចាំបន្តិច ឬប្តូរ Key។');
  if (status === 404) return new AppError(502, 'MODEL_NOT_FOUND', 'រក Model មិនឃើញ ឬ Key មិនអាចប្រើ Model នេះ។', raw.slice(0, 300));
  if (status >= 500 || status === 503) return new AppError(503, 'GEMINI_UNAVAILABLE', 'Gemini បណ្តោះអាសន្នមិនអាចប្រើបាន។ សូមសាកល្បងម្តងទៀត។');
  return new AppError(502, 'GEMINI_ERROR', 'Gemini បញ្ជូនកំហុស៖ ' + raw.slice(0, 300));
}

/** Validate Key ដោយហៅ models.get (មិនគិតថ្លៃ) */
async function validateKey(userKey) {
  const { key, source } = resolveKey(userKey);
  const client = createClient(key);
  try {
    await client.models.get({ model: config.transcribeModel });
  } catch (err) {
    const mapped = mapError(err);
    // Key ត្រឹមត្រូវ តែ Model មិនមាន → ព្យាយាម Fallback model
    if (mapped.code === 'MODEL_NOT_FOUND') {
      await client.models.get({ model: config.fallbackModel }).catch((e) => {
        throw mapError(e);
      });
      return { valid: true, source, model: config.fallbackModel, note: `Model "${config.transcribeModel}" មិនអាចប្រើបានជាមួយ Key នេះ — នឹងប្រើ "${config.fallbackModel}"។` };
    }
    throw mapped;
  }
  return { valid: true, source, model: config.transcribeModel };
}

async function uploadAudio(client, filePath, mimeType) {
  let file = await client.files.upload({ file: filePath, config: { mimeType } });
  for (let i = 0; i < 60 && file.state && String(file.state) === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    file = await client.files.get({ name: file.name });
  }
  if (file.state && String(file.state) === 'FAILED') throw new AppError(502, 'UPLOAD_FAILED', 'Gemini មិនអាចដំណើរការឯកសារ Audio បានទេ។');
  return file;
}

async function deleteRemote(client, file) {
  try {
    if (file?.name) await client.files.delete({ name: file.name });
  } catch {
    /* Gemini នឹងលុបដោយស្វ័យប្រវត្តិក្រោយ 48 ម៉ោង */
  }
}

function requireInteractions(client) {
  if (!client.interactions || typeof client.interactions.create !== 'function') {
    throw new AppError(500, 'SDK_OUTDATED', 'កំណែ @google/genai ចាស់ពេក (គ្មាន interactions API)។ រត់ "npm install @google/genai@latest"។');
  }
}

/** ទាញ word_info annotations (+ទ្រង់ទ្រាយ generateContent) ពី Response */
function extractWords(response) {
  const words = [];
  const push = (text, s, e) => {
    const start = parseTime(s);
    const end = parseTime(e);
    if (text != null && start !== null && end !== null) words.push({ text: String(text), start, end });
  };
  for (const step of response?.steps ?? []) {
    for (const content of step?.content ?? []) {
      for (const a of content?.annotations ?? []) {
        if (a?.type === 'word_info') push(a.text ?? a.word, a.start_offset ?? a.startOffset, a.end_offset ?? a.endOffset);
      }
    }
  }
  if (!words.length) {
    for (const cand of response?.candidates ?? []) {
      for (const part of cand?.content?.parts ?? []) {
        for (const w of part?.audioTranscription?.words ?? []) push(w.word, w.startOffset, w.endOffset);
      }
    }
  }
  return words;
}

function extractText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  try {
    if (typeof response?.text === 'string') return response.text;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Transcribe Khmer ដោយ Gemini Transcription model ជាមួយ Word-level timestamps
 * (timestamps ត្រូវបានគណនាដោយ Model ពីសំឡេងពិត — មិនមែនប៉ាន់ស្មានទេ)
 */
async function transcribeWords(client, file) {
  requireInteractions(client);
  const interaction = await client.interactions.create({
    model: config.transcribeModel,
    input: [{ type: 'audio', uri: file.uri, mime_type: file.mimeType }],
    generation_config: {
      transcription_config: {
        mode: { type: 'verbatim', timestamp_granularities: ['word'] },
      },
    },
  });
  return { text: extractText(interaction), words: extractWords(interaction) };
}

const FALLBACK_PROMPT = `Transcribe this Khmer (ភាសាខ្មែរ) audio exactly as spoken, in Khmer script (Unicode). Do not translate. Do not add words that are not spoken.
Split into subtitle segments of one sentence or phrase each (max about 7 seconds).
Return ONLY a JSON array, no markdown. Each item: {"start":"MM:SS.mmm","end":"MM:SS.mmm","text":"..."}.
Timestamps must be the real times in the audio, in order, non-overlapping.`;

/** Fallback: Segment-level timestamps ពី Gemini (ភាពត្រឹមត្រូវទាបជាង Word timestamps) */
async function transcribeSegments(client, file) {
  requireInteractions(client);
  const interaction = await client.interactions.create({
    model: config.fallbackModel,
    input: [
      { type: 'text', text: FALLBACK_PROMPT },
      { type: 'audio', uri: file.uri, mime_type: file.mimeType },
    ],
  });
  const raw = extractText(interaction).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    try {
      arr = m ? JSON.parse(m[0]) : null;
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) throw new AppError(502, 'BAD_MODEL_OUTPUT', 'Gemini មិនបានត្រឡប់ JSON ត្រឹមត្រូវ។');
  return arr
    .map((s) => ({ start: parseTime(s.start), end: parseTime(s.end), text: String(s.text ?? '').trim() }))
    .filter((s) => s.text && s.start !== null && s.end !== null && s.end > s.start);
}

module.exports = { resolveKey, createClient, validateKey, uploadAudio, deleteRemote, transcribeWords, transcribeSegments, extractWords, mapError, checkKeyFormat };
