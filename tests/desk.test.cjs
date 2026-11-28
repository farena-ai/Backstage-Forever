"use strict";
// Backstage Desk, the app half: what leaves the computer (and what never can), the scrubber,
// the ticket store and its sync against a fake service that implements the contract, the daily
// heartbeat, the switches, messages from the team, and the IPC checks.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { CommunityService } = require("../src/core/community.cjs");
const D = require("../src/core/desk.cjs");
const { DeskService, STATISTICS_DEFAULT, heartbeatBody, ticketBody, errorBody, linkAllowed, validAnnouncement, compareVersions, systemInfo, isoWeek } = D;
const { scrub, scrubStack, knownNames } = require("../src/core/desk-scrub.cjs");
const { registerDeskHandlers } = require("../src/core/desk-ipc.cjs");
const { fakeDesk } = require("./desk-fake-server.cjs");
const W = require("../src/renderer/privacy-wording.js");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-desk-"));

// Everything private the app could know, so the tests can prove none of it is ever in a request.
const SECRETS = ["Thrallson", "Draenor", "Night Watch", "Zugzug", "Thunder Hold", "FRANKACCOUNT", "johnsmith", "John Smith", "my secret note", "secret goal", "Player-4184-0A1B2C3D", "C:\\Users", "/home/", "AppData"];
const profiles = () => [
  { id: "p1", name: "Thrallson", realm: "Draenor", guild: "Night Watch", className: "Shaman", level: 23, notes: "my secret note", goals: [{ id: "g", text: "secret goal" }], clientBuild: "1.60.1.71037", source: { kind: "wow-addon", id: "Player-4184-0A1B2C3D" } },
  { id: "p2", name: "Zugzug", realm: "Thunder Hold", className: "Warrior", level: 60, clientBuild: "1.60.1.71037", source: { kind: "wow-addon", id: "Player-4184-0A1B2C3E" } },
];
const NAMES = () => knownNames(profiles(), ["FRANKACCOUNT", "johnsmith", "John Smith"]);
function setup(opts = {}) {
  let t = Date.parse(opts.at || "2026-11-24T12:00:00Z");
  const clock = { now: () => t, advance: (ms) => { t += ms; }, set: (iso) => { t = Date.parse(iso); } };
  const fake = opts.fake || fakeDesk({ now: clock.now });
  const dir = opts.dir || tmp();
  const community = new CommunityService({ dir, getProfiles: profiles, appVersion: "1.26.0", now: clock.now, baseUrl: "https://bf.example.test", fetch: fake.fetch });
  const notified = [], changes = [];
  const facts = { addonVersion: "1.26.0", build: "1.60.1.71037", gameConnected: true, addonInstalled: true, liveLink: false,
    // things a careless caller might hand over; none may ever be sent
    characterName: "Thrallson", realm: "Draenor", account: "FRANKACCOUNT", gameFolder: "C:\\Users\\johnsmith\\Games\\WoW", ...(opts.facts || {}) };
  const desk = new DeskService({ dir, community, appVersion: opts.appVersion || "1.26.0", channel: "stable", now: clock.now, system: { os: "windows", osMajor: "11" },
    getFacts: () => facts, getNames: NAMES, notify: (n) => notified.push(n), onChange: (n) => changes.push(n) });
  return { desk, community, fake, clock, dir, notified, changes, facts };
}
const REPORT = { kind: "bug", area: "talents", frequency: "always", summary: "Planner shows the wrong tree", details: "I opened Talents and the Frost tree showed Fire talents.", expected: "The Frost tree.", diagnostics: true, scrub: true };
const leaks = (value) => { const s = typeof value === "string" ? value : JSON.stringify(value); return SECRETS.filter((x) => s.toLowerCase().includes(x.toLowerCase())); };
const assertNoLeak = (fake) => { for (const call of fake.log) assert.deepEqual(leaks(call.raw + JSON.stringify(call.query)), [], `${call.method} ${call.route} carries private data`); };

// ---------------------------------------------------------------- payload builders
test("the default for statistics is one constant, and it is on", () => {
  assert.equal(STATISTICS_DEFAULT, true);
  const src = read("src/core/desk.cjs");
  assert.equal(src.match(/^const STATISTICS_DEFAULT = /gm).length, 1);
  assert.match(src, /owner may flip this/);
  assert.equal(D.ERRORS_DEFAULT, false, "automatic error reports are off until switched on");
});

