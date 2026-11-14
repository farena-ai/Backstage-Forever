"use strict";
// Ledger (0.35): Bags & bank, Gold & prices, Reputation and Cooldowns for every character, from
// the addon's ledger (bank and mail as last seen, prices from Auction House pages the player
// opened). Read-only: one `ledger` request, searched here.
window.LedgerView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const LIMIT = 150;
  let data = null, error = "", loading = false, loadedAt = 0, mountedFor = null, route = "ledger", repFor = null;
  const query = { items: "", prices: "" };
  const nowSec = () => Math.floor(Date.now() / 1000);
  function coins(copper) {
    if (!Number.isFinite(copper)) return "?";
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return `<span class="ldg-coins">${g ? `<span class="ldg-gold">${g.toLocaleString()}g</span>` : ""}${s ? `<span class="ldg-silver">${s}s</span>` : ""}${c || (!g && !s) ? `<span class="ldg-copper">${c}c</span>` : ""}</span>`;
  }
  function ago(at) {
    if (!Number.isFinite(at)) return "never";
    const s = Math.max(0, nowSec() - at);
    if (s < 120) return "just now";
    if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
    if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  function wait(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.ceil((seconds % 3600) / 60);
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }
  const quality = (q) => QUALITY[q] || "common";
  const ledgered = () => (data?.characters || []).filter((c) => c.hasLedger);
  const active = () => data?.characters.find((c) => c.profileId === data.activeProfileId) || null;
  function search(rows, q) {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => String(r.itemId) === q.trim() || words.every((w) => r.name.toLowerCase().includes(w)));
  }
  function empty(what) {
    return `<p class="ldg-empty">${what} Log in with the 0.35 addon, then type <code>/reload</code> (or log out) once so the desktop app receives it.</p>`;
  }
  function hero(art, page, title, subtitle) {
    const cls = String(active()?.className || "").toLowerCase();
    return PageHero.render({ art, eyebrow: `Ledger · ${page}`, title: esc(title), crest: PageHero.classCrest(cls), subtitle });
  }

  // Bags & bank: one row per item, with who holds it where.
  function placeLine(h) {
    const parts = [h.bags ? `bags ${h.bags}` : "", h.bank ? `bank ${h.bank}` : "", h.mail ? `mail ${h.mail}` : ""].filter(Boolean).join(" · ");
    const seen = [h.bank ? `bank seen ${ago(h.bankSeenAt)}` : "", h.mail ? `mail seen ${ago(h.mailSeenAt)}` : ""].filter(Boolean).join(", ");
    return `<li><strong>${esc(h.name)}</strong><span>${esc(parts)}</span>${seen ? `<small>${esc(seen)}</small>` : ""}</li>`;
  }
  function itemRows() {
    const rows = search(data.items, query.items);
    if (!rows.length) return `<p class="ldg-empty">${data.items.length ? "Nothing your characters carry matches that." : "No items yet."}</p>`;
    return `<ul class="ldg-items">${rows.slice(0, LIMIT).map((r) => `<li class="ldg-item" data-ledger-item="${r.itemId}">
      <div class="ldg-item-head" data-card-item="${r.itemId}"><span class="ldg-gem q-${quality(r.quality)}" aria-hidden="true">◆</span><strong class="ldg-name q-${quality(r.quality)}">${esc(r.name)}</strong><span class="ldg-total">×${r.total.toLocaleString()}</span></div>
      <ul class="ldg-holders">${r.holders.map(placeLine).join("")}</ul></li>`).join("")}</ul>
      ${rows.length > LIMIT ? `<p class="ldg-more">Showing ${LIMIT} of ${rows.length}. Search to narrow it down.</p>` : ""}`;
  }
  function seenChips() {
    return `<ul class="ldg-chips">${ledgered().map((c) => `<li><strong>${esc(c.name)}</strong> <span>bags ${esc(ago(c.bagsSeenAt))}</span> · <span>${c.bankSeenAt ? `bank ${esc(ago(c.bankSeenAt))}` : "bank never opened"}</span> · <span>${c.mailSeenAt ? `mail ${esc(ago(c.mailSeenAt))}` : "mailbox never opened"}</span></li>`).join("")}</ul>`;
  }
  function bags() {
    const chars = ledgered();
    if (!chars.length) return empty("No ledger yet.");
    const neverBank = chars.filter((c) => !c.bankSeenAt).length;
    return `<div class="ldg-summary"><div><strong>${data.items.length.toLocaleString()}</strong><span>different items</span></div><div><strong>${chars.length}</strong><span>characters</span></div><div><strong>${data.items.reduce((s, r) => s + r.total, 0).toLocaleString()}</strong><span>items in all</span></div><div><strong>${neverBank}</strong><span>bank${neverBank === 1 ? "" : "s"} never opened</span></div></div>
      <section class="ldg-card"><h2>Last seen</h2><p class="ldg-note">Bags update whenever the addon saves. Bank and mail are as they were the last time you opened them in game.</p>${seenChips()}</section>
      <section class="ldg-card"><h2>Search everything</h2><label class="ldg-search"><span class="sr-only">Search items</span><input type="search" data-ledger-search="items" placeholder="Search by item name, e.g. linen cloth" value="${esc(query.items)}" autocomplete="off" aria-label="Search items"></label><div data-ledger-list="items">${itemRows()}</div></section>`;
  }

  // Gold & prices.
  function priceRows() {
    const rows = search(data.prices, query.prices);
    if (!rows.length) return `<p class="ldg-empty">${data.prices.length ? "No remembered price matches that." : "Browse the Auction House in game with price memory on (/bf prices on) and the prices you see show up here."}</p>`;
    return `<table class="ldg-table"><thead><tr><th>Item</th><th>Last seen, each</th><th>Lowest seen</th><th>When</th></tr></thead><tbody>${rows.slice(0, LIMIT).map((r) => `<tr data-ledger-price="${r.itemId}"><td data-card-item="${r.itemId}"><strong class="ldg-name q-${quality(r.quality)}">${esc(r.name)}</strong></td><td>${coins(r.latest)}</td><td>${coins(r.low)}${r.low < r.latest ? ` <small>${esc(ago(r.lowAt))}</small>` : ""}</td><td>${esc(ago(r.latestAt))}</td></tr>`).join("")}</tbody></table>
      ${rows.length > LIMIT ? `<p class="ldg-more">Showing ${LIMIT} of ${rows.length}. Search to narrow it down.</p>` : ""}`;
  }
  function gold() {
    const chars = ledgered();
    if (!chars.length) return empty("No gold or prices yet.");
    const g = data.gold, top = Math.max(1, ...g.characters.map((c) => c.money));
    return `<div class="ldg-summary"><div><strong>${coins(g.total)}</strong><span>gold on ${g.characters.length} character${g.characters.length === 1 ? "" : "s"}</span></div><div><strong>${coins(data.value.total)}</strong><span>estimated auction value of what you carry</span></div><div><strong>${data.prices.length.toLocaleString()}</strong><span>prices remembered</span></div></div>
      <div class="ldg-two"><section class="ldg-card"><h2>Gold per character</h2><ul class="ldg-goldlist">${g.characters.map((c) => `<li data-ledger-gold="${esc(c.profileId)}"><span class="ldg-who">${esc(c.name)}${c.faction ? ` <small>${esc(c.faction)}</small>` : ""}</span><span class="ldg-bar"><span data-w="${Math.max(2, Math.round((c.money / top) * 100))}"></span></span><span class="ldg-amount">${coins(c.money)}</span></li>`).join("")}</ul>
        ${chars.some((c) => c.mail?.money) ? `<p class="ldg-note">Waiting in the mail: ${chars.filter((c) => c.mail?.money).map((c) => `${esc(c.name)} ${coins(c.mail.money)}`).join(", ")}.</p>` : ""}</section>
      <section class="ldg-card"><h2>What your things are worth</h2>${data.value.items.length ? `<ul class="ldg-worth">${data.value.items.slice(0, 15).map((v) => `<li data-card-item="${v.itemId}"><strong class="ldg-name q-${quality(v.quality)}">${esc(v.name)}</strong><span>${v.count.toLocaleString()} × ${coins(v.unit)}</span><span class="ldg-amount">${coins(v.value)}</span></li>`).join("")}</ul><p class="ldg-note">From the last price you saw at auction; actual sales vary.</p>` : `<p class="ldg-empty">Nothing you carry has a remembered auction price yet.</p>`}</section></div>
      <section class="ldg-card"><h2>Price memory</h2><p class="ldg-note">Lowest buyout per item on Auction House pages you opened yourself. The addon never searches or buys.</p><label class="ldg-search"><span class="sr-only">Search prices</span><input type="search" data-ledger-search="prices" placeholder="Search remembered prices" value="${esc(query.prices)}" autocomplete="off" aria-label="Search prices"></label><div data-ledger-list="prices">${priceRows()}</div></section>`;
  }

  // Reputation: one character at a time; their own side's factions first.
  function reputation() {
    const chars = ledgered().filter((c) => c.reputations);
    if (!chars.length) return empty("No reputations yet.");
    const pick = chars.find((c) => c.profileId === repFor) || chars.find((c) => c.profileId === data.activeProfileId) || chars[0];
    const groups = [["Alliance", pick.reputations.factions.filter((f) => f.side === "Alliance")], ["Horde", pick.reputations.factions.filter((f) => f.side === "Horde")], ["Other factions", pick.reputations.factions.filter((f) => !f.side)]];
    if (pick.faction === "Horde") groups.unshift(groups.splice(1, 1)[0]);
    return `<section class="ldg-card"><div class="ldg-pick"><label>Character <select data-ledger-rep aria-label="Reputation of">${chars.map((c) => `<option value="${esc(c.profileId)}"${c === pick ? " selected" : ""}>${esc(c.name)}${c.faction ? ` · ${esc(c.faction)}` : ""}</option>`).join("")}</select></label><small>Seen ${esc(ago(pick.reputations.seenAt))}. Collapsed groups in your reputation window keep their last values.</small></div>
      ${groups.filter(([, list]) => list.length).map(([name, list]) => `<h3 class="ldg-group">${esc(name)}</h3><ul class="ldg-reps">${list.map((f) => `<li class="ldg-rep st-${f.standing}" data-ledger-faction="${f.id}"><span class="ldg-fname">${esc(f.name)}</span><span class="ldg-bar"><span data-w="${Math.round(f.progress * 100)}"></span></span><span class="ldg-stand"><strong>${esc(f.standingName)}</strong> ${f.standing < 8 ? `${f.current.toLocaleString()} / ${f.need.toLocaleString()}` : ""}</span></li>`).join("")}</ul>`).join("")}</section>`;
  }

  // Cooldowns: every character's profession cooldowns, ready now or when.
  function cooldowns() {
    const chars = ledgered();
    if (!chars.length) return empty("No cooldowns yet.");
    const withCd = chars.filter((c) => c.cooldowns.length), t = nowSec();
    const ready = withCd.reduce((n, c) => n + c.cooldowns.filter((x) => x.readyAt <= t).length, 0);
    return `<div class="ldg-summary"><div><strong>${ready}</strong><span>ready now</span></div><div><strong>${withCd.reduce((n, c) => n + c.cooldowns.length, 0)}</strong><span>cooldowns tracked</span></div><div><strong>${withCd.length}</strong><span>crafting characters</span></div></div>
      ${withCd.length ? `<div class="ldg-cds">${withCd.map((c) => `<section class="ldg-card" data-ledger-cd="${esc(c.profileId)}"><h2>${esc(c.name)}</h2><ul>${c.cooldowns.map((x) => { const left = Math.max(0, x.readyAt - t); return `<li class="${left ? "wait" : "ready"}"><span><strong>${esc(x.name)}</strong> <small>${esc(x.profession)}</small></span><span class="ldg-when">${left ? `Ready in ${esc(wait(left))}` : "Ready"}</span></li>`; }).join("")}</ul></section>`).join("")}</div>`
        : `<p class="ldg-empty">None of your characters has a tracked cooldown: Alchemy transmutes, Mooncloth (Tailoring) or the Salt Shaker (Leatherworking).</p>`}
      <p class="ldg-note">Times come from the game when the addon last saved; they keep counting down here.</p>`;
  }

  const PAGES = {
    ledger: ["characters", "Bags & bank", "Everything you carry", "Bags, bank and mail of every character, searchable in one place.", bags],
    "ledger-gold": ["plans", "Gold & prices", "Gold and prices", "Gold on each character, and the Auction House prices you saw yourself.", gold],
    "ledger-reputation": ["journey", "Reputation", "Reputation", "Where each character stands with every faction, Alliance and Horde alike.", reputation],
    "ledger-cooldowns": ["professions", "Cooldowns", "Profession cooldowns", "Transmutes, Mooncloth and the Salt Shaker: which are ready, and when the rest will be.", cooldowns],
  };
  function body() {
    if (error) return `<p class="ldg-empty">${esc(error)}</p>`;
    if (!data) return `<p class="ldg-empty">${loading ? "Opening your ledger…" : "Your ledger is loading."}</p>`;
    return PAGES[route][4]();
  }
  function page(which = route) {
    route = PAGES[which] ? which : "ledger";
    const [art, label, title, subtitle] = PAGES[route];
    return `<section class="ledger-page" data-ledger="${route}">${hero(art, label, title, subtitle)}<div data-ledger-body>${body()}</div></section>`;
  }
  function sizes(root) { for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`; }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.ledger(); error = ""; } catch (e) { error = e.message || "Your ledger is unavailable."; }
    loading = false; loadedAt = Date.now();
    const root = document.querySelector("[data-ledger]");
    if (root) { root.outerHTML = page(root.dataset.ledger); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-ledger]");
    if (!root || mountedFor === root) return;
    mountedFor = root; sizes(root);
    for (const input of root.querySelectorAll("[data-ledger-search]")) input.addEventListener("input", () => {
      const kind = input.dataset.ledgerSearch;
      query[kind] = input.value.slice(0, 100);
      const list = root.querySelector(`[data-ledger-list="${kind}"]`);
      if (list && data) { list.innerHTML = kind === "items" ? itemRows() : priceRows(); sizes(list); }
    });
    root.querySelector("[data-ledger-rep]")?.addEventListener("change", (e) => { repFor = e.target.value; root.outerHTML = page(route); mountedFor = null; mounted(); });
    // Each visit reads the newest saved ledger (a game save may have arrived since).
    if (!loading && (!data || Date.now() - loadedAt > 3000)) load();
  }
  return { bags: () => page("ledger"), gold: () => page("ledger-gold"), reputation: () => page("ledger-reputation"), cooldowns: () => page("ledger-cooldowns"), page, mounted, invalidate: () => { data = null; }, _state: () => ({ data, query, route }) };
})();
