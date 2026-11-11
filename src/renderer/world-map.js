"use strict";
// World Map: a cartographer-style zone map with live position, quest and finder pins.
// Original procedural artwork (no game assets). Coordinates are game map percentages.
window.WorldMapView = (() => {
  const api = window.backstage;
  const LAYERS = [
    ["quest-turnin", "Turn-ins"], ["quest-objective", "Objectives"], ["quest-giver", "Quests to pick up"],
    ["flight", "Flight masters"], ["trainer", "Trainers"], ["vendor", "Vendors"],
    ["herb", "Herbs"], ["ore", "Ore"], ["find", "Your finds"], ["npc", "Other NPCs"],
  ];
  const PREF = "bf-world-map-v1";
  let clusters = [], pendingFocus = null;
  let model = null, mapId = null, follow = true, selected = null, hover = null, trail = [], view = { zoom: 1, cx: 0.5, cy: 0.5 };
  let layers = Object.fromEntries(LAYERS.map(([k]) => [k, k !== "npc"]));
  const EXPLORED = "bf-world-map-explored-v1:";
  const explored = (id) => { try { return JSON.parse(localStorage.getItem(EXPLORED + id) || "[]"); } catch { return []; } };
  const remember = (id, p) => { try { const a = explored(id); const last = a[a.length - 1]; if (last && Math.hypot(last[0] - p.x, last[1] - p.y) < 0.004) return; a.push([+p.x.toFixed(4), +p.y.toFixed(4)]); if (a.length > 4000) a.splice(0, a.length - 4000); localStorage.setItem(EXPLORED + id, JSON.stringify(a)); } catch {} };
  let canvas, ctx, parchment, results = null, loading = false, lastLive = null, dragging = null, mountedFor = null, error = "";
  try { const p = JSON.parse(localStorage.getItem(PREF) || "{}"); if (p.layers) layers = { ...layers, ...p.layers }; if (typeof p.follow === "boolean") follow = p.follow; } catch {}
  const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify({ layers, follow })); } catch {} };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => (v * 100).toFixed(1);
  const dirName = (dx, dy) => { const d = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(d / 45) % 8]; };

  // ---------- page shell ----------
  function page() {
    return `<section class="world-map-page" data-world-map>
      <header class="wm-head">
        <div class="wm-banner"><span class="wm-banner-eyebrow">World map</span><h1 data-wm-title>${esc(model?.mapName || "Your world")}</h1><span class="wm-live" data-wm-live></span></div>
        <form class="wm-search" data-wm-search><input type="search" name="q" maxlength="80" placeholder="Find an NPC, flight master, trainer, herb…" aria-label="Find on the map"><button type="submit">Find</button></form>
        <label class="wm-zone">Zone <select data-wm-zone aria-label="Choose zone"></select></label>
      </header>
      <div class="wm-body">
        <div class="wm-frame"><canvas class="wm-canvas" data-wm-canvas tabindex="0" aria-label="Zone map"></canvas>
          <div class="wm-tools"><button type="button" data-wm-act="me" title="Center on me">◎</button><button type="button" data-wm-act="in" title="Zoom in">＋</button><button type="button" data-wm-act="out" title="Zoom out">－</button><button type="button" data-wm-act="reset" title="Whole zone">⤢</button><button type="button" data-wm-act="radar" title="Pop out radar">◉</button></div>
          <div class="wm-tip" data-wm-tip hidden></div>
        </div>
        <aside class="wm-side">
          <div class="wm-near" data-wm-near hidden></div>
          <div class="wm-card" data-wm-card></div>
          <div class="wm-results" data-wm-results></div>
          <div class="wm-legend" data-wm-legend></div>
          <label class="check-label wm-follow"><input type="checkbox" data-wm-follow ${follow ? "checked" : ""}>Follow my live position</label>
          <p class="wm-attrib" data-wm-attrib></p>
        </aside>
      </div>
    </section>`;
  }

  // ---------- procedural parchment ----------
  function makeParchment(w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#e8d6ad"); base.addColorStop(0.5, "#dcc594"); base.addColorStop(1, "#cfb37c");
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1400; i++) { // fibres and speckles
      g.fillStyle = `rgba(${90 + rnd() * 40},${60 + rnd() * 30},${30},${rnd() * 0.06})`;
      const r = rnd() * 22 + 2; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, r, r * (0.3 + rnd()), rnd() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(70,45,20,${rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 1, 1); }
    g.strokeStyle = "rgba(110,80,40,0.12)"; g.lineWidth = 2; // folds
    g.beginPath(); g.moveTo(w / 3, 0); g.lineTo(w / 3 + 6, h); g.moveTo((2 * w) / 3, 0); g.lineTo((2 * w) / 3 - 4, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2 + 5); g.stroke();
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    v.addColorStop(0, "rgba(60,35,10,0)"); v.addColorStop(1, "rgba(60,35,10,0.55)");
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    return c;
  }

  // ---------- coordinate transforms ----------
  const toScreen = (x, y) => { const s = canvas.width * view.zoom, t = canvas.height * view.zoom; return [(x - view.cx) * s + canvas.width / 2, (y - view.cy) * t + canvas.height / 2]; };
  const toMap = (sx, sy) => [(sx - canvas.width / 2) / (canvas.width * view.zoom) + view.cx, (sy - canvas.height / 2) / (canvas.height * view.zoom) + view.cy];

  // ---------- icons ----------
  const COLORS = { "quest-turnin": "#f6c445", "quest-giver": "#f6c445", "quest-objective": "#d9442e", flight: "#4f8fd6", trainer: "#4f9d5a", vendor: "#a8743a", herb: "#5fae3c", ore: "#9a8f86", find: "#e8b33a", npc: "#5b4630", town: "#3a2a16" };
  function badge(x, y, r, fill, ring = "#2a1c0c") {
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 7); ctx.fillStyle = "rgba(20,12,4,0.55)"; ctx.fill();
    const g = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r); g.addColorStop(0, "#fff3cf"); g.addColorStop(0.25, fill); g.addColorStop(1, shade(fill));
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ring; ctx.stroke();
  }
  function shade(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.floor(v * 0.55)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
  function glyph(text, x, y, size, color = "#1d1207") { ctx.fillStyle = color; ctx.font = `700 ${size}px Cinzel, Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 1); }
  function leaf(x, y, s, color) { ctx.save(); ctx.translate(x, y); ctx.rotate(-0.6); ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.9, 0, 0, s); ctx.quadraticCurveTo(-s * 0.9, 0, 0, -s); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#1f3a12"; ctx.lineWidth = 1; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 0.8); ctx.stroke(); ctx.restore(); }
  function rock(x, y, s, color) { ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x - s * 0.6, y - s * 0.5); ctx.lineTo(x + s * 0.1, y - s); ctx.lineTo(x + s, y - s * 0.2); ctx.lineTo(x + s * 0.8, y + s * 0.7); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#2b2420"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.fillStyle = "#d9a441"; ctx.fillRect(x - s * 0.2, y - s * 0.3, s * 0.35, s * 0.3); }
  function wing(x, y, s) { ctx.save(); ctx.translate(x, y); ctx.fillStyle = "#eaf2ff"; ctx.beginPath(); ctx.moveTo(-s * 0.9, s * 0.4); ctx.quadraticCurveTo(-s * 0.2, -s, s * 0.9, -s * 0.6); ctx.quadraticCurveTo(s * 0.2, -s * 0.1, s * 0.5, s * 0.1); ctx.quadraticCurveTo(0, 0, -s * 0.9, s * 0.4); ctx.fill(); ctx.restore(); }
  function drawPin(p, sx, sy, emphasis) {
    const k = p.kind, r = (k === "npc" ? 3.5 : 9) * (emphasis ? 1.35 : 1);
    if (k === "npc") { ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fillStyle = "rgba(60,40,20,0.75)"; ctx.fill(); return; }
    if (k === "town") return;
    if (k === "instance") { const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 16); g.addColorStop(0, "#f3d9ff"); g.addColorStop(0.5, "#8a3fd1"); g.addColorStop(1, "rgba(60,10,90,0)"); ctx.beginPath(); ctx.arc(sx, sy, 16, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#2a0d3d"; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(sx, sy, 4 + i * 3.5, i, i + 4.2); ctx.stroke(); } return; }
    if (k === "quest-objective") { ctx.beginPath(); ctx.arc(sx, sy, 14 * view.zoom ** 0.3, 0, 7); ctx.fillStyle = "rgba(217,68,46,0.14)"; ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = "rgba(160,40,25,0.8)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); badge(sx, sy, r * 0.75, COLORS[k]); glyph("•", sx, sy, 12, "#fff"); return; }
    if (k === "herb" || (k === "find" && p.gather === "herb")) { if (k === "find") badge(sx, sy, r, "#f2d27a"); leaf(sx, sy, r * 0.8, COLORS.herb); return; }
    if (k === "ore" || (k === "find" && p.gather === "ore")) { if (k === "find") badge(sx, sy, r, "#f2d27a"); rock(sx, sy, r * 0.7, "#8d8276"); return; }
    badge(sx, sy, r, COLORS[k] || "#999");
    if (k === "quest-giver") glyph("!", sx, sy, 15);
    else if (k === "quest-turnin") glyph("?", sx, sy, 15);
    else if (k === "flight") wing(sx, sy, r * 0.75);
    else if (k === "trainer") glyph("✦", sx, sy, 12, "#fff");
    else if (k === "vendor") glyph("¤", sx, sy, 14, "#fff");
  }

  // ---------- drawing ----------
  function visiblePins() { return (model?.pins || []).filter((p) => p.kind === "town" || layers[p.kind] !== false); }
  function draw() {
    if (!canvas || !ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const [ox, oy] = toScreen(0, 0), [ex, ey] = toScreen(1, 1);
    ctx.drawImage(parchment, ox, oy, ex - ox, ey - oy);
    // Ink washes where the world is known: a soft sense of settlements and roads.
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    for (const p of model?.pins || []) { const [sx, sy] = toScreen(p.x, p.y); const r = 26 * Math.max(1, view.zoom * 0.7); const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, "rgba(120,90,50,0.10)"); g.addColorStop(1, "rgba(120,90,50,0)"); ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r); }
    ctx.restore();
    // Places you have travelled with the live link on: your own roads.
    const ex2 = explored(model?.mapId);
    if (ex2.length) { ctx.save(); ctx.strokeStyle = "rgba(110,72,28,0.45)"; ctx.lineWidth = Math.max(2, 3 * view.zoom ** 0.5); ctx.lineCap = "round"; ctx.setLineDash([2, 5]); ctx.beginPath(); ex2.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); const prev = ex2[i - 1]; if (i && prev && Math.hypot(prev[0] - x, prev[1] - y) < 0.03) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }); ctx.stroke(); ctx.restore(); }
    // Grid with coordinates.
    ctx.strokeStyle = "rgba(80,55,25,0.18)"; ctx.lineWidth = 1; ctx.fillStyle = "rgba(60,40,18,0.7)"; ctx.font = "11px 'Source Sans 3', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let i = 0; i <= 10; i++) { const [gx] = toScreen(i / 10, 0), [, gy] = toScreen(0, i / 10); ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx, ey); ctx.moveTo(ox, gy); ctx.lineTo(ex, gy); ctx.stroke(); if (i < 10) { ctx.fillText(String(i * 10), gx + 3, Math.max(oy, 0) + 3); ctx.fillText(String(i * 10), Math.max(ox, 0) + 3, gy + 3); } }
    compassRose(w - 58, h - 62, 38);
    // Pins: overlapping same-kind pins merge into numbered clusters; selection stays visible.
    clusters = [];
    for (const p of visiblePins()) {
      if (p.kind === "town") continue;
      const [sx, sy] = toScreen(p.x, p.y); if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const near = p.kind !== "npc" && p !== selected && clusters.find((c) => c.kind === p.kind && (c.sx - sx) ** 2 + (c.sy - sy) ** 2 < 16 * 16);
      if (near) { near.pins.push(p); continue; }
      clusters.push({ kind: p.kind, sx, sy, pins: [p] });
    }
    for (const c of clusters) {
      if (c.pins.length === 1) { drawPin(c.pins[0], c.sx, c.sy, c.pins[0] === hover || c.pins[0] === selected); continue; }
      drawPin(c.pins[0], c.sx, c.sy, false);
      ctx.beginPath(); ctx.arc(c.sx + 10, c.sy - 10, 8, 0, 7); ctx.fillStyle = "#7a1f14"; ctx.fill(); ctx.strokeStyle = "#f6dc9a"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#fff3cf"; ctx.font = "700 10px 'Source Sans 3', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(c.pins.length), c.sx + 10, c.sy - 9.5);
    }
    // Landmarks on a parchment plate, above pins.
    for (const p of visiblePins().filter((p) => p.kind === "town")) {
      const [sx, sy] = toScreen(p.x, p.y); ctx.font = "700 16px Cinzel, Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = ctx.measureText(p.label).width + 18, ty = sy - 26;
      ctx.fillStyle = "rgba(245,232,200,0.92)"; ctx.strokeStyle = "#6b4a1c"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(sx - tw / 2, ty - 11, tw, 22, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#3a2410"; ctx.fillText(p.label, sx, ty + 1);
      ctx.beginPath(); ctx.moveTo(sx, ty + 11); ctx.lineTo(sx, sy - 6); ctx.strokeStyle = "#6b4a1c"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 5, sy); ctx.lineTo(sx, sy + 6); ctx.lineTo(sx - 5, sy); ctx.closePath(); ctx.fillStyle = "#7a1f14"; ctx.fill();
    }
    if (selected) { const [sx, sy] = toScreen(selected.x, selected.y); ctx.beginPath(); ctx.arc(sx, sy, 18, 0, 7); ctx.strokeStyle = "#fff6d0"; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = "#a0701a"; ctx.lineWidth = 1.5; ctx.stroke(); }
    // Player: saved marker, live trail, live arrow.
    const pl = model?.player;
    if (pl?.saved && !pl.live) { const [sx, sy] = toScreen(pl.saved.x, pl.saved.y); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.setLineDash([3, 3]); ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); ctx.font = "600 11px 'Source Sans 3'"; ctx.fillStyle = "#3a2410"; ctx.textAlign = "center"; ctx.fillText("last saved", sx, sy + 18); }
    trail.forEach((t, i) => { if (t.mapId !== model?.mapId) return; const [sx, sy] = toScreen(t.x, t.y); ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7); ctx.fillStyle = `rgba(200,140,30,${(i + 1) / trail.length * 0.8})`; ctx.fill(); });
    if (pl?.live) arrow(...toScreen(pl.live.x, pl.live.y), pl.live.facing, pl.live.combat);
  }
  function compassRose(x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.8;
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.18, 0); ctx.lineTo(-r * 0.18, 0); ctx.closePath(); ctx.fillStyle = i === 3 ? "#7a1f14" : "#4a321a"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, 7); ctx.strokeStyle = "#4a321a"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = "700 13px Cinzel, serif"; ctx.fillStyle = "#3a2410"; ctx.textAlign = "center"; ctx.fillText("N", 0, -r - 8); ctx.restore();
  }
  function arrow(x, y, facing, combat) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-(facing || 0));
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26); glow.addColorStop(0, combat ? "rgba(220,40,30,0.6)" : "rgba(255,210,80,0.65)"); glow.addColorStop(1, "rgba(255,210,80,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(13, 14); ctx.lineTo(0, 6); ctx.lineTo(-13, 14); ctx.closePath();
    const g = ctx.createLinearGradient(0, -19, 0, 14); g.addColorStop(0, "#fff7c8"); g.addColorStop(1, "#d4901c");
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#3a2008"; ctx.stroke(); ctx.restore();
  }

  // ---------- side panel ----------
  function legend() {
    const box = document.querySelector("[data-wm-legend]"); if (!box) return;
    box.innerHTML = `<h3>Layers</h3>` + LAYERS.map(([k, label]) => `<label class="wm-layer"><input type="checkbox" data-wm-layer="${k}" ${layers[k] !== false ? "checked" : ""}><span class="wm-swatch wm-k-${k}"></span>${esc(label)} <small>${model?.counts?.[k] || 0}</small></label>`).join("");
  }
  function relation(p) {
    const me = model?.player?.live || model?.player?.saved;
    if (!me) return "";
    const dx = p.x - me.x, dy = p.y - me.y, d = Math.hypot(dx, dy);
    const how = d < 0.02 ? "right here" : `${dirName(dx, dy)}, ${d < 0.08 ? "close" : d < 0.25 ? "a short ride" : "across the zone"}`;
    return `<p class="wm-rel">${model.player.live ? "From you (live)" : "From your last saved spot"}: <strong>${esc(how)}</strong></p>`;
  }
  function card() {
    const box = document.querySelector("[data-wm-card]"); if (!box) return;
    if (!selected) { box.innerHTML = `<div class="wm-card-empty"><strong>Click any pin</strong> for details and a waypoint you can paste in game.<br>Use <em>Find</em> to search every zone.</div>`; return; }
    const p = selected;
    box.innerHTML = `<div class="wm-card-head"><span class="wm-swatch wm-k-${esc(p.kind)}"></span><div><h3>${esc(p.label)}</h3>${p.sub ? `<p class="wm-sub">${esc(p.sub)}</p>` : ""}</div></div>
      <p class="wm-coords">${esc(model.mapName)} · ${pct(p.x)}, ${pct(p.y)}</p>${relation(p)}
      ${p.sells?.length ? `<p class="wm-sells">Sold here: ${p.sells.map(esc).join(", ")}</p>` : ""}
      ${p.services ? `<p class="wm-sells">${p.services} training services observed</p>` : ""}
      <div class="wm-card-actions"><button type="button" class="primary" data-wm-act="way">Copy waypoint for WoW</button><button type="button" data-wm-act="track">Track on radar</button></div>
      <p class="wm-src">${esc(p.source || "")}${p.lastSeen ? ` · seen ${esc(p.lastSeen)}` : ""}${p.build ? ` · build ${esc(p.build)}` : ""}</p>`;
  }
  function liveLine() {
    const n = document.querySelector("[data-wm-live]"); if (!n) return;
    const pl = model?.player;
    n.textContent = pl?.live ? `● Live · ${pct(pl.live.x)}, ${pct(pl.live.y)}${pl.live.mounted ? " · mounted" : ""}` : pl?.liveElsewhere ? `● Live in ${pl.liveElsewhere.mapName}` : pl?.saved ? "Last saved position shown" : "";
    n.classList.toggle("on", Boolean(pl?.live));
  }
  function zoneSelect() {
    const sel = document.querySelector("[data-wm-zone]"); if (!sel || !model) return;
    sel.innerHTML = model.maps.map((m) => `<option value="${m.mapId}" ${m.mapId === model.mapId ? "selected" : ""}>${esc(m.name)}</option>`).join("") + (model.maps.some((m) => m.mapId === model.mapId) ? "" : `<option value="${model.mapId}" selected>${esc(model.mapName)}</option>`);
  }
  function resultsList() {
    const box = document.querySelector("[data-wm-results]"); if (!box) return;
    box.hidden = !results;
    if (!results) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3>Found ${results.results.length} for “${esc(results.query)}”</h3>` + (results.results.length ? `<ol>${results.results.map((r, i) => `<li><button type="button" data-wm-result="${i}"><span class="wm-swatch wm-k-${esc(r.kind)}"></span><span><strong>${esc(r.label)}</strong><small>${esc(r.sub || "")}${r.sub ? " · " : ""}${esc(r.mapName)} ${pct(r.x)}, ${pct(r.y)}</small></span></button></li>`).join("")}</ol>` : `<p>Nothing in the local reference matches. Coverage grows as you and others play.</p>`) + `<button type="button" class="subtle" data-wm-act="clear">Clear search</button>`;
  }
  // Nearest useful places to your live (or saved) position.
  const NEAR_KINDS = new Set(["quest-turnin", "quest-objective", "quest-giver", "flight", "find", "herb", "ore", "instance"]);
  function nearList() {
    const box = document.querySelector("[data-wm-near]"); if (!box) return;
    const me = model?.player?.live || model?.player?.saved;
    if (!me) { box.hidden = true; return; }
    const near = visiblePins().filter((p) => NEAR_KINDS.has(p.kind)).map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y) })).sort((a, b) => (a.p.kind === "quest-turnin" ? -0.05 : 0) + a.d - ((b.p.kind === "quest-turnin" ? -0.05 : 0) + b.d))
      .filter((n, i, all) => !all.slice(0, i).some((m) => m.p.label === n.p.label && Math.hypot(m.p.x - n.p.x, m.p.y - n.p.y) < 0.03)).slice(0, 5);
    box.hidden = !near.length;
    box.innerHTML = `<h3>Near you${model.player.live ? "" : " (last saved)"}</h3><ol>${near.map(({ p, d }, i) => `<li><button type="button" data-wm-near-pin="${i}"><span class="wm-swatch wm-k-${esc(p.kind)}"></span><span><strong>${esc(p.label)}</strong><small>${esc(p.sub || "")}${p.sub ? " · " : ""}${d < 0.02 ? "right here" : `${dirName(p.x - me.x, p.y - me.y)}, ${d < 0.08 ? "close" : d < 0.25 ? "short ride" : "far"}`}</small></span></button></li>`).join("")}</ol>`;
    box._near = near.map((n) => n.p);
  }
  function paintAll() { const t = document.querySelector("[data-wm-title]"); if (t && model) t.textContent = model.mapName; const a = document.querySelector("[data-wm-attrib]"); if (a && model) a.textContent = model.attribution; legend(); card(); liveLine(); zoneSelect(); resultsList(); nearList(); draw(); }

  // ---------- data ----------
  async function load(next) {
    if (loading) return; loading = true;
    try {
      const m = await api.worldMap(next ? { mapId: next } : mapId ? { mapId } : {});
      if (m.mapId !== model?.mapId) { selected = null; view = { zoom: 1, cx: 0.5, cy: 0.5 }; }
      model = m; mapId = m.mapId; error = "";
      if (pendingFocus && pendingFocus.mapId === m.mapId) {
        const pin = { id: "focus", kind: "instance", label: pendingFocus.label, sub: pendingFocus.sub || null, mapId: m.mapId, x: pendingFocus.x, y: pendingFocus.y, source: "Classic-era baseline (approximate entrance)" };
        model.pins.push(pin); selected = pin; view = { zoom: 2.2, cx: pin.x, cy: pin.y }; pendingFocus = null;
      }
      if (m.player?.live) pushTrail(m.mapId, m.player.live);
    } catch (e) { error = e.message; }
    loading = false; paintAll();
  }
  function pushTrail(id, p) { remember(id, p); const last = trail[trail.length - 1]; if (!last || last.mapId !== id || Math.hypot(last.x - p.x, last.y - p.y) > 0.002) { trail.push({ mapId: id, x: p.x, y: p.y }); if (trail.length > 60) trail.shift(); } }
  function onLive(status) {
    const f = status?.frame;
    if (!f?.position || !document.querySelector("[data-world-map]")) return;
    lastLive = f;
    if (follow && f.position.mapId !== mapId) { mapId = f.position.mapId; load(mapId); return; }
    if (model && f.position.mapId === model.mapId) {
      model.player.live = { x: f.position.x, y: f.position.y, facing: f.position.facing, mounted: f.mounted, combat: f.combat };
      pushTrail(model.mapId, f.position);
      if (follow && view.zoom > 1) { view.cx = f.position.x; view.cy = f.position.y; }
      liveLine(); nearList(); draw();
    }
  }

  // ---------- interaction ----------
  function hitCluster(sx, sy) { return clusters.find((c) => c.pins.length > 1 && (c.sx - sx) ** 2 + (c.sy - sy) ** 2 < 14 * 14) || null; }
  function hit(sx, sy) {
    let best = null, bd = 14 * 14;
    for (const p of visiblePins()) { if (p.kind === "town") continue; const [x, y] = toScreen(p.x, p.y); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function resize() {
    if (!canvas) return;
    const box = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, Math.floor(box.width)), h = Math.floor(w * 2 / 3);
    const dpr = 1; canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + "px";
    parchment = makeParchment(w, h); draw();
  }
  function bind() {
    const root = document.querySelector("[data-world-map]");
    canvas = root.querySelector("[data-wm-canvas]"); ctx = canvas.getContext("2d");
    resize();
    const tip = root.querySelector("[data-wm-tip]");
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (dragging) { const [ax, ay] = toMap(dragging.x, dragging.y), [bx, by] = toMap(sx, sy); view.cx += ax - bx; view.cy += ay - by; dragging = { x: sx, y: sy, moved: true }; draw(); return; }
      const p = hit(sx, sy);
      if (p !== hover) { hover = p; draw(); }
      const cl = hitCluster(sx, sy);
      if (cl) { tip.hidden = false; tip.style.left = sx + 14 + "px"; tip.style.top = sy + 10 + "px"; tip.innerHTML = `<strong>${cl.pins.length} places</strong><br><small>${cl.pins.slice(0, 4).map((p) => esc(p.label)).join(" · ")}${cl.pins.length > 4 ? " …" : ""}<br>Click to zoom in</small>`; return; }
      if (p) { tip.hidden = false; tip.style.left = sx + 14 + "px"; tip.style.top = sy + 10 + "px"; tip.innerHTML = `<strong>${esc(p.label)}</strong>${p.sub ? `<br><small>${esc(p.sub)}</small>` : ""}`; } else tip.hidden = true;
    });
    canvas.addEventListener("mouseleave", () => { tip.hidden = true; hover = null; dragging = null; draw(); });
    canvas.addEventListener("mousedown", (e) => { const r = canvas.getBoundingClientRect(); dragging = { x: e.clientX - r.left, y: e.clientY - r.top, moved: false }; });
    canvas.addEventListener("mouseup", (e) => { const was = dragging; dragging = null; if (was?.moved) return; const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; const c = hitCluster(sx, sy); if (c && view.zoom < 8) { const [mx, my] = toMap(sx, sy); view = { zoom: Math.min(8, view.zoom * 2), cx: mx, cy: my }; draw(); return; } const p = hit(sx, sy); selected = p; card(); draw(); });
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const [mx, my] = toMap(e.clientX - r.left, e.clientY - r.top); const z = Math.min(8, Math.max(1, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); view.cx = mx - (mx - view.cx) * (view.zoom / z); view.cy = my - (my - view.cy) * (view.zoom / z); view.zoom = z; if (z === 1) { view.cx = 0.5; view.cy = 0.5; } draw(); }, { passive: false });
    canvas.addEventListener("dblclick", () => { view = { zoom: 1, cx: 0.5, cy: 0.5 }; draw(); });
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-wm-layer]")) { layers[e.target.dataset.wmLayer] = e.target.checked; savePref(); nearList(); draw(); }
      if (e.target.matches("[data-wm-zone]")) { follow = false; const f = root.querySelector("[data-wm-follow]"); if (f) f.checked = false; savePref(); load(Number(e.target.value)); }
      if (e.target.matches("[data-wm-follow]")) { follow = e.target.checked; savePref(); if (follow && lastLive) load(lastLive.position.mapId); }
    });
    root.addEventListener("submit", async (e) => {
      if (!e.target.matches("[data-wm-search]")) return; e.preventDefault();
      const q = e.target.elements.q.value.trim(); if (!q) return;
      try { results = await api.worldMapSearch(q); } catch (err) { results = { query: q, results: [] }; }
      resultsList();
    });
    root.addEventListener("click", async (e) => {
      const np = e.target.closest("[data-wm-near-pin]");
      if (np) { const p = root.querySelector("[data-wm-near]")._near?.[Number(np.dataset.wmNearPin)]; if (p) { selected = p; view = { zoom: Math.max(view.zoom, 2), cx: p.x, cy: p.y }; card(); draw(); } return; }
      const r = e.target.closest("[data-wm-result]");
      if (r) { const hitR = results.results[Number(r.dataset.wmResult)]; follow = false; const f = root.querySelector("[data-wm-follow]"); if (f) f.checked = false; await load(hitR.mapId); selected = model.pins.find((p) => p.id === hitR.id) || { ...hitR }; view = { zoom: 2.2, cx: hitR.x, cy: hitR.y }; card(); draw(); return; }
      const act = e.target.closest("[data-wm-act]")?.dataset.wmAct; if (!act) return;
      if (act === "in" || act === "out") { view.zoom = Math.min(8, Math.max(1, view.zoom * (act === "in" ? 1.5 : 1 / 1.5))); if (view.zoom === 1) { view.cx = 0.5; view.cy = 0.5; } draw(); }
      if (act === "reset") { view = { zoom: 1, cx: 0.5, cy: 0.5 }; draw(); }
      if (act === "me") { const me = model?.player?.live || model?.player?.saved; if (me) { view = { zoom: Math.max(view.zoom, 2.5), cx: me.x, cy: me.y }; draw(); } }
      if (act === "clear") { results = null; resultsList(); }
      if (act === "radar") { try { await api.openRadar(); } catch {} }
      if (act === "track" && selected) { try { await api.setRadarTarget({ mapId: model.mapId, x: selected.x, y: selected.y, label: selected.label, sub: selected.sub || null, kind: selected.kind }); await api.openRadar(); e.target.textContent = "Tracking on radar"; } catch (err) { e.target.textContent = err.message; } }
      if (act === "way" && selected) { try { const t = await api.copyWaypoint({ mapId: model.mapId, x: selected.x, y: selected.y, label: selected.label }); window.toast?.(t.message); e.target.textContent = "Copied — paste in WoW chat"; } catch (err) { e.target.textContent = err.message; } }
    });
  }
  function mounted() {
    const root = document.querySelector("[data-world-map]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root; bind(); load();
  }
  if (api?.onLiveLink) api.onLiveLink(onLive);
  window.addEventListener("resize", () => { if (document.querySelector("[data-world-map]")) resize(); });
  function focus(f) { if (!f || !Number.isSafeInteger(f.mapId)) return; pendingFocus = f; follow = false; mapId = f.mapId; savePref(); if (document.querySelector("[data-world-map]")) load(f.mapId); }
  return { page, mounted, focus, _state: () => ({ model, selected, view, trail, layers, results }) };
})();
