"use strict";
// Backstage Live, game side on the desktop: the live-link signals for guild link, events, sign-ups,
// party state and the board listing; the feed the rest of the app listens to; the saved-file
// fallback; and the three hand-off fields the game reads at login or /reload.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const bridge = require("../src/core/live-bridge.cjs");
const feedModule = require("../src/core/game-guild-feed.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const { parseSignal, normalizeLiveCapture, normalizeHandoff } = feedModule;
const FIXTURES = JSON.parse(read("tests/fixtures/live-signals.json")).signals;
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const ABEL = { name: "Abel", realm: "Thunder Hold" };
const collect = (feed) => { const got = []; for (const type of ["link", "unlink", "event", "signup", "party", "listing"]) feed.on(type, (p) => got.push([type, p])); return got; };

test("the module is the feed itself: an EventEmitter with setHandoff, as the contract names it", () => {
  assert.equal(typeof feedModule.on, "function"); assert.equal(typeof feedModule.emit, "function");
  assert.equal(typeof feedModule.setHandoff, "function"); assert.equal(typeof feedModule.handoff, "function");
  assert.ok(feedModule.create() instanceof feedModule.GameGuildFeed && feedModule.create() !== feedModule, "tests get a feed of their own");
});

test("every recorded signal decodes to exactly the recorded payloads, each carrying the character", () => {
  assert.equal(FIXTURES.length, 11);
  assert.deepEqual([...new Set(FIXTURES.map((f) => f.type))].sort(), ["event", "link", "listing", "party", "signup", "unlink"]);
  for (const f of FIXTURES) {
    const parsed = parseSignal(f.text);
    assert.equal(parsed.type, f.type, f.text);
    assert.deepEqual(parsed.payloads || [parsed.payload], f.payloads, f.text);
    for (const p of f.payloads) assert.deepEqual(p.character, ABEL);
    assert.ok(Buffer.byteLength(f.text) <= feedModule.MAX_SIGNAL_BYTES);
  }
  // The shapes the contract names.
  const [link, , event, , signup, , party, , listing, , gone] = FIXTURES.map((f) => f.payloads[0]);
  assert.deepEqual(Object.keys(link).sort(), ["character", "code", "faction", "guildName", "rankIndex", "realm"]);
  assert.deepEqual(Object.keys(event).sort(), ["at", "cancelled", "character", "creator", "editor", "id", "note", "place", "roles", "title", "version"]);
  assert.deepEqual(event.roles, { tank: 2, healer: 8, damage: 30 }); assert.equal(event.at, "2026-11-27T19:00:00Z");
  assert.deepEqual(signup.signup, { who: ABEL, answer: "healer", version: 2, via: "game" });
  assert.deepEqual(Object.keys(party.members[0]).sort(), ["class", "level", "name", "online", "ready", "realm", "role"]);
  assert.deepEqual(party.plan.members, [{ name: "Abel", realm: "Thunder Hold", role: "healer" }, { name: "Bob", realm: "Thunder Hold", role: "tank" }]);
  assert.deepEqual(Object.keys(listing).sort(), ["character", "class", "id", "kind", "level", "need", "note", "place", "roles", "who"]);
  assert.deepEqual(gone, { gone: true, id: "abcdefgh12345678", character: ABEL });
});

test("the addon writes exactly the recorded signals (the fixtures are not hand-made)", () => {
  const out = lua(String.raw`DEFAULT_CHAT_FRAME={AddMessage=function() end}
for _,f in ipairs({'Events','LiveGuild'}) do dofile('addon/BackstageForever/BackstageForever'..f..'.lua') end
local me=BackstageForeverSignalMe('Abel','Thunder Hold')
print(BackstageForeverSignalLink(me,1,'H','BFG-7K2M-Q9XD','Night Watch'))
print(BackstageForeverSignalUnlink(me,'H','Night Watch'))
print(BackstageForeverSignalEvent(me,{id='abc123',ver=3,creator='Anna',editor='Bob',at=1795806000,dungeon='mc',roles={t=2,h=8,d=30},title='Molten Core',note='Bring fire resist'}))
print(BackstageForeverSignalEvent(me,{id='zz9zz9',ver=1,creator='Abel',at=1795900000,dungeon='other',roles={t=1,h=1,d=3},title='Caf\195\169 night',cancelled=true}))
print(BackstageForeverSignalSignups(me,'abc123',{{n='Abel',s='h',v=2}}))
print(BackstageForeverSignalSignups(me,'abc123',{{n='Bob',s='t',v=1},{n='Cy-Stormrage',s='m',v=4},{n='Dee',s='n',v=2}}))
print(BackstageForeverSignalParty(me,{leader='Abel',place='sm',planAt=1795000000,members={{name='Abel',class=5,role='h',level=34,online=true,ready=true},{name='Bob',class=1,role='t',level=36,online=true},{name='Cy-Stormrage',class=3,level=35,online=false},{name='Dee'}}}))
print(BackstageForeverSignalParty(me,{members={}}))
print(BackstageForeverSignalListing(me,{id='abcdefgh12345678',kind='g',level=34,class=3,roles='hd',place='sm',note='have the key'}))
print(BackstageForeverSignalListing(me,{id='abcdefgh12345678',kind='m',level=60,class=0,roles='',place='brd',need={t=1,h=0,d=2}}))
print(BackstageForeverSignalListing(me,{id='abcdefgh12345678',gone=true}))`);
  assert.deepEqual(out.split(/\r?\n/), FIXTURES.map((f) => f.text));
});

test("hostile signals are dropped whole: wrong counts, codes, names, numbers, lengths and control characters", () => {
  const good = FIXTURES.map((f) => f.text);
  const bad = [
    "", "L1", "Q1|Abel-Thunder Hold|x", "L1|Abel|1|H|BFG-7K2M-Q9XD|Night Watch", "L1|A-Thunder Hold|1|H|BFG-7K2M-Q9XD|Night Watch",
    "L1|Abel-Thunder Hold|10|H|BFG-7K2M-Q9XD|Night Watch", "L1|Abel-Thunder Hold|01|H|BFG-7K2M-Q9XD|Night Watch", "L1|Abel-Thunder Hold|1|N|BFG-7K2M-Q9XD|Night Watch",
    "L1|Abel-Thunder Hold|1|H|bfg-7k2m-q9xd|Night Watch", "L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9X|Night Watch", "L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9XD|N", "L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9XD|" + "N".repeat(25),
    "L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9XD|Night Watch|extra", "L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9XD|Night\u0007Watch", "L1|Ab3l-Thunder Hold|1|H|BFG-7K2M-Q9XD|Night Watch",
    "E1|Abel-Thunder Hold|ABC123|3|Anna|-|1795806000|mc|2.8.30|-|Molten Core|-", "E1|Abel-Thunder Hold|abc123|0|Anna|-|1795806000|mc|2.8.30|-|Molten Core|-", "E1|Abel-Thunder Hold|abc123|10000|Anna|-|1795806000|mc|2.8.30|-|Molten Core|-",
    "E1|Abel-Thunder Hold|abc123|3|Anna|-|17958060000|mc|2.8.30|-|Molten Core|-", "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|MC|2.8.30|-|Molten Core|-", "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|mc|2.8.41|-|Molten Core|-",
    "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|mc|2.8.30|y|Molten Core|-", "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|mc|2.8.30|-|M|-", "E1|Abel-Thunder Hold|abc123|3|An na|-|1795806000|mc|2.8.30|-|Molten Core|-",
    "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|mc|2.8.30|-|" + "T".repeat(41) + "|-", "E1|Abel-Thunder Hold|abc123|3|Anna|-|1795806000|mc|2.8.30|-|Molten Core|" + "n".repeat(81),
    "U1|Abel-Thunder Hold|abc123|", "U1|Abel-Thunder Hold|abc123|Bob:x:1", "U1|Abel-Thunder Hold|abc123|Bob:t:0", "U1|Abel-Thunder Hold|abc123|Bob:t:1,bob:h:2", "U1|Abel-Thunder Hold|abc123|" + Array.from({ length: 13 }, (_, i) => "N" + "abcdefghijklm"[i] + "x:t:1").join(","),
    "P1|Abel-Thunder Hold|Abel|sm|1795000000|Abel:5:h:34:1|1", "P1|Abel-Thunder Hold|Abel|sm|1795000000|Abel:5:x:34:1:1|1", "P1|Abel-Thunder Hold|Abel|sm|1795000000|Abel:5:h:101:1:1|1", "P1|Abel-Thunder Hold|Abel|sm|1795000000|Abel:5:h:34:1:1;Abel:1:t:30:1:0|2",
    "P1|Abel-Thunder Hold|Abel|sm|1795000000|Abel:5:h:34:1:1;Bob:1:t:30:1:0|1", "P1|Abel-Thunder Hold|Abel|SM|0|-|0", "P1|Abel-Thunder Hold|Abel|sm|x|-|0", "P1|Abel-Thunder Hold|Abel|sm|0|-|41",
    "F1|Abel-Thunder Hold|abcdefgh1234567|x", "F1|Abel-Thunder Hold|abcdefgh12345678|g|0|3|hd|sm|-|-", "F1|Abel-Thunder Hold|abcdefgh12345678|q|34|3|hd|sm|-|-", "F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3|dh|sm|-|-",
    "F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3||sm|-|-", "F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3|hd|sm|1.0|-", "F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3|hd|sm|-|" + "n".repeat(61),
    "F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3|hd|sm|-|see |cffff0000red|r", good[0] + "\n", good[2].replace("Molten Core", "Molten\tCore"), "L1|" + "A".repeat(700),
  ];
  for (const text of bad) assert.throws(() => parseSignal(text), /Invalid live signal/, JSON.stringify(text));
  for (const text of [null, undefined, 5, {}, []]) assert.throws(() => parseSignal(text));
  const feed = feedModule.create(), got = collect(feed);
  for (const text of bad) assert.equal(feed.signal(text), 0);
  assert.equal(got.length, 0); assert.equal(feed.stats.refused, bad.length);
});

test("the feed emits each signal once: a repeat is silent, a change is told, and each event carries the character", () => {
  let now = Date.parse("2026-11-24T10:00:00Z");
  const feed = feedModule.create({ now: () => now }), got = collect(feed);
  for (const f of FIXTURES) feed.signal(f.text);
  // link, unlink, two events, 1 + 3 sign-ups, two party states, two listings and its removal.
  assert.deepEqual(got.map((g) => g[0]), ["link", "unlink", "event", "event", "signup", "signup", "signup", "signup", "party", "party", "listing", "listing", "listing"]);
  for (const [, p] of got) assert.deepEqual(p.character, ABEL);
  assert.equal(got[10][1].at, "2026-11-24T10:00:00Z", "a listing carries the time the app learned of it (P1.at)");
  assert.equal(got[12][1].gone, true);
  const before = got.length;
  for (const f of FIXTURES.slice(2, 6)) assert.equal(feed.signal(f.text), 0, "the same fact again: " + f.text);
  assert.equal(got.length, before);
  // A newer version of the same event is news; so is another answer by the same member.
  assert.equal(feed.signal(FIXTURES[2].text.replace("|3|Anna", "|4|Anna")), 1);
  assert.equal(feed.signal("U1|Abel-Thunder Hold|abc123|Abel:t:3"), 1);
  assert.equal(got.at(-1)[1].signup.answer, "tank");
  // Another character's same event is that character's own news.
  assert.equal(feed.signal(FIXTURES[2].text.replace("Abel-Thunder Hold", "Zed-Thunder Hold")), 1);
  assert.deepEqual(got.at(-1)[1].character, { name: "Zed", realm: "Thunder Hold" });
  // A listener that throws never stops the others (EventEmitter would): signals stay counted.
  assert.ok(feed.stats.signals >= FIXTURES.length);
});

test("signal pages: the addon's bytes match the app's mirror, the bridge hands them to subscribeSignals only, and an older app drops them", () => {
  const text = FIXTURES[6].text, identity = 4242;
  const out = lua(String.raw`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local pages=BackstageForeverLiveSignalPages(77,${JSON.stringify(text)},4242)
local rows={} for _,p in ipairs(pages) do rows[#rows+1]=table.concat(p,',') end print(table.concat(rows,';'))
assert(#BackstageForeverLiveSignalPages(1,'',1)==0 and #BackstageForeverLiveSignalPages(1,'a\nb',1)==0 and #BackstageForeverLiveSignalPages(1,string.rep('x',595),1)==0)
assert(#BackstageForeverLiveSignalPages(1,string.rep('x',594),1)==36,'600 bytes with the six in front is the most that fits')`);
  const pages = bridge.encodeSignalPages(77, text, identity);
  assert.deepEqual(out.split(";").map((r) => r.split(",").map(Number)), pages);
  assert.ok(pages.length === Math.ceil((Buffer.byteLength(text) + 6) / 17));
  // Through a bridge: collected like a question, delivered as a signal, never as a question.
  const live = new bridge.LiveBridge({ platform: "linux", now: () => 1000 });
  live.frame = { characterHash: identity };
  const signals = [], questions = [];
  live.subscribeSignals((s) => signals.push(s)); live.subscribeQuestions((q) => questions.push(q));
  for (const p of pages) live.questionPage(bridge.parseQuestionPage(p));
  for (const p of pages) live.questionPage(bridge.parseQuestionPage(p)); // the second pass
  assert.equal(questions.length, 0);
  assert.deepEqual(signals, [{ id: 77, kind: "signal", text, characterHash: identity, at: 1000 }]);
  // Another character's pages are not this frame's.
  live.frame = { characterHash: 1 };
  for (const p of bridge.encodeSignalPages(78, text, identity)) live.questionPage(bridge.parseQuestionPage(p));
  assert.equal(signals.length, 1);
  // The feed attached to a bridge emits from those pages.
  const feed = feedModule.create(), got = collect(feed);
  const live2 = new bridge.LiveBridge({ platform: "linux", now: () => 1000 }); live2.frame = { characterHash: identity };
  const detach = feed.attach(live2);
  for (const f of FIXTURES) for (const p of bridge.encodeSignalPages(1 + FIXTURES.indexOf(f), f.text, identity)) live2.questionPage(bridge.parseQuestionPage(p));
  assert.equal(got.length, 13);
  detach();
  for (const p of bridge.encodeSignalPages(99, "U1|Abel-Thunder Hold|abc123|Abel:n:9", identity)) live2.questionPage(bridge.parseQuestionPage(p));
  assert.equal(got.length, 13, "detached");
  // What an app from before Backstage Live did with bytes 1, 255 and anything but "fill:": nothing.
  const all = [1, 255, ...Buffer.from("sig:" + text)], parts = new Map();
  for (let i = 0; i * 17 < all.length; i++) parts.set(i, all.slice(i * 17, i * 17 + 17));
  const oldAssemble = (bytes) => { if (bytes[0] === 1 && bytes[1] === 255) { const rest = Buffer.from(bytes.slice(2)).toString("utf8"); return rest.startsWith("fill:") ? "prefill" : null; } return "question"; };
  assert.equal(oldAssemble(all), null);
  assert.equal(bridge.assembleQuestion(parts, parts.size, bridge.crc8(all, all.length)), bridge.GAME_SIGNAL + text);
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(all)), "and an app older still fails on byte 255 and drops it too");
});