test("heartbeat body: exactly the contract's fields, whatever else the input carries", () => {
  const body = heartbeatBody({ installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", appVersion: "1.26.0", addonVersion: "1.26.0", channel: "stable", os: "windows", osMajor: "11", lang: "de", build: "1.60.1.71037",
    firstSeenWeek: "2026-W48", flags: { gameConnected: true, addonInstalled: 1, liveLink: "yes", sharing: true, secret: "Thrallson" }, areas: new Set(["talents", "now", "bank", "Thrallson"]),
    name: "Thrallson", realm: "Draenor", path: "C:\\Users\\johnsmith", profiles: profiles() });
  assert.deepEqual(Object.keys(body), ["schema", "installId", "appVersion", "addonVersion", "channel", "os", "osMajor", "lang", "build", "firstSeenWeek", "flags", "areas"]);
  assert.deepEqual(body.flags, { gameConnected: true, addonInstalled: false, liveLink: false, sharing: true }, "only real booleans count");
  assert.deepEqual(body.areas, ["now", "talents"], "known areas only, in the contract's order");
  assert.deepEqual(leaks(body), []);
  // Values that do not fit the contract become null or a safe default; they are never passed through.
  const odd = heartbeatBody({ installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", appVersion: "C:\\Users\\johnsmith", addonVersion: "Thrallson", channel: "Draenor", os: "Thrallson", osMajor: "eleven", lang: "Zugzug", build: "Thunder Hold", firstSeenWeek: "Night Watch", areas: ["Zugzug"] });
  assert.deepEqual(leaks(odd), []);
  assert.deepEqual([odd.appVersion, odd.addonVersion, odd.channel, odd.os, odd.osMajor, odd.lang, odd.build], ["0.0.0", null, "dev", "windows", null, "en", null]);
  assert.match(odd.firstSeenWeek, /^\d{4}-W\d{2}$/);
  assert.throws(() => heartbeatBody({ installId: "not-a-uuid" }), /install id/);
});

test("property: no name, path or note the app knows appears in any body the builders make", () => {
  const junk = [...SECRETS, "Thrallson-Draenor", "C:\\Users\\johnsmith\\AppData\\Roaming\\Backstage Forever\\state.json", "/home/johnsmith/.config/x", "john@example.com", "10.0.0.7"];
  const fields = ["appVersion", "addonVersion", "channel", "os", "osMajor", "lang", "build", "firstSeenWeek", "where", "name", "frequency"];
  let seed = 7;
  const pick = () => junk[(seed = (seed * 1103515245 + 12345) % 2147483648) % junk.length];
  for (let i = 0; i < 200; i++) {
    const input = { installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", flags: { gameConnected: pick(), sharing: pick() }, areas: [pick(), pick(), "map"], [pick()]: pick() };
    for (const f of fields) if (i % 3 !== 0 || f !== "appVersion") input[f] = pick();
    assert.deepEqual(leaks(heartbeatBody(input)), [], "heartbeat");
    // An error message is the app's own text plus, at worst, a name or a path it was working on.
    const hot = () => { for (;;) { const v = pick(); if (!/secret|^AppData$|^C:\\Users$|^\/home\/$/.test(v)) return v; } };
    const error = errorBody({ ...input, message: `Cannot read ${hot()} of ${hot()} for ${hot()}`, stack: `Error\n    at open (${pick()}\\main.cjs:1:2)\n    at ${hot()} (C:\\Users\\johnsmith\\app\\x.js:3:4)` }, { names: NAMES() });
    assert.deepEqual(leaks(error), [], "error report");
    assert.ok(error.stack.every((l) => !/[\\/]/.test(l) && l.length <= 200) && error.stack.length <= 12 && error.message.length <= 300);
    // In a report only what the player typed is free text, and it went through the scrubber first.
    const typed = scrub(`${hot()} and ${hot()}`, { names: NAMES() }).text.padEnd(12, ".");
    const ticket = ticketBody({ ...input, kind: "bug", area: "map", summary: typed, details: typed, expected: "", diagnostics: { screen: pick(), lastError: scrub(hot(), { names: NAMES() }).text, gameConnected: pick(), addonInstalled: true, extra: pick() } });
    assert.deepEqual(leaks(ticket), [], "report");
    assert.deepEqual(Object.keys(ticket.diagnostics), ["screen", "lastError", "gameConnected", "addonInstalled"]);
  }
});

test("report body: plain validation messages, limits and the diagnostics block exactly as the contract shows it", () => {
  const base = { installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", appVersion: "1.26.0", os: "macos", osMajor: "14", lang: "fr", kind: "idea", area: "map", summary: "Short but fine", details: "Ten characters at least.", expected: "" };
  const body = ticketBody({ ...base, frequency: "weekly", diagnostics: null });
  assert.equal(body.frequency, null); assert.equal(body.diagnostics, null); assert.equal(body.addonVersion, null); assert.equal(body.build, null);
  assert.throws(() => ticketBody({ ...base, summary: "abc" }), /short summary, at least 5/);
  assert.throws(() => ticketBody({ ...base, details: "too short" }), /at least 10 characters/);
  assert.throws(() => ticketBody({ ...base, summary: "x".repeat(141) }), /under 140/);
  assert.throws(() => ticketBody({ ...base, details: "x".repeat(4001) }), /under 4,000/);
  assert.throws(() => ticketBody({ ...base, expected: "x".repeat(1001) }), /under 1,000/);
  assert.throws(() => ticketBody({ ...base, kind: "crash" }), /kind of report/);
  assert.throws(() => ticketBody({ ...base, area: "bank" }), /where it happened/);
  const clean = ticketBody({ ...base, summary: "Line one\nline two\u0007", details: "a\r\nb\tc\u202e and more text" });
  assert.equal(clean.summary, "Line one line two"); assert.equal(clean.details, "a\nb c and more text");
});

test("small helpers: versions, weeks, systems", () => {
  assert.equal(compareVersions("1.26.0", "1.25.9"), 1); assert.equal(compareVersions("1.9.0", "1.10.0"), -1); assert.equal(compareVersions("1.26.0", "1.26.0"), 0); assert.equal(compareVersions("1.26", "1.26.0"), null);
  assert.equal(isoWeek(Date.parse("2026-11-24T12:00:00Z")), "2026-W48"); assert.equal(isoWeek(Date.parse("2027-01-01T00:00:00Z")), "2026-W53"); assert.equal(isoWeek(Date.parse("2024-12-30T00:00:00Z")), "2025-W01");
  assert.deepEqual(systemInfo({ platform: "win32", release: "10.0.26300" }), { os: "windows", osMajor: "11" });
  assert.deepEqual(systemInfo({ platform: "win32", release: "10.0.19045" }), { os: "windows", osMajor: "10" });
  assert.deepEqual(systemInfo({ platform: "darwin", systemVersion: "14.5.1" }), { os: "macos", osMajor: "14" });
  assert.deepEqual(systemInfo({ platform: "linux", release: "6.8.0-45-generic" }), { os: "linux", osMajor: null });
});

// ---------------------------------------------------------------- the scrubber
test("scrubber: file paths of every kind go, the sentence around them stays", () => {
  const rows = [
    ["Crash at C:\\Users\\John Smith\\AppData\\Roaming\\Backstage Forever\\state.json when I opened it", "Crash at [path] when I opened it"],
    ["open 'F:\\WorldofWarcraft\\World of Warcraft\\_forever_\\WTF\\Account\\FRANKACCOUNT\\SavedVariables\\BackstageForever.lua' failed", "open '[path]' failed"],
    ["d:/games/wow/Interface/AddOns/x.lua:12: bad", "[path]:12: bad"],
    ["look in \\\\NAS01\\share\\wow\\WTF please", "look in [path] please"],
    ["see file:///C:/Users/bob/Desktop/log.html now", "see [path] now"],
    ["file:///home/anna/.config/Backstage%20Forever/state.json", "[path]"],
    ["it is in /Users/anna/Library/Application Support/Backstage Forever/state.json I think", "it is in [path] I think"],
    ["config at ~/.config/Backstage Forever/settings.json is empty", "config at [path] is empty"],
    ["path=/var/log/syslog,", "path=[path],"],
    ["the AppImage in /opt/games/bf/BackstageForever.AppImage", "the AppImage in [path]"],
    ["under Users\\johnsmith\\Documents", "under [path]"],
    ["Documents and Settings\\bob\\x", "[path]"],
  ];
  for (const [input, want] of rows) assert.equal(scrub(input).text, want, input);
  assert.equal(scrub("C:\\a\\b.txt and D:\\c\\d.txt").removed, 2);
});

test("scrubber: e-mail addresses, network addresses and long tokens go; versions, builds, times and commands stay", () => {
  const rows = [
    ["mail bob.k+wow@example.co.uk please", "mail [email] please"],
    ["my ip is 192.168.1.20 and 8.8.8.8:443", "my ip is [address] and [address]"],
    ["v6 fe80::1ff:fe23:4567:890a and 2001:0db8:85a3:0000:0000:8a2e:0370:7334 and ::1", "v6 [address] and [address] and [address]"],
    ["mac 00:1A:2B:3C:4D:5E", "mac [address]"],
    ["id 3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", "id [token]"],
    ["key sk-abcdEFGH1234567890abcd", "key [token]"],
    ["hash deadbeefdeadbeefdeadbeefdeadbeef", "hash [token]"],
    ["A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v", "[token]"],
    ["Authorization: Bearer abc.DEF-123_xyz456", "Authorization: [token]"],
    ["dGhpcyBpcyBhIGxvbmcgYmFzZTY0IHN0cmluZyB3aXRoIHBhZGRpbmc9PQ==", "[token]"],
  ];
  for (const [input, want] of rows) assert.equal(scrub(input).text, want, input);
  for (const keep of ["build 1.60.1.71037 with app 1.26.0 at 12:30:45", "type /bf reports and/or /bf help", "50/50 chance, 3/8 kills, 24/11/2026", "at f (app.js:10:3)", "BF-1042 is fixed", "TypeError: Cannot read properties of undefined (reading 'map')",
    "https://github.com/farena-ai/Backstage-Forever/releases", "Die Desktop-App zeigt den Quest-Log nicht", "Alt-Tab, Shift-Click and Ctrl-C", "level 60 Night-elf hunter"]) {
    assert.deepEqual(scrub(keep), { text: keep, removed: 0 }, keep);
  }
});

test("scrubber: names the app knows and anything shaped like Name-Realm go", () => {
  const names = NAMES();
  assert.ok(["Thrallson", "Draenor", "Night Watch", "Zugzug", "Thunder Hold", "FRANKACCOUNT", "johnsmith"].every((n) => names.includes(n)));
  const rows = [
    ["Thrallson could not train", "[name] could not train"],
    ["on thrallson-draenor and ZUGZUG", "on [name]-[name] and [name]"],
    ["my guild Night Watch on Thunder Hold (ThunderHold)", "my guild [name] on [name] ([name])"],
    ["account folder FRANKACCOUNT, windows user johnsmith", "account folder [name], windows user [name]"],
    ["Überflieger-Blackrock sagt das auch", "[name] sagt das auch"],
    ["whisper Leeroy-Stormrage or Ana-Kul'Tiras", "whisper [name] or [name]"],
    ["Zugzugs axe", "Zugzugs axe"], // part of another word: not the name
  ];
  for (const [input, want] of rows) assert.equal(scrub(input, { names }).text, want, input);
  const r = scrub("Thrallson at C:\\Users\\johnsmith\\x.txt wrote to a@b.io", { names });
  assert.deepEqual(r, { text: "[name] at [path] wrote to [email]", removed: 3 });
  assert.deepEqual(scrub(null), { text: "", removed: 0 });
  assert.deepEqual(knownNames([{ name: "A" }, { name: 7 }, null], ["", "x".repeat(80)]), [], "too short, too long or not text: ignored");
});

test("scrubber: stack lines keep the file name and lose every folder", () => {
  const stack = "TypeError: boom\n    at open (C:\\Users\\johnsmith\\AppData\\Local\\Programs\\Backstage Forever\\resources\\app.asar\\src\\core\\desk.cjs:10:3)\n    at file:///C:/Program%20Files/Backstage%20Forever/resources/app.asar/src/renderer/app.js:5:1\n    at /home/johnsmith/bf/src/main.cjs:7:7\n    at node:internal/process/task_queues:95:5\n    at async Promise.all (index 0)\n" + "    at deep (x.js:1:1)\n".repeat(20);
  const lines = scrubStack(stack, { names: NAMES() });
  assert.deepEqual(lines.slice(0, 5), ["at open (desk.cjs:10:3)", "at app.js:5:1", "at main.cjs:7:7", "at task_queues:95:5", "at async Promise.all (index 0)"]);
  assert.equal(lines.length, 12);
  assert.deepEqual(leaks(lines), []);
});

// ---------------------------------------------------------------- heartbeat
test("startup sends a check-in at one minute, keeps the daily limit, and honors opt-out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const active = setup();
  const optedOut = setup();
  optedOut.desk.setSettings({ statistics: false });
  active.desk.start();
  optedOut.desk.start();
  t.after(() => { active.desk.stop(); optedOut.desk.stop(); });

  async function advance(ms) {
    active.clock.advance(ms);
    optedOut.clock.advance(ms);
    t.mock.timers.tick(ms);
    await new Promise(setImmediate);
  }
  const requests = (fixture) => fixture.fake.requests("/v1/heartbeat").length;
  await advance(59_999);
  assert.equal(requests(active), 0);
  await advance(1);
  assert.equal(requests(active), 1, "the scheduled check-in reaches the server at one minute");
  assert.equal(requests(optedOut), 0);
  await advance(600_000);
  assert.equal(requests(active), 1, "periodic work does not send a second check-in today");
  assert.equal(requests(optedOut), 0);

  const restarted = setup({ dir: active.dir, fake: active.fake, at: new Date(active.clock.now()).toISOString() });
  restarted.desk.start();
  t.after(() => restarted.desk.stop());
  restarted.clock.advance(60_000);
  await advance(60_000);
  assert.equal(requests(active), 1, "restarting on the same UTC day preserves the limit");
  active.clock.set("2026-11-25T00:10:00Z");
  optedOut.clock.set("2026-11-25T00:10:00Z");
  await advance(600_000);
  assert.equal(requests(active), 2, "an open app can check in the following UTC day");
  assert.equal(requests(optedOut), 0);
});

test("heartbeat: at most once per UTC day, with today's areas, and the first-seen week is remembered", async () => {
  const { desk, fake, clock, dir } = setup();
  desk.visit({ route: "talents", lang: "de" }); desk.visit({ route: "world-map", lang: "de" }); desk.visit({ route: "privacy", lang: "de" }); desk.visit({ route: "../etc", lang: "de" });
  assert.deepEqual(desk.nextHeartbeat(), desk.status().heartbeat, "Settings shows the very body that is sent");
  assert.equal((await desk.heartbeat()).status, "sent");
  assert.equal((await desk.heartbeat()).status, "sent-today");
  clock.advance(11 * 60 * 60 * 1000); // 23:00 the same UTC day
  await desk.tick();
  assert.equal(fake.requests("/v1/heartbeat").length, 1);
  const sent = fake.heartbeats[0];
  assert.deepEqual(sent.areas, ["map", "talents"]); assert.equal(sent.lang, "de"); assert.equal(sent.firstSeenWeek, "2026-W48"); assert.equal(sent.build, "1.60.1.71037");
  assert.deepEqual(sent.flags, { gameConnected: true, addonInstalled: true, liveLink: false, sharing: true });
  clock.advance(2 * 60 * 60 * 1000); // the next UTC day
  desk.visit({ route: "now", lang: "de" });
  assert.equal((await desk.heartbeat()).status, "sent");
  assert.deepEqual(fake.heartbeats[1].areas, ["now"], "yesterday's areas are gone");
  // A restart keeps the day and the first week; the areas were never written to disk.
  const saved = fs.readFileSync(path.join(dir, "desk", "state.json"), "utf8");
  assert.doesNotMatch(saved, /talents|"now"|areas/);
  clock.advance(8 * 24 * 60 * 60 * 1000);
  const again = setup({ dir, fake, at: new Date(clock.now()).toISOString() });
  await again.desk.heartbeat();
  assert.equal(fake.heartbeats[2].firstSeenWeek, "2026-W48"); assert.deepEqual(fake.heartbeats[2].areas, []);
  assertNoLeak(fake);
});

test("heartbeat: an outage waits and retries; the service saying no (400) is not retried that day", async () => {
  const { desk, fake, clock } = setup();
  fake.setDown(true);
  assert.equal((await desk.heartbeat()).status, "offline");
  assert.equal((await desk.heartbeat()).status, "waiting", "inside the backoff nothing is sent");
  assert.equal(fake.requests("/v1/heartbeat").length, 1);
  fake.setDown(false); clock.advance(61 * 1000);
  assert.equal((await desk.heartbeat()).status, "sent");
  const b = setup();
  b.fake.setRespond(({ route }) => (route === "/v1/heartbeat" ? { status: 400, body: { ok: false, error: "invalid" }, headers: {} } : null));
  assert.equal((await b.desk.heartbeat()).status, "rejected");
  assert.equal((await b.desk.heartbeat()).status, "sent-today");
});

// ---------------------------------------------------------------- switches
test("switches off: no request of any kind leaves", async () => {
  const { desk, community, fake, clock } = setup();
  community.setSettings({ share: false, download: false });
  desk.setSettings({ statistics: false, errors: false });
  desk.visit({ route: "talents", lang: "en" });
  desk.captureError("main", new TypeError("boom"));
  for (let i = 0; i < 30; i++) { clock.advance(60 * 60 * 1000); await desk.tick(); await community.submit({ force: true }); await community.refreshPack({ force: true }); }
  assert.deepEqual(fake.log, [], "the fake service saw nothing");
  assert.equal((await desk.heartbeat()).status, "off"); assert.equal((await desk.sync({ force: true })).status, "none"); assert.equal((await desk.refreshAnnouncements({ force: true })).status, "off");
  // Statistics on again: exactly one heartbeat, nothing else.
  desk.setSettings({ statistics: true });
  await desk.tick();
  assert.deepEqual(fake.log.map((c) => c.route), ["/v1/heartbeat"]);
});

test("each switch works on its own, and a choice survives a restart", async () => {
  const a = setup();
  assert.deepEqual([a.desk.status().statistics, a.desk.status().errors, a.desk.status().notify], [STATISTICS_DEFAULT, false, false]);
  a.desk.setSettings({ statistics: false });
  const b = setup({ dir: a.dir, fake: a.fake });
  assert.equal(b.desk.status().statistics, false);
  b.desk.setSettings({ errors: true, notify: true });
  const c = setup({ dir: a.dir, fake: a.fake });
  assert.deepEqual([c.desk.status().statistics, c.desk.status().errors, c.desk.status().notify], [false, true, true]);
  for (const bad of [null, [], {}, { statistics: "yes" }, { share: true }, { statistics: true, other: true }]) assert.throws(() => c.desk.setSettings(bad), /Invalid privacy settings/);
});

// ---------------------------------------------------------------- error reports
test("error reports: only when switched on, scrubbed, once per error per session and a few per day", async () => {
  const { desk, fake, clock } = setup();
  const boom = () => { const e = new TypeError("Cannot open C:\\Users\\johnsmith\\AppData\\x.json for Thrallson-Draenor (bob@example.com)"); e.stack = `TypeError: x\n    at load (C:\\Users\\johnsmith\\app\\src\\core\\store.cjs:12:5)\n    at run (C:\\Users\\johnsmith\\app\\src\\main.cjs:99:1)`; return e; };
  assert.equal(desk.captureError("main", boom()).status, "off");
  assert.deepEqual(fake.log, []);
  assert.equal(desk.diagnostics().lastError, "TypeError: Cannot open [path] for [name]-[name] ([email])", "kept, scrubbed, for a report the player may write");
  desk.setSettings({ errors: true });
  const first = desk.captureError("main", boom());
  assert.equal(first.status, "sending"); assert.equal(await first.done, "sent");
  assert.equal(desk.captureError("main", boom()).status, "duplicate");
  assert.deepEqual(fake.errors, [{ schema: 1, installId: desk.installId, appVersion: "1.26.0", os: "windows", osMajor: "11", lang: "en", where: "main", name: "TypeError",
    message: "Cannot open [path] for [name]-[name] ([email])", stack: ["at load (store.cjs:12:5)", "at run (main.cjs:99:1)"] }]);
  // Different errors: one a minute, five a day.
  const other = (n) => { const e = new RangeError("r" + n); e.stack = `RangeError\n    at f${n} (a.js:${n}:1)`; return e; };
  assert.equal(desk.captureError("renderer", other(1)).status, "limited", "not within a minute of the last one");
  for (let n = 2; n <= 5; n++) { clock.advance(61 * 1000); assert.equal(desk.captureError("renderer", other(n)).status, "sending"); }
  clock.advance(61 * 1000);
  assert.equal(desk.captureError("renderer", other(6)).status, "limited", "five a day");
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.requests("/v1/errors").length, 5);
  clock.advance(24 * 60 * 60 * 1000);
  assert.equal(desk.captureError("renderer", other(7)).status, "sending");
  assertNoLeak(fake);
});

test("errors are captured where the app already handles them, with no new global handlers", () => {
  const main = read("src/main.cjs"), app = read("src/renderer/app.js");
  assert.match(main, /desk\?\.captureError\("main", e\)/);
  assert.match(app, /DeskView\?\.caught\(error, error\?\.message\)/);
  for (const src of [main, app, read("src/renderer/desk.js"), read("src/core/desk.cjs"), read("src/preload.cjs")]) {
    assert.doesNotMatch(src, /uncaughtException|unhandledRejection|unhandledrejection|window\.onerror|addEventListener\("error"/);
  }
});

// ---------------------------------------------------------------- tickets
test("a report: preview is what is sent, the key stays inside, and the ticket is stored", async () => {
  const { desk, fake, dir, changes } = setup();
  desk.visit({ route: "talents", lang: "en" });
  desk.noteError("Could not read C:\\Users\\johnsmith\\x.lua");
  const input = { ...REPORT, details: "Thrallson-Draenor opened Talents; see C:\\Users\\johnsmith\\shot.png. Mail me: john@example.com" };
  const preview = desk.reportPreview(input);
  assert.equal(preview.problem, null); assert.equal(preview.removed, 4);
  assert.equal(preview.body.details, "[name]-[name] opened Talents; see [path]. Mail me: [email]");
  assert.deepEqual(preview.body.diagnostics, { screen: "talents", lastError: "Could not read [path]", gameConnected: true, addonInstalled: true });
  const r = await desk.sendReport(input);
  assert.deepEqual(r, { sent: true, ticket: "BF-1042" });
  assert.deepEqual(fake.requests("/v1/tickets")[0].body, preview.body, "the body shown is the body sent");
  const view = desk.tickets();
  assert.deepEqual(view.tickets.map((t) => [t.ticket, t.status, t.unread, t.summary]), [["BF-1042", "new", 0, "Planner shows the wrong tree"]]);
  const key = fake.tickets.get("BF-1042").key;
  assert.doesNotMatch(JSON.stringify([r, view, desk.status(), changes]), new RegExp(key), "the key is never handed to a screen");
  assert.match(fs.readFileSync(path.join(dir, "desk", "state.json"), "utf8"), new RegExp(key), "it is kept in the app's own data folder");
  // Without diagnostics, and with the player's text left as written.
  const plain = desk.reportPreview({ ...input, diagnostics: false, scrub: false });
  assert.equal(plain.body.diagnostics, null); assert.equal(plain.removed, 0); assert.match(plain.body.details, /john@example\.com/);
  // Text that does not fit yet still previews, with the reason in plain words, and is not sent.
  const short = desk.reportPreview({ ...REPORT, summary: "abc" });
  assert.match(short.problem, /at least 5/); assert.equal(short.body.summary, "abc");
  await assert.rejects(() => desk.sendReport({ ...REPORT, summary: "abc" }), /at least 5/);
  assert.equal(fake.requests("/v1/tickets").length, 1);
});

test("conversation, reply, statuses and “fixed in the version you are running”", async () => {
  const { desk, fake, clock, notified } = setup({ appVersion: "1.26.0" });
  await desk.sendReport(REPORT);
  assert.equal((await desk.sync({ force: true })).fresh, 0);
  fake.teamReply("BF-1042", "Which class were you on?", "question");
  clock.advance(D.SYNC_EVERY + 1000);
  assert.deepEqual(await desk.sync(), { status: "synced", fresh: 1 });
  assert.deepEqual(notified, [], "no desktop notification unless the player switched it on");
  assert.equal(desk.unread(), 1);
  assert.deepEqual(desk.tickets().tickets.map((t) => [t.status, t.unread]), [["question", 1]]);
  const c = await desk.conversation("BF-1042");
  assert.deepEqual(c.messages.map((m) => [m.id, m.from, m.text]), [[1, "player", REPORT.details], [2, "team", "Which class were you on?"]]);
  assert.equal(desk.unread(), 0, "opening it marks it read");
  assert.equal(fake.requests(/^\/v1\/tickets\/BF-1042$/)[0].headers["x-bf-ticket-key"], fake.tickets.get("BF-1042").key);
  assert.deepEqual(await desk.reply({ ticket: "BF-1042", text: "A mage, Thrallson-Draenor" }), { sent: true, status: "question" });
  assert.equal(fake.tickets.get("BF-1042").messages.at(-1).text, "A mage, [name]-[name]");
  await assert.rejects(() => desk.reply({ ticket: "BF-1042", text: "   " }), /Write your reply first/);
  // Read replies do not count again at the next sync.
  clock.advance(D.SYNC_EVERY + 1000);
  assert.equal((await desk.sync()).fresh, 0);
  // Fixed in a version: newer than this app, then this app, then older.
  desk.setSettings({ notify: true });
  for (const [fixedIn, here] of [["1.27.0", false], ["1.26.0", true], ["1.9.9", true]]) {
    fake.setStatus("BF-1042", "fixed", fixedIn);
    await desk.sync({ force: true });
    const t = desk.tickets().tickets[0];
    assert.deepEqual([t.status, t.fixedIn, t.fixedHere], ["fixed", fixedIn, here], fixedIn);
  }
  // A reply to a fixed ticket opens it again; a desktop notification comes only with the switch on.
  assert.equal((await desk.reply({ ticket: "BF-1042", text: "Still wrong for me." })).status, "looking");
  fake.teamReply("BF-1042", "Thanks, looking again.", "looking");
  await desk.sync({ force: true });
  assert.deepEqual(notified, [1]);
});

test("sync: at start and every three hours while a ticket is open, never without tickets, and it stops when all are closed", async () => {
  const { desk, fake, clock } = setup();
  desk.setSettings({ statistics: false }); desk.community.setSettings({ download: false });
  await desk.tick(); await desk.tick();
  assert.deepEqual(fake.log, [], "no tickets: nothing to ask");
  await desk.sendReport(REPORT);
  const count = () => fake.requests("/v1/tickets/sync").length;
  await desk.tick();
  assert.equal(count(), 0, "a ticket just sent waits for the next round");
  clock.advance(D.SYNC_EVERY + 1000); await desk.tick(); assert.equal(count(), 1);
  clock.advance(60 * 60 * 1000); await desk.tick(); assert.equal(count(), 1, "not before three hours");
  clock.advance(2 * 60 * 60 * 1000 + 1000); await desk.tick(); assert.equal(count(), 2);
  assert.deepEqual(fake.requests("/v1/tickets/sync")[1].body, { schema: 1, tickets: [{ ticket: "BF-1042", key: fake.tickets.get("BF-1042").key, since: 0 }] });
  // A restart syncs at start.
  const again = setup({ dir: desk.dir.replace(/[\\/]desk$/, ""), fake, at: new Date(clock.now()).toISOString() });
  again.desk.setSettings({ statistics: false }); again.community.setSettings({ download: false });
  await again.desk.tick(); assert.equal(count(), 3);
  fake.setStatus("BF-1042", "closed");
  await again.desk.sync({ force: true }); assert.equal(count(), 4);
  again.clock.advance(D.SYNC_EVERY * 5); await again.desk.tick(); await again.desk.sync({ force: true });
  assert.equal(count(), 4, "all closed: polling stops");
  assert.equal(again.desk.tickets().tickets[0].status, "closed");
});

test("sync backs off after failures, up to an hour, and recovers", async () => {
  const { desk, fake, clock } = setup();
  await desk.sendReport(REPORT);
  clock.advance(D.SYNC_EVERY + 1000);
  fake.setDown(true);
  const count = () => fake.requests("/v1/tickets/sync").length;
  assert.equal((await desk.sync()).status, "offline"); assert.equal(count(), 1);
  assert.equal((await desk.sync()).status, "waiting"); assert.equal(count(), 1);
  clock.advance(61 * 1000); await desk.sync(); assert.equal(count(), 2);
  clock.advance(61 * 1000); assert.equal((await desk.sync()).status, "waiting", "the wait doubled");
  for (let i = 0; i < 12; i++) { clock.advance(60 * 60 * 1000 + 1000); await desk.sync(); }
  assert.ok(desk.state.backoffUntil - clock.now() <= 60 * 60 * 1000, "never more than an hour");
  fake.setDown(false); clock.advance(60 * 60 * 1000 + 1000);
  assert.equal((await desk.sync()).status, "synced");
  assert.equal(desk.state.backoffUntil, null);
  // 429 with Retry-After is honoured.
  fake.setRespond(({ route }) => (route === "/v1/tickets/sync" ? { status: 429, body: { ok: false, error: "rate_limited" }, headers: { "retry-after": "900" } } : null));
  assert.equal((await desk.sync({ force: true })).status, "rate");
  assert.ok(desk.state.backoffUntil - clock.now() >= 899 * 1000);
});

test("isolation: one install cannot read, answer or delete another's ticket, and gone tickets are removed", async () => {
  const fake = fakeDesk();
  const a = setup({ fake }), b = setup({ fake });
  await a.desk.sendReport(REPORT); await b.desk.sendReport({ ...REPORT, summary: "Another report entirely" });
  assert.deepEqual([a.desk.tickets().tickets.map((t) => t.ticket), b.desk.tickets().tickets.map((t) => t.ticket)], [["BF-1042"], ["BF-1043"]]);
  await assert.rejects(() => b.desk.conversation("BF-1042"), /no longer exists/, "B does not have that ticket at all");
  // Even if B's store named A's ticket, B's key does not open it: the service answers 404 and B drops it.
  b.desk.state.tickets.push({ ...b.desk.state.tickets[0], ticket: "BF-1042" });
  await assert.rejects(() => b.desk.conversation("BF-1042"), /no longer exists/);
  await assert.rejects(() => b.desk.reply({ ticket: "BF-1042", text: "hello" }), /no longer exists/);
  assert.equal(fake.tickets.get("BF-1042").messages.length, 1, "nothing was added to A's ticket");
  b.desk.state.tickets.push({ ...b.desk.state.tickets[0], ticket: "BF-1042" });
  await b.desk.sync({ force: true });
  assert.deepEqual(b.desk.tickets().tickets.map((t) => t.ticket), ["BF-1043"], "the service listed it as gone, so it was removed");
  assert.ok(fake.tickets.has("BF-1042"));
  // A ticket deleted on the service disappears here at the next sync.
  fake.tickets.delete("BF-1043");
  await b.desk.sync({ force: true });
  assert.deepEqual(b.desk.tickets().tickets, []);
  // Delete: removes it on the service and here.
  assert.deepEqual(await a.desk.remove("BF-1042"), { removed: true });
  assert.equal(fake.tickets.has("BF-1042"), false); assert.deepEqual(a.desk.tickets().tickets, []);
  assert.equal(fake.requests(/^\/v1\/tickets\/BF-1042$/).at(-1).method, "DELETE");
});

test("offline: a report and a reply wait in the outbox, are sent later in order, and delete stays honest", async () => {
  const { desk, fake, clock, dir } = setup();
  await desk.sendReport(REPORT);
  fake.setDown(true);
  assert.deepEqual(await desk.sendReport({ ...REPORT, summary: "Written with no connection" }), { sent: false, queued: true });
  assert.deepEqual(await desk.reply({ ticket: "BF-1042", text: "More detail, written offline." }), { sent: false, queued: true });
  await assert.rejects(() => desk.remove("BF-1042"), /could not be reached/);
  assert.equal(desk.tickets().tickets.length, 1, "a delete that did not reach the service changes nothing here");
  assert.deepEqual(desk.tickets().waiting.map((w) => [w.type, w.summary || w.ticket]), [["ticket", "Written with no connection"], ["reply", "BF-1042"]]);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "desk", "state.json"), "utf8").match(/"outbox":\[.*?\]\s*,\s*"seen"/s)[0], /installId/, "the waiting report carries no install id until it is sent");
  await desk.flushOutbox({ force: true });
  assert.equal(desk.tickets().waiting.length, 2, "still offline: still waiting");
  // A restart keeps the outbox; back online it goes out by itself.
  const again = setup({ dir, fake, at: new Date(clock.now() + 2 * 60 * 60 * 1000).toISOString() });
  fake.setDown(false);
  await again.desk.tick();
  assert.deepEqual(again.desk.tickets().waiting, []);
  assert.deepEqual(again.desk.tickets().tickets.map((t) => t.ticket), ["BF-1043", "BF-1042"]);
  assert.equal(fake.tickets.get("BF-1043").summary, "Written with no connection");
  assert.equal(fake.tickets.get("BF-1042").messages.at(-1).text, "More detail, written offline.");
  // The service refusing a waiting report for good (400) drops it instead of retrying forever.
  fake.setDown(true); await again.desk.sendReport({ ...REPORT, summary: "This one will be refused" }); fake.setDown(false);
  again.clock.advance(2 * 60 * 60 * 1000);
  fake.setRespond(({ method, route }) => (method === "POST" && route === "/v1/tickets" ? { status: 400, body: { ok: false, error: "invalid" }, headers: {} } : null));
  await again.desk.flushOutbox({ force: true });
  assert.deepEqual(again.desk.tickets().waiting, []);
  // A waiting item can be discarded by the player.
  fake.setRespond(null); fake.setDown(true);
  await again.desk.sendReport({ ...REPORT, summary: "Changed my mind about this" });
  const id = again.desk.tickets().waiting[0].id;
  assert.deepEqual(again.desk.cancelWaiting(id), { removed: true }); assert.deepEqual(again.desk.tickets().waiting, []);
});

