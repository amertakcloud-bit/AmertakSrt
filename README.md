# Khmer Subtitle Studio — Audio → SRT

បង្កើត Subtitle ភាសាខ្មែរ (`.srt`) ពី Audio ដោយប្រើ **Node.js + Express** និង **Gemini API**។ JavaScript សុទ្ធ (គ្មាន Python)។ Backend និង Frontend (HTML + CSS + JS) នៅក្នុង Project តែមួយ ហើយ Express បម្រើគេហទំព័រនៅ `http://localhost:5000`។

## លក្ខណៈពិសេស

- Upload Audio ដោយ Drag & Drop ឬចុចជ្រើសរើស (MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, WebM)
- Interactive Waveform (Click/Drag ដើម្បី Seek, Zoom, បង្ហាញតំបន់ Subtitle) + Audio Player (ល្បឿន, សំឡេង, ±5s)
- Khmer Transcription ជាមួយ **Word-level timestamps ពិតប្រាកដ** ពី Gemini; Sentence-level subtitles ត្រូវបានបង្កើតពី Word timestamps ទាំងនោះ (មិនមែនប៉ាន់ស្មាន)
- Subtitle Settings: អក្សរអតិបរមា/បន្ទាត់, ចំនួនបន្ទាត់, រយៈពេលអតិបរមា/អប្បបរមា, ចន្លោះស្ងាត់សម្រាប់បំបែក
- Subtitle Editor៖ កែអត្ថបទ, កែ Start/End (វាយ ឬ ↑/↓ = ±0.1s, Shift+↑/↓ = ±1s), Play ម្តងមួយ Subtitle, កំណត់ Start/End ពី Playhead, បំបែក, បញ្ចូលគ្នា, លុប, បន្ថែម
- **Align** ឡើងវិញ៖ បន្ទាប់ពីកែអត្ថបទ ចុច `⟳ Align` ដើម្បីដាក់ Timestamp ពិតលើអត្ថបទថ្មី ពី Audio
- Export `.srt` ជា UTF-8 (ជម្រើស BOM)
- ឱ្យអ្នកប្រើបញ្ចូល Gemini API Key ផ្ទាល់ខ្លួនតាម UI

## តម្រូវការ

- **Node.js ≥ 20.12** (ណែនាំ 22) — ប្រើ `process.loadEnvFile` ដូច្នេះមិនត្រូវការ `dotenv`
- Gemini API Key — បង្កើតឥតគិតថ្លៃនៅ <https://aistudio.google.com/apikey>
- ffmpeg — ត្រូវបានដំឡើងស្វ័យប្រវត្តិតាម `ffmpeg-static` (បើចង់ប្រើ ffmpeg ផ្ទាល់ខ្លួន កំណត់ `FFMPEG_PATH`)

## ការដំឡើង និង Run

```bash
cd khmer-subtitle-studio-v2
npm install
cp .env.example .env        # Windows: copy .env.example .env
# បើក .env ហើយដាក់ GEMINI_API_KEY=AIza...   (ឬរំលង ហើយបញ្ចូល Key ក្នុង UI)
npm start
```

បើកដោយ Browser៖ <http://localhost:5000>

រត់ជា Dev (restart ស្វ័យប្រវត្តិ)៖ `npm run dev` · រត់តេស្ត៖ `npm test`

> `package.json` កំណត់ `@google/genai` ជា `latest`។ បន្ទាប់ពី `npm install` ដំណើរការបាន អ្នកអាច Pin កំណែនៅក្នុង `package.json` ដើម្បីឱ្យ Build ស្ថិរភាព។

## របៀបប្រើ

1. ទម្លាក់ឯកសារ Audio ចូលក្នុង Dropzone
2. (ជម្រើស) ចុច **API Key** ដើម្បីបញ្ចូល Key ផ្ទាល់ខ្លួន → **Validate & ប្រើ**
3. កែ **Subtitle Settings** តាមត្រូវការ ហើយចុច **បង្កើត Subtitle ជាមួយ Gemini**
4. ពិនិត្យ/កែក្នុង Editor (ស្តាប់ដោយ ▶ ឬ Space) — មើលការព្រមាន (Warning) ពណ៌លឿង
5. ចុច **Export .srt**

Shortcuts៖ `Space` = Play/Pause (ពេលមិនកំពុងវាយអត្ថបទ)។

## របៀបដែល Timestamp ត្រូវបានបង្កើត (សំខាន់)

