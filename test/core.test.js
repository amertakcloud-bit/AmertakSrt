'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { toSrtTime, parseTime } = require('../src/utils/time');
const { validateCues, buildSrt } = require('../src/utils/srt');
const { joinWords } = require('../src/utils/khmer');
const subs = require('../src/services/subtitles');
const gemini = require('../src/services/gemini');
const audio = require('../src/services/audio');
const { snap } = require('../src/services/pipeline');

test('SRT time format', () => {
  assert.equal(toSrtTime(0), '00:00:00,000');
  assert.equal(toSrtTime(3661.0075), '01:01:01,008');
  assert.equal(parseTime('0.450s'), 0.45);
  assert.equal(parseTime('01:02.500'), 62.5);
  assert.equal(parseTime('00:01:02,500'), 62.5);
  assert.equal(parseTime('abc'), null);
});

test('validateCues rejects bad timing and empty text', () => {
  assert.throws(() => validateCues([{ start: 2, end: 1, text: 'x' }]), /Timestamp/);
  assert.throws(() => validateCues([{ start: 0, end: 1, text: '  ' }]), /អត្ថបទទទេ/);
  assert.throws(() => validateCues([]), /cues/);
});

test('SRT keeps Khmer Unicode intact (UTF-8 roundtrip)', () => {
  const text = 'សួស្តី ប្រទេសកម្ពុជា។\nខ្ញុំស្រលាញ់ភាសាខ្មែរ';
  const srt = buildSrt(validateCues([{ start: 1.5, end: 3.25, text }]));
  assert.equal(srt, `1\n00:00:01,500 --> 00:00:03,250\n${text}\n`);
  const buf = Buffer.from(srt, 'utf8');
  assert.equal(buf.toString('utf8'), srt);
});

test('joinWords: Khmer no spaces, Latin spaced', () => {
  assert.equal(joinWords(['ខ្ញុំ', 'ស្រលាញ់', 'ប្រទេស']), 'ខ្ញុំស្រលាញ់ប្រទេស');
  assert.equal(joinWords(['I', 'love', 'AI']), 'I love AI');
});

const W = (text, start, end) => ({ text, start, end });
const sample = [
  W('ខ្ញុំ', 0.1, 0.4), W('ស្រលាញ់', 0.45, 1.0), W('ប្រទេស', 1.05, 1.6), W('កម្ពុជា។', 1.65, 2.3),
  W('សូម', 4.0, 4.3), W('អរគុណ', 4.35, 4.9), W('ច្រើន', 4.95, 5.4),
];

test('buildCues splits on sentence end and long pauses, keeps real word timing', () => {
  const cues = subs.buildCues(sample, {});
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'ខ្ញុំស្រលាញ់ប្រទេសកម្ពុជា។');
  assert.equal(cues[0].start, 0.1);
  assert.equal(cues[0].end, 2.3);
  assert.equal(cues[0].words.length, 4);
  assert.equal(cues[1].start, 4.0);
  assert.equal(cues[1].words[2].end, 5.4);
});

test('buildCues respects maxDuration', () => {
  const words = Array.from({ length: 20 }, (_, i) => W('ពាក្យ' + i, i * 0.5, i * 0.5 + 0.4));
  const cues = subs.buildCues(words, { maxDuration: 3, pauseThreshold: 5, maxCharsPerLine: 100 });
  for (const c of cues) assert.ok(c.end - c.start <= 3.01, `cue too long ${c.end - c.start}`);
  assert.ok(cues.length > 1);
});

test('alignTextToWords: edited text gets real timing from word timeline', () => {
  const res = subs.alignTextToWords(
    [{ text: 'ខ្ញុំស្រលាញ់ប្រទេសកម្ពុជា។' }, { text: 'សូមអរគុណច្រើនណាស់' }], // បន្ថែម "ណាស់" ក្នុងអត្ថបទកែ
    sample,
  );
  const [a, b] = res.cues;
  assert.ok(Math.abs(a.start - 0.1) < 0.01 && Math.abs(a.end - 2.3) < 0.01, JSON.stringify(a));
  assert.ok(Math.abs(b.start - 4.0) < 0.05, JSON.stringify(b));
  assert.ok(b.end >= 5.35 && b.end <= 5.5, 'end must follow the last matched audio word: ' + b.end);
  assert.ok(a.confidence > 0.95);
  assert.equal(a.words.map((w) => w.text).join(''), 'ខ្ញុំស្រលាញ់ប្រទេសកម្ពុជា។');
  // word timing ត្រូវតាមលំដាប់
  for (const c of res.cues) for (let i = 1; i < c.words.length; i++) assert.ok(c.words[i].start >= c.words[i - 1].start);
});

