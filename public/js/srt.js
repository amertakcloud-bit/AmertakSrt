// SRT helpers (ដូចគ្នានឹង Backend)
export function toSrtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(Math.floor((ms % 60000) / 1000), 2)},${p(ms % 1000, 3)}`;
}

export function toClock(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w) => String(n).padStart(w, '0');
  const h = Math.floor(ms / 3600000);
  return `${h ? p(h, 2) + ':' : ''}${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(Math.floor((ms % 60000) / 1000), 2)}.${p(ms % 1000, 3)}`;
}

// "1:02.5" | "00:01:02,500" | "12.5" → វិនាទី | null
export function parseClock(v) {
  const s = String(v).trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3] + (m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0);
}

export function buildSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text.trim()}\n`).join('\n');
}

export function validate(cues) {
  const problems = [];
  cues.forEach((c, i) => {
    if (!c.text.trim()) problems.push(`#${i + 1}: អត្ថបទទទេ`);
    if (!(c.end > c.start)) problems.push(`#${i + 1}: End ត្រូវធំជាង Start`);
  });
  return problems;
}

export function downloadSrt(cues, filename, bom) {
  const text = (bom ? '﻿' : '') + buildSrt(cues);
  const blob = new Blob([text], { type: 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
