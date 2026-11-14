"use strict";
// Settings → Community (0.34): share anonymous finds (on by default, easy off switch), what is and is
// never shared, last sync, Forget my contributions, and Report a problem with an optional app log
// that is shown in full before anything is sent.
window.CommunityView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CATEGORIES = [["bug", "Something is broken"], ["data", "Wrong map or game data"], ["crash", "The app crashed or froze"], ["suggestion", "Idea or suggestion"], ["other", "Something else"]];
  let status = null, loadedAt = 0, note = "", busy = false;
  const report = { category: "bug", text: "", attach: false, preview: null, state: "idle", message: "" };

  const when = (iso) => { if (!iso) return "Not yet"; const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not yet"; };
  const n = (v) => Number(v || 0).toLocaleString();
  function statusInner() {
    if (!status) return `<p class="community-muted">Loading community settings…</p>`;
    const s = status, r = s.received;
    const state = s.blocked ? "Sharing was stopped by the community service for this install."
      : !s.share ? "Sharing is off. Nothing is sent."
      : s.retryAt ? `The community service is not reachable right now. The app will try again around ${esc(when(s.retryAt))}.`
      : s.pending ? `${n(s.pending)} new find${s.pending === 1 ? "" : "s"} will be shared at the next sync (every 30 minutes).`
      : "Everything you found so far has been shared.";
    return `<label class="check-label community-switch"><input type="checkbox" data-community-share ${s.share ? "checked" : ""} ${s.blocked ? "disabled" : ""}>Share anonymous finds with other players</label>
      <p class="community-state" role="status">${state}</p>
      <dl class="community-facts">
        <div><dt>Last shared</dt><dd>${esc(when(s.lastSubmitAt))}</dd></div>
        <div><dt>Finds you shared</dt><dd>${n(s.sent)}</dd></div>
        <div><dt>Community data received</dt><dd>${r ? `${n(r.total)} facts · ${esc(when(s.lastPackAt))}` : "Not yet"}</dd></div>
        <div><dt>Your anonymous id</dt><dd><code>${esc(s.installId)}</code></dd></div>
      </dl>
      <div class="community-lists">
        <div><h4>What is shared</h4><ul>${(s.shares || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>Never shared</h4><ul>${(s.never || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <p class="community-muted">A spot only appears for others once at least 3 players found it. Community data you receive is shown with a teal “Community” label on the World Map, NPC cards and in the loot browser.</p>
      <label class="check-label"><input type="checkbox" data-community-download ${s.download ? "checked" : ""}>Use community data (downloaded once a day from ${esc(s.host)})</label>
      <div class="button-row"><button type="button" class="danger" data-community-forget ${busy ? "disabled" : ""}>Forget my contributions</button></div>
      ${note ? `<p class="community-note" role="status">${esc(note)}</p>` : ""}`;
  }
  function reportInner() {
    const sending = report.state === "sending";
    const p = report.preview;
    const preview = report.attach ? (p ? `<p class="community-muted">This exact text is attached (${n(p.bytes)} of ${n(p.max)} bytes). Your Windows user name, folders and email addresses are removed. Untick to send without it.</p><pre class="community-log" tabindex="0" aria-label="App log that will be attached">${esc(p.text)}</pre>` : `<p class="community-muted">Preparing the log…</p>`) : "";
    return `<form class="community-report" data-community-report>
      <label>What kind of problem?<select name="category" data-community-category ${sending ? "disabled" : ""}>${CATEGORIES.map(([v, l]) => `<option value="${v}" ${report.category === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>What happened?<textarea name="text" maxlength="2000" required data-community-text placeholder="What you did, what you expected and what happened instead. Please leave out your character name." ${sending ? "disabled" : ""}>${esc(report.text)}</textarea></label>
      <label class="check-label"><input type="checkbox" data-community-attach ${report.attach ? "checked" : ""} ${sending ? "disabled" : ""}>Attach app log</label>
      ${preview}
      <div class="button-row"><button type="submit" class="primary" ${sending || (report.attach && !p) ? "disabled" : ""}>${sending ? "Sending…" : "Send report"}</button></div>
      ${report.message ? `<p class="community-note ${report.state === "sent" ? "ok" : report.state === "failed" ? "bad" : ""}" role="status">${esc(report.message)}</p>` : ""}
    </form>`;
  }
  function markup() {
    if (!status || Date.now() - loadedAt > 30000) queueMicrotask(load);
    return `<section class="panel community-card" data-community aria-labelledby="community-title">
      <div class="community-heading"><span class="community-seal" aria-hidden="true">⚑</span><div><div class="eyebrow">Shared field notes</div><h2 id="community-title">Community</h2></div><span class="tag">ANONYMOUS</span></div>
      <p>Herb, ore and chest spots you gather, and where you looted quest creatures, help other players find them, and theirs help you. Turn it off any time.</p>
      <div data-community-status>${statusInner()}</div>
      <details class="community-report-box"><summary>Report a problem</summary><div data-community-report-box>${reportInner()}</div></details>
    </section>`;
  }
  function paintStatus() { for (const el of document.querySelectorAll("[data-community-status]")) el.innerHTML = statusInner(); }
  function paintReport() {
    for (const el of document.querySelectorAll("[data-community-report-box]")) {
      const focused = document.activeElement?.matches?.("[data-community-text]");
      el.innerHTML = reportInner();
      if (focused) el.querySelector("[data-community-text]")?.focus();
    }
  }
  async function load() {
    if (!api?.communityStatus) return;
    try { status = await api.communityStatus(); loadedAt = Date.now(); } catch {}
    paintStatus();
  }
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches?.("[data-community-share], [data-community-download]")) {
      const key = t.matches("[data-community-share]") ? "share" : "download";
      try { status = await api.setCommunitySettings({ [key]: t.checked }); loadedAt = Date.now(); note = key === "share" ? (t.checked ? "Sharing is on." : "Sharing is off. Nothing more will be sent.") : ""; }
      catch { t.checked = !t.checked; note = "The setting could not be changed. Try again."; }
      paintStatus();
    } else if (t.matches?.("[data-community-category]")) report.category = t.value;
    else if (t.matches?.("[data-community-attach]")) {
      report.attach = t.checked; report.preview = null; paintReport();
      if (report.attach) {
        try { report.preview = await api.communityReportPreview(); } catch { report.attach = false; report.message = "The log could not be prepared. You can send the report without it."; report.state = "failed"; }
        paintReport();
      }
    }
  });
  document.addEventListener("input", (e) => { if (e.target.matches?.("[data-community-text]")) report.text = e.target.value.slice(0, 2000); });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest?.("[data-community-forget]") || busy) return;
    busy = true; note = "Asking the community service to forget your contributions…"; paintStatus();
    try {
      const r = await api.communityForget();
      if (r?.cancelled) note = "";
      else { note = `Done. ${n(r.removed?.observations)} shared fact${r.removed?.observations === 1 ? "" : "s"} and ${n(r.removed?.reports)} report${r.removed?.reports === 1 ? "" : "s"} were removed. You now have a new anonymous id.`; }
      status = r?.status || status;
    } catch (err) { note = err?.message || "The community service could not be reached. Try again later."; }
    busy = false; paintStatus();
  });
  document.addEventListener("submit", async (e) => {
    if (!e.target.matches?.("[data-community-report]")) return;
    e.preventDefault();
    const text = report.text.trim();
    if (!text) { report.state = "failed"; report.message = "Describe the problem first."; paintReport(); return; }
    report.state = "sending"; report.message = ""; paintReport();
    try {
      const r = await api.communityReport({ category: report.category, text, logId: report.attach && report.preview ? report.preview.id : null });
      Object.assign(report, { state: "sent", text: "", attach: false, preview: null, message: r?.id ? `Thank you. Your report was sent. Reference number: ${r.id}.` : "Thank you. Your report was sent." });
    } catch (err) {
      report.state = "failed"; report.message = err?.message || "The report could not be sent. Try again later.";
      if (report.attach) { report.preview = null; try { report.preview = await api.communityReportPreview(); } catch { report.attach = false; } }
    }
    paintReport();
  });
  load();
  return { markup, refresh: load, _state: () => ({ status, report: { ...report } }) };
})();