test("“inbox full” and “blocked” are said plainly", async () => {
  const { desk, fake } = setup();
  fake.setRespond(({ route }) => (route === "/v1/tickets" ? { status: 503, body: { ok: false, error: "report_inbox_full" }, headers: {} } : null));
  await assert.rejects(() => desk.sendReport(REPORT), /inbox is full/);
  assert.deepEqual(desk.tickets().waiting, [], "not queued: the player is told instead");
  fake.setRespond(() => ({ status: 403, body: { ok: false, error: "blocked" }, headers: {} }));
  await assert.rejects(() => desk.sendReport(REPORT), /can no longer send/);
  fake.log.length = 0;
  assert.equal((await desk.heartbeat()).status, "blocked");
  assert.deepEqual(fake.log, [], "a blocked install stops asking");
});

test("Forget me: the service deletes, the local tickets go, and the install id is new", async () => {
  const { desk, community, fake } = setup();
  community.onForgot = () => desk.wipe(); // as main wires it
  await desk.sendReport(REPORT); await desk.heartbeat();
  const before = desk.installId;
  await community.forget();
  assert.deepEqual(fake.forgotten, [before]);
  assert.notEqual(desk.installId, before);
  assert.deepEqual(desk.tickets().tickets, []); assert.equal(fake.tickets.size, 0);
  assert.equal(desk.state.lastHeartbeatDay, null); assert.equal(desk.status().heartbeat.installId, desk.installId);
  assert.equal(desk.status().statistics, true, "the switches stay as they were");
  // Delete all local data wipes the Desk folder too.
  await desk.sendReport(REPORT); desk.reset();
  assert.deepEqual(desk.tickets().tickets, []);
  assert.match(read("src/main.cjs"), /community\.onForgot = \(\) => desk\.wipe\(\)/); assert.match(read("src/main.cjs"), /desk\?\.reset\(\)/); assert.match(read("src/main.cjs"), /desk\?\.stop\(\)/);
});

