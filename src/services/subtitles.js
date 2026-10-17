'use strict';
const { graphemes, graphemeLength, splitWords, joinWords, normalizeForMatch, SENTENCE_END } = require('../utils/khmer');

const DEFAULTS = {
  maxCharsPerLine: 42, // អក្សរ (grapheme) ក្នុងមួយបន្ទាត់
  maxLines: 2,
  maxDuration: 7, // វិនាទី
  minDuration: 0.6,
  pauseThreshold: 0.7, // ចន្លោះស្ងាត់ដែលបំបែក Subtitle
};

function sanitizeSettings(input = {}) {
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    maxCharsPerLine: Math.round(num(input.maxCharsPerLine, DEFAULTS.maxCharsPerLine, 10, 120)),
    maxLines: Math.round(num(input.maxLines, DEFAULTS.maxLines, 1, 3)),
    maxDuration: num(input.maxDuration, DEFAULTS.maxDuration, 1, 20),
    minDuration: num(input.minDuration, DEFAULTS.minDuration, 0.2, 3),
    pauseThreshold: num(input.pauseThreshold, DEFAULTS.pauseThreshold, 0.1, 3),
  };
}

/** សម្អាត words ពី Gemini: តម្រៀប, Clamp, លុបខូច */
function cleanWords(words, duration) {
  const out = [];
  let dropped = 0;
  for (const w of words) {
    const text = String(w.text ?? '').trim();
    let { start, end } = w;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
      dropped++;
      continue;
    }
    start = Math.max(0, Math.min(start, duration));
    end = Math.max(start, Math.min(end, duration));
    out.push({ text, start, end });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  // មិនឱ្យ overlap
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) out[i - 1].end = Math.max(out[i - 1].start, out[i].start);
  }
  return { words: out, dropped };
}

/** បំបែកបន្ទាត់តាមព្រំដែនពាក្យ ទៅតាម maxCharsPerLine */
function wrapLines(wordTexts, maxChars, maxLines) {
  const total = graphemeLength(joinWords(wordTexts));
  if (total <= maxChars || maxLines < 2) return joinWords(wordTexts);
  const lines = [];
  let cur = [];
  const target = Math.min(maxChars, Math.ceil(total / Math.min(maxLines, Math.ceil(total / maxChars) || 1)));
  for (const w of wordTexts) {
    const next = joinWords([...cur, w]);
    if (cur.length && graphemeLength(next) > target && lines.length < maxLines - 1) {
      lines.push(joinWords(cur));
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(joinWords(cur));
  return lines.join('\n');
}

/** បង្កើត Subtitle (sentence-level) ពី Word timestamps ពិតប្រាកដ */
function buildCues(words, settings, source = 'gemini-word-timestamps') {
  const s = sanitizeSettings(settings);
  const maxChars = s.maxCharsPerLine * s.maxLines;
  const groups = [];
  let cur = [];

  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length) {
      const gap = w.start - cur[cur.length - 1].end;
      const textIfAdded = joinWords([...cur.map((x) => x.text), w.text]);
      const durIfAdded = w.end - cur[0].start;
      if (gap > s.pauseThreshold || graphemeLength(textIfAdded) > maxChars || durIfAdded > s.maxDuration) flush();
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text)) flush();
  }
  flush();

  // ច្របាច់បញ្ចូលក្រុមខ្លីពេក ជាមួយក្រុមជិតខាង (ប្រសិនបើមិនលើសកំណត់)
  const merged = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    const dur = g[g.length - 1].end - g[0].start;
    if (prev && dur < s.minDuration) {
      const combined = [...prev, ...g];
      const gap = g[0].start - prev[prev.length - 1].end;
      const okChars = graphemeLength(joinWords(combined.map((x) => x.text))) <= maxChars;
      const okDur = combined[combined.length - 1].end - combined[0].start <= s.maxDuration;
      if (gap <= s.pauseThreshold && okChars && okDur) {
        merged[merged.length - 1] = combined;
        continue;
      }
    }
    merged.push(g);
  }

  return merged.map((g) => ({
    start: g[0].start,
    end: g[g.length - 1].end,
    text: wrapLines(g.map((x) => x.text), s.maxCharsPerLine, s.maxLines),
    words: g.map((x) => ({ text: x.text, start: x.start, end: x.end })),
    source,
  }));
}

/* ------------------------------------------------------------------ */
/* Text → Audio alignment (ប្រើ Word timeline ពិតពី Gemini)            */
/* ------------------------------------------------------------------ */

function buildCharTimeline(words) {
  const chars = [];
  for (const w of words) {
    const g = graphemes(normalizeForMatch(w.text));
    const n = g.length;
    if (!n) continue;
    const dur = Math.max(0, w.end - w.start);
    g.forEach((ch, k) => chars.push({ ch, t0: w.start + (dur * k) / n, t1: w.start + (dur * (k + 1)) / n }));
  }
  return chars;
}

