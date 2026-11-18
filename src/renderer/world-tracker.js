"use strict";
// Adventure → Zones (0.46, roadmap 3.2): every zone for your faction from 1 to 60, coloured by
// level band, with a progress ring per zone ("Durotar 18/22 quests") and a badge for finished
// zones. Read-only: one `worldTracker` request. A tile opens that zone on the World Map.
window.WorldTrackerView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CONTINENT = { kalimdor: "Kalimdor", "eastern-kingdoms": "Eastern Kingdoms" };
  const FIT = { now: "Your level", soon: "Soon", later: "Later", done: "Below you", unknown: "" };
  let data = null, error = "", loading = false, mountedFor = null;
  function ring(z) {
    const r = 22, c = 2 * Math.PI * r, f = z.total ? z.done / z.total : 0;
    return `<svg class="wt-ring" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true"><circle cx="28" cy="28" r="${r}" class="wt-ring-bg"/><circle cx="28" cy="28" r="${r}" class="wt-ring-fg" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle">${z.total ? `${z.percent}%` : "–"}</text></svg>`;
  }
  function tile(z) {
    const label = `${z.name}: ${z.total ? `${z.done} of ${z.total} quests done` : "no quests recorded"}, levels ${z.min} to ${z.max}${z.mastered ? ", finished" : ""}`;
    return `<li><button type="button" class="wt-zone wt-band-${esc(z.band)} wt-fit-${esc(z.fit)}${z.mastered ? " mastered" : ""}" data-map-zone="${z.mapId}" aria-label="${esc(label)}">
      ${ring(z)}<span class="wt-words"><strong>${esc(z.name)}</strong><span>${z.min}–${z.max}${z.faction === "Contested" ? " · contested" : ""}</span><span>${z.total ? `${z.done}/${z.total} quests` : "no quests recorded"}${z.inLog ? ` · ${z.inLog} in your log` : ""}</span>${FIT[z.fit] ? `<em>${esc(FIT[z.fit])}</em>` : ""}</span>
      ${z.mastered ? `<span class="wt-badge" title="Zone finished: 90% of its quests done">★</span>` : z.visited ? `<span class="wt-visited" title="You've been here">◆</span>` : ""}</button></li>`;
  }
  function body() {
    if (error) return `<p class="wt-empty">${esc(error)}</p>`;
    if (!data) return `<p class="wt-empty">${loading ? "Reading the world…" : "Choose a character in Characters."}</p>`;
    if (!data.character) return `<p class="wt-empty">Log in with the addon to see your zones.</p>`;
    const t = data.totals;
    return `<div class="wt-summary"><div><strong>${t.done}</strong><span>of ${t.total} quests done</span></div><div><strong>${t.mastered}</strong><span>zones finished</span></div><div><strong>${t.visited}</strong><span>of ${t.zones} zones visited</span></div></div>
      ${data.suggestion ? `<p class="wt-next">Next zone to clear: <button type="button" class="now-link" data-map-zone="${data.suggestion.mapId}">${esc(data.suggestion.name)}</button>, ${data.suggestion.left} quests left at your level band.</p>` : ""}
      ${data.completedKnown ? "" : `<p class="wt-note">Finished quests show after your next save with the addon (type <code>/reload</code> once).</p>`}
      <ul class="wt-legend" aria-label="Level bands">${["1-10", "10-20", "20-30", "30-40", "40-50", "50-60"].map((b) => `<li class="wt-band-${b}">${b.replace("-", "–")}</li>`).join("")}</ul>
      ${data.continents.map((c) => `<section class="wt-continent"><h2>${esc(CONTINENT[c.id] || c.id)}</h2><ul class="wt-grid">${c.zones.map(tile).join("")}</ul></section>`).join("")}`;
  }
  function page() {
    return `<section class="world-tracker-page" data-world-tracker>${PageHero.render({ art: "adventure", eyebrow: "Adventure · Zones", title: "Your world, 1 to 60", subtitle: "Every zone for your faction, how many of its quests you've done, and the ones you've finished." })}
      <div data-world-tracker-body>${body()}</div></section>`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.worldTracker(); error = ""; } catch (e) { error = e.message || "The world tracker is unavailable."; }
    loading = false;
    const root = document.querySelector("[data-world-tracker]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-world-tracker]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    if (!data && !loading) load();
  }
  // 1.5 (J21): a zone you just finished gets a celebration once (per character, on this computer).
  function announce(d) {
    const zones = (d?.zones || []).filter((z) => z.mastered);
    const id = d?.profileId || d?.character?.id || d?.name || "active";
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem("bf-zones-done") || "{}"); } catch {}
    const before = new Set(seen[id] || []), fresh = zones.filter((z) => !before.has(z.mapId));
    if (seen[id] && fresh.length && window.JourneyView?.celebrate) window.JourneyView.celebrate({ img: "art/badges/explorer-15.png", kicker: "Zone finished", title: fresh[0].name, line: `${fresh[0].done} of ${fresh[0].total} quests done.${fresh.length > 1 ? ` And ${fresh.length - 1} more zone${fresh.length > 2 ? "s" : ""}.` : ""}`, big: true, nav: "zones" });
    seen[id] = zones.map((z) => z.mapId);
    try { localStorage.setItem("bf-zones-done", JSON.stringify(seen)); } catch {}
  }
  const check = () => api.worldTracker?.().then(announce).catch(() => {});
  return { page, mounted, check, _announce: announce, invalidate: () => { data = null; }, _state: () => ({ data }) };
})();
