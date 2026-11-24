"use strict";
// IPC for Backstage Live in the main window: the guild setup and join cards (Plans → Guild), the
// group planner, regulars and the realm party board (Plans → Party), and the numbers the
// "Guild & Party" panel shows. Arguments are checked here; the services check them again.
// A member token never crosses this bridge: the views of guild-service.cjs carry none.
const P = require("./group-planner.cjs");
const { who, sameWho, ROLES, ANSWERS } = require("./guild-service.cjs");

const BAD = "Invalid guild request.";
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const only = (o, keys) => plain(o) && Object.keys(o).every((k) => keys.includes(k));
const str = (v, max) => typeof v === "string" && v.length <= max;
// A membership: "<guildId>~<realm>|<name>" (one character in one guild), as the views name it.
const guildId = (v) => typeof v === "string" && v.length <= 160 && /^g_[A-Za-z0-9_-]{1,60}(?:~[^~]{3,80})?$/u.test(v);
const need = (ok) => { if (!ok) throw Error(BAD); };
const lower = (v) => String(v ?? "").toLowerCase();
// The only texts the app copies for the player to paste into the game's chat box.
const COPYABLE = /^(?:\/w [^\s/|]{2,80} |\/bf guild link [A-Z0-9-]{4,32}|\/backstage (?:link|channel|events))$/u;

/**
 * The shared brain of the main window and the panel. getState(): the app state (profiles, active
 * profile). guildStore: the saved-file guild memory (guild-events.cjs). service: GuildService.
 * group: GroupStore. feed: { real }: whether the game side (game-guild-feed.cjs) is wired in.
 */
