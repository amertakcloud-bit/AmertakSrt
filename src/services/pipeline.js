'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const config = require('../config');
const audio = require('./audio');
const gemini = require('./gemini');
const subs = require('./subtitles');
const { AppError } = require('../utils/errors');

const MIME_FLAC = 'audio/flac';

/** ស្វែងរក Speech onset/offset ជិតបំផុតក្នុង ±tol វិនាទី */
function snap(t, speech, kind, tol = 0.35) {
  const F = audio.FRAME_SEC;
  const center = Math.round(t / F);
  const span = Math.round(tol / F);
  let best = null;
  for (let d = 0; d <= span; d++) {
    for (const f of d === 0 ? [center] : [center - d, center + d]) {
      if (f < 1 || f >= speech.length) continue;
      const hit = kind === 'start' ? !speech[f - 1] && speech[f] : speech[f - 1] && !speech[f];
      if (hit) {
        best = f;
        break;
      }
    }
    if (best !== null) break;
  }
  return best === null ? t : best * F;
}

/** ទទួល Words ពិតពី Gemini សម្រាប់ Audio ទាំងមូល (បំបែក Chunk បើវែង) */
async function collectTimeline({ client, filePath, analysis, tmpFiles, warnings }) {
  const chunks = audio.planChunks(analysis.duration, analysis.rms, config.chunkSeconds);
  let mode = 'word';
  let words = [];
  let segments = [];

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const out = path.join(config.tmpDir, `${crypto.randomUUID()}.flac`);
    tmpFiles.push(out);
    await audio.encodeChunk(filePath, out, ch.start, ch.end - ch.start);
    const remote = await gemini.uploadAudio(client, out, MIME_FLAC);
    try {
      if (mode === 'word') {
        let res = null;
        try {
          res = await gemini.transcribeWords(client, remote);
        } catch (err) {
          const mapped = gemini.mapError(err);
          if (!(mapped.code === 'MODEL_NOT_FOUND' && i === 0)) throw mapped;
          warnings.push(`Model "${config.transcribeModel}" មិនអាចប្រើបានជាមួយ Key នេះ — ប្តូរទៅ "${config.fallbackModel}" (Timestamp កម្រិត Segment ប៉ុណ្ណោះ)។`);
          mode = 'segment';
        }
        if (mode === 'word') {
          if (!res.words.length) {
            if (i === 0) {
              warnings.push('Model មិនបានផ្តល់ Word timestamps — ប្តូរទៅ Segment timestamps (ភាពត្រឹមត្រូវទាបជាង)។');
              mode = 'segment';
            } else warnings.push(`Chunk ${i + 1}: គ្មាន Word timestamps (ប្រហែលគ្មានសំឡេងនិយាយ)។`);
          } else words.push(...res.words.map((w) => ({ ...w, start: w.start + ch.start, end: w.end + ch.start })));
        }
      }
      if (mode === 'segment') {
        const segs = await gemini.transcribeSegments(client, remote);
        segments.push(...segs.map((s) => ({ ...s, start: s.start + ch.start, end: s.end + ch.start })));
      }
    } finally {
      await gemini.deleteRemote(client, remote);
    }
  }
  return { mode, words, segments, chunks: chunks.length };
}

function qualityChecks({ words, analysis, speechInfo, warnings }) {
  if (!words.length) return;
  const { speech } = speechInfo;
  let nonMono = 0;
  let zero = 0;
  let inSilence = 0;
  for (let i = 0; i < words.length; i++) {
    if (i && words[i].start < words[i - 1].start) nonMono++;
    if (words[i].end - words[i].start <= 0.001) zero++;
    const mid = Math.floor(((words[i].start + words[i].end) / 2) / audio.FRAME_SEC);
    if (mid < speech.length && !speech[mid]) inSilence++;
  }
  const n = words.length;
  if (nonMono / n > 0.02) warnings.push(`Timestamp ${nonMono} ពាក្យមិនតាមលំដាប់ (បានតម្រៀបឡើងវិញ)។ សូមពិនិត្យ។`);
  if (zero / n > 0.1) warnings.push(`${zero}/${n} ពាក្យមានរយៈពេល 0 — Word timing អាចមិនសូវត្រឹមត្រូវ។`);
  if (inSilence / n > 0.35) warnings.push(`${Math.round((inSilence / n) * 100)}% នៃពាក្យធ្លាក់លើផ្នែកស្ងាត់នៃសំឡេង — Timestamp អាចរសាត់។ សូមពិនិត្យក្នុង Waveform។`);
  const last = words[n - 1].end;
  if (analysis.duration > 20 && last < analysis.duration * 0.5) {
    warnings.push(`Transcript គ្របដណ្ដប់តែ ${Math.round(last)}s ក្នុងចំណោម ${Math.round(analysis.duration)}s — ប្រហែលមានផ្នែកមិនត្រូវបានស្តាប់។`);
  }
}

