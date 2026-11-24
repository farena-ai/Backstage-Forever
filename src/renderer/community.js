"use strict";
// Settings → Community (0.34): share anonymous finds (on by default, easy off switch), what is and is
// never shared, last sync and Forget my contributions. Reports moved to Help → Report a problem
// (desk.js), where the answer comes back; the three privacy switches are on Settings → Privacy & sharing.
window.CommunityView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let status = null, loadedAt = 0, note = "", busy = false;

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
    return `<label class="check-label community-switch"><input type="checkbox" value="on" data-community-share ${s.share ? "checked" : ""} ${s.blocked ? "disabled" : ""}>Share anonymous finds with other players</label>
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
      <label class="check-label"><input type="checkbox" value="on" data-community-download ${s.download ? "checked" : ""}>Use community data and messages from the team (downloaded from ${esc(s.host)})</label>
      <div class="button-row"><button type="button" class="danger" data-community-forget ${busy ? "disabled" : ""}>Forget my contributions</button></div>
      ${note ? `<p class="community-note" role="status">${esc(note)}</p>` : ""}`;
  }
  function markup() {
    if (!status || Date.now() - loadedAt > 30000) queueMicrotask(load);
    return `<section class="panel community-card" data-community aria-labelledby="community-title">
      <div class="community-heading"><span class="community-seal" aria-hidden="true">⚑</span><div><div class="eyebrow">Shared field notes</div><h2 id="community-title">Community</h2></div><span class="tag">ANONYMOUS</span></div>
      <p>Herb, ore and chest spots you gather, and where you looted quest creatures, help other players find them, and theirs help you. Turn it off any time.</p>
      <div data-community-status>${statusInner()}</div>
      <div class="button-row community-links"><button type="button" data-nav="privacy">Privacy &amp; sharing</button><button type="button" data-nav="report">Report a problem</button></div>
    </section>`;
  }
  function paintStatus() { for (const el of document.querySelectorAll("[data-community-status]")) el.innerHTML = statusInner(); }
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
    }
  });
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
  load();
  return { markup, refresh: load, _state: () => ({ status }) };
})();
