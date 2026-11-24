"use strict";
// Search everything (Ctrl+K): one box over quests, NPCs, items, spells, talents, recipes, zones,
// dungeons, bosses, rares, flight points, commands and help. An overlay, not a page: it opens over
// whatever you are doing and each result opens the existing screen at the right thing.
// The index lives in the main process (src/core/world-search.cjs); this file only asks and draws.
window.WorldSearchView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ART = { quest: "pins/quest-giver", npc: "pins/companion", item: "icons/loot-unknown", spell: "steps/train", talent: "steps/train", recipe: "pins/profession-trainer", zone: "steps/zone",
    dungeon: "pins/instance", boss: "pins/instance", rare: "steps/death", object: "pins/inn", flight: "pins/flight", transport: "steps/flight", command: "icons/finding-your-way", help: "icons/around-the-app" };
  const NPC_ART = { flight: "pins/flight", vendor: "pins/vendor", "class-trainer": "pins/class-trainer", "profession-trainer": "pins/profession-trainer" };
  // What pressing Enter does, per kind, in plain words.
  const OPENS = { quest: "Opens this quest in Quests.", npc: "Opens the World Map on this NPC, with a pin.", object: "Opens the World Map on this spot, with a pin.", rare: "Opens the World Map where a player met it.",
    flight: "Opens the World Map on the flight master.", zone: "Opens this zone on the World Map.", dungeon: "Opens this dungeon in Dungeons & raids.", boss: "Opens the dungeon with this boss marked.",
    talent: "Opens the talent planner on this talent.", recipe: "Opens the recipe book on this recipe.", command: "Opens Help → Commands on this command.", help: "Opens this page in Help.", transport: "Opens the travel planner.",
    item: "The item card is shown here. The lines below link to where it comes from.", spell: "The spell is shown here, with who teaches it when the packs know." };
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  let box = null, input = null, data = null, flat = [], at = 0, kind = null, request = 0, typing = null, detail = null, detailFor = null, lastFocus = null, query = "";

  const isOpen = () => Boolean(box && !box.hidden);
  const artFor = (r) => (r.kind === "npc" && NPC_ART[r.target?.map?.kind]) || ART[r.kind] || "icons/around-the-app";
  const iconFor = (r, size) => (r.icon && window.GameIcons ? GameIcons.tag(r.icon, size) : `<img src="art/${artFor(r)}.png" alt="" width="${size}" height="${size}">`);

  /** The rail button. The shell paints it; a click anywhere on it opens the overlay. */
  const railButton = () => `<button type="button" class="rail-search" data-world-search-open data-shell-control="world-search" aria-label="Search everything" aria-keyshortcuts="Control+K" title="Search everything (Ctrl+K)"><span class="glyph" aria-hidden="true">⌕</span><span>Search everything</span></button>`;

  function build() {
    if (box) return;
    box = document.createElement("div");
    box.className = "ws-backdrop"; box.hidden = true; box.dataset.worldSearch = "";
    box.innerHTML = `<section class="ws-panel" role="dialog" aria-modal="true" aria-labelledby="ws-title">
      <header class="ws-head">
        <h2 id="ws-title" class="sr-only">Search everything</h2>
        <span class="ws-glass" aria-hidden="true">⌕</span>
        <input type="search" class="ws-input" data-ws-input maxlength="80" autocomplete="off" spellcheck="false" placeholder="Quest, NPC, item, spell, zone, boss, command…" aria-label="Search everything" role="combobox" aria-expanded="true" aria-controls="ws-list" aria-autocomplete="list">
        <button type="button" class="ws-close" data-ws-close aria-label="Close search">Esc</button>
      </header>
      <nav class="ws-chips" data-ws-chips aria-label="Kinds of results"></nav>
      <div class="ws-body">
        <div class="ws-list" id="ws-list" data-ws-list role="listbox" aria-label="Search results"></div>
        <aside class="ws-detail" data-ws-detail aria-live="polite"></aside>
      </div>
      <footer class="ws-foot" data-ws-foot></footer>
    </section>`;
    document.body.append(box);
    input = box.querySelector("[data-ws-input]");
    input.addEventListener("input", () => { query = input.value; kind = null; clearTimeout(typing); typing = setTimeout(run, 70); });
    box.addEventListener("mousedown", (e) => { if (e.target === box) close(); });
    box.addEventListener("click", (e) => {
      if (e.target.closest("[data-ws-close]")) return close();
      const chip = e.target.closest("[data-ws-kind]");
      if (chip) { kind = chip.dataset.wsKind || null; run(); input.focus(); return; }
      const link = e.target.closest("[data-ws-link]");
      if (link) { const t = detail?.sources?.[Number(link.dataset.wsLink)]?.target; if (t) go(t); return; }
      const row = e.target.closest("[data-ws-row]");
      if (row) { at = Number(row.dataset.wsRow); paintSelection(); open(flat[at]); }
    });
    box.addEventListener("mousemove", (e) => {
      const row = e.target.closest?.("[data-ws-row]");
      if (row && Number(row.dataset.wsRow) !== at) { at = Number(row.dataset.wsRow); paintSelection(false); }
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!flat.length) return;
        e.preventDefault();
        at = (at + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length; paintSelection(); return;
      }
      if (e.key === "Enter" && e.target === input) { e.preventDefault(); if (flat[at]) open(flat[at]); return; }
      // Keep Tab inside the dialog.
      if (e.key === "Tab") {
        const stops = [...box.querySelectorAll("input, button:not([disabled]), [tabindex='0']")].filter((n) => n.offsetParent !== null);
        if (!stops.length) return;
        const first = stops[0], last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function chips() {
    const el = box.querySelector("[data-ws-chips]");
    if (!data || !data.total) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;
    const all = kind ? data.allGroups || [] : data.groups.map((g) => [g.kind, g.label, g.total]);
    if (!kind) data.allGroups = all;
    const sum = all.reduce((t, g) => t + g[2], 0);
    el.innerHTML = `<button type="button" data-ws-kind="" aria-pressed="${!kind}">All <b>${sum}</b></button>` + all.map(([k, label, n]) => `<button type="button" data-ws-kind="${esc(k)}" aria-pressed="${kind === k}">${esc(label)} <b>${n}</b></button>`).join("");
  }
  function list() {
    const el = box.querySelector("[data-ws-list]");
    flat = [];
    if (!query.trim()) {
      const n = data?.index?.entries;
      el.innerHTML = `<div class="ws-empty"><img src="art/icons/finding-your-way.png" alt="" width="56" height="56"><h3>Search everything the app knows</h3><p>Type a name: a quest, an NPC, an item, a spell, a zone, a boss or a command.</p><p class="ws-keys"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>${n ? `<p class="ws-count">${n.toLocaleString()} things indexed.</p>` : ""}</div>`;
      return;
    }
    if (!data) { el.innerHTML = `<p class="ws-wait">Searching…</p>`; return; }
    if (!data.total) { el.innerHTML = `<div class="ws-empty"><h3>Nothing matches “${esc(data.query)}”</h3><p>The search covers what the app knows today. Check the spelling, or try fewer letters.</p></div>`; return; }
    el.innerHTML = data.groups.map((g) => `<section class="ws-group" aria-label="${esc(g.label)}"><h3><span>${esc(g.label)}</span>${g.total > g.results.length ? `<button type="button" class="ws-more" data-ws-kind="${esc(g.kind)}">Show all ${g.total}</button>` : `<small>${g.total}</small>`}</h3>${g.results.map((r) => {
      const i = flat.push(r) - 1;
      const q = r.kind === "item" && QUALITY[r.quality] ? ` ws-q-${QUALITY[r.quality]}` : "";
      return `<button type="button" class="ws-row" role="option" id="ws-row-${i}" data-ws-row="${i}" aria-selected="false"><span class="ws-ico ws-ico-${esc(r.kind)}">${iconFor(r, 28)}</span><span class="ws-text"><strong class="ws-name${q}" data-no-translate>${esc(r.name)}</strong><small>${esc(r.sub)}</small></span>${r.otherFaction ? '<em class="ws-other">Other faction</em>' : ""}<span class="ws-src ws-src-${esc(r.source)}">${esc(r.sourceLabel)}</span></button>`;
    }).join("")}</section>`).join("");
    window.I18n?.apply(el);
  }
  function foot() {
    const el = box.querySelector("[data-ws-foot]");
    const limits = (data?.limits || []).slice(0, 2).map((l) => `<p class="ws-limit">${esc(l)}</p>`).join("");
    const ix = data?.index;
    el.innerHTML = `${limits}<p class="ws-legend"><span class="ws-src ws-src-game">Your game files</span><span class="ws-src ws-src-bundled">Bundled reference</span><span class="ws-src ws-src-community">Community data</span><span class="ws-src ws-src-app">Backstage Forever</span>${data?.fuzzy ? "<em>Close spellings are shown.</em>" : ""}${ix ? `<small data-no-translate>${ix.entries.toLocaleString()} · ${ix.gameBuild ? esc(ix.gameBuild) : "no game files"}</small>` : ""}</p>`;
    window.I18n?.apply(el);
  }
  function paintSelection(scroll = true) {
    for (const row of box.querySelectorAll("[data-ws-row]")) {
      const on = Number(row.dataset.wsRow) === at;
      row.setAttribute("aria-selected", String(on));
      if (on && scroll) row.scrollIntoView({ block: "nearest" });
    }
    input.setAttribute("aria-activedescendant", flat[at] ? `ws-row-${at}` : "");
    showDetail(flat[at] || null);
  }
  const SOURCE_NOTE = {
    game: (ix) => `Read from your own game files${ix?.gameBuild ? ` (build ${ix.gameBuild})` : ""}. Nothing is uploaded.`,
    bundled: () => "From the reference bundled with the app: what players saw in WoW Forever (Efficient Games, CC BY 4.0). Places are approximate.",
    community: () => "From the daily community pack: shared anonymously by other Backstage Forever players.",
    app: () => "Part of Backstage Forever itself.",
  };
  function detailMarkup(r) {
    if (!r) return "";
    const d = detailFor === `${r.kind}:${r.id}` ? detail : null;
    let middle = "";
    if (r.kind === "item") middle = d?.card ? `<div class="ws-card hover-card-inline">${d.card}</div>` : d ? "" : `<p class="ws-wait">Reading the item…</p>`;
    if (r.kind === "spell" && d?.spell) middle = `<div class="ws-spell">${d.spell.rank ? `<p class="ws-rank">${esc(d.spell.rank)}</p>` : ""}${d.spell.description ? `<p data-no-translate>${esc(d.spell.description)}</p>` : `<p>The game files carry no tooltip text for this spell.</p>`}</div>`;
    const sources = d?.sources?.length ? `<h4>${r.kind === "item" ? "Where it comes from" : "Who teaches it"}</h4><ul class="ws-sources">${d.sources.map((s, i) => `<li>${s.target ? `<button type="button" data-ws-link="${i}" data-no-translate>${esc(s.text)}</button>` : `<span data-no-translate>${esc(s.text)}</span>`}<small class="ws-src ws-src-${esc(s.source)}">${esc(s.sourceLabel)}</small></li>`).join("")}</ul>`
      : d && (r.kind === "item" || r.kind === "spell") ? `<p class="ws-none">${r.kind === "item" ? "The packs do not say where this item comes from yet." : "No trainer for this spell is recorded yet."}</p>` : "";
    return `<header class="ws-d-head"><span class="ws-ico ws-ico-big ws-ico-${esc(r.kind)}">${iconFor(r, 40)}</span><div><strong data-no-translate>${esc(r.name)}</strong><small>${esc(r.sub)}</small></div></header>
      ${middle}${sources}
      <p class="ws-opens">${esc(OPENS[r.kind] || "")}</p>
      <p class="ws-from"><span class="ws-src ws-src-${esc(r.source)}">${esc(r.sourceLabel)}</span>${esc(SOURCE_NOTE[r.source]?.(data?.index) || "")}</p>`;
  }
  function showDetail(r) {
    const el = box.querySelector("[data-ws-detail]");
    el.innerHTML = detailMarkup(r);
    window.I18n?.apply(el);
    if (!r || (r.kind !== "item" && r.kind !== "spell")) return;
    const key = `${r.kind}:${r.id}`;
    if (detailFor === key) return;
    detailFor = key; detail = null;
    const profileId = document.getElementById("active-character")?.value || null;
    Promise.all([
      api.worldSearchDetail(r.kind, r.id).catch(() => null),
      r.kind === "item" && api.itemCard ? api.itemCard(profileId, r.id).catch(() => null) : null,
    ]).then(([found, card]) => {
      if (detailFor !== key) return;
      detail = { ...(found || { sources: [] }), card: r.kind === "item" ? window.HoverCards?._itemMarkup(card, r.name) || "" : "" };
      if (flat[at] && `${flat[at].kind}:${flat[at].id}` === key && isOpen()) { el.innerHTML = detailMarkup(flat[at]); window.I18n?.apply(el); }
    });
  }
  async function run() {
    const q = query.trim(), mine = ++request;
    if (!q) { data = data?.index ? { index: data.index } : null; flat = []; at = 0; chips(); list(); foot(); showDetail(null); return; }
    let found;
    try { found = await api.worldSearch(q, kind ? { kind } : {}); } catch { found = { query: q, groups: [], total: 0, limits: ["The search is not available right now."] }; }
    if (mine !== request || !isOpen()) return;
    if (kind) found.allGroups = data?.allGroups || [];
    data = found; at = 0;
    chips(); list(); foot(); paintSelection();
  }

  // ---------- opening a result ----------
  // The shell owns navigation (it saves first and guards character switches): hand it a click.
  function shellClick(dataset) {
    const root = document.getElementById("app") || document.body;
    const b = document.createElement("button");
    b.type = "button"; b.hidden = true;
    for (const [k, v] of Object.entries(dataset)) b.dataset[k] = v;
    root.append(b); b.click(); b.remove();
  }
  /** Open a target: { quest } | { map } | { zone } | { nav } | { dungeon, boss } | { talent } | { recipe } | { command }. */
  function go(t) {
    if (!t) return false;
    close(false);
    if (t.quest) shellClick({ questOpen: String(t.quest) });
    else if (t.map) shellClick({ mapFocus: JSON.stringify({ ...t.map, source: "From Search everything" }) });
    else if (t.zone) shellClick({ mapZone: String(t.zone) });
    else if (t.dungeon) { window.DungeonAtlas?.focus?.(t.dungeon, t.boss || null); shellClick({ nav: "dungeons" }); }
    else if (t.talent) { window.TalentsView?.focus?.(t.talent); shellClick({ nav: "talents" }); }
    else if (t.recipe) { window.RecipeBookView?.focusRecipe?.(t.recipe); shellClick({ nav: "preparation" }); }
    else if (t.command) { window.CommandsView?.focus?.(t.text || t.command); shellClick({ nav: "commands" }); }
    else if (t.nav) shellClick({ nav: t.nav });
    else return false;
    return true;
  }
  function open(r) {
    if (!r) return;
    // Items and spells have no page of their own: their card is the result. Enter moves to its links.
    if (r.target?.item || r.target?.spell) { box.querySelector("[data-ws-detail] [data-ws-link]")?.focus(); return; }
    go(r.target);
  }

  function show(initial) {
    build();
    if (isOpen()) { input.focus(); input.select(); return; }
    lastFocus = document.activeElement;
    box.hidden = false;
    document.body.classList.add("ws-open");
    window.HoverCards?.hide?.();
    if (typeof initial === "string") { input.value = initial; query = initial; kind = null; }
    input.focus(); input.select();
    if (query.trim()) run(); else { list(); foot(); chips(); showDetail(null); api.worldSearch?.("a", { limit: 1 }).then((r) => { if (!query.trim() && isOpen()) { data = { index: r.index, limits: r.limits }; list(); foot(); } }).catch(() => {}); }
  }
  function close(restore = true) {
    if (!isOpen()) return;
    box.hidden = true;
    document.body.classList.remove("ws-open");
    if (restore && lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
    lastFocus = null;
  }
  // The shell must be ready (a character exists, no setup wizard) before search opens anything.
  const ready = () => Boolean(document.querySelector(".shell .rail")) && !document.body.classList.contains("setup-mode");
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
      if (!ready()) return;
      e.preventDefault();
      if (isOpen()) close(); else show();
    }
  });
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-world-search-open]") && ready()) show(); });
  return { railButton, show, close, go, isOpen, _state: () => ({ data, flat, at, kind, query, detail }) };
})();
