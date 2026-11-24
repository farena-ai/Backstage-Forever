"use strict";
// Challenge runs (roadmap C12) and Discord presence (S6).
const test = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs"), path = require("node:path");
const C = require("../src/core/challenge-runs.cjs");
const D = require("../src/core/discord-presence.cjs");
const S = require("../src/core/share-cards.cjs");
const { registerJourneyMore } = require("../src/core/journey-more-ipc.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const DAY = 86400000, START = Date.parse("2026-11-01T12:00:00Z"), sec = (ms) => Math.floor(ms / 1000);
const hero = (extra = {}) => ({ id: "p", name: "Abel", realm: "Thunder Hold", className: "Hunter", level: 24, source: { kind: "wow-addon", id: "s", updatedAt: "2026-11-20T00:00:00.000Z" },
  journal: { levels: [{ level: 10, at: sec(START - 5 * DAY) }, { level: 20, at: sec(START + 3 * DAY) }, { level: 24, at: sec(START + 6 * DAY) }], firsts: [{ key: "death", at: sec(START - 9 * DAY) }], runs: [] },
  ledger: { prices: [{ id: 1, hist: [[100, sec(START - 2 * DAY)]] }] }, ...extra });
const all = { oneLife: true, noAuction: true, selfFound: true, noDungeonsBelow: 20, custom: "No mounts before 40" };
const run = (rules = all, startLevel = 12) => ({ startedAt: START, startLevel, rules });
const status = (view) => Object.fromEntries(view.rules.map((r) => [r.id, r.status]));

test("rules are cleaned: at least one, a bounded level, one plain line of your own", () => {
  assert.equal(C.cleanRules({}), null); assert.equal(C.cleanRules(null), null);
  assert.deepEqual(C.cleanRules({ oneLife: true, noAuction: "yes", noDungeonsBelow: 99, custom: "a\nb" }), { oneLife: true, noAuction: false, selfFound: false, noDungeonsBelow: 0, custom: "" });
  assert.deepEqual(C.cleanRules({ custom: "  Only   quest rewards " }), { oneLife: false, noAuction: false, selfFound: false, noDungeonsBelow: 0, custom: "Only quest rewards" });
  assert.equal(C.cleanRules({ custom: "x".repeat(C.LIMITS.custom + 1) }), null);
  assert.equal(C.cleanRun({ startedAt: 0, rules: all }), null); assert.equal(C.cleanRun({ startedAt: START, rules: {} }), null);
  assert.deepEqual(C.RULES.map((r) => r.id), ["oneLife", "noAuction", "selfFound", "noDungeonsBelow", "custom"]);
});

test("with nothing on record a rule is never called verified: it is 'nothing recorded against it' or self-declared", () => {
  const view = C.evaluate(run(), hero(), { now: START + 10 * DAY });
  assert.deepEqual(status(view), { oneLife: "clear", noAuction: "clear", selfFound: "declared", noDungeonsBelow: "clear", custom: "declared" });
  assert.equal(view.broken, false); assert.equal(view.brokenAt, null); assert.equal(view.declared, 2); assert.equal(view.days, 10);
  assert.match(view.verdict, /^Nothing recorded against your rules; 2 of 5 are self-declared\. That is not proof/);
  for (const r of view.rules) { assert.equal(r.evidence, null); assert.ok(r.basis.length > 30, r.id); }
  assert.match(view.rules[0].basis, /A death while the addon or the live link was off is not known/);
  assert.doesNotMatch(JSON.stringify(view), /verified|confirmed|proven/i);
  // A death, an auction page and a dungeon visit from before the run do not count against it.
  assert.deepEqual(view.milestones.map((m) => [m.level, m.standing]), [[10, "before"], [20, "kept"], [30, "ahead"], [40, "ahead"], [50, "ahead"], [60, "ahead"]]);
  assert.equal(view.kept, 1);
  // Only self-declared rules: the verdict says exactly that.
  assert.match(C.evaluate(run({ custom: "Walk everywhere" }), hero()).verdict, /^Every rule here is self-declared/);
  // Without saved auction prices the auction rule has nothing to check either.
  assert.equal(status(C.evaluate(run({ noAuction: true }), hero({ ledger: { pricesOn: false, prices: [] } }))).noAuction, "declared");
  assert.equal(status(C.evaluate(run({ noAuction: true }), hero({ ledger: undefined }))).noAuction, "declared");
  assert.equal(C.evaluate(null, hero()), null); assert.equal(C.evaluate(run(), null), null);
});

test("a rule is broken only by a record: a recorded death, a death in a saved run, saved auction prices, an early dungeon", () => {
  const died = C.evaluate(run(), hero(), { deaths: [{ at: START - DAY, mapId: 1411 }, { at: START + 4 * DAY, mapId: 1413 }], mapName: (id) => ({ 1413: "The Barrens" })[id] || "?" });
  assert.equal(status(died).oneLife, "broken"); assert.equal(died.brokenAt, START + 4 * DAY);
  assert.match(died.rules[0].evidence, /^A death was recorded on 5 Nov 2026 in The Barrens\.$/);
  assert.match(died.verdict, /^A record shows one rule broken\.$/);
  assert.deepEqual(died.milestones.slice(0, 2).map((m) => m.standing), ["before", "kept"], "level 20 came a day before the death");
  const later = C.evaluate(run(), hero({ level: 30, journal: { ...hero().journal, levels: [...hero().journal.levels, { level: 30, at: sec(START + 8 * DAY) }] } }), { deaths: [{ at: START + 4 * DAY }] });
  assert.equal(later.milestones[2].standing, "after"); assert.equal(later.kept, 1);
  const undated = C.evaluate(run(), hero({ level: 30 }), { deaths: [{ at: START + 4 * DAY }] });
  assert.equal(undated.milestones[2].standing, "unknown", "no level date to compare: the app does not guess");
  const inRun = C.evaluate(run({ oneLife: true }), hero({ journal: { ...hero().journal, runs: [{ instanceMap: 36, instanceType: "party", name: "The Deadmines", startedAt: sec(START + 5 * DAY), endedAt: sec(START + 5 * DAY) + 3000, deaths: 2, loot: [] }] } }));
  assert.match(inRun.rules[0].evidence, /^2 deaths were counted in a dungeon run on 6 Nov 2026\.$/);
  const first = C.evaluate(run({ oneLife: true }), hero({ journal: { ...hero().journal, firsts: [{ key: "death", at: sec(START + DAY) }] } }));
  assert.match(first.rules[0].evidence, /first death on 2 Nov 2026/);
  const auction = C.evaluate(run(), hero({ ledger: { prices: [{ id: 1, hist: [[100, sec(START - DAY)], [120, sec(START + 2 * DAY)]] }, { id: 2, hist: [[5, sec(START + 7 * DAY)]] }] } }));
  assert.deepEqual([status(auction).noAuction, status(auction).selfFound, status(auction).oneLife], ["broken", "broken", "clear"]);
  assert.match(auction.rules[1].evidence, /^Auction prices were saved on 3 Nov 2026, so the auction house was opened\. The app cannot see whether anything was bought or sold\.$/);
  assert.equal(auction.brokenAt, START + 2 * DAY); assert.match(auction.verdict, /2 rules broken/);
  assert.equal(auction.milestones[1].standing, "after", "level 20 came after the auction page");
  const visit = (at, name) => ({ instanceMap: 36, instanceType: "party", ...(name ? { name } : {}), startedAt: sec(at), endedAt: sec(at) + 60, deaths: 0, loot: [] });
  const early = C.evaluate(run({ noDungeonsBelow: 20 }), hero({ journal: { ...hero().journal, runs: [visit(START - DAY, "Old Run"), visit(START + DAY, "The Deadmines"), visit(START + 5 * DAY, "Later Run")] } }));
  assert.equal(status(early).noDungeonsBelow, "broken"); assert.match(early.rules[0].evidence, /^The Deadmines was entered on 2 Nov 2026 at level 10\.$/);
  const fine = C.evaluate(run({ noDungeonsBelow: 20 }), hero({ journal: { ...hero().journal, runs: [visit(START + 5 * DAY)] } }));
  assert.equal(status(fine).noDungeonsBelow, "clear");
  const dateless = C.evaluate(run({ noDungeonsBelow: 20 }), hero({ journal: { levels: [], firsts: [], runs: [visit(START + DAY)] } }));
  assert.equal(status(dateless).noDungeonsBelow, "clear"); assert.match(dateless.rules[0].basis, /1 saved visit has no level date to compare/);
  // An ended run stops counting what came after.
  const ended = C.evaluate({ ...run({ oneLife: true }), endedAt: START + 2 * DAY }, hero(), { deaths: [{ at: START + 4 * DAY }] });
  assert.equal(ended.broken, false); assert.equal(ended.days, 2);
});

test("the share card says how far the app can vouch for each rule", () => {
  const view = C.evaluate(run(), hero(), { now: START + 10 * DAY }), data = C.cardData(view);
  assert.deepEqual(data.rules.slice(0, 3), ["One life: nothing recorded against it.", "No auction house: nothing recorded against it.", "Self-found: self-declared."]);
  const card = S.shareCard("challenge", data, { name: "Abel", realm: "Thunder Hold", level: 24, className: "Hunter" }, { name: false, realm: false });
  assert.equal(card.kicker, "Challenge run"); assert.equal(card.title, "Level 24 by my own rules"); assert.equal(card.who, "", "no name unless ticked");
  assert.ok(card.lines.includes("Checked only against what the app saved. It is not proof."));
  assert.deepEqual(card.stats, [{ label: "Level", value: "24" }, { label: "Milestones", value: "1 of 6" }, { label: "Days", value: "10" }]);
  assert.ok(card.lines.length <= S.LIMITS.lines && card.lines.every((l) => l.length <= S.LIMITS.line));
  const broken = S.shareCard("challenge", C.cardData(C.evaluate(run(), hero(), { deaths: [{ at: START + DAY }] })));
  assert.equal(broken.title, "A rule was broken"); assert.ok(broken.lines.includes("One life: a record shows it broken."));
  assert.ok(!broken.lines.some((l) => /not proof/.test(l)));
  assert.equal(S.shareCard("challenge", { rules: [] }), null); assert.equal(C.cardData(null), null);
  assert.ok(S.KINDS.includes("challenge"));
});

test("the store keeps one run per character, bounded and re-validated", () => {
  const written = [];
  const store = new C.ChallengeStore({ file: "Z:/none/challenge-runs.json", write: (f, t) => written.push(t) });
  assert.equal(store.get("p"), null);
  assert.throws(() => store.start("p", {}), /Tick at least one rule/);
  assert.throws(() => store.start("p", { custom: "x".repeat(200) }), /Tick at least one rule|at most 120/);
  assert.throws(() => store.start("p", { oneLife: true, custom: "x".repeat(200) }), /at most 120 characters/);
  assert.throws(() => store.start("__proto__", all), /Unknown character/);
  const started = store.start("p", all, { level: 12, now: START });
  assert.deepEqual(started, { startedAt: START, startLevel: 12, rules: C.cleanRules(all) });
  assert.deepEqual(JSON.parse(written.at(-1)), { version: 1, characters: { p: started } });
  assert.equal(store.end("p", START + DAY).endedAt, START + DAY); assert.equal(store.end("p", START + 5 * DAY).endedAt, START + DAY, "ending twice keeps the first end");
  store.start("q", { oneLife: true }, { now: START });
  assert.equal(store.absorb({ profiles: [{ id: "q" }] }), true); assert.equal(store.get("p"), null); assert.ok(store.get("q"));
  assert.equal(store.remove("q"), true); assert.equal(store.remove("q"), false);
});

// ---- Discord presence ----
test("frames: opcode and length little endian, JSON body; the decoder waits for whole frames and refuses bad ones", () => {
  const frame = D.encode(D.OP.FRAME, { cmd: "SET_ACTIVITY", n: "ü" });
  assert.equal(frame.readUInt32LE(0), 1); assert.equal(frame.readUInt32LE(4), frame.length - 8);
  assert.deepEqual(JSON.parse(frame.subarray(8).toString("utf8")), { cmd: "SET_ACTIVITY", n: "ü" });
  assert.deepEqual([...D.encode(D.OP.HANDSHAKE, { v: 1 }).subarray(0, 8)], [0, 0, 0, 0, 7, 0, 0, 0]);
  assert.throws(() => D.encode(9, {}), /Unknown opcode/); assert.throws(() => D.encode(1, { big: "x".repeat(D.MAX_FRAME) }), /too large/);
  const dec = new D.Decoder(), two = Buffer.concat([frame, D.encode(D.OP.PING, { t: 1 })]);
  assert.deepEqual(dec.push(two.subarray(0, 5)), []); assert.deepEqual(dec.push(two.subarray(5, 20)), []);
  assert.deepEqual(dec.push(two.subarray(20)), [{ op: 1, data: { cmd: "SET_ACTIVITY", n: "ü" } }, { op: 3, data: { t: 1 } }]);
  assert.deepEqual(dec.push(Buffer.from([2, 0, 0, 0, 0, 0, 0, 0])), [{ op: 2, data: null }]);
  const huge = Buffer.alloc(8); huge.writeUInt32LE(1, 0); huge.writeUInt32LE(D.MAX_FRAME + 1, 4);
  assert.throws(() => new D.Decoder().push(huge), /Unreadable frame/);
  assert.throws(() => new D.Decoder().push(Buffer.concat([Buffer.from([1, 0, 0, 0, 3, 0, 0, 0]), Buffer.from("{oo")])), /Unreadable frame/);
  assert.throws(() => new D.Decoder().push(Buffer.from([9, 0, 0, 0, 0, 0, 0, 0])), /Unreadable frame/);
});

test("the status text: level, class and zone each have a tick, and a name is never part of it", () => {
  const facts = { level: 34, className: "Hunter", zone: "Stranglethorn Vale", name: "Abel", realm: "Thunder Hold" }, on = { enabled: true, appId: "123456789012345678", level: true, className: true, zone: true };
  assert.deepEqual(D.activityText(facts, on), { details: "Level 34 Hunter", state: "In Stranglethorn Vale", line: "Level 34 Hunter in Stranglethorn Vale" });
  assert.deepEqual(D.activityText(facts, { ...on, zone: false }), { details: "Level 34 Hunter", state: "", line: "Level 34 Hunter" });
  assert.deepEqual(D.activityText(facts, { ...on, level: false, className: false }), { details: "In Stranglethorn Vale", state: "", line: "In Stranglethorn Vale" });
  assert.equal(D.activityText(facts, { ...on, level: false }).details, "Hunter");
  assert.equal(D.activityText(facts, { ...on, level: false, className: false, zone: false }), null);
  assert.equal(D.activityText({ level: 0, className: "", zone: "" }, on), null); assert.equal(D.activityText(null, on), null);
  assert.doesNotMatch(JSON.stringify(D.activityText(facts, on)), /Abel|Thunder Hold/);
  assert.equal(D.activityText({ zone: "Z\u0001one\n" + "x".repeat(200) }, on).details.length <= 100, true);
  for (const id of ["", "abc", "123", "1234567890123456x", "123456789012345678901", " 123456789012345678", 123456789012345678]) assert.equal(D.validAppId(id), false, String(id));
  assert.equal(D.validAppId("123456789012345678"), true);
  assert.deepEqual(D.cleanSettings({ enabled: "yes", appId: "nope", zone: false, extra: 1 }), { enabled: false, appId: "", level: true, className: true, zone: false });
  assert.equal(D.pipePath(0, "win32"), "\\\\.\\pipe\\discord-ipc-0"); assert.equal(D.pipePath(3, "linux", { XDG_RUNTIME_DIR: "/run/user/1000/" }), "/run/user/1000/discord-ipc-3");
});

// A fake Discord: a pipe that records what the app writes and answers like the real client.
function fakeDiscord({ missing = 0, refuse = false } = {}) {
  const log = { paths: [], frames: [], sockets: [] };
  const connect = (p) => {
    log.paths.push(p);
    const socket = new EventEmitter(), dec = new D.Decoder();
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    socket.write = (bytes) => {
      for (const f of dec.push(bytes)) {
        log.frames.push(f);
        if (f.op === D.OP.HANDSHAKE) queueMicrotask(() => socket.emit("data", refuse ? D.encode(D.OP.CLOSE, { code: 4000, message: "Invalid Client ID" }) : D.encode(D.OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } })));
      }
      return true;
    };
    log.sockets.push(socket);
    queueMicrotask(() => (log.paths.length <= missing ? socket.emit("error", Object.assign(Error("ENOENT"), { code: "ENOENT" })) : socket.emit("connect")));
    return socket;
  };
  return { log, connect };
}
const tick = () => new Promise((r) => setImmediate(r));
const ID = "123456789012345678", facts = { level: 34, className: "Hunter", zone: "Stranglethorn Vale" };

