"use strict";
// Dungeons & Raids atlas page. Cards are coloured like in-game difficulty for your level.
window.DungeonAtlas = (() => {
  const api = window.backstage;
  let atlas = null, tab = "dungeon", open = null, mountedFor = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const LABEL = { right: "Right for your level", easy: "Easy", hard: "Challenging", trivial: "Low level", impossible: "Too high for now", unknown: "Level unknown" };
  function page() {
    return `<section class="atlas-page" data-atlas>
      <header class="atlas-head"><div class="wm-banner"><span class="wm-banner-eyebrow">Dungeons & raids</span><h1>Instance Atlas</h1><span class="wm-live" data-atlas-level></span></div>
      <div class="atlas-tabs" role="tablist"><button type="button" role="tab" data-atlas-tab="dungeon">Dungeons</button><button type="button" role="tab" data-atlas-tab="raid">Raids</button><button type="button" role="tab" data-atlas-tab="forever">New in Forever</button></div></header>
      <div class="atlas-suggest" data-atlas-suggest></div>
      <div class="atlas-grid" data-atlas-grid><p class="atlas-loading">Opening the atlas…</p></div>
      <p class="atlas-caution" data-atlas-caution></p>
    </section>`;
  }
  function card(e) {
    const isOpen = open === e.id;
    const bosses = e.bosses.map((b) => `<li class="${b.observedInForever ? "seen" : ""}"><span class="atlas-skull" aria-hidden="true">☠</span>${esc(b.name)}${b.observedInForever ? `<small>seen in Forever${b.kills ? ` · ${b.kills} kill${b.kills === 1 ? "" : "s"}` : ""}</small>` : ""}</li>`).join("");
    const extra = e.observedOnly.map((b) => `<li class="seen new"><span class="atlas-skull">☠</span>${esc(b.name)}<small>Forever-only boss</small></li>`).join("");
    const quests = e.yourQuests.length ? `<div class="atlas-quests"><h4>Your quests here</h4><ul>${e.yourQuests.map((q) => `<li class="${q.complete ? "done" : ""}"><strong>${esc(q.title)}</strong>${q.complete ? " · ready to turn in" : ""}${q.objectives.length ? `<small>${q.objectives.map((o) => esc(o.text)).join(" · ")}</small>` : ""}</li>`).join("")}</ul></div>` : "";
    return `<article class="atlas-card d-${esc(e.difficulty)} ${e.kind}${isOpen ? " open" : ""}" data-atlas-card="${esc(e.id)}">
      <div class="atlas-ribbon"><span>${e.levels ? `${e.levels.min}${e.levels.max !== e.levels.min ? "–" + e.levels.max : ""}` : "?"}</span></div>
      <div class="atlas-card-body">
        <h3>${esc(e.name)}</h3>
        <p class="atlas-where">${e.zone ? esc(e.zone) : "Location not yet observed"}${e.faction ? ` · <span class="atlas-side ${esc(e.faction.toLowerCase())}">${esc(e.faction)}</span>` : ""}${e.observedRuns ? ` · <span class="atlas-seen">${e.observedRuns} Forever run${e.observedRuns === 1 ? "" : "s"} observed</span>` : ""}</p>
        <p class="atlas-diff">${esc(LABEL[e.difficulty])}${e.factionNote ? ` · ${esc(e.factionNote)}` : ""}</p>
        ${quests}
        <button type="button" class="atlas-toggle" data-atlas-open="${esc(e.id)}" aria-expanded="${isOpen}">${isOpen ? "Hide details" : `Bosses, roles & prep (${e.bosses.length + e.observedOnly.length} bosses)`}</button>
        ${isOpen ? `<div class="atlas-details"><ul class="atlas-bosses">${bosses}${extra}</ul>
          <div class="atlas-cols"><div><h4>Group</h4><ul>${e.roles.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div><div><h4>Before you go</h4><ul>${e.prep.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div></div>
          ${e.entrance ? `<div class="atlas-actions"><button type="button" class="primary" data-atlas-way="${esc(e.id)}">Copy entrance waypoint</button><button type="button" data-atlas-map="${esc(e.id)}">Show on World Map</button></div><p class="atlas-src">Entrance around ${(e.entrance.x * 100).toFixed(0)}, ${(e.entrance.y * 100).toFixed(0)} in ${esc(e.zone)} (approximate).</p>` : ""}
          <p class="atlas-src">${esc(e.source)}</p></div>` : ""}
      </div></article>`;
  }
  function paint() {
    const root = document.querySelector("[data-atlas]"); if (!root || !atlas) return;
    root.querySelector("[data-atlas-level]").textContent = atlas.level ? `Level ${atlas.level}${atlas.faction ? " · " + atlas.faction : ""}` : "Choose a character to colour by level";
    root.querySelectorAll("[data-atlas-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.atlasTab === tab)));
    const list = atlas.entries.filter((e) => (tab === "forever" ? e.foreverOriginal || e.observedRuns : e.kind === tab && !e.foreverOriginal));
    const sug = atlas.suggested.map((id) => atlas.entries.find((e) => e.id === id)).filter(Boolean);
    root.querySelector("[data-atlas-suggest]").innerHTML = tab === "dungeon" && sug.length ? `<h2>Suggested for you</h2><div class="atlas-chips">${sug.map((e) => `<button type="button" data-atlas-open="${esc(e.id)}" class="atlas-chip d-${esc(e.difficulty)}">${esc(e.name)} <small>${e.levels.min}–${e.levels.max} · ${esc(e.zone)}</small></button>`).join("")}</div>` : "";
    root.querySelector("[data-atlas-grid]").innerHTML = list.map(card).join("") || `<p>Nothing observed yet.</p>`;
    root.querySelector("[data-atlas-caution]").textContent = [atlas.caution, atlas.attribution].filter(Boolean).join(" ");
  }
  async function load() { try { atlas = await api.dungeonAtlas(); } catch (e) { atlas = { entries: [], suggested: [], caution: e.message }; } paint(); }
  function mounted() {
    const root = document.querySelector("[data-atlas]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("click", async (ev) => {
      const t = ev.target.closest("[data-atlas-tab]"); if (t) { tab = t.dataset.atlasTab; open = null; paint(); return; }
      const o = ev.target.closest("[data-atlas-open]"); if (o) { const id = o.dataset.atlasOpen; const e = atlas.entries.find((x) => x.id === id); if (e && e.kind !== tab && !e.foreverOriginal) tab = e.kind; open = open === id ? null : id; paint(); root.querySelector(`[data-atlas-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      const w = ev.target.closest("[data-atlas-way]"); if (w) { const e = atlas.entries.find((x) => x.id === w.dataset.atlasWay); try { const r = await api.copyWaypoint({ mapId: e.mapId, x: e.entrance.x, y: e.entrance.y, label: e.name }); w.textContent = "Copied — paste in WoW chat"; window.toast?.(r.message); } catch (err) { w.textContent = err.message; } return; }
      const m = ev.target.closest("[data-atlas-map]"); if (m) { const e = atlas.entries.find((x) => x.id === m.dataset.atlasMap); window.WorldMapView?.focus({ mapId: e.mapId, x: e.entrance.x, y: e.entrance.y, label: `${e.name} entrance`, sub: `${e.kind === "raid" ? "Raid" : "Dungeon"} · levels ${e.levels.min}–${e.levels.max}` }); document.querySelector('[data-nav="world-map"]')?.click(); }
    });
    load();
  }
  return { page, mounted };
})();