// ---------------------------------------------------------------- announcements
test("announcements: fetched at most hourly with ETag, shown once per id, inside their dates", async () => {
  const { desk, fake, clock } = setup();
  desk.visit({ route: "now", lang: "de" });
  fake.setAnnouncements([
    { id: 12, title: "1.25.0 has a problem", text: "Update to 1.25.1.", level: "warning", from: "2026-11-24T00:00:00Z", until: "2026-12-01T00:00:00Z", link: "https://github.com/farena-ai/Backstage-Forever/releases" },
    { id: 13, title: "Later", text: "Not yet.", level: "info", from: "2026-11-30T00:00:00Z", until: "2026-12-05T00:00:00Z", link: null },
    { id: 14, title: "Over", text: "Too late.", level: "info", from: "2026-11-01T00:00:00Z", until: "2026-11-02T00:00:00Z", link: null },
    { id: "x", title: "bad id", text: "no", level: "info", from: null, until: null, link: null },
    { id: 15, title: "x".repeat(81), text: "too long a title", level: "info", from: null, until: null, link: null },
  ]);
  assert.equal((await desk.refreshAnnouncements()).status, "updated");
  assert.equal((await desk.refreshAnnouncements()).status, "fresh");
  const calls = () => fake.requests("/v1/announcements");
  assert.equal(calls().length, 1);
  assert.equal(calls()[0].query, "?appVersion=1.26.0&os=windows&lang=de", "no install id, nothing personal");
  assert.equal(calls()[0].body, undefined);
  assert.deepEqual(desk.announcements().map((a) => a.id), [12]);
  desk.announcementSeen(12);
  assert.deepEqual(desk.announcements(), [], "once per id");
  clock.advance(D.ANNOUNCE_EVERY + 1000);
  assert.equal((await desk.refreshAnnouncements()).status, "unchanged");
  assert.equal(calls()[1].headers["if-none-match"], '"a2"');
  assert.deepEqual(desk.announcements(), []);
  clock.set("2026-11-30T06:00:00Z");
  assert.deepEqual(desk.announcements().map((a) => a.id), [13], "its start date arrived");
  // Seen ids survive a restart.
  const again = setup({ dir: desk.dir.replace(/[\\/]desk$/, ""), fake, at: "2026-11-25T00:00:00Z" });
  assert.deepEqual(again.desk.announcements(), []);
  assert.throws(() => desk.announcementSeen("12"), /Invalid/);
});

