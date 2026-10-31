# Ask Gemini AutoScan

Upgrade of the existing Ask Gemini Screen Scanner. The keyboard shortcut `Ctrl+Shift+Q` captures the visible viewport and displays answers in a movable panel on the same webpage. OCR uses Tesseract.js locally; only extracted text and limited nearby accessible DOM text are sent to the local Node.js backend. Screenshots are not sent to Gemini.

## Requirements
- Current Google Chrome
- Node.js 18+ (20+ recommended)
- A Gemini API key configured only in `server/.env`

## 1. Configure and start the backend
1. Open a terminal in the `server` folder.
2. Run `npm install` (only needed once).
3. Copy `.env.example` to `.env` and put your key in `GEMINI_API_KEY`. Keep `.env private; it is ignored by Git.
4. Optional: keep the existing `GEMINI_MODEL` value/configuration if you already have one. The example defaults to `gemini-2.5-flash`.
5. Run `npm start`.
6. Verify `http://127.0.0.1:3037/health` responds with `{ "ok": true, ... }`.

## 2. Load the extension
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the project's `extension` folder (not the project root).
4. Open `chrome://extensions/shortcuts`, find Ask Gemini AutoScan, and assign `Ctrl+Shift+Q` if Chrome has another extension using it.

## 3. Use it
1. Open an ordinary webpage containing a question and its options, if any.
2. Press `Ctrl+Shift+Q` (or click the extension toolbar icon).
3. Keep the question visible while it captures and scans the viewport.
4. Read the in-page panel. Use **Copy Answer**, **Scan Again**, minimize, drag the header, or close the panel. Check **Answer only the first detected question** to limit output.

## Troubleshooting
- **Backend unreachable:** run `npm start` in `server`; verify `/health`.
- **API key/quota:** check the terminal and `server/.env`; do not put the key in extension files.
- **No readable question:** scroll the question fully into view, zoom in, and scan again.
- **Shortcut does nothing:** check `chrome://extensions/shortcuts` and reload the unpacked extension after changes.
- **Restricted pages:** Chrome internal pages (`chrome://`), Chrome Web Store, and some protected pages do not permit extension injection or screenshot capture. The extension reports a visible error when injection is possible; restricted pages may block all UI injection.
- **PDFs:** support depends on how Chrome renders the PDF. The built-in Chrome PDF viewer is a protected/internal surface and generally cannot be injected into; try opening a PDF in a normal webpage or use a permitted viewer.

## Privacy and security
- Backend listens only on `127.0.0.1`.
- Gemini key remains in `server/.env`.
- Tesseract OCR runs locally. The screenshot is sent only to the local backend for OCR, never to Gemini.
- The extension sends limited OCR and accessible text to the local backend; the backend sends text to Gemini.
- No continuous/background monitoring is implemented.

## Test checklist
- [ ] `node --check extension/background.js`
- [ ] `node --check extension/content.js`
- [ ] `node --check server/server.js`
- [ ] `node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest OK')"`
- [ ] Backend `/health` responds.
- [ ] Shortcut displays panel on a normal webpage.
- [ ] Multiple visible questions are answered in order.
- [ ] First-question checkbox limits results.
- [ ] Move, minimize, restore, copy, retry, scan again, and close controls work.
- [ ] Stop the backend and confirm the panel displays an actionable error.
