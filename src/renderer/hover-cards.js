"use strict";
// Hover cards (0.29): rest the mouse on any quest anywhere in the app and a rich card appears:
// level, how to do it, who gives it and the rewards with their icons. Click still opens the quest.
window.HoverCards = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cache = new Map(); // questId -> Promise<details|null>
  let profileId = null, profileAt = 0, timer = null, card = null, current = null;
  async function profile() {
    if (profileId && Date.now() - profileAt < 15000) return profileId;
    // The shell's character picker already knows the active character; asking the main process
    // (bootstrap) here could redraw the page under the user and move keyboard focus.
    const pick = document.getElementById("active-character")?.value;
    if (pick) { profileId = pick; profileAt = Date.now(); }
    return profileId;
  }
  function details(id) {
    if (!cache.has(id)) {
      cache.set(id, profile().then((p) => (p ? api.questDetails(p, id) : null)).catch(() => null));
      if (cache.size > 120) cache.delete(cache.keys().next().value);
    }
    return cache.get(id);
  }
  function markup(d) {
    const r = d?.record;
    if (!r) return "";
    const steps = (d.howTo?.steps || []).slice(0, 3).map((s) => `<li>${esc(s.text)}</li>`).join("");
    const giver = d.givers?.[0];
    const items = [...(d.rewards?.items || []), ...(d.rewards?.choices || [])].slice(0, 6);
    const icons = items.map((it) => it.details?.iconFileId && window.GameIcons ? `<span class="hc-item" title="${esc(it.details.name || it.name || "")}">${GameIcons.tag(it.details.iconFileId, 30)}</span>` : "").join("");
    return `<header><strong>${esc(r.title)}</strong>${r.level ? `<span class="hc-lv">Level ${esc(r.level)}</span>` : ""}</header>
      ${steps ? `<ol class="hc-steps">${steps}</ol>` : r.objectiveEvidence ? `<p>${esc(r.objectiveEvidence)}</p>` : ""}
      ${giver ? `<p class="hc-giver">From <strong>${esc(giver.name || "the quest giver")}</strong></p>` : ""}
      ${icons ? `<div class="hc-rewards">${icons}${d.rewards?.choices?.length ? '<small>pick one</small>' : ""}</div>` : ""}
      <p class="hc-hint">Click to open the quest</p>`;
  }
  function place(x, y) {
    if (!card) return;
    const w = card.offsetWidth, h = card.offsetHeight, pad = 14;
    let left = x + pad, top = y + pad;
    if (left + w > innerWidth - 8) left = Math.max(8, x - w - pad);
    if (top + h > innerHeight - 8) top = Math.max(8, y - h - pad);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }
  function hide() { clearTimeout(timer); timer = null; current = null; card?.remove(); card = null; }
  const SEL = "[data-quest-open], [data-card-quest]";
  // A page can redraw while the mouse rests on a quest: find the same quest under the pointer again.
  function under(el, x, y) {
    if (el.isConnected) return el;
    const again = document.elementFromPoint?.(x, y)?.closest?.(SEL);
    return again && (again.dataset.questOpen || again.dataset.cardQuest) === (el.dataset.questOpen || el.dataset.cardQuest) ? again : null;
  }
  function show(el, x, y) {
    const id = Number(el.dataset.questOpen || el.dataset.cardQuest);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    current = el;
    details(id).then((d) => {
      if (current !== el) return;
      const now = under(el, x, y);
      if (!now) return;
      current = el = now;
      const html = markup(d);
      if (!html) return;
      card?.remove();
      card = document.createElement("div");
      card.className = "hover-card"; card.setAttribute("role", "tooltip");
      card.innerHTML = html;
      document.body.append(card);
      window.GameIcons?.paint?.(card);
      place(x, y);
    });
  }
  function bind() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest?.(SEL);
      if (!el) { if (current && !e.target.closest?.(".hover-card")) hide(); return; }
      if (el === current) return;
      hide();
      const { clientX: x, clientY: y } = e;
      current = el;
      timer = setTimeout(() => show(el, x, y), 350);
    });
    document.addEventListener("mousemove", (e) => { if (card && current) place(e.clientX, e.clientY); });
    for (const ev of ["mousedown", "keydown"]) document.addEventListener(ev, hide, true);
    // Scrolling moves the quest away from the card: drop a shown card, but a redraw that only
    // restores a scroll position must not cancel the card that's about to appear.
    document.addEventListener("scroll", () => { if (card) hide(); }, true);
  }
  bind();
  return { _markup: markup, hide };
})();