test("saved-file fallback: the live block and the guild block emit what the live link did not tell, once", () => {
  const block = { v: 1, at: 1795000000, me: "Abel-Thunder Hold", faction: "H", link: { code: "BFG-7K2M-Q9XD", guild: "Night Watch", rank: 1 }, mine: [{ id: "abc123", s: "h", v: 2 }], party: FIXTURES[6].text, listing: FIXTURES[8].text };
  const live = [{ id: "x", name: "Abel", realm: "Thunder Hold", live: normalizeLiveCapture(block) }];
  const guild = [{ id: "x", name: "Abel", realm: "Thunder Hold", guild: { on: true, events: [{ id: "abc123", ver: 3, title: "Molten Core", dungeon: "mc", at: 1795806000, creator: "Anna", editor: "Bob", roles: { t: 2, h: 8, d: 30 }, note: "Bring fire resist", signups: [{ name: "Abel", status: "h" }] }] } },
    { id: "y", name: "Off", realm: "Thunder Hold", guild: { on: false, events: [{ id: "zzz999", ver: 1, title: "Hidden", dungeon: "mc", at: 1795806000, creator: "Off", roles: { t: 1, h: 1, d: 1 }, signups: [] }] } }];
  // With the live link off, everything comes from the file.
  const cold = feedModule.create(), coldGot = collect(cold);
  assert.equal(cold.ingestSaved(live, guild), 5);
  assert.deepEqual(coldGot.map((g) => g[0]), ["link", "signup", "party", "listing", "event"]);
  assert.deepEqual(coldGot[0][1], FIXTURES[0].payloads[0]);
  assert.deepEqual(coldGot[1][1], FIXTURES[4].payloads[0]);
  assert.deepEqual(coldGot[2][1], FIXTURES[6].payloads[0]);
  assert.deepEqual(coldGot[4][1], FIXTURES[2].payloads[0], "the saved event is the same E1 the signal gave");
  assert.equal(cold.ingestSaved(live, guild), 0, "the next read of the same file is silent");
  // With the live link on, the file adds nothing.
  const warm = feedModule.create(), warmGot = collect(warm);
  for (const i of [0, 2, 4, 6, 8]) warm.signal(FIXTURES[i].text);
  assert.equal(warm.ingestSaved(live, guild), 0);
  assert.equal(warmGot.length, 5);
  // A guild block of a character with guild events off tells nothing.
  assert.ok(!coldGot.some((g) => g[1].id === "zzz999"));
  // Damaged blocks are refused whole, and a damaged row never stops the rest.
  for (const badBlock of [null, [], { v: 2, at: 1795000000, me: "Abel-Thunder Hold" }, { ...block, extra: 1 }, { ...block, me: "Abel" }, { ...block, link: { code: "nope", guild: "Night Watch", rank: 1 } }, { ...block, party: FIXTURES[8].text },
    { ...block, listing: "F1|x" }, { ...block, mine: [{ id: "abc123", s: "q", v: 1 }] }, { ...block, at: 5 }, { ...block, unlinked: "yes" }, { ...block, faction: "N" }]) assert.throws(() => normalizeLiveCapture(badBlock), JSON.stringify(badBlock));
  assert.deepEqual(normalizeLiveCapture({ v: 1, at: 1795000000, me: "Abel-Thunder Hold", mine: {} }).mine, [], "Lua writes an empty list as {}");
  assert.equal(feedModule.create().ingestSaved([{ live: null }, { live: { me: ABEL, party: "garbage" } }, ...live], [{ name: "x", realm: "", guild: { on: true, events: [{}] } }, ...guild]), 5);
});