function createLiveGuildHub({ getState, guildStore = null, service, group, feed = { real: false }, liveLink = () => false, attunements = null, now = Date.now }) {
  let atlasRows = null;
  const atlas = () => {
    if (atlasRows) return atlasRows;
    atlasRows = new Map();
    try { for (const row of require("./dungeon-atlas.cjs").BASELINE) atlasRows.set(row[0], { id: row[0], name: row[1], kind: row[2], min: row[3], max: row[4] }); } catch { /* names fall back to the short id */ }
    return atlasRows;
  };
  const place = (id) => atlas().get(id) || (id === "other" ? { id: "other", name: "Other", kind: "other", min: null, max: null } : null);
  const placeName = (id) => place(id)?.name || id;
  const places = () => [...atlas().values(), { id: "other", name: "Other", kind: "other", min: null, max: null }];
  const profiles = () => getState()?.profiles || [];
  const profileOf = (id) => profiles().find((p) => p.id === id) || profiles().find((p) => p.id === getState()?.activeProfileId) || null;
  const profileFor = (character) => (character ? profiles().find((p) => sameWho({ name: p.name, realm: p.realm || "" }, character)) || null : null);
  /** What the app knows about one character for the cards: its name, realm, faction and saved guild name. */
  function context(profileId = null) {
    const p = profileOf(profileId);
    if (!p) return null;
    const saved = guildStore?.data?.characters?.[p.id]?.guild || null;
    const character = who({ name: p.name, realm: p.realm || "" });
    return { profileId: p.id, name: p.name, realm: p.realm || null, faction: ["horde", "alliance"].includes(lower(p.faction)) ? lower(p.faction) : null, level: Number.isSafeInteger(p.level) ? p.level : null,
      className: p.className || null, guildName: typeof saved?.guild === "string" ? saved.guild : null, usable: Boolean(character), fromGame: p.source?.kind === "wow-addon" };
  }
  const characterOf = (profileId) => { const c = context(profileId); return c?.usable ? { name: c.name, realm: c.realm } : null; };
  const withNames = (view) => ({ ...view,
    guilds: view.guilds.map((g) => ({ ...g, events: g.events.map((e) => ({ ...e, placeName: placeName(e.place) })) })),
    board: { ...view.board, mine: view.board.mine ? { ...view.board.mine, placeName: placeName(view.board.mine.place) } : null, listings: view.board.listings.map((l) => ({ ...l, placeName: placeName(l.place) })) },
    party: view.party ? { ...view.party, placeName: view.party.place ? placeName(view.party.place) : null } : null });
  /** Everything the main window's cards show for one character. */
  function state(profileId = null) {
    const c = context(profileId);
    // The board the screens look at is the realm and faction of the character in front.
    if (c?.realm && c.faction) service.setBoardPlace({ realm: c.realm, faction: c.faction });
    const view = withNames(service.view());
    const mine = c?.usable ? view.guilds.find((g) => sameWho(g.character, { name: c.name, realm: c.realm })) || null : null;
    return { ...view, now: now(), context: c, guildId: mine?.memberId || null, gameSide: feed.real === true, liveLink: Boolean(liveLink()),
      offersHere: c?.usable ? view.offers.filter((o) => sameWho(o.character, { name: c.name, realm: c.realm })) : [], places: places() };
  }
  // -------- the group planner
  function candidates(profileId, eventKey = null) {
    const c = context(profileId), view = service.view(), out = [], seen = new Set();
    const push = (m, source) => { const w = who(m); if (!w) return; const k = `${lower(w.realm)}|${lower(w.name)}`; if (seen.has(k)) return; seen.add(k); out.push({ ...m, ...w, source }); };
    for (const m of view.party?.members || []) push(m, "party");
    if (typeof eventKey === "string" && eventKey.includes("@")) {
      const eid = eventKey.slice(0, eventKey.indexOf("@")), gid = eventKey.slice(eventKey.indexOf("@") + 1);
      const g = view.guilds.find((x) => x.memberId === gid), e = g?.events.find((x) => x.id === eid);
      if (e) for (const role of ROLES) for (const name of e.names[role]) push({ name, realm: g.realm, role }, "signup");
    }
    for (const p of profiles()) if (c?.realm && lower(p.realm) === lower(c.realm) && lower(p.faction) === lower(c.faction)) push({ name: p.name, realm: p.realm, class: lower(p.className), level: p.level, online: p.id === c.profileId ? true : undefined }, "yours");
    return out;
  }
  function ownChecks(profileId, placeId) {
    const own = new Map();
    if (typeof attunements !== "function") return own;
    const c = context(profileId);
    for (const p of profiles()) {
      if (!c?.realm || lower(p.realm) !== lower(c.realm)) continue;
      let chains = [];
      try { chains = (attunements(p)?.chains || []).filter((x) => x.instanceId === placeId && x.status !== "unconfirmed"); } catch { chains = []; }
      own.set(`${lower(p.realm)}|${lower(p.name)}`, { attune: chains.map((x) => ({ name: x.name, status: x.status === "done" ? "done" : x.status === "unknown" ? "unknown" : "todo" })) });
    }
    return own;
  }
  function planView(profileId = null, eventKey = null) {
    const c = context(profileId);
    if (!c) return { empty: true };
    const plan = group.plan(c.profileId), people = candidates(c.profileId, eventKey);
    const view = service.view();
    const events = view.guilds.filter((g) => sameWho(g.character, { name: c.name, realm: c.realm || "" })).flatMap((g) => g.events.map((e) => ({ key: `${e.id}@${g.memberId}`, title: e.title, at: e.at, place: e.place })));
    // A plan the group's leader shared through the game is shown beside your own.
    const gamePlan = view.party?.plan ? P.fromGamePlan(view.party.plan, view.party.total) : null;
    const shared = gamePlan ? P.planView(gamePlan, { candidates: people, place: place(gamePlan.place) }) : null;
    return { empty: false, profileId: c.profileId, character: c.name, ...P.planView(plan, { candidates: people, place: place(plan.place), own: ownChecks(c.profileId, plan.place) }),
      places: places(), sizes: Object.keys(P.SIZES).map(Number), events, eventKey: events.some((e) => e.key === eventKey) ? eventKey : null, inGroup: Boolean(view.party), shared,
      sharedBy: view.party?.plan && view.party.leader ? view.party.leader.name : null, partyTotal: view.party?.total ?? null, gameSide: feed.real === true, pending: view.pending };
  }
  function changePlan(profileId, change) {
    const c = context(profileId);
    need(c);
    let plan = group.plan(c.profileId);
    if (change.action === "assign") plan = P.assign(plan, change.slot, change.member);
    else if (change.action === "note") plan = P.setSlotNote(plan, change.slot, change.note);
    else if (change.action === "shape") plan = P.reshape(plan, { place: change.place, size: change.size });
    else if (change.action === "auto") plan = P.autoFill(plan, candidates(c.profileId, change.eventKey));
    else if (change.action === "planNote") plan = { ...plan, note: change.note };
    else if (change.action === "clear") plan = P.emptyPlan(plan.place, plan.size);
    else need(false);
    group.setPlan(c.profileId, plan);
    service.planChanged();
    return planView(c.profileId, change.eventKey ?? null);
  }
  /** The plan for the hand-off: the one of the character the game last reported, or of the active one. */
  const handoffPlan = (character) => { const p = profileFor(character) || profileOf(null); return p ? P.handoffPlan(group.plan(p.id), { name: p.name, realm: p.realm || "" }) : null; };
  function regulars(profileId = null) {
    const c = context(profileId);
    return { ...P.regularsView(group.data, { me: c?.usable ? { name: c.name, realm: c.realm } : null, placeName }), character: c?.name || null };
  }
  /** Finished guild events this character attended (the saved file's "present" lists) count towards regulars. */
  function absorbSaved() {
    try {
      for (const [id, c] of Object.entries(guildStore?.data?.characters || {})) {
        const p = profiles().find((x) => x.id === id);
        if (c?.guild?.past?.length) group.sawEvents(c.guild.past.map((e) => ({ id: e.id, at: e.at, dungeon: e.dungeon, present: e.present })), p?.realm || c.realm || "");
      }
    } catch { /* regulars are a nicety */ }
  }
  /** What the always-on-top panel shows. */
  function panelView() {
    const c = context(null), s = state(null);
    const mine = c?.usable ? s.guilds.filter((g) => sameWho(g.character, { name: c.name, realm: c.realm })) : [];
    const events = (mine.length ? mine : s.guilds).flatMap((g) => g.events.map((e) => ({ guildId: g.memberId, guildName: g.guildName, id: e.id, title: e.title, place: e.place, placeName: e.placeName, at: e.at, note: e.note, roles: e.roles, counts: e.counts, mine: e.mine, waiting: e.waiting })))
      .sort((a, b) => a.at.localeCompare(b.at)).slice(0, 12);
    const plan = c ? planView(c.profileId) : null;
    return { now: s.now, live: s.live, pending: s.pending, waiting: s.waiting, character: c ? { name: c.name, realm: c.realm, faction: c.faction } : null, gameSide: s.gameSide, liveLink: s.liveLink,
      joined: s.guilds.length > 0, offers: s.offers.length, events, party: s.party, plan: plan && !plan.empty ? { slots: plan.slots, missing: plan.missing, bench: plan.bench, placeName: plan.placeName, place: plan.place, note: plan.note, filled: plan.filled, shared: plan.shared, sharedBy: plan.sharedBy } : null,
      board: s.board, places: s.places.map((p) => ({ id: p.id, name: p.name })) };
  }
  /**
   * Guild events for the Calendar: the saved file's entries (guild-events.cjs) with the live events of the
   * guilds the player joined. A live event replaces the saved one of the same id: its counts are newer.
   */
  function calendarEntries(savedEntries = []) {
    const LETTER = { tank: "t", healer: "h", damage: "d", maybe: "m", no: "n" };
    const out = new Map(savedEntries.map((e) => [e.kind === "event" ? String(e.key).split(":")[1] : e.key, e]));
    for (const g of service.view().guilds) {
      const p = profileFor(g.character);
      for (const e of g.events) {
        const at = Math.floor(Date.parse(e.at) / 1000);
        out.set(e.id, { key: `guild:${e.id}:${at}`, kind: "event", at, title: e.title, minutes: 120,
          detail: `${placeName(e.place)} · tanks ${e.counts.tank}/${e.roles.tank}, healers ${e.counts.healer}/${e.roles.healer}, damage ${e.counts.damage}/${e.roles.damage}${e.mine ? ` · you: ${e.mine}` : ""}`,
          mine: e.mine ? LETTER[e.mine] : null, profileId: p?.id || null, character: g.character.name, realm: g.character.realm, faction: p?.faction || null, past: at <= Math.floor(now() / 1000) });
      }
    }
    return [...out.values()].sort((a, b) => a.at - b.at || String(a.character).localeCompare(String(b.character)) || String(a.key).localeCompare(String(b.key)));
  }
  return { context, characterOf, state, planView, changePlan, handoffPlan, regulars, absorbSaved, panelView, placeName, places, calendarEntries };
}

