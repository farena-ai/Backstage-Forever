"use strict";
// Browse saved milestones for one character at a time, alongside separate account milestones.
window.BadgesView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (t) => (window.I18n?.when ? window.I18n.when(t * 1000, "date") : new Date(t * 1000).toLocaleString());
  let data = null, error = "", chosen = null, show = "all", category = "", query = "", mountedFor = null, focus = null, request = 0;
  const validKey = (v) => typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v) ? v : null;
  const artKeys = (b) => [...new Set([validKey(b.art), validKey(b.id)].filter(Boolean))];
  const artPath = (key) => `art/badges/${key}.png`;
  const fallbackArt = "art/badge-level.webp";
  function art(b, size) {
    const [key, backup] = artKeys(b);
    return `<img src="${key ? artPath(key) : fallbackArt}"${key ? ` data-badge-art="${backup || ""}"` : ""} alt="" width="${size}" height="${size}">`;
  }

  function badge(b, holders = []) {
    const others = holders.filter((n) => n !== data?.character?.name);
    const pct = b.progress ? Math.round((b.progress.have / b.progress.need) * 100) : 0;
    return `<li class="bd-badge${b.earned ? " earned" : ""}${focus === b.id ? " focus" : ""}" data-badge="${esc(b.id)}" tabindex="-1" aria-label="${esc(b.name)}, ${b.earned ? "earned" : "not earned yet"}. ${esc(b.how)}">
      ${art(b, 96)}<strong>${esc(b.name)}</strong>
      <span class="bd-how">${esc(b.how)}${b.desktopOnly ? '<small class="bd-scope">Desktop only</small>' : ""}</span>
      ${b.earned ? `<span class="bd-when">${b.at ? `Earned ${esc(day(b.at))}` : "Earned"}</span>` : b.progress ? `<span class="bd-prog" role="progressbar" aria-label="Progress toward ${esc(b.name)}" aria-valuemin="0" aria-valuemax="${Number(b.progress.need)}" aria-valuenow="${Number(b.progress.have)}"><span data-w="${pct}"></span></span><small>${Number(b.progress.have).toLocaleString()} / ${Number(b.progress.need).toLocaleString()}</small>` : `<span class="bd-when locked">${b.progressUnavailable ? "No saved progress" : "Not yet"}</span>`}
      ${b.questSteps ? `<ol class="bd-quest-steps" aria-label="Quest steps in this save">${b.questSteps.map(step => `<li><span>${esc(step.title)}</span> — <small>${step.confirmed ? "Confirmed in save" : "Not confirmed in save"}</small></li>`).join("")}</ol>` : ""}
      ${b.earned && window.ShareCard ? ShareCard.button("badge", { id: b.id, art: artKeys(b)[0] || null, name: b.name, how: b.how, at: b.at || null, earned: data?.book?.earned ?? null, total: data?.book?.total ?? null }, "Share", data?.character?.id ?? null) : ""}
      ${others.length ? `<small class="bd-also" title="${esc(others.join(", "))}">Also: ${esc(others.slice(0, 3).join(", "))}${others.length > 3 ? ` +${others.length - 3}` : ""}</small>` : ""}</li>`;
  }
  function chooser(d) {
    if (d.characters.length < 2) return "";
    return `<nav class="bd-chars" aria-label="Choose a character">${d.characters.map((c) => `<button type="button" class="bd-char${c.active ? " active" : ""}" data-badge-char="${esc(c.id)}" aria-pressed="${c.active}">
      ${PageHero.classCrest(c.className) ? `<img src="${PageHero.classCrest(c.className)}" alt="" width="28" height="28">` : ""}<span><strong>${esc(c.name)}</strong><small>${c.level ? `Level ${c.level} · ` : ""}${c.earned} of ${c.total}</small></span></button>`).join("")}</nav>`;
  }
  function filters() {
    return `<div class="bd-tools"><label>Search character badges<input type="search" data-badge-search maxlength="120" value="${esc(query)}" placeholder="Name or requirement"></label>
      <div class="bd-category"><label for="bd-category">Category</label><select id="bd-category" data-badge-category><option value="">All categories</option>${data.groups.map((g) => `<option value="${esc(g)}"${category === g ? " selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
      <div class="bd-filter" role="group" aria-label="Show badges">${[["all", "All"], ["earned", "Earned"], ["locked", "Still to earn"]].map(([k, l]) => `<button type="button" data-badge-show="${k}" aria-pressed="${show === k}">${l}</button>`).join("")}</div>
      <button type="button" class="bd-clear" data-badge-clear${query || category || show !== "all" ? "" : " hidden"}>Clear filters</button></div>`;
  }
  function collection() {
    const search = query.trim().toLocaleLowerCase();
    const pick = (b) => (show === "all" || b.earned === (show === "earned")) &&
      (!search || `${b.name} ${b.how} ${b.group}`.toLocaleLowerCase().includes(search));
    const groups = data.groups.filter((g) => !category || g === category).flatMap((g) => {
      const all = data.book.badges.filter((b) => b.group === g);
      const visible = all.filter(pick);
      return visible.length ? [{ g, all, visible }] : [];
    });
    return { count: groups.reduce((n, { visible }) => n + visible.length, 0), html: groups.length ? groups.map(({ g, all, visible }) =>
      `<h3 class="bd-group">${esc(g)} <small>${all.filter((b) => b.earned).length} / ${all.length} earned</small></h3><ul class="bd-badges">${visible.map((b) => badge(b, data.holders[b.id] || [])).join("")}</ul>`).join("") :
      `<p class="bd-empty">No character badges match these filters.</p>` };
  }
  const countLabel = (count) => `${count} of ${data.book.total} character badges shown`;
  const clearFilters = () => { show = "all"; category = ""; query = ""; };
  const summaryRow = (b, detail) => `<li><button type="button" data-badge-jump="${esc(b.id)}">${art(b, 40)}<span><strong>${esc(b.name)}</strong><small>${esc(detail)}${b.desktopOnly ? " · Desktop only" : ""}</small></span></button></li>`;

  function body() {
    const notice = error ? `<div class="bd-notice"><p role="status">${esc(error)}</p><button type="button" class="bd-picture" data-badge-retry>Retry</button></div>` : "";
    if (!data) return notice || `<p class="bd-empty" role="status">Opening your Badge Case… Badges appear once a character has been saved.</p>`;
    const d = data;
    if (!d.book) return `${notice}<p class="bd-empty">No characters yet. Log in with the addon on and type <code>/reload</code>: your character and its badges appear here.</p>`;
    const pct = d.book.total ? Math.round((d.book.earned / d.book.total) * 100) : 0;
    const results = collection();
    return `${notice}${chooser(d)}<div class="bd-summary">
        <div class="bd-overview"><h2>Collection</h2><div class="bd-ring" data-pct="${pct}" role="img" aria-label="${d.book.earned} of ${d.book.total} character badges earned"><strong>${d.book.earned}</strong><span>of ${d.book.total} earned</span></div></div>
        <div class="bd-latest"><h2>Recently earned</h2>${d.recent.length ? `<ul>${d.recent.map((b) => summaryRow(b, day(b.at))).join("")}</ul>` : `<p>No dated badges yet. Undated milestones still count in your collection.</p>`}</div>
        <div class="bd-next"><h2>Closest next</h2>${d.next.length ? `<ul>${d.next.map((b) => summaryRow(b, `${b.progress.have.toLocaleString()} / ${b.progress.need.toLocaleString()} · ${b.how}`)).join("")}</ul>` : `<p>${d.book.earned === d.book.total ? "Every badge earned. Well played!" : "Progress toward a badge will show up here."}</p>`}</div>
      </div>
      <section class="bd-card"><div class="bd-card-head"><h2>${esc(d.character.name)}'s badges</h2><button type="button" class="bd-picture" data-badge-picture>Share picture</button></div>
        <p class="bd-count">In WoW, type <code>/bf badges pin</code> to see eligible Compass goals: levels, exploration, and gold. Desktop-only badges aren’t available in the addon.</p>
        ${filters()}<p class="bd-count" role="status" data-badge-count>${countLabel(results.count)}</p><div data-badge-results>${results.html}</div>
      </section>
      <section class="bd-card"><div class="bd-card-head"><h2>Account badges</h2><small>${d.account.earned} of ${d.account.total} · earned by all your characters together</small></div>
        <ul class="bd-badges">${d.account.badges.map((b) => badge(b)).join("")}</ul>
        <p class="bd-foot">Across ${d.characters.length} character${d.characters.length === 1 ? "" : "s"}: ${d.totals.earned} badges earned, ${d.totals.unique} of ${d.totals.kinds} kinds held by someone.</p>
      </section>`;
  }
  function content() {
    const c = data?.character;
    return `${PageHero.render({ art: "badges", compact: true, eyebrow: "Characters · Badges", title: esc(c ? `${c.name}'s Badge Case` : "Badge Case"), titleAttrs: 'tabindex="-1"', crest: PageHero.classCrest(c?.className), subtitle: "Milestones from your character's saved journal." })}<div data-badges-body>${body()}</div>`;
  }
  const page = () => `<section class="badges-page" data-badges>${content()}</section>`;
  function sizes(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of root.querySelectorAll(".bd-ring[data-pct]")) el.style.setProperty("--pct", `${Number(el.dataset.pct)}%`);
  }
  function jumpTo(root, id) {
    const tile = root.querySelector(`[data-badge="${CSS.escape(id)}"]`);
    tile?.focus({ preventScroll: true });
    tile?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  function redrawResults(root) {
    const results = collection();
    const list = root.querySelector("[data-badge-results]");
    list.innerHTML = results.html; // collection() escapes names, requirements, and IDs.
    sizes(list);
    root.querySelector("[data-badge-count]").textContent = countLabel(results.count);
    root.querySelector("[data-badge-clear]").hidden = !query && !category && show === "all";
    root.querySelector("[data-badge-search]").value = query;
    root.querySelector("[data-badge-category]").value = category;
    for (const button of root.querySelectorAll("[data-badge-show]")) button.setAttribute("aria-pressed", String(show === button.dataset.badgeShow));
  }
  async function load(root) {
    const seq = ++request;
    const current = () => seq === request && document.querySelector("[data-badges]") === root;
    let next, message = "";
    try { next = await api.badges(chosen); }
    catch { message = "Your badges could not be refreshed."; }
    if (!current()) return;
    if (next && !focus && !error && JSON.stringify(next) === JSON.stringify(data)) return;
    const active = document.activeElement;
    const control = active?.closest("[data-badges]") === root && [...active.attributes].find((a) => a.name.startsWith("data-badge"));
    const selection = control?.name === "data-badge-search" ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    if (next) { data = next; if (!next.groups.includes(category)) category = ""; }
    error = message;
    // Template values from the book are escaped and image names are constrained by validKey().
    root.outerHTML = page();
    root = document.querySelector("[data-badges]");
    attach(root);
    if (focus && next) { jumpTo(root, focus); focus = null; }
    else if (control) {
      const target = root.querySelector(`[${control.name}="${CSS.escape(control.value)}"]`) || root.querySelector("h1");
      target?.focus({ preventScroll: true });
      if (selection) target?.setSelectionRange?.(...selection);
    }
  }

  function attach(root) {
    if (mountedFor === root) return;
    mountedFor = root; sizes(root);
    root.addEventListener("error", (ev) => {
      const img = ev.target, backup = img.dataset?.badgeArt;
      if (backup === undefined) return;
      if (backup) img.dataset.badgeArt = "";
      else delete img.dataset.badgeArt;
      img.src = backup ? artPath(backup) : fallbackArt;
    }, true);
    root.addEventListener("input", (ev) => {
      if (!ev.target.matches("[data-badge-search]")) return;
      query = ev.target.value; focus = null; redrawResults(root);
    });
    root.addEventListener("change", (ev) => {
      if (!ev.target.matches("[data-badge-category]")) return;
      category = ev.target.value; focus = null; redrawResults(root);
    });
    root.addEventListener("click", (ev) => {
      const ch = ev.target.closest("[data-badge-char]"), sh = ev.target.closest("[data-badge-show]"), jump = ev.target.closest("[data-badge-jump]");
      if (ev.target.closest("[data-badge-picture]")) { picture(); return; }
      if (ev.target.closest("[data-badge-retry]")) { load(root); return; }
      if (ch) { chosen = ch.dataset.badgeChar; focus = null; load(root); }
      else if (sh) { show = sh.dataset.badgeShow; focus = null; redrawResults(root); }
      else if (jump) { focus = jump.dataset.badgeJump; clearFilters(); redrawResults(root); jumpTo(root, focus); focus = null; }
      else if (ev.target.closest("[data-badge-clear]")) { clearFilters(); focus = null; redrawResults(root); root.querySelector("[data-badge-search]").focus(); }
    });
  }
  function mounted() {
    const root = document.querySelector("[data-badges]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    attach(root);
    // A shell redraw also happens after a fresh game save. Filter edits only redraw the results.
    load(root);
  }
  // J27 (1.6), S9: a painted picture of this character's earned badges. The share window paints it
  // (share-card.js), with Copy picture and Save picture; the name is on it only when ticked.
  function picture() {
    const d = data;
    if (!d?.book) return;
    const earned = d.book.badges.filter((b) => b.earned);
    window.ShareCard?.open({ kind: "badges", profileId: d.character.id, data: { earned: d.book.earned, total: d.book.total, badges: earned.map((b) => ({ id: b.id, art: artKeys(b)[0] || null, name: b.name })) } });
  }
  // Opened from the new-badge banner: that character, that badge.
  function invalidate() { request++; data = null; error = ""; }
  function open(profileId, badgeId) { chosen = profileId || null; focus = badgeId || null; clearFilters(); invalidate(); }
  return { page, mounted, open, invalidate, _state: () => ({ data, chosen, show, focus }) };
})();
