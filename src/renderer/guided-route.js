"use strict";
// Adventure → Guided route (0.50, roadmap 4.1): your race's step-by-step route from the bundled data,
// where you are on it (from your last save), the next steps, and how far every race's route reaches.
// In game: /bf route guide. Read-only: one `guidedRoute` request.
window.GuidedRouteView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { pickup: "Pick up", class: "Class quest", objective: "Objectives", turnin: "Hand in", travel: "Travel" };
  let data = null, error = "", loading = false, mountedFor = null;
  // 0.51: the hand review. review = { race, page, data } while the review panel is open.
  let review = null, reviewBusy = false, reviewNote = "";
  const gapText = (g) => g.map((x) => `${x.from}–${x.to}`).join(", ");
  function coverage(rows) {
    return `<table class="gr-cov"><thead><tr><th>Race</th><th>Starts in</th><th>Levels covered</th><th>Steps</th><th>Not covered yet</th><th>Reviewed</th></tr></thead><tbody>${rows.map((r) => `<tr class="gr-${esc(r.faction.toLowerCase())}"><td>${esc(r.race)}</td><td>${esc(r.start)}</td><td>${r.from ?? "–"}–${r.to}</td><td>${r.steps}</td><td>${r.gaps.length || r.to < 60 ? esc([gapText(r.gaps), r.to < 60 ? `${r.to + 1}–60` : ""].filter(Boolean).join(", ")) : "–"}</td><td>${r.reviewed} of ${r.steps}</td></tr>`).join("")}</tbody></table>`;
  }
  function body() {
    if (error) return `<p class="gr-empty">${esc(error)}</p>`;
    if (!data) return `<p class="gr-empty">${loading ? "Reading the route…" : "Choose a character in Characters."}</p>`;
    const d = data, r = d.route;
    const intro = `<p class="gr-how">In WoW, type <code>/bf route guide</code>: the scroll shows one step at a time, the game's arrow points at it, and it moves on as you pick up and hand in quests. <code>/bf route skip</code> skips a step; if you're well ahead of a step's level the guide moves past it, and if you're behind it says so. Where the route ends, <code>/bf route</code> shows the quests in your zone and Now suggests where to level.</p>`;
    if (!r) return `${intro}<p class="gr-empty">${d.character ? `No guided route for ${esc(d.character.race || "this character's race")} yet.` : "Log in with the addon to see your route."}</p><section class="gr-card"><h2>How far each route reaches</h2>${coverage(d.coverage)}</section>`;
    const p = d.position, pct = r.total ? Math.round(((p.ended ? r.total : p.index) / r.total) * 100) : 0;
    const steps = p.ended ? `<p class="gr-empty">You've reached the end of the guided route for now (level ${r.to}). The zone guide and Now take over from here.</p>`
      : `<ol class="gr-steps" start="${p.index + 1}">${d.upcoming.map((s) => `<li class="gr-step gr-${esc(s.kind)}"><span class="gr-kind">${esc(KIND[s.kind] || s.kind)} · level ${s.level}${s.approved ? ' · <em title="Hand-reviewed">✓ reviewed</em>' : ""}</span><strong>${esc(s.text)}</strong>${s.mapName ? `<small>${esc(s.mapName)}${Number.isFinite(s.x) ? ` · ${(s.x * 100).toFixed(1)}, ${(s.y * 100).toFixed(1)}` : ""}</small>` : ""}${s.mapId && Number.isFinite(s.x) ? `<button type="button" class="gr-map" data-map-zone="${s.mapId}">Map</button>` : ""}</li>`).join("")}</ol>`;
    return `${intro}<div class="gr-summary"><div><strong>${esc(r.race)}</strong><span>from ${esc(r.start)}</span></div><div><strong>${p.ended ? r.total : p.index + 1} / ${r.total}</strong><span>step</span></div><div><strong>${r.from}–${r.to}</strong><span>levels covered</span></div><div><strong>${pct}%</strong><span>of the route behind you</span></div></div>
      <div class="gr-bar" role="img" aria-label="${pct}% of the route done"><span data-w="${pct}"></span></div>
      ${r.gaps.length ? `<p class="gr-note">Not covered yet for ${esc(r.race)}: levels ${esc(gapText(r.gaps))}. Do the quests around you there (/bf route zone); the route picks up again after.</p>` : ""}
      <section class="gr-card"><h2>Your next steps</h2>${steps}<p class="gr-note">Worked out from your last save${d.character.level ? ` (level ${d.character.level})` : ""}. In game the guide follows you live. Zones on this route: ${esc(r.zones.join(", "))}.</p></section>
      <section class="gr-card"><h2>How far each route reaches</h2>${coverage(d.coverage)}<p class="gr-note">Routes are built from the quest data we have and grow as community data and your own play fill the gaps: each quest you accept teaches the app where its giver stands, so routes past level 42 fill in as your characters play there. Steps marked reviewed have been checked by hand.</p></section>`;
  }
  function reviewPanel() {
    if (!review) return `<section class="gr-card gr-review-closed"><h2>Review the routes</h2><p>Go through any race's route step by step: ✓ keeps a step, ✗ leaves it out, ↑ ↓ move it. Your review shows here at once; <strong>Export review</strong> saves it as <code>reviews.json</code>, and the next release builds it into the addon.</p><button type="button" class="gr-map" data-gr-review="open">Start reviewing</button></section>`;
    const r = review.data;
    if (!r) return `<section class="gr-card"><h2>Review the routes</h2><p>${reviewBusy ? "Reading the route…" : esc(reviewNote || "Choose a race.")}</p></section>`;
    const pager = `<span class="gr-pager"><button type="button" class="gr-map" data-gr-page="${r.page - 1}"${r.page ? "" : " disabled"}>‹ Earlier</button> page ${r.page + 1} of ${r.pages} <button type="button" class="gr-map" data-gr-page="${r.page + 1}"${r.page + 1 < r.pages ? "" : " disabled"}>Later ›</button></span>`;
    return `<section class="gr-card gr-review"><h2>Review the routes</h2>
      <div class="gr-review-bar"><label>Race <select data-gr-race>${r.races.map((x) => `<option${x === r.race ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      <span>${r.approved} kept · ${r.skipped} left out · ${r.total} steps</span>${pager}
      <button type="button" class="gr-map" data-gr-review="export">Export review</button><button type="button" class="gr-ghost" data-gr-review="close">Close</button></div>
      ${reviewNote ? `<p class="gr-note">${esc(reviewNote)}</p>` : ""}
      <ol class="gr-steps gr-review-list" start="${r.steps[0]?.n || 1}">${r.steps.map((s) => `<li class="gr-step gr-${esc(s.kind)}${s.approved ? " ok" : ""}${s.skipped ? " out" : ""}" data-gr-id="${esc(s.id)}"><span class="gr-kind">${esc(KIND[s.kind] || s.kind)} · level ${s.level}${s.approved ? " · ✓ kept" : ""}${s.skipped ? " · ✗ left out" : ""}</span><strong>${esc(s.text)}</strong>${s.mapName ? `<small>${esc(s.mapName)}${Number.isFinite(s.x) ? ` · ${(s.x * 100).toFixed(1)}, ${(s.y * 100).toFixed(1)}` : ""}</small>` : ""}
        <span class="gr-acts"><button type="button" title="Keep this step" aria-label="Keep step ${s.n}" data-gr-act="approve">✓</button><button type="button" title="Leave this step out" aria-label="Leave out step ${s.n}" data-gr-act="skip">✗</button><button type="button" title="Move up" aria-label="Move step ${s.n} up" data-gr-act="up">↑</button><button type="button" title="Move down" aria-label="Move step ${s.n} down" data-gr-act="down">↓</button>${s.approved || s.skipped ? `<button type="button" title="Undo" aria-label="Undo step ${s.n}" data-gr-act="clear">↺</button>` : ""}</span></li>`).join("")}</ol>${pager}</section>`;
  }
  async function loadReview(race, pageNo) {
    reviewBusy = true; paintReview();
    try { const d = await api.routeReview({ race, page: pageNo }); review = { race: d?.race || race, page: d?.page ?? pageNo, data: d }; } catch (e) { reviewNote = e.message || "The review is unavailable."; }
    reviewBusy = false; paintReview();
  }
  function paintReview() { const el = document.querySelector("[data-gr-review-slot]"); if (el) el.innerHTML = reviewPanel(); }
  function page() {
    return `<section class="guided-route-page" data-guided-route>${PageHero.render({ art: "quests", eyebrow: "Adventure · Guided route", title: "Your route, step by step", subtitle: "Every quest from level 1 in order: pick up, do, hand in, then on to the next zone." })}
      <div data-guided-route-body>${body()}</div><div data-gr-review-slot>${reviewPanel()}</div></section>`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = (await api.guidedRoute()) || { character: null, route: null, coverage: [] }; error = ""; } catch (e) { error = e.message || "The guided route is unavailable."; }
    loading = false;
    const root = document.querySelector("[data-guided-route]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-guided-route]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    root.addEventListener("click", async (e) => {
      const open = e.target.closest?.("[data-gr-review]")?.dataset.grReview;
      if (open === "open") { reviewNote = ""; return loadReview(data?.route?.race || "Human", 0); }
      if (open === "close") { review = null; reviewNote = ""; return paintReview(); }
      if (open === "export") { try { const ok = await api.exportRouteReview(); reviewNote = ok ? "Review exported. Put the file in data/forever-route/reviews.json for the next release." : ""; } catch (err) { reviewNote = err.message || "Export failed."; } return paintReview(); }
      const pg = e.target.closest?.("[data-gr-page]")?.dataset.grPage;
      if (pg !== undefined && review) return loadReview(review.race, Number(pg));
      const act = e.target.closest?.("[data-gr-act]")?.dataset.grAct, id = e.target.closest?.("[data-gr-id]")?.dataset.grId;
      if (act && id && review && !reviewBusy) {
        try { await api.setRouteReview({ race: review.race, id, action: act }); reviewNote = ""; data = null; } catch (err) { reviewNote = err.message || "That change could not be saved."; }
        return loadReview(review.race, review.page);
      }
    });
    root.addEventListener("change", (e) => { if (e.target.matches?.("[data-gr-race]")) loadReview(e.target.value, 0); });
    if (!data && !loading) load();
  }
  return { page, mounted, invalidate: () => { data = null; }, _state: () => ({ data }) };
})();
