'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config');
const app = require('./src/app');

// សម្អាតឯកសារបណ្តោះអាសន្នចាស់ៗ (>1 ម៉ោង) ពី Session មុន
function sweepTmp() {
  fs.mkdirSync(config.tmpDir, { recursive: true });
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(config.tmpDir)) {
    const p = path.join(config.tmpDir, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}
sweepTmp();
setInterval(sweepTmp, 30 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`Khmer Subtitle Studio កំពុងដំណើរការ: http://localhost:${config.port}`);
  console.log(config.defaultApiKey ? 'Gemini API Key លំនាំដើម: បានកំណត់ក្នុង .env' : 'Gemini API Key លំនាំដើម: មិនទាន់កំណត់ (អ្នកប្រើត្រូវបញ្ចូលតាម UI)');
});
server.requestTimeout = 0; // Transcribe អាចចំណាយពេលយូរ
server.headersTimeout = 60_000;

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
