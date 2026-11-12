"use strict";
// Radar: north-up minimap around the live position. Range is a fraction of the zone map.
(() => {
  const canvas = document.querySelector("[data-radar-canvas]"), ctx = canvas.getContext("2d");
  const zoneEl = document.querySelector("[data-radar-zone]"), targetEl = document.querySelector("[data-radar-target]");
  const COLORS = { "quest-turnin": "#f6c445", "quest-giver": "#f6c445", "quest-objective": "#d9442e", flight: "#4f8fd6", trainer: "#4f9d5a", vendor: "#a8743a", herb: "#5fae3c", ore: "#9a8f86", find: "#e8b33a", town: "#7a1f14", instance: "#8a3fd1", target: "#ffe08a" };
  let state = null, range = 0.12;
  // Zone maps are 1002 x 668: scale y so the radar keeps the map's true proportions.
  const ASPECT = 668 / 1002;
  const arts = new Map();
  function art(mapId) {
    if (!mapId || !window.radar.art) return null;
    if (!arts.has(mapId)) {
      arts.set(mapId, null);
      window.radar.art(mapId).then((png) => png ? createImageBitmap(new Blob([png], { type: "image/png" })) : null).then((b) => { arts.set(mapId, b); draw(); }).catch(() => {});
    }
    return arts.get(mapId);
  }
  const dirName = (dx, dy) => ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 / 45) % 8];
  function band(d) { return d < 0.015 ? "you are there" : d < 0.06 ? "close" : d < 0.2 ? "short ride" : "far"; }
  function draw() {
    const W = canvas.width, C = W / 2, R = C - 10;
    ctx.clearRect(0, 0, W, W);
    // Bronze ring and parchment disc.
    const ring = ctx.createRadialGradient(C, C, R - 6, C, C, R + 8); ring.addColorStop(0, "#5a3a16"); ring.addColorStop(0.5, "#d9b25a"); ring.addColorStop(1, "#3a2410");
    ctx.beginPath(); ctx.arc(C, C, R + 8, 0, 7); ctx.fillStyle = ring; ctx.fill();
    const disc = ctx.createRadialGradient(C, C, 10, C, C, R); disc.addColorStop(0, "#ecdcb4"); disc.addColorStop(1, "#b99a62");
    ctx.beginPath(); ctx.arc(C, C, R, 0, 7); ctx.fillStyle = disc; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(C, C, R, 0, 7); ctx.clip();
    ctx.strokeStyle = "rgba(80,55,25,.25)"; ctx.lineWidth = 1;
    for (const r of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(C, C, R * r, 0, 7); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(C, C - R); ctx.lineTo(C, C + R); ctx.moveTo(C - R, C); ctx.lineTo(C + R, C); ctx.stroke();
    const me = state?.live;
    const toXY = (p) => [C + ((p.x - me.x) / range) * R, C + ((p.y - me.y) * ASPECT / range) * R];
    const bmp = me && art(me.mapId);
    if (bmp) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, C - (me.x / range) * R, C - (me.y * ASPECT / range) * R, R / range, (R * ASPECT) / range); ctx.fillStyle = "rgba(20,12,5,.12)"; ctx.fillRect(0, 0, W, W); }
    if (me) {
      for (const p of state.pins) {
        const [x, y] = toXY(p); if ((x - C) ** 2 + (y - C) ** 2 > R * R) continue;
        if (p.kind === "town") { ctx.font = "700 11px Cinzel, serif"; ctx.textAlign = "center"; ctx.fillStyle = "#3a2410"; ctx.fillText(p.label, x, y - 6); continue; }
        ctx.beginPath(); ctx.arc(x, y, p.kind.startsWith("quest") ? 5.5 : 4, 0, 7); ctx.fillStyle = COLORS[p.kind === "find" ? p.gather === "ore" ? "ore" : "herb" : p.kind] || "#555"; ctx.fill(); ctx.strokeStyle = "#1d1207"; ctx.lineWidth = 1.2; ctx.stroke();
        if (p.kind === "quest-turnin" || p.kind === "quest-giver") { ctx.fillStyle = "#1d1207"; ctx.font = "700 9px Georgia"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.kind === "quest-turnin" ? "?" : "!", x, y + 0.5); }
      }
    }
    ctx.restore();
    // N marker.
    ctx.font = "700 13px Cinzel, Georgia, serif"; ctx.fillStyle = "#2a1406"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("N", C, C - R - 1);
    if (!me) { ctx.fillStyle = "#3a2410"; ctx.font = "600 13px 'Source Sans 3', sans-serif"; ctx.fillText("Waiting for the live link…", C, C); return; }
    // Target: inside the disc, a ring; outside, an arrow on the rim.
    const t = state.target;
    if (t && t.mapId === me.mapId) {
      const [x, y] = toXY(t), dx = x - C, dy = y - C, inside = dx * dx + dy * dy <= (R - 8) ** 2;
      if (inside) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.strokeStyle = "#fff3c0"; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = "#a0701a"; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { const a = Math.atan2(dy, dx); ctx.save(); ctx.translate(C + Math.cos(a) * (R - 4), C + Math.sin(a) * (R - 4)); ctx.rotate(a + Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 6); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fillStyle = "#ffe08a"; ctx.fill(); ctx.strokeStyle = "#3a2008"; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    }
    // Player arrow.
    ctx.save(); ctx.translate(C, C); ctx.rotate(-(me.facing || 0));
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 4); ctx.lineTo(-9, 10); ctx.closePath();
    ctx.fillStyle = me.combat ? "#ff6f5e" : "#ffd65a"; ctx.fill(); ctx.strokeStyle = "#2a1406"; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  function text() {
    const me = state?.live, t = state?.target;
    zoneEl.textContent = me ? `${me.zone} · ${(me.x * 100).toFixed(1)}, ${(me.y * 100).toFixed(1)}` : "Radar · live link off";
    targetEl.classList.toggle("combat", Boolean(state?.combat));
    if (state?.combat) { targetEl.textContent = "In combat — radar details pause."; return; }
    if (!t) { targetEl.textContent = "Pick a pin on the World Map and choose “Track on radar”."; return; }
    if (!me || t.mapId !== me.mapId) { targetEl.innerHTML = `<strong></strong>On another map`; targetEl.querySelector("strong").textContent = t.label; return; }
    const dx = t.x - me.x, dy = t.y - me.y, d = Math.hypot(dx, dy);
    targetEl.innerHTML = `<strong></strong><span></span>`;
    targetEl.querySelector("strong").textContent = t.label;
    targetEl.querySelector("span").textContent = `${d < 0.015 ? "" : dirName(dx, dy) + " · "}${band(d)} · ${(t.x * 100).toFixed(1)}, ${(t.y * 100).toFixed(1)}`;
  }
  function apply(s) { state = s; text(); draw(); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-radar]")?.dataset.radar;
    if (b === "close") window.radar.close();
    if (b === "in") { range = Math.max(0.03, range / 1.5); draw(); }
    if (b === "out") { range = Math.min(0.6, range * 1.5); draw(); }
  });
  window.radar.onState(apply);
  window.radar.state().then(apply).catch(() => apply(null));
  window.__radar = () => ({ state, range });
})();
