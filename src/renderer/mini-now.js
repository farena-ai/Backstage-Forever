"use strict";
// Mini Now (0.44): next step, experience and pace in a small always-on-top window.
(() => {
  const api = window.miniNow;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { turnin: "Hand in", objective: "Objective", pickup: "Pick up", zone: "Next zone", dead: "Dead" };
  function pace(p) {
    if (!p) return "";
    const bits = [];
    if (p.levelsPerHour) bits.push(`${p.levelsPerHour} levels/hour`);
    if (p.minutesToLevel) bits.push(`next level in ~${p.minutesToLevel} min`);
    if (!bits.length) bits.push(`${p.minutes} min this session`);
    if (p.deaths) bits.push(`${p.deaths} death${p.deaths === 1 ? "" : "s"}`);
    return `<p class="mn-pace">${bits.map(esc).join(" · ")}</p>`;
  }
  function render(v) {
    const body = document.querySelector("[data-mn-body]"), who = document.querySelector("[data-mn-who]");
    if (!body) return;
    if (!v?.ready) { body.innerHTML = `<p class="mn-msg">${esc(v?.message || "No character yet.")}</p>`; return; }
    who.textContent = `${v.name || "?"} · ${v.level ?? "?"}${v.zone ? ` · ${v.zone}` : ""}`;
    const s = v.step;
    const step = s ? `<section class="mn-step mn-${esc(s.kind)}"><span class="mn-kind">${esc(KIND[s.kind] || "Next")}${s.progress ? ` · ${esc(s.progress)}` : ""}</span><strong>${esc(s.title)}</strong><span class="mn-detail">${esc(s.detail || "")}${s.dir ? ` <em>${esc(s.dir)}</em>` : ""}</span></section>` : `<p class="mn-msg">No step right now. Pick a zone on Now.</p>`;
    const xp = v.xpPercent === null ? "" : `<div class="mn-xp" role="img" aria-label="${v.xpPercent}% through the level, ${v.restedPercent}% rested"><span class="mn-fill" data-w="${Math.max(0, Math.min(100, v.xpPercent))}"></span><span class="mn-rest" data-l="${Math.max(0, Math.min(100, v.xpPercent))}" data-w="${Math.max(0, Math.min(100 - v.xpPercent, v.restedPercent))}"></span></div>`;
    body.innerHTML = `${step}${xp}${pace(v.pace)}${v.live ? "" : `<p class="mn-note">Live link off: showing your last save.</p>`}`;
    for (const el of body.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of body.querySelectorAll("[data-l]")) el.style.left = `${Number(el.dataset.l)}%`;
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-mn='close']")) api.close(); });
  api.onState(render);
  api.state().then(render).catch(() => render(null));
})();
