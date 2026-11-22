"use strict";
// Dungeons & Raids atlas page. Cards are coloured like in-game difficulty for your level.
window.DungeonAtlas = (() => {
  const api = window.backstage;
  let atlas = null, tab = "dungeon", open = null, view = "details", mountedFor = null;
  let fieldbookMode = "full";
  let ownsProgression;
  const loot = new Map(); // instance id -> dungeonLoot result (or { error })
  const lootRequests = new Map();
  // One original painting per dungeon and raid (art/dungeons/<id>.webp, local ComfyUI, 0.58).
  const ART = new Set(["rfc", "wc", "dm", "sfk", "bfd", "stocks", "gnomer", "rfk", "sm", "rfd", "ulda", "zf", "mara", "st", "brd", "lbrs", "dme", "scholo", "strat", "ubrs", "zg", "mc", "ony", "bwl", "aq20", "aq40", "naxx"]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const BADGE = { upgrade: "Upgrade for you", "upgrade-later": "Upgrade later", "not-for-you": "Not for you", "not-upgrade": "Not an upgrade", usable: "Usable", "no-class": "", "not-equipment": "", unknown: "" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const validPoint = (mapId, { x, y } = {}) => Number.isSafeInteger(mapId) && mapId > 0 && [x, y].every((v) => Number.isFinite(v) && v > 0 && v < 1);
  const LABEL = { right: "Right for your level", easy: "Easy", hard: "Challenging", trivial: "Low level", impossible: "Too high for now", unknown: "Level unknown" };
  // Only cues corroborated by both Classic references in docs/DUNGEON-FIELDBOOK.md.
  const DEADMINES_CUES = new Map([
    ["Mr. Smite", "Expect a group stun as Smite changes weapons. Deal with the guards first."],
    ["Captain Greenskin", "Plan how to control the guards before pulling the captain."],
    ["Edwin VanCleef", "Agree who will pick up or control the hidden guards before the pull."],
  ]);
  function page() {
    return `<section class="atlas-page" data-atlas>
      ${PageHero.render({ art: "dungeons", compact: true, eyebrow: "Adventure · Dungeons & raids", title: "Instance Atlas", subAttrs: "data-atlas-level",
        aside: `<div class="atlas-tabs" role="tablist" aria-label="Instance types">${[["dungeon", "Dungeons"], ["raid", "Raids"], ["forever", "New in Forever"]].map(([id, label]) =>
          `<button type="button" role="tab" id="atlas-tab-${id}" data-atlas-tab="${id}" aria-controls="atlas-results" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}">${label}</button>`).join("")}</div>` })}
      <div class="atlas-results" id="atlas-results" role="tabpanel" aria-labelledby="atlas-tab-${tab}">
      <div class="atlas-suggest" data-atlas-suggest></div>
      <section class="atlas-recap" aria-labelledby="atlas-recap-heading">
        <h2 id="atlas-recap-heading">Your encounter recap</h2>
        <p class="atlas-recap-note">Boss defeats saved in this character’s local journal. Community observations are shown separately below.</p>
        <div data-atlas-recap aria-live="polite"><p>Opening your recap…</p></div>
      </section>
      <details class="atlas-recap atlas-chest-leads" data-chest-pilot><summary>Chest gear acquisition leads</summary>
        <div data-chest-leads aria-live="polite"></div>
      </details>
      <div class="atlas-grid" data-atlas-grid><p class="atlas-loading">Opening the atlas…</p></div>
      <p class="atlas-caution" data-atlas-caution></p>
      </div>
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
  const CHEST_NAMES = { quest: "Quest", vendor: "Vendor", craft: "Craft", dungeon: "Dungeon" };
  function chestContent(model) {
    if (model?.status !== "available") return `<p>${esc(model?.reason || "Chest gear leads are unavailable. Close and reopen to retry.")}</p>`;
    const profile = esc(model.profileId);
    return `<p>Forever build ${esc(model.clientBuild)} · Character last saved <time datetime="${esc(model.savedAt)}">${esc(new Date(model.savedAt).toLocaleString())}</time>.</p>
      <p class="atlas-recap-note">Source leads, not a ranking or confirmation of current availability. A wish-list star does not mean you own the item.</p>
      ${model.leads.length ? `<ul class="atlas-chest-list">${model.leads.map(r => {
        const src = `${esc(r.sourceName)} #${esc(r.sourceId)}`;
        const level = r.requiredLevel === null ? "Equip level unknown" : r.requiredLevel === 0 ? "No minimum equip level listed" : `Equip level ${esc(r.requiredLevel)}${r.equipLevel === "not-met" ? " (not met in this save)" : ""}`;
        const classes = r.allowedClasses?.length ? ` · Class restriction: ${esc(r.allowedClasses.join(", "))}${r.equipClass === "not-met" ? " (not met in this save)" : ""}` : r.equipClass === "unknown" ? " · Class requirement unknown" : "";
        let details, action = "";
        if (r.kind === "quest") {
          details = `Reward choice from ${src} · Minimum quest level ${esc(r.questMinLevel)} · Reference collected ${esc(r.collectionWindow)}. ${r.qualification === "saved-in-log" ? (r.savedReadyToTurnIn ? "Ready to turn in at last save; this does not confirm that you received the reward." : "In your last saved quest log; finish its objectives first.") : "Reference only: this save does not establish eligibility. Quest prerequisites outside the saved log are unknown."}`;
          action = `<button type="button" data-quest-open="${esc(r.sourceId)}" data-atlas-profile="${profile}">Open quest #${esc(r.sourceId)}</button>`;
        } else if (r.kind === "vendor") {
          details = `Listed by ${src} · Reference collected ${esc(r.collectionWindow)} · Merchant interaction observed for ${esc(r.observedFaction)}. ${r.qualification === "reference-only" ? "Reference only: access for your faction is not established. " : "Historical lead only. "}Stock, price and current access are unknown.`;
        } else if (r.kind === "craft") {
          details = `${src} · Saved ${esc(r.professionName)} rank ${esc(r.savedRank)} (skill #${esc(r.skillLineId)}) · ${esc(new Date(r.observedAt).toLocaleString())}. Reagents: ${r.reagents.map(x => `${esc(x.required)} × item #${esc(x.itemId)}`).join(", ")}. Minimum rank, material ownership and current craftability are not confirmed.`;
        } else {
          details = `Observed from ${src} in ${esc(r.instanceName)} · Reference collected ${esc(r.collectionWindow)}. Entry requirements and current drop availability are unknown.`;
          action = `<button type="button" data-chest-dungeon="${esc(r.instanceId)}" data-atlas-profile="${profile}" disabled>Open ${esc(r.instanceName)} details</button>`;
        }
        return `<li data-chest-kind="${esc(r.kind)}" data-item-id="${esc(r.itemId)}"><strong>${CHEST_NAMES[r.kind]} · ${esc(r.itemName || `Item #${r.itemId}`)} (#${esc(r.itemId)})</strong>
          ${r.wished ? '<span class="atlas-chest-wished">On your wish list</span>' : ""}<p>${level}${classes}${r.armorKind ? ` · ${esc(r.armorKind)}` : ""}. Check armor proficiency and other equip requirements in game.</p><p>${details}</p>${action}</li>`;
      }).join("")}</ul>` : ""}
      ${Object.keys(model.gaps).length ? `<ul class="atlas-chest-gaps">${Object.entries(model.gaps).map(([kind, reason]) => `<li><strong>${CHEST_NAMES[kind]}:</strong> ${esc(reason)}</li>`).join("")}</ul>` : ""}
      ${model.attribution ? `<p class="atlas-recap-note">${esc(model.attribution)} Selected exact-ID relations; not a complete loot or vendor catalog.</p>` : ""}`;
  }
  function syncChestDungeon(root) {
    const profileId = activeProfileId();
    const ready = profileId && atlas?.recap?.profileId === profileId;
    for (const button of root.querySelectorAll("[data-chest-dungeon]")) {
      button.disabled = !ready || button.dataset.atlasProfile !== profileId ||
        !atlas.entries.some(entry => entry.id === button.dataset.chestDungeon);
    }
  }
  function compareButton(itemId) {
    return `<button type="button" class="loot-compare" data-nav="sheet" data-atlas-compare="${itemId}" data-atlas-profile="${esc(activeProfileId())}" aria-label="Compare in Sheet: item #${itemId}">Compare in Sheet</button>`;
  }
  function fieldbookWishes(entry, saved) {
    const wished = entry.loot?.wished || [];
    const message = !saved ? "Choose an active character with an available Atlas snapshot to see their wish list." :
      !entry.loot?.items ? "No bundled loot records available here." : "No starred items from the bundled loot records for this dungeon.";
    return `<section class="atlas-fieldbook-wishes" aria-label="Your wish list here"><h5>Your wish list here</h5>
      ${saved && wished.length ? `<p class="atlas-src">From bundled loot records. A star is not an owned item or a personal drop.</p>
      <ul>${wished.map((item) => `<li><span><strong>${esc(item.name || `Item #${item.itemId}`)}</strong> · ${esc(item.boss)}</span>${compareButton(item.itemId)}</li>`).join("")}</ul>` : `<p class="atlas-src">${message}</p>`}</section>`;
  }
  function fieldbook(entry, saved, preflight, lootAction, recap) {
    const compact = fieldbookMode === "compact";
    const supporting = (label, content) => compact ? `<details class="atlas-fieldbook-support"><summary>${label}</summary>${content}</details>` : content;
    return `<div class="atlas-details atlas-fieldbook" data-dungeon-fieldbook="${fieldbookMode}">
      <section class="atlas-preflight" data-fieldbook-stage="before" aria-labelledby="fieldbook-prep-heading">
        ${preflight}
        <div class="atlas-cols atlas-fieldbook-prep">
          <section><h5>Supplies to check in game</h5><p class="atlas-src">Manual checks, not a bag or readiness reading.</p><ul>${entry.prep.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>
          <section><h5>Plan your role</h5><ul><li><strong>Tank</strong> · Agree on the first target and check healer mana before each pull.</li>
          <li><strong>Healer</strong> · Call for a drink break before the group moves on.</li>
          </ul></section>
        </div>
        <section class="atlas-fieldbook-role" aria-labelledby="fieldbook-damage-heading">
          <h5 id="fieldbook-damage-heading"><span>Damage</span> · Before the pull</h5>
          <p>Follow the marked target and agree who handles interrupts or crowd control. Wait for the tank’s signal.</p>
          <p class="atlas-src">Manual group prep, not a verified Forever encounter mechanic.</p>
          <button type="button" data-fieldbook-practice="opener" data-fieldbook-instance="dm">Practice the opener</button>
          <p class="atlas-src">Opens a fictional drill. Nothing is sent to the game.</p>
        </section>
        ${fieldbookWishes(entry, saved)}${lootAction}
      </section>
      ${supporting("Boss reference &amp; tips · Classic", `<section class="atlas-fieldbook-encounters" data-fieldbook-stage="inside" aria-labelledby="fieldbook-encounters-heading">
        <h4 id="fieldbook-encounters-heading">Boss reference &amp; tips</h4>
        <p class="atlas-src">Reviewed Classic reference · mechanics not verified in Forever</p>
        <ul class="atlas-fieldbook-cues">${entry.bosses.filter((boss) => DEADMINES_CUES.has(boss.name)).map((boss) => `<li><strong>${esc(boss.name)}</strong><p>${esc(DEADMINES_CUES.get(boss.name))}</p></li>`).join("")}</ul>
        <section aria-labelledby="fieldbook-roster-heading"><h5 id="fieldbook-roster-heading">Selected Classic roster &amp; community observations</h5><p class="atlas-src">Not a complete boss roster. Forever community marks aren’t this character’s defeats.</p>
          <ul class="atlas-bosses">${entry.bosses.map((boss) => `<li>${esc(boss.name)}${boss.observedInForever ? "<small>Seen in Forever · community</small>" : ""}</li>`).join("")}${entry.observedOnly.map((boss) => `<li>${esc(boss.name)}<small>Reported in Forever · community</small></li>`).join("")}</ul></section>
      </section>`)}
      ${supporting("Saved defeats here", recap)}</div>`;
  }
  function progressionContent(model) {
    if (!model) return "";
    const current = model.status === "available" && activeProfileId() === model.owner?.profileId && ownsProgression?.(model);
    const time = (date) => `<time datetime="${date.toISOString()}">${esc(date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</time>`;
    const list = (rows, render, empty) => rows.length ? `<ul>${rows.map(row => `<li>${render(row)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
    return `<details class="atlas-recap" data-dungeon-progression><summary>Observed dungeon progression</summary>${current ? `
      <p>Private · Last saved ${time(new Date(model.savedAt))} · Saved Forever build ${esc(model.clientBuild)}.</p>
      <h4>Unfinished quests in your saved log</h4>
      ${list(model.quests, q => `${esc(q.title)} (#${esc(q.id)})`, "No reviewed unfinished quest in this save. This is not a complete quest list.")}
      <h4>Starred gear goals</h4>
      ${model.gearGoals === null ? '<p>No gear source reviewed for this saved build.</p>' : list(model.gearGoals,
        g => `<strong>${esc(g.name)} (#${esc(g.itemId)})</strong> · Historical community source: ${esc(g.sourceName)} (Efficient Games, CC BY 4.0)`, "No starred item among the reviewed gear sources.")}
      <p class="atlas-recap-note">A wish-list star does not establish eligibility, ownership or a drop received.</p>
      <h4>Retained boss defeats</h4>
      ${list(model.defeats.rows, row => `${esc(row.name)} · ${time(new Date(row.at * 1000))}`, "No matching retained observations. This doesn’t mean you’ve never defeated a boss here.")}
      ${model.defeats.moreRetained ? '<p>Showing the latest five retained observations for this dungeon.</p>' : ""}
      <p class="atlas-recap-note">The capture build was not recorded for these historical defeats. They don’t establish a clear, personal loot or lockout.</p>` :
      `<p>${esc(model.reason || "Progression unavailable for the active character.")}</p>`}</details>`;
  }
  function card(e) {
    const isOpen = open === e.id;
    const pilot = e.id === "dm";
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
    const lootAction = e.loot?.items ? `<div class="atlas-actions"><button type="button" data-atlas-loot="${esc(e.id)}">Browse recorded loot</button></div>` : "";
    const preflight = `<h4 tabindex="-1" data-atlas-prep-heading${pilot ? ' id="fieldbook-prep-heading"' : ""}>Prepare for ${esc(e.name)}</h4>${ready}
      <div class="atlas-actions">${entrance ? `<button type="button" class="primary" data-atlas-way="${esc(e.id)}">Copy entrance waypoint</button><button type="button" data-atlas-map="${esc(e.id)}">Show on World Map</button>` : ""}</div>
      ${entrance ? `<p class="atlas-src">Approximate Classic entrance: ${esc(e.zone)} · ${(e.entrance.x * 100).toFixed(0)}, ${(e.entrance.y * 100).toFixed(0)}. Verify in Forever.</p>` : `<p class="atlas-src">No usable entrance waypoint in this reference.</p>`}
      ${pilot ? `<button type="button" data-fieldbook-mode aria-pressed="${fieldbookMode === "compact"}">Compact view</button>${fieldbookMode === "full" ? '<p class="atlas-src" data-fieldbook-intro>First run? Start with the entrance, quests and manual checks below. Boss reference and saved defeats are separate from your preparation.</p>' : ""}` : ""}
      ${questList(yourQuests.filter((q) => q.complete), "Ready to turn in · Last saved")}
      ${questList(yourQuests.filter((q) => !q.complete), "In your quest log · Last saved")}
      ${pilot ? '<div class="atlas-actions"><button type="button" data-atlas-ask="dm" aria-describedby="atlas-ask-hint">Ask about this</button></div><p class="atlas-src" id="atlas-ask-hint">Opens an editable Companion draft for The Deadmines (#dm). Nothing is sent until you choose Send.</p>' : ""}`;
    const recap = `<section class="atlas-recap atlas-instance-recap" aria-label="Saved defeats here"${pilot ? ' data-fieldbook-stage="after"' : ""}><h4>Saved defeats here</h4>
      ${pilot ? '<p class="atlas-recap-note">This is saved encounter evidence, not a record of a clear, personal loot or lockout. Reload or log out in game to save new observations.</p>' : ""}
      ${recapContent(saved?.filter((row) => row.atlasId === e.id && (!pilot || row.instanceType === "party")), { entry: e })}</section>`;
    return `<article class="atlas-card d-${esc(e.difficulty)} ${e.kind}${isOpen ? " open" : ""}" data-atlas-card="${esc(e.id)}">
      <div class="atlas-ribbon"><span>${e.levels ? `${e.levels.min}${e.levels.max !== e.levels.min ? "–" + e.levels.max : ""}` : "?"}</span></div>
      <div class="atlas-card-body">
        ${ART.has(e.id) ? `<img class="atlas-art" src="art/dungeons/${e.id}.webp" alt="" width="960" height="536" loading="lazy">` : ""}
        <h3>${esc(e.name)}</h3>
        <p class="atlas-where">${e.zone ? esc(e.zone) : "Location not yet observed"}${e.faction ? ` · <span class="atlas-side ${esc(e.faction.toLowerCase())}">${esc(e.faction)}</span>` : ""}${e.observedRuns ? ' · <span class="atlas-seen">Community encounter reports</span>' : ""}</p>
        <p class="atlas-diff">${esc(LABEL[e.difficulty])}${e.factionNote ? ` · ${esc(e.factionNote)}` : ""}</p>
        ${scoreChip(e)}${wishRow(e)}
        ${!isOpen && (yourQuests.length || pick.length) ? `<p class="atlas-brief">${yourQuests.length ? `${yourQuests.length} related quest${yourQuests.length === 1 ? "" : "s"} in your saved log` : `${pick.length} possible quest pickup${pick.length === 1 ? "" : "s"}`}</p>` : ""}
        <div class="atlas-toggles"><button type="button" class="atlas-toggle" data-atlas-open="${esc(e.id)}" aria-expanded="${isOpen && view === "details"}">${pilot ? (isOpen && view === "details" ? "Hide Dungeon Fieldbook" : "Open Dungeon Fieldbook") : isOpen && view === "details" ? "Hide details" : `Bosses, roles & prep (${e.bosses.length + e.observedOnly.length} bosses)`}</button>${e.loot ? `<button type="button" class="atlas-loot-btn${isOpen && view === "loot" ? " on" : ""}" data-atlas-loot="${esc(e.id)}" aria-expanded="${isOpen && view === "loot"}"><span class="atlas-chest" aria-hidden="true"></span>${isOpen && view === "loot" ? "Hide loot" : `Loot${e.loot.items ? ` (${e.loot.items} items)` : ""}`}</button>` : ""}</div>
        ${isOpen && view === "loot" ? lootView(e) : ""}
        ${isOpen && view === "details" ? pilot ? fieldbook(e, saved, preflight + (pickList || '<p class="atlas-src">No possible quest pickups listed in this reference. Check availability in game.</p>'), lootAction, recap) + progressionContent(atlas?.progression) : `<div class="atlas-details"><div class="atlas-preflight">${preflight}${lootAction}${pickList}</div>
          ${recap}
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
    return `<div class="atlas-wishes"><span class="atlas-wish-label">★ Wish list</span>${w.slice(0, 8).map((x) => `<span class="atlas-wish q-${QUALITY[x.quality] || "unknown"}" data-card-item="${x.itemId}">${x.iconFileId && window.GameIcons ? GameIcons.tag(x.iconFileId, 28) : '<img class="loot-gem" src="art/icons/loot-unknown.png" alt="">'}<span class="sr-only">${esc(x.name || `Item #${x.itemId}`)} from ${esc(x.boss)}</span></span>`).join("")}</div>`;
  }
  const pct = (c) => (c >= 0.995 ? "100%" : `${Math.max(1, Math.round(c * 100))}%`);
  function tile(x) {
    const it = x.item, q = QUALITY[it?.quality] || "unknown", v = x.verdict?.verdict || "unknown";
    const name = it?.name || `Item #${x.itemId}`;
    // A name-only item is one the game delivers by hotfix: its details are not in the local game files.
    const kind = it ? [it.slot, it.kind].filter(Boolean).join(" · ") || (it.itemLevel ? `Item level ${it.itemLevel}` : it.nameOnly ? "Details not in your game files yet" : "") : "";
    const badge = BADGE[v] ? `<span class="loot-badge v-${esc(v)}">${esc(BADGE[v])}</span>` : "";
    return `<li class="loot-tile q-${q} v-${esc(v)}${x.wished ? " wished" : ""}${x.community ? " community" : ""}" data-card-item="${x.itemId}">
      <span class="loot-icon">${it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, 44) : '<img class="loot-gem" src="art/icons/loot-unknown.png" alt="">'}</span>
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
    const tabs = [...root.querySelectorAll("[data-atlas-tab]")];
    for (const button of tabs) {
      const selected = button.dataset.atlasTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = (tabs.includes(document.activeElement) ? button === document.activeElement : selected) ? 0 : -1;
    }
    root.querySelector("#atlas-results").setAttribute("aria-labelledby", `atlas-tab-${tab}`);
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
    syncChestDungeon(root);
    return next;
  }
  function openDetails(root, id, toggle, focus = "[data-atlas-prep-heading]") {
    const entry = atlas.entries.find((e) => e.id === id);
    if (!entry) return;
    if (tab !== "forever" || !(entry.foreverOriginal || entry.observedRuns)) tab = entry.foreverOriginal ? "forever" : entry.kind;
    open = toggle && open === id && view === "details" ? null : id;
    view = "details";
    paint();
    const card = root.querySelector(`[data-atlas-card="${CSS.escape(id)}"]`);
    const target = card?.querySelector?.(open ? focus : "[data-atlas-open]");
    target?.focus({ preventScroll: true });
    const context = focus === "[data-fieldbook-practice]" ? target?.closest(".atlas-fieldbook-role") : target;
    context?.scrollIntoView({ block: open ? "start" : "nearest", behavior: "instant" });
  }
  function mounted(openQuestion, practice, matchesProgressionOwner) {
    const root = document.querySelector("[data-atlas]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    ownsProgression = matchesProgressionOwner;
    const tabs = [...root.querySelectorAll("[data-atlas-tab]")];
    const tablist = root.querySelector(".atlas-tabs");
    tablist.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(event.target);
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(next, event.key)) return;
      event.preventDefault();
      const target = tabs[next[event.key]];
      tabs.forEach(button => { button.tabIndex = button === target ? 0 : -1; });
      target.focus();
    });
    tablist.addEventListener("focusout", (event) => {
      if (!tablist.contains(event.relatedTarget)) tabs.forEach(button => { button.tabIndex = button.dataset.atlasTab === tab ? 0 : -1; });
    });
    atlas = null;
    loot.clear();
    lootRequests.clear();
    const chest = root.querySelector("[data-chest-pilot]"), chestBody = root.querySelector("[data-chest-leads]");
    let chestRequest = 0;
    const mountedHere = () => mountedFor === root && document.querySelector("[data-atlas]") === root;
    async function loadChest() {
      const request = ++chestRequest, profileId = activeProfileId();
      if (!mountedHere() || !chest.open) return;
      chestBody.textContent = "Checking exact chest sources…";
      let next;
      try { next = await api.gearAcquisition(profileId, "chest"); } catch {}
      if (!mountedHere() || !chest.open || request !== chestRequest || activeProfileId() !== profileId) return;
      // chestContent escapes all dynamic text and attributes from the IPC model.
      chestBody.innerHTML = chestContent(next?.profileId === profileId ? next : null);
      syncChestDungeon(root);
      const summary = chest.querySelector("summary");
      if (document.activeElement === summary) summary.scrollIntoView({ block: "start", behavior: "instant" });
    }
    chest.addEventListener("toggle", loadChest);
    // Clear immediately, before the shell finishes saving the selection and remounts.
    document.querySelector("#active-character")?.addEventListener("change", () => {
      if (mountedFor !== root) return;
      ++chestRequest;
      chest.open = false;
      chestBody.replaceChildren();
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
      const mode = ev.target.closest("[data-fieldbook-mode]");
      const launch = ev.target.closest("[data-fieldbook-practice]");
      if (mode || launch) {
        if (open !== "dm" || view !== "details" || !root.contains(mode || launch)) return;
        if (mode) {
          fieldbookMode = fieldbookMode === "full" ? "compact" : "full";
          paint();
          root.querySelector("[data-fieldbook-mode]")?.focus();
        } else if (atlas.recap?.profileId === activeProfileId()) {
          practice?.open(launch.dataset.fieldbookInstance, launch.dataset.fieldbookPractice, fieldbookMode, atlas.practiceOwner);
        }
        return;
      }
      const ask = ev.target.closest("[data-atlas-ask]");
      if (ask) {
        const id = ask.dataset.atlasAsk, profileId = activeProfileId();
        const current = () => id === "dm" && ask.dataset.atlasAsk === id &&
          mountedHere() && root.contains(ask) && open === id && view === "details" &&
          activeProfileId() === profileId && atlas?.entries.some(e => e.id === id);
        if (current()) void openQuestion?.({ kind: "dungeon-prep", id }, current);
        return;
      }
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
          if (mountedHere() && chest.open) void loadChest();
          if (restoreFocus && mountedFor === root && activeProfileId() === profileId && document.activeElement === document.body) root.querySelectorAll(".loot-boss")[bossIndex]?.querySelector(`[data-loot-wish="${itemId}"]`)?.focus();
        } catch (err) { if (mountedFor === root && activeProfileId() === profileId) window.toast?.(err.message); }
        finally { star.disabled = false; }
        return;
      }
      const chestDungeon = ev.target.closest("[data-chest-dungeon]");
      if (chestDungeon && !chestDungeon.disabled && chest.open && chestDungeon.dataset.atlasProfile === activeProfileId() && atlas.recap?.profileId === activeProfileId()) {
        openDetails(root, chestDungeon.dataset.chestDungeon, false);
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
    void load(root).then((loaded) => {
      if (mountedHere() && loaded && practice?.returning) {
        const mode = practice.returning(loaded.practiceOwner, loaded.entries.some(e => e.id === "dm"));
        if (mode) {
          fieldbookMode = mode;
          openDetails(root, "dm", false, "[data-fieldbook-practice]");
        }
      }
      if (mountedFor === root && open && view === "loot" && atlas?.entries.some((e) => e.id === open && e.loot) && !lootRequests.has(open) && !loot.has(open)) void loadLoot(root, open);
    });
  }
  // Do not show a retained card until a scoped return has matched the fresh Atlas.
  function awaitPracticeReturn() { open = null; }
  return { page, mounted, awaitPracticeReturn };
})();
