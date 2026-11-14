"use strict";
// Dungeons & Raids atlas page. Cards are coloured like in-game difficulty for your level.
window.DungeonAtlas = (() => {
  const api = window.backstage;
  let atlas = null, tab = "dungeon", open = null, view = "details", mountedFor = null;
  const loot = new Map(); // instance id -> dungeonLoot result (or { error })
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const BADGE = { upgrade: "Upgrade for you", "upgrade-later": "Upgrade later", "not-for-you": "Not for you", "not-upgrade": "Not an upgrade", usable: "Usable", "no-class": "", "not-equipment": "", unknown: "" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const LABEL = { right: "Right for your level", easy: "Easy", hard: "Challenging", trivial: "Low level", impossible: "Too high for now", unknown: "Level unknown" };
  function page() {
    return `<section class="atlas-page" data-atlas>
      ${PageHero.render({ art: "dungeons", eyebrow: "Adventure · Dungeons & raids", title: "Instance Atlas", subAttrs: "data-atlas-level",
        aside: '<div class="atlas-tabs" role="tablist"><button type="button" role="tab" data-atlas-tab="dungeon">Dungeons</button><button type="button" role="tab" data-atlas-tab="raid">Raids</button><button type="button" role="tab" data-atlas-tab="forever">New in Forever</button></div>' })}
      <div class="atlas-suggest" data-atlas-suggest></div>
      <div class="atlas-grid" data-atlas-grid><p class="atlas-loading">Opening the atlas…</p></div>
      <p class="atlas-caution" data-atlas-caution></p>
    </section>`;
  }
  function card(e) {
    const isOpen = open === e.id;
    const bosses = e.bosses.map((b) => `<li class="${b.observedInForever ? "seen" : ""}"><span class="atlas-skull" aria-hidden="true">☠</span>${esc(b.name)}${b.observedInForever ? `<small>seen in Forever${b.kills ? ` · ${b.kills} kill${b.kills === 1 ? "" : "s"}` : ""}</small>` : ""}</li>`).join("");
    const extra = e.observedOnly.map((b) => `<li class="seen new"><span class="atlas-skull">☠</span>${esc(b.name)}<small>Forever-only boss</small></li>`).join("");
    const quests = e.yourQuests.length ? `<div class="atlas-quests"><h4>Your quests here</h4><ul>${e.yourQuests.map((q) => `<li class="${q.complete ? "done" : ""}"><strong>${esc(q.title)}</strong>${q.complete ? " · ready to turn in" : ""}${q.objectives.length ? `<small>${q.objectives.map((o) => esc(o.text)).join(" · ")}</small>` : ""}</li>`).join("")}</ul></div>` : "";
    // Readiness: level, quests to grab first, group.
    const lvlOk = ["right", "easy"].includes(e.difficulty), lvlLine = atlas?.level && e.levels ? (lvlOk ? `Level ${atlas.level} fits (${e.levels.min}–${e.levels.max})` : e.difficulty === "hard" || e.difficulty === "impossible" ? `Level ${atlas.level}: come back around ${e.levels.min}` : `Level ${atlas.level}: easy now, little XP`) : "Level range not yet observed";
    const pick = e.pickUp || [];
    const ready = `<ul class="atlas-ready"><li class="${lvlOk ? "ok" : "warn"}">${esc(lvlLine)}</li><li class="${e.yourQuests.length ? "ok" : pick.length ? "warn" : "na"}">${e.yourQuests.length ? `${e.yourQuests.length} of your quests lead here` : pick.length ? `${pick.length} quest${pick.length === 1 ? "" : "s"} to pick up first` : "No quests for it recorded yet"}</li><li class="na">${e.kind === "raid" ? "Bring a raid (up to 40)" : "Group of five: a tank, a healer and three damage"}</li></ul>`;
    const pickList = pick.length ? `<div class="atlas-pickup"><h4>Pick these up first</h4><ul>${pick.map((q) => `<li><span><strong>${esc(q.title)}</strong>${q.level ? ` <small>lvl ${q.level}</small>` : ""}${q.giver ? `<small>from ${esc(q.giver.name)}</small>` : ""}</span><span class="atlas-pickup-actions">${q.giver && Number.isSafeInteger(q.giver.mapId) ? `<button type="button" data-map-focus='${esc(JSON.stringify({ mapId: q.giver.mapId, x: q.giver.x, y: q.giver.y, npcId: q.giver.npcId, label: q.giver.name, sub: q.title, goal: { title: `Pick up “${q.title}”`, questId: q.id, steps: [`Find ${q.giver.name}; look for the yellow !.`, `Accept “${q.title}” before heading into ${e.name}.`] } }))}'>Show on map</button>` : ""}<button type="button" data-quest-open="${q.id}">Open quest</button></span></li>`).join("")}</ul></div>` : "";
    return `<article class="atlas-card d-${esc(e.difficulty)} ${e.kind}${isOpen ? " open" : ""}" data-atlas-card="${esc(e.id)}">
      <div class="atlas-ribbon"><span>${e.levels ? `${e.levels.min}${e.levels.max !== e.levels.min ? "–" + e.levels.max : ""}` : "?"}</span></div>
      <div class="atlas-card-body">
        <h3>${esc(e.name)}</h3>
        <p class="atlas-where">${e.zone ? esc(e.zone) : "Location not yet observed"}${e.faction ? ` · <span class="atlas-side ${esc(e.faction.toLowerCase())}">${esc(e.faction)}</span>` : ""}${e.observedRuns ? ` · <span class="atlas-seen">${e.observedRuns} Forever run${e.observedRuns === 1 ? "" : "s"} observed</span>` : ""}</p>
        <p class="atlas-diff">${esc(LABEL[e.difficulty])}${e.factionNote ? ` · ${esc(e.factionNote)}` : ""}</p>
        ${scoreChip(e)}${wishRow(e)}
        ${ready}${quests}${pickList}
        <div class="atlas-toggles"><button type="button" class="atlas-toggle" data-atlas-open="${esc(e.id)}" aria-expanded="${isOpen && view === "details"}">${isOpen && view === "details" ? "Hide details" : `Bosses, roles & prep (${e.bosses.length + e.observedOnly.length} bosses)`}</button>${e.loot ? `<button type="button" class="atlas-loot-btn${isOpen && view === "loot" ? " on" : ""}" data-atlas-loot="${esc(e.id)}" aria-expanded="${isOpen && view === "loot"}"><span class="atlas-chest" aria-hidden="true"></span>${isOpen && view === "loot" ? "Hide loot" : `Loot${e.loot.items ? ` (${e.loot.items} items)` : ""}`}</button>` : ""}</div>
        ${isOpen && view === "loot" ? lootView(e) : ""}
        ${isOpen && view === "details" ? `<div class="atlas-details"><ul class="atlas-bosses">${bosses}${extra}</ul>
          <div class="atlas-cols"><div><h4>Group</h4><ul>${e.roles.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div><div><h4>Before you go</h4><ul>${e.prep.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div></div>
          ${e.entrance ? `<div class="atlas-actions"><button type="button" class="primary" data-atlas-way="${esc(e.id)}">Copy entrance waypoint</button><button type="button" data-atlas-map="${esc(e.id)}">Show on World Map</button></div><p class="atlas-src">Entrance around ${(e.entrance.x * 100).toFixed(0)}, ${(e.entrance.y * 100).toFixed(0)} in ${esc(e.zone)} (approximate).</p>` : ""}
          <p class="atlas-src">${esc(e.source)}</p></div>` : ""}
      </div></article>`;
  }
  // "3 upgrades for you": counted main-side against what the character wears.
  function scoreChip(e) {
    const l = e.loot; if (!l) return "";
    if (!l.items) return `<p class="atlas-score none">No boss loot recorded yet</p>`;
    if (l.upgrades) return `<button type="button" class="atlas-score up" data-atlas-loot="${esc(e.id)}"><span class="atlas-score-n">${l.upgrades}</span> upgrade${l.upgrades === 1 ? "" : "s"} for you</button>`;
    if (l.later) return `<button type="button" class="atlas-score later" data-atlas-loot="${esc(e.id)}"><span class="atlas-score-n">${l.later}</span> upgrade${l.later === 1 ? "" : "s"} at a higher level</button>`;
    return `<p class="atlas-score">${l.items} item${l.items === 1 ? "" : "s"} from ${l.bossesWithLoot} boss${l.bossesWithLoot === 1 ? "" : "es"}</p>`;
  }
  // Starred items that drop here, as small icons (hover for the item card).
  function wishRow(e) {
    const w = e.loot?.wished || []; if (!w.length) return "";
    return `<div class="atlas-wishes"><span class="atlas-wish-label">★ Wish list</span>${w.slice(0, 8).map((x) => `<span class="atlas-wish q-${QUALITY[x.quality] || "unknown"}" data-card-item="${x.itemId}">${x.iconFileId && window.GameIcons ? GameIcons.tag(x.iconFileId, 28) : '<span class="loot-gem" aria-hidden="true">◆</span>'}<span class="sr-only">${esc(x.name || `Item #${x.itemId}`)} from ${esc(x.boss)}</span></span>`).join("")}</div>`;
  }
  const pct = (c) => (c >= 0.995 ? "100%" : `${Math.max(1, Math.round(c * 100))}%`);
  function tile(x) {
    const it = x.item, q = QUALITY[it?.quality] || "unknown", v = x.verdict?.verdict || "unknown";
    const name = it?.name || `Item #${x.itemId}`;
    const kind = it ? [it.slot, it.kind].filter(Boolean).join(" · ") || (it.itemLevel ? `Item level ${it.itemLevel}` : "") : "";
    const badge = BADGE[v] ? `<span class="loot-badge v-${esc(v)}">${esc(v === "upgrade-later" ? x.verdict.text.replace("Upgrade for you at", "Upgrade at") : BADGE[v])}</span>` : "";
    return `<li class="loot-tile q-${q} v-${esc(v)}${x.wished ? " wished" : ""}${x.community ? " community" : ""}" data-card-item="${x.itemId}">
      <span class="loot-icon">${it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, 44) : '<span class="loot-gem" aria-hidden="true">◆</span>'}</span>
      <span class="loot-body"><span class="loot-name">${esc(name)}</span>${kind ? `<span class="loot-kind">${esc(kind)}</span>` : ""}${badge}${x.community ? `<span class="loot-provenance">${esc(x.source)}</span>` : ""}</span>
      <span class="loot-side"><span class="loot-chance" title="${x.community ? `${esc(x.source)} · ${x.samples} loot${x.samples === 1 ? "" : "s"} pooled` : `Seen in ${x.drops} loot${x.drops === 1 ? "" : "s"}`}">${pct(x.chance)}</span><button type="button" class="loot-star" data-loot-wish="${x.itemId}" aria-pressed="${x.wished}" aria-label="${x.wished ? "Remove from" : "Add to"} wish list: ${esc(name)}">${x.wished ? "★" : "☆"}</button></span></li>`;
  }
  function lootView(e) {
    const d = loot.get(e.id);
    if (!d) return `<div class="atlas-loot"><p class="atlas-loading">Opening the loot chest…</p></div>`;
    if (d.error) return `<div class="atlas-loot"><p class="loot-none">${esc(d.error)}</p></div>`;
    // Community drops sit in their own labelled list under the bundled ones, never mixed in.
    const shared = (b) => b.community?.length ? `<div class="loot-community"><p class="loot-community-head"><span class="loot-community-badge">Community</span>Also reported by players</p><ul class="loot-grid">${b.community.map((x) => tile({ ...x, community: true })).join("")}</ul></div>` : "";
    const bosses = d.bosses.map((b) => `<section class="loot-boss${b.items.length || b.community?.length ? "" : " empty"}"><header><span class="atlas-skull" aria-hidden="true">☠</span><h4>${esc(b.name)}</h4>${b.items.length ? `<small>${b.items.length} item${b.items.length === 1 ? "" : "s"}</small>` : ""}</header>
      ${b.items.length ? `<ul class="loot-grid">${b.items.map(tile).join("")}</ul>` : b.community?.length ? "" : `<p class="loot-none">No loot recorded yet</p>`}${shared(b)}</section>`).join("");
    const notes = [!d.gameData && d.bosses.some((b) => b.items.length) ? "Connect your game folder (Settings → Game connection) to see item names, icons and stats." : "", d.gameData && !d.equipmentKnown ? "Type /reload in game once so the app can compare these with what you wear." : ""].filter(Boolean);
    return `<div class="atlas-loot" data-atlas-loot-view="${esc(e.id)}">
      <div class="loot-legend"><span><i class="loot-key v-upgrade"></i>Upgrade for you</span><span><i class="loot-key v-upgrade-later"></i>Upgrade later</span><span>☆ Star an item for your wish list</span><span>% = seen in that share of loots</span></div>
      ${notes.map((n) => `<p class="loot-note">${esc(n)}</p>`).join("")}
      <div class="loot-bosses">${bosses}</div>
      <p class="atlas-src">Drops observed in World of Warcraft: Forever by the community. ${esc(d.attribution || "")}${d.bosses.some((b) => b.community?.length) ? " Community: drop rates pooled from Backstage Forever players who share anonymously (at least 3 per item)." : ""}</p></div>`;
  }
  async function loadLoot(id) {
    try { loot.set(id, await api.dungeonLoot(null, id)); } catch (err) { loot.set(id, { error: err.message }); }
    if (open === id && view === "loot") paint();
  }
  function paint() {
    const root = document.querySelector("[data-atlas]"); if (!root || !atlas) return;
    root.querySelector("[data-atlas-level]").textContent = atlas.level ? `Level ${atlas.level}${atlas.faction ? " · " + atlas.faction : ""} · ${atlas.suggested.length} dungeon${atlas.suggested.length === 1 ? "" : "s"} suggested for you` : "Choose a character to colour dungeons by level";
    root.querySelectorAll("[data-atlas-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.atlasTab === tab)));
    const list = atlas.entries.filter((e) => (tab === "forever" ? e.foreverOriginal || e.observedRuns : e.kind === tab && !e.foreverOriginal));
    const sug = atlas.suggested.map((id) => atlas.entries.find((e) => e.id === id)).filter(Boolean);
    root.querySelector("[data-atlas-suggest]").innerHTML = tab === "dungeon" && sug.length ? `<h2>Suggested for you</h2><div class="atlas-chips">${sug.map((e) => `<button type="button" data-atlas-open="${esc(e.id)}" class="atlas-chip d-${esc(e.difficulty)}">${esc(e.name)} <small>${e.levels.min}–${e.levels.max} · ${esc(e.zone)}</small></button>`).join("")}</div>` : "";
    root.querySelector("[data-atlas-grid]").innerHTML = list.map(card).join("") || `<p>Nothing observed yet.</p>`;
    root.querySelector("[data-atlas-caution]").textContent = ["Community data · may differ in game. Bosses seen in Forever are marked.", atlas.attribution].filter(Boolean).join(" ");
  }
  async function load() { try { atlas = await api.dungeonAtlas(); } catch (e) { atlas = { entries: [], suggested: [], caution: e.message }; } paint(); }
  function mounted() {
    const root = document.querySelector("[data-atlas]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("click", async (ev) => {
      const star = ev.target.closest("[data-loot-wish]"); if (star) {
        const itemId = Number(star.dataset.lootWish), on = star.getAttribute("aria-pressed") !== "true";
        try {
          await api.setLootWish(null, itemId, on); window.HoverCards?.forget?.();
          for (const d of loot.values()) for (const b of d.bosses || []) for (const x of b.items) if (x.itemId === itemId) x.wished = on;
          window.toast?.(on ? "Added to your wish list." : "Removed from your wish list.");
          atlas = await api.dungeonAtlas().catch(() => atlas);
        } catch (err) { window.toast?.(err.message); }
        paint(); return;
      }
      const lb = ev.target.closest("[data-atlas-loot]"); if (lb) { const id = lb.dataset.atlasLoot; const same = open === id && view === "loot"; const e = atlas.entries.find((x) => x.id === id); if (e && e.kind !== tab && !e.foreverOriginal) tab = e.kind; open = same ? null : id; view = "loot"; if (!same) { loot.delete(id); loadLoot(id); } paint(); root.querySelector(`[data-atlas-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      const t = ev.target.closest("[data-atlas-tab]"); if (t) { tab = t.dataset.atlasTab; open = null; paint(); return; }
      const o = ev.target.closest("[data-atlas-open]"); if (o) { const id = o.dataset.atlasOpen; const e = atlas.entries.find((x) => x.id === id); if (e && e.kind !== tab && !e.foreverOriginal) tab = e.kind; open = open === id && view === "details" ? null : id; view = "details"; paint(); root.querySelector(`[data-atlas-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      const w = ev.target.closest("[data-atlas-way]"); if (w) { const e = atlas.entries.find((x) => x.id === w.dataset.atlasWay); try { const r = await api.copyWaypoint({ mapId: e.mapId, x: e.entrance.x, y: e.entrance.y, label: e.name }); w.textContent = "Copied — paste in WoW chat"; window.toast?.(r.message); } catch (err) { w.textContent = err.message; } return; }
      const m = ev.target.closest("[data-atlas-map]"); if (m) { const e = atlas.entries.find((x) => x.id === m.dataset.atlasMap); window.WorldMapView?.focus({ mapId: e.mapId, x: e.entrance.x, y: e.entrance.y, label: `${e.name} entrance`, sub: `${e.kind === "raid" ? "Raid" : "Dungeon"} · levels ${e.levels.min}–${e.levels.max}` }); document.querySelector('[data-nav="world-map"]')?.click(); }
    });
    load();
  }
  return { page, mounted };
})();
