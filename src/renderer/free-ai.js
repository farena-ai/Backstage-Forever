"use strict";
// Free AI for everyone (0.27): one click runs a small model on this PC; or paste a free cloud key.
window.FreeAI = (() => {
  const api = window.backstage;
  let status = null, note = "", keyFor = null, busy = false, unsub = null, bound = false, draftKey = "";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const gb = (n) => (n / 2 ** 30).toFixed(n >= 2 ** 30 ? 1 : 2);
  // Pick a sensible default from a free provider's own model list.
  const PREFER = { gemini: [/flash(?!.*(lite|image|tts|live|audio))/i, /flash/i], groq: [/llama-3\.3-70b/i, /llama.*70b/i, /llama/i] };
  function pickModel(provider, models) {
    for (const re of PREFER[provider] || []) { const m = models.find((x) => re.test(x.id)); if (m) return m.id; }
    return models[0]?.id || "";
  }
  function card(current) {
    const s = status;
    if (!s) return `<section class="panel free-ai" data-free-ai><p>Checking free AI options…</p></section>`;
    const on = current === "local" && s.installed;
    const p = s.progress, pct = p && p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
    const rec = s.recommended, choice = rec === "cloud" ? "light" : rec;
    const local = !s.supported ? `<p>The built-in AI runs on Windows. Use a free cloud key below.</p>`
      : s.busy ? `<div class="free-ai-progress"><div class="free-ai-bar"><span data-w="${pct}"></span></div><p>${esc(p?.label ? `Downloading ${p.label.replace(/^Checking /, "") === p.label ? p.label : p.label}` : "Getting ready")}${p?.total > 1 ? ` · ${gb(p.received)} of ${gb(p.total)} GB` : ""}</p><button type="button" class="subtle" data-free-act="cancel">Pause</button></div>`
      : on ? `<p class="free-ai-on">✓ On: <strong>${esc(s.model?.name)}</strong> runs on this PC (${esc(s.engine)}). Ask anything in the chat below. Nothing leaves your computer.</p><div class="free-ai-row"><button type="button" class="subtle" data-free-act="remove">Remove (frees ${esc(s.model?.sizeGB)} GB)</button></div>`
      : s.installed ? `<p>The free AI is installed (${esc(s.model?.name)}).</p><button type="button" data-free-act="use">Use the free AI</button>`
      : `<p>One click downloads a small AI model (${esc(s.choices[choice].sizeGB)} GB) and runs it on this PC. It's free, private and works offline. No account, no key, nothing to install yourself.</p>
         <div class="free-ai-row"><button type="button" class="free-ai-go" data-free-act="install" data-tier="${esc(choice)}">Turn on free AI</button>
         <label class="free-ai-pick">Model <select data-free-tier>${Object.entries(s.choices).map(([k, c]) => `<option value="${esc(k)}"${k === choice ? " selected" : ""}>${esc(c.name)} · ${esc(c.sizeGB)} GB${k === rec ? " (best for this PC)" : ""}</option>`).join("")}</select></label></div>
         ${rec === "cloud" ? `<p class="free-ai-warn">This PC has ${esc(s.ramGB)} GB of memory, so a local model may be slow. A free cloud key below is faster.</p>` : ""}`;
    const cloud = ["gemini", "groq"].map((id) => `<li><strong>${id === "gemini" ? "Google Gemini" : "Groq"}</strong> ${current === id ? '<span class="free-ai-tag">In use</span>' : ""}
        <span>${id === "gemini" ? "Free key with daily limits. Google may use free-tier questions to improve its products." : "Very fast; free key with per-minute and daily limits."}</span>
        ${keyFor === id ? `<span class="free-ai-key"><input type="password" data-free-key placeholder="Paste your free key" autocomplete="off" aria-label="Free ${id} key"><button type="button" data-free-act="save-key" data-provider="${id}">Save</button></span>`
          : `<span class="free-ai-row"><button type="button" class="subtle" data-free-act="get-key" data-provider="${id}">1. Get a free key</button><button type="button" class="subtle" data-free-act="paste-key" data-provider="${id}">2. Paste it</button></span>`}</li>`).join("");
    return `<section class="panel free-ai" data-free-ai><div class="free-ai-head"><span class="free-ai-crest" aria-hidden="true"></span><div><h2>Free AI companion</h2><p>Full answers to any question, at no cost.</p></div></div>
      ${local}${note ? `<p class="free-ai-note" role="status">${esc(note)}</p>` : ""}
      <details class="free-ai-cloud"${keyFor ? " open" : ""}><summary>Slow PC? Use a free cloud key instead</summary><ul>${cloud}</ul></details></section>`;
  }
  function paint() {
    const box = document.querySelector("[data-free-ai]"); if (!box) return;
    const current = box.dataset.current || window.__bfProvider || "";
    const tmp = document.createElement("div"); tmp.innerHTML = card(current);
    const fresh = tmp.firstElementChild; fresh.dataset.current = current;
    box.replaceWith(fresh);
    for (const el of fresh.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    restoreKey();
  }
  // A redraw (status updates, page renders) must not wipe a key the player is pasting.
  function restoreKey() { const inp = document.querySelector("[data-free-key]"); if (inp && draftKey && !inp.value) inp.value = draftKey; }
  async function refresh() { try { status = await api.localAiStatus(); } catch { status = null; } paint(); }
  async function act(el) {
    const a = el.dataset.freeAct, provider = el.dataset.provider;
    if (busy && a !== "cancel") return;
    note = "";
    try {
      busy = true;
      if (a === "install") {
        const tier = document.querySelector("[data-free-tier]")?.value || el.dataset.tier;
        const p = api.localAiInstall(tier); setTimeout(refresh, 50);
        await p; note = "Ready. Ask anything below."; window.dispatchEvent(new CustomEvent("bf-provider-changed"));
      } else if (a === "cancel") await api.localAiCancel();
      else if (a === "remove") { await api.localAiRemove(); note = "Removed. The disk space is free again."; window.dispatchEvent(new CustomEvent("bf-provider-changed")); }
      else if (a === "use") { await api.saveProvider({ provider: "local", model: "local", endpoint: "", authMode: "api" }); window.dispatchEvent(new CustomEvent("bf-provider-changed")); }
      else if (a === "get-key") { await api.openLink(provider); keyFor = provider; }
      else if (a === "paste-key") keyFor = provider;
      else if (a === "save-key") {
        const key = (document.querySelector("[data-free-key]")?.value || draftKey).trim();
        if (!key) { note = "Paste the key first."; return; }
        await api.saveProvider({ provider, model: "", endpoint: "", apiKey: key, authMode: "api" });
        const list = await api.listModels({ provider, authMode: "api", endpoint: "", refresh: true });
        const model = pickModel(provider, list?.models || []);
        if (!model) { note = "The key was saved, but no models came back. Check the key and try again."; return; }
        await api.saveProvider({ provider, model, endpoint: "", authMode: "api" });
        keyFor = null; draftKey = ""; note = `Ready: ${provider === "gemini" ? "Gemini" : "Groq"} (${model}). Ask anything below.`;
        window.dispatchEvent(new CustomEvent("bf-provider-changed"));
      }
    } catch (e) { note = e?.message || "That didn't work. Try again."; }
    finally { busy = false; await refresh(); }
  }
  function mounted(current) {
    window.__bfProvider = current;
    const box = document.querySelector("[data-free-ai]"); if (!box) return;
    box.dataset.current = current;
    if (!bound) {
      document.addEventListener("click", (e) => { const el = e.target.closest?.("[data-free-act]"); if (el && el.closest("[data-free-ai]")) act(el); });
      document.addEventListener("input", (e) => { if (e.target.matches?.("[data-free-key]")) draftKey = e.target.value; });
      bound = true;
    }
    if (!unsub && api.onLocalAi) unsub = api.onLocalAi((s) => { status = s; paint(); });
    if (status) paint();
    restoreKey();
    refresh();
  }
  return { card: (current) => card(current), mounted, _pickModel: pickModel, _state: () => ({ status, note, keyFor }) };
})();