async function prepare(filePath) {
  const analysis = await audio.analyze(filePath);
  if (analysis.duration > config.maxAudioSeconds) {
    throw new AppError(413, 'AUDIO_TOO_LONG', `Audio វែងពេក (${Math.round(analysis.duration / 60)} នាទី)។ អតិបរមា ${Math.round(config.maxAudioSeconds / 60)} នាទី។`);
  }
  const speechInfo = audio.detectSpeech(analysis.rms);
  if (speechInfo.silent) throw new AppError(422, 'NO_SPEECH', 'Audio ស្ទើរតែស្ងាត់ទាំងស្រុង — រកមិនឃើញសំឡេងនិយាយទេ។');
  return { analysis, speechInfo };
}

async function transcribe({ filePath, userKey, settings, tmpFiles }) {
  const { key, source } = gemini.resolveKey(userKey);
  const client = gemini.createClient(key);
  const warnings = [];
  const { analysis, speechInfo } = await prepare(filePath);

  let tl;
  try {
    tl = await collectTimeline({ client, filePath, analysis, tmpFiles, warnings });
  } catch (err) {
    throw gemini.mapError(err);
  }

  let cues;
  let words = [];
  if (tl.mode === 'word') {
    const cleaned = subs.cleanWords(tl.words, analysis.duration);
    words = cleaned.words;
    if (cleaned.dropped) warnings.push(`ត្រូវបានលុប ${cleaned.dropped} ពាក្យដែលគ្មាន Timestamp ត្រឹមត្រូវ។`);
    qualityChecks({ words, analysis, speechInfo, warnings });
    cues = subs.buildCues(words, settings);
  } else {
    // Segment-level: Snap ព្រំដែនទៅ Speech onset/offset ពិតពី Audio
    const sorted = tl.segments.sort((a, b) => a.start - b.start);
    cues = sorted.map((s) => {
      const start = snap(Math.max(0, s.start), speechInfo.speech, 'start');
      const end = Math.max(start + 0.2, snap(Math.min(analysis.duration, s.end), speechInfo.speech, 'end'));
      return { start, end, text: s.text, words: [], source: 'gemini-segment+vad' };
    });
    for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) cues[i - 1].end = cues[i].start;
    warnings.push('Word-level timestamps មិនមាន — Timestamp ជា Segment-level ពី Gemini ដែលកែលម្អដោយ Audio (VAD)។ សូមពិនិត្យដោយត្រចៀក។');
  }
  if (!cues.length) throw new AppError(422, 'EMPTY_TRANSCRIPT', 'Gemini មិនបានស្តាប់ឃើញអត្ថបទអ្វីទេ។');

  for (const c of cues) {
    c.speechRatio = Number(audio.speechRatio(speechInfo.speech, c.start, c.end).toFixed(2));
  }
  const weak = cues.filter((c) => c.speechRatio < 0.3).length;
  if (weak) warnings.push(`${weak} Subtitle ស្ថិតលើផ្នែកស្ងាត់ជាចម្បង — សូមពិនិត្យ Timestamp។`);

  return {
    duration: analysis.duration,
    cues,
    words, // Word timeline ពិត — ប្រើឡើងវិញក្នុង /api/align
    warnings,
    meta: {
      model: tl.mode === 'word' ? config.transcribeModel : config.fallbackModel,
      timing: tl.mode === 'word' ? 'word-level' : 'segment-level',
      keySource: source,
      chunks: tl.chunks,
      wordCount: words.length,
    },
  };
}

/** Align អត្ថបទដែលកែ ទៅនឹង Audio ពិត */
async function align({ filePath, userKey, lines, words: givenWords, tmpFiles }) {
  const warnings = [];
  let words = givenWords;
  let duration = null;
  let timing = 'word-level';
  let keySource = null;

  if (!words || !words.length) {
    if (!filePath) throw new AppError(400, 'NO_AUDIO', 'ត្រូវការ Audio file (ឬ words ពី /api/transcribe)។');
    const { key, source } = gemini.resolveKey(userKey);
    keySource = source;
    const client = gemini.createClient(key);
    const { analysis, speechInfo } = await prepare(filePath);
    duration = analysis.duration;
    let tl;
    try {
      tl = await collectTimeline({ client, filePath, analysis, tmpFiles, warnings });
    } catch (err) {
      throw gemini.mapError(err);
    }
    if (tl.mode === 'word') words = subs.cleanWords(tl.words, analysis.duration).words;
    else {
      words = subs.cleanWords(tl.segments, analysis.duration).words; // Segment ជា "ពាក្យធំ"
      timing = 'segment-level';
      warnings.push('Alignment ប្រើ Segment timestamps (ភាពត្រឹមត្រូវទាបជាង Word-level)។');
    }
    qualityChecks({ words, analysis, speechInfo, warnings });
  } else {
    words = subs.cleanWords(words, Number.MAX_SAFE_INTEGER).words;
  }
  if (!words.length) throw new AppError(422, 'EMPTY_TRANSCRIPT', 'គ្មាន Word timeline សម្រាប់ Align។');

  const res = subs.alignTextToWords(lines, words);
  warnings.push(...res.warnings);
  return { duration, cues: res.cues, warnings, meta: { timing, keySource, wordCount: words.length } };
}

async function removeFiles(files) {
  await Promise.all(files.map((f) => fs.rm(f, { force: true }).catch(() => {})));
}

module.exports = { transcribe, align, removeFiles, snap };