/** Semi-global alignment: តម្រៀប T (អត្ថបទកែ) ទៅលើបង្អួចនៃ R (អត្ថបទស្តាប់បាន) */
function alignLine(T, R, from) {
  const n = T.length;
  const to = Math.min(R.length, from + n * 3 + 200);
  const W = to - from;
  if (!n || W <= 0) return null;
  const cols = W + 1;
  const dp = new Int32Array((n + 1) * cols);
  const dir = new Uint8Array((n + 1) * cols); // 1=diag 2=up (T char unmatched) 3=left (R skipped)
  for (let i = 1; i <= n; i++) {
    dp[i * cols] = i;
    dir[i * cols] = 2;
    for (let j = 1; j <= W; j++) {
      const diag = dp[(i - 1) * cols + j - 1] + (T[i - 1] === R[from + j - 1] ? 0 : 1);
      const up = dp[(i - 1) * cols + j] + 1;
      const left = dp[i * cols + j - 1] + 1;
      let best = diag;
      let d = 1;
      if (up < best) {
        best = up;
        d = 2;
      }
      if (left < best) {
        best = left;
        d = 3;
      }
      const idx = i * cols + j;
      dp[idx] = best;
      dir[idx] = d;
    }
  }
  let bestJ = 0;
  let bestCost = Infinity;
  for (let j = 0; j <= W; j++) {
    const c = dp[n * cols + j];
    if (c < bestCost) {
      bestCost = c;
      bestJ = j;
    }
  }
  // traceback
  const map = new Array(n).fill(-1);
  let i = n;
  let j = bestJ;
  let matches = 0;
  while (i > 0 && j >= 0) {
    const d = dir[i * cols + j];
    if (j === 0 && d !== 2) break;
    if (d === 1) {
      if (T[i - 1] === R[from + j - 1]) {
        map[i - 1] = from + j - 1;
        matches++;
      }
      i--;
      j--;
    } else if (d === 2) i--;
    else j--;
  }
  return { map, endIndex: from + bestJ, matches, confidence: matches / n };
}

/**
 * ដាក់ Timestamp ពិតលើអត្ថបទដែលអ្នកប្រើកែ
 * lines: [{text, start?, end?}]  words: [{text,start,end}] (Gemini word timestamps)
 */
function alignTextToWords(lines, words) {
  const timeline = buildCharTimeline(words);
  const R = timeline.map((c) => c.ch);
  const warnings = [];
  let cursor = 0;

  const cues = lines.map((line, idx) => {
    const text = String(line.text ?? '').trim();
    const T = graphemes(normalizeForMatch(text));
    const fallback = () => ({ ...line, text, confidence: 0, source: 'unaligned', words: [] });
    if (!T.length) return fallback();

    const res = alignLine(T, R, cursor);
    if (!res || res.confidence < 0.4) {
      warnings.push(`Subtitle #${idx + 1}: មិនអាចផ្គូផ្គងអត្ថបទជាមួយសំឡេងបាន (confidence ${(res ? res.confidence : 0).toFixed(2)}) ទុកម៉ោងដើម។`);
      return fallback();
    }

    // ពេលវេលា per T-char (interpolate ចន្លោះដែលមិនទាន់ match)
    const tt = res.map.map((r) => (r >= 0 ? { t0: timeline[r].t0, t1: timeline[r].t1 } : null));
    const matched = tt.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const first = matched[0];
    const last = matched[matched.length - 1];
    for (let i = 0; i < tt.length; i++) {
      if (tt[i]) continue;
      let a = i - 1;
      while (a >= 0 && !tt[a]) a--;
      let b = i + 1;
      while (b < tt.length && !tt[b]) b++;
      const left = a >= 0 ? tt[a].t1 : tt[b].t0;
      const right = b < tt.length ? tt[b].t0 : tt[a].t1;
      const gapN = (b < tt.length ? b : tt.length) - (a >= 0 ? a + 1 : 0);
      const pos = i - (a >= 0 ? a + 1 : 0);
      const step = (right - left) / Math.max(1, gapN);
      tt[i] = { t0: left + step * pos, t1: left + step * (pos + 1) };
    }
    cursor = Math.max(cursor, res.endIndex);

    // Word-level សម្រាប់អត្ថបទកែ
    const outWords = [];
    let p = 0;
    let pendingPunct = '';
    for (const tok of splitWords(text)) {
      const nl = graphemeLength(normalizeForMatch(tok));
      if (nl === 0) {
        if (outWords.length) outWords[outWords.length - 1].text += tok;
        else pendingPunct += tok;
        continue;
      }
      const a = tt[p];
      const b = tt[Math.min(tt.length - 1, p + nl - 1)];
      outWords.push({ text: pendingPunct + tok, start: a.t0, end: b.t1 });
      pendingPunct = '';
      p += nl;
    }

    return {
      text,
      start: tt[0].t0,
      end: tt[tt.length - 1].t1,
      words: outWords,
      confidence: Number(res.confidence.toFixed(3)),
      source: 'audio-alignment',
      ...(first > 0 || last < T.length - 1 ? { partial: true } : {}),
    };
  });
  return { cues, warnings };
}

module.exports = { DEFAULTS, sanitizeSettings, cleanWords, buildCues, alignTextToWords, wrapLines };
