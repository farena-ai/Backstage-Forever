"use strict";
// World Map: a cartographer-style zone map with live position, quest and finder pins.
// Original procedural artwork (no game assets). Coordinates are game map percentages.
window.WorldMapView = (() => {
  const api = window.backstage;
  const LAYERS = [
    ["quest-turnin", "Turn-ins"], ["quest-objective", "Objectives"], ["quest-giver", "Quests to pick up"],
    ["flight", "Flight masters"], ["class-trainer", "Class trainers"], ["profession-trainer", "Profession trainers"], ["vendor", "Vendors"],
    ["herb", "Herbs"], ["ore", "Ore"], ["find", "Your finds"], ["npc", "Other NPCs"],
  ];
  const OFF_BY_DEFAULT = new Set(["npc", "otherFaction"]);
  const PREF = "bf-world-map-v2";
  let clusters = [], pendingFocus = null;
  let model = null, mapId = null, follow = true, selected = null, hover = null, trail = [], view = { zoom: 1, cx: 0.5, cy: 0.5 };
  let layers = { ...Object.fromEntries(LAYERS.map(([k]) => [k, !OFF_BY_DEFAULT.has(k)])), otherFaction: false };
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
  // One silhouette per kind so pins read at a glance: shields for quests, a diamond for
  // flight, hexagons for trainers (swords: class, hammer: profession), a square for vendors.
  const COLORS = { "quest-turnin": "#ffd34d", "quest-giver": "#f6c445", "quest-objective": "#d9442e", flight: "#3f86d8", "class-trainer": "#b8462e", "profession-trainer": "#2f9c8f", vendor: "#a8743a", herb: "#5fae3c", ore: "#9a8f86", find: "#e8b33a", npc: "#6b5a48", town: "#3a2a16" };
  function shade(hex, f = 0.55) { const n = parseInt(hex.slice(1), 16); const m = (v) => Math.max(0, Math.floor(v * f)); return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`; }
  function fillShape(g, path, fill, x, y, r) {
    g.save(); g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = 4; g.shadowOffsetY = 1.5;
    const gr = g.createLinearGradient(x, y - r, x, y + r); gr.addColorStop(0, "#fff6d8"); gr.addColorStop(0.18, fill); gr.addColorStop(1, shade(fill));
    path(); g.fillStyle = gr; g.fill(); g.restore();
    path(); g.lineWidth = 1.6; g.strokeStyle = "#1b1006"; g.stroke();
  }
  const poly = (g, x, y, r, n, rot = 0) => () => { g.beginPath(); for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } g.closePath(); };
  const shield = (g, x, y, r) => () => { g.beginPath(); g.moveTo(x - r * 0.85, y - r * 0.85); g.lineTo(x + r * 0.85, y - r * 0.85); g.lineTo(x + r * 0.85, y + r * 0.1); g.quadraticCurveTo(x + r * 0.6, y + r * 0.75, x, y + r * 1.1); g.quadraticCurveTo(x - r * 0.6, y + r * 0.75, x - r * 0.85, y + r * 0.1); g.closePath(); };
  const roundSquare = (g, x, y, r) => () => { g.beginPath(); g.roundRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7, r * 0.35); };
  function text(g, t, x, y, size, color = "#1d1207") { g.fillStyle = color; g.font = `800 ${size}px Georgia, serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, x, y + 1); }
  function leaf(g, x, y, s, color) { g.save(); g.translate(x, y); g.rotate(-0.6); g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.95, 0, 0, s); g.quadraticCurveTo(-s * 0.95, 0, 0, -s); g.fillStyle = color; g.fill(); g.strokeStyle = "#173009"; g.lineWidth = 1.3; g.stroke(); g.beginPath(); g.moveTo(0, -s * 0.8); g.lineTo(0, s * 0.8); g.stroke(); g.restore(); }
  function rock(g, x, y, s) { g.beginPath(); g.moveTo(x - s, y + s * 0.6); g.lineTo(x - s * 0.6, y - s * 0.5); g.lineTo(x + s * 0.1, y - s); g.lineTo(x + s, y - s * 0.2); g.lineTo(x + s * 0.8, y + s * 0.7); g.closePath(); g.fillStyle = "#8d8276"; g.fill(); g.strokeStyle = "#1f1a16"; g.lineWidth = 1.3; g.stroke(); g.fillStyle = "#e0ad45"; g.fillRect(x - s * 0.2, y - s * 0.3, s * 0.35, s * 0.3); }
  function wing(g, x, y, s) { g.save(); g.translate(x, y); g.fillStyle = "#f2f7ff"; g.beginPath(); g.moveTo(-s * 0.9, s * 0.4); g.quadraticCurveTo(-s * 0.2, -s, s * 0.9, -s * 0.6); g.quadraticCurveTo(s * 0.2, -s * 0.1, s * 0.5, s * 0.1); g.quadraticCurveTo(0, 0, -s * 0.9, s * 0.4); g.fill(); g.restore(); }
  function swords(g, x, y, s) { g.save(); g.strokeStyle = "#fff4dc"; g.lineWidth = 2; g.lineCap = "round"; g.beginPath(); g.moveTo(x - s, y + s); g.lineTo(x + s, y - s); g.moveTo(x + s, y + s); g.lineTo(x - s, y - s); g.stroke(); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - s * 0.95, y + s * 0.35); g.lineTo(x - s * 0.35, y + s * 0.95); g.moveTo(x + s * 0.95, y + s * 0.35); g.lineTo(x + s * 0.35, y + s * 0.95); g.stroke(); g.restore(); }
  function hammer(g, x, y, s) { g.save(); g.translate(x, y); g.rotate(-0.6); g.fillStyle = "#fff4dc"; g.fillRect(-s * 0.15, -s * 0.3, s * 0.3, s * 1.3); g.fillRect(-s * 0.75, -s * 0.85, s * 1.5, s * 0.6); g.restore(); }
  function coin(g, x, y, s) { g.beginPath(); g.arc(x, y, s, 0, 7); g.fillStyle = "#f4cf5a"; g.fill(); g.strokeStyle = "#5a3a0c"; g.lineWidth = 1.3; g.stroke(); text(g, "g", x, y - 0.5, s * 1.4, "#5a3a0c"); }
  function star(g, x, y, s) { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.45 : s, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } g.closePath(); g.fillStyle = "#ffe27a"; g.fill(); g.strokeStyle = "#5a3a0c"; g.lineWidth = 1; g.stroke(); }
  // Draw one pin icon centred on (x, y) with radius r into any 2D context.
  function icon(g, kind, x, y, r, { gather = null, zoom = 1 } = {}) {
    const k = kind;
    if (k === "npc") { fillShape(g, poly(g, x, y, r * 0.45, 4, Math.PI / 4), COLORS.npc, x, y, r * 0.45); return; }
    if (k === "town") return;
    if (k === "instance") { const gr = g.createRadialGradient(x, y, 2, x, y, r * 1.7); gr.addColorStop(0, "#f3d9ff"); gr.addColorStop(0.5, "#8a3fd1"); gr.addColorStop(1, "rgba(60,10,90,0)"); g.beginPath(); g.arc(x, y, r * 1.7, 0, 7); g.fillStyle = gr; g.fill(); g.strokeStyle = "#2a0d3d"; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x, y, r * 0.4 + i * r * 0.38, i, i + 4.2); g.stroke(); } return; }
    if (k === "quest-objective") {
      const a = r * 1.5 * zoom ** 0.3; g.beginPath(); g.arc(x, y, a, 0, 7); g.fillStyle = "rgba(217,68,46,0.16)"; g.fill(); g.setLineDash([4, 3]); g.strokeStyle = "rgba(170,40,25,0.85)"; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fillStyle = COLORS[k]; g.fill(); g.strokeStyle = "#fff0d8"; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(x - r * 0.95, y); g.lineTo(x - r * 0.3, y); g.moveTo(x + r * 0.3, y); g.lineTo(x + r * 0.95, y); g.moveTo(x, y - r * 0.95); g.lineTo(x, y - r * 0.3); g.moveTo(x, y + r * 0.3); g.lineTo(x, y + r * 0.95); g.strokeStyle = "#5a0f06"; g.lineWidth = 1.8; g.stroke(); return;
    }
    if (k === "quest-giver" || k === "quest-turnin") {
      if (k === "quest-turnin") { g.beginPath(); g.arc(x, y, r * 1.35, 0, 7); g.fillStyle = "rgba(255,214,80,0.28)"; g.fill(); }
      fillShape(g, shield(g, x, y, r), COLORS[k], x, y, r); text(g, k === "quest-giver" ? "!" : "?", x, y - r * 0.05, r * 1.45); return;
    }
    if (k === "flight") { fillShape(g, poly(g, x, y, r * 1.15, 4, 0), COLORS[k], x, y, r); wing(g, x, y, r * 0.72); return; }
    if (k === "class-trainer") { fillShape(g, poly(g, x, y, r * 1.05, 6, Math.PI / 6), COLORS[k], x, y, r); swords(g, x, y, r * 0.48); return; }
    if (k === "profession-trainer") { fillShape(g, poly(g, x, y, r * 1.05, 6, Math.PI / 6), COLORS[k], x, y, r); hammer(g, x, y, r * 0.62); return; }
    if (k === "vendor") { fillShape(g, roundSquare(g, x, y, r), COLORS[k], x, y, r); coin(g, x, y, r * 0.5); return; }
    if (k === "herb" || (k === "find" && gather !== "ore")) { leaf(g, x, y, r * 0.9, COLORS.herb); if (k === "find") star(g, x + r * 0.65, y - r * 0.65, r * 0.45); return; }
    if (k === "ore" || k === "find") { rock(g, x, y, r * 0.8); if (k === "find") star(g, x + r * 0.65, y - r * 0.65, r * 0.45); return; }
    g.beginPath(); g.arc(x, y, r * 0.7, 0, 7); g.fillStyle = "#999"; g.fill();
  }
  function drawPin(p, sx, sy, emphasis) {
    const r = 9 * (emphasis ? 1.35 : 1);
    if (p.otherFaction) ctx.globalAlpha = 0.55;
    icon(ctx, p.kind, sx, sy, p.kind === "npc" ? r * 1.2 : r, { gather: p.gather, zoom: view.zoom });
    if (p.otherFaction) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(sx - r * 0.8, sy + r * 0.8); ctx.lineTo(sx + r * 0.8, sy - r * 0.8); ctx.strokeStyle = "#c0261a"; ctx.lineWidth = 2.2; ctx.stroke(); }
  }
  // Small canvas icons for lists (legend, search results, near you, card header).
  const ico = (kind, extra = "") => `<canvas class="wm-ico" width="22" height="22" data-ico="${esc(kind)}" ${extra}></canvas>`;
  function paintIcons(box) { for (const c of box?.querySelectorAll?.("canvas[data-ico]") || []) { const g = c.getContext("2d"); g.clearRect(0, 0, 22, 22); icon(g, c.dataset.ico, 11, 11, c.dataset.ico === "quest-objective" ? 7 : 7.5, { gather: c.dataset.gather || null }); } }

  // ---------- drawing ----------
  function visiblePins() { return (model?.pins || []).filter((p) => p.kind === "town" || (layers[p.kind] !== false && (!p.otherFaction || layers.otherFaction))); }
  function draw() {
    if (!canvas || !ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const [ox, oy] = toScreen(0, 0), [ex, ey] = toScreen(1, 1);
    const art = arts.get(model?.mapId)?.bitmap;
    if (art) { ctx.fillStyle = "#1a1008"; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingQuality = "high"; ctx.drawImage(art, ox, oy, ex - ox, ey - oy); }
    else ctx.drawImage(parchment, ox, oy, ex - ox, ey - oy);
    // Ink washes where the world is known: a soft sense of settlements and roads (parchment only).
    ctx.save(); ctx.globalCompositeOperation = "multiply"; if (art) ctx.globalAlpha = 0;
    for (const p of model?.pins || []) { const [sx, sy] = toScreen(p.x, p.y); const r = 26 * Math.max(1, view.zoom * 0.7); const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, "rgba(120,90,50,0.10)"); g.addColorStop(1, "rgba(120,90,50,0)"); ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r); }
    ctx.restore();
    // Places you have travelled with the live link on: your own roads.
    const ex2 = explored(model?.mapId);
    if (ex2.length) { ctx.save(); ctx.strokeStyle = "rgba(110,72,28,0.45)"; ctx.lineWidth = Math.max(2, 3 * view.zoom ** 0.5); ctx.lineCap = "round"; ctx.setLineDash([2, 5]); ctx.beginPath(); ex2.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); const prev = ex2[i - 1]; if (i && prev && Math.hypot(prev[0] - x, prev[1] - y) < 0.03) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }); ctx.stroke(); ctx.restore(); }
    // Grid with coordinates.
    ctx.strokeStyle = art ? "rgba(60,40,18,0.10)" : "rgba(80,55,25,0.18)"; ctx.lineWidth = 1; ctx.fillStyle = "rgba(60,40,18,0.7)"; ctx.font = "11px 'Source Sans 3', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let i = 0; i <= 10; i++) { const [gx] = toScreen(i / 10, 0), [, gy] = toScreen(0, i / 10); ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx, ey); ctx.moveTo(ox, gy); ctx.lineTo(ex, gy); ctx.stroke(); if (i < 10) { ctx.fillText(String(i * 10), gx + 3, Math.max(oy, 0) + 3); ctx.fillText(String(i * 10), Math.max(ox, 0) + 3, gy + 3); } }
    if (!art) compassRose(w - 58, h - 62, 38);
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
    for (const p of art ? [] : visiblePins().filter((p) => p.kind === "town")) {
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
    if (pl?.saved && !pl.live) { const [sx, sy] = toScreen(pl.saved.x, pl.saved.y); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.setLineDash([3, 3]); ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); ctx.font = "600 11px 'Source Sans 3'"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; const lw = ctx.measureText("last saved").width + 10; ctx.fillStyle = "rgba(245,232,200,0.92)"; ctx.beginPath(); ctx.roundRect(sx - lw / 2, sy + 11, lw, 15, 3); ctx.fill(); ctx.fillStyle = "#3a2410"; ctx.fillText("last saved", sx, sy + 19); }
    trail.forEach((t, i) => { if (t.mapId !== model?.mapId) return; const [sx, sy] = toScreen(t.x, t.y); ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7); ctx.fillStyle = `rgba(70,190,255,${(i + 1) / trail.length * 0.85})`; ctx.fill(); });
    if (pl?.live) arrow(...toScreen(pl.live.x, pl.live.y), pl.live.facing, pl.live.combat);
  }
  function compassRose(x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.8;
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.18, 0); ctx.lineTo(-r * 0.18, 0); ctx.closePath(); ctx.fillStyle = i === 3 ? "#7a1f14" : "#4a321a"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, 7); ctx.strokeStyle = "#4a321a"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = "700 13px Cinzel, serif"; ctx.fillStyle = "#3a2410"; ctx.textAlign = "center"; ctx.fillText("N", 0, -r - 8); ctx.restore();
  }
  // Cool blue on a dark disc so the arrow reads on the warm, gold zone art as well as on parchment.
  function arrow(x, y, facing, combat) {
    const ring = combat ? "#ff5a4a" : "#62d6ff";
    ctx.save(); ctx.translate(x, y);
    const glow = ctx.createRadialGradient(0, 0, 14, 0, 0, 30); glow.addColorStop(0, combat ? "rgba(255,70,50,0.55)" : "rgba(80,200,255,0.55)"); glow.addColorStop(1, "rgba(80,200,255,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.fillStyle = "rgba(12,20,34,0.82)"; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = ring; ctx.stroke();
    ctx.rotate(-(facing || 0));
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 4); ctx.lineTo(-10, 10); ctx.closePath();
    const g = ctx.createLinearGradient(0, -14, 0, 10); g.addColorStop(0, "#ffffff"); g.addColorStop(1, combat ? "#ff9a8a" : "#9fe8ff");
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#08121e"; ctx.stroke(); ctx.restore();
  }

  // ---------- side panel ----------
  function legend() {
    const box = document.querySelector("[data-wm-legend]"); if (!box) return;
    box.innerHTML = `<h3>Layers</h3>` + LAYERS.map(([k, label]) => `<label class="wm-layer"><input type="checkbox" data-wm-layer="${k}" ${layers[k] !== false ? "checked" : ""}>${ico(k, k === "find" ? 'data-gather="herb"' : "")}${esc(label)} <small>${model?.counts?.[k] || 0}</small></label>`).join("")
      + (model?.counts?.otherFaction ? `<label class="wm-layer wm-layer-other"><input type="checkbox" data-wm-layer="otherFaction" ${layers.otherFaction ? "checked" : ""}><span class="wm-ico-other">⊘</span>Other faction's NPCs <small>${model.counts.otherFaction}</small></label>` : "");
    paintIcons(box);
  }
  function relation(p) {
    const me = model?.player?.live || model?.player?.saved;
    if (!me) return "";
    const dx = p.x - me.x, dy = p.y - me.y, d = Math.hypot(dx, dy);
    const how = d < 0.02 ? "right here" : `${dirName(dx, dy)}, ${d < 0.08 ? "close" : d < 0.25 ? "a short ride" : "across the zone"}`;
    return `<p class="wm-rel">${model.player.live ? "From you (live)" : "From your last saved spot"}: <strong>${esc(how)}</strong></p>`;
  }
  // Status words for quests on an NPC card, in the selected character's terms.
  const QSTATUS = { ready: ["Ready to turn in", "ready"], active: ["In your log", "active"], available: ["Available", "available"], low: ["Low level", "low"], "too-high": ["Level too low", "high"], done: ["Done", "done"], "other-faction": ["Other faction", "other"] };
  let npcInfo = null, npcFor = null;
  function questRows(list, verb) {
    return `<ul class="wm-qlist">${list.map((q) => { const [label, cls] = QSTATUS[q.status] || ["", ""]; const lvl = q.level ? `<small>lvl ${q.level}${q.status === "too-high" && q.minLevel ? ` · needs ${q.minLevel}` : ""}</small>` : ""; return `<li><button type="button" class="wm-qbtn" data-quest-open="${q.id}" title="Open in Quests"><span class="wm-qtitle">${esc(q.title)}</span>${lvl}<span class="wm-qchip wm-q-${cls}">${verb && q.status === "available" ? esc(verb) : esc(label)}</span></button></li>`; }).join("")}</ul>`;
  }
  function npcSections(d) {
    if (!d) return "";
    const parts = [];
    const side = d.sides?.length ? `<span class="wm-faction wm-f-${d.otherFaction ? "other" : "ok"}">${esc(d.sides.join(" & "))}${d.otherFaction ? " · not your faction" : ""}</span>` : "";
    parts.push(`<p class="wm-roles">${esc(d.roles.join(" · ") || "NPC")} ${side}</p>`);
    if (d.flight) parts.push(`<p class="wm-note">Flight master for <strong>${esc(d.flight.town)}</strong>. Talk to them to learn this flight path.</p>`);
    if (d.questsGiven.length) parts.push(`<section class="wm-sec"><h4>Quests given (${d.questsGiven.length})</h4>${questRows(d.questsGiven)}</section>`);
    if (d.questsTurnedIn.length) parts.push(`<section class="wm-sec"><h4>Quests handed in here (${d.questsTurnedIn.length})</h4>${questRows(d.questsTurnedIn, "Hand in here")}</section>`);
    if (d.trainer) {
      const sv = d.trainer.services;
      if (d.trainer.kind === "class-trainer" && d.trainer.forYou === false) {
        parts.push(`<section class="wm-sec"><h4>Trains · ${esc(d.trainer.title)}</h4><p class="wm-note">Teaches ${esc(d.trainer.teaches)}s only, not your class (${sv.length} skills).</p></section>`);
      } else if (d.trainer.kind === "class-trainer" && sv.some((s) => s.learnable !== null)) {
        const now = sv.filter((s) => s.learnable), later = sv.filter((s) => s.learnable === false);
        parts.push(`<section class="wm-sec"><h4>Trains · ${esc(d.trainer.title)}</h4>${now.length ? `<p class="wm-learn">You can learn now (${now.length})</p><ul class="wm-spells">${now.map((s) => `<li>${esc(s.name)}${s.rank ? ` <small>${esc(s.rank)}</small>` : ""}</li>`).join("")}</ul>` : ""}${later.length ? `<details><summary>Later (${later.length})</summary><ul class="wm-spells">${later.map((s) => `<li>${esc(s.name)}${s.rank ? ` <small>${esc(s.rank)}</small>` : ""} <small>lvl ${s.level}</small></li>`).join("")}</ul></details>` : ""}</section>`);
      } else if (sv.length) {
        parts.push(`<section class="wm-sec"><h4>Trains · ${esc(d.trainer.title)} (${sv.length})</h4><ul class="wm-spells">${sv.slice(0, 30).map((s) => `<li>${esc(s.name)}${s.rank ? ` <small>${esc(s.rank)}</small>` : ""}${s.skillRank ? ` <small>skill ${s.skillRank}</small>` : s.level ? ` <small>lvl ${s.level}</small>` : ""}</li>`).join("")}</ul></section>`);
      }
    }
    if (d.vendor?.items.length) parts.push(`<section class="wm-sec"><details ${d.vendor.items.length <= 8 ? "open" : ""}><summary>Sells (${d.vendor.items.length})</summary><ul class="wm-items">${d.vendor.items.map((i) => `<li>${esc(i.name)}</li>`).join("")}</ul></details></section>`);
    const elsewhere = d.places.filter((p) => p.mapId !== model?.mapId);
    if (elsewhere.length) parts.push(`<p class="wm-note">Also seen in ${elsewhere.map((p) => `${esc(p.mapName)} ${pct(p.x)}, ${pct(p.y)}`).join("; ")}.</p>`);
    if (!d.questsGiven.length && !d.questsTurnedIn.length && !d.trainer && !d.vendor && !d.flight) parts.push(`<p class="wm-note">No quests, training or wares are recorded for this NPC yet.</p>`);
    return parts.join("");
  }
  async function loadNpc(p) {
    if (!p?.npcId || !api?.worldMapNpc) return;
    if (npcFor === p.npcId && npcInfo) return;
    npcFor = p.npcId; npcInfo = null;
    try { const d = await api.worldMapNpc(p.npcId); if (npcFor === p.npcId) { npcInfo = d; card(); } } catch { if (npcFor === p.npcId) { npcInfo = false; card(); } }
  }
  function card() {
    const box = document.querySelector("[data-wm-card]"); if (!box) return;
    if (!selected) { box.innerHTML = `<div class="wm-card-empty"><strong>Click any pin</strong> to see who it is, what they offer you and how to get there.<br>Use <em>Find</em> to search every zone.</div>`; return; }
    const p = selected;
    const details = p.npcId ? (npcFor === p.npcId && npcInfo ? npcSections(npcInfo) : npcInfo === false ? `<p class="wm-note">Details could not be loaded.</p>` : `<p class="wm-note">Loading details…</p>`) : "";
    box.innerHTML = `<div class="wm-card-head">${ico(p.kind, p.gather ? `data-gather="${esc(p.gather)}"` : "")}<div><h3>${esc(p.label)}</h3>${p.sub ? `<p class="wm-sub">${esc(p.sub)}</p>` : ""}</div></div>
      <p class="wm-coords">${esc(model.mapName)} · ${pct(p.x)}, ${pct(p.y)}</p>${relation(p)}
      ${details}
      <div class="wm-card-actions"><button type="button" class="primary" data-wm-act="way">Copy waypoint for WoW</button><button type="button" data-wm-act="track">Track on radar</button>${p.questId ? `<button type="button" data-quest-open="${p.questId}">Open quest</button>` : ""}</div>
      <p class="wm-src">${esc(p.source || "")}${p.lastSeen ? ` · seen ${esc(p.lastSeen)}` : ""}${p.build ? ` · build ${esc(p.build)}` : ""}</p>`;
    paintIcons(box);
    if (p.npcId && npcFor !== p.npcId) loadNpc(p);
  }
  // Say why the arrow is not live, in the player's terms.
  function notLive() {
    const sig = window.LiveLink?.status?.()?.signal || "off";
    return ({ off: "live link off (Settings → Game connection)", minimized: "WoW is minimized", nogame: "WoW is not running", small: "game window too small", "no-signal": "keep WoW visible for live position", stale: "game window covered", starting: "connecting…", error: "reconnecting…" })[sig] || "not live";
  }
  function liveLine() {
    const n = document.querySelector("[data-wm-live]"); if (!n) return;
    const pl = model?.player;
    n.textContent = pl?.live ? `● Live · ${pct(pl.live.x)}, ${pct(pl.live.y)}${pl.live.mounted ? " · mounted" : ""}` : pl?.liveElsewhere ? `● Live in ${pl.liveElsewhere.mapName}` : pl?.liveIssue === "unsaved-character" ? "WoW is on a new character · /reload once in game so the app can link it" : pl?.liveIssue === "other-character" ? `${pl?.saved ? "Last saved position · " : ""}WoW is on another character (switch above)` : `${pl?.saved ? "Last saved position · " : ""}${notLive()}`;
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
    box.innerHTML = `<h3>Found ${results.results.length} for “${esc(results.query)}”</h3>` + (results.results.length ? `<ol>${results.results.map((r, i) => `<li><button type="button" data-wm-result="${i}">${ico(r.kind, r.gather ? `data-gather="${esc(r.gather)}"` : "")}<span><strong>${esc(r.label)}</strong><small>${esc(r.sub || "")}${r.sub ? " · " : ""}${esc(r.mapName)} ${pct(r.x)}, ${pct(r.y)}</small></span></button></li>`).join("")}</ol>` : `<p>Nothing in the local reference matches. Coverage grows as you and others play.</p>`) + `<button type="button" class="subtle" data-wm-act="clear">Clear search</button>`;
    paintIcons(box);
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
    box.innerHTML = `<h3>Near you${model.player.live ? "" : " (last saved)"}</h3><ol>${near.map(({ p, d }, i) => `<li><button type="button" data-wm-near-pin="${i}">${ico(p.kind, p.gather ? `data-gather="${esc(p.gather)}"` : "")}<span><strong>${esc(p.label)}</strong><small>${esc(p.sub || "")}${p.sub ? " · " : ""}${d < 0.02 ? "right here" : `${dirName(p.x - me.x, p.y - me.y)}, ${d < 0.08 ? "close" : d < 0.25 ? "short ride" : "far"}`}</small></span></button></li>`).join("")}</ol>`;
    box._near = near.map((n) => n.p);
    paintIcons(box);
  }
  function paintAll() { const t = document.querySelector("[data-wm-title]"); if (t && model) t.textContent = model.mapName; attrib(); loadArt(model?.mapId); legend(); card(); liveLine(); zoneSelect(); resultsList(); nearList(); draw(); }

  // ---------- data ----------
  // Real zone art from the player's own game install; parchment when unavailable.
  const arts = new Map();
  async function loadArt(id) {
    if (!id || arts.has(id) || !api?.mapArt) return;
    arts.set(id, { pending: true });
    try {
      const r = await api.mapArt(id);
      const bitmap = r?.png ? await createImageBitmap(new Blob([r.png], { type: "image/png" })) : null;
      arts.set(id, { bitmap, source: r?.source || null, reason: r?.reason || null });
    } catch { arts.set(id, { bitmap: null, reason: "Map art unavailable." }); }
    if (model?.mapId === id) { attrib(); draw(); }
  }
  function attrib() {
    const a = document.querySelector("[data-wm-attrib]"); if (!a || !model) return;
    const art = arts.get(model.mapId);
    a.textContent = `${art?.bitmap ? `Map art: ${art.source} (read on this PC, never uploaded). ` : art?.reason ? `${art.reason} ` : ""}${model.attribution}`;
  }
  async function load(next) {
    if (loading) return; loading = true;
    try {
      const m = await api.worldMap(next ? { mapId: next } : mapId ? { mapId } : {});
      if (m.mapId !== model?.mapId) { selected = null; view = { zoom: 1, cx: 0.5, cy: 0.5 }; }
      model = m; mapId = m.mapId; error = "";
      if (pendingFocus && pendingFocus.mapId === m.mapId) {
        // Prefer the real pin (an NPC from another page); otherwise mark the spot itself.
        const f = pendingFocus;
        const real = f.npcId ? model.pins.filter((p) => p.npcId === f.npcId).sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0] : null;
        const pin = real || { id: "focus", kind: f.kind || (f.npcId ? "npc" : "instance"), npcId: f.npcId || undefined, label: f.label, sub: f.sub || null, mapId: m.mapId, x: f.x, y: f.y, source: f.source || (f.kind || f.npcId ? "From your advisor" : "Classic-era baseline (approximate entrance)") };
        if (!real) model.pins.push(pin);
        selected = pin; view = { zoom: 2.2, cx: pin.x, cy: pin.y }; pendingFocus = null;
      }
      if (m.player?.live) pushTrail(m.mapId, m.player.live);
    } catch (e) { error = e.message; }
    loading = false; paintAll();
  }
  function pushTrail(id, p) { remember(id, p); const last = trail[trail.length - 1]; if (!last || last.mapId !== id || Math.hypot(last.x - p.x, last.y - p.y) > 0.002) { trail.push({ mapId: id, x: p.x, y: p.y }); if (trail.length > 60) trail.shift(); } }
  let foreignKey = null;
  function onLive(status) {
    const f = status?.frame;
    if (!document.querySelector("[data-world-map]")) return;
    if (!f?.position) { if (model?.player?.live) { delete model.player.live; draw(); } liveLine(); return; }
    // A frame from a different (or not yet saved) character: rebuild once so the map explains it.
    const key = model?.player?.liveKey;
    if (key != null && f.characterHash && f.characterHash !== key) {
      if (f.characterHash !== foreignKey) { foreignKey = f.characterHash; if (model.player.live) delete model.player.live; load(mapId); }
      return;
    }
    foreignKey = null;
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
