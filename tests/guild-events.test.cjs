"use strict";
// Plans → Guild and the lockout calendar on the desktop: the two optional capture blocks are
// checked field by field, the desktop keeps a longer memory in its own file, a run is matched to
// its event by place and time (across clock changes: everything is seconds since 1970), the
// calendar and its file carry guild events and lockouts, and the page says what it cannot know.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const G = require("../src/core/guild-events.cjs"), E = require("../src/core/economy.cjs");
const { registerGuildHandlers } = require("../src/core/guild-events-ipc.cjs");
const { registerEconomyHandlers } = require("../src/core/economy-ipc.cjs");
const T = 1795000000, HOUR = 3600, DAY = 86400;
const sign = (n, s, v = 1) => ({ n, s, v });
const event = (over = {}) => ({ id: "abc123", ver: 1, title: "Molten Core", dungeon: "mc", at: T + DAY, creator: "Anna", t: 2, h: 4, d: 14, note: "Bring fire resist",
  signups: [sign("Me", "t"), sign("Bob", "h", 2), sign("Cy", "m")], present: [], loot: [], ...over });
const past = (over = {}) => ({ id: "past01", title: "Blackrock Depths", dungeon: "brd", at: T - 3 * DAY, creator: "Anna", t: 1, h: 1, d: 3,
  signups: [{ n: "Me", s: "t" }, { n: "Bob", s: "h" }, { n: "Cy", s: "d" }, { n: "Dee", s: "n" }], present: ["Me", "Bob", "Eve"], loot: [{ i: 11684, w: "Bob", at: T - 3 * DAY + 3000 }], ...over });
const member = (over = {}) => ({ n: "Bob", at: T - 2 * HOUR, l: 60, z: "Winterspring", c: "PRIEST", p: [{ n: "Tailoring", r: 300 }, { n: "Enchanting", r: 285 }], crafts: ["Mooncloth", "Runecloth Bag"], ...over });
const block = (over = {}) => ({ v: 1, at: T, on: true, loot: false, me: "Me", guild: "Night Watch", realmOffset: 60, events: [event()], past: [past()], members: [member(), member({ n: "Cy", l: 42, z: undefined, c: undefined, p: [], crafts: [], lfd: "brd" })], ...over });
const clean = (o) => JSON.parse(JSON.stringify(o));
const lockouts = (over = {}) => ({ v: 1, at: T, rows: [{ n: "Molten Core", r: T + 3 * DAY, raid: true, d: "40 Player", p: 3, t: 10 }, { n: "Stratholme", r: T + 2 * HOUR }], ...over });