test("announcement links: only the project's GitHub repository and backstagecoding.com, over https", () => {
  for (const ok of ["https://github.com/farena-ai/Backstage-Forever", "https://github.com/farena-ai/Backstage-Forever/releases/tag/v1.25.1", "https://backstagecoding.com/backstage-forever/whats-new.html", "https://www.backstagecoding.com/", "https://bf.backstagecoding.com/status"]) assert.equal(linkAllowed(ok), true, ok);
  for (const bad of ["http://backstagecoding.com/", "https://github.com/farena-ai/Backstage-Forever-evil", "https://github.com/someone/else", "https://github.com/farena-ai", "https://backstagecoding.com.evil.io/", "https://evil.io/?u=backstagecoding.com",
    "https://user:pw@backstagecoding.com/", "https://backstagecoding.com:8443/", "javascript:alert(1)", "file:///C:/x", "https://xn--bckstagecoding-0nb.com/", "", null, 7, "https://github.com/farena-ai/Backstage-Forever/../../evil"]) assert.equal(linkAllowed(bad), false, String(bad));
  assert.equal(validAnnouncement({ id: 1, title: "t", text: "x", level: "info", from: null, until: null, link: "https://evil.io/" }).link, null, "the message stays, the link goes");
  const { desk } = setup();
  desk.state.announcements = [validAnnouncement({ id: 3, title: "t", text: "x", level: "info", link: "https://backstagecoding.com/a" }), { id: 4, title: "t", text: "x", level: "info", from: null, until: null, link: "https://evil.io/" }];
  assert.equal(desk.announcementLink(3), "https://backstagecoding.com/a");
  assert.equal(desk.announcementLink(4), null, "checked again right before opening");
  assert.equal(desk.announcementLink(99), null);
});