test("game-sync reads the live block beside the characters, drops a damaged one and tells its listener", async (t) => {
  const { GameSync } = require("../src/core/game-sync.cjs");
  const fsp = require("node:fs/promises"), os = require("node:os");
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "bf-live-")));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const game = path.join(dir, "client"), sv = path.join(game, "WTF/Account/Synthetic/SavedVariables");
  await fsp.mkdir(sv, { recursive: true });
  await fsp.writeFile(path.join(game, ".flavor.info"), "wowf"); await fsp.writeFile(path.join(game, ".build.info"), "Version!STRING:0\n1.60.1.70888");
  const now = Math.floor(Date.now() / 1000);
  const character = (id, name, live) => ({ id, name, realm: "Thunder Hold", className: "Hunter", level: 34, updatedAt: now, faction: "Horde", ...(live ? { live } : {}) });
  const good = { v: 1, at: now, me: "Abel-Thunder Hold", faction: "H", link: { code: "BFG-7K2M-Q9XD", guild: "Night Watch", rank: 1 }, mine: [{ id: "abc123", s: "h", v: 2 }], party: FIXTURES[6].text };
  const snapshot = { schema: 1, activeId: "Player-1-0001", observedAt: now, characters: [character("Player-1-0001", "Abel", good), character("Player-1-0002", "Bea", { v: 1, at: now, me: "Bea", bogus: true }), character("Player-1-0003", "Cy")] };
  await fsp.writeFile(path.join(sv, "BackstageForever.lua"), "BackstageForeverExport = " + JSON.stringify(JSON.stringify(snapshot)) + "\n");
  const sync = new GameSync({ dataDir: path.join(dir, "data"), addonDir: path.resolve("addon/BackstageForever") });
  t.after(() => sync.close());
  const told = [];
  sync.onLiveBlocks = (live, guild) => told.push([live, guild]);
  await sync.prepare(game);
  await sync.refresh();
  const live = sync.liveCapture();
  assert.equal(live.length, 1, "the damaged block is left out, the character stays");
  assert.deepEqual(live[0].live.link, { code: "BFG-7K2M-Q9XD", guildName: "Night Watch", rankIndex: 1 });
  assert.equal(live[0].name, "Abel");
  assert.ok(told.length >= 1 && told.at(-1)[0].length === 1 && Array.isArray(told.at(-1)[1]));
  const feed = feedModule.create(), got = collect(feed);
  assert.equal(feed.ingestSaved(...told.at(-1)), 3);
  assert.deepEqual(got.map((g) => g[0]), ["link", "signup", "party"]);
});

