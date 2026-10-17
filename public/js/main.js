import * as api from './api.js';
import { Waveform } from './waveform.js';
import { toClock, parseClock, downloadSrt, validate } from './srt.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};

const state = {
  file: null,
  objectUrl: null,
  duration: 0,
  cues: [],
  words: [], // Word timeline ពិតពី Gemini (ប្រើក្នុង Align)
  activeId: null,
  nextId: 1,
  health: null,
  controller: null,
  stopAt: null,
};

const audio = $('audio');
const emptyEl = $('emptyState');
const wave = new Waveform($('wave'), $('waveScroll'), { onSeek: (t) => seek(t) });

/* ------------------------------ Toast ------------------------------ */
function toast(msg, kind = '', ms = 5000) {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  $('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

/* ------------------------------ Health / key chip ------------------------------ */
function updateChip() {
  const chip = $('healthChip');
  const label = chip.querySelector('span');
  if (!state.health) {
    chip.className = 'chip bad';
    label.textContent = 'Backend មិនដំណើរការ';
    return;
  }
  chip.className = 'chip ok';
  const keyInfo = api.hasKey() ? 'Key ផ្ទាល់ខ្លួន' : state.health.defaultKeyConfigured ? 'Key ពី .env' : 'គ្មាន Key';
  label.textContent = `Backend OK · ${keyInfo}`;
  if (!api.hasKey() && !state.health.defaultKeyConfigured) chip.className = 'chip';
  $('keyBtnLabel').textContent = api.hasKey() ? 'API Key ✓' : 'API Key';
}

async function loadHealth() {
  try {
    state.health = await api.health();
    $('limitsHint').textContent = `ទំហំអតិបរមា ${state.health.limits.maxFileMB} MB · រយៈពេលអតិបរមា ${state.health.limits.maxAudioMinutes} នាទី`;
  } catch {
    state.health = null;
  }
  updateChip();
}

/* ------------------------------ File handling ------------------------------ */
const dz = $('dropzone');
dz.addEventListener('click', () => $('fileInput').click());
dz.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), $('fileInput').click()));
$('replaceBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); });
for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) dz.classList.remove('drag'); });
window.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });

const EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|aiff?|mp4)$/i;

async function loadFile(file) {
  if (!EXT.test(file.name) && !file.type.startsWith('audio/')) {
    toast('ប្រភេទឯកសារមិនគាំទ្រ។ សូមជ្រើសរើសឯកសារ Audio។', 'err');
    return;
  }
  const maxMB = state.health?.limits.maxFileMB;
  if (maxMB && file.size > maxMB * 1048576) {
    toast(`ឯកសារធំពេក (${(file.size / 1048576).toFixed(1)} MB)។ អតិបរមា ${maxMB} MB។`, 'err');
    return;
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  audio.pause();
  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  state.cues = [];
  state.words = [];
  state.activeId = null;
  audio.src = state.objectUrl;
  $('fileName').textContent = file.name;
  $('fileInfo').textContent = `${(file.size / 1048576).toFixed(2)} MB`;
  $('playerCard').classList.remove('hidden');
  dz.classList.add('hidden'); // ប្តូរឯកសារតាមប៊ូតុង ឬ Drag & Drop ពេលណាក៏បាន
  $('generateBtn').disabled = false;
  $('waveMsg').classList.add('hidden');
  renderCues();
  showWarnings([]);
  $('meta').classList.add('hidden');

  await new Promise((res) => { audio.onloadedmetadata = res; audio.onerror = res; });
  if (!isFinite(audio.duration)) {
    toast('Browser មិនអាចអានឯកសារ Audio នេះបានទេ។', 'err');
    return;
  }
  state.duration = audio.duration;
  wave.setDuration(state.duration);
  wave.setTime(0, false);
  updateTime();
  decodeWaveform(file);
}

async function decodeWaveform(file) {
  const msg = $('waveMsg');
  msg.textContent = 'កំពុងបង្កើត Waveform…';
  msg.classList.remove('hidden');
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    ctx.close();
    if (state.file !== file) return;
    wave.setBuffer(buf);
    msg.classList.add('hidden');
  } catch {
    msg.textContent = 'មិនអាចបង្ហាញ Waveform បានទេ (Browser decode មិនបាន) — ប៉ុន្តែ Player និង Transcription នៅតែប្រើបាន។';
  }
}

