"use strict";
// Characters → Sheet (0.36, G5 + A12): the active character's gear as a paper doll with quality
// colours, item level and how each piece holds up, empty slots, base stats the addon read in
// game, upgrades already in the bags or bank, and the gear sets saved with /bf set with where
// every piece is now. Read-only: one `characterSheet` request. Item hover cards come from
// data-card-item (hover-cards.js).
window.SheetView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const quality = (q) => QUALITY[q] || "common";
  const RATING = { fresh: "Holds up", aging: "Getting old", replace: "Time to replace" };
  const WHERE = { worn: "Worn", bags: "In your bags", bank: "In the bank", mail: "In the mail", other: "On", missing: "Not found" };
  let data = null, error = "", loading = false, loadedAt = 0, mountedFor = null;
  const nowSec = () => Math.floor(Date.now() / 1000);
  function ago(at) {
    if (!Number.isFinite(at)) return "";
    const s = Math.max(0, nowSec() - at);
    if (s < 120) return "just now";
    if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
    if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  const icon = (it, size = 40) => (it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, size) : `<span class="sht-gem q-${quality(it?.quality)}" aria-hidden="true">◆</span>`);
  function hero() {
    const cls = String(data?.className || "").toLowerCase();
    const who = data ? [data.level ? `Level ${data.level}` : "", data.race, data.className, data.faction].filter(Boolean).join(" · ") : "";
    return PageHero.render({ art: "characters", eyebrow: "Characters · Sheet", title: esc(data?.name || "Character sheet"), crest: PageHero.classCrest(cls), subtitle: esc(who || "Your gear, stats and gear sets.") });
  }
  function empty(what) {
    return `<p class="sht-empty">${what} Log in with the 0.36 addon, then type <code>/reload</code> (or log out) once so the desktop app receives it.</p>`;
  }

  function slotTile(s) {
    if (!s.item) return `<li class="sht-slot sht-empty-slot${s.missing ? " sht-missing" : ""}" data-sheet-slot="${s.slot}"><span class="sht-frame" aria-hidden="true"></span><span class="sht-words"><small>${esc(s.label)}</small><strong>${s.missing ? "Empty" : "—"}</strong></span></li>`;
    const it = s.item;
    return `<li class="sht-slot q-${quality(it.quality)}${it.rating ? " r-" + it.rating : ""}" data-sheet-slot="${s.slot}" data-card-item="${it.itemId}"><span class="sht-frame">${icon(it)}</span><span class="sht-words"><small>${esc(s.label)}${Number.isFinite(it.itemLevel) && it.itemLevel > 0 ? ` · item level ${it.itemLevel}` : ""}</small><strong class="q-${quality(it.quality)}">${esc(it.name)}</strong>${it.rating ? `<em class="sht-rating">${esc(RATING[it.rating])}</em>` : ""}</span></li>`;
  }
  function stats() {
    const s = data.stats;
    if (!s) return `<p class="sht-note">Stats arrive with the 0.36 addon after a /reload.</p>`;
    const row = (label, v) => (Number.isFinite(v) ? `<li><span>${label}</span><strong>${v.toLocaleString()}</strong></li>` : "");
    const resist = s.resist ? Object.entries(s.resist).filter(([, v]) => v > 0).map(([k, v]) => `<li><span>${esc(k[0].toUpperCase() + k.slice(1))} resistance</span><strong>${v}</strong></li>`).join("") : "";
    const power = s.powerKind ? s.powerKind[0].toUpperCase() + s.powerKind.slice(1) : "Power";
    return `<ul class="sht-stats" data-sheet-stats>${row("Strength", s.strength)}${row("Agility", s.agility)}${row("Stamina", s.stamina)}${row("Intellect", s.intellect)}${row("Spirit", s.spirit)}</ul>
      <ul class="sht-stats">${row("Armor", s.armor)}${row("Attack power", s.attackPower)}${row("Ranged attack power", s.rangedAttackPower)}${row("Health", s.health)}${row(esc(power), s.power)}${resist}</ul>
      <p class="sht-note">With your gear and buffs, as the game reported ${esc(ago(s.seenAt))}.</p>`;
  }
  function doll() {
    const side = (name) => data.slots.filter((s) => s.side === name).map(slotTile).join("");
    const summary = data.equipmentKnown
      ? `<div class="sht-ilvl"><strong>${data.averageItemLevel ?? "?"}</strong><span>average item level</span><small>${data.countedSlots} piece${data.countedSlots === 1 ? "" : "s"}; shirt and tabard not counted</small></div>`
      : `<p class="sht-note">Equipment arrives after a /reload in game.</p>`;
    return `<section class="sht-doll" aria-label="Equipped gear">
      <ul class="sht-col sht-left">${side("left")}</ul>
      <div class="sht-center">${summary}${data.wornScore !== null && data.wornScore !== undefined ? `<p class="sht-score">Gear score for your class: <strong>${data.wornScore}</strong></p>` : ""}${stats()}</div>
      <ul class="sht-col sht-right">${side("right")}</ul>
      <ul class="sht-bottom">${side("bottom")}</ul></section>`;
  }
  function advice() {
    const parts = [];
    if (data.missing.length) parts.push(`<li><strong>Empty:</strong> ${data.missing.map(esc).join(", ")}. Any piece here is a free upgrade.</li>`);
    for (const w of data.weakest) parts.push(`<li><strong>${esc(w.label)}:</strong> ${esc(w.name)}, item level ${w.itemLevel}, ${w.rating === "replace" ? "well below your level: replace it first" : "a little behind your level"}.</li>`);
    const ups = data.upgrades.map((u) => `<li class="sht-up" data-sheet-upgrade="${u.itemId}" data-card-item="${u.itemId}">${icon(u, 28)}<span><strong class="q-${quality(u.quality)}">${esc(u.name)}</strong> <small>${u.where === "bank" ? "in your bank" : "in your bags"}</small></span><em>${esc(u.text)}${Number.isFinite(u.delta) && u.delta > 0 ? ` (+${u.delta})` : ""}</em></li>`).join("");
    if (!parts.length && !ups) return "";
    return `<section class="sht-card"><h2>Upgrades and gaps</h2>${parts.length ? `<ul class="sht-advice">${parts.join("")}</ul>` : ""}${ups ? `<h3 class="sht-sub">Already yours</h3><ul class="sht-ups">${ups}</ul><p class="sht-note">Compared with what you wear, the same way as item cards. Bags and bank as the ledger last saw them.</p>` : ""}</section>`;
  }
  function placeText(i) {
    if (i.where === "other") return `On ${esc(i.holder)} (${esc(i.place)})`;
    if ((i.where === "bank" || i.where === "mail") && Number.isFinite(i.seenAt)) return `${WHERE[i.where]} <small>seen ${esc(ago(i.seenAt))}</small>`;
    return WHERE[i.where];
  }
  function sets() {
    const intro = `<p class="sht-note">Save the gear you wear with <code>/bf set save NAME</code> and put it back on with <code>/bf set wear NAME</code> (out of combat, from your bags). Pieces in the bank, mail or on another character are listed here so you can fetch them.</p>`;
    if (!data.setsKnown) return `<section class="sht-card"><h2>Gear sets</h2>${intro}${empty("No gear sets seen yet.")}</section>`;
    if (!data.sets.length) return `<section class="sht-card"><h2>Gear sets</h2>${intro}<p class="sht-empty">No gear sets saved on this character yet.</p></section>`;
    return `<section class="sht-card"><h2>Gear sets</h2>${intro}<div class="sht-sets">${data.sets.map((s) => `<article class="sht-set" data-sheet-set="${esc(s.name)}">
      <header><h3>${esc(s.name)}</h3><span>${s.items.length} pieces${s.score !== null ? ` · score ${s.score}` : ""}</span></header>
      <p class="sht-counts">${s.counts.worn} worn · ${s.counts.bags} in bags${s.counts.away ? ` · <strong>${s.counts.away} to fetch</strong>` : ""}${s.counts.missing ? ` · <strong class="sht-bad">${s.counts.missing} not found</strong>` : ""}</p>
      <ul>${s.items.map((i) => `<li class="w-${i.where}" data-card-item="${i.itemId}">${icon(i, 24)}<span class="sht-slotname">${esc(i.label)}</span><strong class="q-${quality(i.quality)}">${esc(i.name)}</strong><span class="sht-where">${placeText(i)}</span></li>`).join("")}</ul>
      <p class="sht-cmd"><code>/bf set wear ${esc(s.name)}</code></p></article>`).join("")}</div></section>`;
  }
  function body() {
    if (error) return `<p class="sht-empty">${esc(error)}</p>`;
    if (!data) return `<p class="sht-empty">${loading || !loadedAt ? "Opening your character sheet…" : "Pick or create a character first."}</p>`;
    if (!data.equipmentKnown && !data.stats && !data.setsKnown) return empty("No gear seen for this character yet.");
    return `${doll()}${advice()}${sets()}`;
  }
  function page() {
    return `<section class="sheet-page" data-sheet>${hero()}<div data-sheet-body>${body()}</div></section>`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.characterSheet(); error = ""; } catch (e) { error = e.message || "Your character sheet is unavailable."; }
    loading = false; loadedAt = Date.now();
    const root = document.querySelector("[data-sheet]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-sheet]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    // A new character or a newer game save: read again.
    const active = document.getElementById("active-character")?.value;
    if (!loading && (!loadedAt || Date.now() - loadedAt > 3000 || (data && active && data.profileId !== active))) load();
  }
  return { page, mounted, invalidate: () => { data = null; loadedAt = 0; }, _state: () => ({ data }) };
})();
