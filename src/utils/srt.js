'use strict';
const { toSrtTime, parseTime } = require('./time');
const { AppError } = require('./errors');

// សម្អាត និង Validate cues ពី Client
function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new AppError(400, 'INVALID_CUES', 'ត្រូវការ cues យ៉ាងតិចមួយ។');
  }
  if (cues.length > 20000) throw new AppError(400, 'INVALID_CUES', 'cues ច្រើនពេក។');
  return cues.map((c, i) => {
    const start = parseTime(c.start);
    const end = parseTime(c.end);
    const text = String(c.text ?? '').replace(/\r\n?/g, '\n').trim();
    if (start === null || end === null || start < 0 || end <= start) {
      throw new AppError(400, 'INVALID_CUES', `Subtitle #${i + 1}: Timestamp មិនត្រឹមត្រូវ (end ត្រូវធំជាង start)។`);
    }
    if (!text) throw new AppError(400, 'INVALID_CUES', `Subtitle #${i + 1}: អត្ថបទទទេ។`);
    return { start, end, text };
  });
}

function buildSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}\n`)
      .join('\n')
  );
}

module.exports = { validateCues, buildSrt };