// ---------------------------------------------------------------- the hand-off (desktop -> game)
const saved = (id, name, realm) => ({ id, name, realm, source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });
const E1 = (over = {}) => ({ id: "abc123", version: 3, creator: { name: "Anna", realm: "Thunder Hold" }, editor: { name: "Anna", realm: "Thunder Hold" }, at: "2026-11-27T19:00:00Z", place: "mc", title: "Molten Core", note: 'Bring "fire" resist', roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false, ...over });
const E2 = (name, answer, version, via) => ({ who: { name, realm: "Thunder Hold" }, answer, version, via });
const P1 = (over = {}) => ({ id: "abcdefgh12345678", kind: "lfg", who: { name: "Cy", realm: "Thunder Hold" }, level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "", need: null, at: "2026-11-24T10:00:00Z", ...over });

test("with nothing to hand over the file is byte for byte what it was, and setHandoff keeps, replaces and clears each part", () => {
  const profiles = [saved("a", "Abel", "Thunder Hold")], wishlist = () => [5202];
  const plainFile = handoff.compile({ profiles, wishlist });
  const feed = feedModule.create();
  assert.equal(handoff.compile({ profiles, wishlist, live: feed.handoff() }), plainFile);
  assert.equal(handoff.compile({ live: feed.handoff() }), handoff.EMPTY);
  for (const junk of [null, undefined, 5, "x", [], { guild: 5, lfg: "x", plan: [] }, { guild: { id: "nope", events: [], signups: [] } }, { plan: { members: [] } }]) assert.equal(handoff.compile({ profiles, wishlist, live: junk }), plainFile, JSON.stringify(junk));
  let changes = 0; feed.onHandoffChange(() => changes++);
  assert.equal(feed.setHandoff({ guild: { id: "g_abc", events: [E1()], signups: { abc123: [E2("Bob", "healer", 2, "discord")] }, discord: "connected" } }), true);
  assert.equal(feed.setHandoff({ guild: { id: "g_abc", events: [E1()], signups: { abc123: [E2("Bob", "healer", 2, "discord")] }, discord: "connected" } }), false, "the same again changes nothing");
  assert.equal(feed.setHandoff({ lfg: [P1()] }), true);
  assert.ok(feed.handoff().guild && feed.handoff().lfg, "a part left out is kept");
  assert.equal(feed.setHandoff({ plan: { place: "sm", members: [{ name: "Abel", role: "healer", bring: "Skeleton Key" }, { name: "Bob", role: null }] } }), true);
  assert.equal(changes, 3);
  const text = handoff.compile({ profiles, wishlist, live: feed.handoff() });
  assert.ok(text.startsWith(plainFile.slice(0, plainFile.lastIndexOf("}}"))), "the characters' lines are untouched");
  assert.match(text, /\},guild=\{id="g_abc",discord="connected",events=\{\{"abc123",3,"Anna","",1795806000,"mc",2,8,30,0,"Molten Core","Bring \\034fire\\034 resist"\}\},signups=\{\{"abc123","Bob","h",2,"d"\}\}\},lfg=\{rows=\{\{"abcdefgh12345678","g","Cy","Thunder Hold",34,3,"d","sm","",-1,-1,-1,1795514400\}\}\},plan=\{p="sm",n="",t=0,m=\{\{"Abel","h","Skeleton Key"\},\{"Bob","-",""\}\}\}\}\n$/);
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n/, "schema 1, additive");
  assert.equal(feed.setHandoff({ guild: null }), true);
  assert.doesNotMatch(handoff.compile({ live: feed.handoff() }), /guild=/);
  assert.match(handoff.compile({ live: feed.handoff() }), /lfg=.*plan=/);
});