test("it never connects while off or without a valid id, and a bad id is refused in plain words", async () => {
  const fake = fakeDiscord(), saved = [];
  const p = new D.DiscordPresence({ file: "Z:/none/discord.json", connect: fake.connect, write: (f, t) => saved.push(JSON.parse(t)), platform: "win32", pid: 77 });
  assert.deepEqual(p.status(), { enabled: false, appId: "", level: true, className: true, zone: true, appIdValid: false, state: "off", connected: false, preview: "" });
  p.update(facts); await tick();
  assert.equal(p.configure({ enabled: true }).state, "needs-id");
  p.update(facts); p.update(facts); await tick();
  assert.throws(() => p.configure({ appId: "12ab" }), /17 to 20 digits and nothing else/);
  assert.throws(() => p.configure({ enabled: "yes" }), /Invalid Discord setting/);
  assert.equal(p.status().state, "needs-id");
  p.configure({ enabled: false, appId: ID }); p.update(facts); await tick();
  assert.deepEqual(fake.log.paths, [], "the pipe was never opened");
  assert.deepEqual(saved.at(-1), { enabled: false, appId: ID, level: true, className: true, zone: true });
  assert.equal(p.status().preview, "Level 34 Hunter in Stranglethorn Vale", "the preview needs no connection");
});

