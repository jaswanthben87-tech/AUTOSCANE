import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Tesseract from "tesseract.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3037);
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!apiKey || apiKey.includes("PASTE_YOUR")) {
  console.warn("Notice: GEMINI_API_KEY is not set or using placeholder.");
}

// Enable CORS for all origins (Chrome Extension, Vercel frontend, and localhost)
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const getModel = () => {
  if (!genAI) throw new Error("Missing GEMINI_API_KEY environment variable. Set it in your Vercel project settings.");
  return genAI.getGenerativeModel({ model: modelName });
};

// Health & Status Check
app.get("/health", (_req, res) => res.json({ ok: true, model: modelName, environment: process.env.VERCEL ? "vercel-cloud" : "local" }));

// Web Interface Landing Page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Selective Crop Scan API
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

    let extractedText = "";
    try {
      const { data } = await Tesseract.recognize(imageBuffer, "eng", { cachePath: "/tmp" });
      extractedText = (data.text || "").trim();
    } catch (err) {
      console.warn("Local OCR skipped/failed, falling back to Gemini vision:", err?.message || err);
    }

    const promptText = [
      "You are Ask Gemini, a helpful study assistant.",
      "Answer the question extracted from a screenshot.",
      "If it is a multiple-choice question, identify the correct option and explain briefly.",
      "If OCR contains obvious recognition errors, infer cautiously from context.",
      "If the question is incomplete or unreadable, say what is missing instead of inventing details.",
      "Give a clear, direct answer followed by a short explanation when useful.",
      "",
      extractedText ? `OCR-extracted question:\n${extractedText}` : "Please read the question from the attached image directly."
    ].join("\n");

    const parts = [{ text: promptText }];
    if (!extractedText) {
      parts.push({ inlineData: { data: match[2], mimeType } });
    }

    const model = getModel();
    const result = await model.generateContent(parts);
    const answer = result.response.text();
    return res.json({ extractedText: extractedText || "Image processed via Gemini Vision", answer });
  } catch (error) {
    console.error("Scan request failed:", error?.message || error);
    return res.status(500).json({
      error: "Scan failed. Check the API key, model name, network connection, and Gemini API quota."
    });
  }
});

// AutoScan Full Viewport API
app.post("/api/autoscan", async (req, res) => {
  try {
    const imageData = req.body?.image;
    if (typeof imageData !== "string" || !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
      return res.status(400).json({ error: "A valid PNG/JPEG screenshot is required." });
    }
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    const mimeType = match[1] === "jpg" ? "image/jpeg" : `image/${match[1]}`;
    const imageBuffer = Buffer.from(match[2], "base64");
    if (imageBuffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "Screenshot is too large. Reduce the browser window size, then retry." });
    }

    let ocrText = "";
    try {
      const { data } = await Tesseract.recognize(imageBuffer, "eng", { cachePath: "/tmp" });
      ocrText = (data.text || "").trim().slice(0, 14000);
    } catch (err) {
      console.warn("Tesseract OCR skipped/failed, using multimodal Gemini vision:", err?.message || err);
    }

    const domText = typeof req.body?.domText === "string" ? req.body.domText.slice(0, 12000).trim() : "";

    const prompt = `You are Ask Gemini AutoScan, a careful study assistant. Extract the visible questions from the supplied image, OCR text, and optional webpage text. Use only questions and nearby answer options; ignore navigation, ads, unrelated paragraphs, and page boilerplate. Preserve the original question order. If the user asks for firstOnly, return only the first question. Do not guess missing or unreadable text; say when something is unclear. For each question provide question, options (array of strings), answer, and explanation (brief). For multiple choice, identify the option letter and its text when available. Return valid JSON only, exactly this schema: {"questions":[{"question":"...","options":["A. ..."],"answer":"...","explanation":"..."}]}. If no question is detected, return {"questions":[]}.\nfirstOnly: ${Boolean(req.body?.firstOnly)}\nOCR_TEXT:\n${ocrText || "Not available (refer to image directly)"}\nACCESSIBLE_DOM_TEXT (secondary evidence):\n${domText}`;

    const parts = [{ text: prompt }];
    // If OCR produced little or no text, pass the image directly into Gemini multimodal
    if (!ocrText || ocrText.length < 20) {
      parts.push({ inlineData: { data: match[2], mimeType } });
    }

    const model = getModel();
    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
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

    if (!questions.length) return res.status(422).json({ error: "No question could be identified. Scroll the question fully into view and retry." });
    return res.json({ questions, ocrText: ocrText || "Processed via Gemini Vision" });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("AutoScan request failed:", message);
    if (/quota|resource exhausted|429/i.test(message)) return res.status(429).json({ error: "Gemini quota is exhausted or rate-limited. Wait a little and retry." });
    if (/api key|unauthenticated|permission denied|401|403/i.test(message)) return res.status(502).json({ error: "Gemini rejected the API key. Check GEMINI_API_KEY environment variable." });
    return res.status(500).json({ error: "AutoScan failed. Check internet connection, model configuration, and Gemini quota." });
  }
});

// Run server locally when not running inside Vercel serverless
if (!process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Ask Gemini server listening at http://127.0.0.1:${port}`);
    console.log("OCR and multimodal processing ready.");
  });
}

export default app;