// ---------------------------------------------------------------- IPC
test("IPC: exact shapes only, keys never cross the bridge, and the preload exposes the calls", async () => {
  const { desk, fake } = setup();
  const handlers = {}; let confirm = false; const opened = [];
  registerDeskHandlers({ handle: (name, fn) => { handlers[name] = fn; }, desk, confirmForget: async () => confirm, forget: () => desk.community.forget(), openExternal: async (l) => { opened.push(l); } });
  assert.deepEqual(Object.keys(handlers).sort(), ["deskAnnouncementOpen", "deskAnnouncementSeen", "deskAnnouncements", "deskCancelWaiting", "deskDelete", "deskForget", "deskRendererError", "deskReply", "deskReportPreview", "deskReportSend", "deskSetSettings", "deskStatus", "deskSync", "deskTicket", "deskTickets", "deskVisit"]);
  const throws = (name, ...args) => assert.throws(() => handlers[name](...args), /Invalid/, `${name} ${JSON.stringify(args)}`);
  throws("deskStatus", 1);
  for (const bad of [[], [null], [{}], [{ statistics: 1 }], [{ share: true }], [{ statistics: true }, 2]]) throws("deskSetSettings", ...bad);
  for (const bad of [[], [{ route: "talents" }], [{ route: "Talents", lang: "en" }], [{ route: "../x", lang: "en" }], [{ route: "talents", lang: "xx" }], [{ route: "talents", lang: "en", name: "Thrallson" }]]) throws("deskVisit", ...bad);
  for (const name of ["deskReportPreview", "deskReportSend"]) {
    for (const bad of [[], [null], [{ ...REPORT, kind: "crash" }], [{ ...REPORT, area: "bank" }], [{ ...REPORT, frequency: "weekly" }], [{ ...REPORT, summary: 5 }], [{ ...REPORT, details: "x".repeat(20001) }], [{ ...REPORT, installId: "x" }], [{ ...REPORT, diagnostics: { screen: "x" } }], [{ ...REPORT, scrub: "no" }], [REPORT, 1]]) throws(name, ...bad);
  }
  for (const bad of [[], ["BF-"], ["1042"], ["BF-1042; DROP"], [{ ticket: "BF-1042" }]]) { throws("deskTicket", ...bad); throws("deskDelete", ...bad); }
  for (const bad of [[], [{ ticket: "BF-1042" }], [{ ticket: "x", text: "hi" }], [{ ticket: "BF-1042", text: 5 }], [{ ticket: "BF-1042", text: "hi", key: "k" }]]) throws("deskReply", ...bad);
  for (const bad of [[], ["12"], [0], [1.5]]) { throws("deskAnnouncementSeen", ...bad); assert.rejects(() => handlers.deskAnnouncementOpen(...bad), /Invalid/); }
  for (const bad of [[], [{}], [{ message: 5 }], [{ message: "x", extra: 1 }], [{ message: "x".repeat(4001) }]]) throws("deskRendererError", ...bad);
  throws("deskCancelWaiting", "nope");
  // The happy paths, through the bridge.
  assert.equal(handlers.deskVisit({ route: "talents", lang: "en" }), true);
  const preview = handlers.deskReportPreview({ ...REPORT });
  const sent = await handlers.deskReportSend({ ...REPORT });
  assert.equal(sent.ticket, "BF-1042");
  assert.deepEqual(fake.requests("/v1/tickets")[0].body, preview.body);
  fake.teamReply("BF-1042", "Hello from the team");
  const all = [await handlers.deskSync(), await handlers.deskTicket("BF-1042"), await handlers.deskReply({ ticket: "BF-1042", text: "Thank you" }), handlers.deskTickets(), handlers.deskStatus()];
  assert.doesNotMatch(JSON.stringify(all), new RegExp(fake.tickets.get("BF-1042").key));
  assert.equal(JSON.stringify(all).includes('"key"'), false);
  assert.deepEqual(handlers.deskRendererError({ message: "It broke at C:\\Users\\johnsmith\\x", shown: true }), { status: "noted" });
  assert.equal(desk.diagnostics().lastError, "It broke at [path]");
  assert.deepEqual(handlers.deskRendererError({ name: "TypeError", message: "x is undefined", stack: "TypeError\n    at a (app.js:1:1)" }), { status: "off" });
  // An announcement link opens only if it is a current, allowed one.
  desk.state.announcements = [validAnnouncement({ id: 3, title: "t", text: "x", level: "info", link: "https://backstagecoding.com/a" }), validAnnouncement({ id: 4, title: "t", text: "x", level: "info", link: null })];
  await handlers.deskAnnouncementOpen(3); assert.deepEqual(opened, ["https://backstagecoding.com/a"]);
  await assert.rejects(() => handlers.deskAnnouncementOpen(4), /Invalid/);
  // Forget me asks first.
  assert.equal((await handlers.deskForget()).cancelled, true); assert.deepEqual(fake.forgotten, []);
  confirm = true; await handlers.deskForget(); assert.equal(fake.forgotten.length, 1);
  const preload = read("src/preload.cjs"), main = read("src/main.cjs");
  for (const name of Object.keys(handlers)) assert.match(preload, new RegExp(`${name}: \\(`), name);
  assert.match(preload, /onDeskChanged/);
  assert.match(main, /name\.startsWith\("desk"\) && e\?\.name === "DeskError"/);
});

