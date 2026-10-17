'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { AppError } = require('../utils/errors');
const { removeFiles } = require('../services/pipeline');

fs.mkdirSync(config.tmpDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.tmpDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${crypto.randomUUID()}${config.allowedExtensions.includes(ext) ? ext : '.bin'}`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: config.maxFileBytes, files: 1, fields: 20, fieldSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okMime = /^(audio|video)\//.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (!config.allowedExtensions.includes(ext) || !okMime) {
      return cb(new AppError(415, 'UNSUPPORTED_FILE', `ប្រភេទឯកសារមិនគាំទ្រ។ ប្រើ: ${config.allowedExtensions.join(', ')}`));
    }
    cb(null, true);
  },
});

/** ទទួល field "audio" + ចុះបញ្ជី Temp files ដើម្បីលុបពេល Response ចប់ (ទោះជោគជ័យ ឬបរាជ័យ) */
function receiveAudio(req, res, next) {
  req.tmpFiles = [];
  res.on('close', () => removeFiles(req.tmpFiles));
  uploader.single('audio')(req, res, (err) => {
    if (req.file) req.tmpFiles.push(req.file.path);
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'FILE_TOO_LARGE', `ឯកសារធំពេក។ អតិបរមា ${Math.round(config.maxFileBytes / 1048576)} MB។`));
    }
    if (err instanceof multer.MulterError) return next(new AppError(400, 'UPLOAD_ERROR', `Upload មានបញ្ហា: ${err.message}`));
    next(err);
  });
}

module.exports = { receiveAudio };