test("the guild block is checked field by field; anything off drops the whole block", () => {
  const g = G.normalizeGuildCapture(clean(block()));
  assert.equal(g.on, true); assert.equal(g.me, "Me"); assert.equal(g.guild, "Night Watch"); assert.equal(g.realmOffset, 60);
  assert.deepEqual(g.events[0].roles, { t: 2, h: 4, d: 14 }); assert.equal(g.events[0].ver, 1);
  assert.deepEqual(g.events[0].signups.map((s) => `${s.name}:${s.status}`), ["Bob:h", "Cy:m", "Me:t"], "sorted by name");
  assert.deepEqual(g.past[0].present, ["Bob", "Eve", "Me"]); assert.deepEqual(g.past[0].loot, [{ itemId: 11684, who: "Bob", at: T - 3 * DAY + 3000 }]);
  assert.deepEqual(g.members.map((m) => m.name), ["Bob", "Cy"]); assert.equal(g.members[0].classFile, "PRIEST"); assert.equal(g.members[1].lookingFor, "brd");
  assert.deepEqual(g.members[0].professions, [{ name: "Tailoring", skill: 300 }, { name: "Enchanting", skill: 285 }]);
  // An empty Lua table arrives as an object.
  const empty = G.normalizeGuildCapture({ v: 1, at: T, on: false, loot: false, events: {}, past: {}, members: {} });
  assert.deepEqual([empty.events, empty.past, empty.members], [[], [], []]);
  const bad = (change, why) => assert.throws(() => { const b = clean(block()); change(b); G.normalizeGuildCapture(b); }, /Invalid guild capture/, why);
  bad((b) => { b.v = 2; }); bad((b) => { b.extra = 1; }); bad((b) => { b.on = "yes"; }); bad((b) => { b.at = 5; }); bad((b) => { b.me = "M3"; }); bad((b) => { b.guild = "a|b"; }); bad((b) => { b.realmOffset = 61; }, "a quarter hour");
  bad((b) => { b.events[0].id = "ABC"; }); bad((b) => { b.events[0].ver = 0; }); bad((b) => { b.events[0].title = "x"; }); bad((b) => { b.events[0].title = "|cffff0000Red|r"; }, "no colour codes");
  bad((b) => { b.events[0].title = "join www.site.example"; }, "no links"); bad((b) => { b.events[0].note = "https://x.y"; }); bad((b) => { b.events[0].title = "two  spaces"; }); bad((b) => { b.events[0].title = "t".repeat(41); });
  bad((b) => { b.events[0].note = "n".repeat(81); }); bad((b) => { b.events[0].dungeon = "MC"; }); bad((b) => { b.events[0].t = 10; }); bad((b) => { b.events[0].d = 41; }); bad((b) => { b.events[0].creator = "An na"; });
  bad((b) => { b.events[0].signups.push(sign("me", "h")); }, "one answer per member"); bad((b) => { b.events[0].signups[0].s = "x"; }); bad((b) => { b.events[0].signups[0].v = 0; });
  bad((b) => { b.events[0].cancelled = false; }); bad((b) => { b.events[0].extra = 1; }); bad((b) => { b.events.push(clean(event())); }, "one event per id");
  bad((b) => { b.past[0].id = "abc123"; }, "an id is either on the list or history"); bad((b) => { b.past[0].ver = 1; }); bad((b) => { b.past[0].present.push("bob"); }); bad((b) => { b.past[0].loot[0].i = 0; });
  bad((b) => { b.past[0].loot[0].w = "B0b"; }); bad((b) => { b.members[0].l = 101; }); bad((b) => { b.members[0].c = "Priest"; }); bad((b) => { b.members[0].p.push({ n: "Tailoring", r: 1 }); });
  bad((b) => { b.members[0].p[0].r = 1000; }); bad((b) => { b.members.push(clean(member({ n: "BOB" }))); }, "one row per member"); bad((b) => { b.members[0].z = "a\nb"; });
  bad((b) => { b.events = Array.from({ length: 21 }, (_, i) => clean(event({ id: `event${String(i).padStart(2, "0")}` }))); }, "twenty events");
  bad((b) => { b.events[0].signups = Array.from({ length: 41 }, (_, i) => sign(`Member${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`, "d")); }, "forty sign-ups");
  assert.equal(G.linky("Dr. Weavil at 8"), false); assert.equal(G.linky("x.gg/abc"), true);
});

test("the lockout block: saved instances with a reset time, or a plain 'the game has no list'", () => {
  const l = G.normalizeLockoutCapture(clean(lockouts()));
  assert.equal(l.available, true);
  assert.deepEqual(l.rows, [{ name: "Stratholme", resetAt: T + 2 * HOUR, raid: false }, { name: "Molten Core", resetAt: T + 3 * DAY, raid: true, difficulty: "40 Player", total: 10, progress: 3 }], "soonest reset first");
  assert.deepEqual(G.normalizeLockoutCapture({ v: 1, at: T, na: true, rows: {} }), { at: T, available: false, rows: [] });
  const bad = (change) => assert.throws(() => { const b = clean(lockouts()); change(b); G.normalizeLockoutCapture(b); }, /Invalid guild capture/);
  bad((b) => { b.v = 0; }); bad((b) => { b.na = false; }); bad((b) => { b.na = true; }); bad((b) => { b.rows[0].n = ""; }); bad((b) => { b.rows[0].r = 5; }); bad((b) => { b.rows[0].p = 11; }); bad((b) => { b.rows[0].t = 0; });
  bad((b) => { b.rows[0].raid = false; }); bad((b) => { b.rows[0].x = 1; }); bad((b) => { b.rows = Array.from({ length: 41 }, (_, i) => ({ n: `I${i}`, r: T + i })); }); bad((b) => { delete b.rows[0].t; });
});

test("the saved file's optional blocks are read per character and never cost the character", () => {
  const { parseSavedVariables } = require("../src/core/game-sync.cjs");
  const character = (id, extra) => ({ id, name: id, realm: "Realm", className: "Mage", level: 60, updatedAt: T, captureVersion: "0.12.3", clientBuild: "1.60.1.70888", ...extra });
  const saved = (chars) => `BackstageForeverExport = ${JSON.stringify(JSON.stringify({ schema: 1, characters: chars, activeId: chars[0].id, observedAt: T }))}\n`;
  const real = Date.now;
  Date.now = () => (T + 60) * 1000;
  try {
    const s = parseSavedVariables(saved([character("Main", { guild: clean(block()), lockouts: clean(lockouts()) }), character("Alt", { lockouts: { v: 1, at: T, na: true, rows: {} } }),
      character("Odd", { guild: { v: 1, at: T, on: true, loot: false, events: [{ id: "x" }], past: [], members: [] }, lockouts: { v: 9 } }), character("Plain")]));
    assert.equal(s.characters.length, 4, "a damaged optional block is left out, the character stays");
    assert.equal(s.guild.length, 2);
    const [main, alt] = s.guild;
    assert.equal(main.name, "Main"); assert.equal(main.guild.events.length, 1); assert.equal(main.lockouts.rows.length, 2);
    assert.equal(alt.name, "Alt"); assert.equal(alt.guild, undefined); assert.equal(alt.lockouts.available, false);
    for (const c of s.characters) { assert.equal(c.guild, undefined, "the profile store is not touched"); assert.equal(c.lockouts, undefined); }
    assert.equal(parseSavedVariables(saved([character("Plain")])).guild, undefined);
  } finally { Date.now = real; }
});

