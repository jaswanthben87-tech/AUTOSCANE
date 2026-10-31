(() => {
  if (window.__askGeminiAutoScanInstalled) return;
  window.__askGeminiAutoScanInstalled = true;
  let host, shadow, currentServer = "http://127.0.0.1:3037", busy = false, minimized = false;
  const $ = (s) => shadow.querySelector(s);

  function ensurePanel() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "ask-gemini-autoscan-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;";
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      *{box-sizing:border-box} .panel{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#18202b;background:#fff;width:min(390px,calc(100vw - 24px));max-height:min(76vh,680px);border:1px solid #dbe1e8;border-radius:16px;box-shadow:0 14px 44px #0003;display:flex;flex-direction:column;overflow:hidden}
      .head{display:flex;align-items:center;gap:9px;padding:12px 13px;background:#f7f9fc;border-bottom:1px solid #e7ebf0;cursor:move;user-select:none}.brand{font-weight:750;flex:1;font-size:14px}.btn{border:0;border-radius:8px;padding:7px 10px;background:#edf1f6;color:#202938;cursor:pointer;font:inherit}.btn.primary{background:#2563eb;color:white}.btn:disabled{opacity:.55;cursor:wait}.body{padding:13px;overflow:auto;overscroll-behavior:contain}.status{display:flex;gap:8px;align-items:center;color:#596579;font-size:12px;margin-bottom:12px}.dot{width:8px;height:8px;border-radius:50%;background:#2563eb}.spin{border:2px solid #dbeafe;border-top-color:#2563eb;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}} h4{margin:12px 0 5px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#647084} .text{white-space:pre-wrap;overflow-wrap:anywhere}.answer{background:#f4f7ff;border:1px solid #dbe5ff;padding:10px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}.q{font-weight:650}.opts{margin:6px 0;padding-left:22px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.error{background:#fff1f0;color:#a32018;border:1px solid #ffd1cc;border-radius:9px;padding:10px;white-space:pre-wrap}.hidden{display:none!important}.collapsed .body{display:none}.foot{font-size:11px;color:#748094;margin-top:10px;display:flex;justify-content:space-between;align-items:center;}@media(max-width:440px){.panel{width:calc(100vw - 24px);max-height:70vh}}
    </style><section class="panel"><header class="head"><span aria-hidden="true">✦</span><span class="brand">Ask Gemini AutoScan</span><button class="btn" id="min" title="Minimize">−</button><button class="btn" id="close" title="Close">×</button></header><div class="body"><div class="status"><span class="dot" id="dot"></span><span id="status">Ready to scan</span></div><div id="results"></div><div id="err" class="error hidden"></div><label style="display:flex;gap:7px;align-items:center;margin-top:12px;font-size:12px;color:#596579"><input id="firstOnly" type="checkbox"> Answer only the first detected question</label><div class="actions"><button class="btn primary" id="copy">Copy Answer</button><button class="btn" id="again">Scan Again</button><button class="btn primary hidden" id="retry">Retry</button></div><div class="foot"><span>Screen processed safely.</span><a id="changeServer" href="#" style="color:#2563eb;text-decoration:none;font-weight:600;cursor:pointer;">⚙️ Server Settings</a></div></div></section>`;
    document.documentElement.appendChild(host);
    $("#close").addEventListener("click", () => { host.remove(); host = null; });
    $("#min").addEventListener("click", () => { minimized = !minimized; $(".panel").classList.toggle("collapsed", minimized); $("#min").textContent = minimized ? "□" : "−"; });
    $("#again").addEventListener("click", () => requestScan());
    $("#retry").addEventListener("click", () => requestScan());
    $("#copy").addEventListener("click", async () => { const text = shadow.querySelector("#results").innerText; try { await navigator.clipboard.writeText(text || ""); $("#copy").textContent = "Copied!"; setTimeout(() => { if(host?.isConnected) $("#copy").textContent = "Copy Answer"; }, 1200); } catch { setStatus("Clipboard blocked. Select and copy the answer manually.", false); } });
    $("#changeServer").addEventListener("click", async (e) => {
      e.preventDefault();
      const input = prompt("Enter your Cloud Backend URL (e.g. https://autoscane.vercel.app or http://127.0.0.1:3037):", currentServer);
      if (input !== null) {
        const val = input.trim().replace(/\/+$/, "");
        if (val) {
          currentServer = val;
          await chrome.storage.sync.set({ serverUrl: currentServer });
          setStatus(`Backend updated to: ${currentServer}`);
        }
      }
    });
    const head = $(".head"); let drag = null;
    head.addEventListener("pointerdown", e => { if (e.target.closest("button")) return; const r=host.getBoundingClientRect(); drag={x:e.clientX-r.left,y:e.clientY-r.top}; head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", e => { if(!drag)return; host.style.left=Math.max(0,Math.min(innerWidth-host.offsetWidth,e.clientX-drag.x))+"px"; host.style.top=Math.max(0,Math.min(innerHeight-45,e.clientY-drag.y))+"px"; host.style.right="auto"; host.style.bottom="auto"; });
    head.addEventListener("pointerup", () => drag=null);
  }
  function setStatus(s, loading=false) { ensurePanel(); $("#status").textContent=s; $("#dot").classList.toggle("spin",loading); $("#err").classList.add("hidden"); $("#retry").classList.add("hidden"); }
  function showError(message) { ensurePanel(); busy=false; $("#status").textContent="Scan failed"; $("#dot").classList.remove("spin"); $("#err").textContent=message; $("#err").classList.remove("hidden"); $("#retry").classList.remove("hidden"); $("#again").disabled=false; }
  function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
  function render(data) {
    const root=$("#results"); root.replaceChildren();
    const qs=Array.isArray(data.questions)?data.questions: [{question:data.extractedText||"Detected text",options:[],answer:data.answer||"No answer returned.",explanation:""}];
    qs.forEach((q,i)=>{ const block=el("section"); if(qs.length>1) block.append(el("h4",null,`Question ${i+1}`)); block.append(el("div","q",q.question||"Question not detected"));
      if(Array.isArray(q.options)&&q.options.length){const list=el("ol","opts"); q.options.forEach(o=>list.append(el("li",null,String(o)))); block.append(list);}
      block.append(el("h4",null,"Gemini answer"),el("div","answer",q.answer||"No answer returned.")); if(q.explanation)block.append(el("h4",null,"Explanation"),el("div","text",q.explanation)); root.append(block);
    });
    $("#status").textContent=`Answer ready · ${qs.length} question${qs.length===1?"":"s"}`; $("#dot").classList.remove("spin"); $("#err").classList.add("hidden"); $("#retry").classList.add("hidden"); $("#again").disabled=false; busy=false;
  }
  async function requestScan(screenshot) {
    ensurePanel(); if(busy)return; busy=true; minimized=false; $(".panel").classList.remove("collapsed"); $("#min").textContent="−"; $("#again").disabled=true;
    try {
      if(!screenshot) { setStatus("Capturing visible page…",true); const response=await chrome.runtime.sendMessage({type:"AUTOSCAN_RECAPTURE"}); screenshot=response?.screenshot; if(!screenshot)throw new Error(response?.error||"Could not capture the page. Use Ctrl+Shift+Q while the target tab is active."); }
      setStatus("Extracting question text…",true);
      const domText=extractRelevantDomText();
      setStatus("Analyzing question with Gemini…",true);
      const data = await chrome.runtime.sendMessage({type:"AUTOSCAN_PROCESS", server:currentServer, image:screenshot, domText, firstOnly:$("#firstOnly").checked});
      if(!data?.ok) throw new Error(data?.error || "Backend request failed.");
      render(data.result);
    } catch(e) { showError(e.name==="AbortError"?"Request timed out after 90 seconds. Check the backend server and retry.":(e.message.includes("Failed to fetch")?`Cannot reach backend at ${currentServer}. Make sure your server is online or click Server Settings below.`:e.message||"Unexpected scan error.")); }
  }
  function extractRelevantDomText() {
    try { const nodes=[...document.querySelectorAll("h1,h2,h3,p,label,li,[role=question],.question,[class*=question i],input[type=radio],input[type=checkbox]")]; return nodes.map(n=>{if(n.matches("input"))return n.labels?.[0]?.innerText||n.getAttribute("aria-label")||"";return n.innerText||n.textContent||"";}).map(s=>s.trim()).filter(s=>s.length>2&&s.length<1200).slice(0,100).join("\n").slice(0,12000); } catch{return "";}
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if(msg?.type==="AUTOSCAN_START"){ currentServer=msg.server||currentServer; void requestScan(msg.screenshot); }
    if(msg?.type==="AUTOSCAN_ERROR")showError(msg.error||"Unable to start scan on this page.");
  });
})();
