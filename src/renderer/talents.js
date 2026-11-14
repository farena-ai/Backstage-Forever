"use strict";
// Characters → Talents: your real talent trees with a leveling path laid on top.
window.TalentsView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
  let data = null, error = "", who = null, preview = null, mountedFor = null, loading = false;
  const crest = (cls) => `<img class="tal-crest" src="art/classes/${esc(String(cls).toLowerCase())}.png" alt="" width="96" height="96">`;
  function tree(tab, c) {
    const now = new Map(), planned = new Map();
    for (const s of c.spentByNow) if (s.tab === tab.name) now.set(s.talentId, s.rank);
    for (const s of c.order) if (s.tab === tab.name) planned.set(s.talentId, s.rank);
    const next = c.next[0];
    const rows = Math.max(7, ...tab.talents.map((t) => t.row + 1));
    const cells = [];
    for (let r = 0; r < rows; r++) for (let col = 0; col < 4; col++) {
      const t = tab.talents.find((x) => x.row === r && x.column === col);
      if (!t) { cells.push(`<div class="tal-cell empty"></div>`); continue; }
      const have = now.get(t.id) || 0, plan = planned.get(t.id) || 0, isNext = next && next.talentId === t.id;
      const state = isNext ? "is-next" : have ? (have >= t.maxRank ? "full" : "some") : plan ? "planned" : "off";
      const desc = t.descriptions?.[Math.max(0, (have || 1) - 1)] || t.descriptions?.[0] || "";
      cells.push(`<div class="tal-cell tal-${state}" title="${esc(`${t.name || "Unknown talent"} (${have}/${t.maxRank})${plan ? ` · path: ${plan}/${t.maxRank}` : ""}${desc ? `\n${desc}` : ""}`)}">
        ${t.iconFileId && window.GameIcons ? GameIcons.tag(t.iconFileId, 40) : `<span class="tal-noicon">?</span>`}
        <span class="tal-rank">${have}/${t.maxRank}</span>${isNext ? `<span class="tal-next-badge">Next</span>` : ""}</div>`);
    }
    const pts = c.order.slice(0, c.spentByNow.length).filter((s) => s.tab === tab.name).length;
    return `<section class="tal-tree${tab.name === c.tree ? " main" : ""}"><header>${tab.iconFileId && window.GameIcons ? GameIcons.tag(tab.iconFileId, 28) : ""}<h3>${esc(tab.name)}</h3><span>${pts} point${pts === 1 ? "" : "s"}</span></header><div class="tal-grid">${cells.join("")}</div></section>`;
  }
  function body() {
    if (error) return `<p class="tal-empty">${esc(error)}</p>`;
    if (!who) return `<p class="tal-empty">Choose a character with a class in Characters to see talents.</p>`;
    if (!data) return `<p class="tal-empty">Reading your talent trees…</p>`;
    if (!data.available) return `<div class="tal-empty"><strong>Talent trees aren't available yet.</strong><p>${esc(data.reason || "")} Connect your WoW Forever folder in Settings → Game connection; the app reads your talents from your own game files.</p></div>`;
    const c = data.coach, trees = data.trees;
    const descOf = (s) => { const t = trees.tabs.find((x) => x.name === s.tab)?.talents.find((x) => x.id === s.talentId); return t?.descriptions?.[s.rank - 1] || t?.descriptions?.[0] || ""; };
    const iconOf = (s) => trees.tabs.find((x) => x.name === s.tab)?.talents.find((x) => x.id === s.talentId)?.iconFileId;
    const groups = [];
    c.order.slice(c.spentByNow.length, c.spentByNow.length + 8).forEach((s, i) => {
      const lvl = 10 + c.spentByNow.length + i, g = groups[groups.length - 1];
      if (g && g.talentId === s.talentId) { g.toRank = s.rank; g.toLevel = lvl; } else groups.push({ ...s, fromRank: s.rank, toRank: s.rank, fromLevel: lvl, toLevel: lvl });
    });
    const when = (g) => (g.fromLevel <= c.level ? "Spend now" : g.fromLevel === g.toLevel ? `Level ${g.fromLevel}` : `Levels ${g.fromLevel}–${g.toLevel}`);
    const next = groups.length ? `<ol class="tal-next-list">${groups.slice(0, 4).map((g, i) => `<li${i === 0 ? ' class="first"' : ""}>${iconOf(g) && window.GameIcons ? GameIcons.tag(iconOf(g), 36) : ""}<div><strong>${esc(g.name)} <small>${g.fromRank === g.toRank ? `rank ${g.toRank}` : `ranks ${g.fromRank}–${g.toRank}`} of ${g.maxRank} · ${esc(g.tab)}</small></strong><span class="tal-when">${when(g)}</span>${i === 0 && descOf(g) ? `<p>${esc(descOf(g))}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="tal-empty">Every point on this path is spent.</p>`;
    const nextOld = c.next.length ? `<ol class="tal-next-list">${c.next.map((s, i) => `<li${i === 0 ? ' class="first"' : ""}>${iconOf(s) && window.GameIcons ? GameIcons.tag(iconOf(s), 36) : ""}<div><strong>${esc(s.name)} <small>rank ${s.rank}/${s.maxRank} · ${esc(s.tab)}</small></strong>${i === 0 ? `<span class="tal-when">${c.points >= 1 ? "Spend now" : "At level 10"}</span>` : `<span class="tal-when">Level ${9 + c.spentByNow.length + i + 1}</span>`}${descOf(s) ? `<p>${esc(descOf(s))}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="tal-empty">Every point on this path is spent. 🎉</p>`;
    const totals = Object.entries(c.totals).map(([k, v]) => `${v} ${esc(k)}`).join(" / ") || "none yet";
    return `<div class="tal-summary"><div class="tal-points"><strong>${c.points}</strong><span>talent point${c.points === 1 ? "" : "s"} at level ${c.level}</span></div><p>${c.points ? `By now: ${totals}.` : "Talents start at level 10: one point every level after that."} The path leans <strong>${esc(c.tree)}</strong>. ${esc(c.why)}</p></div>
      <div class="tal-layout"><div class="tal-trees">${trees.tabs.map((t) => tree(t, c)).join("")}</div><aside class="tal-side"><h3>Spend next</h3>${next}<p class="tal-note">In game: press <code>N</code> to open Talents. This path is a suggestion for solo leveling; your choices are yours.</p></aside></div>`;
  }
  function page() {
    const cls = preview || who?.className;
    return `<section class="talents-page" data-talents>
      ${PageHero.render({ art: "talents", eyebrow: "Characters · Talents", title: `${esc(cls || "Talents")}${who?.name && !preview ? ` <small>· ${esc(who.name)}</small>` : ""}`, crestHtml: cls && CLASSES.includes(cls) ? crest(cls) : "",
        aside: `<label class="tal-pick">Preview another class <select data-tal-class><option value="">${esc(who?.className || "Your class")}</option>${CLASSES.filter((c) => c !== who?.className).map((c) => `<option ${c === preview ? "selected" : ""}>${c}</option>`).join("")}</select></label>` })}
      <div data-tal-body>${body()}</div></section>`;
  }
  function paint() { const b = document.querySelector("[data-tal-body]"); if (b) b.innerHTML = body(); }
  async function load() {
    if (loading) return; loading = true;
    try {
      const s = await api.bootstrap(); const p = s.state.profiles.find((x) => x.id === s.state.activeProfileId);
      who = p?.className ? { name: p.name, className: p.className, level: p.level } : null;
      const cls = preview || who?.className;
      data = cls ? await api.talentCoach({ className: cls, level: preview ? 60 : who.level }) : null; error = "";
    } catch (e) { error = e.message || "Talents are unavailable."; }
    loading = false;
    const root = document.querySelector("[data-talents]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-talents]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("change", (e) => { if (e.target.matches("[data-tal-class]")) { preview = e.target.value || null; data = null; paint(); load(); } });
    if (!data && !loading) load();
  }
  return { page, mounted, invalidate: () => { data = null; }, _state: () => ({ data, who, preview }) };
})();
