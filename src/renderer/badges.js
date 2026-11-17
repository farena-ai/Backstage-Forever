"use strict";
// Characters → Badges (1.1): every badge a character has earned, kept to look back on. The new-badge
// banner only shows once; this page is where you see them all again, for any of your characters,
// with when each was earned, what's closest next, who else on the account has it, and account badges.
window.BadgesView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (t) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  let data = null, error = "", loading = false, chosen = null, show = "all", mountedFor = null, focus = null, loadedAt = 0;

  function badge(b, holders = []) {
    const others = holders.filter((n) => n !== data?.character?.name);
    const pct = b.progress ? Math.round((b.progress.have / b.progress.need) * 100) : 0;
    return `<li class="bd-badge${b.earned ? " earned" : ""}${focus === b.id ? " focus" : ""}" data-badge="${esc(b.id)}" tabindex="0" aria-label="${esc(b.name)}, ${b.earned ? "earned" : "not earned yet"}. ${esc(b.how)}">
      <img src="art/badges/${esc(b.id)}.png" alt="" width="96" height="96"><strong>${esc(b.name)}</strong>
      <span class="bd-how">${esc(b.how)}</span>
      ${b.earned ? `<span class="bd-when">${b.at ? `Earned ${esc(day(b.at))}` : "Earned"}</span>` : b.progress ? `<span class="bd-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${b.progress.need}" aria-valuenow="${b.progress.have}"><span data-w="${pct}"></span></span><small>${b.progress.have.toLocaleString()} / ${b.progress.need.toLocaleString()}</small>` : `<span class="bd-when locked">Not yet</span>`}
      ${others.length ? `<small class="bd-also" title="${esc(others.join(", "))}">Also: ${esc(others.slice(0, 3).join(", "))}${others.length > 3 ? ` +${others.length - 3}` : ""}</small>` : ""}</li>`;
  }
  function chooser(d) {
    if (d.characters.length < 2) return "";
    return `<nav class="bd-chars" aria-label="Choose a character">${d.characters.map((c) => `<button type="button" class="bd-char${c.active ? " active" : ""}" data-badge-char="${esc(c.id)}" aria-pressed="${c.active}">
      ${PageHero.classCrest(c.className) ? `<img src="${PageHero.classCrest(c.className)}" alt="" width="28" height="28">` : ""}<span><strong>${esc(c.name)}</strong><small>${c.level ? `Level ${c.level} · ` : ""}${c.earned} of ${c.total}</small></span></button>`).join("")}</nav>`;
  }
  function filters() {
    return `<div class="bd-filter" role="group" aria-label="Show badges">${[["all", "All"], ["earned", "Earned"], ["locked", "Still to earn"]].map(([k, l]) => `<button type="button" data-badge-show="${k}" aria-pressed="${show === k}"${show === k ? ' class="on"' : ""}>${l}</button>`).join("")}</div>`;
  }
  function body() {
    if (error) return `<p class="bd-empty">${esc(error)}</p>`;
    if (!data) return `<p class="bd-empty">${loading ? "Opening your badge case…" : "Badges appear once a character has been saved."}</p>`;
    const d = data;
    if (!d.book) return `<p class="bd-empty">No characters yet. Log in with the addon on and type <code>/reload</code>: your character and its badges appear here.</p>`;
    const pick = (b) => show === "earned" ? b.earned : show === "locked" ? !b.earned : true;
    const groups = d.groups.map((g) => [g, d.book.badges.filter((b) => b.group === g && pick(b))]).filter(([, l]) => l.length);
    const pct = Math.round((d.book.earned / d.book.total) * 100);
    return `<div class="bd-summary">
        <div class="bd-ring" data-pct="${pct}" aria-label="${d.book.earned} of ${d.book.total} badges earned"><strong>${d.book.earned}</strong><span>of ${d.book.total}</span></div>
        <div class="bd-latest"><h2>Latest</h2>${d.recent.length ? `<ul>${d.recent.map((b) => `<li><button type="button" data-badge-jump="${esc(b.id)}"><img src="art/badges/${esc(b.id)}.png" alt="" width="40" height="40"><span><strong>${esc(b.name)}</strong><small>${esc(day(b.at))}</small></span></button></li>`).join("")}</ul>` : `<p>Badges earned from now on are dated here.</p>`}</div>
        <div class="bd-next"><h2>Closest next</h2>${d.next.length ? `<ul>${d.next.map((b) => `<li><button type="button" data-badge-jump="${esc(b.id)}"><img src="art/badges/${esc(b.id)}.png" alt="" width="40" height="40"><span><strong>${esc(b.name)}</strong><small>${b.progress.have.toLocaleString()} / ${b.progress.need.toLocaleString()} · ${esc(b.how)}</small></span></button></li>`).join("")}</ul>` : `<p>${d.book.earned === d.book.total ? "Every badge earned. Well played!" : "Play on: progress shows up here."}</p>`}</div>
      </div>
      ${chooser(d)}
      <section class="bd-card"><div class="bd-card-head"><h2>${esc(d.character.name)}'s badges</h2>${filters()}</div>
        ${groups.length ? groups.map(([g, list]) => `<h3 class="bd-group">${esc(g)} <small>${list.filter((b) => b.earned).length} / ${d.book.badges.filter((b) => b.group === g).length}</small></h3><ul class="bd-badges">${list.map((b) => badge(b, d.holders[b.id] || [])).join("")}</ul>`).join("") : `<p class="bd-empty">${show === "earned" ? "None earned yet: the first ones come quickly." : "All earned here."}</p>`}
      </section>
      <section class="bd-card"><div class="bd-card-head"><h2>Account badges</h2><small>${d.account.earned} of ${d.account.total} · earned by all your characters together</small></div>
        <ul class="bd-badges">${d.account.badges.map((b) => badge(b)).join("")}</ul>
        <p class="bd-foot">Across ${d.characters.length} character${d.characters.length === 1 ? "" : "s"}: ${d.totals.earned} badges earned, ${d.totals.unique} of ${d.totals.kinds} kinds held by someone.</p>
      </section>`;
  }
  function page() {
    const c = data?.character;
    return `<section class="badges-page" data-badges>${PageHero.render({ art: "badges", eyebrow: "Characters · Badges", title: esc(c ? `${c.name}'s badge case` : "Badges"), crest: PageHero.classCrest(c?.className), subtitle: "Every badge you've earned, when you earned it, and what's closest next." })}
      <div data-badges-body>${body()}</div></section>`;
  }
  function sizes(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of root.querySelectorAll(".bd-ring[data-pct]")) el.style.setProperty("--pct", `${Number(el.dataset.pct)}%`);
  }
  function redraw() {
    const root = document.querySelector("[data-badges]");
    if (!root) return;
    root.outerHTML = page(); mountedFor = null; mounted();
    if (focus) document.querySelector(`[data-badge="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.badges(chosen); error = ""; loadedAt = Date.now(); } catch (e) { error = e.message || "Your badges are unavailable."; }
    loading = false; redraw();
  }
  function mounted() {
    const root = document.querySelector("[data-badges]");
    if (!root || mountedFor === root) return;
    mountedFor = root; sizes(root);
    root.addEventListener("click", (ev) => {
      const ch = ev.target.closest("[data-badge-char]"), sh = ev.target.closest("[data-badge-show]"), jump = ev.target.closest("[data-badge-jump]");
      if (ch) { chosen = ch.dataset.badgeChar; focus = null; load(); }
      else if (sh) { show = sh.dataset.badgeShow; redraw(); }
      else if (jump) { focus = jump.dataset.badgeJump; show = "all"; redraw(); }
    });
    // Fresh each visit (a /reload may have earned something), not on every redraw.
    if (!loading && ((!data && !error) || (data && Date.now() - loadedAt > 4000))) load();
  }
  // Opened from the new-badge banner: that character, that badge.
  function open(profileId, badgeId) { chosen = profileId || null; focus = badgeId || null; show = "all"; data = null; }
  return { page, mounted, open, invalidate: () => { data = null; }, _state: () => ({ data, chosen, show, focus }) };
})();
