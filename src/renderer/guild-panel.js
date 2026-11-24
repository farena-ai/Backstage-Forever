"use strict";
// The Guild & Party panel: Events, Party and Board in a small always-on-top window. It only shows
// what the main process hands it (never a member key) and asks for a few actions: answer an event,
// renew or remove your own listing, put a group member into a plan slot, open the app.
(() => {
  const api = window.guildPanel;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const keep = (v) => `<span data-no-translate>${esc(v)}</span>`;
  const ROLES = ["tank", "healer", "damage"], ROLE = { tank: "Tank", healer: "Healer", damage: "Damage" }, ROLE_PLURAL = { tank: "Tanks", healer: "Healers", damage: "Damage" };
  const ANSWER = { tank: "Tank", healer: "Healer", damage: "Damage", maybe: "Maybe", no: "No" };
  const CLASS = { warrior: "Warrior", paladin: "Paladin", hunter: "Hunter", rogue: "Rogue", priest: "Priest", shaman: "Shaman", mage: "Mage", warlock: "Warlock", druid: "Druid" };
  const S = { v: null, tab: "events", note: "", bad: false, busy: "", pick: null, filter: { place: "", role: "" }, sheet: false, source: "", watched: 0 };
  const stamp = (v, kind) => (window.I18n?.when ? window.I18n.when(v, kind) : new Date(v).toLocaleString());
  const countdown = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const off = () => (S.busy ? " disabled" : "");

  function liveMark(v) {
    const s = v.live?.state;
    const [kind, mark, text] = s === "live" ? ["ok", "●", "Live"] : s === "connecting" ? ["wait", "◐", "Connecting…"] : s === "reconnecting" ? ["wait", "◐", "Reconnecting…"] : s === "offline" ? ["bad", "✕", "Offline"] : ["off", "○", "Not connected"];
    return `<span class="gp-light gp-${kind}"><span aria-hidden="true">${mark}</span> <span>${text}</span></span>`;
  }
  function intro(v) {
    if (v.settings.introSeen) return "";
    return `<section class="gp-intro" data-gp-intro><strong>This window stays on top of the game.</strong><p>Drag the top bar to move it and an edge to resize it. The gear sets how see-through it is. It never types or clicks in the game.</p><button type="button" data-gp="intro">Got it</button></section>`;
  }
  // ---------------------------------------------------------------- Events
  function meter(role, have, want) {
    const pct = want > 0 ? Math.min(100, Math.round((have / want) * 100)) : have > 0 ? 100 : 0;
    return `<div class="gp-meter gp-m-${role}${want > 0 && have >= want ? " gp-full" : ""}"><span class="gp-meter-label">${ROLE_PLURAL[role]}</span><span class="gp-meter-bar" aria-hidden="true"><span data-w="${pct}"></span></span><strong data-no-translate>${have}/${want}</strong></div>`;
  }
  function eventsTab(v) {
    if (!v.joined) return `${v.offers ? `<section class="gp-card gp-call" data-gp-offer><strong>Your guild invited you.</strong><p>The invitation says what joining shares. Answer it in the app.</p><button type="button" data-gp="app" data-route="guild">Open the app</button></section>` : ""}
      <p class="gp-msg" data-gp-empty>You have not joined a guild's live link yet. Members join with one click when their guild leader has set it up.</p><div class="gp-row"><button type="button" data-gp="app" data-route="guild">Open Plans → Guild</button><button type="button" data-gp="app" data-route="guild-guide">Guide</button></div>`;
    if (!v.events.length) return `<p class="gp-msg" data-gp-empty>No guild events ahead. An officer can propose one in game with <code data-no-translate>/bf event add</code> or on Plans → Guild.</p>`;
    return v.events.map((e) => `<article class="gp-card gp-event" data-gp-event="${esc(e.id)}"><header><strong data-no-translate>${esc(e.title)}</strong><span class="gp-when">${keep(stamp(Date.parse(e.at), "weekday"))} · ${keep(e.placeName)}</span></header>
      <div class="gp-meters">${ROLES.map((r) => meter(r, e.counts[r], e.roles[r])).join("")}</div>
      ${e.counts.maybe || e.counts.no ? `<p class="gp-small"><span>Maybe</span> <strong data-no-translate>${e.counts.maybe}</strong> · <span>No</span> <strong data-no-translate>${e.counts.no}</strong></p>` : ""}
      <div class="gp-answers" role="group" aria-label="Your answer">${Object.keys(ANSWER).map((a) => `<button type="button" class="gp-answer${e.mine === a ? " gp-on" : ""}" data-gp="answer" data-guild="${esc(e.guildId)}" data-event="${esc(e.id)}" data-answer="${a}" aria-pressed="${e.mine === a}"${off()}>${ANSWER[a]}</button>`).join("")}</div>
      ${e.waiting ? `<p class="gp-small gp-waiting">Waiting for the service. It is sent by itself.</p>` : ""}</article>`).join("");
  }
  // ---------------------------------------------------------------- Party
  function memberRow(m, leader) {
    const picked = S.pick && S.pick.name === m.name && S.pick.realm === m.realm;
    const isLeader = leader && leader.name === m.name && leader.realm === m.realm;
    return `<li class="gp-member${m.online === false ? " gp-offline" : ""}"><button type="button" class="gp-pick${picked ? " gp-picked" : ""}" data-gp="pick" data-name="${esc(m.name)}" data-realm="${esc(m.realm)}" aria-pressed="${picked}"><strong data-no-translate>${esc(m.name)}</strong>${isLeader ? ` <span class="gp-tag">Leader</span>` : ""}</button>
      <span class="gp-small">${[m.class && CLASS[m.class] ? `<span>${CLASS[m.class]}</span>` : "", m.level ? `<span data-no-translate>${m.level}</span>` : "", m.role ? `<span>${ROLE[m.role]}</span>` : "", m.online === false ? `<span>Offline</span>` : m.ready === true ? `<span class="gp-ready">Ready</span>` : m.ready === false ? `<span>Not ready</span>` : ""].filter(Boolean).join(" · ")}</span>
      ${(m.missing || []).length ? `<span class="gp-missing"><span>Missing:</span> ${m.missing.map(keep).join(", ")}</span>` : ""}</li>`;
  }
  function planBlock(plan, readOnly) {
    return `<div class="gp-plan">${ROLES.map((r) => `<div class="gp-plan-col"><h3>${ROLE_PLURAL[r]}</h3>${plan.slots.filter((s) => s.role === r).map((s) => `<button type="button" class="gp-slot${s.empty ? " gp-empty" : ""}" data-gp="slot" data-slot="${s.index}"${readOnly ? " disabled" : off()}>${s.empty ? `<span>Empty</span>` : `<strong data-no-translate>${esc(s.name)}</strong>`}${s.note ? `<small data-no-translate>${esc(s.note)}</small>` : ""}${(s.warnings || []).length ? `<small class="gp-warn">${s.warnings.map((w) => (w.verbatim ? keep(w.text) : `<span>${esc(w.text)}</span>`)).join(" · ")}</small>` : ""}</button>`).join("")}</div>`).join("")}</div>`;
  }
  function partyTab(v) {
    const p = v.party, plan = v.plan;
    const group = p ? `<section class="gp-card" data-gp-party><header><strong>Your group</strong><span class="gp-when">${p.placeName ? keep(p.placeName) : `<span>No dungeon yet</span>`} · <span data-no-translate>${p.total || p.members.length}</span></span></header><ul class="gp-members">${p.members.map((m) => memberRow(m, p.leader)).join("")}</ul></section>`
      : `<p class="gp-msg" data-gp-empty>${v.liveLink ? "You are not in a group right now." : "Your group shows here while the live link is on. Without it the panel learns about your group at your next /reload."}</p>`;
    const mine = plan ? `<section class="gp-card" data-gp-plan><header><strong>Group plan</strong><span class="gp-when">${plan.placeName && plan.place !== "other" ? keep(plan.placeName) : ""}</span></header>${planBlock(plan, false)}
        ${plan.missing.length ? `<p class="gp-small gp-open"><span>Still open:</span> ${plan.missing.map((m) => `<span data-no-translate>${m.open} ×</span> <span>${ROLE[m.role]}</span>`).join(", ")}</p>` : ""}
        ${plan.note ? `<p class="gp-note" data-no-translate>${esc(plan.note)}</p>` : ""}
        <p class="gp-small">${S.pick ? "Now click a slot to place them." : "Click a name above, then a slot. Notes and the dungeon are set in the app."}</p></section>` : "";
    const shared = plan?.shared ? `<section class="gp-card" data-gp-shared><header><strong>Plan from your leader</strong><span class="gp-when">${plan.sharedBy ? keep(plan.sharedBy) : ""}</span></header>${planBlock(plan.shared, true)}${plan.shared.note ? `<p class="gp-note" data-no-translate>${esc(plan.shared.note)}</p>` : ""}</section>` : "";
    return `${group}${shared}${mine}<p class="gp-small gp-honest">Your plan reaches the game at your next /reload. Your group sees it in game after that.</p><div class="gp-row"><button type="button" data-gp="app" data-route="party">Open the planner</button></div>`;
  }
  // ---------------------------------------------------------------- Board
  function boardTab(v) {
    const b = v.board;
    if (!b.on) return `<p class="gp-msg" data-gp-empty>The party board is switched off. Switch it on in the app: it then shows listings from your realm here, live.</p><div class="gp-row"><button type="button" data-gp="app" data-route="party">Open Plans → Party</button></div>`;
    const mine = b.mine ? `<section class="gp-card gp-mine" data-gp-mine><header><strong>Your listing</strong><span class="gp-count${b.mine.expiresAt - Date.now() < 5 * 60 * 1000 ? " gp-soon" : ""}"><span>ends in</span> <strong data-gp-countdown="${b.mine.expiresAt}" data-no-translate>${countdown(b.mine.expiresAt - Date.now())}</strong></span></header>
        <p class="gp-small">${b.mine.kind === "lfm" ? "Looking for more" : "Looking for a group"} · ${keep(b.mine.placeName)} · ${b.mine.roles.map((r) => `<span>${ROLE[r]}</span>`).join(", ")}</p>
        <div class="gp-row"><button type="button" class="gp-primary" data-gp="renew"${off()}>Renew</button><button type="button" data-gp="remove"${off()}>Remove</button></div></section>`
      : `<div class="gp-row"><button type="button" data-gp="app" data-route="party">Post a listing in the app</button></div>`;
    const places = [...new Map(b.listings.map((l) => [l.place, l.placeName])).entries()];
    const shown = b.listings.filter((l) => (!S.filter.place || l.place === S.filter.place) && (!S.filter.role || l.roles.includes(S.filter.role) || (l.need && l.need[S.filter.role] > 0)));
    const filters = `<div class="gp-filters"><label><span>Dungeon</span> <select data-gp-filter="place" aria-label="Dungeon"><option value="">All</option>${places.map(([id, name]) => `<option value="${esc(id)}"${id === S.filter.place ? " selected" : ""} data-keep>${esc(name)}</option>`).join("")}</select></label><label><span>Role</span> <select data-gp-filter="role" aria-label="Role"><option value="">All</option>${ROLES.map((r) => `<option value="${r}"${r === S.filter.role ? " selected" : ""}>${ROLE[r]}</option>`).join("")}</select></label></div>`;
    const rows = shown.length ? `<ul class="gp-listings">${shown.slice(0, 60).map((l) => `<li class="gp-listing" data-gp-listing="${esc(l.id)}"><div><strong data-no-translate>${esc(l.who.name)}</strong> <span class="gp-small">${l.class && CLASS[l.class] ? `<span>${CLASS[l.class]}</span> ` : ""}<span data-no-translate>${l.level}</span></span><span class="gp-tag gp-kind-${l.kind}">${l.kind === "lfm" ? "Needs players" : "Wants a group"}</span></div>
        <div class="gp-small">${keep(l.placeName)} · ${l.roles.map((r) => `<span>${ROLE[r]}</span>`).join(", ")}${l.need ? ` · <span>needs</span> ${ROLES.filter((r) => l.need[r] > 0).map((r) => `<span data-no-translate>${l.need[r]} ×</span> <span>${ROLE[r]}</span>`).join(", ")}` : ""}</div>${l.note ? `<div class="gp-note" data-no-translate>${esc(l.note)}</div>` : ""}</li>`).join("")}</ul>`
      : `<p class="gp-msg" data-gp-empty>${b.listings.length ? "No listing matches these filters." : "No listings right now. New ones appear by themselves."}</p>`;
    return `${mine}${filters}${rows}`;
  }
  // ---------------------------------------------------------------- settings sheet
  function sheet(v) {
    const s = v.settings;
    return `<h2>Panel settings</h2>
      <label class="gp-field"><span>See-through</span><input type="range" min="40" max="100" step="5" value="${s.opacity}" data-gp-setting="opacity" aria-label="How solid the panel is, in percent"><strong data-gp-opacity data-no-translate>${s.opacity}%</strong></label>
      <label class="gp-check"><input type="checkbox" data-gp-setting="hideInCombat"${s.hideInCombat ? " checked" : ""}> <span>Hide the panel while I am in combat (needs the live link)</span></label>
      <label class="gp-check"><input type="checkbox" data-gp-setting="openAtStart"${s.openAtStart ? " checked" : ""}> <span>Open the panel when the app starts</span></label>
      <p class="gp-small">Mouse clicks always land on the panel, never through it. It remembers its place and size.</p>
      <div class="gp-row"><button type="button" data-gp="app" data-route="guild-guide">Guide</button><button type="button" class="gp-primary" data-gp="sheet-close">Done</button></div>`;
  }
  // ---------------------------------------------------------------- painting
  function render() {
    const v = S.v, body = document.querySelector("[data-gp-body]"), foot = document.querySelector("[data-gp-foot]"), live = document.querySelector("[data-gp-live]"), sheetEl = document.querySelector("[data-gp-sheet]");
    if (!body) return;
    if (!v?.ready) { body.innerHTML = `<p class="gp-msg">Opening…</p>`; return; }
    window.I18n?.setGameLocale?.(v.gameLocale || null);
    for (const t of document.querySelectorAll("[data-gp-tab]")) { const on = t.dataset.gpTab === S.tab; t.setAttribute("aria-selected", String(on)); t.classList.toggle("gp-on", on); }
    const html = `${intro(v)}${S.tab === "events" ? eventsTab(v) : S.tab === "party" ? partyTab(v) : boardTab(v)}${S.note ? `<p class="gp-said${S.bad ? " gp-bad" : ""}" role="status">${esc(S.note)}</p>` : ""}`;
    // Compared with what was drawn last (in English), not with the page, which may show another language.
    if (html !== S.source && !document.activeElement?.matches?.("select")) { S.source = html; const top = body.scrollTop; body.innerHTML = html; body.scrollTop = top; for (const el of body.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`; }
    const liveHtml = liveMark(v);
    if (live.dataset.src !== liveHtml) { live.dataset.src = liveHtml; live.innerHTML = liveHtml; }
    const footHtml = v.pending > 0 ? `<span aria-hidden="true">↻</span> <span>${v.pending === 1 ? "1 update will reach the game at your next /reload" : `${v.pending} updates will reach the game at your next /reload`}</span>` : "";
    if (foot.dataset.src !== footHtml) { foot.dataset.src = footHtml; foot.innerHTML = footHtml; foot.hidden = !footHtml; }
    if (S.sheet) { if (sheetEl.hidden) { sheetEl.innerHTML = sheet(v); sheetEl.hidden = false; } } else if (!sheetEl.hidden) { sheetEl.hidden = true; sheetEl.innerHTML = ""; }
  }
  const took = (state) => { if (!state) return; S.v = state; if (state.settings?.tab && !S.tabChosen) S.tab = state.settings.tab; render(); };
  async function act(key, fn, ok = "") {
    if (S.busy) return;
    S.busy = key; S.note = ""; S.source = ""; render();
    try { await fn(); S.note = ok; S.bad = false; }
    catch (e) { S.note = e?.message || "That did not work. Try again."; S.bad = true; }
    S.busy = ""; S.source = "";
    try { took(await api.state()); } catch { render(); }
    if (S.note && !S.bad) setTimeout(() => { S.note = ""; S.source = ""; render(); }, 4000);
  }
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-gp-tab]");
    if (tab) { S.tab = tab.dataset.gpTab; S.tabChosen = true; S.note = ""; S.pick = null; S.source = ""; render(); api.settings({ tab: S.tab }).catch(() => {}); if (S.tab === "board") api.board("browse").then(() => api.state()).then(took).catch(() => {}); return; }
    const b = e.target.closest("[data-gp]");
    if (!b || b.disabled) return;
    const a = b.dataset.gp;
    if (a === "close") { api.close(); return; }
    if (a === "settings") { S.sheet = !S.sheet; render(); return; }
    if (a === "sheet-close") { S.sheet = false; render(); return; }
    if (a === "intro") { api.settings({ introSeen: true }).then(() => api.state()).then(took).catch(() => {}); return; }
    if (a === "app") { api.app(b.dataset.route).catch(() => {}); return; }
    if (a === "answer") { void act(`a:${b.dataset.event}`, () => api.answer({ guildId: b.dataset.guild, eventId: b.dataset.event, answer: b.dataset.answer })); return; }
    if (a === "renew") { void act("board", () => api.board("renew"), "Renewed for another 30 minutes."); return; }
    if (a === "remove") { void act("board", () => api.board("remove"), "Removed."); return; }
    if (a === "pick") { const m = { name: b.dataset.name, realm: b.dataset.realm }; S.pick = S.pick && S.pick.name === m.name && S.pick.realm === m.realm ? null : m; S.source = ""; render(); return; }
    if (a === "slot") {
      const index = Number(b.dataset.slot), slot = S.v?.plan?.slots?.find((s) => s.index === index);
      if (S.pick) { const member = S.pick; S.pick = null; void act("plan", () => api.plan({ slot: index, member })); }
      else if (slot && !slot.empty) void act("plan", () => api.plan({ slot: index, member: null }), "Taken out of the slot.");
    }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.dataset?.gpFilter;
    if (f) { S.filter[f] = e.target.value; S.source = ""; e.target.blur(); render(); return; }
    const k = e.target.dataset?.gpSetting;
    if (k) api.settings({ [k]: k === "opacity" ? Number(e.target.value) : e.target.checked }).catch(() => {});
  });
  document.addEventListener("input", (e) => { if (e.target.dataset?.gpSetting === "opacity") { const out = document.querySelector("[data-gp-opacity]"); if (out) out.textContent = `${e.target.value}%`; api.settings({ opacity: Number(e.target.value) }).catch(() => {}); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.sheet) { S.sheet = false; render(); } });
  // The countdown of your own listing, second by second.
  setInterval(() => { for (const n of document.querySelectorAll("[data-gp-countdown]")) n.textContent = countdown(Number(n.dataset.gpCountdown) - Date.now()); }, 1000);
  api.onState(took);
  api.state().then(took).catch(() => { const body = document.querySelector("[data-gp-body]"); if (body) body.innerHTML = `<p class="gp-msg">The panel could not open its data. Close it and open it again from the app.</p>`; });
})();
