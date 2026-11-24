"use strict";
// Views inside Adventure → Professions (roadmap E2, E1, E3, E5), next to the workbench:
//  - Recipe book: every recipe your game files define for a profession, known or missing, the
//    skill it needs, when it turns yellow, green and grey, what it uses and where it comes from.
//  - Skill path: for each skill range the orange or yellow recipe with the lowest material cost,
//    from prices you saw yourself. Worked out from data; not a reviewed guide.
//  - Who can craft it: search an item across all your saved characters.
//  - Cooking & fishing: what you can cook from your saved bags and bank.
// Everything shown comes from the main process (recipe-book-ipc.cjs) and is escaped here.
window.RecipeBookView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const quality = (q) => QUALITY[q] || "common";
  const VIEWS = [["bench", "Workbench"], ["book", "Recipe book"], ["path", "Skill path"], ["who", "Who can craft it"], ["cook", "Cooking & fishing"]];
  const PAGE = 100;
  let root = null, view = "bench", profileId = null, request = 0;
  const book = { line: null, data: null, error: "", loading: false, at: 0, filter: "all", source: "any", query: "", shown: PAGE, earlier: false };
  const who = { query: "", data: null, error: "", loading: false };
  const cook = { data: null, error: "", loading: false, at: 0 };

  const icon = (fileId, size = 32) => (fileId && window.GameIcons ? GameIcons.tag(fileId, size) : `<span class="rb-gem" aria-hidden="true">◆</span>`);
  function coins(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return [g ? `${g.toLocaleString()}g` : "", s ? `${s}s` : "", c || (!g && !s) ? `${c}c` : ""].filter(Boolean).join(" ");
  }
  const pct = (chance) => (Number.isFinite(chance) ? `${chance >= 0.1 ? Math.round(chance * 100) : Math.round(chance * 1000) / 10}%` : "");
  const dateOf = (at) => (Number.isFinite(at) && at > 0 ? (window.I18n?.when ? window.I18n.when(at * 1000, "day") : new Date(at * 1000).toLocaleString()) : "");
  const COLOUR = { orange: "Orange", yellow: "Yellow", green: "Green", grey: "Grey" };
  const dot = (colour) => (colour ? `<i class="rb-dot rb-${colour}" title="${COLOUR[colour]} at your skill" aria-label="${COLOUR[colour]} at your skill"></i>` : "");
  const needs = (materials) => materials.map((m) => `${m.count} ${esc(m.name)}`).join(", ");

  function switcher() {
    return `<div class="gp-switch rb-switch" role="tablist" aria-label="Profession views">${VIEWS.map(([id, label]) => `<button type="button" role="tab" data-rb-tab="${id}" data-preparation-control="rb-tab:${id}" aria-selected="${view === id}" tabindex="${view === id ? 0 : -1}">${label}</button>`).join("")}</div>`;
  }
  /**
   * Markup the Professions page places under its hero: the view switch and this module's container.
   * On the workbench itself the switch is hidden (the workbench keeps its place in the first
   * viewport); the buttons from links() open the other views from there.
   */
  const frame = () => `${switcher()}<div class="rb-view" data-rb-view>${view === "bench" ? "" : body()}</div>`;
  /** Buttons for the workbench's side column: the ways into the other views. */
  const links = () => `<nav class="rb-links" aria-label="More for your professions"><h3>More for your professions</h3>${VIEWS.slice(1).map(([id, label]) => `<button type="button" data-rb-tab="${id}" data-preparation-control="rb-link:${id}">${label}</button>`).join("")}</nav>`;

  // ---- Recipe book -----------------------------------------------------------------------------
  function thresholds(r) {
    const cell = (cls, value, label) => `<i class="rb-${cls}" title="${label}">${value}</i>`;
    return `<span class="rb-th">${cell("orange", r.orange ?? "?", r.orange === null ? "The skill to learn it is not recorded" : "Skill needed (orange from here)")}${cell("yellow", r.yellow, "Yellow from")}${cell("green", r.green, "Green from")}${cell("grey", r.grey, "Grey from")}</span>`;
  }
  function sourceLine(s) {
    const item = s.itemName ? ` <small>(${esc(s.itemName)})</small>` : "";
    if (s.kind === "auto") return `<span class="rb-kind rb-k-auto">Automatic</span> Comes with the skill at ${s.skill}`;
    if (s.kind === "trainer") return `<span class="rb-kind rb-k-trainer">Trainer</span> ${s.skill ? `skill ${s.skill}` : "skill not recorded"} · ${s.copper === null ? "cost not recorded" : `${s.estimated ? "about " : ""}${esc(coins(s.copper))}`}`;
    if (s.kind === "vendor") return `<span class="rb-kind rb-k-vendor">Vendor</span> ${esc(s.name)}${s.zone ? `, ${esc(s.zone)}` : ""} · ${s.price ? `you saw it for ${esc(coins(s.price.copper))}` : s.listed ? `others paid ${s.listed.estimated ? "about " : ""}${esc(coins(s.listed.copper))}${s.listed.stack > 1 ? ` for ${s.listed.stack}` : ""}` : "price not seen"}${s.stock ? ` · limited stock (${s.stock} at a time)` : ""}${s.otherSide ? " · seen by the other faction only" : ""}${item}`;
    if (s.kind === "dungeon") return `<span class="rb-kind rb-k-drop">Dungeon</span> ${esc(s.name)}, ${esc(s.instance)} · ${esc(pct(s.chance))}${item}`;
    if (s.kind === "drop") return `<span class="rb-kind rb-k-drop">${s.object ? "Container" : "Drop"}</span> ${esc(s.name)} · ${esc(pct(s.chance))} <small>(seen ${s.drops}×)</small>${item}`;
    if (s.kind === "quest") return `<span class="rb-kind rb-k-quest">Quest</span> ${esc(s.title)}${s.choice ? " (one of the reward choices)" : ""}${s.otherSide ? " · other faction" : ""}`;
    return "";
  }
  function sources(r) {
    if (!r.sources.length) return `<ul class="rb-sources"><li><span class="rb-kind rb-k-none">Unknown</span> Source not recorded${r.recipeItems.length ? ` · taught by ${esc(r.recipeItems[0].name || "a recipe item")}` : ""}</li></ul>`;
    // Two quests with the same name read as one line here: say it once.
    const lines = [...new Set(r.sources.map(sourceLine).filter(Boolean))], shown = lines.slice(0, 3);
    return `<ul class="rb-sources">${shown.map((line) => `<li>${line}</li>`).join("")}${lines.length > shown.length ? `<li class="rb-more">and ${lines.length - shown.length} more</li>` : ""}</ul>`;
  }
  function status(r, rank) {
    if (r.known) return `<span class="rb-state rb-known">Known</span>${dot(r.colour)}`;
    if (r.learnable) return `<span class="rb-state rb-learn">Can learn now</span>`;
    if (rank !== null && r.orange !== null && rank < r.orange) return `<span class="rb-state rb-later">Needs skill ${r.orange}</span>`;
    return `<span class="rb-state rb-missing">Missing</span>`;
  }
  function recipeRow(r, rank) {
    const card = r.made?.itemId ? ` data-card-item="${r.made.itemId}"` : "";
    return `<li class="rb-row${r.known ? " rb-is-known" : ""}" data-rb-recipe="${r.id}"><span class="rb-icon"${card}>${icon(r.iconFileId)}</span>
      <div class="rb-what"><strong class="q-${quality(r.quality)}"${card}>${esc(r.name)}</strong>${r.made && r.made.count > 1 ? `<small class="rb-makes">makes ${r.made.count}</small>` : ""}<p>${needs(r.materials)}</p></div>
      ${thresholds(r)}<div class="rb-status">${status(r, rank)}</div>${sources(r)}</li>`;
  }
  const FILTERS = [["all", "All"], ["known", "Known"], ["missing", "Missing"], ["learnable", "Can learn now"]];
  const SOURCES = [["any", "Any source"], ["trainer", "Trainer"], ["vendor", "Vendor"], ["drop", "Drop"], ["quest", "Quest"], ["auto", "Comes with the skill"], ["none", "Source not recorded"]];
  function filtered(d) {
    const words = book.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return d.recipes.filter((r) => {
      if (book.filter === "known" && !r.known) return false;
      if (book.filter === "missing" && r.known) return false;
      if (book.filter === "learnable" && !r.learnable) return false;
      if (book.source === "none" ? r.sources.length : book.source === "drop" ? !r.sourceKinds.includes("drop") && !r.sourceKinds.includes("dungeon") : book.source !== "any" && !r.sourceKinds.includes(book.source)) return false;
      if (words.length) { const hay = `${r.name} ${r.materials.map((m) => m.name).join(" ")}`.toLowerCase(); if (!words.every((w) => hay.includes(w))) return false; }
      return true;
    });
  }
  function professionSelect(d) {
    const mine = d.choices.filter((c) => c.yours), others = d.choices.filter((c) => !c.yours);
    const option = (c) => `<option value="${c.skillLineId}"${c.skillLineId === d.profession.skillLineId ? " selected" : ""}>${esc(c.name)}${c.yours && c.rank !== null ? ` · ${c.rank} / ${c.maxRank}` : ""}</option>`;
    return `<label class="rb-field">Profession<select data-rb-line data-preparation-control="rb-line" aria-label="Profession">${mine.length ? `<optgroup label="Your professions">${mine.map(option).join("")}</optgroup>` : ""}${others.length ? `<optgroup label="Other professions">${others.map(option).join("")}</optgroup>` : ""}</select></label>`;
  }
  function list(d) {
    const rows = filtered(d), shown = rows.slice(0, book.shown);
    if (!rows.length) return `<p class="rb-empty">No recipe matches these filters.</p>`;
    return `<div class="rb-head" aria-hidden="true"><span></span><span>Recipe and materials</span><span>Skill</span><span>Status</span><span>Where it comes from</span></div>
      <ul class="rb-list">${shown.map((r) => recipeRow(r, d.rank)).join("")}</ul>
      ${rows.length > shown.length ? `<div class="rb-foot"><button type="button" data-rb-more data-preparation-control="rb-more">Show ${Math.min(PAGE, rows.length - shown.length)} more</button><span>${shown.length} of ${rows.length} shown</span></div>` : `<div class="rb-foot"><span>${rows.length} ${rows.length === 1 ? "recipe" : "recipes"} shown</span></div>`}`;
  }
  function unavailable(d, loadingText) {
    if (book.error) return `<section class="sht-card rb-card"><p class="rb-empty">${esc(book.error)}</p></section>`;
    if (!d) return `<section class="sht-card rb-card"><p class="rb-empty">${loadingText}</p></section>`;
    return `<section class="sht-card rb-card"><h2>Recipe list unavailable</h2><p class="rb-empty">${esc(d.reason || "The recipe list is unavailable.")}</p></section>`;
  }
  function bookBody() {
    const d = book.data;
    if (!d || d.status !== "available") return unavailable(d, "Reading the recipes from your game files…");
    const c = d.counts;
    const chip = ([id, label]) => `<button type="button" class="rb-chip" data-rb-filter="${id}" data-preparation-control="rb-filter:${id}" aria-pressed="${book.filter === id}">${label}<b>${id === "all" ? c.total : c[id]}</b></button>`;
    return `<section class="sht-card rb-card"><div class="rb-title"><h2>Recipe book</h2><span>${esc(d.profession.name)}${d.rank !== null ? ` · your skill ${d.rank}` : ""} · ${c.total} recipes in your game files</span></div>
      <div class="rb-tools">${professionSelect(d)}
        <label class="rb-field">Source<select data-rb-source data-preparation-control="rb-source" aria-label="Source">${SOURCES.map(([id, label]) => `<option value="${id}"${book.source === id ? " selected" : ""}>${label}${id === "any" ? "" : ` (${id === "drop" ? c.drop : c[id]})`}</option>`).join("")}</select></label>
        <label class="rb-field rb-search">Search<input type="search" data-rb-query data-preparation-control="rb-query" value="${esc(book.query)}" placeholder="Recipe or material" maxlength="60" aria-label="Search recipes"></label></div>
      <div class="rb-chips" role="group" aria-label="Show">${FILTERS.map(chip).join("")}</div>
      <p class="rb-legend"><span>Skill numbers:</span><span><i class="rb-orange">1</i>learn it, orange from here</span><span><i class="rb-yellow">2</i>yellow</span><span><i class="rb-green">3</i>green</span><span><i class="rb-grey">4</i>grey, no more skill points</span></p>
      <div data-rb-list>${list(d)}</div>
      <div class="rb-notes"><h3>Where this comes from</h3><ul><li>Recipes, materials and colours: your own game files (build ${esc(d.build || "unknown")}). The skill a trainer asks for is not in the game files.</li>${d.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div></section>`;
  }

  // ---- Skill path ------------------------------------------------------------------------------
  const kindTags = (kinds, known) => (known ? `<span class="rb-kind rb-k-auto">Known</span>` : kinds.includes("auto") ? `<span class="rb-kind rb-k-auto">Automatic</span>` : kinds.includes("trainer") ? `<span class="rb-kind rb-k-trainer">Trainer</span>` : kinds.includes("vendor") ? `<span class="rb-kind rb-k-vendor">Vendor</span>` : kinds.includes("quest") ? `<span class="rb-kind rb-k-quest">Quest</span>` : kinds.length ? `<span class="rb-kind rb-k-drop">Drop</span>` : `<span class="rb-kind rb-k-none">Unknown</span>`);
  function pathRow(r) {
    const range = `<div class="rb-range"><b>${r.from}–${r.to}</b>${r.current ? `<small class="rb-here">You are here</small>` : ""}</div>`;
    const warn = r.uncertain ? `<p class="rb-warn">Only recipes from drops, quest rewards or with no recorded source give skill here.</p>` : "";
    if (r.kind === "gap") return `<li class="rb-step rb-gap">${range}<div class="rb-step-main"><strong>No orange or yellow recipe in the data</strong><p>Nothing recorded gives a sure skill point in this range.</p></div><div class="rb-cost"><b>—</b></div></li>`;
    if (r.kind === "unpriced") {
      return `<li class="rb-step rb-unpriced${r.current ? " rb-current" : ""}">${range}<div class="rb-step-main"><strong>Price never seen</strong><p>These give skill here. Check their materials at the auction house or a vendor once to get a cost.</p>
        <ul class="rb-options">${r.options.map((o) => `<li><span class="rb-icon">${icon(o.iconFileId, 24)}</span><span><b>${esc(o.name)}</b> ${kindTags(o.sourceKinds, o.known)}<small>needs ${needs(o.materials)}</small></span></li>`).join("")}</ul>${r.unpricedCount > r.options.length ? `<p class="rb-also">and ${r.unpricedCount - r.options.length} more without a price</p>` : ""}${warn}</div><div class="rb-cost"><b>Unknown</b><small>cost</small></div></li>`;
    }
    const x = r.recipe;
    const also = r.others.length ? `<p class="rb-also">Next cheapest: ${r.others.map((o) => `${esc(o.name)} (${esc(coins(o.cost))} each)`).join(", ")}</p>` : "";
    const unseen = r.unpricedCount ? `<p class="rb-also">${r.unpricedCount} other ${r.unpricedCount === 1 ? "recipe has" : "recipes have"} no price seen and could be cheaper.</p>` : "";
    return `<li class="rb-step${r.current ? " rb-current" : ""}">${range}<div class="rb-step-main"><span class="rb-icon">${icon(x.iconFileId, 32)}</span><div><strong>${esc(x.name)}</strong> ${kindTags(x.sourceKinds, x.known)}
      <p>About ${r.crafts} ${r.crafts === 1 ? "craft" : "crafts"} · needs ${needs(r.materials)}</p>${also}${unseen}${warn}</div></div><div class="rb-cost"><b>${esc(coins(r.cost))}</b><small>${esc(coins(x.cost))} each</small></div></li>`;
  }
  function pathBody() {
    const d = book.data;
    if (!d || d.status !== "available") return unavailable(d, "Working out the skill path…");
    const p = d.path, earlier = p.ranges.filter((r) => r.done), ahead = p.ranges.filter((r) => !r.done);
    const shown = book.earlier ? p.ranges : ahead;
    const left = [p.leftOut.noSkill ? `${p.leftOut.noSkill} recipes left out because the skill to learn them is not recorded` : "", p.leftOut.otherSource ? `${p.leftOut.otherSource} recipes from drops, quests or with no recorded source are used only where nothing else gives skill` : ""].filter(Boolean);
    return `<section class="sht-card rb-card"><div class="rb-title"><h2>Skill path ${p.from}–${p.to}</h2><span>${esc(d.profession.name)}${d.rank !== null ? ` · your skill ${d.rank}` : ""}</span></div>
      <p class="rb-banner"><strong>Worked out from your game files and the prices you saw. Not a reviewed guide.</strong> For each range it picks the orange or yellow recipe with the lowest material cost per skill point. A material you never saw a price for has no cost here: it is shown as Unknown, never guessed.</p>
      <div class="rb-tools">${professionSelect(d)}<div class="rb-sum"><span><b>${p.covered}</b> of ${p.points} skill points have a priced step</span><span>Priced steps together: <b>${p.total === null ? "Unknown" : esc(coins(p.total))}</b></span></div></div>
      ${earlier.length ? `<div class="rb-foot rb-foot-top"><button type="button" data-rb-earlier data-preparation-control="rb-earlier" aria-pressed="${book.earlier}">${book.earlier ? "Hide steps below your skill" : `Show ${earlier.length} steps below your skill`}</button></div>` : ""}
      ${shown.length ? `<ol class="rb-path">${shown.map(pathRow).join("")}</ol>` : `<p class="rb-empty">Your skill is at or above ${p.to}. Nothing left to plan here.</p>`}
      <div class="rb-notes"><h3>How to read this</h3><ul><li>Orange always gives a skill point. Yellow gives one less often as your skill rises; the craft counts allow for that and are estimates.</li><li>Prices: the latest auction price you saw (Ledger price memory) or what a vendor charged you, whichever is lower.</li><li>Steps use recipes you know and recipes from trainers and vendors.${left.length ? ` ${esc(left.join(". "))}.` : ""}</li><li>Recipe colours come from your game files; trainer skill needs were seen by other players and are not complete.</li></ul></div></section>`;
  }

  // ---- Who can craft it ------------------------------------------------------------------------
  function maker(m, r) {
    const where = `${esc(m.name)}${m.realm ? `<small> · ${esc(m.realm)}</small>` : ""}`;
    const skill = m.rank !== null ? `${esc(r.profession || "Skill")} ${m.rank}${m.maxRank ? ` / ${m.maxRank}` : ""}` : "skill not saved";
    if (m.knows) return `<li class="rb-maker rb-can"><span class="rb-state rb-known">Can make it</span><b>${where}</b><span>${skill}${dot(m.colour)}</span></li>`;
    const gap = m.gap === null ? "skill needed not recorded" : m.gap === 0 ? `has the skill for it${r.orange ? ` (needs ${r.orange})` : ""}` : `needs ${r.orange} · ${m.gap} more`;
    return `<li class="rb-maker"><span class="rb-state ${m.gap === 0 ? "rb-learn" : "rb-later"}">${m.gap === 0 ? "Recipe not saved" : "Not yet"}</span><b>${where}</b><span>${skill} · ${gap}${m.saveMayMiss && m.gap === 0 ? " · may already know it" : ""}</span></li>`;
  }
  function whoResults() {
    const d = who.data;
    if (who.error) return `<p class="rb-empty">${esc(who.error)}</p>`;
    if (who.loading && !d) return `<p class="rb-empty">Searching your characters…</p>`;
    if (!d || d.status === "empty") return `<p class="rb-empty">Type at least two letters of an item, for example "bandage" or "copper".</p>`;
    if (!d.results.length) return `<p class="rb-empty">No recipe for "${esc(d.query)}" ${d.gameData ? "in your game files" : "in your saved characters"}.</p>`;
    return `<ul class="rb-who">${d.results.map((r) => `<li class="rb-who-item"><div class="rb-who-head"><span class="rb-icon"${r.itemId ? ` data-card-item="${r.itemId}"` : ""}>${icon(r.iconFileId)}</span><div><strong class="q-${quality(r.quality)}"${r.itemId ? ` data-card-item="${r.itemId}"` : ""}>${esc(r.name)}</strong><p>${esc(r.profession || "Profession unknown")}${r.yellow !== null ? ` · learn ${r.orange ?? "?"} · yellow ${r.yellow} · grey ${r.grey}` : ""}${r.materials.length ? ` · needs ${needs(r.materials)}` : ""}</p></div></div>
      ${r.makers.length ? `<ul class="rb-makers">${r.makers.map((m) => maker(m, r)).join("")}</ul>` : `<p class="rb-nobody">None of your saved characters has ${esc(r.profession || "this profession")}.</p>`}</li>`).join("")}</ul>${d.more ? `<p class="rb-also">${d.more} more matches. Type more of the name to narrow it down.</p>` : ""}`;
  }
  function whoBody() {
    return `<section class="sht-card rb-card"><div class="rb-title"><h2>Who can craft it</h2><span>All characters saved on this computer</span></div>
      <div class="rb-tools"><label class="rb-field rb-search rb-wide">Item<input type="search" data-rb-who data-preparation-control="rb-who" value="${esc(who.query)}" placeholder="Item name" maxlength="60" aria-label="Item to craft"></label></div>
      <div data-rb-who-results>${whoResults()}</div>
      <div class="rb-notes"><h3>Where this comes from</h3><ul><li>Known recipes and skill come from each character's last save. A save holds at most 100 recipes, so "Recipe not saved" can be a recipe that character knows.</li><li>Guild members are not searched here.</li></ul></div></section>`;
  }

  // ---- Cooking & fishing -----------------------------------------------------------------------
  function cookRow(r, kind) {
    const mats = r.materials.map((m) => `<span class="${m.have >= m.count ? "rb-have" : "rb-lack"}">${m.count} ${esc(m.name)} <small>(${m.have} held)</small></span>`).join(", ");
    const right = kind === "ready" ? `<div class="rb-cost"><b>×${r.crafts}</b><small>you can cook</small></div>`
      : kind === "short" ? `<div class="rb-cost"><b>Short</b><small>${r.missing.map((m) => `${m.need} ${esc(m.name)}${m.vendor ? " (vendor)" : ""}`).join(", ")}</small></div>`
      : `<div class="rb-cost"><b>${r.canLearn === true ? "Can learn" : r.canLearn === false ? `Skill ${r.orange}` : "Not known"}</b><small>${r.canLearn === false ? "needed to learn" : "recipe"}</small></div>`;
    const from = kind === "learn" ? (r.sources.length ? `<ul class="rb-sources">${r.sources.map((s) => `<li>${sourceLine(s)}</li>`).join("")}${r.sourceCount > r.sources.length ? `<li class="rb-more">and ${r.sourceCount - r.sources.length} more</li>` : ""}</ul>` : `<ul class="rb-sources"><li><span class="rb-kind rb-k-none">Unknown</span> Source not recorded</li></ul>`) : "";
    return `<li class="rb-step rb-cook"><div class="rb-step-main"><span class="rb-icon"${r.itemId ? ` data-card-item="${r.itemId}"` : ""}>${icon(r.iconFileId, 32)}</span><div><strong class="q-${quality(r.quality)}">${esc(r.name)}</strong>${dot(r.colour)}${r.makes > 1 ? `<small class="rb-makes">makes ${r.makes}</small>` : ""}<p>${mats}</p>${from}</div></div>${right}</li>`;
  }
  function cookBody() {
    const d = cook.data;
    if (cook.error) return `<section class="sht-card rb-card"><p class="rb-empty">${esc(cook.error)}</p></section>`;
    if (!d) return `<section class="sht-card rb-card"><p class="rb-empty">Checking your bags…</p></section>`;
    const inv = d.inventory, seen = inv?.seenAt ? `bags seen ${esc(dateOf(inv.seenAt))}${inv.bank && inv.bankSeenAt ? ` · bank seen ${esc(dateOf(inv.bankSeenAt))}` : ""}` : "";
    const group = (title, note, rows, kind) => (rows.length ? `<h3 class="rb-group">${title}<small>${note}</small></h3><ol class="rb-path">${rows.map((r) => cookRow(r, kind)).join("")}</ol>` : "");
    const lists = d.status !== "available" ? `<p class="rb-empty">${esc(d.reason)}</p>`
      : `${group("Cook now", "You know the recipe and hold everything for it.", d.ready, "ready")}${group("Almost", "You know the recipe and hold an ingredient, but something is missing.", d.short, "short")}${group("You could learn", "You hold an ingredient for a recipe that is not in your save.", d.learn, "learn")}${!d.ready.length && !d.short.length && !d.learn.length ? `<p class="rb-empty">Nothing in your saved bags${inv.bank ? " and bank" : ""} is an ingredient of a cooking recipe.</p>` : ""}`;
    return `<section class="sht-card rb-card"><div class="rb-title"><h2>Cook what you carry</h2><span>${d.cooking ? `Cooking ${d.cooking.rank} / ${d.cooking.maxRank}` : "Cooking not saved"}${seen ? ` · ${seen}` : ""}</span></div>${lists}
      ${(d.notes || []).length ? `<div class="rb-notes"><h3>Good to know</h3><ul>${d.notes.map((n) => `<li>${esc(n)}</li>`).join("")}<li>Counts come from your last save, not from the game right now.</li></ul></div>` : ""}</section>
      <section class="sht-card rb-card"><div class="rb-title"><h2>Fishing</h2><span>${d.fishing ? `Fishing ${d.fishing.rank} / ${d.fishing.maxRank}` : "Fishing not saved"}</span></div><p class="rb-empty">${esc(d.fishingNote)}</p></section>`;
  }

  const body = () => (view === "book" ? bookBody() : view === "path" ? pathBody() : view === "who" ? whoBody() : view === "cook" ? cookBody() : "");
  const section = () => root?.querySelector("[data-preparation]");
  function paint() {
    const host = section()?.querySelector("[data-rb-view]");
    if (!host) return;
    const focus = host.contains(document.activeElement) ? document.activeElement : null;
    const key = focus?.dataset.preparationControl, start = focus?.selectionStart, end = focus?.selectionEnd;
    host.innerHTML = view === "bench" ? "" : body();
    if (key) {
      const node = [...host.querySelectorAll("[data-preparation-control]")].find((n) => n.dataset.preparationControl === key);
      if (node) { node.focus({ preventScroll: true }); if (typeof start === "number" && node.setSelectionRange) try { node.setSelectionRange(start, end); } catch {} }
    }
  }
  const paintPart = (selector, html) => { const node = section()?.querySelector(selector); if (node) node.innerHTML = html; };
  const current = (id, mine) => mine === request && id === profileId && Boolean(section());

  async function loadBook(line = book.line) {
    const id = profileId;
    if (!id || !api?.recipeBook) return;
    const mine = ++request;
    book.loading = true;
    let d = null, message = "";
    try { d = await api.recipeBook(id, line); } catch (e) { message = e?.message || "The recipe book is unavailable."; }
    if (mine === request) book.loading = false;
    if (!current(id, mine)) return;
    book.data = d; book.error = message; book.at = Date.now();
    if (d?.profession) book.line = d.profession.skillLineId;
    paint();
  }
  async function loadWho() {
    const query = who.query.trim();
    if (!api?.whoCanCraft) return;
    if (query.length < 2) { who.data = null; who.loading = false; paintPart("[data-rb-who-results]", whoResults()); return; }
    const mine = ++request, id = profileId;
    who.loading = true;
    let d = null, message = "";
    try { d = await api.whoCanCraft(query); } catch (e) { message = e?.message || "The search is unavailable."; }
    if (!current(id, mine) || query !== who.query.trim()) return;
    who.loading = false; who.data = d; who.error = message;
    paintPart("[data-rb-who-results]", whoResults());
  }
  async function loadCook() {
    const id = profileId;
    if (!id || !api?.cookNow) return;
    const mine = ++request;
    cook.loading = true;
    let d = null, message = "";
    try { d = await api.cookNow(id); } catch (e) { message = e?.message || "Your bags could not be checked."; }
    if (mine === request) cook.loading = false;
    if (!current(id, mine)) return;
    cook.data = d; cook.error = message; cook.at = Date.now();
    paint();
  }
  function ensure() {
    if (!profileId) return;
    const stale = (at) => !at || Date.now() - at > 5000;
    if ((view === "book" || view === "path") && !book.loading && (!book.data || book.error || stale(book.at))) void loadBook();
    if (view === "cook" && !cook.loading && (!cook.data || cook.error || stale(cook.at))) void loadCook();
  }
  function show(next) {
    view = VIEWS.some(([id]) => id === next) ? next : "bench";
    const s = section();
    if (!s) return;
    const hadFocus = s.contains(document.activeElement) && document.activeElement.matches("[data-rb-tab]");
    s.dataset.workshopView = view;
    for (const b of s.querySelectorAll(".rb-switch [data-rb-tab]")) { const on = b.dataset.rbTab === view; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    paint(); ensure();
    // The button just pressed may be hidden now: keep the keyboard on the matching control.
    if (hadFocus) s.querySelector(view === "bench" ? `.rb-links [data-rb-tab]` : `.rb-switch [data-rb-tab="${view}"]`)?.focus({ preventScroll: true });
    if (view !== "bench") s.querySelector(".rb-switch")?.scrollIntoView({ block: "nearest" });
  }
  /** Called by the Professions page after it painted: (re)load what the open view needs. */
  function mounted(id) {
    if (id !== profileId) {
      profileId = id || null; request++;
      Object.assign(book, { line: null, data: null, error: "", loading: false, at: 0, shown: PAGE, earlier: false });
      Object.assign(who, { data: null, error: "", loading: false });
      Object.assign(cook, { data: null, error: "", loading: false, at: 0 });
      if (view !== "bench") paint();
    }
    if (view !== "bench") ensure();
  }
  let typing = null;
  function init(node) {
    root = node;
    root.addEventListener("click", (e) => {
      if (!e.target.closest?.("[data-preparation]")) return;
      const tab = e.target.closest("[data-rb-tab]");
      if (tab) { show(tab.dataset.rbTab); return; }
      const filter = e.target.closest("[data-rb-filter]");
      if (filter) { book.filter = filter.dataset.rbFilter; book.shown = PAGE; paint(); return; }
      if (e.target.closest("[data-rb-more]")) { book.shown += PAGE; if (book.data?.status === "available") paintPart("[data-rb-list]", list(book.data)); return; }
      if (e.target.closest("[data-rb-earlier]")) { book.earlier = !book.earlier; paint(); }
    });
    root.addEventListener("keydown", (e) => {
      const tab = e.target.closest?.(".rb-switch [data-rb-tab]");
      if (!tab || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const tabs = [...tab.parentElement.querySelectorAll("[data-rb-tab]")], next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      e.preventDefault(); next.focus(); show(next.dataset.rbTab);
    });
    root.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-rb-line]")) { const line = Number(e.target.value); book.line = Number.isSafeInteger(line) && line > 0 ? line : null; book.shown = PAGE; void loadBook(); return; }
      if (e.target.matches?.("[data-rb-source]")) { book.source = SOURCES.some(([id]) => id === e.target.value) ? e.target.value : "any"; book.shown = PAGE; paint(); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.matches?.("[data-rb-query]")) { book.query = e.target.value.slice(0, 60); book.shown = PAGE; if (book.data?.status === "available") paintPart("[data-rb-list]", list(book.data)); return; }
      if (e.target.matches?.("[data-rb-who]")) { who.query = e.target.value.slice(0, 60); clearTimeout(typing); typing = setTimeout(() => void loadWho(), 200); }
    });
  }
  return { init, frame, links, mounted, show, view: () => view };
})();