test("the desktop keeps a longer memory: history the addon let go of stays, members follow the addon, the newest save wins", () => {
  const entry = (guild, lock) => ({ id: "main", name: "Mainchar", realm: "Realm", ...(guild ? { guild: G.normalizeGuildCapture(clean(guild)) } : {}), ...(lock ? { lockouts: G.normalizeLockoutCapture(clean(lock)) } : {}) });
  let data = G.absorb(null, [entry(block(), lockouts())]);
  assert.deepEqual(Object.keys(data.characters), ["main"]);
  assert.equal(data.characters.main.guild.events.length, 1); assert.equal(data.characters.main.guild.past.length, 1); assert.equal(data.characters.main.guild.members.length, 2);
  assert.deepEqual(G.absorb(data, [entry(block(), lockouts())]), data, "the same save twice changes nothing");
  // A later save: the addon dropped the old event from its thirty, a member stopped sharing, an event became history.
  const later = block({ at: T + 5 * DAY, events: [], past: [{ ...past({ id: "abc123", title: "Molten Core", dungeon: "mc", at: T + DAY, present: ["Me", "Bob"], loot: [] }) }], members: [member()] });
  data = G.absorb(data, [entry(later)]);
  const g = data.characters.main.guild;
  assert.deepEqual(g.past.map((e) => e.id), ["past01", "abc123"], "kept here although the addon forgot it");
  assert.deepEqual(g.members.map((m) => m.n), ["Bob"], "a member who stopped sharing is forgotten here too");
  assert.equal(g.events.length, 0); assert.ok(data.characters.main.lockouts, "an entry without lockouts keeps the last ones");
  // An older save arriving late (another account folder) does not roll anything back.
  assert.deepEqual(G.absorb(data, [entry(block(), lockouts({ at: T - DAY, rows: [] }))]), data);
  // Two hundred finished events a character.
  let big = null;
  for (let i = 0; i < 230; i++) big = G.absorb(big, [entry(block({ at: T + i, events: [], members: [], past: [past({ id: `p${String(i).padStart(5, "0")}`, at: T - 80 * DAY + i * 600 })] }))]);
  assert.equal(big.characters.main.guild.past.length, 200); assert.equal(big.characters.main.guild.past[199].id, "p00229");
  // A damaged or foreign file: entries are dropped one by one.
  const migrated = G.migrate({ characters: { main: clean(data.characters.main), __proto__: {}, junk: 5, odd: { name: "Odd", guild: { at: T, events: [{ id: "x" }], past: "no", members: [{ n: "B4d" }] }, lockouts: { v: 3 } } },
    notes: { "realm|bob": "  Brings  flasks\n", "": "x", nokey: "x", "realm|cy": 5, "realm|dee": "" }, extra: true });
  assert.deepEqual(Object.keys(migrated.characters).sort(), ["main", "odd"]);
  assert.deepEqual([migrated.characters.odd.guild.events, migrated.characters.odd.guild.past, migrated.characters.odd.guild.members, migrated.characters.odd.lockouts], [[], [], [], undefined]);
  assert.deepEqual(migrated.notes, { "realm|bob": "Brings flasks" });
  assert.deepEqual(G.migrate("x"), { version: 1, characters: {}, notes: {} }); assert.deepEqual(G.migrate(null).characters, {});
});