test("with an id and the switch on: handshake, READY, SET_ACTIVITY; changes are rate limited; off closes the pipe", async () => {
  const fake = fakeDiscord({ missing: 2 });
  let now = 1000000;
  const p = new D.DiscordPresence({ connect: fake.connect, platform: "win32", pid: 77, now: () => now });
  p.configure({ enabled: true, appId: ID });
  assert.equal(p.status().state, "waiting", "no facts yet: nothing to show, nothing opened");
  assert.deepEqual(fake.log.paths, []);
  p.update(facts); await tick(); await tick();
  assert.deepEqual(fake.log.paths, [0, 1, 2].map((n) => `\\\\.\\pipe\\discord-ipc-${n}`), "a pipe that is not there means try the next");
  assert.deepEqual(fake.log.frames[0], { op: 0, data: { v: 1, client_id: ID } });
  assert.deepEqual(fake.log.frames[1], { op: 1, data: { cmd: "SET_ACTIVITY", args: { pid: 77, activity: { details: "Level 34 Hunter", state: "In Stranglethorn Vale", instance: false } }, nonce: "bf-1" } });
  assert.equal(p.status().state, "on"); assert.equal(p.status().connected, true);
  assert.doesNotMatch(JSON.stringify(fake.log.frames), /Abel|name/i, "no name is sent");
  p.update(facts); assert.equal(fake.log.frames.length, 2, "the same line is not sent twice");
  p.update({ ...facts, level: 35 }); assert.equal(fake.log.frames.length, 2, "a change inside the gap waits");
  now += D.MIN_GAP_MS; p.update({ ...facts, level: 35 });
  assert.equal(fake.log.frames[2].data.args.activity.details, "Level 35 Hunter");
  now += D.MIN_GAP_MS; p.configure({ zone: false });
  assert.deepEqual(fake.log.frames[3].data.args.activity, { details: "Level 35 Hunter", instance: false }, "an unticked zone is not sent");
  now += D.MIN_GAP_MS; p.update(null);
  assert.deepEqual(fake.log.frames[4].data.args, { pid: 77 }, "nothing to show clears the status");
  // Discord pings; the app answers.
  const live = fake.log.sockets.at(-1); live.emit("data", D.encode(D.OP.PING, { t: 5 }));
  assert.deepEqual(fake.log.frames.at(-1), { op: 4, data: { t: 5 } });
  p.configure({ enabled: false });
  assert.equal(live.destroyed, true); assert.equal(p.status().state, "off"); assert.equal(p.status().connected, false);
  const before = fake.log.paths.length; p.update(facts); await tick();
  assert.equal(fake.log.paths.length, before, "off means no new connection");
});

