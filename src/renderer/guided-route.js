"use strict";
// Adventure → Guided route (0.50, roadmap 4.1): your race's step-by-step route from the bundled data,
// where you are on it (from your last save), the next steps, and how far every race's route reaches.
// In game: /bf route guide. Read-only: one `guidedRoute` request.
window.GuidedRouteView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { pickup: "Pick up", class: "Class quest", objective: "Objectives", turnin: "Hand in", travel: "Travel" };
  let data = null, error = "", loading = false, mountedFor = null;
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
      <section class="gr-card"><h2>How far each route reaches</h2>${coverage(d.coverage)}<p class="gr-note">Routes are built from the quest data we have and grow as community data and your own play fill the gaps. Steps marked reviewed have been checked by hand.</p></section>`;
  }
  function page() {
    return `<section class="guided-route-page" data-guided-route>${PageHero.render({ art: "quests", eyebrow: "Adventure · Guided route", title: "Your route, step by step", subtitle: "Every quest from level 1 in order: pick up, do, hand in, then on to the next zone." })}
      <div data-guided-route-body>${body()}</div></section>`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.guidedRoute(); error = ""; } catch (e) { error = e.message || "The guided route is unavailable."; }
    loading = false;
    const root = document.querySelector("[data-guided-route]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-guided-route]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    if (!data && !loading) load();
  }
  return { page, mounted, invalidate: () => { data = null; }, _state: () => ({ data }) };
})();