test('alignTextToWords: unrelated text is flagged, not faked', () => {
  const res = subs.alignTextToWords([{ text: 'Hello completely different english text', start: 9, end: 10 }], sample);
  assert.equal(res.cues[0].source, 'unaligned');
  assert.equal(res.cues[0].start, 9);
  assert.equal(res.warnings.length, 1);
});

test('Gemini response extraction: interactions word_info + generateContent shapes', () => {
  const inter = { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'x', annotations: [
    { type: 'word_info', text: 'សួស្តី', start_offset: '0.100s', end_offset: '0.450s' },
    { type: 'other' },
  ] }] }] };
  assert.deepEqual(gemini.extractWords(inter), [{ text: 'សួស្តី', start: 0.1, end: 0.45 }]);
  const gen = { candidates: [{ content: { parts: [{ audioTranscription: { words: [{ word: 'a', startOffset: '1.0s', endOffset: '1.5s' }] } }] } }] };
  assert.deepEqual(gemini.extractWords(gen), [{ text: 'a', start: 1, end: 1.5 }]);
});

test('API key handling: format check, user key preferred, redaction', () => {
  assert.throws(() => gemini.resolveKey('not a key'), /មិនត្រឹមត្រូវ/);
  assert.throws(() => gemini.resolveKey('short'), /មិនត្រឹមត្រូវ/);
  const other = 'zz_NewFormat-' + 'k9'.repeat(15);
  assert.deepEqual(gemini.resolveKey(other), { key: other, source: 'user' });
  const aq = 'AQ.' + 'Ab4_x-'.repeat(12);
  assert.deepEqual(gemini.resolveKey(aq), { key: aq, source: 'user' });
  assert.ok(!gemini.mapError(Object.assign(new Error('bad ' + aq), { status: 500 })).message.includes(aq));
  const k = 'AIza' + 'x'.repeat(35);
  assert.deepEqual(gemini.resolveKey(k), { key: k, source: 'user' });
  const mapped = gemini.mapError(Object.assign(new Error(`bad request ${k}`), { status: 500 }));
  assert.ok(!mapped.message.includes(k));
  const invalid = gemini.mapError(Object.assign(new Error('API key not valid'), { status: 400 }));
  assert.equal(invalid.code, 'INVALID_API_KEY');
});

/* ---------- ffmpeg ជាមួយ Audio ពិត ---------- */
function makeAudio(file, filter, dur) {
  execFileSync(audio.ffmpegBin(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-t', String(dur), file]);
}

test('audio.analyze + VAD + snap on real audio (tone bursts with silence)', async () => {
  const f = path.join(os.tmpdir(), `ks-test-${process.pid}.wav`);
  // សំឡេង 1s ស្ងាត់ 1s សំឡេង 1s ស្ងាត់ 1s (សរុប 4s)
  makeAudio(f, "aevalsrc='0.5*sin(440*2*PI*t)*(between(t,1,2)+between(t,3,4))*0+0.5*sin(440*2*PI*t)*(between(t,0.5,1.5)+between(t,2.5,3.5))':s=16000", 4);
  try {
    const a = await audio.analyze(f);
    assert.ok(Math.abs(a.duration - 4) < 0.05, 'duration ' + a.duration);
    const { speech, silent } = audio.detectSpeech(a.rms);
    assert.equal(silent, false);
    assert.ok(audio.speechRatio(speech, 0.6, 1.4) > 0.95);
    assert.ok(audio.speechRatio(speech, 1.6, 2.4) < 0.05);
    assert.ok(Math.abs(snap(0.62, speech, 'start') - 0.5) < 0.02, 'snap start');
    assert.ok(Math.abs(snap(1.6, speech, 'end') - 1.5) < 0.02, 'snap end');
    // encode chunk
    const out = f + '.flac';
    await audio.encodeChunk(f, out, 1, 2);
    const b = await audio.analyze(out);
    assert.ok(Math.abs(b.duration - 2) < 0.1, 'chunk duration ' + b.duration);
    fs.rmSync(out);
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('audio.analyze rejects non-audio files', async () => {
  const f = path.join(os.tmpdir(), `ks-bad-${process.pid}.mp3`);
  fs.writeFileSync(f, 'this is not audio at all');
  try {
    await assert.rejects(() => audio.analyze(f), (e) => e.code === 'INVALID_AUDIO');
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('planChunks cuts long audio at quiet points', () => {
  const rms = new Float32Array(100 * 4000).fill(0.2); // 4000s
  for (let i = 0; i < 20; i++) rms[100 * 1450 + i] = 0; // ស្ងាត់នៅ 1450s
  const chunks = audio.planChunks(4000, rms, 1500);
  assert.equal(chunks[0].start, 0);
  assert.ok(Math.abs(chunks[0].end - 1450.1) < 0.5, 'first cut ' + chunks[0].end);
  assert.equal(chunks.at(-1).end, 4000);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].start, chunks[i - 1].end);
});
