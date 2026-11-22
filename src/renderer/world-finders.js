"use strict";
// World finders on the World Map (roadmap E4 and W1): the gathering loop for the shown zone, drawn
// with numbered stops, and the list of rare enemies with a known place. The map page owns the
// canvas and the zone; this file owns the two side panels and the loop drawing.
window.WorldFinders = (() => {
  const api = window.backstage;
  const PREF = "bf-world-finders-v1";
  // The loop is drawn once the player asks for it (the tick box, a picker or Send), so the map opens uncluttered.
  let profession = null, extra = true, show = false, view = null, loadedFor = null, busy = false, error = "", notice = "";
  try { const p = JSON.parse(localStorage.getItem(PREF) || "{}"); if (p.profession === "herbalism" || p.profession === "mining") profession = p.profession; if (typeof p.extra === "boolean") extra = p.extra; if (typeof p.show === "boolean") show = p.show; } catch {}
  const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ profession, extra, show })); } catch {} };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => (v * 100).toFixed(1);
  const num = (n) => Number(n).toLocaleString("en-US");

  /** The two panels, placed in the map's side column. */
  function panels() { return `<section class="wm-loop" data-wm-loop aria-label="Gathering loop"></section><section class="wm-rares" data-wm-rares aria-label="Rare enemies" hidden></section>`; }

  // ---------- gathering loop ----------
  let owner = null; // the character the map shows; a loop is per character
  async function sync(mapId, hooks) {
    if (!api?.gatheringLoop || !mapId) return;
    const key = `${owner}:${mapId}:${profession}:${extra}`;
    if (loadedFor === key && view) return;
    loadedFor = key; error = "";
    try { const v = await api.gatheringLoop({ mapId, ...(profession ? { profession } : {}), extra }); if (loadedFor !== key) return; view = v; profession = v.profession; }
    catch (e) { if (loadedFor !== key) return; view = null; error = e?.message || "The gathering loop could not be worked out."; }
    paintLoop(); hooks?.redraw?.();
  }
  function lengthLine(loop) {
    const parts = [`<strong>${loop.stops.length} stops</strong>`];
    if (loop.length.yards) parts.push(`<span>about ${num(Math.round(loop.length.yards / 10) * 10)} yards</span>`);
    if (loop.length.walkMinutes) parts.push(`<span>about ${loop.length.walkMinutes} min on foot</span>`);
    return parts.join("");
  }
  // What the loop is made from, piece by piece, so each piece reads (and translates) on its own.
  function basis(loop) {
    const b = loop.basedOn, chips = [];
    if (b.yours) chips.push(`<span class="wm-loop-src yours">${b.yours} of your own</span>`);
    if (b.community) chips.push(`<span class="wm-loop-src community">${b.community} from the community</span>`);
    if (b.reference) chips.push(`<span class="wm-loop-src reference">${b.reference} from the bundled reference</span>`);
    const notes = ["Past spots, not live nodes."];
    if (b.leftOut) notes.push(b.leftOut === 1 ? "1 quieter place is left out to keep the walk short." : `${b.leftOut} quieter places are left out to keep the walk short.`);
    if (b.tooHigh) notes.push(b.tooHigh === 1 ? "1 spot needs more skill than you have and is left out." : `${b.tooHigh} spots need more skill than you have and are left out.`);
    return `<p class="wm-loop-basis"><span>${b.spots === 1 ? "Based on 1 past spot:" : `Based on ${b.spots} past spots:`}</span>${chips.join("")}</p>${notes.map((n) => `<p class="wm-loop-note">${esc(n)}</p>`).join("")}`;
  }
  function paintLoop() {
    const box = document.querySelector("[data-wm-loop]"); if (!box) return;
    if (!api?.gatheringLoop) { box.hidden = true; return; }
    const v = view, loop = v?.loop;
    const profs = (v?.professions || [{ id: "herbalism", label: "Herbalism" }, { id: "mining", label: "Mining" }]);
    const zones = v?.zones || [];
    const zoneOptions = (zones.some((z) => z.mapId === v?.mapId) || !v?.mapId ? zones : [...zones, { mapId: v.mapId, name: v.mapName, spots: 0 }])
      .map((z) => `<option value="${z.mapId}" ${z.mapId === v?.mapId ? "selected" : ""}>${esc(z.name)} (${z.spots})</option>`).join("");
    const skill = v ? (v.skill === null ? `<p class="wm-loop-skill">Your skill is not known. Open your skills in game, type /reload, and the loop will skip spots that are too hard.</p>` : `<p class="wm-loop-skill">Your skill: <strong>${v.skill}</strong></p>`) : "";
    let body = "";
    if (error) body = `<p class="wm-loop-empty" role="alert">${esc(error)}</p>`;
    else if (!v) body = `<p class="wm-loop-empty">Working out the loop…</p>`;
    else if (loop?.status === "ok") {
      const game = v.inGame;
      const sendNote = !game.canSend ? "Sending needs a character saved by the addon." : game.sent ? "This loop is with the addon. In game: type /reload, then /bf loop." : game.chosen ? `The addon holds another loop: ${game.chosen.mapName}, ${game.chosen.stops} stops.` : "Send it, then in game type /reload and /bf loop.";
      body = `<p class="wm-loop-sum">${lengthLine(loop)}</p>
        ${basis(loop)}
        <label class="check-label wm-loop-check"><input type="checkbox" data-wm-loop-show ${show ? "checked" : ""}>Draw the loop on the map</label>
        <details class="wm-loop-list"><summary>Stops in order</summary><ol>${loop.stops.map((s) => `<li><button type="button" data-wm-loop-stop="${s.n}"><b>${s.n}</b><span>${esc(s.names.join(", ") || "Spot")}</span><small>${pct(s.x)}, ${pct(s.y)}</small></button></li>`).join("")}</ol></details>
        <div class="wm-loop-actions"><button type="button" class="primary" data-wm-loop-send ${game.canSend && !game.sent && !busy ? "" : "disabled"}>${game.sent ? "Sent to game" : "Send loop to game"}</button>${game.chosen ? `<button type="button" data-wm-loop-clear ${busy ? "disabled" : ""}>Remove from game</button>` : ""}</div>
        <p class="wm-loop-game">${esc(notice || sendNote)}</p>`;
    } else {
      body = `<p class="wm-loop-empty">${esc(loop?.note || "No spots are known here yet.")}</p>
        <p class="wm-loop-note">Gather here with the addon running and your spots are remembered. Then type /reload in game and come back.</p>
        ${v.inGame?.chosen ? `<div class="wm-loop-actions"><button type="button" data-wm-loop-clear ${busy ? "disabled" : ""}>Remove from game</button></div><p class="wm-loop-game">${esc(`The addon holds a loop for ${v.inGame.chosen.mapName}, ${v.inGame.chosen.stops} stops.`)}</p>` : ""}`;
    }
    box.hidden = false;
    box.innerHTML = `<h3>Gathering loop</h3>
      <div class="wm-loop-pick">
        <label>Profession<select data-wm-loop-prof aria-label="Gathering profession">${profs.map((p) => `<option value="${p.id}" ${p.id === (v?.profession || profession) ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
        <label>Zone<select data-wm-loop-zone aria-label="Zone for the gathering loop" data-no-translate>${zoneOptions}</select></label>
      </div>${skill}
      <label class="check-label wm-loop-check"><input type="checkbox" data-wm-loop-extra ${extra ? "checked" : ""}>Add community and reference spots</label>
      ${body}`;
  }
  /** The loop on the map canvas: a closed brass line with travel arrows and numbered stops. */
  function draw(ctx, toScreen, mapId) {
    const loop = view?.loop;
    if (!show || !loop || loop.status !== "ok" || view.mapId !== mapId) return;
    const pts = loop.stops.map((s) => toScreen(s.x, s.y));
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const [width, style] of [[7, "rgba(20,12,4,0.75)"], [4, "#f0c25a"], [1.5, "#fff3c4"]]) {
      ctx.lineWidth = width; ctx.strokeStyle = style; ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath(); ctx.stroke();
    }
    // A small arrow half way along each leg shows the walking direction.
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length], d = Math.hypot(nx - x, ny - y);
      if (d < 46) return;
      const a = Math.atan2(ny - y, nx - x), mx = (x + nx) / 2, my = (y + ny) / 2;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5.5); ctx.closePath();
      ctx.fillStyle = "#fff3c4"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#2a1806"; ctx.stroke(); ctx.restore();
    });
    ctx.font = "800 11px 'Source Sans 3', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    loop.stops.forEach((s, i) => {
      const [x, y] = pts[i];
      ctx.beginPath(); ctx.arc(x, y, 10.5, 0, 7);
      ctx.fillStyle = i === 0 ? "#7a1f14" : "#2a1806"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#f0c25a"; ctx.stroke();
      ctx.fillStyle = "#fff3c4"; ctx.fillText(String(s.n), x, y + 0.5);
    });
    ctx.restore();
  }

  // ---------- rare enemies ----------
  function paintRares(model, layerOn) {
    const box = document.querySelector("[data-wm-rares]"); if (!box) return;
    const r = model?.rares;
    if (!r || !r.total || !layerOn) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    const list = r.here.length
      ? `<ul>${r.here.map((x) => `<li><button type="button" data-wm-rare="${x.id}"><span class="wm-rare-mark${x.elite ? " elite" : ""}" aria-hidden="true">★</span><span class="wm-rare-text"><strong>${esc(x.name)}</strong><small>${esc(x.label)} · ${pct(x.x)}, ${pct(x.y)}</small>${x.drops ? `<small data-wm-rare-drops>Players saw it drop: ${esc(x.drops)}</small>` : `<small>No drop recorded yet.</small>`}</span></button></li>`).join("")}</ul>`
      : `<p class="wm-rares-empty">No rare enemy has a known place in this zone yet.</p>`;
    // Drops the bundled names do not cover get their name from the player's own game files.
    const ids = [...new Set(r.here.flatMap((x) => x.dropItems))].slice(0, 60);
    if (ids.length && api?.gameItems) api.gameItems(ids).then((found) => {
      for (const el of document.querySelectorAll("[data-wm-rare-drops]")) el.textContent = el.textContent.replace(/Item #(\d+)/g, (all, id) => found?.[ids.indexOf(Number(id))]?.name || all);
    }).catch(() => {});
    box.innerHTML = `<h3>Rare enemies</h3>${list}<small class="wm-rares-foot">${r.total} rare enemies are known by name. A player recorded a place for ${r.placed} of them, and a drop for ${r.withDrops}. The addon tells you when you meet any of them. Rares are not always up.</small>`;
  }
  /** Card details for a selected rare pin. */
  function rareDetails(p) {
    const drops = (p.drops || []).slice(0, 5);
    const ids = drops.filter((d) => !d.name).map((d) => d.itemId);
    if (ids.length && api?.gameItems) api.gameItems(ids).then((found) => {
      for (const el of document.querySelectorAll("[data-wm-rare-item]")) { const i = ids.indexOf(Number(el.dataset.wmRareItem)); if (i >= 0 && found?.[i]?.name) el.querySelector("span").textContent = found[i].name; }
    }).catch(() => {});
    return `<p class="wm-note">This is where a player met it. Rare enemies are not always up, and some walk a path.</p>${drops.length
      ? `<section class="wm-sec"><h4>Players saw it drop</h4><ul class="wm-items">${drops.map((d) => `<li data-card-item="${d.itemId}" data-wm-rare-item="${d.itemId}"><span>${esc(d.name || `Item #${d.itemId}`)}</span> <small>seen ${d.drops}×</small></li>`).join("")}</ul></section>`
      : `<p class="wm-note">No drop is recorded for this rare yet.</p>`}`;
  }

  // ---------- events (delegated from the map page) ----------
  /** hooks: { mapId(), go(mapId), focus(x, y), selectRare(id), redraw() }. Returns true when handled. */
  function onChange(e, hooks) {
    const t = e.target;
    if (t.matches("[data-wm-loop-prof]")) { profession = t.value; notice = ""; show = true; save(); view = null; paintLoop(); sync(hooks.mapId(), hooks); return true; }
    if (t.matches("[data-wm-loop-extra]")) { extra = t.checked; notice = ""; save(); sync(hooks.mapId(), hooks); return true; }
    if (t.matches("[data-wm-loop-show]")) { show = t.checked; save(); hooks.redraw(); return true; }
    if (t.matches("[data-wm-loop-zone]")) { const id = Number(t.value); notice = ""; show = true; save(); if (Number.isSafeInteger(id) && id !== hooks.mapId()) hooks.go(id); return true; }
    return false;
  }
  async function onClick(e, hooks) {
    const stop = e.target.closest("[data-wm-loop-stop]");
    if (stop) { const s = view?.loop?.stops?.[Number(stop.dataset.wmLoopStop) - 1]; if (s) hooks.focus(s.x, s.y); return true; }
    const rare = e.target.closest("[data-wm-rare]");
    if (rare) { hooks.selectRare(Number(rare.dataset.wmRare)); return true; }
    const send = e.target.closest("[data-wm-loop-send]"), clear = e.target.closest("[data-wm-loop-clear]");
    if (!send && !clear) return false;
    if (busy || !api?.gatheringLoopUse) return true;
    busy = true; notice = ""; if (send) { show = true; save(); hooks.redraw(); } paintLoop();
    try {
      const v = await api.gatheringLoopUse(clear ? null : { mapId: view.mapId, profession: view.profession, extra });
      if (clear) { loadedFor = null; notice = "Removed. The addon forgets the loop at the next /reload."; await sync(hooks.mapId(), hooks); }
      else view = v;
    } catch (err) { notice = err?.message || "The loop could not be sent."; }
    busy = false; paintLoop();
    return true;
  }
  /** Called whenever the map page repaints: keeps the loop in step with the shown zone. */
  function paint(model, hooks, layerOn) {
    paintRares(model, layerOn);
    owner = model?.profileId ?? null;
    // Repaint only an empty panel: a later repaint would close the stop list while you read it.
    const box = document.querySelector("[data-wm-loop]"); if (box && !box.innerHTML) paintLoop();
    if (model?.mapId) sync(model.mapId, hooks);
  }
  function reset() { view = null; loadedFor = null; notice = ""; }
  return { panels, paint, draw, onChange, onClick, rareDetails, reset };
})();