| ជំហាន | ការពិត |
|---|---|
| ១. ffmpeg decode Audio (16 kHz mono) | Validate ថាជា Audio ពិត, វាស់រយៈពេលពិត, គណនា Energy ដើម្បីរកផ្នែកស្ងាត់ |
| ២. បំបែក Chunk (បើវែង > `CHUNK_SECONDS`) | កាត់នៅចំណុចស្ងាត់បំផុត ព្រោះ Model កំណត់ 30 នាទី នៅពេលបើក Timestamps |
| ៣. `gemini-3.5-transcribe` + `word` timestamps | **Gemini ផ្តល់ Start/End រាល់ពាក្យ** (Khmer `km-KH` ត្រូវបានគាំទ្រ) |
| ៤. បង្កើត Subtitle | ដាក់ពាក្យជាក្រុមតាម `។ ? !`, ចន្លោះស្ងាត់, ចំនួនអក្សរ, រយៈពេល — **ម៉ោង Subtitle = ម៉ោងពាក្យដំបូង/ចុងក្រោយពិត** |
| ៥. ពិនិត្យគុណភាព | Timestamp មិនតាមលំដាប់, ពាក្យរយៈពេល 0, ពាក្យធ្លាក់លើផ្នែកស្ងាត់, Transcript គ្របដណ្តប់មិនពេញ → បង្ហាញ **Warning** |

**Fallback (បង្ហាញ Warning ជានិច្ច)៖** បើ Key មិនមានសិទ្ធិប្រើ `gemini-3.5-transcribe` ឬ Model មិនផ្តល់ Word timestamps → ប្តូរទៅ `GEMINI_FALLBACK_MODEL` (`gemini-3.8-flash`) ដែលផ្តល់តែ **Segment-level** timestamps; Backend Snap ព្រំដែនទៅ Speech onset/offset ពិតពី Audio (VAD) ហើយប្រាប់អ្នកប្រើថា Word-level មិនមាន។ មិនមានការបង្កើត Timestamp ដោយ "ចែកស្មើៗ" ទេ។

**Align អត្ថបទដែលបានកែ៖** ប្រើ Word timeline ពិតពី Gemini ហើយផ្គូផ្គងអត្ថបទថ្មីទៅនឹងវា (character/grapheme-level alignment, ទ្រាំទ្រការកែពាក្យ/បន្ថែម/លុប)។ បើផ្គូផ្គងមិនបាន (confidence < 0.4) Backend **មិនបន្លំ** Timestamp ទេ គឺរក្សាម៉ោងដើម ហើយដាក់ស្លាក "មិនបាន align"។

> ចំណាំ៖ Google ព្រមានថា Word timestamps អាចកាត់បន្ថយភាពត្រឹមត្រូវនៃ Transcription បន្តិច។ សូមពិនិត្យអត្ថបទ Khmer ដោយខ្លួនឯងជានិច្ច មុនប្រើប្រាស់ផ្លូវការ។

## API Endpoints

| Method | Path | ការពិពណ៌នា |
|---|---|---|
| GET | `/api/health` | ស្ថានភាព, កំណែ, Models, Limits, មាន Key លំនាំដើមឬអត់ |
| POST | `/api/validate-key` | Validate Key (Header `X-Gemini-Api-Key`; បើគ្មាន → ប្រើ Key ពី `.env`) |
| POST | `/api/transcribe` | `multipart/form-data`: `audio` (ឯកសារ), `settings` (JSON ជម្រើស) → `{ duration, cues, words, warnings, meta }` |
| POST | `/api/align` | Align អត្ថបទទៅ Audio។ JSON `{ cues:[{text,start?,end?}], words }` (ឥតគិតថ្លៃ/ភ្លាមៗ ពេលមាន `words` ពី `/api/transcribe`) ឬ multipart `audio` + `cues` |
| POST | `/api/export-srt` | JSON `{ cues:[{start,end,text}], bom?, filename? }` → ឯកសារ `.srt` UTF-8 |

ឧទាហរណ៍៖

```bash
curl http://localhost:5000/api/health

curl -X POST http://localhost:5000/api/transcribe \
  -H "X-Gemini-Api-Key: $GEMINI_API_KEY" \
  -F "audio=@speech.mp3" \
  -F 'settings={"maxCharsPerLine":40,"pauseThreshold":0.6}'

curl -X POST http://localhost:5000/api/export-srt \
  -H "Content-Type: application/json" \
  -d '{"cues":[{"start":0.5,"end":2.8,"text":"សួស្តី ពិភពលោក"}]}' -o out.srt
```

កំហុសទាំងអស់មានទម្រង់ `{ "error": { "code", "message" } }` (400 Validation, 401 Key, 413 ធំពេក, 415 ប្រភេទមិនគាំទ្រ, 422 គ្មានសំឡេង, 429 Quota/Rate limit, 502/503 Gemini)។

## សុវត្ថិភាព