test("hand-off rows are checked one by one: bad ids, names, text with codes, duplicates and strangers are left out", () => {
  const n = normalizeHandoff({ guild: { id: "g_abc", guildName: "Night Watch", realm: "Thunder Hold", discord: "weird", events: [E1(), E1({ id: "abc123", title: "Twin" }), E1({ id: "UPPER1" }), E1({ id: "ok1234", title: "x" }), E1({ id: "ok1235", title: "see |cffff0000red|r" }),
    E1({ id: "ok1236", at: "never" }), E1({ id: "ok1237", roles: { tank: 10, healer: 1, damage: 1 } }), E1({ id: "ok1238", creator: { name: "A1", realm: "x" } }), E1({ id: "ok1239", version: 0 }), E1({ id: "ok1240", place: "TooLongPlace" }),
    E1({ id: "ok1241", cancelled: true, note: "", editor: { name: "Bob", realm: "Thunder Hold" } }), null, 5],
    signups: { abc123: [E2("Bob", "healer", 2, "discord"), E2("bob", "tank", 3, "game"), E2("Cy", "dancer", 1, "game"), E2("Dee", "no", 1, "telepathy"), E2("Eve", "maybe", 1, "desktop"), null], nosuch: [E2("Bob", "tank", 1, "game")], ok1241: "x" } },
    lfg: { realm: "Thunder Hold", faction: "horde", rows: [P1(), P1(), P1({ id: "short" }), P1({ id: "bbbbbbbb12345678", kind: "lfm", need: { tank: 1, healer: 0, damage: 2 }, class: null, roles: ["healer", "tank", "tank"], note: "fast run" }),
      P1({ id: "cccccccc12345678", note: "visit |Hlink|h" }), P1({ id: "dddddddd12345678", class: "bard" }), P1({ id: "eeeeeeee12345678", level: 0 })] },
    plan: { place: "sm", note: "Meet at the stone", at: "2026-11-24T18:00:00Z", for: { name: "Abel", realm: "Thunder Hold" }, members: [{ name: "Abel", role: "healer", bring: "Skeleton Key" }, { name: "Bob", role: "tank" }] } });
  assert.deepEqual(n.guild.events.map((e) => e.id), ["abc123", "ok1241"]);
  assert.deepEqual(n.guild.events[1], { id: "ok1241", ver: 3, creator: "Anna", editor: "Bob", at: 1795806000, place: "mc", t: 2, h: 8, d: 30, x: 1, title: "Molten Core", note: "" });
  assert.deepEqual(n.guild.signups, [{ id: "abc123", name: "Bob", s: "h", ver: 2, via: "d" }, { id: "abc123", name: "Eve", s: "m", ver: 1, via: "k" }]);
  assert.equal(n.guild.discord, "none"); assert.equal(n.guild.guildName, "Night Watch");
  assert.deepEqual(n.lfg.rows.map((r) => r.id), ["abcdefgh12345678", "bbbbbbbb12345678"]);
  assert.deepEqual(n.lfg.rows[1], { id: "bbbbbbbb12345678", kind: "m", name: "Cy", realm: "Thunder Hold", level: 34, cls: 0, roles: "th", place: "sm", note: "fast run", need: { t: 1, h: 0, d: 2 }, at: 1795514400 });
  assert.deepEqual([n.lfg.realm, n.lfg.faction], ["Thunder Hold", "horde"]);
  assert.deepEqual(n.plan, { place: "sm", note: "Meet at the stone", at: 1795543200, members: [{ name: "Abel", role: "h", bring: "Skeleton Key" }, { name: "Bob", role: "t", bring: "" }], for: "Abel-Thunder Hold" });
  // A plan with anything off is refused whole (half a plan would mislead a party).
  for (const bad of [{ members: [{ name: "Abel", role: "bard" }] }, { members: [{ name: "Abel" }, { name: "abel" }] }, { place: "NOPE", members: [{ name: "Abel" }] }, { members: [{ name: "Abel", bring: "x".repeat(61) }] }, { members: "x" }]) assert.equal(normalizeHandoff({ plan: bad }).plan, null, JSON.stringify(bad));
});

