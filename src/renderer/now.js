"use strict";
// Now: the home page. What to do next, where, and how, from your quest log, the leveling
// advisor and the live link. Every action is a suggestion; nothing happens in game by itself.
window.NowView = (() => {
  const api = window.backstage;
  let weekly = null, history = null, loadedFor = null;
  let advice = null, zone = null, lastZoneId = null, session = null, setup = null, error = "", request = null, setting = "", mountedFor = null, lastKey = "", lastFetch = 0, timer = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => (v * 100).toFixed(1);
  const at = (w) => (w && Number.isFinite(w.x) ? `${esc(w.mapName || "")} ${pct(w.x)}, ${pct(w.y)}` : "");
  // goal: what to do at the target, shown on the map's focus card ({ title, steps[], questId? }).
  const mapBtn = (w, label, sub, npcId, goal) => (w && Number.isSafeInteger(w.mapId) && Number.isFinite(w.x)
    ? `<button type="button" data-now-map='${esc(JSON.stringify({ mapId: w.mapId, x: w.x, y: w.y, label, sub: sub || null, npcId: npcId || null, goal: goal || null }))}'>Show on map</button>` : "");

  const activeId = () => document.querySelector("#active-character")?.value || null;
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const dismissPrefix = "bf-now-dismissed-v1:";
  const dismissStorage = id => dismissPrefix + id;
  let dismissals = null, displayedDismissal = null;
  function removeDismissals(profileId = null) {
    if (profileId === null || dismissals?.id === profileId) dismissals = null;
    if (profileId === null || displayedDismissal?.id === profileId) displayedDismissal = null;
    // The old picker and controls can still be mounted while the shell refreshes.
    if (mountedFor && (profileId === null || activeId() === profileId)) {
      mountedFor = null;
      request = null;
      clearTimeout(timer);
    }
    try {
      if (profileId !== null) localStorage.removeItem(dismissStorage(profileId));
      else for (const key of Object.keys(localStorage)) if (key.startsWith(dismissPrefix)) localStorage.removeItem(key);
    } catch {}
  }
  function dismissed() {
    const id = activeId(), today = day();
    if (dismissals?.id === id && dismissals.day === today) return dismissals;
    let keys = [];
    try {
      const saved = JSON.parse(localStorage.getItem(dismissStorage(id)));
      if (saved?.day === today && Array.isArray(saved.keys)) keys = saved.keys.filter(k => typeof k === "string").slice(-32);
    } catch {}
    return dismissals = { id, day: today, keys };
  }
  function dismissButton(key) {
    if (!key || !activeId()) return "";
    displayedDismissal = { id: activeId(), key };
    return '<button type="button" data-now-dismiss title="Hide this suggestion for this character until tomorrow">Not now</button>';
  }
  const nextHeading = '<h2 tabindex="-1" data-now-next-heading>Do this next</h2>';
  const heroTitle = (a) => a?.character?.name || a?.name || "Your next move";
  const heroIdentity = (c) => c ? JSON.stringify([c.race, c.sex, c.className, c.faction]) : "";
  const hero = (a) => PageHero.render({ art: "now", compact: true, character: a?.character,
    eyebrow: "Now", title: esc(heroTitle(a)), titleAttrs: "data-now-title", subAttrs: "data-now-live",
    attrs: `data-now-identity="${esc(heroIdentity(a?.character))}"`,
    aside: '<button type="button" class="now-badge-case" data-nav="badges" data-active-badge-case data-now-badge-case><img src="art/badge-level.webp" alt="" width="24" height="24">Open Badge Case <span aria-hidden="true">→</span></button>' +
      (window.SpokenSteps ? SpokenSteps.control() + " " : "") + '<button type="button" class="subtle" data-now-act="mini" title="A small always-on-top window with your next step, beside the game">Mini Now</button> <button type="button" class="subtle" data-now-act="refresh">Refresh</button>' });

  function page() {
    // The shell's character selector is replaced just after this markup is built. Only
    // mount/paint reads the new selection, so no previous character flashes on a switch.
    return `<section class="now-page" data-now>
      ${hero(null)}
      <div class="now-body" data-now-body><p class="now-card" role="status">Working out your next move…</p></div>
    </section>`;
  }

  // 1.4 (J17, J18): reminders across your characters, and this week in one line.
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
  function weekStrip() {
    const r = weekly?.reminders || [], me = weekly?.recap?.active;
    const line = me && me.played ? `<p class="now-week"><strong>This week:</strong> ${me.levelsGained ? `+${me.levelsGained} level${me.levelsGained === 1 ? "" : "s"}` : "no new levels"}${me.badges.length ? ` · ${me.badges.length} badge${me.badges.length === 1 ? "" : "s"}` : ""}${me.minutes ? ` · ${mins(me.minutes)} played` : ""}${me.gold ? ` · ${me.gold > 0 ? "+" : "−"}${gsc(Math.abs(me.gold))}` : ""} <button type="button" class="now-link" data-nav="journey">Journey →</button></p>` : "";
    const chips = r.length ? `<ul class="now-reminders" aria-label="Reminders">${r.map((x) => `<li class="now-rem now-rem-${x.kind}">${esc(x.text)}</li>`).join("")}</ul>` : "";
    return chips || line ? `<aside class="now-weekly" data-now-weekly aria-label="Weekly recap and reminders">${chips}${line}</aside>` : "";
  }
  // 1.3 (J10): what the next training visits cost, from the trainer window you opened, and your gold.
  const gsc = (copper) => { const v = Math.max(0, Math.round(copper || 0)), g = Math.floor(v / 10000), sv = Math.floor(v / 100) % 100, cc = v % 100; return [g ? `${g}g` : "", sv ? `${sv}s` : "", !g && cc ? `${cc}c` : ""].filter(Boolean).join(" ") || "0c"; };
  function trainingCost(t, c) {
    if (!t?.trainer) return "";
    const k = t.costs;
    if (!k) return `<p class="now-cost-hint"><small>Open your trainer's window once in game and /reload: the app then shows what each visit costs and whether you can afford it.</small></p>`;
    const first = k.levels[0];
    const rows = k.levels.filter((l) => l.known).map((l) => `<li><span class="now-plan-lv">${l.level}</span><span>${esc(gsc(l.total))}${l.known < l.of ? ` <small>(${l.known} of ${l.of} spells priced)</small>` : ""}</span></li>`).join("");
    const verdict = !first || !first.known ? "" : k.canAffordNext === true ? `<p class="now-good">You have ${esc(gsc(k.money))}: enough for level ${first.level}'s training.</p>`
      : k.canAffordNext === false ? `<p class="now-warn">Level ${first.level}'s training costs ${esc(gsc(first.total))}; you're short by ${esc(gsc(k.shortBy))}.</p>` : "";
    return `<div class="now-cost" data-now-cost>${k.nowTotal ? `<p>Ready to learn now: about <strong>${esc(gsc(k.nowTotal))}</strong>.</p>` : ""}${rows ? `<h3 class="now-sub">Training costs</h3><ol class="now-plan now-costs">${rows}</ol>` : ""}${verdict}<p><small>Prices from your trainer's window${k.seenAt ? `, seen ${esc(new Date(k.seenAt * 1000).toLocaleDateString([], { month: "short", day: "numeric" }))}` : ""}. Spells you haven't seen there yet aren't counted.</small></p></div>`;
  }
  // The few things worth doing right now, most urgent first.
  function steps(a, hidden, pinnedQuest) {
    const out = [];
    if (a.character.dead || session?.dead) {
      out.push({ kind: "death", title: "You died: run back to your body", reason: "The live link reported your character is dead.",
        detail: "In game, click <strong>Release Spirit</strong>. You appear at a graveyard as a ghost; Backstage Forever puts an arrow on your body. Walk over it and click <strong>Resurrect</strong>. The Spirit Healer at the graveyard can revive you on the spot, but your gear loses durability and you stay weak for a while.",
        actions: "" });
    }
    const questSource = a.log.live ? "your latest live quest log" : a.character.savedAt ? "your saved quest log" : "the character’s quest log (save time unknown)";
    const first = a.log.ready.find(q => q.id !== pinnedQuest && !hidden.includes(`hand-in:${q.id}`));
    if (first) {
      out.push({ kind: "hand-in", key: `hand-in:${first.id}`, title: `Hand in “${esc(first.title)}”`, reason: `Ready to turn in according to ${questSource}.`,
        detail: first.turnIn ? `${esc(first.turnIn.name)}${first.turnIn.guess ? " (usually the quest giver)" : ""}${at(first.turnIn) ? ` · ${at(first.turnIn)}` : ""}` : "Hand-in location not recorded yet.",
        actions: mapBtn(first.turnIn, first.turnIn?.name || first.title, `Turn in: ${first.title}`, first.turnIn?.npcId,
          { title: `Hand in “${first.title}”`, questId: first.id, steps: [`Go to ${first.turnIn?.name || "the quest giver"}${first.turnIn?.guess ? " (quests usually go back to whoever gave them)" : ""}.`, `Talk to them and choose “${first.title}”.`, "Pick your reward and click Complete Quest."] }) + `<button type="button" data-quest-open="${first.id}">Open quest</button>` });
    }
    const t = a.training;
    if (t?.newNow?.length && t.trainer) {
      out.push({ kind: "train", key: `train:${a.character.level}:${t.className}`, title: `Check ${t.newNow.length} ${esc(t.className)} skill${t.newNow.length === 1 ? "" : "s"} at your trainer`, reason: `Training reference for level ${a.character.level}; check in game what you already know.`,
        detail: `${t.newNow.slice(0, 5).map((s) => esc(s.name) + (s.rank ? ` <small>${esc(s.rank)}</small>` : "")).join(", ")}${t.newNow.length > 5 ? "…" : ""} · ${esc(t.trainer.name)}, ${at(t.trainer)}`,
        actions: mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId,
          { title: `Train at ${t.trainer.name}`, steps: [`Go to ${t.trainer.name}, ${t.trainer.title}.`, `Talk to them and learn: ${t.newNow.slice(0, 6).map((s) => s.name + (s.rank ? ` (${s.rank})` : "")).join(", ")}${t.newNow.length > 6 ? "…" : ""}.`, "Training costs a little money; drag new abilities onto your action bar."] }) });
    }
    const act = a.log.active.find(q => q.id !== pinnedQuest && !hidden.includes(`quest:${q.id}`));
    if (act) {
      out.push({ kind: "quest", key: `quest:${act.id}`, title: `Continue “${esc(act.title)}”`, reason: `Still in progress in ${questSource}.${a.log.live && act.total ? " Objective details come from saved data." : ""}`,
        detail: `${act.next ? esc(act.next) : "Objectives in progress"}${act.total ? ` · ${act.done}/${act.total} done` : ""}${act.where ? ` · ${at(act.where)}` : ""}`,
        actions: mapBtn(act.where, act.title, act.next, null,
          { title: `Continue “${act.title}”`, questId: act.id, steps: [act.next ? `${act.next}.` : "Work on the quest objectives around here.", ...(act.total ? [`${act.done} of ${act.total} objectives done.`] : []), "Come back to the quest giver when it says complete."] }) + `<button type="button" data-quest-open="${act.id}">Open quest</button>` });
    }
    const n = a.next;
    if (n && (n.mapId !== a.character.position?.mapId || out.length < 2)) {
      const where = n.hub ? { mapId: n.mapId, mapName: n.name, x: n.hub.x, y: n.hub.y } : null;
      out.push({ kind: "zone", key: `zone:${n.mapId}`, title: n.mapId === a.character.position?.mapId ? `Keep leveling in ${esc(n.name)}` : `Head to ${esc(n.name)}`, reason: `Leveling reference for your character at level ${a.character.level}. Check quest availability in game.`,
        detail: esc(n.why) + (n.hub ? ` · most quests start around ${pct(n.hub.x)}, ${pct(n.hub.y)}` : ""),
        actions: mapBtn(where, `${n.name} quest hub`, n.why, null,
          { title: `Quest hub in ${n.name}`, steps: [n.why, ...(n.quests?.length ? [`Pick up: ${n.quests.slice(0, 4).map((q) => q.title).join(", ")}${n.quests.length > 4 ? "…" : ""}.`] : []), "Look for the yellow ! over people's heads."] }) });
    }
    return out.filter(s => !hidden.includes(s.key)).slice(0, 4);
  }
  const stepRow = (s, primary = false, savedAt = null) => `<li class="now-step now-${s.kind}${primary ? " now-step-priority" : ""}"><span class="now-ico now-ico-art" aria-hidden="true">${crest(s.kind)}</span><div><h3>${s.title}</h3><p>${s.detail}</p>${primary ? `<p class="now-reason"><strong>Why this?</strong> ${esc(s.reason)}${savedAt ? ` <small>Saved ${esc(savedAt)}.</small>` : ""}</p>` : ""}<div class="now-actions">${primary ? s.actions.replace('<button ', '<button class="primary" ') + dismissButton(s.key) : s.actions}</div></div></li>`;

  // Classic rule: at or below this quest/mob level you get no experience.
  const greyAt = (lvl) => (lvl <= 5 ? 0 : lvl <= 39 ? lvl - 5 - Math.floor(lvl / 10) : lvl - 1 - Math.floor(lvl / 5));

  // Painted crests per step and a painted vista per kind of landscape (original art, art/NOTICE.md).
  const crest = (kind) => `<img class="now-crest" src="art/steps/${kind}.png" alt="" width="44" height="44">`;
  const BIOME = new Proxy({}, { get: (_t, id) => window.ZoneArt?.biome(Number(id)) || undefined });
  // G13: a zone's own painting when it has one (applied by ZoneArt.paint), else its biome vista.
  const zoneArt = (mapId) => (window.ZoneArt?.painted(mapId) ? ` data-zone-art="${Number(mapId)}"` : "");
  const minutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);
  function sessionChart() {
    const recent = (history?.sessions || []).filter((s) => Number.isFinite(s.startedAt) && Number.isFinite(s.levelsGained) && s.levelsGained >= 0)
      .sort((a, b) => a.startedAt - b.startedAt).slice(-5);
    if (!recent.length) return "";
    const max = Math.max(1, ...recent.map((s) => s.levelsGained));
    const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    return `<figure class="now-history" aria-labelledby="now-history-label">
      <figcaption id="now-history-label"><strong>Level gain by session</strong><span>Last ${recent.length} recorded session${recent.length === 1 ? "" : "s"} · oldest first</span></figcaption>
      <ol>${recent.map((s) => `<li><span>${esc(date.format(s.startedAt))}</span><meter min="0" max="${max}" value="${s.levelsGained}" aria-hidden="true"></meter><strong data-gain="${s.levelsGained}">${s.levelsGained > 0 ? "+" : ""}${s.levelsGained} lvl</strong></li>`).join("")}</ol>
    </figure>`;
  }
  // One visualization: recorded gains, or current XP when there's no session history.
  function sessionCard(a) {
    const c = a.character, s = session?.active ? session : null;
    const saved = c.xp?.savedLevel === c.level && Number.isFinite(c.xp.current) && Number.isFinite(c.xp.max) && c.xp.max > 0 && c.xp.current >= 0 && c.xp.current <= c.xp.max ? c.xp : null;
    const liveXp = Number.isFinite(c.xpPercent) && c.xpPercent >= 0 && c.xpPercent <= 100;
    const pctNow = liveXp ? c.xpPercent : saved ? Math.floor((saved.current / saved.max) * 100) : null;
    const restedPct = saved && saved.rested > 0 && pctNow != null ? Math.min(100 - pctNow, (saved.rested / saved.max) * 100) : 0;
    const chart = sessionChart();
    const xp = pctNow == null ? (chart ? "" : `<p class="now-tip">No XP reading yet. Play with the live link or save in WoW with <code>/reload</code>.</p>`)
      : `<p class="now-xp-line"><strong>${pctNow}%</strong> of level ${c.level} · ${liveXp ? "live XP" : `<span class="now-saved">XP from your last save</span>`}${!chart && restedPct > 0 ? ` · <span class="now-rested">rested bonus from your last save</span>` : ""}</p>
        ${chart ? "" : `<div class="now-xp" role="img" aria-label="${pctNow}% through level ${c.level}"><span class="now-xp-fill" data-w="${pctNow}"></span>${restedPct > 0 ? `<span class="now-xp-rested" data-l="${pctNow}" data-w="${restedPct}"></span>` : ""}</div>`}`;
    const rows = [];
    if (s) {
      rows.push(`<li><strong>${minutes(s.activeMinutes)}</strong><span>played this session</span></li>`);
      rows.push(`<li><strong>${s.levelsGained >= 1 ? `+${s.levelsGained.toFixed(1)}` : `+${Math.round(s.levelsGained * 100)}%`}</strong><span>${s.levelsGained >= 1 ? "levels" : "of a level"}</span></li>`);
      if (s.levelsPerHour) rows.push(`<li><strong>${s.levelsPerHour >= 1 ? s.levelsPerHour.toFixed(1) : `${Math.round(s.levelsPerHour * 100)}%`}</strong><span>${s.levelsPerHour >= 1 ? "levels an hour" : "of a level an hour"}</span></li>`);
      if (s.minutesToLevel) rows.push(`<li><strong>${minutes(s.minutesToLevel)}</strong><span>to level ${(s.level || c.level) + 1}</span></li>`);
      rows.push(`<li><strong>${s.deaths}</strong><span>death${s.deaths === 1 ? "" : "s"}</span></li>`);
      rows.push(`<li><strong>${s.zones.length}</strong><span>zone${s.zones.length === 1 ? "" : "s"} visited</span></li>`);
    }
    return `<article class="now-card now-session"><h2>Progress</h2>${xp}${chart}
      ${rows.length ? `<h3 class="now-sub">This session · Live</h3><ul class="now-stats">${rows.join("")}</ul>${s.levelsPerHour ? "" : `<p class="now-tip">Your pace appears after a few minutes of play.</p>`}` : `<p class="now-tip">${setup?.live?.signal === "unsupported" ? "Live session stats are Windows-only. On Mac, XP updates after /reload or logout." : "Live play adds session pace, time to next level and deaths."}</p>`}
      ${!chart && restedPct > 0 ? `<p class="now-tip">The striped part shows rested XP. Rested kills give double XP until the bonus runs out.</p>` : ""}
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
      // On a Mac there is no live link (1.0.1): the step would never tick, so it isn't asked.
      live?.signal === "unsupported" ? null : { done: live?.signal === "live" || Boolean(a?.character?.live), title: "See yourself live", how: live?.enabled === false ? "The live link is off. Turn it on in Settings → Game connection." : `Keep WoW running in a window or borderless window. The thin dark line along the top edge of the game lets this page follow you, even when another window covers WoW.${window.LiveLink?.stripLine?.(live) ? ` <span class="now-live-strip">${esc(window.LiveLink.stripLine(live))}.</span>` : ""} Type <code>/bf live safe</code> if the link drops over remote desktop.` },
    ].filter(Boolean);
    if (items.every((i) => i.done)) return "";
    const next = items.findIndex((i) => !i.done);
    // One click does every step the app can do by itself: find WoW, install the addon, turn on the live link.
    const canDo = !game?.connected || !game?.addonCurrent || (live?.signal !== "unsupported" && live?.enabled === false);
    const oneClick = canDo ? `<div class="now-oneclick"><button type="button" data-now-act="setup"${setting === "working" ? " disabled" : ""}>${setting === "working" ? "Setting up…" : "Set it all up"}</button><span>${setting && setting !== "working" ? esc(setting) : live?.signal === "unsupported" ? "Finds WoW Forever and installs the addon. Nothing to download or type." : "Finds WoW Forever, installs the addon and turns on the live link. Nothing to download or type."}</span></div>` : "";
    return `<article class="now-card now-setup"><h2>Get set up <small>${items.filter((i) => i.done).length} of ${items.length}</small></h2>
      ${oneClick}<ol class="now-checklist">${items.map((i, n) => `<li class="${i.done ? "done" : n === next ? "next" : ""}"><span class="now-check" aria-hidden="true">${i.done ? "✓" : n + 1}</span><div><strong>${i.title}</strong>${i.done ? "" : `<p>${i.how}</p>${n === next && i.action ? `<div class="now-actions">${i.action}</div>` : ""}`}</div></li>`).join("")}</ol>
      <p class="now-tip">New to WoW? The <button type="button" class="now-link" data-nav="guide">Field guide</button> explains the words you'll see, like rested, hand in and elite, and <button type="button" class="now-link" data-nav="commands">Commands</button> lists everything you can type in game.</p></article>`;
  }
  // The game is still running an addon older than the one just installed: one /reload loads it.
  function reloadBanner() {
    const sig = setup?.live?.signal;
    if (sig === "old-addon") return `<div class="now-reload" role="status"><strong>Type <code>/reload</code> in WoW</strong><span>The game is still running an older Backstage Forever addon, so this page can't follow you live and shows your last save instead. One /reload fixes it.</span></div>`;
    if (sig === "hairline-unreadable") return `<div class="now-reload" role="status"><strong>Type <code>/bf live safe</code> in WoW</strong><span>Backstage Forever sees WoW but can't read the thin live line along the top of the game: remote desktop, HDR or a colour filter changes its shades. Safe mode draws a larger, sturdier strip in a corner. Until then this page shows your last save.</span></div>`;
    if (sig === "compact-unreadable") return `<div class="now-reload" role="status"><strong>Type <code>/bf live safe</code> in WoW</strong><span>The compact live strip is on screen but its colours are changed too much to read (remote desktop, HDR or a colour filter). Safe mode draws a larger, sturdier strip. Until then this page shows your last save.</span></div>`;
    if (sig === "unreadable") return `<div class="now-reload" role="status"><strong>Live link can't read the game</strong><span>The strip is on screen but its colours are being changed (HDR, Night light, a colour filter or a remote session). Type <code>/reload</code> in WoW once; if this stays, turn the filter off for WoW. Until then this page shows your last save.</span></div>`;
    const g = setup?.game;
    if (!g?.connected || !g.addonCurrent || g.runtime?.state !== "running" || !g.loadedCaptureVersion || !g.addonVersion || g.loadedCaptureVersion === g.addonVersion) return "";
    const saved = Date.parse(g.lastSync || ""), landed = Date.parse(g.addonUpdatedAt || "");
    // WoW wrote a save after the update landed: the game has reloaded, so the new addon runs.
    const written = Date.parse(g.savedAt || "");
    if (Number.isFinite(written) && Number.isFinite(landed) && written > landed) return "";
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const early = Number.isFinite(saved) && Number.isFinite(landed) && saved < landed && landed - saved < 15 * 60000;
    const when = early ? ` Your last /reload was at ${clock(saved)}, ${Math.max(1, Math.round((landed - saved) / 1000))} seconds before the update landed at ${clock(landed)}, so the game is still running the old addon: one more /reload fixes it.` : Number.isFinite(landed) ? ` The update landed at ${clock(landed)}. If you just reloaded, the update probably landed a moment later: reload once more and this goes away within a few seconds.` : " If you just reloaded, the update probably landed a moment later: reload once more and this goes away within a few seconds.";
    return `<div class="now-reload" role="status"><strong>Type <code>/reload</code> in WoW</strong><span>Your last save came from Backstage Forever ${esc(g.loadedCaptureVersion)}; the installed addon is ${esc(g.addonVersion)}.${esc(when)}</span></div>`;
  }
  // "You are here": the zone you're in, with everything useful nearby.
  function zoneCard() {
    const z = zone;
    if (!z) return "";
    const w = (p) => ({ mapId: z.mapId, x: p.x, y: p.y });
    const row = (ico, title, items, goal) => items.length ? `<li class="now-zr"><span class="now-zr-ico now-zr-${ico}" aria-hidden="true"></span><div><strong>${title}</strong>${items.map((p) => `<span class="now-zr-item"${p.npcId ? ` data-card-npc="${esc(p.npcId)}"` : ""}>${esc(p.label)}${p.sub ? ` <small>${esc(p.sub)}</small>` : ""} ${mapBtn(w(p), p.label, p.sub, p.npcId, goal(p))}</span>`).join("")}</div></li>` : "";
    const fit = z.fit === "right" ? "Your level" : z.fit === "low" ? "A bit high for you" : z.fit === "high" ? "You've outgrown it" : "";
    const hub = z.hub ? `<li class="now-zr"><span class="now-zr-ico now-zr-quest" aria-hidden="true"></span><div><strong>${z.questsForYou} quests for your level</strong><span class="now-zr-item">Most start around ${pct(z.hub.x)}, ${pct(z.hub.y)} ${mapBtn(w(z.hub), `${z.name} quest hub`, null, null, { title: `Quest hub in ${z.name}`, steps: [`${z.hub.quests} quests start around here.`, "Pick up everything for your level, then do them in one loop."] })}</span></div></li>` : "";
    const art = BIOME[z.mapId] ? ` biome-${BIOME[z.mapId]}` : "";
    return `<article class="now-card now-zonecard"><div class="now-zc-head${art}"${zoneArt(z.mapId)}><span class="now-eyebrow">You are here</span><h2>${esc(z.name)}</h2><p>${z.band ? `Levels ${z.band.min}–${z.band.max}` : ""}${fit ? ` · <span class="now-zc-fit now-zc-${esc(z.fit)}">${fit}</span>` : ""}${z.live ? ' · <span class="now-fresh live">● Live</span>' : ""}</p></div>
      <ul class="now-zr-list">${hub}
      ${row("inn", "Inn", z.inns, (p) => ({ title: p.label, steps: ["Talk to the innkeeper to make this your home: your Hearthstone brings you back here.", "Logging out in an inn earns rested experience."] }))}
      ${row("flight", "Flight master", z.flights, (p) => ({ title: p.label, steps: ["Talk to them once to learn this flight path.", "Then you can fly here from any flight master you know."] }))}
      ${row("train", "Your trainer", z.classTrainers, (p) => ({ title: p.label, steps: [`${p.sub}.`, "Learn new spells every couple of levels."] }))}
      ${row("repair", "Repairs", z.repairs, (p) => ({ title: p.label, steps: ["Repairs your gear and buys your junk."] }))}
      ${row("prof", "Profession trainers", z.professionTrainers, (p) => ({ title: p.label, steps: [`${p.sub}.`] }))}
      ${row("danger", "Careful", z.danger, (p) => ({ title: p.label, steps: [`${p.sub}.`, p.elite ? "Elite: bring a group." : "Higher level than you: come back later or bring a friend."] }))}
      </ul></article>`;
  }
  function arrive(z) {
    if (document.querySelector(".bf-arrive")) document.querySelector(".bf-arrive").remove();
    const el = document.createElement("div");
    el.className = `bf-arrive${BIOME[z.mapId] ? ` biome-${BIOME[z.mapId]}` : ""}`;
    el.setAttribute("role", "status");
    if (window.ZoneArt?.painted(z.mapId)) { el.dataset.zoneArt = String(Number(z.mapId)); window.ZoneArt.paint(el); }
    el.innerHTML = `<div class="bf-arrive-art"></div><div class="bf-arrive-text"><span>Now entering</span><strong>${esc(z.name)}</strong><em>${z.band ? `Levels ${z.band.min}–${z.band.max}` : ""}${z.questsForYou ? ` · ${z.questsForYou} quests for your level` : ""}</em></div>`;
    document.body.append(el);
    el.addEventListener("click", () => el.remove());
    setTimeout(() => el.classList.add("out"), 4200);
    setTimeout(() => el.remove(), 5000);
  }
  function body() {
    displayedDismissal = null;
    const { keys } = dismissed();
    const pin = window.ObjectiveView?.recommendation(activeId());
    const pinKey = pin && `pin:${pin.id}`;
    const suggestPin = Boolean(pinKey && !keys.includes(pinKey));
    const objective = window.ObjectiveView?.card({ suggested: suggestPin, dismiss: suggestPin ? dismissButton(pinKey) : "" }) || "";
    const priorityPin = suggestPin ? objective : "", supportingPin = suggestPin ? "" : objective;
    if (error) return `${priorityPin}<div class="now-card"><p role="status">${esc(error)}</p></div>${supportingPin}`;
    if (!advice) return `${priorityPin}<div class="now-card"><p role="status">Working out your next move…</p></div>${supportingPin}`;
    if (advice.status !== "ok") {
      const hint = advice.status === "no-level" || setup?.game?.connected
        ? "Log in on your character and type <code>/reload</code> in WoW to bring in a fresh save."
        : "Connect your WoW Forever folder to bring your character into the journal.";
      return `${priorityPin || `<article class="now-card now-next">${nextHeading}<p>${hint}</p></article>`}${reloadBanner()}${setupCard(advice)}${weekStrip()}${supportingPin}`;
    }
    const a = advice, c = a.character, [first, ...followups] = steps(a, keys, pin?.questId);
    const alternatives = priorityPin ? [first, ...followups].filter(Boolean) : followups;
    const date = Date.parse(c.savedAt || "");
    const savedAt = !a.log.live && (first?.kind === "hand-in" || first?.kind === "quest") && Number.isFinite(date) ? new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null;
    const zones = a.zones.map((z) => `<li class="now-zone now-fit-${esc(z.fit)}${BIOME[z.mapId] ? ` biome-${BIOME[z.mapId]}` : ""}"${zoneArt(z.mapId)}><button type="button" ${z.hub ? `data-now-map='${esc(JSON.stringify({ mapId: z.mapId, x: z.hub.x, y: z.hub.y, label: `${z.name} quest hub`, sub: null, goal: { title: `Quest hub in ${z.name}`, steps: [`Levels ${z.min}–${z.max}${z.available ? `, ${z.available} quests you can pick up` : ""}.`, ...(z.quests?.length ? [`Start with: ${z.quests.slice(0, 3).map((q) => q.title).join(", ")}.`] : []), ...(z.towns?.length ? [`Friendly towns: ${z.towns.join(", ")}.`] : [])] } }))}'` : "disabled"}><strong>${esc(z.name)}</strong><span>${z.min}–${z.max}${z.observedLevels ? " · seen in play" : ""}</span><span>${z.available ? `${z.available} quests for you` : "no quests recorded yet"}${z.towns.length ? ` · ${esc(z.towns.join(", "))}` : ""}</span><em>${z.fit === "now" ? "Your level" : "Soon"}</em></button></li>`).join("");
    const t = a.training;
    const training = !t ? `<p>Pick a class for this character in Characters to see training.</p>`
      : !t.trainer ? `<p>No ${esc(t.className)} trainer is recorded for your faction yet.</p>`
      : `<p><strong${t.trainer.npcId ? ` data-card-npc="${esc(t.trainer.npcId)}"` : ""}>${esc(t.trainer.name)}</strong> · ${esc(t.trainer.title)}<br><small>${at(t.trainer)}</small></p>
         ${t.newNow.length ? `<p class="now-good">New for you now: ${t.newNow.map((s) => esc(s.name)).join(", ")}</p>` : `<p>Nothing new at level ${c.level}.</p>`}
         ${t.nextAt ? `<p>Next spells at <strong>level ${t.nextAt}</strong>: ${t.nextSpells.slice(0, 6).map((s) => esc(s.name)).join(", ")}${t.nextSpells.length > 6 ? "…" : ""}</p>` : ""}
         ${t.upcoming?.length ? `<h3 class="now-sub">Upcoming training</h3><ol class="now-plan">${t.upcoming.map((u) => `<li class="${u.level - c.level <= 2 ? "soon" : ""}"><span class="now-plan-lv">${u.level}</span><span class="now-plan-spells">${u.spells.slice(0, 6).map((sp) => `<span class="now-spell" title="${esc(sp.name)}${sp.rank ? ` (${esc(sp.rank)})` : ""}">${sp.spellId ? `<canvas class="game-icon now-spell-ico" width="28" height="28" data-spell-icon="${sp.spellId}"></canvas>` : ""}<span>${esc(sp.name)}${sp.rank ? ` <small>${esc(sp.rank.replace("Rank ", "R"))}</small>` : ""}</span></span>`).join("")}</span></li>`).join("")}</ol>` : ""}
         ${trainingCost(t, c)}
         <div class="now-actions">${mapBtn(t.trainer, t.trainer.name, t.trainer.title, t.trainer.npcId, { title: `Your ${t.className} trainer`, steps: [`${t.trainer.name}, ${t.trainer.title}.`, t.newNow.length ? `Ready to learn: ${t.newNow.map((s) => s.name).join(", ")}.` : `Nothing new until level ${t.nextAt || c.level + 1}.`] })}</div>`;
    const log = a.log;
    const logLabel = log.known === false ? "" : `<small>${log.inLog}</small> <span class="now-fresh${log.live ? " live" : ""}">${log.live ? "● Live" : c.savedAt ? "from your last save" : "save time unknown"}</span>`;
    const questLog = log.inLog ? `<ul class="now-log">${log.ready.map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip ready">Hand in</span>${esc(q.title)}</button></li>`).join("")}${log.active.slice(0, 8).map((q) => { const grey = q.level && q.level <= greyAt(c.level); return `<li><button type="button" data-quest-open="${q.id}"${grey ? ' title="This quest no longer gives experience at your level. Finish it only if you want the reward or the story; otherwise it\'s safe to abandon to free up your log."' : ""}><span class="now-chip">${q.total ? `${q.done}/${q.total}` : "…"}</span>${esc(q.title)}${q.level ? ` <small>lvl ${q.level}</small>` : ""}${grey ? ` <span class="now-chip grey">No XP · safe to drop</span>` : ""}</button></li>`; }).join("")}</ul>` : `<p>Your quest log is empty. ${a.next ? `Pick up quests in ${esc(a.next.name)}.` : ""}</p>`;
    // Quests handed in since the last save (live): shown done, so nothing old reads as still to do.
    const done = log.justDone?.length ? `<h3 class="now-sub">Just completed</h3><ul class="now-log now-done">${log.justDone.map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip done">✓ Completed</span>${esc(q.title)}</button></li>`).join("")}</ul>` : "";
    const top = a.next?.quests?.length ? `<ul class="now-log">${a.next.quests.slice(0, 6).map((q) => `<li><button type="button" data-quest-open="${q.id}"><span class="now-chip new">lvl ${q.level}</span>${esc(q.title)} <small>from ${esc(q.giver)}</small></button></li>`).join("")}</ul>` : "";
    // Each row shares a baseline; no independent stacks or visually reordered controls.
    return `<div class="now-grid now-overview">
      ${priorityPin || `<article class="now-card now-next">${nextHeading}
        ${first ? `<ol class="now-steps">${stepRow(first, true, savedAt)}</ol>` : `<p>${keys.length ? "No more suggestions for this character today. Your quest log and other tools are still available below." : "No next action found in the available data. You can still browse your quest log and other tools below."}</p>`}
      </article>`}
      ${sessionCard(a)}
    </div>
    ${supportingPin}
    ${alternatives.length ? `<details class="now-card now-followups"><summary>More suggestions</summary><ol class="now-steps">${alternatives.map(s => stepRow(s)).join("")}</ol></details>` : ""}
    ${reloadBanner()}${weekStrip()}${setupCard(a)}
    <div class="now-grid now-reference">
      <article class="now-card now-questlog"><h2>Quest log ${logLabel}</h2>${log.known === false ? "<p>No quest log has been observed for this character yet.</p>" : questLog}${done}</article>
      ${zoneCard()}
      <article class="now-card"><h2>Where to level</h2><ul class="now-zones">${zones}</ul>${top ? `<h3 class="now-sub">Quests to pick up in ${esc(a.next.name)}</h3>${top}` : ""}</article>
      <article class="now-card"><h2>${esc(c.className || "Class")} training</h2>${training}</article>
      ${window.MomentsView ? MomentsView.recentCard() : ""}
    </div>
    <p class="now-src">Zone levels: ${esc(a.source)} Quest, trainer and NPC references: Efficient Games, CC BY 4.0.</p>`;
  }
  // WoW minimized or gone: say live updates are paused (not that the link failed), with the last live state.
  function paused() {
    const live = window.LiveLink?.status?.() || setup?.live, text = PAUSED[live?.signal];
    if (!live?.enabled || !text) return "";
    const last = window.LiveLink?.lastLine?.(live) || "";
    return ` <span class="now-paused" role="status">⏸ ${esc(text)}${last ? ` <span class="now-saved-at">${esc(last)}</span>` : ""}</span>`;
  }
  const PAUSED = { minimized: "WoW is minimized — live updates are paused and resume when you bring it back.", nogame: "WoW window not found — live updates are paused and resume when the game is back." };
  function liveLine() {
    const n = document.querySelector("[data-now-live]"); if (!n || !advice?.character) return;
    const c = advice.character;
    const mins = c.savedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(c.savedAt)) / 60000)) : null;
    const ago = Number.isFinite(mins) ? (mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.floor(mins / 60)} hr ago` : `${Math.floor(mins / 1440)} days ago`) : "";
    n.innerHTML = `Level ${c.level}${c.className ? ` ${esc(c.className)}` : ""}${c.faction ? ` · ${esc(c.faction)}` : ""} · ${c.live ? `<span class="on">● Live</span> in ${esc(c.zone || "")}` : c.zone ? `Last saved in ${esc(c.zone)}` : "Position unknown"}${ago ? ` <span class="now-saved-at">· save from ${esc(ago)}</span>` : ""}${c.live ? "" : paused()}`;
  }
  function paint() {
    const b = document.querySelector("[data-now-body]"); if (!b) return;
    const followupsOpen = b.querySelector?.(".now-followups")?.open;
    const focused = document.activeElement;
    const focusAttrs = ["data-now-next-heading", "data-objective-heading", "data-now-dismiss", "data-objective-resume", "data-objective-change", "data-now-map", "data-quest-open"];
    const focusAttr = focused?.closest(".now-next, .now-objective") && focusAttrs.find(attr => focused.hasAttribute(attr));
    const focusValue = focusAttr && focused.getAttribute(focusAttr);
    const oldSuggestion = displayedDismissal?.key;
    // The view templates escape dynamic text and serialized action attributes before interpolation.
    b.innerHTML = body();
    const followups = b.querySelector?.(".now-followups");
    if (followups) followups.open = followupsOpen ?? DesktopViewPresets.defaults(activeId()).nowMoreSuggestions;
    if (focusAttr) {
      const match = (focusAttr !== "data-now-dismiss" || oldSuggestion === displayedDismissal?.key) &&
        [...b.querySelectorAll(`.now-next [${focusAttr}], .now-objective [${focusAttr}]`)].find(el => el.getAttribute(focusAttr) === focusValue);
      (match || b.querySelector?.("[data-now-next-heading]"))?.focus({ preventScroll: true });
    } else if (followupsOpen !== undefined && focused?.matches(".now-followups > summary")) {
      followups?.querySelector("summary").focus({ preventScroll: true });
    }
    window.ZoneArt?.paint(b);
    for (const el of b.querySelectorAll(".now-xp [data-w]")) { el.style.width = `${Number(el.dataset.w)}%`; if (el.dataset.l) el.style.left = `${Number(el.dataset.l)}%`; }
    const header = document.querySelector('[data-now] > [data-page-hero="now"]');
    if (header && header.dataset.nowIdentity !== heroIdentity(advice?.character)) {
      const active = header.contains(document.activeElement) ? document.activeElement : null;
      const focused = active?.dataset.nowAct;
      // Shared PageHero markup; hero() escapes the player title and identity attributes.
      header.outerHTML = hero(advice);
      if (active?.hasAttribute("data-now-badge-case")) document.querySelector("[data-now-badge-case]")?.focus({ preventScroll: true });
      else if (focused) document.querySelector(`[data-now-act="${focused}"]`)?.focus({ preventScroll: true });
    } else {
      const title = header?.querySelector("[data-now-title]");
      if (title) title.textContent = heroTitle(advice);
    }
    liveLine();
    spellIcons(b);
  }
  // Spell icons come from the player's own game install: spell id -> icon file -> GameIcons paints it.
  const spellIconCache = new Map();
  function spellIcons(root) {
    if (!api.gameSpell) return;
    for (const c of root.querySelectorAll("canvas[data-spell-icon]")) {
      const id = Number(c.dataset.spellIcon);
      if (!spellIconCache.has(id)) spellIconCache.set(id, api.gameSpell(id).then((sp) => sp?.iconFileId || null).catch(() => null));
      spellIconCache.get(id).then((icon) => { if (icon && c.isConnected) { c.dataset.gameIcon = String(icon); window.GameIcons?.paint?.(c.parentElement || c); } else if (!icon) c.remove(); });
    }
  }
  async function load() {
    const requestedFor = activeId();
    if (!mountedFor || request?.profileId === requestedFor) return;
    const current = request = { profileId: requestedFor };
    const ownsView = () => request === current && activeId() === requestedFor && mountedFor;
    lastFetch = Date.now();
    try {
      const [a, s, game, live, z, wk, journey] = await Promise.all([api.levelingAdvice(), api.playSession ? api.playSession().catch(() => null) : null,
        api.gameStatus ? api.gameStatus().catch(() => null) : null, api.liveLinkStatus ? api.liveLinkStatus().catch(() => null) : null,
        api.zoneBriefing ? api.zoneBriefing().catch(() => null) : null, api.weekly ? api.weekly().catch(() => null) : null,
        api.journey ? api.journey().catch(() => null) : null]);
      if (!ownsView()) return;
      weekly = wk;
      history = journey?.id === requestedFor && journey?.name === a?.character?.name ? journey?.history : null;
      advice = a; session = s; setup = { game, live }; zone = z; error = "";
      // Entering a new zone while playing: a painted arrival banner.
      if (z?.mapId && lastZoneId && z.mapId !== lastZoneId && z.live) arrive(z);
      if (z?.mapId) lastZoneId = z.mapId;
      window.JourneyView?.check();
      window.WorldTrackerView?.check?.();
      window.MomentsView?.refresh();
    } catch (e) { if (ownsView()) error = e.message || "Advice is unavailable."; }
    finally {
      if (ownsView()) { loadedFor = requestedFor; paint(); }
      if (request === current) request = null;
    }
  }
  // Live frames: refresh when you change zone, level or quest progress; at most every few seconds.
  function onLive(status) {
    if (!document.querySelector("[data-now]")) return;
    const f = status?.frame;
    if (setup && setup.live?.signal !== status?.signal) { setup.live = status; lastKey = ""; liveLine(); }
    const key = f?.position ? [f.position.mapId, f.level, f.questLogHash, f.quest?.objectivesDone?.length, f.dead, Math.floor((f.xpPercent ?? 0) / 5),
      // Live quest pages: a hand-in or a newly finished objective refreshes too.
      (f.questLog || []).map((q) => q.id + (q.complete ? "c" : "")).join(","), (f.turnedIn || []).join(",")].join("|") : "none";
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
        if (live && live.signal !== "unsupported" && live.enabled === false) await api.setLiveLink(true);
        setting = "Done. Log in to WoW (or type /reload if it's running) and your character appears here.";
      }
    } catch (e) { setting = e?.message || "Setup couldn't finish. Try the Game connection page in Settings."; }
    await load();
  }
  function bind(root) {
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-now-dismiss]")) {
        const current = displayedDismissal;
        if (!current || current.id !== activeId() || root !== mountedFor) return;
        const hidden = dismissed();
        hidden.keys = [...hidden.keys.filter(key => key !== current.key), current.key].slice(-32);
        try { localStorage.setItem(dismissStorage(hidden.id), JSON.stringify({ day: hidden.day, keys: hidden.keys })); } catch {}
        paint();
        (document.querySelector("[data-now-next-heading]") || document.querySelector("[data-objective-heading]"))?.focus({ preventScroll: true });
        return;
      }
      const m = e.target.closest("[data-now-map]");
      if (m) { try { window.WorldMapView?.focus(JSON.parse(m.dataset.nowMap)); document.querySelector('[data-nav="world-map"]')?.click(); } catch {} return; }
      if (e.target.closest('[data-now-act="refresh"]')) load();
      if (e.target.closest('[data-now-act="mini"]')) api.openMiniNow?.().catch(() => {});
      if (e.target.closest('[data-now-act="setup"]')) oneClickSetup();
    });
  }
  function mounted() {
    const root = document.querySelector("[data-now]");
    if (!root) { mountedFor = null; request = null; clearTimeout(timer); return; }
    if (mountedFor === root) return;
    mountedFor = root; bind(root);
    if (loadedFor !== activeId()) { advice = null; history = null; error = ""; lastZoneId = null; lastKey = ""; }
    paint();
    load();
  }
  function invalidate() { advice = null; history = null; lastKey = ""; }
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
  return { _arrive: (z) => arrive(z), page, mounted, invalidate, removeDismissals, celebrate, _state: () => ({ advice, session, zone }) };
})();
