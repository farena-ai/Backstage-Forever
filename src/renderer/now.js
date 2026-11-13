"use strict";
// Now: the home page. What to do next, where, and how, from your quest log, the leveling
// advisor and the live link. Every action is a suggestion; nothing happens in game by itself.
window.NowView = (() => {
  const api = window.backstage;
  let advice = null, session = null, setup = null, error = "", loading = false, mountedFor = null, lastKey = "", lastFetch = 0, timer = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => (v * 100).toFixed(1);
  const at = (w) => (w && Number.isFinite(w.x) ? `${esc(w.mapName || "")} ${pct(w.x)}, ${pct(w.y)}` : "");
  const mapBtn = (w, label, sub, npcId) => (w && Number.isSafeInteger(w.mapId) && Number.isFinite(w.x)
    ? `<button type="button" data-now-map='${esc(JSON.stringify({ mapId: w.mapId, x: w.x, y: w.y, label, sub: sub || null, npcId: npcId || null }))}'>Show on map</button>` : "");

  function page() {
    return `<section class="now-page" data-now>
      <header class="now-head"><div><span class="now-eyebrow">Now</span><h1 data-now-title>${esc(advice?.character?.name || "Your next move")}</h1><p class="now-live" data-now-live></p></div>
        <button type="button" class="subtle" data-now-act="refresh">Refresh</button></header>
      <div class="now-body" data-now-body>${body()}</div>
    </section>`;
  }

  // The few things worth doing right now, most urgent first.
  function steps(a) {
    const out = [];
    if (a.character.dead || session?.dead) {
      out.push({ kind: "death", title: "You died: run back to your body",
        detail: "In game, click <strong>Release Spirit</strong>. You appear at a graveyard as a ghost; Backstage Forever puts an arrow on your body. Walk over it and click <strong>Resurrect</strong>. The Spirit Healer at the graveyard can revive you on the spot, but your gear loses durability and you stay weak for a while.",
        actions: "" });
    }
    const ready = a.log.ready;
    if (ready.length) {
      const first = ready[0];
      out.push({ kind: "hand-in", title: ready.length === 1 ? `Hand in “${first.title}”` : `Hand in ${ready.length} finished quests`,
        detail: first.turnIn ? `Nearest: ${esc(first.turnIn.name)}${first.turnIn.guess ? " (usually the quest giver)" : ""} · ${at(first.turnIn)}${ready.length > 1 ? ` · also ${ready.slice(1, 3).map((q) => `“${esc(q.title)}”`).join(", ")}${ready.length > 3 ? "…" : ""}` : ""}` : "Hand-in location not recorded yet.",
        actions: mapBtn(first.turnIn, first.turnIn?.name || first.title, `Turn in: ${first.title}`, first.turnIn?.npcId) + `<button type="button" data-quest-open="${first.id}">Open quest</button>` });
    }
    const t = a.training;
    if (t?.newNow?.length && t.trainer) {
      out.push({ kind: "train", title: `Train ${t.newNow.length} new ${esc(t.className)} skill${t.newNow.length === 1 ? "" : "s"}`,
        detail: `${t.newNow.slice(0, 5).map((s) => esc(s.name) + (s.rank ? ` <small>${esc(s.rank)}</small>` : "")).join(", ")}${t.newNow.length > 5 ? "…" : ""} · ${esc(t.trainer.name)}, ${at(t.trainer)}`,
        actions: mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId) });
    }
    const act = a.log.active[0];
    if (act) {
      out.push({ kind: "quest", title: `Continue “${esc(act.title)}”`,
        detail: `${act.next ? esc(act.next) : "Objectives in progress"}${act.total ? ` · ${act.done}/${act.total} done` : ""}${act.where ? ` · ${at(act.where)}` : ""}`,
        actions: mapBtn(act.where, act.title, act.next, null) + `<button type="button" data-quest-open="${act.id}">Open quest</button>` });
    }
    const n = a.next;
    if (n && (n.mapId !== a.character.position?.mapId || out.length < 2)) {
      const where = n.hub ? { mapId: n.mapId, mapName: n.name, x: n.hub.x, y: n.hub.y } : null;
      out.push({ kind: "zone", title: n.mapId === a.character.position?.mapId ? `Keep leveling in ${esc(n.name)}` : `Head to ${esc(n.name)}`,
        detail: esc(n.why) + (n.hub ? ` · most quests start around ${pct(n.hub.x)}, ${pct(n.hub.y)}` : ""),
        actions: mapBtn(where, `${n.name} quest hub`, n.why, null) });
    }
    return out.slice(0, 4);
  }
  const ICON = { death: "✝", "hand-in": "?", train: "⚔", quest: "◎", zone: "➶" };
  const minutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);
  // XP bar with rested bonus, plus this session's pace (from the live link).
  function sessionCard(a) {
    const c = a.character, s = session?.active ? session : null;
    const saved = c.xp && c.xp.savedLevel === c.level ? c.xp : null;
    const pctNow = Number.isFinite(c.xpPercent) ? c.xpPercent : saved ? Math.floor((saved.current / saved.max) * 100) : null;
    const restedPct = saved && saved.rested > 0 && pctNow != null ? Math.min(100 - pctNow, (saved.rested / saved.max) * 100) : 0;
    const bar = pctNow == null ? "" : `<div class="now-xp" role="img" aria-label="${pctNow}% through level ${c.level}"><span class="now-xp-fill" data-w="${pctNow}"></span>${restedPct > 0 ? `<span class="now-xp-rested" data-l="${pctNow}" data-w="${restedPct.toFixed(1)}"></span>` : ""}</div>
      <p class="now-xp-line"><strong>${pctNow}%</strong> of level ${c.level}${restedPct > 0 ? ` · <span class="now-rested">rested bonus</span>` : ""}</p>`;
    const rows = [];
    if (s) {
      rows.push(`<li><strong>${minutes(s.activeMinutes)}</strong><span>played this session</span></li>`);
      rows.push(`<li><strong>${s.levelsGained >= 1 ? `+${s.levelsGained.toFixed(1)}` : `+${Math.round(s.levelsGained * 100)}%`}</strong><span>${s.levelsGained >= 1 ? "levels" : "of a level"}</span></li>`);
      if (s.levelsPerHour) rows.push(`<li><strong>${s.levelsPerHour >= 1 ? s.levelsPerHour.toFixed(1) : `${Math.round(s.levelsPerHour * 100)}%`}</strong><span>${s.levelsPerHour >= 1 ? "levels an hour" : "of a level an hour"}</span></li>`);
      if (s.minutesToLevel) rows.push(`<li><strong>${minutes(s.minutesToLevel)}</strong><span>to level ${(s.level || c.level) + 1}</span></li>`);
      rows.push(`<li><strong>${s.deaths}</strong><span>death${s.deaths === 1 ? "" : "s"}</span></li>`);
      rows.push(`<li><strong>${s.zones.length}</strong><span>zone${s.zones.length === 1 ? "" : "s"} visited</span></li>`);
    }
    return `<article class="now-card now-session"><h2>This session</h2>${bar}
      ${rows.length ? `<ul class="now-stats">${rows.join("")}</ul>${s.levelsPerHour ? "" : `<p class="now-tip">Your pace appears after a few minutes of play.</p>`}` : `<p class="now-tip">Play with the live link on (it is by default) and your pace, time to the next level and deaths appear here.</p>`}
      ${restedPct > 0 ? `<p class="now-tip"><span class="now-rested">Rested</span>: kills give double experience until the blue part of the bar runs out. You build it back by logging out in an inn or a city.</p>` : ""}
    </article>`;
  }
  // First-run checklist: ticks itself off as each piece starts working.
  function setupCard(a) {
    const game = setup?.game, live = setup?.live;
    const hasCharacter = a && a.status !== "no-character";
    const items = [
      { done: Boolean(game?.connected), title: "Connect your WoW Forever folder", how: "Settings → Game connection finds it for you.", action: `<button type="button" data-nav="game">Open Game connection</button>` },
      { done: Boolean(game?.connected && game?.addonCurrent), title: "Install the Backstage Forever addon", how: "One click on the Game connection page. It copies the addon into your game folder." },
      { done: hasCharacter, title: "Log in and type /reload once", how: "In WoW, type <code>/reload</code> in chat and press Enter. Your character appears here." },
      { done: live?.signal === "live" || Boolean(a?.character?.live), title: "See yourself live", how: live?.enabled === false ? "The live link is off. Turn it on in Settings → Game connection." : "Keep WoW running in a window or borderless window. The small strip at the top-left of the game lets this page follow you." },
    ];
    if (items.every((i) => i.done)) return "";
    const next = items.findIndex((i) => !i.done);
    return `<article class="now-card now-setup"><h2>Get set up <small>${items.filter((i) => i.done).length} of ${items.length}</small></h2>
      <ol class="now-checklist">${items.map((i, n) => `<li class="${i.done ? "done" : n === next ? "next" : ""}"><span class="now-check" aria-hidden="true">${i.done ? "✓" : n + 1}</span><div><strong>${i.title}</strong>${i.done ? "" : `<p>${i.how}</p>${n === next && i.action ? `<div class="now-actions">${i.action}</div>` : ""}`}</div></li>`).join("")}</ol>
      <p class="now-tip">New to WoW? The <button type="button" class="now-link" data-nav="guide">Field guide</button> explains the words you'll see, like rested, hand in and elite, and <button type="button" class="now-link" data-nav="commands">Commands</button> lists everything you can type in game.</p></article>`;
  }
  // The game is still running an addon older than the one just installed: one /reload loads it.
  function reloadBanner() {
    const g = setup?.game;
    if (!g?.connected || !g.addonCurrent || g.runtime?.state !== "running" || !g.loadedCaptureVersion || !g.addonVersion || g.loadedCaptureVersion === g.addonVersion) return "";
    return `<div class="now-reload" role="status"><strong>Type <code>/reload</code> in WoW</strong><span>The game is still running Backstage Forever ${esc(g.loadedCaptureVersion)}. Reloading loads ${esc(g.addonVersion)} with the newest helpers.</span></div>`;
  }
  function body() {
    if (error) return `<div class="now-card"><p>${esc(error)}</p></div>`;
    if (!advice) return `<div class="now-card"><p>${loading ? "Working out your next move…" : "Loading…"}</p></div>`;
    if (advice.status === "no-character") return setupCard(advice) || `<div class="now-card"><h2>No character yet</h2><p>Connect your WoW Forever folder in Settings → Game connection, log in once and type <code>/reload</code>. Your characters appear here.</p></div>`;
    if (advice.status === "no-level") return `<div class="now-card"><h2>${esc(advice.name)}</h2><p>Log in on this character and type <code>/reload</code> so the app knows its level.</p></div>`;
    const a = advice, c = a.character, list = steps(a);
    const zones = a.zones.map((z) => `<li class="now-zone now-fit-${esc(z.fit)}"><button type="button" ${z.hub ? `data-now-map='${esc(JSON.stringify({ mapId: z.mapId, x: z.hub.x, y: z.hub.y, label: `${z.name} quest hub`, sub: null }))}'` : "disabled"}><strong>${esc(z.name)}</strong><span>${z.min}–${z.max}${z.observedLevels ? " · seen in play" : ""}</span><span>${z.available ? `${z.available} quests for you` : "no quests recorded yet"}${z.towns.length ? ` · ${esc(z.towns.join(", "))}` : ""}</span><em>${z.fit === "now" ? "Your level" : "Soon"}</em></button></li>`).join("");
    const t = a.training;
    const training = !t ? `<p>Pick a class for this character in Characters to see training.</p>`
      : !t.trainer ? `<p>No ${esc(t.className)} trainer is recorded for your faction yet.</p>`
      : `<p><strong>${esc(t.trainer.name)}</strong> · ${esc(t.trainer.title)}<br><small>${at(t.trainer)}</small></p>
         ${t.newNow.length ? `<p class="now-good">New for you now: ${t.newNow.map((s) => esc(s.name)).join(", ")}</p>` : `<p>Nothing new at level ${c.level}.</p>`}
         ${t.nextAt ? `<p>Next spells at <strong>level ${t.nextAt}</strong>: ${t.nextSpells.slice(0, 6).map((s) => esc(s.name)).join(", ")}${t.nextSpells.length > 6 ? "…" : ""}</p>` : ""}
         <div class="now-actions">${mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId)}</div>`;
    const log = a.log;
    const questLog = log.inLog ? `<ul class="now-log">${log.ready.map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip ready">Hand in</span>${esc(q.title)}</button></li>`).join("")}${log.active.slice(0, 8).map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip">${q.total ? `${q.done}/${q.total}` : "…"}</span>${esc(q.title)}${q.level ? ` <small>lvl ${q.level}</small>` : ""}</button></li>`).join("")}</ul>` : `<p>Your quest log is empty. ${a.next ? `Pick up quests in ${esc(a.next.name)}.` : ""}</p>`;
    const top = a.next?.quests?.length ? `<ul class="now-log">${a.next.quests.slice(0, 6).map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip new">lvl ${q.level}</span>${esc(q.title)} <small>from ${esc(q.giver)}</small></button></li>`).join("")}</ul>` : "";
    return `${reloadBanner()}${setupCard(a)}<div class="now-grid">
      <article class="now-card now-next"><h2>Do this next</h2>
        ${list.length ? `<ol class="now-steps">${list.map((s) => `<li class="now-step now-${s.kind}"><span class="now-ico" aria-hidden="true">${ICON[s.kind]}</span><div><h3>${s.title}</h3><p>${s.detail}</p><div class="now-actions">${s.actions}</div></div></li>`).join("")}</ol>` : `<p>You're all caught up. Explore, gather or run a dungeon.</p>`}
      </article>
      ${sessionCard(a)}
      <article class="now-card"><h2>Where to level</h2><ul class="now-zones">${zones}</ul>${top ? `<h3 class="now-sub">Quests to pick up in ${esc(a.next.name)}</h3>${top}` : ""}</article>
      <article class="now-card"><h2>${esc(c.className || "Class")} training</h2>${training}</article>
      <article class="now-card"><h2>Quest log <small>${log.inLog}</small></h2>${questLog}</article>
    </div>
    <p class="now-src">Zone levels: ${esc(a.source)} Quest, trainer and NPC references: Efficient Games, CC BY 4.0.</p>`;
  }
  function liveLine() {
    const n = document.querySelector("[data-now-live]"); if (!n || !advice?.character) return;
    const c = advice.character;
    n.innerHTML = `Level ${c.level}${c.className ? ` ${esc(c.className)}` : ""}${c.faction ? ` · ${esc(c.faction)}` : ""} · ${c.live ? `<span class="on">● Live</span> in ${esc(c.zone || "")}` : c.zone ? `Last saved in ${esc(c.zone)}` : "Position unknown"}`;
  }
  function paint() {
    const b = document.querySelector("[data-now-body]"); if (!b) return;
    b.innerHTML = body();
    for (const el of b.querySelectorAll(".now-xp [data-w]")) { el.style.width = `${Number(el.dataset.w)}%`; if (el.dataset.l) el.style.left = `${Number(el.dataset.l)}%`; }
    const t = document.querySelector("[data-now-title]"); if (t) t.textContent = advice?.character?.name || advice?.name || "Your next move";
    liveLine();
  }
  async function load() {
    if (loading) return; loading = true; lastFetch = Date.now();
    try {
      const [a, s, game, live] = await Promise.all([api.levelingAdvice(), api.playSession ? api.playSession().catch(() => null) : null,
        api.gameStatus ? api.gameStatus().catch(() => null) : null, api.liveLinkStatus ? api.liveLinkStatus().catch(() => null) : null]);
      advice = a; session = s; setup = { game, live }; error = "";
    } catch (e) { error = e.message || "Advice is unavailable."; }
    loading = false; paint();
  }
  // Live frames: refresh when you change zone, level or quest progress; at most every few seconds.
  function onLive(status) {
    if (!document.querySelector("[data-now]")) return;
    const f = status?.frame;
    const key = f?.position ? [f.position.mapId, f.level, f.questLogHash, f.quest?.objectivesDone?.length, f.dead, Math.floor((f.xpPercent ?? 0) / 5)].join("|") : "none";
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(load, Math.max(0, 4000 - (Date.now() - lastFetch)));
  }
  function bind(root) {
    root.addEventListener("click", (e) => {
      const m = e.target.closest("[data-now-map]");
      if (m) { try { window.WorldMapView?.focus(JSON.parse(m.dataset.nowMap)); document.querySelector('[data-nav="world-map"]')?.click(); } catch {} return; }
      if (e.target.closest('[data-now-act="refresh"]')) load();
    });
  }
  function mounted() {
    const root = document.querySelector("[data-now]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root; bind(root);
    if (advice) paint();
    load();
  }
  function invalidate() { advice = null; lastKey = ""; }
  if (api?.onLiveLink) api.onLiveLink(onLive);
  // Level-up: a short celebration wherever you are in the app.
  function celebrate(level) {
    document.querySelector(".bf-celebrate")?.remove();
    const el = document.createElement("div");
    el.className = "bf-celebrate"; el.setAttribute("role", "status");
    const colors = ["#f6c445", "#ff7a59", "#7fe08a", "#6fc3ff", "#e58cff", "#fff1d6"];
    el.innerHTML = `${"<i></i>".repeat(48)}<div class="bf-celebrate-card"><span>Level up!</span><strong>${esc(level)}</strong><p>New class skills may be waiting at your trainer. Type <code>/bf train</code> in game for an arrow.</p></div>`;
    [...el.querySelectorAll("i")].forEach((bit, i) => {
      bit.style.left = `${(i * 37) % 100}%`; bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${((i * 13) % 20) / 20}s`; bit.style.setProperty("--drift", `${((i * 29) % 160) - 80}px`);
    });
    document.body.appendChild(el);
    el.addEventListener("click", () => el.remove());
    setTimeout(() => el.remove(), 5200);
  }
  if (api?.onPlayEvent) api.onPlayEvent((e) => {
    if (e?.kind === "level" && Number.isInteger(e.level)) celebrate(e.level);
    if (document.querySelector("[data-now]")) { clearTimeout(timer); timer = setTimeout(load, 300); }
  });
  return { page, mounted, invalidate, celebrate, _state: () => ({ advice, session }) };
})();
