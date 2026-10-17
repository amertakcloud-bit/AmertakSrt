'use strict';
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const config = require('../config');
const { AppError } = require('../utils/errors');

const SAMPLE_RATE = 16000;
const FRAME_SEC = 0.01; // 10ms
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_SEC;

function ffmpegBin() {
  if (config.ffmpegPath) return config.ffmpegPath;
  try {
    const p = createRequire(__filename)('ffmpeg-static');
    if (p) return p;
  } catch {
    /* ប្រើ ffmpeg ក្នុង PATH */
  }
  return 'ffmpeg';
}

function run(args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    if (onStdout) child.stdout.on('data', onStdout);
    else child.stdout.resume();
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new AppError(500, 'FFMPEG_MISSING', 'រក ffmpeg មិនឃើញ។ ដំឡើង "ffmpeg-static" (npm install) ឬកំណត់ FFMPEG_PATH។'));
      } else reject(err);
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new AppError(400, 'INVALID_AUDIO', 'ឯកសារមិនមែនជា Audio ត្រឹមត្រូវ ឬខូច។', stderr.split('\n').slice(-3).join(' ').trim()))));
  });
}

/**
 * Decode ជា PCM 16kHz mono (streaming) → រយៈពេលពិត + RMS រៀងរាល់ 10ms
 * ក៏ជាការ Validate ថាឯកសារជា Audio ពិត (ffmpeg decode បាន)
 */
async function analyze(filePath) {
  const rms = [];
  let leftover = Buffer.alloc(0);
  let sumSq = 0;
  let inFrame = 0;
  let totalSamples = 0;

  const onStdout = (chunk) => {
    const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
    const usable = buf.length - (buf.length % 2);
    for (let i = 0; i < usable; i += 2) {
      const s = buf.readInt16LE(i) / 32768;
      sumSq += s * s;
      if (++inFrame === FRAME_SAMPLES) {
        rms.push(Math.sqrt(sumSq / FRAME_SAMPLES));
        sumSq = 0;
        inFrame = 0;
      }
    }
    totalSamples += usable / 2;
    leftover = buf.subarray(usable);
  };

  await run(['-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { onStdout });
  if (inFrame > 0) rms.push(Math.sqrt(sumSq / inFrame));
  if (totalSamples < SAMPLE_RATE * 0.2) throw new AppError(400, 'AUDIO_TOO_SHORT', 'Audio ខ្លីពេក ឬគ្មានសំឡេង។');
  return { duration: totalSamples / SAMPLE_RATE, rms: Float32Array.from(rms) };
}

function percentile(arr, p) {
  const sorted = Float32Array.from(arr).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
}

/** រក Speech frames ដោយ Threshold ដែលសម្របតាម Noise floor */
function detectSpeech(rms) {
  const floor = percentile(rms, 0.1);
  const loud = percentile(rms, 0.95);
  const threshold = Math.max(floor * 3, loud * 0.08, 0.002);
  const raw = Array.from(rms, (v) => v > threshold);
  // បំពេញចន្លោះខ្លីៗ (<150ms) ដើម្បីកុំឱ្យបែកជាកំណាត់ៗ
  const gapFrames = 15;
  let i = 0;
  while (i < raw.length) {
    if (!raw[i]) {
      let j = i;
      while (j < raw.length && !raw[j]) j++;
      if (i > 0 && j < raw.length && j - i < gapFrames) for (let k = i; k < j; k++) raw[k] = true;
      i = j;
    } else i++;
  }
  const silent = loud < 0.003; // ស្ទើរតែគ្មានសំឡេង
  return { speech: raw, threshold, silent };
}

/** សមាមាត្រ speech នៅក្នុងចន្លោះ [start,end] */
function speechRatio(speech, start, end) {
  const a = Math.max(0, Math.floor(start / FRAME_SEC));
  const b = Math.min(speech.length, Math.ceil(end / FRAME_SEC));
  if (b <= a) return 0;
  let n = 0;
  for (let i = a; i < b; i++) if (speech[i]) n++;
  return n / (b - a);
}

/** ជ្រើស Cut point នៅកន្លែងស្ងាត់បំផុតជិតគោលដៅ ដើម្បីបំបែក Chunk */
function planChunks(duration, rms, maxSec) {
  if (duration <= maxSec) return [{ start: 0, end: duration }];
  const cuts = [0];
  while (duration - cuts[cuts.length - 1] > maxSec) {
    const target = cuts[cuts.length - 1] + maxSec;
    const lo = Math.max(cuts[cuts.length - 1] + maxSec * 0.7, target - 90);
    let best = target;
    let bestE = Infinity;
    const win = 20; // 200ms
    for (let f = Math.floor(lo / FRAME_SEC); f < Math.floor(target / FRAME_SEC) - win; f += 5) {
      let e = 0;
      for (let k = 0; k < win; k++) e += rms[f + k] || 0;
      if (e < bestE) {
        bestE = e;
        best = (f + win / 2) * FRAME_SEC;
      }
    }
    cuts.push(best);
  }
  cuts.push(duration);
  return cuts.slice(0, -1).map((s, i) => ({ start: s, end: cuts[i + 1] }));
}

/** កាត់ + បម្លែងជា FLAC mono 16kHz (Lossless, តូច) */
async function encodeChunk(inputPath, outPath, start, length) {
  const args = ['-v', 'error', '-y'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', inputPath);
  if (length) args.push('-t', String(length));
  args.push('-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'flac', outPath);
  await run(args);
}

module.exports = { analyze, detectSpeech, speechRatio, planChunks, encodeChunk, FRAME_SEC, ffmpegBin };