test("the store file: written only on change, notes are local plain text, a bad file starts empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-guild-")), file = path.join(dir, "guild.json");
  try {
    let writes = 0;
    const write = (f, text) => { writes++; fs.writeFileSync(f, text); };
    const store = new G.GuildStore({ file, write });
    const entries = [{ id: "main", name: "Mainchar", realm: "Realm", guild: G.normalizeGuildCapture(clean(block())) }];
    assert.equal(store.absorb(entries), true); assert.equal(store.absorb(entries), false); assert.equal(writes, 1);
    assert.equal(store.setNote("Realm", "Bob", "  Brings flasks,\tnever late  "), "Brings flasks, never late"); assert.equal(writes, 2);
    assert.equal(store.setNote("Realm", "Bob", "x".repeat(400)).length, 300);
    assert.throws(() => store.setNote("Realm", "B0b", "x")); assert.throws(() => store.setNote("Realm", "Bob", 5));
    const reopened = new G.GuildStore({ file, write });
    assert.equal(reopened.data.notes["realm|bob"].length, 300); assert.equal(reopened.data.characters.main.guild.events.length, 1);
    assert.equal(reopened.setNote("Realm", "Bob", "   "), ""); assert.deepEqual(reopened.data.notes, {}, "an empty note removes it");
    reopened.clear(); assert.deepEqual(new G.GuildStore({ file }).data.characters, {});
    fs.writeFileSync(file, "{ not json");
    assert.deepEqual(new G.GuildStore({ file }).data, { version: 1, characters: {}, notes: {} });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a run belongs to an event by place and time; each run and each event is used once; clock changes do not matter", () => {
  const instancesOf = (id) => ({ mc: [409], brd: [230], lbrs: [229], ubrs: [229] })[id] || [];
  const run = (instanceMap, startedAt, minutes = 60) => ({ id: `${instanceMap}:${startedAt}`, instanceMap, instanceType: "raid", timed: true, startedAt, endedAt: startedAt + minutes * 60, deaths: 0, loot: [], bosses: [] });
  const e = { id: "abc123", dungeon: "mc", at: T };
  assert.equal(G.matchRun(e, [run(409, T - 600)], instancesOf).startedAt, T - 600);
  assert.equal(G.matchRun(e, [run(230, T)], instancesOf), null, "another place");
  assert.equal(G.matchRun({ ...e, dungeon: "other" }, [run(409, T)], instancesOf), null, "an event without a listed place cannot be matched");
  assert.equal(G.matchRun(e, [run(409, T - 2 * HOUR, 89)], instancesOf), null, "it ended more than half an hour before the event");
  assert.ok(G.matchRun(e, [run(409, T - 2 * HOUR, 90)], instancesOf), "a run that was still going half an hour before counts");
  assert.ok(G.matchRun(e, [run(409, T + 4 * HOUR)], instancesOf)); assert.equal(G.matchRun(e, [run(409, T + 4 * HOUR + 1)], instancesOf), null, "more than four hours after it began");
  assert.equal(G.matchRun(e, [run(409, T + 3000), run(409, T - 900), run(409, T + 1200)], instancesOf).startedAt, T - 900, "the nearest start");
  assert.equal(G.matchRun(e, [{ instanceMap: 409 }, null, "x"], instancesOf), null); assert.equal(G.matchRun(e, null, instancesOf), null);
  // Lower and Upper Blackrock Spire are one instance in the game: either event can own the run, the nearer one does.
  const pairs = G.matchRuns([{ id: "lower1", dungeon: "lbrs", at: T }, { id: "upper1", dungeon: "ubrs", at: T + 2 * HOUR }], [run(229, T + 100), run(229, T + 2 * HOUR + 300)], instancesOf);
  assert.equal(pairs.get("lower1").startedAt, T + 100); assert.equal(pairs.get("upper1").startedAt, T + 2 * HOUR + 300);
  const one = G.matchRuns([{ id: "first1", dungeon: "mc", at: T }, { id: "second", dungeon: "mc", at: T + HOUR }], [run(409, T + 50 * 60)], instancesOf);
  assert.equal(one.size, 1); assert.ok(one.has("second"), "one run is never counted for two events");
  // Clock changes: an event and its run are both seconds since 1970, so a night with 23 or 25 hours changes nothing.
  for (const iso of ["2026-03-08T07:30:00Z", "2026-03-29T00:30:00Z", "2026-11-01T06:30:00Z", "2026-10-25T00:30:00Z"]) {
    const at = Date.parse(iso) / 1000;
    assert.equal(G.matchRun({ id: "dst001", dungeon: "mc", at }, [run(409, at + 4 * HOUR + 1), run(409, at - 1500, 20)], instancesOf).startedAt, at - 1500, iso);
    const ics = E.calendarIcs([{ key: "guild:dst001:" + at, kind: "event", at, title: "Molten Core", detail: "x", character: "Me", realm: "", minutes: 120 }], at - DAY);
    assert.match(ics, new RegExp(`DTSTART:${iso.replace(/[-:]/g, "").replace(".000", "")}`), "the calendar file is in UTC, so every calendar app shows the right local time");
    assert.match(ics, new RegExp(`DTEND:${new Date((at + 7200) * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`), "two hours, not a quarter");
  }
});