test("caps and drop order: 60 events, 40 sign-ups an event, 40 board rows; sign-ups go before events, the board before the guild, the plan last", () => {
  const names = Array.from({ length: 60 }, (_, i) => "N" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + "x");
  const events = Array.from({ length: 80 }, (_, i) => E1({ id: "ev" + String(1000 + i), at: new Date(Date.parse("2026-11-27T19:00:00Z") + i * 3600000).toISOString(), title: "T".repeat(40), note: "n".repeat(80) }));
  const signups = Object.fromEntries(events.map((e) => [e.id, names.map((n, i) => E2(n, "healer", 1 + i, "discord"))]));
  const lfg = Array.from({ length: 70 }, (_, i) => P1({ id: "l" + String(100000000000000 + i), at: new Date(Date.parse("2026-11-24T10:00:00Z") + i * 60000).toISOString(), note: "n".repeat(60) }));
  const plan = { place: "sm", members: Array.from({ length: 50 }, (_, i) => ({ name: names[i % 60] + "y".repeat(Math.floor(i / 60) + 1), role: "damage", bring: "b".repeat(60) })) };
  const n = normalizeHandoff({ guild: { id: "g_big", events, signups, discord: "connected" }, lfg, plan });
  assert.equal(n.guild.events.length, 60); assert.equal(n.guild.signups.length, 600, "600 sign-ups in all");
  assert.ok(n.guild.signups.filter((s) => s.id === n.guild.events[0].id).length === 40, "40 an event");
  assert.equal(n.lfg.rows.length, 40); assert.equal(n.lfg.rows[0].at, 1795514400 + 69 * 60, "the newest board rows are kept");
  assert.equal(n.plan.members.length, 40);
  const text = handoff.compile({ live: n });
  const field = (name) => { const m = new RegExp(name + "=\\{").exec(text); return m ? m.index : -1; };
  assert.ok(field("guild") > 0 && field("lfg") > field("guild") && field("plan") > field("lfg"));
  assert.ok(Buffer.byteLength(text.slice(field("guild"), field("lfg"))) <= handoff.MAX_GUILD_BYTES + 1);
  assert.ok(Buffer.byteLength(text) < handoff.MAX_BYTES);
  // A guild part over its byte cap sheds sign-ups first, then events from the far end.
  const long = (i) => "Ab" + "cdefghijklmnopqrstuvwxyz".repeat(1).slice(0, 20) + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26) % 26) + "ø".repeat(10);
  const fat = { id: "g_big", discord: "none", events: n.guild.events.map((e) => ({ ...e, creator: "C" + "r".repeat(46), title: "é".repeat(20), note: "é".repeat(40) })), signups: [] };
  for (const e of fat.events.slice(0, 15)) for (let i = 0; i < 40; i++) fat.signups.push({ id: e.id, name: long(i), s: "h", ver: 9999, via: "d" });
  const fatText = handoff.compile({ live: { guild: fat, lfg: null, plan: null } });
  assert.ok(Buffer.byteLength(fatText) < handoff.MAX_BYTES && /guild=\{id="g_big"/.test(fatText));
  // When the characters' own lines fill the file, the live parts give way in order: board, guild, plan.
  const many = Array.from({ length: 100 }, (_, i) => saved("p" + i, "N".repeat(50) + i, "R".repeat(50)));
  const wishes = () => Array.from({ length: 200 }, (_, i) => 2000000000 + i);
  const base = handoff.compile({ profiles: many, wishlist: wishes });
  const room = handoff.MAX_BYTES - Buffer.byteLength(base);
  const full = handoff.compile({ profiles: many, wishlist: wishes, live: n });
  assert.ok(Buffer.byteLength(full) <= handoff.MAX_BYTES);
  const parts = { guild: /,guild=\{/.test(full), lfg: /,lfg=\{/.test(full), plan: /,plan=\{/.test(full) };
  const sizeOf = (key) => Buffer.byteLength(handoff.compile({ live: { ...{ guild: null, lfg: null, plan: null }, [key]: n[key] } })) - Buffer.byteLength(handoff.EMPTY);
  if (room < sizeOf("plan")) assert.deepEqual(parts, { guild: false, lfg: false, plan: false });
  else if (room < sizeOf("plan") + sizeOf("guild")) assert.deepEqual(parts, { guild: false, lfg: false, plan: true }, "the plan stays longest");
  else if (room < sizeOf("plan") + sizeOf("guild") + sizeOf("lfg")) assert.deepEqual(parts, { guild: true, lfg: false, plan: true }, "the board goes first");
  else assert.deepEqual(parts, { guild: true, lfg: true, plan: true });
  assert.ok(full.startsWith(base.slice(0, base.lastIndexOf("}}"))), "no character line is touched to make room");
  // The same order with less and less room: each step drops exactly the next part.
  const seen = new Set();
  for (const count of [100, 99, 98, 97, 96, 95, 90, 80, 60, 1]) {
    const some = many.slice(0, count), text = handoff.compile({ profiles: some, wishlist: wishes, live: n });
    assert.ok(Buffer.byteLength(text) <= handoff.MAX_BYTES);
    const key = [/,guild=\{/.test(text) ? "guild" : "", /,lfg=\{/.test(text) ? "lfg" : "", /,plan=\{/.test(text) ? "plan" : ""].filter(Boolean).join("+");
    assert.ok(["", "plan", "guild+plan", "guild+lfg+plan"].includes(key), `never the board without the guild, never the guild without the plan: ${key}`);
    seen.add(key);
  }
  assert.ok(seen.has("guild+lfg+plan") && seen.size >= 2, [...seen].join(" | "));
});

test("the game reads the compiled hand-off: guild, board and plan come back row for row, and hostile data is refused", () => {
  const feed = feedModule.create();
  feed.setHandoff({ guild: { id: "g_abc", guildName: "Night Watch", realm: "Thunder Hold", discord: "connected", events: [E1(), E1({ id: "def456", cancelled: true, editor: { name: "Bob", realm: "Thunder Hold" }, note: "" })], signups: { abc123: [E2("Bob", "healer", 2, "discord"), E2("Cy", "tank", 1, "desktop")] } },
    lfg: { realm: "Thunder Hold", faction: "horde", rows: [P1(), P1({ id: "bbbbbbbb12345678", kind: "lfm", who: { name: "Dee", realm: "Thunder Hold" }, need: { tank: 1, healer: 0, damage: 2 }, class: null, roles: [], note: "fast run", at: "2026-11-24T10:05:00Z" })] },
    plan: { place: "sm", note: "Meet at the stone", at: "2026-11-24T18:00:00Z", for: ABEL, members: [{ name: "Abel", role: "healer", bring: 'Skeleton "Key"' }, { name: "Bob", role: "tank" }, { name: "Cy", role: null }] } });
  const file = path.join(require("node:os").tmpdir(), `bf-live-handoff-${process.pid}.lua`);
  fs.writeFileSync(file, handoff.compile({ live: feed.handoff() }));
  try {
    lua(String.raw`DEFAULT_CHAT_FRAME={AddMessage=function() end}
for _,f in ipairs({'Lfg','Events','LiveGuild'}) do dofile('addon/BackstageForever/BackstageForever'..f..'.lua') end
dofile(${JSON.stringify(file.replace(/\\/g, "/"))})
local D=BackstageForeverDesktopData
local g=BackstageForeverDeskGuild(D)
assert(g.id=='g_abc' and g.name=='Night Watch' and g.realm=='Thunder Hold' and g.discord=='connected' and #g.events==2 and #g.signups==2)
local e=g.events[1]
assert(e.id=='abc123' and e.ver==3 and e.creator=='Anna' and e.editor==nil and e.at==1795806000 and e.dungeon=='mc' and e.roles.t==2 and e.roles.h==8 and e.roles.d==30 and e.cancelled==false and e.title=='Molten Core' and e.note=='Bring "fire" resist')
assert(g.events[2].cancelled==true and g.events[2].editor=='Bob' and g.events[2].note==nil)
assert(g.signups[1].n=='Bob' and g.signups[1].s=='h' and g.signups[1].v==2 and g.signups[1].via=='d' and g.signups[2].via=='k')
local rows,given=BackstageForeverDeskBoard(D,'Thunder Hold','H')
assert(given and #rows==2 and rows[1].who=='Dee' and rows[1].kind=='m' and rows[1].need.d==2 and rows[1].note=='fast run' and rows[2].who=='Cy' and rows[2].need==nil and rows[2].class==3,'newest first')
local other,told=BackstageForeverDeskBoard(D,'Other Realm','H') assert(#other==0 and told==false,'a board for another realm is not yours')
local alliance,toldA=BackstageForeverDeskBoard(D,'Thunder Hold','A') assert(#alliance==0 and toldA==false,'nor one for the other side')
local p=BackstageForeverDeskPlan(D,'Abel-Thunder Hold')
assert(p.place=='sm' and p.note=='Meet at the stone' and p.at==1795543200 and #p.members==3 and p.members[1].role=='h' and p.members[1].bring=='Skeleton "Key"' and p.members[3].role==nil and p.members[2].bring==nil)
assert(BackstageForeverDeskPlan(D,'Zed-Thunder Hold')==nil,'a plan made for another character')
-- Hostile data: every field is checked, a bad row is left out, a bad plan is refused whole.
local function G(g) return BackstageForeverDeskGuild({schema=1,guild=g}) end
for _,bad in ipairs({'x',5,{},{id=5},{id='g_'},{id='x_abc'},{id='g_'..string.rep('a',41)},{id='g_a b'}}) do assert(G(bad)==nil) end
assert(BackstageForeverDeskGuild(nil)==nil and BackstageForeverDeskGuild({schema=2,guild={id='g_a',events={},signups={}}})==nil)
local row={'abc123',3,'Anna','',1795806000,'mc',2,8,30,0,'Molten Core',''}
local function with(i,v) local r={} for k=1,12 do r[k]=row[k] end r[i]=v return r end
local hostile={with(1,'ABC123'),with(1,'ab'),with(2,0),with(2,1.5),with(2,'3'),with(3,'An na'),with(3,5),with(4,'B0b'),with(5,5),with(5,'1795806000'),with(6,'MC'),with(7,10),with(8,-1),with(9,41),with(10,2),with(10,true),with(11,5),with(12,nil),'x',{},row}
local got=G({id='g_a',events=hostile,signups={{'abc123','Bob','h',2,'d'},{'abc123','bob','t',3,'g'},{'zzz999','Bob','h',2,'d'},{'abc123','B0b','h',2,'d'},{'abc123','Cy','x',2,'d'},{'abc123','Cy','h',0,'d'},{'abc123','Cy','h',2,'z'},'x',{}}})
assert(#got.events==1 and got.events[1].id=='abc123' and #got.signups==1 and got.signups[1].n=='Bob',#got.events..' '..#got.signups)
-- The text itself is checked where it is merged (BackstageForeverEventMergeDesk refuses codes and links).
local db={events={}}
local ctx={now=1795000000,rank=function() return 4 end}
local codes=G({id='g_a',events={with(11,'|cffff0000Red|r run'),with(11,'join www.site.example')},signups={}})
for _,ev in ipairs(codes.events) do assert(BackstageForeverEventMergeDesk(db,ev,'Me',ctx)==nil) end
assert(next(db.events)==nil)
local function B(l) return BackstageForeverDeskBoard({schema=1,lfg=l},'Thunder Hold','H') end
local lrow={'abcdefgh12345678','g','Cy','Thunder Hold',34,3,'d','sm','',-1,-1,-1,1795514400}
local function lw(i,v) local r={} for k=1,13 do r[k]=lrow[k] end r[i]=v return r end
local brows=B({rows={lw(1,'short'),lw(2,'x'),lw(3,'C1'),lw(4,'Other Realm'),lw(5,0),lw(6,10),lw(7,'dt'),lw(8,'SM'),lw(9,'a|b'),lw(10,10),lw(13,5),'x',lrow,lrow}})
assert(#brows==1 and brows[1].id=='abcdefgh12345678')
assert(#B('x')==0 and #B({rows='x'})==0 and #B({})==0)
local function P(p) return BackstageForeverDeskPlan({schema=1,plan=p},'Abel-Thunder Hold') end
assert(P({p='sm',n='',t=0,m={{'Abel','h','Skeleton Key'}}}).members[1].bring=='Skeleton Key')
for _,bad in ipairs({{p='SM',m={{'Abel','h',''}}},{p='sm',m={}},{p='sm',m={{'Abel','x',''}}},{p='sm',m={{'Ab3l','h',''}}},{p='sm',m={{'Abel','h',5}}},{p='sm',m={{'Abel','h','a|b'}}},{p='sm',m={{'Abel','h',''},{'abel','t',''}}},{p='sm',n='a|cffb',m={{'Abel','h',''}}},{p='sm',m='x'},'x'}) do assert(P(bad)==nil) end
print('ok')`);
  } finally { fs.rmSync(file, { force: true }); }
});

test("registered everywhere: both files ship, load after what they use, save per character, and the capture carries the block", () => {
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  const toc = read("addon/BackstageForever/BackstageForever.toc"), order = toc.split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  for (const file of ["BackstageForeverLiveGuild.lua", "BackstageForeverLiveParty.lua"]) { assert.ok(ADDON_FILES.includes(file), file); assert.ok(order.includes(file), file); }
  for (const before of ["BackstageForeverLive.lua", "BackstageForeverParty.lua", "BackstageForeverLfg.lua", "BackstageForeverCrew.lua", "BackstageForeverEvents.lua", "BackstageForeverDesktop.lua"]) assert.ok(order.indexOf(before) < order.indexOf("BackstageForeverLiveGuild.lua"), before);
  assert.ok(order.indexOf("BackstageForeverLiveGuild.lua") < order.indexOf("BackstageForeverLiveParty.lua"));
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverLiveGuildDB\b/m, "a per-character table; account-wide ones break the desktop's reader");
  assert.doesNotMatch(/^## SavedVariables: (.*)$/m.exec(toc)[1], /LiveGuild/);
  const capture = read("addon/BackstageForever/BackstageForever.lua");
  assert.match(capture, /BackstageForeverLiveGuildSnapshot/); assert.match(capture, /character\.live=live/); assert.match(capture, /discard\(chars\[i\],'live'\)/);
  assert.doesNotMatch(capture.slice(0, capture.indexOf("BackstageForeverLiveGuildSnapshot")).split("\n").slice(-400).join("\n"), /captureVersion\s*=\s*\d+.*live/, "the capture version is not touched");
  const main = read("src/main.cjs");
  assert.match(main, /live: require\("\.\/core\/game-guild-feed\.cjs"\)\.handoff\(\)/); assert.match(main, /guildFeed\.attach\(liveBridge\)/); assert.match(main, /guildFeed\.onHandoffChange/);
  // The feed opens no socket and reads no file.
  const source = read("src/core/game-guild-feed.cjs");
  assert.doesNotMatch(source, /require\("node:(?:fs|http|https|net|child_process)"\)|fetch\(/);
});
