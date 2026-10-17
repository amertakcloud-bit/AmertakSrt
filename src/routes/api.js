'use strict';
const express = require('express');
const config = require('../config');
const { receiveAudio } = require('../middleware/upload');
const { rateLimit } = require('../middleware/rateLimit');
const pipeline = require('../services/pipeline');
const gemini = require('../services/gemini');
const subs = require('../services/subtitles');
const { validateCues, buildSrt } = require('../utils/srt');
const { AppError } = require('../utils/errors');
const pkg = require('../../package.json');

const router = express.Router();
const limiter = rateLimit({ max: config.rateLimitMax });

// Key របស់អ្នកប្រើមកតាម Header ប៉ុណ្ណោះ (មិនដែលតាម URL/Query)
const userKey = (req) => req.get('x-gemini-api-key') || '';

/* ---------- Health ---------- */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: pkg.name,
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    defaultKeyConfigured: Boolean(config.defaultApiKey),
    models: { transcribe: config.transcribeModel, fallback: config.fallbackModel },
    limits: {
      maxFileMB: Math.round(config.maxFileBytes / 1048576),
      maxAudioMinutes: Math.round(config.maxAudioSeconds / 60),
      chunkSeconds: config.chunkSeconds,
    },
    formats: config.allowedExtensions,
  });
});

/* ---------- Validate API key ---------- */
router.post('/validate-key', limiter, async (req, res, next) => {
  try {
    res.json(await gemini.validateKey(userKey(req)));
  } catch (err) {
    next(gemini.mapError(err));
  }
});

/* ---------- Transcription ---------- */
router.post('/transcribe', limiter, receiveAudio, async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'ត្រូវការឯកសារ Audio (field ឈ្មោះ "audio")។');
    let settings = {};
    if (req.body.settings) {
      try {
        settings = JSON.parse(req.body.settings);
      } catch {
        throw new AppError(400, 'BAD_SETTINGS', '"settings" ត្រូវជា JSON។');
      }
    }
    const result = await pipeline.transcribe({
      filePath: req.file.path,
      userKey: userKey(req),
      settings,
      tmpFiles: req.tmpFiles,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ---------- Timestamp alignment ---------- */
// Multipart: audio? + cues (JSON) [+ words (JSON)]  — ឬ JSON body: { cues, words }
router.post('/align', limiter, receiveAudio, async (req, res, next) => {
  try {
    const parse = (v, name) => {
      if (v == null || typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        throw new AppError(400, 'BAD_JSON', `"${name}" ត្រូវជា JSON។`);
      }
    };
    const cues = parse(req.body?.cues, 'cues');
    const words = parse(req.body?.words, 'words');
    if (!Array.isArray(cues) || !cues.length) throw new AppError(400, 'INVALID_CUES', 'ត្រូវការ "cues" (array នៃ {text}).');
    if (cues.length > 20000) throw new AppError(400, 'INVALID_CUES', 'cues ច្រើនពេក។');
    const lines = cues.map((c) => ({ text: String(c.text ?? ''), start: c.start, end: c.end }));
    const result = await pipeline.align({
      filePath: req.file?.path,
      userKey: userKey(req),
      lines,
      words: Array.isArray(words) ? words : null,
      tmpFiles: req.tmpFiles,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ---------- SRT export (UTF-8) ---------- */
router.post('/export-srt', (req, res, next) => {
  try {
    const cues = validateCues(req.body?.cues);
    let body = buildSrt(cues);
    if (req.body?.bom) body = '﻿' + body;
    const safe = String(req.body?.filename || 'subtitles').replace(/[^\w\-ក-៿ ]+/g, '_').slice(0, 80) || 'subtitles';
    res.set({
      'Content-Type': 'application/x-subrip; charset=utf-8',
      'Content-Disposition': `attachment; filename="subtitles.srt"; filename*=UTF-8''${encodeURIComponent(safe)}.srt`,
    });
    res.send(body);
  } catch (err) {
    next(err);
  }
});

router.get('/settings/defaults', (req, res) => res.json(subs.DEFAULTS));

module.exports = router;
