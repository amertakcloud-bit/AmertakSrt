'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// លុប API Key ណាមួយចេញពីសារ មុនបញ្ជូន ឬ Log
function redact(text) {
  return String(text ?? '')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED_KEY]')
    .replace(/\bAQ\.[0-9A-Za-z_.\-]{20,}/g, '[REDACTED_KEY]')
    .replace(/(x-gemini-api-key|api[_-]?key|key)(["'=:\s]+)[\x21-\x7E]{16,}/gi, '$1$2[REDACTED_KEY]');
}

module.exports = { AppError, redact };
