// Client សម្រាប់ Backend API។ API Key រក្សាក្នុងអថេរ module (ការចងចាំ) ប៉ុណ្ណោះ —
// មិនដាក់ក្នុង localStorage/sessionStorage/URL/cookie ទេ។ បញ្ជូនតាម Header ក្នុងគ្រប់ Request។
let userKey = '';

export const setKey = (k) => { userKey = (k || '').trim(); };
export const hasKey = () => Boolean(userKey);

function keyHeader(key = userKey) {
  return key ? { 'X-Gemini-Api-Key': key } : {};
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function toError(res) {
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  const e = body?.error;
  return new ApiError(e?.message || `កំហុស HTTP ${res.status}`, e?.code || 'HTTP_' + res.status, res.status);
}

async function json(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', ...opts });
  } catch {
    throw new ApiError('មិនអាចភ្ជាប់ទៅ Backend បានទេ។ សូមពិនិត្យថា Server កំពុងដំណើរការ។', 'NETWORK', 0);
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

export const health = () => json('/api/health');

export const validateKey = (candidate) =>
  json('/api/validate-key', { method: 'POST', headers: keyHeader(candidate) });

export function align(cues, words) {
  return json('/api/align', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeader() },
    body: JSON.stringify({ cues: cues.map((c) => ({ text: c.text, start: c.start, end: c.end })), words }),
  });
}

/** Upload + Transcribe ជាមួយ Progress (XHR) */
export function transcribe(file, settings, { onUpload, onUploaded, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('settings', JSON.stringify(settings));
    fd.append('audio', file, file.name);
    xhr.open('POST', '/api/transcribe');
    for (const [k, v] of Object.entries(keyHeader())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onUpload?.(e.loaded / e.total);
    xhr.upload.onload = () => onUploaded?.();
    xhr.onerror = () => reject(new ApiError('មិនអាចភ្ជាប់ទៅ Backend បានទេ។', 'NETWORK', 0));
    xhr.onabort = () => reject(new ApiError('បានបោះបង់។', 'ABORTED', 0));
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new ApiError(body?.error?.message || `កំហុស HTTP ${xhr.status}`, body?.error?.code || 'HTTP_' + xhr.status, xhr.status));
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(fd);
  });
}
