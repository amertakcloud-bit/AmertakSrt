'use strict';

function pad(n, w) {
  return String(n).padStart(w, '0');
}

// វិនាទី → "HH:MM:SS,mmm" (SRT)
function toSrtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

// "0.450s" | "1.2" | "01:02.500" | "00:01:02,500" → វិនាទី (ឬ null)
function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(',', '.');
  if (/^-?\d+(\.\d+)?s?$/.test(v)) return parseFloat(v);
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + frac;
}

module.exports = { toSrtTime, parseTime };
