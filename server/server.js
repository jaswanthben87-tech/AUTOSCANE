import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Tesseract from "tesseract.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3037);
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!apiKey || apiKey.includes("PASTE_YOUR")) {
  console.error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

app.use(cors({
  origin(origin, callback) {
    // Chrome extension pages send a chrome-extension:// origin. Local requests
    // without an Origin header are allowed for local testing.
    if (!origin || origin.startsWith("chrome-extension://")) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  }
}));
app.use(express.json({ limit: "10mb" }));

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: modelName });

app.get("/health", (_req, res) => res.json({ ok: true, model: modelName }));

app.post("/api/scan", async (req, res) => {
  try {
    const imageData = req.body?.image;
    if (typeof imageData !== "string" || !imageData.startsWith("data:image/")) {
      return res.status(400).json({ error: "A PNG/JPEG image data URL is required." });
    }
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: "Unsupported or malformed image." });

    const mimeType = match[1] === "jpg" ? "image/jpeg" : `image/${match[1]}`;
    const imageBuffer = Buffer.from(match[2], "base64");
    if (imageBuffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "Selected region is too large. Select a smaller area." });
    }

    // OCR runs locally on this computer using Tesseract.js (English language data).
    const { data } = await Tesseract.recognize(imageBuffer, "eng");
    const extractedText = (data.text || "").trim();
    if (!extractedText) {
      return res.status(422).json({
        error: "OCR could not read text in this region. Try selecting a larger, sharper area."
      });
    }

    const prompt = [
      "You are Ask Gemini, a helpful study assistant.",
      "Answer the question extracted from a screenshot.",
      "If it is a multiple-choice question, identify the correct option and explain briefly.",
      "If OCR contains obvious recognition errors, infer cautiously from context.",
      "If the question is incomplete or unreadable, say what is missing instead of inventing details.",
      "Give a clear, direct answer followed by a short explanation when useful.",
      "",
      "OCR-extracted question:",
      extractedText
    ].join("\n");

    const result = await model.generateContent(prompt);
    const answer = result.response.text();
    return res.json({ extractedText, answer });
  } catch (error) {
    console.error("Scan request failed:", error?.message || error);
    return res.status(500).json({
      error: "Scan failed. Check the API key, model name, network connection, and Gemini API quota."
    });
  }
});


app.post("/api/autoscan", async (req, res) => {
  try {
    const imageData = req.body?.image;
    if (typeof imageData !== "string" || !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
      return res.status(400).json({ error: "A valid PNG/JPEG screenshot is required. Press Ctrl+Shift+Q and retry." });
    }
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    const imageBuffer = Buffer.from(match[2], "base64");
    if (imageBuffer.length > 6 * 1024 * 1024) return res.status(413).json({ error: "Screenshot is too large. Zoom out or reduce the browser window size, then retry." });

    // Tesseract OCR runs on this machine. The screenshot is never sent to Gemini.
    const { data } = await Tesseract.recognize(imageBuffer, "eng");
    const ocrText = (data.text || "").trim().slice(0, 14000);
    const domText = typeof req.body?.domText === "string" ? req.body.domText.slice(0, 12000).trim() : "";
    if (!ocrText && !domText) return res.status(422).json({ error: "No readable text found. Make the question larger and clearer, then scan again." });

    const prompt = `You are Ask Gemini AutoScan, a careful study assistant. Extract the visible questions from the supplied OCR and optional accessible webpage text. Use only questions and nearby answer options; ignore navigation, ads, unrelated paragraphs, and page boilerplate. Preserve the original question order. If the user asks for firstOnly, return only the first question. Do not guess missing or unreadable text; say when something is unclear. For each question provide question, options (array of strings), answer, and explanation (brief). For multiple choice, identify the option letter and its text when available. Return valid JSON only, exactly this schema: {"questions":[{"question":"...","options":["A. ..."],"answer":"...","explanation":"..."}]}. If no question is detected, return {"questions":[]}.\nfirstOnly: ${Boolean(req.body?.firstOnly)}\nOCR_TEXT:\n${ocrText}\nACCESSIBLE_DOM_TEXT (secondary evidence; prefer visible question context):\n${domText}`;
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    });
    let parsed;
    try {
      const raw = result.response.text().trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Gemini returned an unreadable answer. Press Retry to try again." });
    }
    if (!Array.isArray(parsed.questions)) return res.status(502).json({ error: "Gemini response did not contain a questions list. Retry the scan." });
    const questions = parsed.questions.slice(0, req.body?.firstOnly ? 1 : 20).map(q => ({
      question: String(q?.question || "Question not clearly detected").slice(0, 3000),
      options: Array.isArray(q?.options) ? q.options.slice(0, 12).map(o => String(o).slice(0, 500)) : [],
      answer: String(q?.answer || "No reliable answer returned.").slice(0, 4000),
      explanation: String(q?.explanation || "").slice(0, 4000)
    }));
    if (!questions.length) return res.status(422).json({ error: "Text was detected, but no question could be identified. Scroll the question fully into view and retry." });
    return res.json({ questions, ocrText });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("AutoScan request failed:", message);
    if (/quota|resource exhausted|429/i.test(message)) return res.status(429).json({ error: "Gemini quota is exhausted or rate-limited. Wait a little, check your Gemini usage, and retry." });
    if (/api key|unauthenticated|permission denied|401|403/i.test(message)) return res.status(502).json({ error: "Gemini rejected the API key. Check GEMINI_API_KEY in server/.env and restart the server." });
    return res.status(500).json({ error: "AutoScan failed. Check the local server terminal, internet connection, model configuration, and Gemini quota." });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Ask Gemini local server listening at http://127.0.0.1:${port}`);
  console.log("OCR is processed locally; only extracted text and nearby accessible question text are sent to Gemini.");
});