/* ------------------------------ Player ------------------------------ */
function seek(t) {
  audio.currentTime = Math.max(0, Math.min(state.duration || 0, t));
  state.stopAt = null;
  tick();
}
function togglePlay() {
  if (!state.file) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}
function playSegment(cue) {
  audio.currentTime = cue.start;
  state.stopAt = cue.end;
  audio.play().catch(() => {});
}
$('playBtn').addEventListener('click', togglePlay);
$('back5').addEventListener('click', () => seek(audio.currentTime - 5));
$('fwd5').addEventListener('click', () => seek(audio.currentTime + 5));
$('rateSel').addEventListener('change', (e) => { audio.playbackRate = parseFloat(e.target.value); });
$('volRange').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
$('zoomIn').addEventListener('click', () => wave.zoom(1.6));
$('zoomOut').addEventListener('click', () => wave.zoom(1 / 1.6));
audio.addEventListener('play', () => { $('icoPlay').classList.add('hidden'); $('icoPause').classList.remove('hidden'); loop(); });
audio.addEventListener('pause', () => { $('icoPlay').classList.remove('hidden'); $('icoPause').classList.add('hidden'); tick(); });
audio.addEventListener('seeked', tick);
audio.addEventListener('ended', () => { state.stopAt = null; tick(); });
function loop() { tick(); if (!audio.paused) requestAnimationFrame(loop); }

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag) && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    togglePlay();
  }
});

function updateTime() {
  $('timeLabel').textContent = `${toClock(audio.currentTime || 0)} / ${toClock(state.duration || 0)}`;
}

function findCue(t) {
  return state.cues.find((c) => t >= c.start && t < c.end) || null;
}

