"use strict";
// Now: the home page. What to do next, where, and how, from your quest log, the leveling
// advisor and the live link. Every action is a suggestion; nothing happens in game by itself.
window.NowView = (() => {
  const api = window.backstage;
  let advice = null, session = null, setup = null, error = "", loading = false, setting = "", mountedFor = null, lastKey = "", lastFetch = 0, timer = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => (v * 100).toFixed(1);
  const at = (w) => (w && Number.isFinite(w.x) ? `${esc(w.mapName || "")} ${pct(w.x)}, ${pct(w.y)}` : "");
  // goal: what to do at the target, shown on the map's focus card ({ title, steps[], questId? }).
  const mapBtn = (w, label, sub, npcId, goal) => (w && Number.isSafeInteger(w.mapId) && Number.isFinite(w.x)
    ? `<button type="button" data-now-map='${esc(JSON.stringify({ mapId: w.mapId, x: w.x, y: w.y, label, sub: sub || null, npcId: npcId || null, goal: goal || null }))}'>Show on map</button>` : "");

  function page() {
    return `<section class="now-page" data-now>
      <header class="now-head"><img class="now-class-crest" data-now-crest alt="" width="84" height="84" hidden><div><span class="now-eyebrow">Now</span><h1 data-now-title>${esc(advice?.character?.name || "Your next move")}</h1><p class="now-live" data-now-live></p></div>
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
        actions: mapBtn(first.turnIn, first.turnIn?.name || first.title, `Turn in: ${first.title}`, first.turnIn?.npcId,
          { title: `Hand in “${first.title}”`, questId: first.id, steps: [`Go to ${first.turnIn?.name || "the quest giver"}${first.turnIn?.guess ? " (quests usually go back to whoever gave them)" : ""}.`, `Talk to them and choose “${first.title}”.`, "Pick your reward and click Complete Quest.", ...(ready.length > 1 ? [`Also ready: ${ready.slice(1, 4).map((q) => q.title).join(", ")}.`] : [])] }) + `<button type="button" data-quest-open="${first.id}">Open quest</button>` });
    }
    const t = a.training;
    if (t?.newNow?.length && t.trainer) {
      out.push({ kind: "train", title: `Train ${t.newNow.length} new ${esc(t.className)} skill${t.newNow.length === 1 ? "" : "s"}`,
        detail: `${t.newNow.slice(0, 5).map((s) => esc(s.name) + (s.rank ? ` <small>${esc(s.rank)}</small>` : "")).join(", ")}${t.newNow.length > 5 ? "…" : ""} · ${esc(t.trainer.name)}, ${at(t.trainer)}`,
        actions: mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId,
          { title: `Train at ${t.trainer.name}`, steps: [`Go to ${t.trainer.name}, ${t.trainer.title}.`, `Talk to them and learn: ${t.newNow.slice(0, 6).map((s) => s.name + (s.rank ? ` (${s.rank})` : "")).join(", ")}${t.newNow.length > 6 ? "…" : ""}.`, "Training costs a little money; drag new abilities onto your action bar."] }) });
    }
    const act = a.log.active[0];
    if (act) {
      out.push({ kind: "quest", title: `Continue “${esc(act.title)}”`,
        detail: `${act.next ? esc(act.next) : "Objectives in progress"}${act.total ? ` · ${act.done}/${act.total} done` : ""}${act.where ? ` · ${at(act.where)}` : ""}`,
        actions: mapBtn(act.where, act.title, act.next, null,
          { title: `Continue “${act.title}”`, questId: act.id, steps: [act.next ? `${act.next}.` : "Work on the quest objectives around here.", ...(act.total ? [`${act.done} of ${act.total} objectives done.`] : []), "Come back to the quest giver when it says complete."] }) + `<button type="button" data-quest-open="${act.id}">Open quest</button>` });
    }
    const n = a.next;
    if (n && (n.mapId !== a.character.position?.mapId || out.length < 2)) {
      const where = n.hub ? { mapId: n.mapId, mapName: n.name, x: n.hub.x, y: n.hub.y } : null;
      out.push({ kind: "zone", title: n.mapId === a.character.position?.mapId ? `Keep leveling in ${esc(n.name)}` : `Head to ${esc(n.name)}`,
        detail: esc(n.why) + (n.hub ? ` · most quests start around ${pct(n.hub.x)}, ${pct(n.hub.y)}` : ""),
        actions: mapBtn(where, `${n.name} quest hub`, n.why, null,
          { title: `Quest hub in ${n.name}`, steps: [n.why, ...(n.quests?.length ? [`Pick up: ${n.quests.slice(0, 4).map((q) => q.title).join(", ")}${n.quests.length > 4 ? "…" : ""}.`] : []), "Look for the yellow ! over people's heads."] }) });
    }
    return out.slice(0, 4);
  }
  const CLASSES = new Set(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);
  // Classic rule: at or below this quest/mob level you get no experience.
  const greyAt = (lvl) => (lvl <= 5 ? 0 : lvl <= 39 ? lvl - 5 - Math.floor(lvl / 10) : lvl - 1 - Math.floor(lvl / 5));
  const ICON = { death: "✝", "hand-in": "?", train: "⚔", quest: "◎", zone: "➶" };
  // Painted crests per step and a painted vista per kind of landscape (original art, art/NOTICE.md).
  const crest = (kind) => `<img class="now-crest" src="art/steps/${kind}.png" alt="" width="44" height="44">`;
  const BIOME = new Proxy({}, { get: (_t, id) => window.ZoneArt?.biome(Number(id)) || undefined });
  const minutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);
  // XP bar with rested bonus, plus this session's pace (from the live link).
  function sessionCard(a) {
    const c = a.character, s = session?.active ? session : null;
    const saved = c.xp && c.xp.savedLevel === c.level ? c.xp : null;
    const pctNow = Number.isFinite(c.xpPercent) ? c.xpPercent : saved ? Math.floor((saved.current / saved.max) * 100) : null;
    const restedPct = saved && saved.rested > 0 && pctNow != null ? Math.min(100 - pctNow, (saved.rested / saved.max) * 100) : 0;
    const bar = pctNow == null ? "" : `<div class="now-xp" role="img" aria-label="${pctNow}% through level ${c.level}"><span class="now-xp-fill" data-w="${pctNow}"></span>${restedPct > 0 ? `<span class="now-xp-rested" data-l="${pctNow}" data-w="${restedPct.toFixed(1)}"></span>` : ""}</div>
      <p class="now-xp-line"><strong>${pctNow}%</strong> of level ${c.level}${restedPct > 0 ? ` · <span class="now-rested">rested bonus</span>` : ""}${c.live ? "" : ` · <span class="now-saved">from your last save (logout or /reload)</span>`}</p>`;
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
    // One click does every step the app can do by itself: find WoW, install the addon, turn on the live link.
    const canDo = !game?.connected || !game?.addonCurrent || live?.enabled === false;
    const oneClick = canDo ? `<div class="now-oneclick"><button type="button" data-now-act="setup"${setting === "working" ? " disabled" : ""}>${setting === "working" ? "Setting up…" : "Set it all up"}</button><span>${setting && setting !== "working" ? esc(setting) : "Finds WoW Forever, installs the addon and turns on the live link. Nothing to download or type."}</span></div>` : "";
    return `<article class="now-card now-setup"><h2>Get set up <small>${items.filter((i) => i.done).length} of ${items.length}</small></h2>
      ${oneClick}<ol class="now-checklist">${items.map((i, n) => `<li class="${i.done ? "done" : n === next ? "next" : ""}"><span class="now-check" aria-hidden="true">${i.done ? "✓" : n + 1}</span><div><strong>${i.title}</strong>${i.done ? "" : `<p>${i.how}</p>${n === next && i.action ? `<div class="now-actions">${i.action}</div>` : ""}`}</div></li>`).join("")}</ol>
      <p class="now-tip">New to WoW? The <button type="button" class="now-link" data-nav="guide">Field guide</button> explains the words you'll see, like rested, hand in and elite, and <button type="button" class="now-link" data-nav="commands">Commands</button> lists everything you can type in game.</p></article>`;
  }
  // The game is still running an addon older than the one just installed: one /reload loads it.
  function reloadBanner() {
    const sig = setup?.live?.signal;
    if (sig === "old-addon") return `<div class="now-reload" role="status"><strong>Type <code>/reload</code> in WoW</strong><span>The game is still running an older Backstage Forever addon, so this page can't follow you live and shows your last save instead. One /reload fixes it.</span></div>`;
    if (sig === "unreadable") return `<div class="now-reload" role="status"><strong>Live link can't read the game</strong><span>The strip is on screen but its colours are being changed (HDR, Night light, a colour filter or a remote session). Type <code>/reload</code> in WoW once; if this stays, turn the filter off for WoW. Until then this page shows your last save.</span></div>`;
    const g = setup?.game;
    if (!g?.connected || !g.addonCurrent || g.runtime?.state !== "running" || !g.loadedCaptureVersion || !g.addonVersion || g.loadedCaptureVersion === g.addonVersion) return "";
    const saved = Date.parse(g.lastSync || ""), landed = Date.parse(g.addonUpdatedAt || "");
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const early = Number.isFinite(saved) && Number.isFinite(landed) && saved < landed && landed - saved < 15 * 60000;
    const when = early ? ` Your last /reload was at ${clock(saved)}, ${Math.max(1, Math.round((landed - saved) / 1000))} seconds before the update landed at ${clock(landed)}, so the game is still running the old addon: one more /reload fixes it.` : Number.isFinite(landed) ? ` The update landed at ${clock(landed)}. If you just reloaded, the update probably landed a moment later: reload once more and this goes away within a few seconds.` : " If you just reloaded, the update probably landed a moment later: reload once more and this goes away within a few seconds.";
    return `<div class="now-reload" role="status"><strong>Type <code>/reload</code> in WoW</strong><span>Your last save came from Backstage Forever ${esc(g.loadedCaptureVersion)}; the installed addon is ${esc(g.addonVersion)}.${esc(when)}</span></div>`;
  }
  function body() {
    if (error) return `<div class="now-card"><p>${esc(error)}</p></div>`;
    if (!advice) return `<div class="now-card"><p>${loading ? "Working out your next move…" : "Loading…"}</p></div>`;
    if (advice.status === "no-character") return setupCard(advice) || `<div class="now-card"><h2>No character yet</h2><p>Connect your WoW Forever folder in Settings → Game connection, log in once and type <code>/reload</code>. Your characters appear here.</p></div>`;
    if (advice.status === "no-level") return `<div class="now-card"><h2>${esc(advice.name)}</h2><p>Log in on this character and type <code>/reload</code> so the app knows its level.</p></div>`;
    const a = advice, c = a.character, list = steps(a);
    const zones = a.zones.map((z) => `<li class="now-zone now-fit-${esc(z.fit)}${BIOME[z.mapId] ? ` biome-${BIOME[z.mapId]}` : ""}"><button type="button" ${z.hub ? `data-now-map='${esc(JSON.stringify({ mapId: z.mapId, x: z.hub.x, y: z.hub.y, label: `${z.name} quest hub`, sub: null, goal: { title: `Quest hub in ${z.name}`, steps: [`Levels ${z.min}–${z.max}${z.available ? `, ${z.available} quests you can pick up` : ""}.`, ...(z.quests?.length ? [`Start with: ${z.quests.slice(0, 3).map((q) => q.title).join(", ")}.`] : []), ...(z.towns?.length ? [`Friendly towns: ${z.towns.join(", ")}.`] : [])] } }))}'` : "disabled"}><strong>${esc(z.name)}</strong><span>${z.min}–${z.max}${z.observedLevels ? " · seen in play" : ""}</span><span>${z.available ? `${z.available} quests for you` : "no quests recorded yet"}${z.towns.length ? ` · ${esc(z.towns.join(", "))}` : ""}</span><em>${z.fit === "now" ? "Your level" : "Soon"}</em></button></li>`).join("");
    const t = a.training;
    const training = !t ? `<p>Pick a class for this character in Characters to see training.</p>`
      : !t.trainer ? `<p>No ${esc(t.className)} trainer is recorded for your faction yet.</p>`
      : `<p><strong>${esc(t.trainer.name)}</strong> · ${esc(t.trainer.title)}<br><small>${at(t.trainer)}</small></p>
         ${t.newNow.length ? `<p class="now-good">New for you now: ${t.newNow.map((s) => esc(s.name)).join(", ")}</p>` : `<p>Nothing new at level ${c.level}.</p>`}
         ${t.nextAt ? `<p>Next spells at <strong>level ${t.nextAt}</strong>: ${t.nextSpells.slice(0, 6).map((s) => esc(s.name)).join(", ")}${t.nextSpells.length > 6 ? "…" : ""}</p>` : ""}
         <div class="now-actions">${mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId, { title: `Your ${t.className} trainer`, steps: [`${t.trainer.name}, ${t.trainer.title}.`, t.newNow.length ? `Ready to learn: ${t.newNow.map((s) => s.name).join(", ")}.` : `Nothing new until level ${t.nextAt || c.level + 1}.`] })}</div>`;
    const log = a.log;
    const questLog = log.inLog ? `<ul class="now-log">${log.ready.map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip ready">Hand in</span>${esc(q.title)}</button></li>`).join("")}${log.active.slice(0, 8).map((q) => { const grey = q.level && q.level <= greyAt(c.level); return `<li><button type="button" data-quest-open="${q.id}"${grey ? ' title="This quest no longer gives experience at your level. Finish it only if you want the reward or the story; otherwise it\'s safe to abandon to free up your log."' : ""}><span class="now-chip">${q.total ? `${q.done}/${q.total}` : "…"}</span>${esc(q.title)}${q.level ? ` <small>lvl ${q.level}</small>` : ""}${grey ? ` <span class="now-chip grey">No XP · safe to drop</span>` : ""}</button></li>`; }).join("")}</ul>` : `<p>Your quest log is empty. ${a.next ? `Pick up quests in ${esc(a.next.name)}.` : ""}</p>`;
    // Quests handed in since the last save (live): shown done, so nothing old reads as still to do.
    const done = log.justDone?.length ? `<h3 class="now-sub">Just completed</h3><ul class="now-log now-done">${log.justDone.map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip done">✓ Completed</span>${esc(q.title)}</button></li>`).join("")}</ul>` : "";
    const top = a.next?.quests?.length ? `<ul class="now-log">${a.next.quests.slice(0, 6).map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip new">lvl ${q.level}</span>${esc(q.title)} <small>from ${esc(q.giver)}</small></button></li>`).join("")}</ul>` : "";
    // Two independent columns, so a tall card on one side never leaves a gap on the other.
    return `${reloadBanner()}${setupCard(a)}<div class="now-grid"><div class="now-col now-col-main">
      <article class="now-card now-next"><h2>Do this next</h2>
        ${list.length ? `<ol class="now-steps">${list.map((s) => `<li class="now-step now-${s.kind}"><span class="now-ico now-ico-art" aria-hidden="true">${crest(s.kind)}</span><div><h3>${s.title}</h3><p>${s.detail}</p><div class="now-actions">${s.actions}</div></div></li>`).join("")}</ol>` : `<p>You're all caught up. Explore, gather or run a dungeon.</p>`}
      </article>
      <article class="now-card now-questlog"><h2>Quest log <small>${log.inLog}</small>${log.live ? ' <span class="now-fresh live">● Live</span>' : ' <span class="now-fresh">from your last save</span>'}</h2>${questLog}${done}</article>
      </div><div class="now-col now-col-side">
      ${sessionCard(a)}
      <article class="now-card"><h2>Where to level</h2><ul class="now-zones">${zones}</ul>${top ? `<h3 class="now-sub">Quests to pick up in ${esc(a.next.name)}</h3>${top}` : ""}</article>
      <article class="now-card"><h2>${esc(c.className || "Class")} training</h2>${training}</article>
    </div></div>
    <p class="now-src">Zone levels: ${esc(a.source)} Quest, trainer and NPC references: Efficient Games, CC BY 4.0.</p>`;
  }
  function liveLine() {
    const n = document.querySelector("[data-now-live]"); if (!n || !advice?.character) return;
    const c = advice.character;
    const mins = c.savedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(c.savedAt)) / 60000)) : null;
    const ago = Number.isFinite(mins) ? (mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.floor(mins / 60)} hr ago` : `${Math.floor(mins / 1440)} days ago`) : "";
    n.innerHTML = `Level ${c.level}${c.className ? ` ${esc(c.className)}` : ""}${c.faction ? ` · ${esc(c.faction)}` : ""} · ${c.live ? `<span class="on">● Live</span> in ${esc(c.zone || "")}` : c.zone ? `Last saved in ${esc(c.zone)}` : "Position unknown"}${ago ? ` <span class="now-saved-at">· save from ${esc(ago)}</span>` : ""}`;
  }
  function paint() {
    const b = document.querySelector("[data-now-body]"); if (!b) return;
    b.innerHTML = body();
    for (const el of b.querySelectorAll(".now-xp [data-w]")) { el.style.width = `${Number(el.dataset.w)}%`; if (el.dataset.l) el.style.left = `${Number(el.dataset.l)}%`; }
    const t = document.querySelector("[data-now-title]"); if (t) t.textContent = advice?.character?.name || advice?.name || "Your next move";
    const crestEl = document.querySelector("[data-now-crest]"), cls = String(advice?.character?.className || "").toLowerCase();
    if (crestEl) { if (CLASSES.has(cls)) { crestEl.src = `art/classes/${cls}.png`; crestEl.hidden = false; } else crestEl.hidden = true; }
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
    if (setup && setup.live?.signal !== status?.signal) { setup.live = status; lastKey = ""; }
    const key = f?.position ? [f.position.mapId, f.level, f.questLogHash, f.quest?.objectivesDone?.length, f.dead, Math.floor((f.xpPercent ?? 0) / 5)].join("|") : "none";
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(load, Math.max(0, 4000 - (Date.now() - lastFetch)));
  }
  async function oneClickSetup() {
    if (setting === "working") return;
    setting = "working"; paint();
    try {
      const r = await api.startCompanion();
      if (r?.setupCandidates?.length > 1) { setting = "Found more than one WoW install: pick yours on the Game connection page."; document.querySelector('[data-nav="game"]')?.click(); }
      else if (!r?.connected) setting = "Couldn't find WoW Forever automatically. Pick its folder on the Game connection page (Settings).";
      else {
        const live = await api.liveLinkStatus?.().catch(() => null);
        if (live && live.enabled === false) await api.setLiveLink(true);
        setting = "Done. Log in to WoW (or type /reload if it's running) and your character appears here.";
      }
    } catch (e) { setting = e?.message || "Setup couldn't finish. Try the Game connection page in Settings."; }
    await load();
  }
  function bind(root) {
    root.addEventListener("click", (e) => {
      const m = e.target.closest("[data-now-map]");
      if (m) { try { window.WorldMapView?.focus(JSON.parse(m.dataset.nowMap)); document.querySelector('[data-nav="world-map"]')?.click(); } catch {} return; }
      if (e.target.closest('[data-now-act="refresh"]')) load();
      if (e.target.closest('[data-now-act="setup"]')) oneClickSetup();
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
  // Level-up: a big celebration wherever you are in the app. Click, Continue or Escape to dismiss.
  const MILESTONES = Object.freeze({
    10: "Talent points start now: open your Talents window and spend your first point.",
    20: "A fifth of the way to 60. Dungeons for your level are worth a look in Adventure → Dungeons.",
    30: "Halfway to 60! Check your gear: quest rewards around here are a big step up.",
    40: "Level 40: riding becomes possible. Ask your faction's mount vendor and riding trainer.",
    50: "The last stretch. Ten levels to go.",
    60: "Level 60, the summit! Every dungeon and raid is open to you now.",
  });
  const SOUND_PREF = "bf-celebrate-sound";
  const soundOn = () => { try { return localStorage.getItem(SOUND_PREF) !== "off"; } catch { return true; } };
  // A short, quiet fanfare synthesized on the spot (no audio files).
  function fanfare() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(), now = ctx.currentTime;
      const master = ctx.createGain(); master.gain.value = 0.12; master.connect(ctx.destination);
      [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.38], [783.99, 0.62], [1046.5, 0.74]].forEach(([f, t], i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i < 4 ? "triangle" : "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, now + t); g.gain.linearRampToValueAtTime(1, now + t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, now + t + (i === 5 ? 1.4 : 0.45));
        o.connect(g); g.connect(master); o.start(now + t); o.stop(now + t + 1.5);
      });
      setTimeout(() => ctx.close().catch(() => {}), 2600);
    } catch {}
  }
  function celebrate(level) {
    document.querySelector(".bf-celebrate")?.remove();
    const el = document.createElement("div");
    el.className = "bf-celebrate"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", `Level ${level}`);
    const colors = ["#f6c445", "#ff7a59", "#7fe08a", "#6fc3ff", "#e58cff", "#fff1d6", "#ffd34d"];
    const t = advice?.training, trainer = t?.trainer;
    const news = t?.newNow?.length && trainer ? `<div class="bf-news"><h3>New for you</h3><p>${t.newNow.length} new ${esc(t.className || "class")} skill${t.newNow.length === 1 ? "" : "s"} at <strong>${esc(trainer.name)}</strong>: ${t.newNow.slice(0, 4).map((s) => esc(s.name)).join(", ")}${t.newNow.length > 4 ? "…" : ""}</p>${Number.isSafeInteger(trainer.mapId) ? `<button type="button" class="bf-go" data-celebrate-map='${esc(JSON.stringify({ mapId: trainer.mapId, x: trainer.x, y: trainer.y, npcId: trainer.npcId || null, label: trainer.name, sub: trainer.title, goal: { title: `Train at ${trainer.name}`, steps: [`Go to ${trainer.name}.`, `Learn: ${t.newNow.slice(0, 6).map((s) => s.name).join(", ")}.`] } }))}'>Show trainer on map</button>` : ""}</div>`
      : `<div class="bf-news"><p>New class skills may be waiting at your trainer. Type <code>/bf train</code> in game for an arrow.</p></div>`;
    const milestone = MILESTONES[level] ? `<p class="bf-milestone">${esc(MILESTONES[level])}</p>` : "";
    el.innerHTML = `<div class="bf-rays" aria-hidden="true"></div><div class="bf-rays bf-rays-2" aria-hidden="true"></div><div class="bf-shock" aria-hidden="true"></div>
      <div class="bf-bits" aria-hidden="true">${"<i></i>".repeat(140)}</div>
      <div class="bf-fireworks" aria-hidden="true">${[0, 1, 2].map(() => `<b>${"<s></s>".repeat(18)}</b>`).join("")}</div>
      <div class="bf-celebrate-card">
        <h2 class="bf-title">Level up!</h2>
        <div class="bf-crest"><strong data-bf-level>${esc(Math.max(1, level - 1))}</strong></div>
        <p class="bf-reached">You reached level ${esc(level)}</p>
        ${milestone}${news}
        <div class="bf-actions"><button type="button" class="bf-continue" data-celebrate-close>Continue</button><button type="button" class="bf-sound" data-celebrate-sound aria-pressed="${soundOn()}">${soundOn() ? "Sound on" : "Sound off"}</button></div>
      </div>`;
    // CSP forbids inline styles: position the pieces from code.
    [...el.querySelectorAll(".bf-bits i")].forEach((bit, i) => {
      bit.style.left = `${(i * 37 + (i % 7) * 11) % 100}%`; bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${((i * 13) % 40) / 20}s`; bit.style.animationDuration = `${2.4 + ((i * 17) % 20) / 10}s`;
      bit.style.setProperty("--drift", `${((i * 29) % 220) - 110}px`); if (i % 3 === 0) bit.classList.add("wide");
    });
    [...el.querySelectorAll(".bf-fireworks b")].forEach((b, k) => {
      b.style.left = ["22%", "78%", "50%"][k]; b.style.top = ["30%", "26%", "16%"][k]; b.style.animationDelay = `${0.5 + k * 0.55}s`;
      [...b.querySelectorAll("s")].forEach((sp, i) => { const a = (i / 18) * Math.PI * 2; sp.style.setProperty("--dx", `${Math.cos(a) * 140}px`); sp.style.setProperty("--dy", `${Math.sin(a) * 140}px`); sp.style.background = colors[(i + k) % colors.length]; sp.style.animationDelay = `${0.5 + k * 0.55}s`; });
    });
    const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 380); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", (e) => {
      const go = e.target.closest("[data-celebrate-map]");
      if (go) { try { window.WorldMapView?.focus(JSON.parse(go.dataset.celebrateMap)); document.querySelector('[data-nav="world-map"]')?.click(); } catch {} close(); return; }
      const snd = e.target.closest("[data-celebrate-sound]");
      if (snd) { const on = !soundOn(); try { localStorage.setItem(SOUND_PREF, on ? "on" : "off"); } catch {} snd.textContent = on ? "Sound on" : "Sound off"; snd.setAttribute("aria-pressed", String(on)); if (on) fanfare(); return; }
      if (e.target.closest("[data-celebrate-close]") || !e.target.closest(".bf-celebrate-card")) close();
    });
    document.body.appendChild(el);
    setTimeout(() => { const n = el.querySelector("[data-bf-level]"); if (n) { n.textContent = String(level); n.classList.add("bump"); } }, 700);
    if (soundOn()) fanfare();
    el.querySelector("[data-celebrate-close]")?.focus({ preventScroll: true });
    setTimeout(() => { if (el.isConnected) close(); }, 9000);
  }
  if (api?.onPlayEvent) api.onPlayEvent((e) => {
    if (e?.kind === "level" && Number.isInteger(e.level)) celebrate(e.level);
    if (document.querySelector("[data-now]")) { clearTimeout(timer); timer = setTimeout(load, 300); }
  });
  return { page, mounted, invalidate, celebrate, _state: () => ({ advice, session }) };
})();
