'use strict';

const graphemeSeg = new Intl.Segmenter('km', { granularity: 'grapheme' });
const wordSeg = new Intl.Segmenter('km', { granularity: 'word' });

const graphemes = (s) => Array.from(graphemeSeg.segment(s), (x) => x.segment);
const graphemeLength = (s) => graphemes(s).length;

// បំបែកអត្ថបទជាពាក្យ (Khmer word segmentation ពី ICU) ដោយរក្សាសញ្ញាវណ្ណយុត្តិ
function splitWords(s) {
  return Array.from(wordSeg.segment(s), (x) => x.segment).filter((t) => t.trim().length > 0);
}

const SENTENCE_END = /[។៕?!؟.…]$/;
const KHMER = /[ក-៿]/;
const WORDLIKE = /[\p{L}\p{N}]/u;

// ភ្ជាប់ពាក្យ៖ ខ្មែរមិនដាក់ដកឃ្លា, Latin/លេខ ដាក់ដកឃ្លា
function joinWords(parts) {
  let out = '';
  for (const raw of parts) {
    const w = raw.trim();
    if (!w) continue;
    if (out) {
      const prev = out[out.length - 1];
      const next = w[0];
      const needSpace =
        WORDLIKE.test(prev) && WORDLIKE.test(next) && !KHMER.test(prev) && !KHMER.test(next);
      if (needSpace) out += ' ';
    }
    out += w;
  }
  return out;
}

// សម្រាប់ប្រៀបធៀបអត្ថបទ៖ NFC, លុបដកឃ្លា/សញ្ញា/zero-width
function normalizeForMatch(s) {
  return s
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

module.exports = { graphemes, graphemeLength, splitWords, joinWords, normalizeForMatch, SENTENCE_END, KHMER };
