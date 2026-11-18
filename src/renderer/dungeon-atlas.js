"use strict";
// Dungeons & Raids atlas page. Cards are coloured like in-game difficulty for your level.
window.DungeonAtlas = (() => {
  const api = window.backstage;
  let atlas = null, tab = "dungeon", open = null, view = "details", mountedFor = null;
  const loot = new Map(); // instance id -> dungeonLoot result (or { error })
  const lootRequests = new Map();
  // One original painting per dungeon and raid (art/dungeons/<id>.webp, local ComfyUI, 0.58).
  const ART = new Set(["rfc", "wc", "dm", "sfk", "bfd", "stocks", "gnomer", "rfk", "sm", "rfd", "ulda", "zf", "mara", "st", "brd", "lbrs", "dme", "scholo", "strat", "ubrs", "zg", "mc", "ony", "bwl", "aq20", "aq40", "naxx"]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const BADGE = { upgrade: "Upgrade for you", "upgrade-later": "Upgrade later", "not-for-you": "Not for you", "not-upgrade": "Not an upgrade", usable: "Usable", "no-class": "", "not-equipment": "", unknown: "" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const validPoint = (mapId, { x, y } = {}) => Number.isSafeInteger(mapId) && mapId > 0 && [x, y].every((v) => Number.isFinite(v) && v > 0 && v < 1);
  const LABEL = { right: "Right for your level", easy: "Easy", hard: "Challenging", trivial: "Low level", impossible: "Too high for now", unknown: "Level unknown" };
  function page() {
    return `<section class="atlas-page" data-atlas>
      ${PageHero.render({ art: "dungeons", compact: true, eyebrow: "Adventure · Dungeons & raids", title: "Instance Atlas", subAttrs: "data-atlas-level",
        aside: '<div class="atlas-tabs" role="tablist"><button type="button" role="tab" data-atlas-tab="dungeon">Dungeons</button><button type="button" role="tab" data-atlas-tab="raid">Raids</button><button type="button" role="tab" data-atlas-tab="forever">New in Forever</button></div>' })}
      <div class="atlas-suggest" data-atlas-suggest></div>
      <section class="atlas-recap" aria-labelledby="atlas-recap-heading">
        <h2 id="atlas-recap-heading">Your encounter recap</h2>
        <p class="atlas-recap-note">Boss defeats saved in this character’s local journal. Community observations are shown separately below.</p>
        <div data-atlas-recap aria-live="polite"><p>Opening your recap…</p></div>
      </section>
      <div class="atlas-grid" data-atlas-grid><p class="atlas-loading">Opening the atlas…</p></div>
      <p class="atlas-caution" data-atlas-caution></p>
    </section>`;
  }
  function activeProfileId() {
    // The placeholder option has no value attribute; do not use its text as an ID.
    return document.querySelector("#active-character")?.selectedOptions?.[0]?.getAttribute("value") || null;
  }
  function savedEncounters(recap) {
    const profileId = activeProfileId();
    return profileId && recap?.profileId === profileId && Array.isArray(recap.encounters) ? recap.encounters : null;
  }
  function recapContent(rows, { entry = null, loading = false } = {}) {
    if (!activeProfileId()) return "<p>Choose a character to see their saved encounters.</p>";
    if (loading) return "<p>Opening your recap…</p>";
    if (!rows) return "<p>Recap unavailable for the active character.</p>";
    if (!rows.length) return entry ? "<p>No saved encounter defeats for this instance.</p>" : "<p>No saved encounter defeats yet. If you’ve just played, reload or log out in game to save your journal.</p>";
    const recent = rows.slice(0, 3); // The atlas supplies newest first.
    // Capture names and displayed labels are escaped; datetime comes from validated Unix seconds.
    return `<ol class="atlas-recap-list">${recent.map((row) => {
      const when = new Date(row.at * 1000);
      const location = row.atlasName || (row.instanceType === "raid" ? "Unknown raid" : "Unknown dungeon");
      const linked = !entry && row.atlasId && atlas?.entries.some((e) => e.id === row.atlasId);
      return `<li><strong>${esc(row.name)}</strong>${entry ? "" : `<small>${esc(location)}</small>`}
        <small>Last saved <time datetime="${when.toISOString()}">${esc(when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</time></small>
        ${linked ? `<button type="button" class="atlas-recap-link" data-atlas-prep="${esc(row.atlasId)}" aria-label="Open prep for ${esc(location)}">Open prep</button>` : ""}</li>`;
    }).join("")}</ol>${rows.length > recent.length ? `<p class="atlas-recap-note">Showing the latest ${recent.length} of ${rows.length} saved defeats.</p>` : ""}`;
  }
  function paintRecap(root, recap, loading = false) {
    root.querySelector("[data-atlas-recap]").innerHTML = recapContent(savedEncounters(recap), { loading });
  }
  function card(e) {
    const isOpen = open === e.id;
    const entrance = e.entrance && validPoint(e.mapId, e.entrance);
    const last = e.bosses.length - 1;
    const bosses = e.bosses.map((b, i) => `<li class="${b.observedInForever ? "seen" : ""}${i === last && window.BF_BOSS_ART?.includes(e.id) ? " atlas-final" : ""}">${i === last && window.BF_BOSS_ART?.includes(e.id) ? `<img class="atlas-final-art" src="art/bosses/${esc(e.id)}.webp" alt="" width="72" height="72">` : ""}<span class="atlas-skull" aria-hidden="true">☠</span>${esc(b.name)}${b.observedInForever ? `<small>seen in Forever${b.kills ? ` · ${b.kills} kill${b.kills === 1 ? "" : "s"}` : ""}</small>` : ""}${b.tip ? `<p class="atlas-tip"><strong>Tip:</strong> ${esc(b.tip)}</p>` : ""}</li>`).join("");
    const extra = e.observedOnly.map((b) => `<li class="seen new"><span class="atlas-skull">☠</span>${esc(b.name)}<small>Forever-only boss</small></li>`).join("");
    const saved = savedEncounters(atlas?.recap);
    const yourQuests = saved ? e.yourQuests : [];
    const questList = (rows, title) => rows.length ? `<section class="atlas-quests" aria-label="${title}"><h5>${title}</h5><ul>${rows.map((q) => `<li><strong>${esc(q.title)}</strong>${q.objectives.length ? `<small>${q.objectives.map((o) => esc(o.text)).join(" · ")}</small>` : ""}<button type="button" data-quest-open="${esc(q.id)}" data-atlas-profile="${esc(activeProfileId())}" aria-label="Open quest: ${esc(q.title)}">Open quest</button></li>`).join("")}</ul></section>` : "";
    // Readiness: level, quests to grab first, group.
    const lvlOk = ["right", "easy"].includes(e.difficulty), lvlLine = atlas?.level && e.levels ? (lvlOk ? `Level ${atlas.level} fits (${e.levels.min}–${e.levels.max})` : e.difficulty === "hard" || e.difficulty === "impossible" ? `Level ${atlas.level}: come back around ${e.levels.min}` : `Level ${atlas.level}: easy now, little XP`) : "Level range not yet observed";
    const pick = e.pickUp || [];
    const ready = `<ul class="atlas-ready"><li class="${lvlOk ? "ok" : "warn"}">${esc(lvlLine)}</li><li class="na">${e.kind === "raid" ? "Check raid size and roles in game" : "Group of five: a tank, a healer and three damage"}</li></ul>`;
    const pickList = pick.length ? `<div class="atlas-pickup"><h5>Possible quest pickups · Reference</h5><p class="atlas-src">Check availability and prerequisites in game.</p><ul>${pick.map((q) => `<li><span><strong>${esc(q.title)}</strong>${q.level ? ` <small>lvl ${q.level}</small>` : ""}${q.giver ? `<small>from ${esc(q.giver.name)}</small>` : ""}</span><span class="atlas-pickup-actions">${q.giver && Number.isSafeInteger(q.giver.mapId) ? `<button type="button" data-map-focus='${esc(JSON.stringify({ mapId: q.giver.mapId, x: q.giver.x, y: q.giver.y, npcId: q.giver.npcId, label: q.giver.name, sub: q.title, goal: { title: `Check availability: “${q.title}”`, questId: q.id, steps: [`Ask ${q.giver.name} whether this quest is available before heading into ${e.name}.`] } }))}'>Show on map</button>` : ""}<button type="button" data-quest-open="${esc(q.id)}">Open quest</button></span></li>`).join("")}</ul></div>` : "";
    return `<article class="atlas-card d-${esc(e.difficulty)} ${e.kind}${isOpen ? " open" : ""}" data-atlas-card="${esc(e.id)}">
      <div class="atlas-ribbon"><span>${e.levels ? `${e.levels.min}${e.levels.max !== e.levels.min ? "–" + e.levels.max : ""}` : "?"}</span></div>
      <div class="atlas-card-body">
        ${ART.has(e.id) ? `<img class="atlas-art" src="art/dungeons/${e.id}.webp" alt="" width="960" height="536" loading="lazy">` : ""}
        <h3>${esc(e.name)}</h3>
        <p class="atlas-where">${e.zone ? esc(e.zone) : "Location not yet observed"}${e.faction ? ` · <span class="atlas-side ${esc(e.faction.toLowerCase())}">${esc(e.faction)}</span>` : ""}${e.observedRuns ? ' · <span class="atlas-seen">Community encounter reports</span>' : ""}</p>
        <p class="atlas-diff">${esc(LABEL[e.difficulty])}${e.factionNote ? ` · ${esc(e.factionNote)}` : ""}</p>
        ${scoreChip(e)}${wishRow(e)}
        ${!isOpen && (yourQuests.length || pick.length) ? `<p class="atlas-brief">${yourQuests.length ? `${yourQuests.length} related quest${yourQuests.length === 1 ? "" : "s"} in your saved log` : `${pick.length} possible quest pickup${pick.length === 1 ? "" : "s"}`}</p>` : ""}
        <div class="atlas-toggles"><button type="button" class="atlas-toggle" data-atlas-open="${esc(e.id)}" aria-expanded="${isOpen && view === "details"}">${isOpen && view === "details" ? "Hide details" : `Bosses, roles & prep (${e.bosses.length + e.observedOnly.length} bosses)`}</button>${e.loot ? `<button type="button" class="atlas-loot-btn${isOpen && view === "loot" ? " on" : ""}" data-atlas-loot="${esc(e.id)}" aria-expanded="${isOpen && view === "loot"}"><span class="atlas-chest" aria-hidden="true"></span>${isOpen && view === "loot" ? "Hide loot" : `Loot${e.loot.items ? ` (${e.loot.items} items)` : ""}`}</button>` : ""}</div>
        ${isOpen && view === "loot" ? lootView(e) : ""}
        ${isOpen && view === "details" ? `<div class="atlas-details"><div class="atlas-preflight"><h4 tabindex="-1" data-atlas-prep-heading>Prepare for ${esc(e.name)}</h4>${ready}
          <div class="atlas-actions">${entrance ? `<button type="button" class="primary" data-atlas-way="${esc(e.id)}">Copy entrance waypoint</button><button type="button" data-atlas-map="${esc(e.id)}">Show on World Map</button>` : ""}</div>
          ${entrance ? `<p class="atlas-src">Approximate Classic entrance: ${esc(e.zone)} · ${(e.entrance.x * 100).toFixed(0)}, ${(e.entrance.y * 100).toFixed(0)}. Verify in Forever.</p>` : `<p class="atlas-src">No usable entrance waypoint in this reference.</p>`}
          ${questList(yourQuests.filter((q) => q.complete), "Ready to turn in · Last saved")}
          ${questList(yourQuests.filter((q) => !q.complete), "In your quest log · Last saved")}
          ${e.loot?.items ? `<div class="atlas-actions"><button type="button" data-atlas-loot="${esc(e.id)}">Browse recorded loot</button></div>` : ""}${pickList}</div>
          <section class="atlas-recap atlas-instance-recap" aria-label="Saved defeats here"><h4>Saved defeats here</h4>${recapContent(saved?.filter((row) => row.atlasId === e.id), { entry: e })}</section>
          <h4>Boss reference & tips</h4><p class="atlas-src">${esc(e.source)}. Community marks aren’t your character’s defeats.</p><ul class="atlas-bosses">${bosses}${extra}</ul>
          <div class="atlas-cols"><div><h4>Group</h4><ul>${e.roles.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div><div><h4>Before you go</h4><ul>${e.prep.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div></div></div>` : ""}
      </div></article>`;
  }
  // "3 upgrades for you": counted main-side against what the character wears.
  function scoreChip(e) {
    const l = e.loot; if (!l) return "";
    if (!l.items) return `<p class="atlas-score none">No boss loot recorded yet</p>`;
    if (l.upgrades) return `<button type="button" class="atlas-score up" data-atlas-loot="${esc(e.id)}">Estimated upgrades: <span class="atlas-score-n">${l.upgrades}</span></button>`;
    if (l.later) return `<button type="button" class="atlas-score later" data-atlas-loot="${esc(e.id)}">Estimated upgrades at higher levels: <span class="atlas-score-n">${l.later}</span></button>`;
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
    const badge = BADGE[v] ? `<span class="loot-badge v-${esc(v)}">${esc(BADGE[v])}</span>` : "";
    return `<li class="loot-tile q-${q} v-${esc(v)}${x.wished ? " wished" : ""}${x.community ? " community" : ""}" data-card-item="${x.itemId}">
      <span class="loot-icon">${it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, 44) : '<span class="loot-gem" aria-hidden="true">◆</span>'}</span>
      <span class="loot-body"><span class="loot-name">${esc(name)}</span>${kind ? `<span class="loot-kind">${esc(kind)}</span>` : ""}${badge}${x.community ? `<span class="loot-provenance">${esc(x.source)}</span>` : ""}${activeProfileId() ? `<button type="button" class="loot-compare" data-nav="sheet" data-atlas-compare="${x.itemId}" data-atlas-profile="${esc(activeProfileId())}" aria-label="Compare item #${x.itemId} in Sheet">Compare in Sheet</button>` : ""}</span>
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
      <div class="loot-legend"><span>Gear comparisons are estimates from saved equipment.</span><span>☆ Star an item for your wish list</span><span>Listed loot is reference, not a personal drop.</span><span>% = seen in that share of loots</span></div>
      ${notes.map((n) => `<p class="loot-note">${esc(n)}</p>`).join("")}
      <div class="loot-bosses">${bosses}</div>
      <p class="atlas-src">Drops observed in World of Warcraft: Forever by the community. ${esc(d.attribution || "")}${d.bosses.some((b) => b.community?.length) ? " Community: drop rates pooled from Backstage Forever players who share anonymously (at least 3 per item)." : ""}</p></div>`;
  }
  async function loadLoot(root, id) {
    const profileId = activeProfileId(), request = Symbol();
    lootRequests.set(id, request);
    let result;
    try { result = await api.dungeonLoot(profileId, id); } catch (err) { result = { error: err.message }; }
    if (lootRequests.get(id) !== request) return;
    lootRequests.delete(id);
    if (mountedFor !== root || document.querySelector("[data-atlas]") !== root || activeProfileId() !== profileId) return;
    loot.set(id, result);
    if (open === id && view === "loot") paint();
  }
  function paint() {
    const root = document.querySelector("[data-atlas]"); if (!root || !atlas) return;
    root.querySelector("[data-atlas-level]").textContent = atlas.level ? `Level ${atlas.level}${atlas.faction ? " · " + atlas.faction : ""} · ${atlas.suggested.length} dungeon${atlas.suggested.length === 1 ? "" : "s"} suggested for you` : "Choose a character to colour dungeons by level";
    root.querySelectorAll("[data-atlas-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.atlasTab === tab)));
    const list = atlas.entries.filter((e) => (tab === "forever" ? e.foreverOriginal || e.observedRuns : e.kind === tab && !e.foreverOriginal));
    const sug = atlas.suggested.map((id) => atlas.entries.find((e) => e.id === id)).filter(Boolean);
    root.querySelector("[data-atlas-suggest]").innerHTML = tab === "dungeon" && sug.length ? `<h2>Suggested for you</h2><div class="atlas-chips">${sug.map((e) => `<button type="button" data-atlas-prep="${esc(e.id)}" class="atlas-chip d-${esc(e.difficulty)}">${esc(e.name)} <small>${e.levels.min}–${e.levels.max} · ${esc(e.zone)}</small></button>`).join("")}</div>` : "";
    root.querySelector("[data-atlas-grid]").innerHTML = list.map(card).join("") || `<p>Nothing observed yet.</p>`;
    root.querySelector("[data-atlas-caution]").textContent = ["Community data · may differ in game. Bosses seen in Forever are marked.", atlas.attribution].filter(Boolean).join(" ");
  }
  async function load(root, fallback) {
    const profileId = activeProfileId();
    let next;
    try { next = await api.dungeonAtlas(); } catch { next = fallback || { entries: [], suggested: [] }; }
    // Shell repaints replace the atlas root, including on profile changes. A request
    // from a detached root (or from before the picker changed) must not repaint it.
    if (mountedFor !== root || document.querySelector("[data-atlas]") !== root || activeProfileId() !== profileId) return;
    atlas = next;
    paintRecap(root, next.recap);
    paint();
  }
  function openDetails(root, id, toggle) {
    const entry = atlas.entries.find((e) => e.id === id);
    if (!entry) return;
    if (tab !== "forever" || !(entry.foreverOriginal || entry.observedRuns)) tab = entry.foreverOriginal ? "forever" : entry.kind;
    open = toggle && open === id && view === "details" ? null : id;
    view = "details";
    paint();
    const card = root.querySelector(`[data-atlas-card="${CSS.escape(id)}"]`);
    const target = card?.querySelector?.(open ? "[data-atlas-prep-heading]" : "[data-atlas-open]");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: open ? "start" : "nearest", behavior: "instant" });
  }
  function mounted() {
    const root = document.querySelector("[data-atlas]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    atlas = null;
    loot.clear();
    lootRequests.clear();
    // Clear immediately, before the shell finishes saving the selection and remounts.
    document.querySelector("#active-character")?.addEventListener("change", () => {
      if (mountedFor !== root) return;
      atlas = null;
      lootRequests.clear();
      paintRecap(root, null, true);
      root.querySelector("[data-atlas-suggest]").innerHTML = "";
      root.querySelector("[data-atlas-grid]").innerHTML = '<p class="atlas-loading">Opening the atlas…</p>';
      root.querySelector("[data-atlas-level]").textContent = "Opening the atlas…";
    });
    paintRecap(root, null, true);
    root.addEventListener("click", async (ev) => {
      if (!atlas) return;
      const star = ev.target.closest("[data-loot-wish]"); if (star) {
        const profileId = activeProfileId();
        if (!profileId || atlas.recap?.profileId !== profileId || star.disabled) return;
        const itemId = Number(star.dataset.lootWish), on = star.getAttribute("aria-pressed") !== "true";
        star.disabled = true;
        try {
          await api.setLootWish(profileId, itemId, on); window.HoverCards?.forget?.();
          if (mountedFor !== root || activeProfileId() !== profileId || atlas?.recap?.profileId !== profileId) return;
          const bossIndex = [...root.querySelectorAll(".loot-boss")].indexOf(star.closest(".loot-boss"));
          for (const d of loot.values()) for (const b of d.bosses || []) for (const x of [...b.items, ...(b.community || [])]) if (x.itemId === itemId) x.wished = on;
          window.toast?.(on ? "Added to your wish list." : "Removed from your wish list.");
          const restoreFocus = document.activeElement === star;
          await load(root, atlas);
          if (restoreFocus && mountedFor === root && activeProfileId() === profileId && document.activeElement === document.body) root.querySelectorAll(".loot-boss")[bossIndex]?.querySelector(`[data-loot-wish="${itemId}"]`)?.focus();
        } catch (err) { if (mountedFor === root && activeProfileId() === profileId) window.toast?.(err.message); }
        finally { star.disabled = false; }
        return;
      }
      const lb = ev.target.closest("[data-atlas-loot]"); if (lb) { const id = lb.dataset.atlasLoot; const same = open === id && view === "loot"; open = same ? null : id; view = "loot"; if (!same) { loot.delete(id); void loadLoot(root, id); } paint(); root.querySelector(`[data-atlas-card="${CSS.escape(id)}"] .atlas-loot-btn`)?.focus(); return; }
      const t = ev.target.closest("[data-atlas-tab]"); if (t) { tab = t.dataset.atlasTab; open = null; paint(); return; }
      const p = ev.target.closest("[data-atlas-prep]"); if (p) { openDetails(root, p.dataset.atlasPrep, false); return; }
      const o = ev.target.closest("[data-atlas-open]"); if (o) { openDetails(root, o.dataset.atlasOpen, true); return; }
      const w = ev.target.closest("[data-atlas-way]");
      const m = ev.target.closest("[data-atlas-map]");
      if (w || m) {
        const e = atlas.entries.find((x) => x.id === (w ? w.dataset.atlasWay : m.dataset.atlasMap));
        if (!e?.entrance || !validPoint(e.mapId, e.entrance)) return;
        const point = { mapId: e.mapId, x: e.entrance.x, y: e.entrance.y };
        if (w) {
          try { const r = await api.copyWaypoint({ ...point, label: e.name }); w.textContent = "Copied — paste in WoW chat"; window.toast?.(r.message); } catch (err) { w.textContent = err.message; }
        } else {
          window.WorldMapView?.focus({ ...point, label: `${e.name} entrance`, sub: "Approximate Classic entrance · verify in Forever" });
          document.querySelector('[data-nav="world-map"]')?.click();
        }
      }
    });
    void load(root).then(() => {
      if (mountedFor === root && open && view === "loot" && atlas?.entries.some((e) => e.id === open && e.loot) && !lootRequests.has(open) && !loot.has(open)) void loadLoot(root, open);
    });
  }
  return { page, mounted };
})();
