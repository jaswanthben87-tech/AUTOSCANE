const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const selection = document.getElementById("selection");
const statusEl = document.getElementById("status");
const scanBtn = document.getElementById("scanBtn");
const result = document.getElementById("result");
const ocrText = document.getElementById("ocrText");
const answerText = document.getElementById("answerText");
let screenshotImage = new Image();
let dragStart = null;
let selectedRect = null;
let scaleX = 1;
let scaleY = 1;

function setStatus(text) { statusEl.textContent = text; }

async function loadScreenshot() {
  const data = await chrome.storage.session.get(["scanScreenshot", "scanError"]);
  if (data.scanError) {
    setStatus(data.scanError + " Try a normal webpage rather than a Chrome settings or extensions page.");
    return;
  }
  if (!data.scanScreenshot) {
    setStatus("No screenshot found. Press Ctrl+Shift+Q on a normal webpage to start.");
    return;
  }
  screenshotImage.onload = () => {
    const maxW = Math.max(300, stage.clientWidth - 4);
    const maxH = 420;
    const scale = Math.min(maxW / screenshotImage.naturalWidth, maxH / screenshotImage.naturalHeight, 1);
    canvas.width = Math.round(screenshotImage.naturalWidth * scale);
    canvas.height = Math.round(screenshotImage.naturalHeight * scale);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    ctx.drawImage(screenshotImage, 0, 0, canvas.width, canvas.height);
    scaleX = screenshotImage.naturalWidth / canvas.width;
    scaleY = screenshotImage.naturalHeight / canvas.height;
    setStatus("Screenshot ready. Drag to select the question.");
    scanBtn.disabled = true;
  };
  screenshotImage.onerror = () => setStatus("Could not load the screenshot.");
  screenshotImage.src = data.scanScreenshot;
}

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(canvas.height, event.clientY - rect.top))
  };
}
function drawSelection(x, y, w, h) {
  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  selection.style.display = "block";
  selection.style.left = `${canvasRect.left - stageRect.left + x + stage.scrollLeft}px`;
  selection.style.top = `${canvasRect.top - stageRect.top + y + stage.scrollTop}px`;
  selection.style.width = `${w}px`;
  selection.style.height = `${h}px`;
}
canvas.addEventListener("pointerdown", (event) => {
  if (!screenshotImage.src) return;
  canvas.setPointerCapture(event.pointerId);
  dragStart = pointerPos(event);
  selectedRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  drawSelection(dragStart.x, dragStart.y, 0, 0);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  const p = pointerPos(event);
  const x = Math.min(dragStart.x, p.x), y = Math.min(dragStart.y, p.y);
  const w = Math.abs(p.x - dragStart.x), h = Math.abs(p.y - dragStart.y);
  selectedRect = { x, y, w, h };
  drawSelection(x, y, w, h);
});
canvas.addEventListener("pointerup", () => {
  dragStart = null;
  const valid = selectedRect && selectedRect.w >= 12 && selectedRect.h >= 12;
  scanBtn.disabled = !valid;
  if (valid) setStatus("Region selected. Click Scan & answer.");
});
document.getElementById("resetBtn").addEventListener("click", () => {
  selectedRect = null;
  selection.style.display = "none";
  scanBtn.disabled = true;
  result.classList.add("hidden");
  setStatus("Drag to select the question.");
});
document.getElementById("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(answerText.textContent);
    setStatus("Answer copied to clipboard.");
  } catch {
    setStatus("Clipboard access was blocked. Select and copy the answer manually.");
  }
});

scanBtn.addEventListener("click", async () => {
  if (!selectedRect) return;
  scanBtn.disabled = true;
  result.classList.remove("hidden");
  ocrText.textContent = "";
  answerText.textContent = "Processing…";
  setStatus("Cropping region and sending it for OCR…");
  try {
    const crop = document.createElement("canvas");
    crop.width = Math.round(selectedRect.w * scaleX);
    crop.height = Math.round(selectedRect.h * scaleY);
    const cropCtx = crop.getContext("2d");
    cropCtx.drawImage(
      screenshotImage,
      Math.round(selectedRect.x * scaleX), Math.round(selectedRect.y * scaleY),
      crop.width, crop.height,
      0, 0, crop.width, crop.height
    );
    const image = crop.toDataURL("image/png");
    const response = await fetch("http://127.0.0.1:3037/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server returned HTTP ${response.status}`);
    ocrText.textContent = `Extracted text:\n${payload.extractedText || "(No text detected)"}`;
    answerText.textContent = payload.answer || "Gemini did not return an answer.";
    setStatus("Done.");
  } catch (error) {
    answerText.textContent = "";
    setStatus(`Error: ${error.message}. Make sure the local server is running at http://127.0.0.1:3037.`);
  } finally {
    scanBtn.disabled = false;
  }
});

loadScreenshot();