- **Key លំនាំដើម** នៅក្នុង `.env` (ក្នុង `.gitignore`) ហើយមិនដែលបញ្ជូនទៅ Browser
- **Key អ្នកប្រើ** រក្សាក្នុង **ការចងចាំរបស់ Tab** ប៉ុណ្ណោះ (មិនមែន localStorage/sessionStorage/cookie), បញ្ជូនតាម HTTP Header (មិនដែលតាម URL/Query), បាត់ពេល Refresh។ Backend ប្រើ Key របស់អ្នកប្រើជាមុន បើគ្មានទើបប្រើ `.env`
- Backend **មិន Log** Header/Body/Query (Log តែ method, path, status, ពេលវេលា) ហើយលុបទម្រង់ `AIza…` ចេញពីសារកំហុសគ្រប់ទីកន្លែង
- Validate ទម្រង់ Key, ប្រភេទ/ទំហំ File (`MAX_FILE_MB`), ទំហំ Audio (`MAX_AUDIO_MINUTES`), decode ដោយ ffmpeg (បដិសេធឯកសារមិនមែន Audio), Rate limit ក្នុងមួយ IP
- **Cleanup**៖ ឯកសារបណ្តោះអាសន្ន (Upload + Chunk) ត្រូវលុបនៅពេល Response ចប់ (ទោះជោគជ័យ ឬបរាជ័យ/បោះបង់); ឯកសារលើ Gemini Files API ត្រូវលុបភ្លាមក្រោយប្រើ; ឯកសារចាស់ >1 ម៉ោង ត្រូវសម្អាតពេល Start
- Security headers + CSP (`script-src 'self'`); Transcript ពី Gemini ត្រូវបានបង្ហាញដោយ `textContent` (ការពារ XSS)
- ⚠️ ប្រើតាម HTTP ធម្មតាសម្រាប់ `localhost` តែប៉ុណ្ណោះ។ បើដាក់ Public ត្រូវប្រើ HTTPS ដើម្បីកុំឱ្យ Key របស់អ្នកប្រើធ្លាក់ក្នុង Network

## រចនាសម្ព័ន្ធ Project

```
khmer-subtitle-studio-v2/
├── server.js                 # Entry (listen, sweep temp files)
├── package.json  .env.example  .gitignore  README.md
├── src/
│   ├── app.js                # Express app: headers, logging, API, static, error handler
│   ├── config.js             # .env + defaults
│   ├── routes/api.js         # health, validate-key, transcribe, align, export-srt
│   ├── middleware/           # upload (multer + cleanup), rateLimit
│   ├── services/
│   │   ├── gemini.js         # SDK client, key validation, Files API, transcription calls
│   │   ├── audio.js          # ffmpeg: decode, duration, VAD, chunk plan/encode
│   │   ├── subtitles.js      # words → cues, text↔audio alignment
│   │   └── pipeline.js       # orchestration + quality checks + fallback
│   └── utils/                # errors/redact, time, khmer (Intl.Segmenter), srt
├── public/                   # Frontend: index.html, css/styles.css, js/{main,api,waveform,srt}.js
└── test/core.test.js         # node:test
```

## ការកំណត់ (`.env`)

សូមមើល `.env.example` — `GEMINI_API_KEY`, `PORT`, `MAX_FILE_MB`, `MAX_AUDIO_MINUTES`, `GEMINI_TRANSCRIBE_MODEL`, `GEMINI_FALLBACK_MODEL`, `CHUNK_SECONDS`, `RATE_LIMIT_MAX`, `FFMPEG_PATH`។

## ដោះស្រាយបញ្ហា

| បញ្ហា | ដំណោះស្រាយ |
|---|---|
| `Gemini API Key មិនត្រឹមត្រូវ` | ពិនិត្យ Key នៅ AI Studio; Key ត្រូវចាប់ផ្តើមដោយ `AIza` |
| `MODEL_NOT_FOUND` / ប្តូរទៅ fallback | Key/គណនារបស់អ្នកប្រហែលមិនទាន់មានសិទ្ធិប្រើ `gemini-3.5-transcribe` — កែ `GEMINI_TRANSCRIBE_MODEL` តាម Model ដែលអ្នកមាន (សូមមើល <https://ai.google.dev/gemini-api/docs/models>) |
| `SDK_OUTDATED` | `npm install @google/genai@latest` (ត្រូវការ Interactions API) |
| `429 QUOTA_EXCEEDED` | លើស Quota ឥតគិតថ្លៃ — រង់ចាំ ឬប្រើ Key ផ្សេង |
| អក្សរខ្មែរបង្ហាញខុស | ត្រូវការ Internet ដើម្បីទាញ Font `Noto Sans Khmer`, ឬដំឡើង Khmer font ក្នុងប្រព័ន្ធ |
| Waveform មិនបង្ហាញ | Browser decode Audio មិនបាន (Player និង Transcription នៅតែប្រើបាន) |

## ឯកសារយោង

- Gemini Audio understanding: <https://ai.google.dev/gemini-api/docs/audio>
- Gemini 3.5 Transcribe (word timestamps, Khmer): <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe> · <https://ai.google.dev/gemini-api/docs/transcribe>