test("attendance: who said yes, who was in your group; unknown when this character was not there", () => {
  const g = G.normalizeGuildCapture(clean(block()));
  const a = G.attendance(g.past[0]);
  assert.equal(a.known, true); assert.equal(a.signedYes, 3); assert.equal(a.came, 3);
  assert.deepEqual(a.missed, ["Cy"], "said yes, not seen"); assert.deepEqual(a.unannounced, ["Eve"], "there without a yes");
  assert.deepEqual(a.rows.map((r) => `${r.name}:${r.answer}:${r.present}`), ["Bob:h:true", "Cy:d:false", "Dee:n:false", "Eve:null:true", "Me:t:true"]);
  const unknown = G.attendance({ ...g.past[0], present: [] });
  assert.equal(unknown.known, false); assert.equal(unknown.came, null); assert.equal(unknown.missed, null); assert.ok(unknown.rows.every((r) => r.present === null), "nobody is called absent on a guess");
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-guild-ipc-"));
  const store = new G.GuildStore({ file: path.join(dir, "guild.json") });
  const handlers = {}, privateOnly = new Set();
  const handle = (name, fn, options = {}) => { handlers[name] = fn; if (options.privateOnly) privateOnly.add(name); };
  const profiles = [{ id: "main", name: "Mainchar", realm: "Realm", faction: "Horde", readiness: { workshop: { recipes: { items: [{ name: "Ghost Dye" }, { name: "Ghost Dye" }, { name: "Runecloth Bag" }] } } } },
    { id: "alt", name: "Altina", realm: "Realm", faction: "Horde" }, { id: "far", name: "Faraway", realm: "Other", readiness: { workshop: { recipes: { items: [{ name: "Elsewhere" }] } } } }];
  const runs = { main: [{ id: "230:1", instanceMap: 230, instanceType: "party", name: "Blackrock Depths", timed: true, startedAt: T - 3 * DAY - 600, endedAt: T - 3 * DAY + 5400, deaths: 2, loot: [{ id: 11684, n: 1 }],
    bosses: [{ encounterId: 1, name: "Lord Roccor", at: T - 3 * DAY + 100 }, { encounterId: 2, name: "Bael'Gar", at: T - 3 * DAY + 900 }] }] };
  let blocks = [{ id: "main", name: "Mainchar", realm: "Realm", updatedAt: "x", guild: G.normalizeGuildCapture(clean(block())), lockouts: G.normalizeLockoutCapture(clean(lockouts())) },
    { id: "alt", name: "Altina", realm: "Realm", updatedAt: "x", guild: G.normalizeGuildCapture(clean(block({ me: "Altina", past: [], members: [], events: [event({ signups: [sign("Bob", "h", 2)] })] }))),
      lockouts: G.normalizeLockoutCapture({ v: 1, at: T - DAY, na: true, rows: [] }) }];
  const saved = [];
  let chosen = "C:/x/guild.ics", now = T;
  const guild = registerGuildHandlers({ handle, getState: () => ({ profiles, activeProfileId: "main" }), getGame: () => ({ guildCapture: () => blocks }), store, economy: { data: { runs } },
    gameData: { items: (ids) => ids.map((id) => (id === 11684 ? { name: "Ironfoe", quality: 4 } : null)) }, dialog: { showSaveDialog: async () => (chosen ? { canceled: false, filePath: chosen } : { canceled: true }) },
    getWindow: () => null, writeFile: async (file, text) => { saved.push([file, text]); }, now: () => now });
  return { dir, store, handlers, privateOnly, guild, profiles, saved, setBlocks: (b) => { blocks = b; }, setChosen: (c) => { chosen = c; }, setNow: (n) => { now = n; } };
}

test("the Guild page: events with sign-ups by role and your own answer, the roster, who can make what, past events with the run", async () => {
  const f = fixture();
  try {
    const v = await f.handlers.guildPage();
    assert.equal(v.profileId, "main"); assert.equal(v.guild, "Night Watch"); assert.equal(v.me, "Me"); assert.equal(v.on, true); assert.equal(v.realmOffset, 60);
    assert.deepEqual(v.characters.map((c) => c.name), ["Altina", "Mainchar"]);
    assert.deepEqual(v.totals, { members: 2, upcoming: 1, past: 1 });
    const e = v.upcoming[0];
    assert.equal(e.place, "Molten Core"); assert.equal(e.mine, "t"); assert.equal(e.mineWord, "tank");
    assert.deepEqual(e.signups, { t: ["Me"], h: ["Bob"], d: [], m: ["Cy"], n: [] }); assert.deepEqual(e.counts, { t: 1, h: 1, d: 0, m: 1, n: 0 });
    // Roster: what members shared, with how often they came to events this character was at.
    const bob = v.roster.find((m) => m.name === "Bob"), cy = v.roster.find((m) => m.name === "Cy");
    assert.equal(bob.classFile, "PRIEST"); assert.equal(bob.level, 60); assert.equal(bob.zone, "Winterspring"); assert.deepEqual(bob.attendance, { came: 1, events: 1, signedYes: 1 });
    assert.equal(cy.classFile, null); assert.equal(cy.zone, null); assert.equal(cy.lookingFor, "Blackrock Depths"); assert.deepEqual(cy.attendance, { came: 0, events: 1, signedYes: 1 });
    // Who can make what: shared professions, recipes from answers, and your own characters on this realm.
    const names = (q) => v.crafts.filter((c) => c.name.toLowerCase().includes(q)).map((c) => `${c.who}:${c.kind}${c.yours ? ":yours" : ""}`);
    assert.deepEqual(names("tailoring"), ["Bob:profession"]); assert.deepEqual(names("mooncloth"), ["Bob:recipe"]);
    assert.deepEqual(names("ghost dye"), ["Mainchar:recipe:yours"], "listed once"); assert.deepEqual(names("runecloth bag").sort(), ["Bob:recipe", "Mainchar:recipe:yours"]);
    assert.deepEqual(names("elsewhere"), [], "a character on another realm is not in this guild's list");
    // Past: attendance and the run that belonged to it, your own loot, and loot notes with names.
    const p = v.past[0];
    assert.equal(p.attendance.came, 3); assert.equal(p.canMatch, true);
    assert.equal(p.run.seconds, 6000); assert.equal(p.run.deaths, 2); assert.deepEqual(p.run.bosses.map((b) => b.name), ["Lord Roccor", "Bael'Gar"]); assert.equal(p.run.knownBosses, 9);
    assert.deepEqual(p.run.loot, [{ itemId: 11684, count: 1, name: "Ironfoe", quality: 4 }]);
    assert.deepEqual(p.guildLoot, [{ itemId: 11684, who: "Bob", at: T - 3 * DAY + 3000, name: "Ironfoe", quality: 4 }]);
    // Another character of yours: its own answer line, no run of its own.
    const alt = await f.handlers.guildPage("alt");
    assert.equal(alt.me, "Altina"); assert.equal(alt.upcoming[0].mine, null); assert.equal(alt.past.length, 0); assert.equal(alt.roster.length, 0);
    assert.equal((await f.handlers.guildPage("nobody")).profileId, "main", "an unknown character falls back to one with guild data");
    // An event still on the addon's list that began more than four hours ago is shown as past, not as ahead.
    f.setNow(T + DAY + 4 * HOUR + 1);
    const lateView = await f.handlers.guildPage();
    assert.equal(lateView.upcoming.length, 0); assert.deepEqual(lateView.past.map((x) => x.id), ["abc123", "past01"]);
    assert.equal(lateView.past[0].run, null); assert.equal(lateView.past[0].attendance.known, false);
    // Requests are checked.
    await assert.rejects(async () => f.handlers.guildPage(5), /Invalid guild request/); await assert.rejects(async () => f.handlers.guildPage("a", "b"), /Invalid guild request/);
    // Nothing saved at all: the page says so.
    const none = fixture();
    try { none.setBlocks([]); assert.deepEqual(await none.handlers.guildPage(), { profileId: null, characters: [], now: T, empty: true }); } finally { fs.rmSync(none.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("notes stay local and belong to a listed member; the calendar file holds the events ahead", async () => {
  const f = fixture();
  try {
    assert.ok(f.privateOnly.has("setGuildNote") && f.privateOnly.has("exportGuildEvents") && !f.privateOnly.has("guildPage"));
    assert.deepEqual(await f.handlers.setGuildNote("main", "Bob", " Brings flasks "), { name: "Bob", note: "Brings flasks" });
    assert.equal((await f.handlers.guildPage()).roster.find((m) => m.name === "Bob").note, "Brings flasks");
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, "guild.json"), "utf8")).notes["realm|bob"], "Brings flasks");
    await assert.rejects(async () => f.handlers.setGuildNote("main", "Stranger", "x"), /Invalid guild request/, "only a member on the page");
    await assert.rejects(async () => f.handlers.setGuildNote("main", "Bob"), /Invalid guild request/); await assert.rejects(async () => f.handlers.setGuildNote("main", "Bob", "x".repeat(2001)), /Invalid guild request/);
    assert.deepEqual(await f.handlers.setGuildNote("main", "Bob", ""), { name: "Bob", note: "" });
    // The calendar file.
    assert.deepEqual(await f.handlers.exportGuildEvents(), { saved: true, events: 1 });
    const [file, ics] = f.saved[0];
    assert.equal(file, "C:/x/guild.ics"); assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, "the same event seen by two of your characters is one entry");
    assert.match(ics, /SUMMARY:Molten Core - Mainchar/); assert.match(ics.replace(/\r\n /g, ""), /tanks 1\/2\\, healers 1\/4\\, damage 0\/14 · you: tank/);
    for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
    f.setChosen(null); assert.deepEqual(await f.handlers.exportGuildEvents(), { saved: false, reason: "cancelled" });
    f.setNow(T + 2 * DAY); assert.deepEqual(await f.handlers.exportGuildEvents(), { saved: false, reason: "empty" });
    await assert.rejects(async () => f.handlers.exportGuildEvents(1), /Invalid guild request/);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("the Calendar shows guild events and every character's lockouts next to cooldowns and mail", async () => {
  const f = fixture();
  try {
    const entries = f.guild.calendarEntries();
    assert.deepEqual(entries.map((e) => `${e.kind}:${e.title}:${e.character}`), ["event:Blackrock Depths:Mainchar", "lockout:Stratholme resets:Mainchar", "event:Molten Core:Mainchar", "lockout:Molten Core resets:Mainchar"]);
    const lock = entries[3];
    assert.equal(lock.at, T + 3 * DAY); assert.equal(lock.detail, "Raid lockout (40 Player) · 3 of 10 bosses down"); assert.equal(entries[1].detail, "Dungeon lockout");
    assert.equal(entries[2].mine, "t", "of two characters that saw the event, the one that answered is named"); assert.equal(entries[0].past, true);
    assert.deepEqual(f.guild.lockouts().map((c) => `${c.character}:${c.available}:${c.rows.length}`), ["Altina:false:0", "Mainchar:true:2"], "a character whose game has no list says so instead of looking free");
    f.setNow(T + 2 * HOUR); assert.equal(f.guild.lockouts()[1].rows.length, 1, "a lockout that has reset is left out");
    assert.ok(!f.guild.calendarEntries().some((e) => e.title === "Stratholme resets")); f.setNow(T);
    // Through the calendar request, with a cooldown of the ledger.
    const handlers = {};
    const economy = { data: { calendar: { notify: true, notified: [] } }, setNotify() {}, markNotified(keys) { this.data.calendar.notified.push(...keys); } };
    const notices = [];
    const pages = registerEconomyHandlers({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => ({ profiles: [{ id: "main", name: "Mainchar", ledger: { cooldowns: [{ key: "transmute", readyAt: T + HOUR }] } }] }),
      economy, gameData: { items: () => [] }, dialog: {}, getWindow: () => null, notify: (title, body) => notices.push([title, body]), guild: f.guild, now: () => T });
    const view = handlers.economyCalendar();
    assert.deepEqual(view.events.map((e) => e.kind), ["event", "cooldown", "lockout", "event", "lockout"], "one list, by time");
    assert.equal(view.lockouts.length, 2);
    // Notifications: nothing for lockouts or far-off events; one for a guild event in its last quarter of an hour.
    assert.equal(pages.tick(), 0);
    const soon = E.dueNotifications([{ key: "guild:a:1", kind: "event", at: T + 600, title: "Molten Core", detail: "Molten Core · tanks 1/2", character: "Me" }, { key: "guild:b:1", kind: "event", at: T + 901, title: "Later", detail: "x", character: "Me" },
      { key: "guild:c:1", kind: "event", at: T - 5, title: "Began", detail: "x", character: "Me" }, { key: "x:lock:1", kind: "lockout", at: T + 300, title: "Molten Core resets", detail: "Raid lockout", character: "Me" }], [], T);
    assert.deepEqual(soon, [{ key: "guild:a:1", title: "Guild event soon: Molten Core", body: "Starts in 10 minutes. Molten Core · tanks 1/2." }]);
    assert.deepEqual(E.dueNotifications([{ key: "guild:a:1", kind: "event", at: T + 600, title: "Molten Core", detail: "x", character: "Me" }], ["guild:a:1"], T), [], "once");
    // A calendar without the guild part still works.
    const plain = {};
    registerEconomyHandlers({ handle: (name, fn) => { plain[name] = fn; }, getState: () => ({ profiles: [] }), economy, gameData: { items: () => [] }, dialog: {}, getWindow: () => null, now: () => T });
    assert.deepEqual([plain.economyCalendar().events, plain.economyCalendar().lockouts], [[], []]);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("the page renders without inline styles, keeps player text out of the translator and says what it cannot know", async () => {
  const f = fixture();
  try {
    const data = await f.handlers.guildPage();
    data.upcoming[0].title = "<b>Molten</b> Core"; data.roster[0].note = 'a "quoted" note';
    let html = "";
    const root = { dataset: {}, querySelectorAll: () => [], querySelector: () => null, set outerHTML(v) { html = v; } };
    const context = vm.createContext({ backstage: { guildPage: async () => structuredClone(data) }, structuredClone, document: { querySelector: (s) => (s === "[data-guild-page]" ? root : null), activeElement: null } });
    context.window = context;
    for (const file of ["page-hero.js", "guild.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", file), "utf8"), context);
    const V = context.GuildView;
    assert.match(V.page(), /Your guild page is loading/);
    V.mounted(); await new Promise((r) => setTimeout(r, 10));
    assert.match(html, /data-guild-honest/); assert.match(html, /It lists only guild members who run Backstage Forever and chose to share/); assert.match(html, /Nothing is sent to any server/);
    assert.match(html, /&lt;b&gt;Molten&lt;\/b&gt; Core/); assert.doesNotMatch(html, /<b>Molten/); assert.match(html, /a &quot;quoted&quot; note/);
    assert.match(html, /You signed up as tank\./); assert.match(html, /your computer's time/); assert.match(html, /realm time/);
    assert.match(html, /data-guild-member="Bob"/); assert.match(html, /Priest/); assert.match(html, /Class not known/); assert.match(html, /Looking for/);
    assert.match(html, /Said yes but not seen:/); assert.match(html, /In your group without a yes:/); assert.match(html, /Ironfoe/); assert.match(html, /Lord Roccor, Bael&#39;Gar/);
    assert.match(html, /Type at least two letters/); assert.match(html, /Save events as a calendar file/);
    assert.doesNotMatch(html, /\sstyle=/, "the page's CSP forbids inline styles");
    // Every name a player typed sits inside a part the translator leaves alone.
    for (const name of ["Night Watch", "Winterspring", "Tailoring", "Blackrock Depths"]) assert.match(html, new RegExp(`data-no-translate[^>]*>${name}`), name);
    // The empty states.
    const emptyContext = vm.createContext({ backstage: { guildPage: async () => ({ profileId: null, characters: [], now: T, empty: true }) }, structuredClone, document: { querySelector: (s) => (s === "[data-guild-page]" ? root : null), activeElement: null } });
    emptyContext.window = emptyContext;
    for (const file of ["page-hero.js", "guild.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", file), "utf8"), emptyContext);
    emptyContext.GuildView.page(); emptyContext.GuildView.mounted(); await new Promise((r) => setTimeout(r, 10));
    assert.match(html, /No character has guild data in the saved file yet/); assert.match(html, /both off until you switch them on/); assert.match(html, /data-guild-honest/);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("wiring: a tab in Plans, the page and its style loaded, the app's requests, nothing that reaches a network", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const nav = read("src/renderer/player-navigation.js");
  assert.match(nav, /\["company", "My plans"\],\s*\["party", "Party"\],\s*\["guild", "Guild"\],\s*\["calendar", "Calendar"\],/);
  assert.match(read("scripts/player-navigation.cjs"), /guild: \["Plans", "Guild"\]/); assert.match(read("scripts/player-shell-smoke.cjs"), /\["party", "calendar", "guild"\]\.includes\(id\)/);
  assert.match(read("src/renderer/app.js"), /guild: GuildView\.page/); assert.match(read("src/renderer/app.js"), /GuildView\.mounted\(\);/);
  const html = read("src/renderer/index.html");
  assert.match(html, /href="guild\.css"/); assert.ok(html.indexOf('<script src="guild.js">') > html.indexOf('<script src="page-hero.js">') && html.indexOf('<script src="guild.js">') < html.indexOf('<script src="app.js">'));
  const preload = read("src/preload.cjs");
  for (const name of ["guildPage", "setGuildNote", "exportGuildEvents"]) assert.match(preload, new RegExp(`${name}: \\(`));
  const main = read("src/main.cjs");
  assert.match(main, /guildStore = new \(require\("\.\/core\/guild-events\.cjs"\)\.GuildStore\)\(\{ file: path\.join\(app\.getPath\("userData"\), "guild\.json"\) \}\)/);
  assert.match(main, /guild: guildPages/); assert.match(main, /guildStore\?\.clear\(\)/, "Delete all local data takes the guild file too");
  for (const file of ["src/core/guild-events.cjs", "src/core/guild-events-ipc.cjs", "src/renderer/guild.js"]) {
    const source = read(file);
    for (const banned of ["fetch(", "http", "net.", "XMLHttpRequest", "WebSocket", "shell.openExternal"]) assert.ok(!source.includes(banned), `${file}: ${banned}`);
  }
});
