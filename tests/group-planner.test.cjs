"use strict";
// The group planner and regulars (group-planner.cjs), the panel's remembered place (guild-panel-window.cjs),
// the feed door (guild-feed-link.cjs) and the hub that feeds the windows (live-guild-ipc.cjs).
// All of it is local: nothing in this file opens a connection.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventEmitter } = require("node:events");
const P = require("../src/core/group-planner.cjs");
const { panelSettings, placeOn, createGuildPanel, DEFAULT, MIN, MAX } = require("../src/core/guild-panel-window.cjs");
const { resolveFeed } = require("../src/core/guild-feed-link.cjs");
const { createLiveGuildHub, registerLiveGuildHandlers, COPYABLE } = require("../src/core/live-guild-ipc.cjs");
const { GuildService } = require("../src/core/guild-service.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-group-"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const R = "Thunder Hold";
const who = (name) => ({ name, realm: R });
const PARTY = { character: who("Abel"), leader: who("Bruna"), place: "sm", members: [
  { ...who("Bruna"), class: "warrior", role: "tank", level: 40, online: true }, { ...who("Abel"), class: "priest", role: "healer", level: 38, online: true },
  { ...who("Cyra"), class: "mage", role: "damage", level: 31, online: true, missing: ["Scarlet Key"] }, { ...who("Dorn"), class: "rogue", role: "damage", level: 40, online: false }, { ...who("Elka"), class: "hunter", role: "damage", level: 39, online: true }] };

test("a plan has the right slots for 5, 10, 20 and 40 players, and any stored plan is checked", () => {
  assert.deepEqual(P.emptyPlan("sm", 5).slots.map((s) => s.role), ["tank", "healer", "damage", "damage", "damage"]);
  for (const [size, counts] of Object.entries(P.SIZES)) {
    const p = P.emptyPlan("mc", Number(size));
    assert.equal(p.slots.length, Number(size));
    for (const role of ["tank", "healer", "damage"]) assert.equal(p.slots.filter((s) => s.role === role).length, counts[role]);
  }
  assert.equal(P.emptyPlan("Not A Place", 7).place, "other"); assert.equal(P.emptyPlan("sm", 7).size, 5);
  const messy = P.planShape({ place: "sm", size: 5, note: "Meet at the |cffff0000stone|r", extra: 1, slots: [
    { role: "tank", name: "Bruna", realm: R, note: "Pull", guid: "x" }, { role: "tank", name: "Second", realm: R }, { role: "healer", name: "Bruna", realm: R },
    { role: "bard", name: "Zed", realm: R }, { role: "damage", name: "x1", realm: R, note: "see www.example.com" }, null] });
  assert.deepEqual(messy.slots[0], { role: "tank", name: "Bruna", realm: R, note: "Pull" });
  assert.equal(messy.slots[1].name, null, "a member holds one slot; the second tank had no slot left");
  assert.equal(messy.slots[2].name, null, "a bad name is left out"); assert.equal(messy.slots[2].note, "", "and a note with a web address too");
  assert.equal(messy.note, "Meet at the cffff0000stone r");
  assert.deepEqual(Object.keys(messy), ["place", "size", "note", "at", "slots"]);
  assert.deepEqual(P.planShape(null), P.emptyPlan());
  assert.deepEqual(P.planShape("{}"), P.emptyPlan());
});

test("assign moves, swaps and clears; notes, reshape and auto-fill keep what fits and guess nothing", () => {
  let p = P.emptyPlan("sm", 5);
  p = P.assign(p, 0, who("Bruna")); p = P.assign(p, 2, who("Cyra"));
  assert.deepEqual(p.slots.map((s) => s.name), ["Bruna", null, "Cyra", null, null]);
  p = P.assign(p, 3, who("Cyra"));
  assert.deepEqual(p.slots.map((s) => s.name), ["Bruna", null, null, "Cyra", null], "moving takes them out of the old slot");
  p = P.assign(p, 0, who("Cyra"));
  assert.deepEqual(p.slots.map((s) => s.name), ["Cyra", null, null, "Bruna", null], "dropping on a taken slot swaps the two");
  p = P.assign(p, 1, who("Abel")); p = P.assign(p, 1, who("Elka"));
  assert.deepEqual(p.slots.map((s) => s.name), ["Cyra", "Elka", null, "Bruna", null], "a new name replaces the old one, who goes back to the bench");
  p = P.assign(p, 0, null); p = P.assign(p, 99, who("Zed")); p = P.assign(p, 1, { name: "1", realm: "" });
  assert.deepEqual(p.slots.map((s) => s.name), [null, null, null, "Bruna", null]);
  p = P.setSlotNote(p, 3, "  Kick   the healer  "); p = P.setSlotNote(p, 50, "x");
  assert.equal(p.slots[3].note, "Kick the healer");
  // Auto-fill uses only the roles people named.
  const filled = P.autoFill(P.emptyPlan("sm", 5), [...PARTY.members, { ...who("Fenn"), class: "druid", level: 40 }]);
  assert.deepEqual(filled.slots.map((s) => s.name), ["Bruna", "Abel", "Cyra", "Dorn", "Elka"]);
  assert.deepEqual(P.autoFill(P.emptyPlan("sm", 5), [{ ...who("Fenn"), class: "druid" }]).slots.map((s) => s.name), [null, null, null, null, null], "no role named: not placed");
  // A bigger group keeps everybody; a smaller one keeps who fits, role by role.
  const ten = P.reshape(filled, { size: 10, place: "zg" });
  assert.equal(ten.place, "zg"); assert.equal(ten.slots.length, 10);
  assert.deepEqual(ten.slots.filter((s) => s.name).map((s) => [s.role, s.name]), [["tank", "Bruna"], ["healer", "Abel"], ["damage", "Cyra"], ["damage", "Dorn"], ["damage", "Elka"]]);
  assert.deepEqual(P.reshape(ten, { size: 5 }).slots.map((s) => s.name), ["Bruna", "Abel", "Cyra", "Dorn", "Elka"]);
});

test("the planner shows only what the app knows: level, offline, what the game shared, and keys of your own characters", () => {
  const plan = P.autoFill(P.emptyPlan("sm", 5), PARTY.members);
  const own = new Map([["thunder hold|abel", { attune: [{ name: "The Scarlet Key", status: "todo" }, { name: "Done chain", status: "done" }] }]]);
  const v = P.planView(plan, { candidates: PARTY.members.map((m) => ({ ...m, source: "party" })), place: { id: "sm", name: "Scarlet Monastery", min: 34, max: 45 }, own });
  assert.equal(v.placeName, "Scarlet Monastery"); assert.equal(v.filled, 5); assert.deepEqual(v.missing, []); assert.deepEqual(v.bench, []);
  const by = Object.fromEntries(v.slots.map((s) => [s.name, s.warnings.map((w) => `${w.kind}:${w.text}${w.detail ? `:${w.detail}` : ""}`)]));
  assert.deepEqual(by.Bruna, []);
  assert.deepEqual(by.Abel, ["key:Key or attunement not finished:The Scarlet Key"], "only your own character's keys are known");
  assert.deepEqual(by.Cyra, ["level:Level 31: under level 34", "missing:Scarlet Key"]);
  assert.deepEqual(by.Dorn, ["offline:Offline"]);
  assert.equal(v.slots.find((s) => s.name === "Abel").yours, true); assert.equal(v.slots.find((s) => s.name === "Cyra").yours, false);
  assert.equal(v.ready, false);
  // Somebody who left the group, a role that does not match, and open slots.
  const odd = P.assign(P.assign(P.emptyPlan("sm", 5), 0, who("Gone")), 1, who("Cyra"));
  const o = P.planView(odd, { candidates: PARTY.members, place: null });
  assert.deepEqual(o.slots[0].warnings.map((w) => w.text), ["Not in your group right now"]);
  assert.deepEqual(o.slots[1].warnings.map((w) => w.text), ["Signed up as damage", "Scarlet Key"]);
  assert.deepEqual(o.missing, [{ role: "damage", open: 3 }]);
  assert.deepEqual(o.bench.map((m) => m.name), ["Bruna", "Abel", "Dorn", "Elka"]);
  // What the game gets (the addon's shape): filled slots only, name, role and the slot's note as "bring".
  assert.deepEqual(P.handoffPlan(P.setSlotNote(odd, 1, "Sheep the left one"), who("Abel")), { place: "sm", for: who("Abel"), members: [{ name: "Gone", role: "tank" }, { name: "Cyra", role: "healer", bring: "Sheep the left one" }] });
  assert.equal(P.handoffPlan({ ...P.assign(P.emptyPlan("sm", 5), 0, who("Bruna")), note: "n".repeat(120) }).note.length, 80, "the game's note holds 80 characters");
  // And back: the roles the group's leader set in game, as the game reports them.
  const back = P.fromGamePlan({ place: "mc", at: "2026-11-24T18:00:00Z", members: [{ name: "Bruna", realm: R, role: "tank" }, { name: "Abel", realm: R, role: "healer" }, { name: "Cyra", realm: R, role: "damage" }, { name: "Odd", realm: R, role: null }] }, 5);
  assert.deepEqual([back.place, back.size, back.slots.map((s) => s.name)], ["mc", 5, ["Bruna", "Abel", "Cyra", null, null]]);
  assert.equal(P.fromGamePlan({ place: "mc", members: ["Heala", "Healb", "Healc", "Heald"].map((name) => ({ name, realm: R, role: "healer" })) }, 5).size, 20, "a bigger group gets the size its roles need");
  assert.equal(P.handoffPlan(P.emptyPlan("sm", 5)), null, "an empty plan hands nothing over");
});

test("regulars: a run together is counted once per person, place and four hours; guild events count once; notes and the whisper line", () => {
  const t0 = Date.UTC(2026, 10, 24, 18, 0, 0);
  let d = P.recordParty(null, PARTY, t0).data;
  d = P.recordParty(d, PARTY, t0 + 60 * 1000).data;                 // the same run, a minute later
  d = P.recordParty(d, PARTY, t0 + 3 * 3600 * 1000).data;           // still the same evening
  assert.deepEqual(Object.values(d.regulars).map((r) => [r.name, r.runs]), [["Bruna", 1], ["Cyra", 1], ["Dorn", 1], ["Elka", 1]], "yourself is not on the list");
  d = P.recordParty(d, { ...PARTY, place: "ulda" }, t0 + 3.5 * 3600 * 1000).data;   // another dungeon
  d = P.recordParty(d, { ...PARTY, members: PARTY.members.slice(0, 3) }, t0 + 30 * 3600 * 1000).data; // the next day, fewer people
  d = P.recordParty(d, { ...PARTY, place: null }, t0 + 50 * 3600 * 1000).data;      // grouped in the open world: seen, not a run
  const view = P.regularsView(d, { me: who("Abel"), placeName: (id) => ({ sm: "Scarlet Monastery", ulda: "Uldaman" })[id] });
  assert.deepEqual(view.rows.map((r) => [r.name, r.runs, r.places.map((p) => `${p.name} ${p.runs}`).join(", ")]),
    [["Bruna", 3, "Scarlet Monastery 2, Uldaman 1"], ["Cyra", 3, "Scarlet Monastery 2, Uldaman 1"], ["Dorn", 2, "Scarlet Monastery 1, Uldaman 1"], ["Elka", 2, "Scarlet Monastery 1, Uldaman 1"]]);
  assert.equal(view.rows[0].class, "warrior"); assert.equal(view.rows[0].lastRun, t0 + 30 * 3600 * 1000);
  assert.equal(view.rows[0].lastSeen, t0 + 50 * 3600 * 1000);
  // Guild events this character was at.
  const events = [{ id: "mc7k2m9q", at: 1795000000, dungeon: "mc", present: ["Bruna", "Zed-Stormrage", "bad name 1"] }, { id: "nobody", at: 1795000001, dungeon: "mc", present: [] }];
  const e1 = P.recordEvents(d, events, R); const e2 = P.recordEvents(e1.data, events, R);
  assert.equal(e1.changed, true); assert.equal(e2.changed, false, "the same event is not counted twice");
  assert.equal(e2.data.regulars["thunder hold|bruna"].runs, 4); assert.equal(e2.data.regulars["stormrage|zed"].runs, 1);
  // The whisper line is for the player to paste; another realm gets its name without spaces.
  assert.equal(P.whisperCommand(who("Cyra"), R), "/w Cyra "); assert.equal(P.whisperCommand({ name: "Zed", realm: "Azjol Nerub" }, R), "/w Zed-AzjolNerub ");
  assert.equal(P.whisperCommand({ name: "x" }, R), null);
  for (const line of ["/w Cyra ", "/w Zed-AzjolNerub ", "/bf guild link BFG-7K2M-Q9XD", "/backstage link", "/backstage channel"]) assert.match(line, COPYABLE);
  for (const line of ["/w Cyra buy gold", "/run SendChatMessage('x')", "/bf guild link", "rm -rf", "/w a|b "]) assert.doesNotMatch(line, COPYABLE, "only whisper, link and Discord command lines may be copied");
});

test("the store keeps plans per character, regulars and notes in one local file and survives a damaged one", () => {
  const dir = tmp(), file = path.join(dir, "group.json");
  const s = new P.GroupStore({ file, now: () => Date.UTC(2026, 10, 24, 18) });
  s.setPlan("p1", P.assign(P.emptyPlan("sm", 5), 0, who("Bruna")));
  assert.equal(s.plan("p1").slots[0].name, "Bruna"); assert.equal(s.plan("p1").at, "2026-11-24T18:00:00Z");
  assert.deepEqual(s.plan("p2"), P.emptyPlan(), "another character has its own plan");
  assert.equal(s.sawParty(PARTY), true); assert.equal(s.sawParty(PARTY), false);
  assert.equal(s.setNote(who("Cyra"), " Fast mage "), "Fast mage");
  assert.throws(() => s.setNote(who("Cyra"), "see discord.gg/x"), /web address/); assert.throws(() => s.setNote({ name: "1" }, "x"), /Invalid note/);
  const again = new P.GroupStore({ file });
  assert.equal(again.plan("p1").slots[0].name, "Bruna");
  assert.equal(P.regularsView(again.data, { me: who("Abel") }).rows.find((r) => r.name === "Cyra").note, "Fast mage");
  again.forget(who("Cyra"));
  assert.equal(P.regularsView(again.data, {}).rows.some((r) => r.name === "Cyra"), false);
  again.clearPlan("p1"); assert.deepEqual(again.plan("p1"), P.emptyPlan());
  fs.writeFileSync(file, JSON.stringify({ plans: { __proto__: { x: 1 }, p9: "junk" }, regulars: { "x|y": { name: "Other", realm: "x" }, "thunder hold|bruna": { name: "Bruna", realm: R, runs: "many", places: { "bad place": 3, sm: 2 } } }, seen: [1, "ok"], notes: { nokey: "x", "a|b": "see www.example.com", "thunder hold|bruna": "Good tank" } }));
  const fixed = new P.GroupStore({ file });
  assert.deepEqual(Object.keys(fixed.data.regulars), ["thunder hold|bruna"]); assert.deepEqual(fixed.data.regulars["thunder hold|bruna"].places, { sm: 2 }); assert.equal(fixed.data.regulars["thunder hold|bruna"].runs, 0);
  assert.deepEqual(fixed.data.notes, { "thunder hold|bruna": "Good tank" }); assert.deepEqual(fixed.data.seen, ["ok"]);
  fs.writeFileSync(file, "{ not json");
  assert.deepEqual(new P.GroupStore({ file }).plan("p1"), P.emptyPlan());
});

test("the panel: default size, limits, a remembered place that is still on a screen, and its settings", () => {
  assert.deepEqual(panelSettings(null), { bounds: null, opacity: 100, hideInCombat: false, openAtStart: false, tab: "events", introSeen: false });
  assert.deepEqual(panelSettings({ bounds: { x: 10.4, y: 20, width: 5000, height: 10 }, opacity: 12, hideInCombat: "yes", tab: "loot", introSeen: true }),
    { bounds: { x: 10, y: 20, width: MAX.width, height: MIN.height }, opacity: 40, hideInCombat: false, openAtStart: false, tab: "events", introSeen: true });
  assert.equal(panelSettings({ opacity: 73 }).opacity, 75, "five-percent steps");
  const one = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }], two = [...one, { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }];
  assert.deepEqual(placeOn(one, null), { x: 1920 - 380 - 24, y: 64, width: DEFAULT.width, height: DEFAULT.height }, "first time: top right of the main screen");
  assert.deepEqual(placeOn(two, { x: 2300, y: 200, width: 420, height: 600 }), { x: 2300, y: 200, width: 420, height: 600 }, "a place on the second monitor is kept");
  assert.deepEqual(placeOn(one, { x: 2300, y: 200, width: 420, height: 600 }), { x: 1920 - 420 - 24, y: 64, width: 420, height: 600 }, "that monitor is gone: back onto a screen, size kept");
  assert.deepEqual(placeOn([], null), { width: DEFAULT.width, height: DEFAULT.height });
  // The window itself: always on top, shown without taking the keyboard, clicks never pass through, requests only from its own page.
  const made = [], handlers = {};
  class FakeWindow {
    constructor(o) { this.o = o; this.calls = []; this.webContents = { setWindowOpenHandler: () => {}, on: () => {}, send: (...a) => this.calls.push(["send", a[0]]), mainFrame: {} }; made.push(this); }
    setAlwaysOnTop(...a) { this.calls.push(["top", ...a]); } setIgnoreMouseEvents(v) { this.calls.push(["ignore", v]); } setOpacity(v) { this.calls.push(["opacity", v]); }
    once(name, fn) { if (name === "ready-to-show") fn(); } on() {} loadURL(u) { this.url = u; } showInactive() { this.calls.push(["showInactive"]); } show() { this.calls.push(["show"]); } focus() { this.calls.push(["focus"]); }
    isDestroyed() { return false; } isVisible() { return true; } getBounds() { return { x: 1, y: 2, width: 380, height: 520 }; } close() { this.closed = true; }
  }
  const dir = tmp();
  const panel = createGuildPanel({ BrowserWindow: FakeWindow, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, screen: { getAllDisplays: () => one }, rendererDir: path.join(__dirname, "..", "src", "renderer"), dataDir: dir, view: () => ({ events: [] }) });
  panel.open("board");
  const w = made[0];
  assert.equal(w.o.alwaysOnTop, true); assert.equal(w.o.frame, false); assert.equal(w.o.resizable, true); assert.equal(w.o.show, false);
  assert.deepEqual([w.o.minWidth, w.o.minHeight, w.o.maxWidth, w.o.maxHeight, w.o.width, w.o.height], [320, 300, 640, 900, 380, 520]);
  assert.deepEqual(w.o.webPreferences, { preload: w.o.webPreferences.preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
  assert.match(w.o.webPreferences.preload, /guild-panel-preload\.cjs$/);
  assert.deepEqual(w.calls.filter((c) => ["top", "ignore", "showInactive", "show", "focus"].includes(c[0])), [["top", true, "screen-saver"], ["ignore", false], ["showInactive"]], "on top, clicks land on it, shown without focus");
  assert.equal(panel.settings().tab, "board");
  assert.deepEqual(Object.keys(handlers).sort(), ["guildPanel:answer", "guildPanel:app", "guildPanel:board", "guildPanel:close", "guildPanel:plan", "guildPanel:settings", "guildPanel:state"]);
  return assert.rejects(handlers["guildPanel:state"]({ sender: {}, senderFrame: {} }), /Untrusted guild panel request/);
});

test("the panel page keeps the strict page rules and never holds an inline style", () => {
  const html = read("src/renderer/guild-panel.html"), js = read("src/renderer/guild-panel.js");
  assert.match(html, /default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'/);
  assert.match(html, /aria-live="polite"/); assert.match(html, /role="tablist"/);
  assert.ok(html.indexOf('<script src="locales/de.js">') < html.indexOf('<script src="i18n.js">') && html.indexOf('<script src="i18n.js">') < html.indexOf('<script src="guild-panel.js">'), "the dictionaries load before the translator, like the main window");
  for (const file of ["src/renderer/guild-panel.js", "src/renderer/live-guild.js"]) assert.doesNotMatch(read(file), /style="/, `${file}: no inline styles (the page rules forbid them)`);
  assert.doesNotMatch(js, /innerHTML = [^`"]*\$\{(?!esc|keep)/, "values are escaped");
  const preload = read("src/guild-panel-preload.cjs");
  assert.deepEqual([...preload.matchAll(/^\s+(\w+): /gm)].map((m) => m[1]), ["state", "close", "settings", "answer", "board", "plan", "app", "onState"], "a narrow bridge");
});

test("the feed door accepts the module however it is exported, and works without it", () => {
  const e = new EventEmitter(); e.setHandoff = function (d) { this.got = d; };
  assert.equal(resolveFeed(e).feed, e); resolveFeed(e).setHandoff({ a: 1 }); assert.deepEqual(e.got, { a: 1 });
  const seen = [];
  const named = resolveFeed({ feed: new EventEmitter(), setHandoff: (d) => seen.push(d) });
  assert.ok(named.feed instanceof EventEmitter); named.setHandoff({ b: 2 }); assert.deepEqual(seen, [{ b: 2 }]);
  assert.ok(resolveFeed({ gameGuildFeed: new EventEmitter() }).feed instanceof EventEmitter);
  assert.deepEqual(resolveFeed(null), { feed: null, setHandoff: null }); assert.deepEqual(resolveFeed({ nothing: 1 }), { feed: null, setHandoff: null });
  const link = require("../src/core/guild-feed-link.cjs");
  assert.equal(typeof link.feed.on, "function"); assert.equal(typeof link.setHandoff, "function");
  // The desktop side only listens and hands data over: it never requires the hand-off writer or the live-bridge decoder itself.
  for (const file of ["src/core/guild-service.cjs", "src/core/live-client.cjs", "src/core/live-guild-ipc.cjs", "src/core/group-planner.cjs", "src/core/guild-panel-window.cjs"]) assert.doesNotMatch(read(file), /require\([^)]*(desktop-handoff|live-bridge|game-guild-feed)/, file);
  assert.match(read("src/core/guild-feed-link.cjs"), /require\("\.\/game-guild-feed\.cjs"\)/);
});

test("the hub: one character's context, candidates for the planner, the panel's view, and guild events on the Calendar", async () => {
  const dir = tmp();
  const state = { activeProfileId: "p2", profiles: [{ id: "p1", name: "Bruna", realm: R, faction: "Horde", level: 60, className: "Warrior", source: { kind: "wow-addon" } }, { id: "p2", name: "Abel", realm: R, faction: "Horde", level: 60, className: "Priest" }, { id: "p3", name: "Otto", realm: "Elsewhere", faction: "Alliance", level: 12, className: "Mage" }] };
  const guildStore = { data: { characters: { p1: { name: "Bruna", realm: R, guild: { guild: "Ashen Vanguard", past: [{ id: "old00001", at: 1795000000, dungeon: "mc", present: ["Bruna", "Cyra"] }] } }, p2: { name: "Abel", realm: R, guild: { guild: "Ashen Vanguard", past: [] } } } } };
  const feed = new EventEmitter();
  const service = new GuildService({ dir, community: { settings: { installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }, request: async () => { throw Error("offline"); } }, feed });
  const group = new P.GroupStore({ file: path.join(dir, "group.json") });
  const hub = createLiveGuildHub({ getState: () => state, guildStore, service, group, feed: { real: false }, liveLink: () => true,
    attunements: (p) => ({ chains: p.name === "Abel" ? [{ instanceId: "mc", name: "Attunement to the Core", status: "started" }, { instanceId: "ony", name: "Onyxia", status: "done" }] : [] }) });
  try {
    assert.deepEqual(hub.context("p1"), { profileId: "p1", name: "Bruna", realm: R, faction: "horde", level: 60, className: "Warrior", guildName: "Ashen Vanguard", usable: true, fromGame: true });
    assert.equal(hub.context(null).profileId, "p2", "no id: the active character"); assert.equal(hub.context("unknown").profileId, "p2");
    assert.equal(hub.context("p3").guildName, null);
    const s = hub.state(null);
    assert.equal(s.guildId, null); assert.equal(s.gameSide, false); assert.equal(s.liveLink, true); assert.deepEqual(s.board.where, { realm: R, faction: "horde" });
    assert.ok(s.places.some((p) => p.id === "mc" && p.name === "Molten Core") && s.places.at(-1).id === "other");
    // The group from the game, and your own characters on the same realm and faction, are at hand for the planner.
    feed.emit("party", { ...PARTY, place: "mc" });
    let plan = hub.planView(null);
    assert.deepEqual(plan.bench.map((m) => `${m.name}:${m.source}`), ["Bruna:party", "Abel:party", "Cyra:party", "Dorn:party", "Elka:party"]);
    assert.equal(plan.inGroup, true); assert.deepEqual(plan.sizes, [5, 10, 20, 40]);
    plan = hub.changePlan(null, { action: "shape", place: "mc" });
    plan = hub.changePlan(null, { action: "auto" });
    assert.deepEqual(plan.slots.map((x) => x.name), ["Bruna", "Abel", "Cyra", "Dorn", "Elka"]);
    assert.deepEqual(plan.slots[1].warnings.map((w) => `${w.text}:${w.detail}`), ["Level 38: under level 60:undefined", "Key or attunement not finished:Attunement to the Core"], "your own character's attunement for this place");
    assert.deepEqual(plan.slots[2].warnings.map((w) => w.text), ["Level 31: under level 60", "Scarlet Key"]);
    plan = hub.changePlan(null, { action: "note", slot: 0, note: "Main tank" });
    plan = hub.changePlan(null, { action: "planNote", note: "Stone at 19:45" });
    assert.deepEqual(hub.handoffPlan({ name: "Abel", realm: R }).members[0], { name: "Bruna", role: "tank", bring: "Main tank" });
    assert.deepEqual(hub.handoffPlan({ name: "Abel", realm: R }).for, { name: "Abel", realm: R });
    assert.equal(hub.handoffPlan({ name: "Abel", realm: R }).note, "Stone at 19:45");
    assert.equal(hub.handoffPlan({ name: "Bruna", realm: R }), null, "another character's plan is its own");
    assert.throws(() => hub.changePlan(null, { action: "explode" }), /Invalid guild request/);
    // Regulars: from the group just seen, and from guild events the saved file says a character was at.
    group.sawParty({ ...PARTY, place: "mc" });
    hub.absorbSaved();
    const regulars = hub.regulars(null);
    assert.deepEqual(regulars.rows.map((r) => [r.name, r.runs]), [["Bruna", 2], ["Cyra", 2], ["Dorn", 1], ["Elka", 1]]);
    assert.equal(regulars.rows[0].places[0].name, "Molten Core"); assert.equal(regulars.rows[1].whisper, "/w Cyra ");
    // The panel's picture.
    const panel = hub.panelView();
    assert.deepEqual([panel.joined, panel.offers, panel.events, panel.party.members.length, panel.party.placeName, panel.plan.filled, panel.board.on], [false, 0, [], 5, "Molten Core", 5, false]);
    assert.doesNotMatch(JSON.stringify(panel), /"member":/);
    // Calendar: live events of joined guilds replace the saved entry of the same event.
    service.state.guilds.push({ guildId: "g_test", guildName: "Ashen Vanguard", realm: R, faction: "horde", character: who("Abel"), member: "t".repeat(43), role: "member", rankIndex: 5, linkCode: null, linkHeard: false, joinedAt: 1, discord: { state: "none" }, linkedDiscord: null,
      thresholds: { officerRank: 1, proposeRank: 9, editRank: 1 }, members: [], memberCount: 2, syncedAt: 0, testAt: 0, signups: { mc7k2m9q: [{ who: who("Abel"), answer: "healer", version: 1, via: "desktop" }, { who: who("Bruna"), answer: "tank", version: 1, via: "game" }] },
      events: [{ id: "mc7k2m9q", version: 2, creator: who("Bruna"), editor: who("Bruna"), at: new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, "Z"), place: "mc", title: "Molten Core", note: "", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false }] });
    const at = Math.floor(Date.parse(service.state.guilds[0].events[0].at) / 1000);
    const entries = hub.calendarEntries([{ key: `guild:mc7k2m9q:${at}`, kind: "event", at, title: "Old title", minutes: 120, detail: "saved", character: "Abel" }, { key: "p1:lock:Molten Core:1", kind: "lockout", at: at + 5, title: "Molten Core resets", character: "Bruna" }]);
    assert.equal(entries.length, 2);
    assert.deepEqual([entries[0].title, entries[0].detail, entries[0].mine, entries[0].profileId, entries[0].character, entries[0].kind], ["Molten Core", "Molten Core · tanks 1/2, healers 1/8, damage 0/30 · you: healer", "h", "p2", "Abel", "event"]);
    assert.equal(entries[1].kind, "lockout");
    assert.equal(hub.panelView().events[0].mine, "healer"); assert.equal(hub.planView(null).events[0].title, "Molten Core");
    assert.doesNotMatch(JSON.stringify([hub.state(null), hub.panelView(), hub.planView(null)]), /t{43}/, "no view carries the member key");
    // The window's requests are checked before they reach the service.
    const calls = {};
    registerLiveGuildHandlers({ handle: (name, fn) => { calls[name] = fn; }, hub, service, group, copyText: (t) => { calls.copied = t; } });
    assert.throws(() => calls.liveCopy("/run something"), /Invalid guild request/); calls.liveCopy("/w Cyra "); assert.equal(calls.copied, "/w Cyra ");
    assert.throws(() => calls.livePlan({ action: "assign", slot: "0", member: null }), /Invalid guild request/);
    assert.throws(() => calls.livePlan({ action: "get", evil: 1 }), /Invalid guild request/);
    await assert.rejects(calls.liveGuildJoin({ code: "BFG-1", consent: "yes" }), /Invalid guild request/, "the bridge passes consent on only when it is literally true");
    await assert.rejects(calls.liveGuildCreate({ profileId: "p1", rankIndex: 0 }), /Invalid guild request/);
    await assert.rejects(calls.liveBoard({ action: "on" }), /Invalid guild request/, "the board is not switched on without the agreement");
    await assert.rejects(calls.liveBoard({ action: "post", listing: { kind: "lfg", roles: ["tank"], place: "sm", who: { name: "Other", realm: R }, level: 60 } }), /Invalid guild request/, "name and level never come from the form");
    await assert.rejects(calls.liveGuildDelete({ guildId: "../etc", typed: "x" }), /Invalid guild request/);
    assert.deepEqual(Object.keys(calls).filter((k) => k.startsWith("live")).sort(), ["liveBoard", "liveCopy", "liveDiscord", "liveEvent", "liveGuildAllow", "liveGuildCreate", "liveGuildDecline", "liveGuildDelete", "liveGuildJoin", "liveGuildLeave", "liveGuildRefresh", "liveGuildRemoveMember", "liveGuildRotate", "liveGuildState", "livePanel", "livePlan", "livePrivacy", "liveRegularNote", "liveRegulars"]);
    const preload = read("src/preload.cjs");
    for (const name of Object.keys(calls).filter((k) => k.startsWith("live"))) assert.match(preload, new RegExp(`invoke\\("${name}"`), `the window can reach ${name}`);
  } finally { service.stop(); }
});

test("wiring: the app opens no stream by itself in a development run, closes everything on quit, and Desk rides on the stream", () => {
  const main = read("src/main.cjs");
  assert.match(main, /new LiveClient\(\{ baseUrl: community\.baseUrl, getInstallId: \(\) => community\.settings\.installId, enabled: app\.isPackaged \|\| Boolean\(process\.env\.BF_COMMUNITY_URL\) \}\)/);
  assert.match(main, /liveClient\.on\("event", \(name, data\) => \{ if \(name === "ticket"\)/); assert.match(main, /liveClient\.on\("refetch", \(\) => \{ void desk\?\.sync\(\{ force: true \}\)/);
  assert.match(main, /guildPanel\?\.close\(\);\s+guildService\?\.stop\(\);\s+liveClient\?\.stop\(\);/);
  assert.match(main, /community\.onForgot = \(\) => \{ try \{ forgot\?\.\(\); \} finally \{ guildService\.wipe\(\); \} \};/);
  assert.match(main, /guildService\?\.reset\(\); groupStore\?\.clear\(\);/);
  assert.match(main, /if \(name\.startsWith\("live"\) && e\?\.name === "GuildError"\) throw new Error\(e\.message\);/);
  // Desk: the three-hour poll is still there; the stream only makes replies arrive sooner.
  const D = require("../src/core/desk.cjs");
  assert.equal(D.SYNC_EVERY, 3 * 60 * 60 * 1000);
  const desk = new D.DeskService({ community: { settings: { installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }, baseUrl: "https://bf.example.test" }, appVersion: "1.28.0" });
  const KEY = "k".repeat(43);
  desk.state.tickets = [{ ticket: "BF-1", key: KEY, summary: "x", status: "looking", fixedIn: null, kind: "bug", area: "other", lastId: 1, unread: 0, createdAt: null, updatedAt: null }, { ticket: "BF-2", key: KEY, summary: "y", status: "closed", fixedIn: null, kind: "bug", area: "other", lastId: 1, unread: 0, createdAt: null, updatedAt: null }];
  assert.deepEqual(desk.liveSubs(), [{ ticket: "BF-1", key: KEY }], "only reports that are not closed");
  const notified = []; desk.notify = (n) => notified.push(n); desk.state.notify = true;
  assert.deepEqual(desk.liveTicket({ ticket: "BF-1", status: "question", fixedIn: null, unread: 2, lastId: 3 }), { status: "updated", fresh: 2 });
  assert.equal(desk.unread(), 2); assert.equal(desk.tickets().tickets.find((t) => t.ticket === "BF-1").status, "question"); assert.deepEqual(notified, [2]);
  assert.deepEqual(desk.liveTicket({ ticket: "BF-9", status: "fixed", unread: 1 }), { status: "unknown" }, "a ticket this app does not hold is ignored");
  assert.deepEqual(desk.liveTicket({ ticket: "BF-1", status: "fixed", fixedIn: "1.28.0", unread: 2, lastId: 4 }), { status: "updated", fresh: 0 });
  assert.equal(desk.tickets().tickets.find((t) => t.ticket === "BF-1").fixedIn, "1.28.0");
  assert.doesNotMatch(JSON.stringify(desk.tickets()), new RegExp(KEY));
  const quiet = new D.DeskService({ community: { settings: {}, baseUrl: "https://bf.example.test" }, automatic: false });
  quiet.state.tickets = desk.state.tickets;
  assert.deepEqual(quiet.liveSubs(), [], "a development run asks for no stream");
});
