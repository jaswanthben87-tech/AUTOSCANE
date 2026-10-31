# Ask Gemini AutoScan ✦

An intelligent study assistant that scans questions from your screen and answers them instantly using **Google Gemini 3.5 Flash**.

- **Chrome Extension**: Use `Ctrl+Shift+Q` anywhere on the web to scan and answer questions with a floating in-page widget.
- **Cloud Backend & Web App**: Ready to deploy directly to **Vercel** with a built-in question tester and serverless API.

---

## 🚀 Deploy Backend to Vercel (Cloud 24/7)

You can run the backend in the cloud for free so you never need to keep a terminal open on your computer:

1. Go to [Vercel Dashboard](https://vercel.com/new).
2. Click **Import** on your GitHub repository: `jaswanthben87-tech/AUTOSCANE`.
3. In **Environment Variables**, add:
   - `GEMINI_API_KEY`: *(Your Google Gemini API Key)*
   - `GEMINI_MODEL`: `gemini-3.5-flash`
4. Click **Deploy**.
5. Once deployed, Vercel gives you a URL (e.g. `https://autoscane.vercel.app`).

---

## 🔌 Connect the Chrome Extension to your Vercel App

1. Open Google Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension` folder.
4. Press `Ctrl+Shift+Q` on any webpage.
5. In the floating panel, click **⚙️ Server Settings** at the bottom and paste your Vercel URL:
   ```text
   https://your-project.vercel.app
   ```
6. That's it! The extension will now process questions via your cloud backend 24/7!

---

## 💻 Local Development (Alternative)

If you prefer running the backend locally:

1. Open a terminal in the project root:
   ```bash
   npm install
   npm start
   ```
2. The server will run on `http://127.0.0.1:3037`.
3. Verify at `http://127.0.0.1:3037/health`.

---

## 🔒 Privacy & Security

- Your Gemini API Key stays protected on your server / Vercel environment variables and is never exposed to client browsers or Git.
- Screenshots are processed safely for question extraction.
