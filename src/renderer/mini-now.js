"use strict";
// Mini Now keeps the action visible and supporting detail in a disclosure.
(() => {
  const api = window.miniNow;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { turnin: "Hand in", objective: "Quest objective", pickup: "Pick up", zone: "Next zone", dead: "Death recovery", training: "Training" };
  const EVIDENCE = { live: "Live", saved: "Last saved", reference: "Reference" };
  const who = document.querySelector("[data-mn-who]");
  const action = document.querySelector("[data-mn-step]");
  const panel = document.querySelector("[data-mn-details-panel]");
  const details = document.querySelector("[data-mn-details]");
  const announcement = document.querySelector("[data-mn-announcement]");
  let lastAction = "";
  let lastCard = "";
  let lastDetails = "";
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
    const s = v?.ready ? v.step : null;
    who.textContent = v?.ready ? `${v.name || "?"} · Level ${v.level ?? "?"}` : "Backstage Forever";
    panel.hidden = !v?.ready;
    const place = s?.destination || s?.where?.mapName;
    const direction = s?.dir && s.dir !== `in ${place}` ? s.dir : null;
    const destination = [place, direction].filter(Boolean).join(" · ") || "Destination unavailable";
    const evidence = EVIDENCE[v?.evidence] || "Reference";
    const card = s ? `<section class="mn-step mn-${esc(s.kind)}"><div class="mn-step-header"><span class="mn-kind">${esc(KIND[s.kind] || "Next")}</span><span class="mn-evidence mn-${esc(v.evidence)}">${evidence}</span></div><strong>${esc(s.title)}</strong><span class="mn-destination">${esc(destination)}</span></section>` : `<p class="mn-msg">${esc(v?.message || "No step right now. Open Now for more options.")}</p>`;
    if (card !== lastCard) {
      action.innerHTML = card;
      lastCard = card;
    }
    const xp = Number.isFinite(v?.xpPercent) ? `<div class="mn-xp" role="img" aria-label="${v.xpPercent}% through the level, ${v.restedPercent}% rested"><span class="mn-fill" data-w="${Math.max(0, Math.min(100, v.xpPercent))}"></span><span class="mn-rest" data-l="${Math.max(0, Math.min(100, v.xpPercent))}" data-w="${Math.max(0, Math.min(100 - v.xpPercent, v.restedPercent))}"></span></div>` : "";
    const extra = `${s?.detail ? `<p>${esc(s.detail)}</p>` : ""}${s?.reason ? `<p><strong>Why this?</strong> ${esc(s.reason)}</p>` : ""}${s?.progress ? `<p>${esc(s.progress)} objectives done</p>` : ""}${xp}${pace(v?.pace)}`;
    if (extra !== lastDetails) {
      details.innerHTML = extra;
      lastDetails = extra;
      for (const el of details.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
      for (const el of details.querySelectorAll("[data-l]")) el.style.left = `${Number(el.dataset.l)}%`;
    }
    const key = s ? JSON.stringify([v.name, s.kind, s.key || s.questId || s.title]) : "";
    if (key === lastAction) return;
    lastAction = key;
    announcement.textContent = s ? `Next: ${s.title}` : "";
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-mn='close']")) api.close();
    if (e.target.closest("[data-mn='open-now']")) api.openNow();
  });
  api.onState(render);
  api.state().then(render).catch(() => render(null));
})();
