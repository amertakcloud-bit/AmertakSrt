'use strict';
const { AppError } = require('../utils/errors');

function rateLimit({ windowMs = 10 * 60 * 1000, max = 30 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip) || { count: 0, reset: now + windowMs };
    if (rec.reset < now) {
      rec.count = 0;
      rec.reset = now + windowMs;
    }
    rec.count++;
    hits.set(req.ip, rec);
    if (rec.count > max) return next(new AppError(429, 'RATE_LIMITED', 'ស្នើសុំច្រើនពេក។ សូមរង់ចាំបន្តិច។'));
    next();
  };
}

module.exports = { rateLimit };
