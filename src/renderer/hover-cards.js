"use strict";
// Hover cards (0.29): rest the mouse on any quest anywhere in the app and a rich card appears:
// level, how to do it, who gives it and the rewards with their icons. Click still opens the quest.
// 0.30: items ([data-card-item]: icon, stats, upgrade verdict, which boss drops it) and NPCs
// ([data-card-npc]: roles, training, wares, where) get the same card.
window.HoverCards = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cache = new Map(); // "quest:12" / "item:34" / "npc:56" -> { at, promise }
  const TTL = { quest: Infinity, item: 20000, npc: 60000 }; // items carry upgrade verdicts and wish list marks
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  let profileId = null, profileAt = 0, timer = null, card = null, current = null, resting = null;
  async function profile() {
    if (profileId && Date.now() - profileAt < 15000) return profileId;
    // The shell's character picker already knows the active character; asking the main process
    // (bootstrap) here could redraw the page under the user and move keyboard focus.
    const pick = document.getElementById("active-character")?.value;
    if (pick) { profileId = pick; profileAt = Date.now(); }
    return profileId;
  }
  const LOAD = {
    quest: (id) => profile().then((p) => (p ? api.questDetails(p, id) : null)),
    item: (id) => (api.itemCard ? profile().then((p) => api.itemCard(p || null, id)) : Promise.resolve(null)),
    npc: (id) => (api.worldMapNpc ? api.worldMapNpc(id) : Promise.resolve(null)),
  };
  function load(kind, id) {
    const key = `${kind}:${id}`, hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL[kind]) return hit.promise;
    cache.delete(key);
    cache.set(key, { at: Date.now(), promise: LOAD[kind](id).catch(() => null) });
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return cache.get(key).promise;
  }
  function markup(d, fallbackTitle = "") {
    // No reference record (a quest the bundled data doesn't know yet): still say what it is.
    const r = d?.record || (fallbackTitle ? { title: fallbackTitle } : null);
    if (!r) return "";
    const steps = (d?.howTo?.steps || []).slice(0, 3).map((s) => `<li>${esc(s.text)}</li>`).join("");
    const giver = d?.givers?.[0];
    const items = [...(d?.rewards?.items || []), ...(d?.rewards?.choices || [])].slice(0, 6);
    const icons = items.map((it) => it.details?.iconFileId && window.GameIcons ? `<span class="hc-item" title="${esc(it.details.name || it.name || "")}">${GameIcons.tag(it.details.iconFileId, 30)}</span>` : "").join("");
    return `<header><strong>${esc(r.title)}</strong>${r.level ? `<span class="hc-lv">Level ${esc(r.level)}</span>` : ""}</header>
      ${steps ? `<ol class="hc-steps">${steps}</ol>` : r.objectiveEvidence ? `<p>${esc(r.objectiveEvidence)}</p>` : ""}
      ${giver ? `<p class="hc-giver">From <strong>${esc(giver.name || "the quest giver")}</strong></p>` : ""}
      ${icons ? `<div class="hc-rewards">${icons}${d.rewards?.choices?.length ? '<small>pick one</small>' : ""}</div>` : ""}
      <p class="hc-hint">Click to open the quest</p>`;
  }
  const VERDICT = { upgrade: "up", "upgrade-later": "later", "not-for-you": "no", "not-upgrade": "meh", usable: "meh", "no-class": "meh" };
  function itemMarkup(d, fallbackTitle = "") {
    const it = d?.item;
    const name = it?.name || fallbackTitle || (d ? `Item #${d.itemId}` : "");
    if (!name) return "";
    const q = QUALITY[it?.quality] || "unknown";
    const kind = it ? [it.slot, it.kind].filter(Boolean).join(" · ") : "";
    const meta = it ? [it.itemLevel ? `Item level ${it.itemLevel}` : "", it.requiredLevel > 1 ? `Requires level ${it.requiredLevel}` : "", it.bonding || ""].filter(Boolean) : [];
    const stats = it ? [
      it.damage ? `${it.damage.min}–${it.damage.max} damage${it.speed ? ` · speed ${it.speed.toFixed(2)}` : ""}${it.dps ? ` · ${it.dps.toFixed(1)} DPS` : ""}` : "",
      it.armor ? `${it.armor} armor` : "",
      ...(it.stats || []).filter((s) => s.stat !== "Armor").map((s) => `${s.amount > 0 ? "+" : ""}${s.amount} ${s.stat}`),
    ].filter(Boolean) : [];
    const v = d?.verdict, cls = v && VERDICT[v.verdict];
    const why = v?.reasons?.length && ["upgrade", "upgrade-later", "not-upgrade"].includes(v.verdict) ? `<small>${v.reasons.slice(0, 3).map(esc).join(", ")}</small>` : "";
    const verdict = cls && v.text ? `<p class="hc-verdict hc-v-${cls}">${esc(v.text)}${why}</p>` : "";
    const drops = (d?.sources || []).slice(0, 2).map((s) => `<p class="hc-drops">Drops from <strong>${esc(s.boss)}</strong> (${esc(s.instance)}) · ${s.chance >= 0.995 ? "100" : Math.max(1, Math.round(s.chance * 100))}%</p>`).join("");
    return `<header class="hc-item-head"><span class="hc-icon q-${q}">${it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, 40) : '<span class="hc-gem" aria-hidden="true">◆</span>'}</span><span class="hc-title"><strong class="hc-q-${q}">${esc(name)}</strong>${kind ? `<small>${esc(kind)}</small>` : ""}</span></header>
      ${meta.length ? `<p class="hc-meta">${meta.map(esc).join(" · ")}</p>` : ""}
      ${stats.length ? `<ul class="hc-stats">${stats.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${it?.classes?.length ? `<p class="hc-meta">Classes: ${it.classes.map(esc).join(", ")}</p>` : ""}
      ${verdict}${drops}
      ${d?.wished ? `<p class="hc-wish">★ On your wish list</p>` : ""}
      ${!it && d ? `<p class="hc-hint">Item details appear once your game folder is connected.</p>` : ""}`;
  }
  function npcMarkup(d, fallbackTitle = "") {
    const name = d?.name || fallbackTitle;
    if (!name) return "";
    const lines = [];
    if (d?.trainer) {
      const sv = d.trainer.services || [], now = sv.filter((s) => s.learnable).length;
      lines.push(d.trainer.kind === "class-trainer" && d.trainer.forYou === false ? `Trains ${esc(d.trainer.teaches || "another class")}s only` : now ? `<strong>${now}</strong> skill${now === 1 ? "" : "s"} you can learn now` : `${sv.length} skill${sv.length === 1 ? "" : "s"} taught`);
    }
    if (d?.vendor?.items?.length) lines.push(`Sells ${d.vendor.items.length} item${d.vendor.items.length === 1 ? "" : "s"}: ${d.vendor.items.slice(0, 4).map((i) => esc(i.name)).join(", ")}${d.vendor.items.length > 4 ? "…" : ""}`);
    if (d?.flight) lines.push(`Flight path for <strong>${esc(d.flight.town)}</strong>`);
    if (d?.questsGiven?.length) { const ok = d.questsGiven.filter((q) => ["available", "ready", "active"].includes(q.status)).length; lines.push(`${d.questsGiven.length} quest${d.questsGiven.length === 1 ? "" : "s"} given${ok ? ` · ${ok} for you` : ""}`); }
    const at = d?.places?.[0];
    const where = at ? `${esc(at.mapName || "")} ${Math.round(at.x * 100)}, ${Math.round(at.y * 100)}` : "";
    const side = d?.sides?.length ? `<span class="hc-side${d.otherFaction ? " other" : ""}">${esc(d.sides.join(" & "))}</span>` : "";
    return `<header><strong>${esc(name)}</strong>${side}</header>
      ${d?.roles?.length ? `<p class="hc-roles">${d.roles.map(esc).join(" · ")}</p>` : ""}
      ${lines.length ? `<ul class="hc-npc">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
      ${where ? `<p class="hc-giver">Found in <strong>${where}</strong></p>` : ""}
      ${!d ? `<p class="hc-hint">Nothing recorded about them yet.</p>` : ""}`;
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
  const SEL = "[data-card-item], [data-card-npc], [data-quest-open], [data-card-quest]";
  // What an element is about: the most specific attribute wins (an item inside a quest button).
  const target = (el) => el.dataset.cardItem ? ["item", el.dataset.cardItem] : el.dataset.cardNpc ? ["npc", el.dataset.cardNpc] : ["quest", el.dataset.questOpen || el.dataset.cardQuest];
  const same = (a, b) => target(a).join(":") === target(b).join(":");
  // A page can redraw while the mouse rests on a card target: find the same target under the pointer again.
  function under(el, x, y) {
    if (el.isConnected) return el;
    const again = document.elementFromPoint?.(x, y)?.closest?.(SEL);
    return again && same(again, el) ? again : null;
  }
  function show(el, x, y) {
    const [kind, raw] = target(el), id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    current = el;
    load(kind, id).then((d) => {
      if (current !== el) return;
      const now = under(el, x, y);
      if (!now) return;
      current = el = now;
      const fallback = (el.querySelector?.("strong, .loot-name")?.textContent || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const html = kind === "item" ? itemMarkup(d, fallback) : kind === "npc" ? npcMarkup(d, fallback) : markup(d, fallback);
      if (!html) return;
      card?.remove();
      card = document.createElement("div");
      card.className = `hover-card hc-kind-${kind}`; card.setAttribute("role", "tooltip");
      card.innerHTML = html;
      document.body.append(card);
      window.GameIcons?.paint?.(card);
      place(x, y);
    });
  }
  function bind() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    document.addEventListener("mouseover", (e) => {
      if (resting) return;
      const el = e.target.closest?.(SEL);
      if (!el) { if (current && !e.target.closest?.(".hover-card")) hide(); return; }
      if (el === current) return;
      hide();
      const { clientX: x, clientY: y } = e;
      current = el;
      timer = setTimeout(() => show(el, x, y), 350);
    });
    document.addEventListener("mousemove", (e) => {
      // After a click the pointer rests where the page is about to redraw; wait for a real move.
      if (resting && Math.hypot(e.clientX - resting.x, e.clientY - resting.y) > 4) resting = null;
      if (card && current) place(e.clientX, e.clientY);
    });
    document.addEventListener("mousedown", (e) => { hide(); resting = { x: e.clientX, y: e.clientY }; }, true);
    document.addEventListener("keydown", hide, true);
    // Scrolling moves the quest away from the card: drop a shown card, but a redraw that only
    // restores a scroll position must not cancel the card that's about to appear.
    document.addEventListener("scroll", () => { if (card) hide(); }, true);
  }
  bind();
  // forget(): drop cached item cards (after a wish list change or a /reload changed the gear).
  return { _markup: markup, _itemMarkup: itemMarkup, _npcMarkup: npcMarkup, hide, forget: () => { for (const k of [...cache.keys()]) if (!k.startsWith("quest:")) cache.delete(k); } };
})();