let lastActive = null;
function tick() {
  const t = audio.currentTime || 0;
  if (state.stopAt != null && t >= state.stopAt) { audio.pause(); state.stopAt = null; }
  updateTime();
  wave.setTime(t, !audio.paused);
  const cue = findCue(t);
  const id = cue ? cue.id : null;
  if (id !== lastActive) {
    lastActive = id;
    state.activeId = id;
    wave.setActive(id);
    document.querySelectorAll('.cue.active').forEach((n) => n.classList.remove('active'));
    if (cue) {
      const row = document.querySelector(`.cue[data-id="${cue.id}"]`);
      if (row) {
        row.classList.add('active');
        if (!audio.paused && !row.contains(document.activeElement)) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
  renderPreview(cue, t);
  highlightWords(cue, t);
}

let previewKey = '';
function renderPreview(cue, t) {
  const box = $('subtitlePreview');
  const showWords = $('setShowWords').checked && cue && cue.words?.length && !cue.dirty;
  const key = cue ? `${cue.id}|${cue.text}|${showWords}` : '';
  if (key !== previewKey) {
    previewKey = key;
    box.textContent = '';
    if (!cue) { box.innerHTML = '&nbsp;'; return; }
    if (showWords) {
      cue.words.forEach((w, i) => {
        box.append(el('span', { class: 'w', 'data-i': i, text: w.text }));
      });
    } else box.textContent = cue.text;
  }
  if (cue && showWords) {
    box.querySelectorAll('.w').forEach((s) => {
      const w = cue.words[+s.dataset.i];
      s.classList.toggle('on', t >= w.start && t < w.end);
    });
  }
}
function highlightWords(cue, t) {
  if (!cue) return;
  const row = document.querySelector(`.cue[data-id="${cue.id}"] .words`);
  if (!row) return;
  row.querySelectorAll('.wchip').forEach((chip) => {
    const w = cue.words[+chip.dataset.i];
    chip.classList.toggle('on', !!w && t >= w.start && t < w.end);
  });
}

/* ------------------------------ Editor ------------------------------ */
function cueIssues(cue, i) {
  const issues = [];
  if (!(cue.end > cue.start)) issues.push(['err', 'End ≤ Start']);
  const next = state.cues[i + 1];
  if (next && cue.end > next.start + 0.001) issues.push(['warn', 'ត្រួតគ្នានឹងបន្ទាប់']);
  if (!cue.text.trim()) issues.push(['err', 'អត្ថបទទទេ']);
  const max = Number($('setMaxChars').value) || 42;
  const longest = Math.max(0, ...cue.text.split('\n').map((l) => [...new Intl.Segmenter('km', { granularity: 'grapheme' }).segment(l)].length));
  if (longest > max) issues.push(['warn', `បន្ទាត់វែង (${longest}>${max})`]);
  if (cue.speechRatio != null && cue.speechRatio < 0.3) issues.push(['warn', 'ជាចម្បងស្ងាត់ — ពិនិត្យម៉ោង']);
  return issues;
}

function refreshMeta(cue) {
  const row = document.querySelector(`.cue[data-id="${cue.id}"]`);
  if (!row) return;
  const i = state.cues.indexOf(cue);
  const issues = cueIssues(cue, i);
  row.classList.toggle('invalid', issues.some((x) => x[0] === 'err'));
  const info = row.querySelector('.cue-info');
  info.textContent = '';
  info.append(el('span', { class: 'tag', text: `${Math.max(0, cue.end - cue.start).toFixed(2)}s` }));
  if (cue.words?.length && !cue.dirty) info.append(el('span', { class: 'tag ok', text: `${cue.words.length} ពាក្យ` }));
  if (cue.dirty) info.append(el('span', { class: 'tag warn', text: 'អត្ថបទត្រូវបានកែ — ចុច Align' }));
  if (cue.source === 'audio-alignment') info.append(el('span', { class: 'tag ok', text: `aligned ${Math.round((cue.confidence ?? 0) * 100)}%` }));
  if (cue.source === 'unaligned') info.append(el('span', { class: 'tag err', text: 'មិនបាន align' }));
  for (const [k, msg] of issues) info.append(el('span', { class: 'tag ' + k, text: msg }));
  $('alignBtn').disabled = !(state.words.length && state.cues.some((c) => c.dirty));
}

function makeTimeInput(cue, field) {
  const inp = el('input', { type: 'text', class: 'tinput', value: toClock(cue[field]), 'aria-label': field === 'start' ? 'Start' : 'End', inputmode: 'decimal' });
  const apply = (v) => {
    const t = parseClock(v);
    if (t === null || t < 0) { inp.value = toClock(cue[field]); toast('ទម្រង់ម៉ោងមិនត្រឹមត្រូវ (ឧ. 01:23.450)', 'err', 2500); return; }
    cue[field] = t;
    inp.value = toClock(t);
    wave.setCues(state.cues, state.activeId);
    refreshAllMeta();
  };
  inp.addEventListener('change', () => apply(inp.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
      apply(String(Math.max(0, cue[field] + step)));
    } else if (e.key === 'Enter') inp.blur();
  });
  return inp;
}

function refreshAllMeta() { state.cues.forEach(refreshMeta); }

function renderCues() {
  const list = $('cueList');
  list.textContent = '';
  $('cueCount').textContent = state.cues.length;
  $('exportBtn').disabled = state.cues.length === 0;
  if (!state.cues.length) {
    list.append(emptyEl);
    $('alignBtn').disabled = true;
    wave.setCues([], null);
    return;
  }
  const showWords = $('setShowWords').checked;

  state.cues.forEach((cue, i) => {
    const startIn = makeTimeInput(cue, 'start');
    const endIn = makeTimeInput(cue, 'end');
    const ta = el('textarea', { rows: 2, 'aria-label': `អត្ថបទ Subtitle ${i + 1}`, lang: 'km', spellcheck: 'false' });
    ta.value = cue.text;
    ta.addEventListener('input', () => {
      cue.text = ta.value;
      cue.dirty = true;
      refreshMeta(cue);
      previewKey = '';
    });
    ta.addEventListener('focus', () => { if (!cue.dirty) $('subtitlePreview').dataset.editing = ''; });

    const row = el('div', { class: 'cue', 'data-id': cue.id },
      el('div', { class: 'cue-top' },
        el('span', { class: 'cue-idx', text: i + 1 }),
        startIn, el('span', { class: 'arrow', text: '→' }), endIn,
        el('div', { class: 'cue-actions' },
          el('button', { class: 'icon-btn', type: 'button', title: 'Play Subtitle នេះ', onclick: () => playSegment(cue), text: '▶' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'កំណត់ Start = Playhead', onclick: () => { cue.start = audio.currentTime; renderCues(); }, text: '⇤' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'កំណត់ End = Playhead', onclick: () => { cue.end = audio.currentTime; renderCues(); }, text: '⇥' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'បំបែកត្រង់ Playhead', onclick: () => splitCue(cue), text: '✂' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'បញ្ចូលជាមួយបន្ទាប់', onclick: () => mergeNext(cue), text: '⤓' }),
          el('button', { class: 'icon-btn', type: 'button', title: 'លុប', onclick: () => deleteCue(cue), text: '✕' }),
        ),
      ),
      ta,
      el('div', { class: 'cue-info' }),
    );
    if (showWords && cue.words?.length && !cue.dirty) {
      const wrap = el('div', { class: 'words' });
      cue.words.forEach((w, wi) => {
        wrap.append(el('button', { class: 'wchip', type: 'button', 'data-i': wi, title: `${toClock(w.start)} → ${toClock(w.end)}`, onclick: () => seek(w.start) },
          el('span', { text: w.text }), el('small', { text: toClock(w.start).replace(/^00:/, '') })));
      });
      row.append(wrap);
    }
    row.addEventListener('focusin', () => { if (audio.paused) seek(cue.start); });
    list.append(row);
    refreshMeta(cue);
  });
  wave.setCues(state.cues, state.activeId);
  lastActive = undefined;
  tick();
}

function newId() { return state.nextId++; }

function splitCue(cue) {
  const t = audio.currentTime;
  if (!(t > cue.start + 0.05 && t < cue.end - 0.05)) { toast('ដាក់ Playhead នៅចន្លោះ Subtitle ដែលចង់បំបែក។', 'err', 3000); return; }
  const idx = state.cues.indexOf(cue);
  let a, b;
  if (cue.words?.length && !cue.dirty) {
    const wa = cue.words.filter((w) => (w.start + w.end) / 2 < t);
    const wb = cue.words.filter((w) => (w.start + w.end) / 2 >= t);
    if (wa.length && wb.length) {
      const join = (ws) => ws.map((w) => w.text).join('');
      a = { text: join(wa), words: wa };
      b = { text: join(wb), words: wb };
    }
  }
  if (!a) {
    const text = cue.text.replace(/\n/g, '');
    const segs = [...new Intl.Segmenter('km', { granularity: 'word' }).segment(text)].map((s) => s.segment);
    const target = ((t - cue.start) / (cue.end - cue.start)) * text.length;
    let acc = 0, cut = segs.length;
    for (let i = 0; i < segs.length; i++) { acc += segs[i].length; if (acc >= target) { cut = i + 1; break; } }
    a = { text: segs.slice(0, cut).join(''), words: [] };
    b = { text: segs.slice(cut).join(''), words: [] };
    a.dirty = b.dirty = Boolean(state.words.length);
  }
  const base = { source: cue.source, confidence: cue.confidence, speechRatio: cue.speechRatio };
  state.cues.splice(idx, 1,
    { ...base, id: newId(), start: cue.start, end: t, ...a },
    { ...base, id: newId(), start: t, end: cue.end, ...b });
  renderCues();
}

function mergeNext(cue) {
  const i = state.cues.indexOf(cue);
  const next = state.cues[i + 1];
  if (!next) { toast('គ្មាន Subtitle បន្ទាប់ទេ។', 'err', 2500); return; }
  const needSpace = /[A-Za-z0-9]$/.test(cue.text) && /^[A-Za-z0-9]/.test(next.text);
  state.cues.splice(i, 2, {
    ...cue, id: newId(), end: next.end, text: cue.text + (needSpace ? ' ' : '') + next.text,
    words: cue.dirty || next.dirty ? [] : [...(cue.words || []), ...(next.words || [])],
    dirty: cue.dirty || next.dirty,
  });
  renderCues();
}

function deleteCue(cue) {
  state.cues.splice(state.cues.indexOf(cue), 1);
  renderCues();
}

$('addCueBtn').addEventListener('click', () => {
  if (!state.file) { toast('ផ្ទុកឯកសារ Audio ជាមុន។', 'err', 3000); return; }
  const t = audio.currentTime;
  const next = state.cues.find((c) => c.start > t);
  const end = Math.min(t + 2, next ? next.start : state.duration);
  if (end - t < 0.1) { toast('គ្មានកន្លែងទំនេរនៅ Playhead។', 'err', 3000); return; }
  const cue = { id: newId(), start: t, end, text: '', words: [], source: 'manual' };
  state.cues.push(cue);
  state.cues.sort((a, b) => a.start - b.start);
  renderCues();
  document.querySelector(`.cue[data-id="${cue.id}"] textarea`)?.focus();
});

$('setShowWords').addEventListener('change', () => { previewKey = ''; renderCues(); });

/* ------------------------------ Warnings / meta ------------------------------ */
function showWarnings(list) {
  const box = $('warnings');
  box.textContent = '';
  if (!list.length) { box.classList.add('hidden'); return; }
  box.append(el('strong', { text: '⚠ ការព្រមាន' }), el('ul', {}, ...list.map((w) => el('li', { text: w }))));
  box.classList.remove('hidden');
}
function showMeta(res) {
  const m = $('meta');
  m.textContent = '';
  const tags = [`Model: ${res.meta.model}`, `Timing: ${res.meta.timing}`, `រយៈពេល: ${toClock(res.duration)}`];
  if (res.meta.chunks > 1) tags.push(`${res.meta.chunks} chunks`);
  if (res.meta.timing === 'word-level') tags.push(`${res.meta.wordCount} ពាក្យ`);
  tags.forEach((t) => m.append(el('span', { class: 'tag', text: t })));
  m.classList.remove('hidden');
}

/* ------------------------------ Generate ------------------------------ */
function setBusy(busy, text) {
  $('generateBtn').disabled = busy || !state.file;
  $('cancelBtn').classList.toggle('hidden', !busy);
  $('progress').classList.toggle('hidden', !busy);
  if (text) $('progressText').textContent = text;
}
function settings() {
  return {
    maxCharsPerLine: Number($('setMaxChars').value),
    maxLines: Number($('setMaxLines').value),
    maxDuration: Number($('setMaxDur').value),
    pauseThreshold: Number($('setPause').value),
    minDuration: Number($('setMinDur').value),
  };
}

$('generateBtn').addEventListener('click', async () => {
  if (!state.file) return;
  if (state.cues.length && !confirm('Subtitle ដែលមានស្រាប់នឹងត្រូវជំនួស។ បន្តទេ?')) return;
  if (!api.hasKey() && !state.health?.defaultKeyConfigured) {
    toast('គ្មាន Gemini API Key។ សូមបញ្ចូល Key របស់អ្នក។', 'err');
    openKeyDialog();
    return;
  }
  state.controller = new AbortController();
  const fill = $('progressFill');
  const bar = fill.parentElement;
  bar.classList.remove('indeterminate');
  fill.style.width = '0%';
  setBusy(true, 'កំពុង Upload…');
  const started = Date.now();
  let timer = null;
  try {
    const res = await api.transcribe(state.file, settings(), {
      signal: state.controller.signal,
      onUpload: (p) => { fill.style.width = Math.round(p * 100) + '%'; $('progressText').textContent = `កំពុង Upload… ${Math.round(p * 100)}%`; },
      onUploaded: () => {
        bar.classList.add('indeterminate');
        const t0 = Date.now();
        timer = setInterval(() => { $('progressText').textContent = `Gemini កំពុងស្តាប់ និងដាក់ Timestamp… ${Math.round((Date.now() - t0) / 1000)}s`; }, 500);
      },
    });
    state.words = res.words || [];
    state.cues = res.cues.map((c) => ({ ...c, id: newId(), dirty: false }));
    renderCues();
    showWarnings(res.warnings || []);
    showMeta(res);
    toast(`បានបង្កើត ${state.cues.length} Subtitle ក្នុង ${Math.round((Date.now() - started) / 1000)}s`, 'ok');
  } catch (err) {
    if (err.code !== 'ABORTED') toast(err.message, 'err', 9000);
    if (err.code === 'INVALID_API_KEY' || err.code === 'NO_API_KEY') openKeyDialog();
  } finally {
    clearInterval(timer);
    bar.classList.remove('indeterminate');
    setBusy(false);
  }
});
$('cancelBtn').addEventListener('click', () => state.controller?.abort());

/* ------------------------------ Align edited text ------------------------------ */
$('alignBtn').addEventListener('click', async () => {
  const btn = $('alignBtn');
  btn.disabled = true;
  btn.textContent = '⟳ កំពុង Align…';
  try {
    const res = await api.align(state.cues, state.words);
    let applied = 0, failed = 0;
    res.cues.forEach((r, i) => {
      const cue = state.cues[i];
      if (!cue || !cue.dirty) return;
      if (r.source === 'audio-alignment' && r.end > r.start) {
        Object.assign(cue, { start: r.start, end: r.end, words: r.words, confidence: r.confidence, source: r.source, dirty: false });
        applied++;
      } else { cue.source = 'unaligned'; failed++; }
    });
    renderCues();
    const w = res.warnings || [];
    if (w.length) showWarnings([...w]);
    toast(`Align ${applied} Subtitle${failed ? ` · ${failed} មិនបាន` : ''}`, failed ? '' : 'ok');
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    btn.textContent = '⟳ Align';
    refreshAllMeta();
  }
});

/* ------------------------------ Export ------------------------------ */
$('exportBtn').addEventListener('click', () => {
  const cues = [...state.cues].sort((a, b) => a.start - b.start);
  const problems = validate(cues);
  if (problems.length) { toast('មិនអាច Export៖ ' + problems.slice(0, 3).join(' · '), 'err', 8000); return; }
  const base = (state.file?.name || 'subtitles').replace(/\.[^.]+$/, '');
  downloadSrt(cues, base + '.srt', $('bomChk').checked);
  toast(`បាន Export ${cues.length} Subtitle (UTF-8)`, 'ok', 3000);
});

/* ------------------------------ API key dialog ------------------------------ */
const dlg = $('keyDialog');
function openKeyDialog() { $('keyStatus').textContent = ''; $('keyStatus').className = 'key-status'; dlg.showModal(); $('keyInput').focus(); }
$('keyBtn').addEventListener('click', openKeyDialog);
$('keyClose').addEventListener('click', () => { $('keyInput').value = ''; dlg.close(); });
$('keyToggle').addEventListener('click', () => {
  const i = $('keyInput');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('keyToggle').textContent = i.type === 'password' ? 'បង្ហាញ' : 'លាក់';
});
$('keyClear').addEventListener('click', () => {
  api.setKey('');
  $('keyInput').value = '';
  $('keyStatus').textContent = 'បានលុប Key — ប្រើ Key ពី .env វិញ។';
  $('keyStatus').className = 'key-status';
  updateChip();
});
$('keyForm').addEventListener('submit', (e) => e.preventDefault());
$('keySave').addEventListener('click', async () => {
  const key = $('keyInput').value.trim();
  const st = $('keyStatus');
  if (!key) { st.textContent = 'សូមបញ្ចូល Key។'; st.className = 'key-status bad'; return; }
  st.textContent = 'កំពុង Validate…'; st.className = 'key-status';
  $('keySave').disabled = true;
  try {
    const r = await api.validateKey(key);
    api.setKey(key);
    st.textContent = '✓ Key ត្រឹមត្រូវ' + (r.note ? ' · ' + r.note : '');
    st.className = 'key-status ok';
    $('keyInput').value = ''; // លុបពី DOM ភ្លាមៗ
    updateChip();
    setTimeout(() => dlg.open && dlg.close(), 900);
  } catch (err) {
    st.textContent = '✗ ' + err.message;
    st.className = 'key-status bad';
  } finally {
    $('keySave').disabled = false;
  }
});

/* ------------------------------ Init ------------------------------ */
loadHealth();