test("ticket keys are never logged or put in a message, and travel only in the header and the sync body", async () => {
  const { desk, community, fake } = setup();
  await desk.sendReport(REPORT);
  fake.teamReply("BF-1042", "hi");
  await desk.sync({ force: true }); await desk.conversation("BF-1042"); await desk.reply({ ticket: "BF-1042", text: "ok then" });
  const key = fake.tickets.get("BF-1042").key;
  assert.doesNotMatch(community.lines.join("\n"), new RegExp(key));
  for (const call of fake.log) {
    assert.equal(call.route.includes(key) || call.query.includes(key), false, "never in a URL");
    if (call.route === "/v1/tickets/sync") continue;
    assert.equal((call.raw || "").includes(key), false, `${call.route}: not in a body`);
  }
  assert.doesNotMatch(read("src/core/desk.cjs"), /console\.|\.log\(/, "Desk logs nothing");
  assertNoLeak(fake);
});

// ---------------------------------------------------------------- hand-off, wording, wiring
test("the hand-off carries the unread count only when there is one, and /bf reports says it", () => {
  const handoff = require("../src/core/desktop-handoff.cjs");
  assert.equal(handoff.compile({ reports: 0 }), handoff.EMPTY); assert.equal(handoff.compile({ reports: -3 }), handoff.EMPTY); assert.equal(handoff.compile({ reports: "2" }), handoff.EMPTY);
  assert.match(handoff.compile({ reports: 2 }), /^BackstageForeverDesktopData=\{schema=1,reports=2,characters=\{$/m);
  assert.match(handoff.compile({ reports: 5000 }), /reports=999,/);
  assert.match(read("src/main.cjs"), /compile\(\{ profiles, reports: desk\?\.unread\(\) \|\| 0,/);
  const { spawnSync } = require("node:child_process");
  const lua = `local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
dofile('addon/BackstageForever/BackstageForeverAnswers.lua')
assert(BackstageForeverReportsLine(nil):find('No replies',1,true))
assert(BackstageForeverReportsLine({schema=1,characters={}}):find('No replies',1,true))
assert(BackstageForeverReportsLine({schema=1,reports=0}):find('No replies',1,true))
assert(BackstageForeverReportsLine({schema=2,reports=4}):find('No replies',1,true),'another schema is not read')
assert(BackstageForeverReportsLine({schema=1,reports='3'}):find('No replies',1,true))
assert(BackstageForeverReportsLine({schema=1,reports=1})=='1 reply is waiting in the desktop app. Open Help there, then My reports.')
assert(BackstageForeverReportsLine({schema=1,reports=2})=='2 replies are waiting in the desktop app. Open Help there, then My reports.')
assert(BackstageForeverReportsLine({schema=1,reports=12345.7}):find('^999 replies'))
BackstageForeverDesktopData={schema=1,reports=3,characters={}}
BackstageForeverReportsCommand('reports')
assert(#said==1 and said[1]=='Backstage Forever: 3 replies are waiting in the desktop app. Open Help there, then My reports.',said[1])
BackstageForeverTr=function(s) return (s:gsub('^(%d+) replies are waiting in the desktop app%. Open Help there, then My reports%.$','%1 Antworten warten')) end
assert(BackstageForeverReportsLine({schema=1,reports=2})=='2 Antworten warten')
print('ok')`;
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: lua, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), "ok");
});

test("the privacy wording lives in one place and lists every field of the contract", () => {
  assert.equal(W.SUMMARY, "Your characters stay on your computer. The app shares only what the live map needs and anonymous statistics that help improve it, with no account, character or realm names and no files. Reports are sent only when you write one. Each of these has its own off switch.");
  assert.equal(W.SWITCHES.share.text, "Herb and ore spots, NPC places, vendor stock and drops you come across are added to the shared map. They carry no account, character or realm name.");
  assert.equal(W.SWITCHES.statistics.text, "Once a day the app sends its version, your operating system family, your language, the game build, and which main areas you opened. Nothing about your account or your game is included: no account, character, realm or guild names, no files, no chat. It is only counted with other installs to improve the software, and it cannot be tied back to you.");
  assert.equal(W.SWITCHES.errors.text, "When something breaks, send the error message with file paths removed, so it can be fixed.");
  assert.deepEqual([W.SWITCHES.share.label, W.SWITCHES.statistics.label, W.SWITCHES.errors.label, W.BUTTONS.see, W.BUTTONS.forget], ["Share map discoveries", "Send anonymous usage statistics", "Send automatic error reports", "See exactly what is sent", "Forget me"]);
  // Every field the builders can send has a plain-words row, and no row names a field that is not sent.
  const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [`${pre}${k}`]));
  const id = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
  const listed = (name) => W.FIELDS[name].map(([k]) => k).sort();
  assert.deepEqual(listed("statistics"), flat(heartbeatBody({ installId: id })).filter((k) => k !== "schema").sort());
  assert.deepEqual(listed("report"), flat(ticketBody({ installId: id, kind: "bug", area: "map", summary: "abcde", details: "abcdefghij", expected: "", diagnostics: {} })).filter((k) => k !== "schema").sort());
  assert.deepEqual(listed("errors"), flat(errorBody({ installId: id })).filter((k) => k !== "schema").sort());
  assert.deepEqual(listed("replies"), ["key", "since", "text", "ticket"]);
  assert.deepEqual(listed("messages"), ["appVersion", "lang", "os"]);
  // The app's screens take their sentences from that one file.
  const desk = read("src/renderer/desk.js");
  assert.match(desk, /W\.SWITCHES\[key\]/); assert.match(desk, /W\.SUMMARY/); assert.match(desk, /W\.BUTTONS\.see/); assert.match(desk, /W\.BUTTONS\.forget/);
  assert.doesNotMatch(desk, /Once a day the app sends/, "not repeated in the screen code");
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf('<script src="privacy-wording.js"></script>') < html.indexOf('<script src="desk.js"></script>'));
  assert.match(html, /href="desk\.css"/); assert.match(html, /<div id="desk-dock"><\/div>/);
});

