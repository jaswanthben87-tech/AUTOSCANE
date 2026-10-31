const DEFAULT_SERVER = "https://server-pi-beryl-64.vercel.app";
const runningTabs = new Set();

async function getServerUrl() {
  try {
    const data = await chrome.storage.sync.get("serverUrl");
    if (data?.serverUrl && typeof data.serverUrl === "string" && data.serverUrl.trim()) {
      return data.serverUrl.trim().replace(/\/+$/, "");
    }
  } catch (_) {}
  return DEFAULT_SERVER;
}

async function startScan() {
  let tab;
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
    if (!tab?.id || !tab.windowId) throw new Error("No active webpage was found.");
    if (runningTabs.has(tab.id)) return;
    runningTabs.add(tab.id);

    const server = await getServerUrl();
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (e) {
      throw new Error("Chrome cannot inject AutoScan on this page. Try a normal website; Chrome internal pages and protected pages are blocked.");
    }
    await chrome.tabs.sendMessage(tab.id, { type: "AUTOSCAN_START", screenshot, server });
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
        const activeServer = (message?.server || await getServerUrl()).replace(/\/+$/, "");
        const response = await fetch(`${activeServer}/api/autoscan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: message.image, domText: message.domText || "", firstOnly: Boolean(message.firstOnly) }),
          signal: AbortSignal.timeout(90000)
        });
        const result = await response.json().catch(() => ({ error: "Backend returned an unreadable response." }));
        if (!response.ok) throw new Error(result.error || `Backend request failed (${response.status}).`);
        sendResponse({ ok: true, result });
      } catch (e) {
        const msg = e?.name === "TimeoutError" || e?.name === "AbortError" ? "Request timed out. Check the backend server and retry." : (e?.message || "Cannot reach backend. Make sure your server is running.");
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true;
  }
});