function registerLiveGuildHandlers({ handle, hub, service, group, openExternal = async () => {}, copyText = () => {}, panel = null }) {
  const profile = (v) => (v === null || v === undefined ? null : (need(str(v, 100)), v));
  const snapshot = (profileId = null) => hub.state(profileId);
  handle("liveGuildState", (...args) => { need(args.length <= 1); return snapshot(profile(args[0])); });
  handle("liveGuildRefresh", async (...args) => { need(args.length <= 1); await service.refetch(); return snapshot(profile(args[0])); });
  handle("liveGuildCreate", async (...args) => {
    need(args.length === 1 && only(args[0], ["profileId", "rankIndex", "consent"]) && Number.isSafeInteger(args[0].rankIndex) && args[0].rankIndex >= 0 && args[0].rankIndex <= 9 && args[0].consent === true);
    const c = hub.context(profile(args[0].profileId));
    need(c);
    await service.createGuild({ character: { name: c.name, realm: c.realm || "" }, faction: c.faction, guildName: c.guildName || "", rankIndex: args[0].rankIndex, consent: true });
    return snapshot(c.profileId);
  });
  handle("liveGuildJoin", async (...args) => { need(args.length === 1 && only(args[0], ["code", "consent"]) && str(args[0].code, 40) && args[0].consent === true); await service.join(args[0].code, { consent: true }); return snapshot(); });
  handle("liveGuildDecline", (...args) => { need(args.length === 1 && only(args[0], ["code", "never"]) && str(args[0].code, 40) && typeof args[0].never === "boolean"); service.decline(args[0].code, { never: args[0].never }); return snapshot(); });
  handle("liveGuildAllow", (...args) => { need(args.length === 1 && str(args[0], 140)); service.allowAgain(args[0]); return snapshot(); });
  handle("liveGuildLeave", async (...args) => { need(args.length === 1 && guildId(args[0])); await service.leave(args[0]); return snapshot(); });
  handle("liveGuildDelete", async (...args) => { need(args.length === 1 && only(args[0], ["guildId", "typed"]) && guildId(args[0].guildId) && str(args[0].typed, 60)); await service.deleteGuild(args[0].guildId, args[0].typed); return snapshot(); });
  handle("liveGuildRotate", async (...args) => { need(args.length === 1 && guildId(args[0])); await service.rotateCode(args[0]); return snapshot(); });
  handle("liveGuildRemoveMember", async (...args) => { need(args.length === 1 && only(args[0], ["guildId", "name"]) && guildId(args[0].guildId) && str(args[0].name, 30)); await service.removeMember(args[0].guildId, args[0].name); return snapshot(); });
  handle("liveDiscord", async (...args) => {
    need(args.length === 1 && only(args[0], ["action", "guildId", "code"]) && guildId(args[0].guildId) && ["start", "test", "disconnect", "link", "unlink", "refresh"].includes(args[0].action));
    const { action, guildId: id } = args[0];
    let result = {};
    if (action === "start") { const { url } = await service.discordStart(id); await openExternal(url); result = { opened: true }; } // Discord's own page, in the system browser
    else if (action === "test") result = await service.discordTest(id);
    else if (action === "disconnect") result = await service.discordDisconnect(id);
    else if (action === "link") { need(str(args[0].code, 80)); result = await service.discordLink(id, args[0].code); }
    else if (action === "unlink") result = await service.discordUnlink(id);
    else await service.refreshGuild(id, { force: true });
    return { ...result, state: snapshot() };
  });
  handle("liveEvent", async (...args) => {
    need(args.length === 1 && only(args[0], ["action", "guildId", "eventId", "answer", "event", "summary"]) && guildId(args[0].guildId));
    const a = args[0];
    let result;
    if (a.action === "answer") { need(str(a.eventId, 24) && ANSWERS.includes(a.answer)); result = await service.answer(a.guildId, a.eventId, a.answer); }
    else if (a.action === "save") {
      need(only(a.event, ["id", "at", "place", "title", "note", "roles"]) && str(a.event.title, 200) && str(a.event.at, 40) && str(a.event.place, 8) && (a.event.note === undefined || str(a.event.note, 400)) && only(a.event.roles, ROLES) && (a.event.id === undefined || str(a.event.id, 24)));
      result = await service.saveEvent(a.guildId, a.event);
    } else if (a.action === "cancel") { need(str(a.eventId, 24)); result = await service.cancelEvent(a.guildId, a.eventId); }
    else if (a.action === "summary") {
      // E3, officers: who came, bosses and time of a finished event, for the guild's Discord.
      need(str(a.eventId, 24) && only(a.summary, ["attended", "bosses", "durationSec"]) && Array.isArray(a.summary.attended) && a.summary.attended.length <= 80 && a.summary.attended.every((n) => str(n, 60)) && Number.isSafeInteger(a.summary.bosses) && Number.isSafeInteger(a.summary.durationSec));
      result = await service.postSummary(a.guildId, a.eventId, { ...a.summary, attended: a.summary.attended.map((n) => n.split("-")[0]) });
    }
    else need(false);
    return { ...result, state: snapshot() };
  });
  handle("liveBoard", async (...args) => {
    need(args.length === 1 && only(args[0], ["action", "profileId", "listing", "consent"]) && ["on", "off", "watch", "unwatch", "browse", "post", "renew", "remove"].includes(args[0].action));
    const a = args[0], c = hub.context(profile(a.profileId));
    if (c?.realm && c.faction) service.setBoardPlace({ realm: c.realm, faction: c.faction });
    let result = {};
    if (a.action === "on") { need(a.consent === true); await service.setBoard(true); service.watchBoard(true); await service.browse().catch(() => {}); }
    else if (a.action === "off") await service.setBoard(false);
    else if (a.action === "watch") { service.watchBoard(true); const b = service.boardView(); if (b.on && !b.loadedAt) await service.browse().catch(() => {}); }
    else if (a.action === "unwatch") service.watchBoard(false);
    else if (a.action === "browse") await service.browse();
    else if (a.action === "post") {
      need(c && only(a.listing, ["kind", "roles", "place", "note", "need"]) && ["lfg", "lfm"].includes(a.listing.kind) && Array.isArray(a.listing.roles) && a.listing.roles.length <= 3 && str(a.listing.place, 8) && (a.listing.note === undefined || str(a.listing.note, 300)) && (a.listing.need === undefined || a.listing.need === null || only(a.listing.need, ROLES)));
      // The character's name, level and class come from the app's own saved character, never from the form.
      result = await service.post({ ...a.listing, who: { name: c.name, realm: c.realm || "" }, level: c.level, class: lower(c.className) }, { consent: a.consent === true });
    } else if (a.action === "renew") result = await service.renew();
    else result = await service.removeListing();
    return { ...result, state: snapshot(c?.profileId ?? null) };
  });
  handle("livePlan", (...args) => {
    need(args.length === 1 && only(args[0], ["action", "profileId", "slot", "member", "note", "place", "size", "eventKey"]));
    const a = args[0], id = profile(a.profileId);
    need(a.eventKey === undefined || a.eventKey === null || str(a.eventKey, 200));
    if (a.action === "get") return hub.planView(id, a.eventKey ?? null);
    need(["assign", "note", "shape", "auto", "planNote", "clear"].includes(a.action));
    if (a.action === "assign") need(Number.isSafeInteger(a.slot) && (a.member === null || only(a.member, ["name", "realm"])));
    if (a.action === "note") need(Number.isSafeInteger(a.slot) && str(a.note, 300));
    if (a.action === "planNote") need(str(a.note, 600));
    if (a.action === "shape") need((a.place === undefined || str(a.place, 8)) && (a.size === undefined || [5, 10, 20, 40].includes(a.size)));
    return hub.changePlan(id, a);
  });
  handle("liveRegulars", (...args) => { need(args.length <= 1); return hub.regulars(profile(args[0])); }, { privateOnly: true });
  handle("liveRegularNote", (...args) => {
    need(args.length === 1 && only(args[0], ["name", "realm", "note", "forget"]) && str(args[0].name, 30) && str(args[0].realm, 50));
    const c = { name: args[0].name, realm: args[0].realm };
    if (args[0].forget === true) group.forget(c); else { need(str(args[0].note, 2000)); group.setNote(c, args[0].note); }
    return hub.regulars(null);
  }, { privateOnly: true });
  handle("liveCopy", (...args) => { need(args.length === 1 && typeof args[0] === "string" && COPYABLE.test(args[0])); copyText(args[0]); return true; }, { privateOnly: true });
  handle("livePanel", (...args) => {
    need(args.length === 1 && only(args[0], ["action", "tab"]) && ["open", "close", "status"].includes(args[0].action) && (args[0].tab === undefined || ["events", "party", "board"].includes(args[0].tab)));
    if (!panel) return { open: false, available: false };
    if (args[0].action === "open") panel.open(args[0].tab);
    else if (args[0].action === "close") panel.close();
    return { open: panel.isOpen(), available: true, settings: panel.settings() };
  });
  handle("livePrivacy", (...args) => { need(args.length <= 1); const c = hub.characterOf(profile(args[0])); return { ...service.preview(c), guilds: service.view().guilds.map((g) => ({ guildId: g.memberId, guildName: g.guildName, character: g.character.name })), board: service.view().board.on }; });
}
module.exports = { createLiveGuildHub, registerLiveGuildHandlers, COPYABLE };