test("no Discord, or a refused id: it says so and waits before trying again", async () => {
  const none = fakeDiscord({ missing: 99 });
  let now = 5000000;
  const p = new D.DiscordPresence({ connect: none.connect, platform: "win32", now: () => now });
  p.configure({ enabled: true, appId: ID }); p.update(facts);
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(none.log.paths.length, D.PIPES); assert.equal(p.status().state, "no-discord");
  p.update(facts); await tick(); assert.equal(none.log.paths.length, D.PIPES, "not again right away");
  now += D.RETRY_MS; p.update(facts); for (let i = 0; i < 12; i++) await tick();
  assert.equal(none.log.paths.length, 2 * D.PIPES);
  const bad = fakeDiscord({ refuse: true });
  const q = new D.DiscordPresence({ connect: bad.connect, platform: "win32", now: () => now });
  q.configure({ enabled: true, appId: ID }); q.update(facts); await tick(); await tick();
  assert.equal(q.status().state, "refused"); assert.equal(bad.log.paths.length, 1, "a refused id is not tried on other pipes");
  assert.equal(bad.log.sockets[0].destroyed, true);
  // The app's own code holds no network call for this feature and no library.
  const source = read("src/core/discord-presence.cjs");
  assert.doesNotMatch(source, /require\("(node:)?(https?|dns|dgram|tls)"\)|fetch\(|discord-rpc/);
  assert.doesNotMatch(read("package.json"), /discord/i);
});

test("the Journey handlers: views are read-only, changes are private, and Discord gets facts only from the live link", () => {
  const handlers = {}, privates = new Set();
  const handle = (name, fn, o = {}) => { handlers[name] = fn; if (o.privateOnly) privates.add(name); };
  const state = { activeProfileId: "p", profiles: [hero()] };
  const challenges = new C.ChallengeStore({ write: () => {} });
  const fake = fakeDiscord();
  const presence = new D.DiscordPresence({ connect: fake.connect, platform: "win32" });
  let live = null;
  registerJourneyMore({ handle, getState: () => state, challenges, journey: { deaths: () => [{ at: Date.now() + 1000, mapId: 1413 }] }, presence, presenceFacts: () => live });
  assert.deepEqual([...privates].sort(), ["endChallengeRun", "setDiscordPresence", "startChallengeRun"]);
  for (const name of ["challengeRun", "discordPresence"]) assert.throws(() => handlers[name](1), /Invalid/);
  let view = handlers.challengeRun();
  assert.equal(view.run, null); assert.equal(view.card, null); assert.equal(view.options.length, 5); assert.equal(view.saved, true);
  assert.throws(() => handlers.startChallengeRun({}), (e) => e.name === "JourneyError" && /Tick at least one rule/.test(e.message));
  assert.throws(() => handlers.startChallengeRun("x"), /Invalid/);
  view = handlers.startChallengeRun({ oneLife: true, custom: "Walk only" });
  assert.equal(view.run.startLevel, 24); assert.deepEqual(view.run.rules.map((r) => r.status), ["broken", "declared"], "a death recorded after the start breaks one life");
  assert.equal(view.card.broken, true);
  assert.equal(handlers.endChallengeRun("remove").run, null); assert.throws(() => handlers.endChallengeRun("explode"), /Invalid/);
  assert.equal(handlers.discordPresence().state, "off");
  assert.throws(() => handlers.setDiscordPresence({ appId: "abc" }), (e) => e.name === "JourneyError" && /17 to 20 digits/.test(e.message));
  assert.throws(() => handlers.setDiscordPresence({ secret: 1 }), /Invalid/);
  assert.equal(handlers.setDiscordPresence({ enabled: true }).state, "needs-id");
  assert.equal(handlers.setDiscordPresence({ appId: ID }).state, "waiting", "no live link: nothing is shown and nothing is opened");
  assert.deepEqual(fake.log.paths, []);
  live = facts;
  assert.equal(handlers.discordPresence().preview, "Level 34 Hunter in Stranglethorn Vale");
  assert.equal(fake.log.paths.length, 1);
  presence.stop();
  // Wiring: main registers both, the preload exposes them, the Journey lists the two views.
  const main = read("src/main.cjs"), preload = read("src/preload.cjs");
  assert.match(main, /registerJourneyMore\(/); assert.match(main, /f\.live && p \?/, "facts for Discord come only from the live link");
  for (const name of ["challengeRun", "startChallengeRun", "endChallengeRun", "discordPresence", "setDiscordPresence", "routeEditor", "routeEdit", "copyRouteCode", "saveRouteCode", "openRouteCode", "importRouteCode"]) assert.match(preload, new RegExp(`${name}: \\(`), name);
  assert.match(read("src/renderer/journey-extras.js"), /\["challenge", "Challenge run"\], \["overlay", "Stream overlay"\], \["discord", "Discord status"\]/);
  const more = read("src/renderer/journey-more.js");
  assert.match(more, /Needs a Discord application id/); assert.match(more, /Your character's name is never sent/);
  assert.doesNotMatch(more, /innerHTML/);
});
