"use strict";
// Characters → Journey: a painted badge wall, speed splits per level and the rested planner.
window.JourneyView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let data = null, error = "", loading = false, mountedFor = null;
  const dur = (s) => { if (!Number.isFinite(s)) return "?"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
  const day = (t) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  function badges(b) {
    const groups = [...new Set(b.badges.map((x) => x.group))];
    return groups.map((g) => `<h3 class="jr-group">${esc(g)}</h3><ul class="jr-badges">${b.badges.filter((x) => x.group === g).map((x) => `<li class="jr-badge${x.earned ? " earned" : ""}" title="${esc(x.how)}">
      <img src="art/badges/${esc(x.id)}.png" alt="" width="96" height="96"><strong>${esc(x.name)}</strong>
      <span>${x.earned ? (x.at ? `Earned ${esc(day(x.at))}` : "Earned") : esc(x.how)}</span>
      ${!x.earned && x.progress ? `<span class="jr-prog"><span data-w="${Math.round((x.progress.have / x.progress.need) * 100)}"></span></span><small>${x.progress.have} / ${x.progress.need}</small>` : ""}</li>`).join("")}</ul>`).join("");
  }
  function splits(d) {
    if (!d.splits.length) return `<p class="jr-empty">${d.hasJournal ? "Gain a level with the addon running and your time for each level shows up here, with your best times." : "Log in and type <code>/reload</code> once with the 0.28 addon: from then on each level's /played time is recorded."}</p>`;
    const max = Math.max(...d.splits.map((s) => s.seconds));
    return `<ol class="jr-splits">${d.splits.slice(-20).map((s) => `<li${s.personalBest ? ' class="best"' : ""}><span class="jr-lv">${s.level}→${s.level + 1}</span><span class="jr-bar"><span data-w="${Math.max(3, Math.round((s.seconds / max) * 100))}"></span>${s.best && !s.personalBest ? `<i data-l="${Math.round((s.best.seconds / max) * 100)}" title="Best: ${esc(dur(s.best.seconds))} by ${esc(s.best.name)}"></i>` : ""}</span><span class="jr-time">${esc(dur(s.seconds))}${s.personalBest ? ' <em>best</em>' : s.best ? ` <small>best ${esc(dur(s.best.seconds))}</small>` : ""}</span></li>`).join("")}</ol>`;
  }
  function restedCard(r) {
    if (!r) return `<p class="jr-empty">Rested experience shows here once your character has been saved.</p>`;
    return `<div class="jr-rested"><div class="jr-moon" aria-hidden="true"></div><div><p><strong>${r.percentOfLevel}% of a level</strong> rested right now${r.xp ? ` (${r.xp.toLocaleString()} XP)` : ""}.</p>
      <p>Logging out in an inn or a city adds about <strong>${r.perNight}% of a level every 8 hours</strong>, up to ${r.capPercent}%. ${r.hoursToCap ? `About ${r.hoursToCap} hours offline in an inn fills it.` : "You're full: spend it!"}</p>
      <p class="jr-tip">Rested kills give double experience until the bonus runs out.</p></div></div>`;
  }
  function body() {
    if (error) return `<p class="jr-empty">${esc(error)}</p>`;
    if (!data) return `<p class="jr-empty">${loading ? "Reading your journey…" : "Choose a character in Characters."}</p>`;
    const d = data;
    return `<div class="jr-summary"><div><strong>${d.badges.earned}</strong><span>of ${d.badges.total} badges</span></div><div><strong>${d.level ?? "?"}</strong><span>level</span></div><div><strong>${esc(d.played ? dur(d.played) : "?")}</strong><span>played</span></div><div><strong>${d.zones}</strong><span>zones visited</span></div></div>
      <section class="jr-card"><h2>Badges</h2>${badges(d.badges)}</section>
      <div class="jr-two"><section class="jr-card"><h2>Speed splits</h2>${splits(d)}</section><section class="jr-card"><h2>Rested planner</h2>${restedCard(d.rested)}</section></div>`;
  }
  function page() {
    const cls = String(data?.className || "").toLowerCase();
    return `<section class="journey-page" data-journey><header class="jr-hero">${cls ? `<img class="jr-crest" src="art/classes/${esc(cls)}.png" alt="" width="96" height="96">` : ""}<div><span class="jr-eyebrow">Characters · Journey</span><h1>${esc(data?.name || "Your journey")}</h1><p>Badges you've earned, how fast each level went, and your rested bonus.</p></div></header>
      <div data-journey-body>${body()}</div></section>`;
  }
  function sizes(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of root.querySelectorAll("[data-l]")) el.style.left = `${Number(el.dataset.l)}%`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.journey(); error = ""; } catch (e) { error = e.message || "Your journey is unavailable."; }
    loading = false;
    const root = document.querySelector("[data-journey]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
    announce(data);
  }
  // A newly earned badge gets its moment: a painted banner, once per badge per character.
  function announce(d) {
    if (!d?.badges) return;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem("bf-badges-seen") || "{}"); } catch {}
    const mine = new Set(seen[d.id] || []), fresh = d.badges.badges.filter((b) => b.earned && !mine.has(b.id));
    if (seen[d.id] && fresh.length) show(fresh[0], fresh.length);
    seen[d.id] = d.badges.badges.filter((b) => b.earned).map((b) => b.id);
    try { localStorage.setItem("bf-badges-seen", JSON.stringify(seen)); } catch {}
  }
  function show(b, n) {
    document.querySelector(".bf-badge-pop")?.remove();
    const el = document.createElement("div");
    el.className = "bf-badge-pop"; el.setAttribute("role", "status");
    el.innerHTML = `<img src="art/badges/${esc(b.id)}.png" alt="" width="120" height="120"><div><span>New badge${n > 1 ? `, and ${n - 1} more` : ""}</span><strong>${esc(b.name)}</strong><em>${esc(b.how)}</em></div>`;
    document.body.append(el);
    el.addEventListener("click", () => el.remove());
    setTimeout(() => el.classList.add("out"), 5200); setTimeout(() => el.remove(), 6000);
  }
  function mounted() {
    const root = document.querySelector("[data-journey]");
    if (!root || mountedFor === root) return;
    mountedFor = root; sizes(root);
    if (!data && !loading) load();
  }
  return { page, mounted, check: () => api.journey?.().then(announce).catch(() => {}), invalidate: () => { data = null; }, _state: () => ({ data }), _show: show };
})();
