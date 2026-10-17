'use strict';
const path = require('node:path');
const express = require('express');
const apiRouter = require('./routes/api');
const { AppError, redact } = require('./utils/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': req.path.startsWith('/api') ? 'no-store' : 'no-cache',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com 'self'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});

// Log តែ method/path/status/ពេលវេលា — មិន Log header, body ឬ query (ការពារ API Key)
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`));
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use('/api', apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'រក API endpoint មិនឃើញ។' } }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let e = err;
  if (!(e instanceof AppError)) {
    if (e?.type === 'entity.too.large') e = new AppError(413, 'BODY_TOO_LARGE', 'ទិន្នន័យធំពេក។');
    else if (e?.type === 'entity.parse.failed') e = new AppError(400, 'BAD_JSON', 'JSON មិនត្រឹមត្រូវ។');
    else {
      console.error('[error]', redact(e?.stack || e?.message || e));
      e = new AppError(500, 'INTERNAL_ERROR', 'កំហុសខាងម៉ាស៊ីនបម្រើ។');
    }
  }
  if (res.headersSent) return;
  res.status(e.status).json({ error: { code: e.code, message: redact(e.message), ...(e.details ? { details: redact(e.details) } : {}) } });
});

module.exports = app;
