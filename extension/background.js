const SERVER = "http://127.0.0.1:3037";
const runningTabs = new Set();

async function startScan() {
  let tab;
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
    if (!tab?.id || !tab.windowId) throw new Error("No active webpage was found.");
    if (runningTabs.has(tab.id)) return;
    runningTabs.add(tab.id);

    // Capture first while the target tab is still active; never send this image to Gemini.
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (e) {
      throw new Error("Chrome cannot inject AutoScan on this page. Try a normal website; Chrome internal pages and protected pages are blocked.");
    }
    await chrome.tabs.sendMessage(tab.id, { type: "AUTOSCAN_START", screenshot, server: SERVER });
  } catch (error) {
    if (tab?.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await chrome.tabs.sendMessage(tab.id, { type: "AUTOSCAN_ERROR", error: error?.message || "Could not capture this tab." });
      } catch (_) { console.warn("AutoScan unavailable on this tab:", error); }
    }
  } finally {
    if (tab?.id) runningTabs.delete(tab.id);
  }
}

chrome.commands.onCommand.addListener((command) => { if (command === "scan-question") void startScan(); });
chrome.action.onClicked.addListener(() => void startScan());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AUTOSCAN_RECAPTURE") {
    (async () => {
      try {
        const tab = sender.tab;
        if (!tab?.id || !tab.windowId) throw new Error("The active tab is unavailable. Press Ctrl+Shift+Q again.");
        const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        sendResponse({ screenshot });
      } catch (e) { sendResponse({ error: e?.message || "Screenshot capture failed." }); }
    })();
    return true;
  }
  if (message?.type === "AUTOSCAN_PROCESS") {
    (async () => {
      try {
        const response = await fetch(`${SERVER}/api/autoscan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: message.image, domText: message.domText || "", firstOnly: Boolean(message.firstOnly) }),
          signal: AbortSignal.timeout(90000)
        });
        const result = await response.json().catch(() => ({ error: "Backend returned an unreadable response." }));
        if (!response.ok) throw new Error(result.error || `Backend request failed (${response.status}).`);
        sendResponse({ ok: true, result });
      } catch (e) {
        const msg = e?.name === "TimeoutError" || e?.name === "AbortError" ? "Request timed out. Check the local server and retry." : (e?.message || "Cannot reach local backend at 127.0.0.1:3037. Start it with npm start.");
        sendResponse({ ok: false, error: msg.includes("fetch") ? "Cannot reach the local backend at 127.0.0.1:3037. Start the server with npm start in the server folder." : msg });
      }
    })();
    return true;
  }
});