test("the screens are reachable: two Help tabs, one Settings tab, and no new top-level section", () => {
  const nav = read("src/renderer/player-navigation.js"), app = read("src/renderer/app.js");
  assert.match(nav, /\["report", "Report a problem"\], \["reports", "My reports"\]/);
  assert.match(nav, /\["privacy", "Privacy & sharing"\]/);
  assert.equal(nav.match(/const primary = Object\.freeze\(\[([^]*?)\]\);/)[1].match(/\["/g).length, 8, "the rail keeps its eight sections");
  assert.match(app, /report: \(\) => DeskView\.reportPage\(\), reports: \(\) => DeskView\.inboxPage\(\), privacy: \(\) => DeskView\.privacyPage\(\)/);
  assert.match(app, /DeskView\?\.mounted\(\);/); assert.match(app, /DeskView\.reportThis\(message\)/);
  const routes = read("scripts/player-navigation.cjs");
  for (const r of ['privacy: ["Settings", "Privacy & sharing"]', 'report: ["Help", "Report a problem"]', 'reports: ["Help", "My reports"]']) assert.ok(routes.includes(r), r);
  // The old one-way form is gone from the screen; its endpoint and IPC stay for older behaviour.
  const community = read("src/renderer/community.js");
  assert.doesNotMatch(community, /communityReport\(/); assert.match(community, /data-nav="report"/);
  assert.match(read("src/core/community.cjs"), /\/v1\/report/);
});

test("truthful wording: the README, the security and privacy notes and the app say what is shared, and nothing claims the opposite", () => {
  // Markdown cannot read the shared file, so these three repeat the approved statement by hand; this keeps them in step.
  for (const file of ["README.md", "SECURITY.md", "docs/PRIVACY.md"]) assert.ok(read(file).replace(/\r\n/g, "\n").includes(W.SUMMARY), `${file} carries the approved statement`);
  assert.match(read("src/renderer/app.js"), /data-guide-privacy><strong>What the app shares\.<\/strong> <span>\$\{esc\(window\.PrivacyWording\?\.SUMMARY\)\}<\/span>/, "the Field guide shows it from the shared file");
  for (const file of ["README.md", "SECURITY.md", "CONTRIBUTING.md", "docs/PRIVACY.md", "docs/DISTRIBUTION.md", "docs/SUPPORT-AND-RECOVERY.md", "site/content.cjs", "site/index.template.html", "scripts/build-site.cjs"]) {
    assert.doesNotMatch(read(file), /no telemetry|There is no telemetry|Nothing else is sent anywhere|Nothing leaves the computer unless|Everything stays on your PC|never sends anything anywhere|has no project-operated backend|are never uploaded\. No account/i, file);
  }
  for (const file of ["README.md", "docs/PRIVACY.md"]) {
    const text = read(file);
    for (const fact of [/made at random/, /scrambled form/, /IP addresses are not stored/, /Forget me/, /privacy\.html/, /Settings → Privacy & sharing/]) assert.match(text, fact, `${file}: ${fact}`);
  }
  // German, French and Spanish follow the approved English for every sentence of the privacy screen.
  for (const lang of ["de", "fr", "es"]) {
    const dict = JSON.parse(read(`data/i18n/${lang}.json`)).app;
    for (const en of [W.SUMMARY, ...Object.values(W.SWITCHES).flatMap((s) => [s.label, s.text]), W.BUTTONS.see, W.BUTTONS.forget, W.REPORTS, ...W.NEVER, ...W.INSTALL_ID]) {
      assert.ok(typeof dict[en] === "string" && dict[en].trim() && dict[en] !== en, `${lang}: ${en.slice(0, 50)}`);
    }
  }
});

test("a development or test run sends nothing by itself; what the player does by hand still works", async () => {
  const fake = fakeDesk();
  const dir = tmp();
  const community = new CommunityService({ dir, getProfiles: profiles, appVersion: "1.26.0", baseUrl: "https://bf.example.test", fetch: fake.fetch });
  community.setSettings({ share: false, download: true });
  const desk = new DeskService({ dir, community, appVersion: "1.26.0", channel: "dev", system: { os: "windows", osMajor: "11" }, getFacts: () => ({}), getNames: NAMES, automatic: false });
  desk.setSettings({ errors: true });
  desk.startedAt -= D.HEARTBEAT_AFTER * 2;
  await desk.tick();
  assert.equal(desk.captureError("main", new TypeError("boom")).status, "off");
  assert.equal((await desk.refreshAnnouncements({ force: true })).status, "off");
  assert.deepEqual(fake.log, [], "nothing automatic");
  assert.deepEqual(await desk.sendReport(REPORT), { sent: true, ticket: "BF-1042" });
  await desk.tick();
  assert.deepEqual(fake.log.map((c) => c.route), ["/v1/tickets"], "no polling either");
  assert.equal((await desk.sync({ force: true })).status, "synced", "Check for replies still works");
  assert.match(read("src/main.cjs"), /automatic: app\.isPackaged \|\| Boolean\(process\.env\.BF_COMMUNITY_URL\)/);
});
