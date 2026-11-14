"use strict";
// Live moments: a painted card for what just happened in game (a notable kill, a cleared dungeon,
// a profession milestone, a new zone or flight path, an upgrade, a finished quest chain) and a
// fuller death screen with the death review. One at a time, never over the level-up celebration.
// The Now page lists recent moments; Settings → Game connection turns them (or some kinds) off.
window.MomentsView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Painted medallions (art/moments, art/NOTICE.md); older art stands in if one is missing.
  const MEDALLION = Object.freeze({ death: "death", elite: "elite", rare: "rare", boss: "boss", dungeon: "dungeon", profession: "profession", zone: "zone", flight: "flight", upgrade: "upgrade", chain: "chain" });
  const FALLBACK = Object.freeze({ death: "art/badges/first-death.png", elite: "art/steps/death.png", rare: "art/badges/speed.png", boss: "art/pins/instance.png", dungeon: "art/badges/first-dungeon.png", profession: "art/pins/profession-trainer.png", zone: "art/steps/zone.png", flight: "art/pins/flight.png", upgrade: "art/badge-level.webp", chain: "art/steps/hand-in.png" });
  const EYEBROW = Object.freeze({ elite: "Elite defeated", rare: "Rare defeated", boss: "Boss defeated", dungeon: "Dungeon cleared", profession: "Profession", zone: "New zone", flight: "Flight path", upgrade: "Upgrade", chain: "Quest chain" });
  const LONG = new Set(["boss", "dungeon", "rare", "chain"]);
  const medal = (kind) => `art/moments/${MEDALLION[kind] || "zone"}.png`;
  const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  let status = { settings: { enabled: true, kinds: {} }, kinds: [], recent: [] };
  const queue = [];
  let showing = null, timer = null, remaining = 0, startedAt = 0;

  function fallbackArt(root) {
    for (const img of root.querySelectorAll("img[data-moment-art]")) {
      img.addEventListener("error", () => { const f = FALLBACK[img.dataset.momentArt]; if (f && !img.src.endsWith(f)) img.src = f; }, { once: true });
    }
  }
  const when = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; };

  // ---- the card
  function card(m) {
    const el = document.createElement("div");
    el.className = `bf-moment bf-moment-${m.kind}`;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `<div class="bf-moment-medal" aria-hidden="true"><span class="bf-moment-rays"></span><img data-moment-art="${esc(m.kind)}" src="${medal(m.kind)}" alt="" width="96" height="96"></div>
      <div class="bf-moment-text"><span class="bf-moment-eyebrow">${esc(EYEBROW[m.kind] || m.title)}</span><strong>${esc(m.subject || m.title)}</strong><p>${esc(m.line)}</p></div>
      <button type="button" class="bf-moment-close" data-moment-close aria-label="Dismiss">×</button><span class="bf-moment-timer" aria-hidden="true"></span>`;
    fallbackArt(el);
    return el;
  }
  function dismiss() {
    clearTimeout(timer); timer = null;
    const el = showing; showing = null;
    if (el) { el.classList.add("leaving"); setTimeout(() => el.remove(), reduced() ? 0 : 420); }
    setTimeout(next, reduced() ? 50 : 460);
  }
  function arm(ms) { remaining = ms; startedAt = Date.now(); clearTimeout(timer); timer = setTimeout(dismiss, ms); }
  function showCard(m) {
    const el = card(m);
    showing = el; el.dataset.momentId = m.id;
    const ms = LONG.has(m.kind) ? 9000 : 7000;
    el.style.setProperty("--moment-ms", `${ms}ms`);
    el.addEventListener("click", (e) => { if (e.target.closest("[data-moment-close]") || !e.target.closest("button")) dismiss(); });
    // Hovering keeps it up.
    el.addEventListener("mouseenter", () => { if (!timer) return; clearTimeout(timer); timer = null; remaining -= Date.now() - startedAt; el.classList.add("paused"); });
    el.addEventListener("mouseleave", () => { if (showing !== el || timer) return; el.classList.remove("paused"); arm(Math.max(1200, remaining)); });
    document.body.appendChild(el);
    arm(ms);
  }

  // ---- the death screen
  function deathMarkup(m) {
    const d = m.death || {};
    const chips = [d.level ? `Level ${esc(d.level)}` : "", d.elite ? "Elite" : "", d.aboveYou > 0 ? `${esc(d.aboveYou)} above you` : ""].filter(Boolean).map((c) => `<span class="bf-death-chip">${c}</span>`).join("");
    const review = d.killer
      ? `<div class="bf-death-killer"><div><span class="bf-death-label">Most of the damage</span><strong>${esc(d.killer)}</strong>${chips ? `<span class="bf-death-chips">${chips}</span>` : ""}</div>
         <div class="bf-death-share" role="img" aria-label="${esc(d.share)}% of the damage"><span data-share="${Number(d.share) || 0}"></span><em>${esc(d.share)}%</em></div></div>
         ${d.others ? `<p class="bf-death-others">${d.others === 1 ? "One other enemy" : `${esc(d.others)} other enemies`} joined in.</p>` : ""}`
      : `<p class="bf-death-others">${d.unknown ? "The live link saw you fall; the full review arrives with the Backstage Forever addon 0.33 or later." : "No enemy damage was recorded in your last seconds: a fall, drowning, or something you could not see."}</p>`;
    return `<div class="bf-death-veil" aria-hidden="true"></div><div class="bf-death-motes" aria-hidden="true">${"<i></i>".repeat(18)}</div>
      <div class="bf-death-panel">
        <img class="bf-death-medal" data-moment-art="death" src="${medal("death")}" alt="" width="132" height="132">
        <h2 id="bf-death-title">You died</h2>
        <p class="bf-death-when">${esc(when(m.at))}</p>
        <section class="bf-death-review">${review}</section>
        <section class="bf-death-change"><h3>What to change</h3><p>${esc(d.change || d.tip || "")}</p></section>
        <section class="bf-death-run"><h3>Back on your feet</h3><ol>${(d.corpseRun || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></section>
        <div class="bf-death-actions"><button type="button" class="bf-death-ok" data-death-close>Back to it</button></div>
      </div>`;
  }
  function paintDeath(el, m) {
    el.innerHTML = deathMarkup(m);
    fallbackArt(el);
    const bar = el.querySelector("[data-share]");
    if (bar) requestAnimationFrame(() => { bar.style.width = `${Math.max(0, Math.min(100, Number(bar.dataset.share)))}%`; });
    [...el.querySelectorAll(".bf-death-motes i")].forEach((p, i) => { p.style.left = `${(i * 53) % 100}%`; p.style.animationDelay = `${(i % 9) * 0.6}s`; p.style.animationDuration = `${6 + (i % 5)}s`; });
  }
  function showDeath(m) {
    const el = document.createElement("div");
    el.className = "bf-death"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "bf-death-title");
    el.dataset.momentId = m.id;
    paintDeath(el, m);
    showing = el;
    const close = () => { document.removeEventListener("keydown", onKey); dismiss(); };
    const onKey = (e) => { if (e.key === "Escape" && showing === el) close(); };
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", (e) => { if (e.target.closest("[data-death-close]") || !e.target.closest(".bf-death-panel")) close(); });
    document.body.appendChild(el);
    el.querySelector("[data-death-close]")?.focus({ preventScroll: true });
    // Stays until dismissed; after two minutes it steps aside by itself.
    clearTimeout(timer); timer = setTimeout(close, 120000);
  }

  // ---- queue
  function next() {
    if (showing || !queue.length) return;
    // Never on top of the level-up celebration: wait for it.
    if (document.querySelector(".bf-celebrate")) { setTimeout(next, 600); return; }
    const m = queue.shift();
    if (m.kind === "death") showDeath(m); else showCard(m);
  }
  function enqueue(m) {
    if (!m || typeof m !== "object" || !m.kind) return;
    remember(m);
    if (m.update) {
      // A fuller death review for a death screen that is open (or still waiting) replaces it.
      const waiting = queue.find((q) => q.id === m.id);
      if (waiting) { Object.assign(waiting, m); return; }
      if (showing?.dataset.momentId === m.id && showing.classList.contains("bf-death")) { paintDeath(showing, m); showing.querySelector("[data-death-close]")?.focus({ preventScroll: true }); }
      return;
    }
    if (m.kind === "death") {
      // The death screen goes first; a card on screen steps aside.
      queue.unshift(m);
      if (showing && !showing.classList.contains("bf-death")) dismiss(); else next();
      return;
    }
    if (queue.length >= 8) queue.splice(queue.findIndex((q) => q.kind !== "death"), 1);
    queue.push(m);
    next();
  }

  // ---- Recent moments (Now) and settings
  function remember(m) {
    const i = status.recent.findIndex((r) => r.id === m.id);
    const row = { ...m }; delete row.update;
    if (i >= 0) status.recent[i] = row; else status.recent.unshift(row);
    status.recent = status.recent.slice(0, 30);
    paintRecent();
  }
  function recentList() {
    const list = status.recent.slice(0, 8);
    if (!list.length) return `<p class="now-tip">Nothing yet this session. With the live link on, elite and boss kills, profession milestones, new zones and more show up here as they happen.</p>`;
    return `<ul class="bf-recent">${list.map((m) => `<li class="bf-recent-${esc(m.kind)}"><img data-moment-art="${esc(m.kind)}" src="${medal(m.kind)}" alt="" width="40" height="40"><div><strong>${esc(m.kind === "death" ? "You died" : m.subject ? `${EYEBROW[m.kind] || m.title}: ${m.subject}` : m.title)}</strong><span>${esc(m.line)}</span></div><time>${esc(when(m.at))}</time></li>`).join("")}</ul>`;
  }
  function recentCard() {
    return `<article class="now-card now-moments"><h2>Recent moments${status.settings.enabled ? "" : ' <small>(off)</small>'}</h2><div data-moments-recent>${recentList()}</div>
      <details class="bf-moment-settings"><summary>Which moments pop up</summary>${settingsInner()}</details></article>`;
  }
  function paintRecent() {
    for (const n of document.querySelectorAll("[data-moments-recent]")) { n.innerHTML = recentList(); fallbackArt(n); }
  }
  function settingsInner() {
    const s = status.settings;
    return `<label class="check-label"><input type="checkbox" data-moment-setting="enabled" ${s.enabled ? "checked" : ""}>Show live moments</label>
      <div class="bf-moment-kinds">${(status.kinds || []).map((k) => `<label class="check-label"><input type="checkbox" data-moment-setting="${esc(k.kind)}" ${s.kinds?.[k.kind] !== false ? "checked" : ""} ${s.enabled ? "" : "disabled"}>${esc(k.label)}</label>`).join("")}</div>
      <p class="bf-moment-note">Moments come over the live link while you play. Turned-off kinds still appear in Recent moments on Now. In game, <code>/bf moments off</code> silences the short messages there.</p>`;
  }
  // Settings → Game connection.
  function settingsMarkup() {
    return `<hr class="rule"><h3>Live moments</h3><div data-moment-settings>${settingsInner()}</div>`;
  }
  function paintSettings() {
    for (const n of document.querySelectorAll("[data-moment-settings], .bf-moment-settings")) {
      const open = n.tagName === "DETAILS" ? n.open : null;
      if (n.tagName === "DETAILS") { n.innerHTML = `<summary>Which moments pop up</summary>${settingsInner()}`; n.open = open; } else n.innerHTML = settingsInner();
    }
  }
  document.addEventListener("change", async (e) => {
    const box = e.target.closest?.("[data-moment-setting]");
    if (!box || !api?.setMomentSettings) return;
    const key = box.dataset.momentSetting;
    try {
      status = await api.setMomentSettings(key === "enabled" ? { enabled: box.checked } : { kinds: { [key]: box.checked } });
      paintSettings(); paintRecent();
    } catch { box.checked = !box.checked; }
  });

  async function load() {
    try { if (api?.moments) status = await api.moments(); } catch {}
    paintRecent(); paintSettings();
  }
  if (api?.onMoment) api.onMoment(enqueue);
  load();
  return { recentCard, settingsMarkup, enqueue, refresh: load, _state: () => ({ status, queue: queue.slice(), showing: Boolean(showing) }) };
})();
