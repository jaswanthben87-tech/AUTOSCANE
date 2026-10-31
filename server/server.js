import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();
dotenv.config({ path: path.join(__dirname, ".env") });
const app = express();
const port = Number(process.env.PORT || 3037);
const apiKey = process.env.GEMINI_API_KEY;
const preferredModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!apiKey || apiKey.includes("PASTE_YOUR")) {
  console.warn("Notice: GEMINI_API_KEY is not set or using placeholder.");
}

// Enable CORS for all origins (Chrome Extension, Vercel frontend, and localhost)
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Candidate models in fallback order to avoid 503 high-demand errors
const candidateModels = [
  preferredModel,
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest"
].filter((m, i, arr) => m && arr.indexOf(m) === i);

async function generateWithFallback(payload, genConfig = {}) {
  if (!genAI) throw new Error("Missing GEMINI_API_KEY environment variable. Set it in your Vercel project settings.");

  let lastError = null;
  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const generativeModel = genAI.getGenerativeModel({ model });
        const result = await generativeModel.generateContent({
          ...payload,
          generationConfig: genConfig
        });
        return { result, model };
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || "");
        const isTransient = /503|high demand|429|quota|resource exhausted|overloaded|temporarily unavailable/i.test(msg);
        if (isTransient && attempt === 0) {
          console.warn(`Model ${model} hit temporary high demand. Retrying in 1.2s...`);
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }
        console.warn(`Model ${model} unavailable (${msg.slice(0, 100)}). Switching to fallback model...`);
        break;
      }
    }
  }
  throw lastError;
}

// Health & Status Check
app.get("/health", (_req, res) => res.json({ ok: true, model: preferredModel, candidates: candidateModels, environment: process.env.VERCEL ? "vercel-cloud" : "local" }));

// Web Interface Landing Page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// AutoScan Full Viewport API (Fast Multimodal Vision with Auto-Fallback)
app.post("/api/autoscan", async (req, res) => {
  try {
    const imageData = req.body?.image;
    if (typeof imageData !== "string" || !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
      return res.status(400).json({ error: "A valid PNG/JPEG screenshot is required." });
    }
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    const mimeType = match[1] === "jpg" ? "image/jpeg" : `image/${match[1]}`;
    const base64Data = match[2];

    const domText = typeof req.body?.domText === "string" ? req.body.domText.slice(0, 10000).trim() : "";

    const prompt = `You are Ask Gemini AutoScan, an intelligent study assistant.
Analyze the attached screenshot and extract any visible test, exam, or study questions along with their answer options.
If accessible webpage text is also provided below, use it as supporting evidence.
Ignore website navigation bars, ads, menus, and unrelated page boilerplate.
Preserve the original question order.
${req.body?.firstOnly ? "Return only the FIRST detected question." : "Detect and answer all clearly visible questions."}

For each question provide:
- question: the exact question text
- options: array of options if multiple-choice (e.g. ["A. Option 1", "B. Option 2"]), or empty array if open-ended
- answer: the correct answer, including the option letter if multiple choice (e.g. "B. 4")
- explanation: concise explanation of why this answer is correct.

Return strictly valid JSON only, using exactly this schema:
{"questions":[{"question":"...","options":["..."],"answer":"...","explanation":"..."}]}
If no question is found in the image, return {"questions":[]}.

${domText ? `ACCESSIBLE_DOM_TEXT (reference):\n${domText}` : ""}`;

    const { result, model: usedModel } = await generateWithFallback(
      {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: base64Data, mimeType } },
              { text: prompt }
            ]
          }
        ]
      },
      { responseMimeType: "application/json", temperature: 0.1 }
    );

    let parsed;
    try {
      const raw = result.response.text().trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Gemini returned an unreadable response. Please retry." });
    }

    if (!Array.isArray(parsed?.questions)) {
      return res.status(502).json({ error: "Gemini response did not contain a questions list. Please retry." });
    }

    const questions = parsed.questions.slice(0, req.body?.firstOnly ? 1 : 20).map(q => ({
      question: String(q?.question || "Question not clearly detected").slice(0, 3000),
      options: Array.isArray(q?.options) ? q.options.slice(0, 12).map(o => String(o).slice(0, 500)) : [],
      answer: String(q?.answer || "No reliable answer returned.").slice(0, 4000),
      explanation: String(q?.explanation || "").slice(0, 4000)
    }));

    if (!questions.length) {
      return res.status(422).json({ error: "No question could be identified on screen. Scroll the question fully into view and retry." });
    }

    return res.json({ questions, model: usedModel, ocrText: "Processed via Gemini Vision" });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("AutoScan request failed:", message);
    if (/quota|resource exhausted|429/i.test(message)) return res.status(429).json({ error: "Gemini quota is exhausted or rate-limited. Wait a little and retry." });
    if (/503|high demand|overloaded/i.test(message)) return res.status(503).json({ error: "Gemini servers are experiencing high demand across all models. Please retry in a few moments." });
    if (/api key|unauthenticated|permission denied|401|403/i.test(message)) return res.status(502).json({ error: "Gemini rejected the API key. Check GEMINI_API_KEY environment variable." });
    return res.status(500).json({ error: "AutoScan failed: " + (message || "Internal error") });
  }
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
    const base64Data = match[2];

    const promptText = [
      "You are Ask Gemini, a helpful study assistant.",
      "Answer the question shown in the screenshot.",
      "If it is a multiple-choice question, identify the correct option and explain briefly.",
      "Give a clear, direct answer followed by a short explanation when useful."
    ].join("\n");

    const { result, model: usedModel } = await generateWithFallback({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: promptText }
          ]
        }
      ]
    });
    const answer = result.response.text();
    return res.json({ extractedText: "Processed via Gemini Vision", model: usedModel, answer });
  } catch (error) {
    console.error("Scan request failed:", error?.message || error);
    return res.status(500).json({
      error: "Scan failed. Check the API key, model name, network connection, and Gemini API quota."
    });
  }
});

// Run server locally when not running inside Vercel serverless
if (!process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Ask Gemini server listening at http://127.0.0.1:${port}`);
    console.log(`Preferred model: ${preferredModel}, Fallbacks: ${candidateModels.join(", ")}`);
  });
}

export default app;
