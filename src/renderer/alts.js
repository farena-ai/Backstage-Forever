"use strict";
// Characters → All characters (0.43, roadmap 3.7): every character at a glance and who to play
// tonight. Read-only: one `alts` request; "Play" switches the active character through the
// shell's own character picker.
window.AltsView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let data = null, error = "", loading = false, mountedFor = null;
  function coins(copper) {
    if (!Number.isSafeInteger(copper)) return `<span class="alt-muted">not seen yet</span>`;
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return `<span class="alt-coins">${g ? `<span class="alt-gold">${g.toLocaleString()}g</span> ` : ""}${s ? `<span class="alt-silver">${s}s</span> ` : ""}${c || (!g && !s) ? `<span class="alt-copper">${c}c</span>` : ""}</span>`;
  }
  const away = (c) => c.daysAway === null ? "never saved" : c.daysAway === 0 ? "saved today" : c.daysAway === 1 ? "saved yesterday" : `saved ${c.daysAway} days ago`;
  const portrait = (c) => { const src = PageHero.portrait(c); return src ? `<img class="alt-portrait" src="${esc(src)}" alt="" width="64" height="64">` : `<span class="alt-portrait alt-blank" aria-hidden="true"></span>`; };
  function xpBar(c) {
    if (c.level >= 60) return `<p class="alt-line"><strong>Level 60</strong>, the top.</p>`;
    if (!c.xp) return `<p class="alt-line alt-muted">Experience shows after the next save.</p>`;
    const rested = c.rested ? Math.min(100 - c.xp.percent, c.rested.percent) : 0;
    return `<div class="alt-xp" role="img" aria-label="${c.xp.percent}% through level ${c.level}${c.rested ? `, ${c.rested.percent}% of a level rested` : ""}"><span class="alt-xp-fill" data-w="${c.xp.percent}"></span><span class="alt-xp-rest" data-l="${c.xp.percent}" data-w="${rested}"></span></div>
      <p class="alt-line">${c.xp.percent}% through level ${c.level}${c.rested ? ` · <strong>${c.rested.known ? "" : "up to "}${c.rested.percent}%</strong> rested${c.rested.full ? " (full)" : ""}${c.rested.known ? "" : ` <small>(at least ${c.rested.lowPercent}% if they logged out outside an inn)</small>`}` : ""}</p>`;
  }
  function cardHtml(c) {
    const prof = c.professions.length ? c.professions.map((p) => `${esc(p.name)} ${p.rank}/${p.maxRank}`).join(" · ") : "No professions seen yet";
    return `<li class="alt-card${c.active ? " active" : ""}" data-alt="${esc(c.profileId)}">
      <div class="alt-head">${portrait(c)}<div><h3>${esc(c.name)}</h3><p>Level ${esc(c.level ?? "?")} ${esc([c.race, c.className].filter(Boolean).join(" "))}${c.faction ? ` · <span class="alt-${esc(c.faction.toLowerCase())}">${esc(c.faction)}</span>` : ""}</p><small>${esc(c.realm)}${c.zone ? ` · ${esc(c.zone)}` : ""} · ${esc(away(c))}</small></div></div>
      ${xpBar(c)}
      <dl class="alt-facts"><div><dt>Gold</dt><dd>${coins(c.money)}</dd></div><div><dt>Bags</dt><dd>${c.bags ? `${c.bags.free} free of ${c.bags.total}` : `<span class="alt-muted">not seen yet</span>`}</dd></div></dl>
      <p class="alt-line alt-prof">${prof}</p>
      ${c.active ? `<p class="alt-now">Playing now</p>` : `<button type="button" class="alt-play" data-alt-play="${esc(c.profileId)}">Switch to ${esc(c.name)}</button>`}</li>`;
  }
  function tonight(d) {
    if (!d.tonight.length) return `<p class="alt-empty">Nothing stands out tonight: play whoever you like. Rested XP, levels close to riding and long breaks show up here.</p>`;
    const [best, ...rest] = d.tonight;
    return `<div class="alt-tonight"><div><span class="alt-eyebrow">Tonight</span><h2>Play ${esc(best.name)}</h2><p>${best.reasons.map(esc).join("; ")}.</p></div>
      ${rest.length ? `<ul>${rest.map((s) => `<li><strong>${esc(s.name)}</strong>: ${s.reasons.map(esc).join("; ")}.</li>`).join("")}</ul>` : ""}</div>`;
  }
  function body() {
    if (error) return `<p class="alt-empty">${esc(error)}</p>`;
    if (!data) return `<p class="alt-empty">${loading ? "Reading your characters…" : "Log in with the addon to add your first character."}</p>`;
    if (!data.cards.length) return `<p class="alt-empty">No characters yet. Log in with the addon and type <code>/reload</code> once.</p>`;
    return `${tonight(data)}<div class="alt-summary"><div><strong>${data.totals.characters}</strong><span>characters</span></div><div><strong>${coins(data.totals.money)}</strong><span>gold seen, all together</span></div><div><strong>${data.totals.maxLevel}</strong><span>at level 60</span></div></div>
      <ul class="alt-grid">${data.cards.map(cardHtml).join("")}</ul>
      <p class="alt-note">Rested XP keeps growing while you're logged out: about 5% of a level every 8 hours in an inn or city, a quarter of that elsewhere, up to 150%. Gold and bags are as the addon last saw them.</p>`;
  }
  function page() {
    return `<section class="alts-page" data-alts>${PageHero.render({ art: "characters", eyebrow: "Characters · All characters", title: "All characters", subtitle: "Everyone at a glance, and who to play tonight." })}
      <div data-alts-body>${body()}</div></section>`;
  }
  function sizes(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of root.querySelectorAll("[data-l]")) el.style.left = `${Number(el.dataset.l)}%`;
  }
  async function load() {
    if (loading) return; loading = true;
    try { data = await api.alts(); error = ""; } catch (e) { error = e.message || "Your characters are unavailable."; }
    loading = false;
    const root = document.querySelector("[data-alts]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-alts]");
    if (!root || mountedFor === root) return;
    mountedFor = root; sizes(root);
    root.addEventListener("click", (event) => {
      const id = event.target.closest?.("[data-alt-play]")?.dataset.altPlay;
      const pick = document.getElementById("active-character");
      if (!id || !pick) return;
      pick.value = id; data = null;
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (!data && !loading) load();
  }
  return { page, mounted, invalidate: () => { data = null; }, _state: () => ({ data }) };
})();
