"use strict";
// 1.27: pack format minor 1 in the app. Seen days and freshness, NPC names from the community,
// vendor stock out, exact "from you" marks through POST /v1/mine, and the privacy allow-lists.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const C = require("../src/core/community.cjs");
const W = require("../src/core/world-map.cjs");
const { CommunityService, collectObservations, validatePack, indexPack, daysSince, validateMine, mineKey } = C;
const { validatePack: oldAppValidatePack } = require("../community-server/test/fixtures/app-1.26-validate-pack");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-community-fresh-"));
const NOW = Date.parse("2026-11-24T12:00:00Z");
const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { const call = { url, route: new URL(url).pathname + new URL(url).search, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }; calls.push(call); return handler(call); };
  fn.calls = calls;
  return fn;
}
// A character with everything private filled in, so the tests can prove none of it is sent.
const GUID = "Player-4184-0A1B2C3D";
function profile(over = {}) {
  const build = "1.60.1.71037";
  return {
    id: "wow-abc", name: "Thrallson", realm: "Draenor-EU", className: "Shaman", level: 23, race: "Orc", faction: "Horde", notes: "my secret note", guild: "Secret Guild",
    source: { kind: "wow-addon", id: GUID, updatedAt: "2026-11-20T10:00:00.000Z" }, clientBuild: build, locale: "enUS",
    location: { zone: "The Barrens", subZone: "Crossroads", mapId: 1413, x: 0.5212, y: 0.2934 },
    gathering: { schemaVersion: 1, records: [{ id: "g1", method: "herbalism", entityId: 1617, itemIds: [2447], mapId: 1413, x: 0.4512, y: 0.6024, observedAt: "2026-11-20T09:00:00.000Z", clientBuild: build, name: "Peacebloom" }] },
    lootSources: { schemaVersion: 1, items: [
      { itemId: 4862, name: "Scorpid Worker Tail", questIds: [789], lastSeen: "2026-11-20T09:30:00.000Z", sources: [
        { kind: "creature", id: 3124, name: "Scorpid Worker", count: 4, lastSeen: "2026-11-20T09:30:00.000Z", positions: [{ mapId: 1411, x: 0.4471, y: 0.2433 }, { mapId: 1411, x: 0.5, y: 0.3 }] },
        { kind: "object", id: 3640, name: "Laden Mushroom", count: 1, lastSeen: "2026-11-20T09:30:00.000Z", positions: [{ mapId: 1411, x: 0.3012, y: 0.3 }] }] },
      { itemId: 4863, name: "Other Thing", questIds: [790], lastSeen: "2026-11-20T09:30:00.000Z", sources: [{ kind: "object", id: 3640, name: "Laden Mushroom", count: 1, lastSeen: "2026-11-20T09:30:00.000Z", positions: [{ mapId: 1411, x: 0.2991, y: 0.3 }] }] },
    ] },
    wares: { version: 1, vendors: [{ npcId: 3158, name: "Duokna", itemIds: [4540, 159], seenAt: Date.parse("2026-11-20T09:45:00Z") / 1000, mapId: 1411, x: 0.5212, y: 0.4188 }, { npcId: 3159, itemIds: [117], seenAt: 1700000000 }] },
    // Local-only blocks: the ledger (prices, gold) and scout notes are never part of sharing.
    ledger: { schemaVersion: 1, money: 123456, vendor: [{ id: 2320, cost: 10, n: 1, at: 1700000000 }], mounts: { seenAt: 1700000000, items: [{ id: 5665, name: "Horn of the Dire Wolf", cost: 800000 }] } },
    scout: { version: 1, records: [{ kind: "vendor", npcId: 9999, name: "Scout Only", mapId: 1411, x: 0.1, y: 0.1, seenAt: 1700000000 }] },
    quests: [{ id: 789, title: "Sting of the Scorpid", complete: false, objectives: [] }],
    ...over,
  };
}
const PACK2 = {
  format: 1, minor: 1, version: "v2pack", generatedAt: "2026-11-24T06:00:00.000Z", minInstalls: 3, coordStep: 0.005,
  nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs", "firstSeen", "lastSeen"], rows: [["herb", 1617, null, 1413, 0.45, 0.6, 5, "2026-10-01", "2026-11-21"], ["ore", null, "Copper Vein", 1413, 0.3, 0.3, 3, "2026-09-01", "2026-10-01"], ["object", 3640, null, 1413, 0.2, 0.2, 4, "2026-11-23", "2026-11-23"], ["chest", 2843, null, 1413, 0.7, 0.7, 3, "2026-11-24", "2026-11-24"]] },
  nodeItems: { columns: ["kind", "objectId", "name", "itemId", "installs"], rows: [["herb", 1617, null, 2447, 5], ["object", 3640, null, 4862, 4]] },
  npcs: { columns: ["npcId", "mapId", "x", "y", "installs", "firstSeen", "lastSeen"], rows: [[900, 1413, 0.3, 0.3, 4, "2026-11-01", "2026-11-22"], [901, 1413, 0.35, 0.3, 3, "2026-08-01", "2026-08-02"], [902, 1413, 0.4, 0.3, 3, "2026-11-24", "2026-11-24"]] },
  vendors: { columns: ["npcId", "itemId", "installs", "firstSeen", "lastSeen"], rows: [[900, 159, 3, "2026-11-01", "2026-11-22"]] },
  npcNames: { columns: ["npcId", "name", "installs"], rows: [[900, "Wandering Trader", 4], [901, "Old Hermit", 3]] },
};
const PACK1 = {
  format: 1, version: "v1pack", generatedAt: "2026-11-21T06:00:00.000Z", minInstalls: 3, coordStep: 0.005,
  nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs"], rows: [["herb", 1617, null, 1413, 0.45, 0.6, 5]] },
  npcs: { columns: ["npcId", "mapId", "x", "y", "installs"], rows: [[900, 1413, 0.3, 0.3, 4]] },
};
function service(opts = {}) {
  let t = opts.at ?? NOW;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const dir = opts.dir ?? tmp();
  const s = new CommunityService({ dir, getProfiles: () => opts.profiles ?? [profile()], appVersion: "1.27.0", now: clock.now, baseUrl: "https://bf.example.test", fetch: opts.fetch });
  return { s, clock, dir };
}

test("freshness maths: whole UTC days, today is 0, the future counts as today, a bad day is unknown", () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(daysSince("2026-11-24", NOW), 0);
  assert.equal(daysSince("2026-11-23", NOW), 1);
  assert.equal(daysSince("2026-11-21", NOW), 3);
  assert.equal(daysSince("2026-10-25", NOW), 30);
  assert.equal(daysSince("2025-11-24", NOW), 365);
  // The day changes at UTC midnight, not 24 hours after the report.
  assert.equal(daysSince("2026-11-23", at("2026-11-24T00:00:01Z")), 1);
  assert.equal(daysSince("2026-11-23", at("2026-11-23T23:59:59Z")), 0);
  assert.equal(daysSince("2026-02-28", at("2026-03-01T05:00:00Z")), 1, "no leap day in 2026");
  assert.equal(daysSince("2028-02-28", at("2028-03-01T05:00:00Z")), 2, "a leap day in 2028");
  assert.equal(daysSince("2026-11-30", NOW), 0, "a clock that is behind never shows a negative age");
  for (const bad of [null, undefined, "", "2026-13-01", "2026-02-30", "24.11.2026", "2026-11-24T10:00:00Z", 20261124, {}]) assert.equal(daysSince(bad, NOW), null, String(bad));
  assert.equal(W.seenLine(5, 3), "seen 3 days ago by 5 players");
  assert.equal(W.seenLine(1, 0), "seen today by 1 player");
  assert.equal(W.seenLine(4, 1), "seen yesterday by 4 players");
  assert.equal(W.seenLine(5, null), "seen by 5 players", "an older pack has no day for the spot, and the line does not invent one");
});

test("the pack validator takes minor 1 additions strictly and still reads the plain pack", () => {
  const p = validatePack(PACK2);
  assert.equal(p.minor, 1);
  assert.deepEqual(p.nodes[0], { kind: "herb", objectId: 1617, name: null, mapId: 1413, x: 0.45, y: 0.6, installs: 5, firstSeen: "2026-10-01", lastSeen: "2026-11-21" });
  assert.deepEqual(p.npcNames, [{ npcId: 900, name: "Wandering Trader", installs: 4 }, { npcId: 901, name: "Old Hermit", installs: 3 }]);
  assert.equal(p.nodes[2].kind, "object");
  const old = validatePack(PACK1);
  assert.deepEqual([old.minor, old.npcNames, Object.hasOwn(old.nodes[0], "lastSeen")], [0, [], false]);
  assert.equal(indexPack(old).perFactDates, false);
  assert.equal(indexPack(p).perFactDates, true);
  assert.equal(oldAppValidatePack(PACK1).nodes.length, 1, "and the 1.26 validator reads the plain pack as before");
  const mutate = (fn) => { const c = structuredClone(PACK2); fn(c); return c; };
  const bad = [
    mutate((c) => { c.minor = -1; }), mutate((c) => { c.minor = "1"; }),
    mutate((c) => { c.nodes.rows[0][8] = "2026-13-40"; }), mutate((c) => { c.nodes.rows[0][8] = "2026-11-21T10:00:00Z"; }), mutate((c) => { c.nodes.rows[0][7] = 20261001; }),
    mutate((c) => { c.npcs.rows[0][5] = "2026-11-23"; }), // first seen after last seen
    mutate((c) => { c.vendors.columns.pop(); for (const r of c.vendors.rows) r.pop(); }), // one of the two day columns only
    mutate((c) => { c.npcNames.rows.push([900, "Second Name", 3]); }),
    mutate((c) => { c.npcNames.rows[0][1] = "<b>x</b>"; }), mutate((c) => { c.npcNames.rows[0][1] = "x".repeat(81); }), mutate((c) => { c.npcNames.rows[0][1] = "a\nb"; }), mutate((c) => { c.npcNames.rows[0][1] = null; }),
    mutate((c) => { c.nodes.rows[0][0] = "fish"; }),
  ];
  for (const b of bad) assert.throws(() => validatePack(b), /Invalid community pack/, JSON.stringify(b).slice(0, 120));
});

test("allow-list: what leaves holds only contract fields, and nothing about the character, the ledger or scout notes", async () => {
  const fetch = fakeFetch((c) => (c.route === "/v1/pack?v=2" ? json(200, PACK2, { etag: '"v2pack"' }) : json(200, { ok: true, stored: 1 })));
  const { s } = service({ fetch });
  assert.equal((await s.refreshPack()).status, "updated");
  assert.equal(s.extended(), true);
  assert.equal((await s.submit()).status, "sent");
  const bodies = fetch.calls.filter((c) => c.route === "/v1/submit").map((c) => c.body);
  assert.equal(bodies.length, 1);
  const body = bodies[0];
  assert.deepEqual(Object.keys(body).sort(), ["appVersion", "build", "installId", "observations", "schema"]);
  const allowed = { nodes: ["kind", "objectId", "mapId", "x", "y", "itemIds"], npcs: ["npcId", "mapId", "x", "y", "name"], vendors: ["npcId", "itemIds", "name"] };
  assert.deepEqual(Object.keys(body.observations).sort(), ["nodes", "npcs", "vendors"], "no drops and no recipes: the capture has nothing honest to send for them");
  for (const [cat, list] of Object.entries(body.observations)) for (const e of list) for (const k of Object.keys(e)) assert.ok(allowed[cat].includes(k), `${cat}.${k}`);
  assert.deepEqual(body.observations.nodes, [
    { kind: "herb", objectId: 1617, mapId: 1413, x: 0.45, y: 0.6, itemIds: [2447] },
    { kind: "object", objectId: 3640, mapId: 1411, x: 0.3, y: 0.3, itemIds: [4862, 4863] },
  ]);
  assert.deepEqual(body.observations.npcs, [
    { npcId: 3124, mapId: 1411, x: 0.445, y: 0.245, name: "Scorpid Worker" },
    { npcId: 3124, mapId: 1411, x: 0.5, y: 0.3 }, // the name goes once per NPC
    { npcId: 3158, mapId: 1411, x: 0.52, y: 0.42 }, // where the vendor window was opened, rounded
  ]);
  assert.deepEqual(body.observations.vendors, [{ npcId: 3158, itemIds: [159, 4540], name: "Duokna" }, { npcId: 3159, itemIds: [117] }]);
  const text = JSON.stringify(fetch.calls.map((c) => [c.url, c.body]));
  for (const secret of ["Thrallson", "Draenor", GUID, "0A1B2C3D", "Shaman", "Orc", "Horde", "Barrens", "Crossroads", "secret", "Secret Guild", "Peacebloom", "Laden Mushroom", "Scorpid Worker Tail", "Other Thing", "Sting of",
    "Scout Only", "9999", "123456", "Horn of", "800000", "2320", "2026-11-20", "0.4512", "0.5212", "0.4188", os.userInfo().username, os.homedir(), "enUS", "locale"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  // Every field that can be sent has its plain-words row on the privacy page and in Settings.
  const P = require("../src/renderer/privacy-wording.js");
  const listed = new Set(P.FIELDS.discoveries.map(([k]) => k));
  for (const k of ["installId", "appVersion", "build"]) assert.ok(listed.has(k), k);
  for (const [cat, list] of Object.entries(body.observations)) {
    assert.ok(listed.has(`observations.${cat}`), cat);
    if (list.some((e) => e.name)) assert.ok(listed.has(`observations.${cat}.name`), `${cat}.name`);
  }
  assert.deepEqual(P.FIELDS.contributions.map(([k]) => k), ["installId"]);
  assert.deepEqual(P.FIELDS.pack.map(([k]) => k), ["firstSeen", "lastSeen", "npcNames"]);
  // The approved sentences are untouched.
  assert.equal(P.SWITCHES.share.text, "Herb and ore spots, NPC places, vendor stock and drops you come across are added to the shared map. They carry no account, character or realm name.");
  assert.equal(P.SUMMARY, "Your characters stay on your computer. The app shares only what the live map needs and anonymous statistics that help improve it, with no account, character or realm names and no files. Reports are sent only when you write one. Each of these has its own off switch.");
});

test("names: only what the game showed, only on English clients, only once the service speaks minor 1", () => {
  const cats = (list) => list.map((o) => [o.category, o.entry.name ?? null, o.entry.kind ?? null]);
  const plain = collectObservations([profile()]);
  assert.ok(plain.every((o) => !o.entry.name && o.entry.kind !== "object"), "an older service gets no name and no object kind, or it would refuse the whole batch");
  assert.deepEqual([...new Set(plain.map((o) => o.category))].sort(), ["nodes", "npcs", "vendors"], "vendor stock was always in the contract");
  const full = collectObservations([profile()], { extended: true });
  assert.deepEqual(cats(full).filter(([, name]) => name), [["npcs", "Scorpid Worker", null], ["vendors", "Duokna", null]]);
  for (const locale of ["deDE", "frFR", "esES", "enGB", undefined, 5]) assert.ok(collectObservations([profile({ locale })], { extended: true }).every((o) => !o.entry.name), `no names from ${locale}`);
  // Names the contract would refuse are left out, never repaired into something else.
  const odd = (name) => collectObservations([profile({ wares: { version: 1, vendors: [{ npcId: 5, name, itemIds: [1], seenAt: 5 }] }, lootSources: undefined })], { extended: true }).find((o) => o.category === "vendors").entry.name;
  assert.equal(odd("  Grik'nir   the Cold "), "Grik'nir the Cold");
  for (const bad of ["<Thrall>", "a|b", "x".repeat(81), "Name\u202e", "", "   ", "50% off;", 7, null]) assert.equal(odd(bad), undefined, String(bad));
  assert.equal(C.gameName("Zul’jin (Elite)"), "Zul’jin (Elite)");
  // Two characters meeting the same NPC send its name once.
  const two = collectObservations([profile(), profile({ id: "wow-2", source: { kind: "wow-addon", id: "Player-1-2" } })], { extended: true });
  assert.equal(two.filter((o) => o.entry.name === "Scorpid Worker").length, 1);
  // A manual journal shares nothing, wares included.
  assert.deepEqual(collectObservations([profile({ source: undefined })], { extended: true }), []);
});

test("a find seen again later is sent once more, so the service knows it is still there; the day itself never leaves", async () => {
  const fetch = fakeFetch(() => json(200, { ok: true, stored: 1 }));
  const dir = tmp();
  const herb = (observedAt) => [{ id: "w", source: { kind: "wow-addon", id: "x" }, clientBuild: "1.60.1.71037", gathering: { records: [{ method: "herbalism", entityId: 1617, itemIds: [2447], mapId: 1413, x: 0.45, y: 0.6, observedAt }] } }];
  let list = herb("2026-11-20T09:00:00.000Z");
  const first = service({ fetch, dir, profiles: null, at: Date.parse("2026-11-22T12:00:00Z") });
  first.s.getProfiles = () => list;
  assert.equal((await first.s.submit()).status, "sent");
  first.clock.advance(C.SUBMIT_EVERY);
  assert.equal((await first.s.submit()).status, "nothing", "seen before this version began refreshing: sent once, as always");
  list = herb("2026-11-23T18:00:00.000Z"); // gathered there again
  assert.equal((await first.s.submit()).status, "sent");
  first.clock.advance(C.SUBMIT_EVERY);
  assert.equal((await first.s.submit()).status, "nothing");
  list = herb("2026-11-23T22:00:00.000Z"); // again the same day: nothing new to say
  assert.equal((await first.s.submit()).status, "nothing");
  list = herb("2026-11-25T08:00:00.000Z");
  first.clock.advance(C.SUBMIT_EVERY);
  assert.equal((await first.s.submit()).status, "sent");
  assert.equal(fetch.calls.length, 3);
  for (const c of fetch.calls) {
    assert.deepEqual(c.body.observations, { nodes: [{ kind: "herb", objectId: 1617, mapId: 1413, x: 0.45, y: 0.6, itemIds: [2447] }] });
    assert.doesNotMatch(JSON.stringify(c.body), /2026-11|observedAt|T\d\d:/);
  }
  // The local memory holds hashes only.
  assert.match(fs.readFileSync(path.join(dir, "community", "sent.json"), "utf8"), /^\{"schemaVersion":1,"keys":\["[0-9a-f]{16}"(,"[0-9a-f]{16}")*\]\}$/);
});

test("/v1/mine: asked only while sharing is on and something was shared, sends the install id alone, and is checked strictly", async () => {
  const MINE = { ok: true, total: 3, truncated: false, counts: { 1413: { herb: 1, npc: 1 } }, keys: {
    nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y"], rows: [["herb", 1617, null, 1413, 0.45, 0.6]] },
    npcs: { columns: ["npcId", "mapId", "x", "y"], rows: [[900, 1413, 0.3, 0.3]] },
    vendors: { columns: ["npcId", "itemId"], rows: [[900, 159]] } } };
  let answer = () => json(200, MINE);
  const fetch = fakeFetch((c) => (c.route === "/v1/mine" ? answer() : c.route === "/v1/pack?v=2" ? json(200, PACK2) : json(200, { ok: true, stored: 1 })));
  const { s, clock, dir } = service({ fetch });
  const mineCalls = () => fetch.calls.filter((c) => c.route === "/v1/mine");
  assert.deepEqual(await s.refreshMine(), { status: "nothing" }, "nothing shared yet: nothing to ask");
  assert.equal(mineCalls().length, 0);
  await s.refreshPack();
  assert.equal(s.index().mine, null, "until the service answers, the map falls back to a guess and says so");
  await s.submit();
  assert.deepEqual(await s.refreshMine(), { status: "updated", count: 3 });
  const call = mineCalls()[0];
  assert.equal(call.method, "POST");
  assert.deepEqual(call.body, { schema: 1, installId: s.settings.installId }, "the install id and nothing else");
  assert.deepEqual([...s.index().mine].sort(), ["herb:1617:1413:0.45:0.6", "npc:900:1413:0.3:0.3", "vendor:900:159"]);
  assert.deepEqual(s.status().mine, { count: 3, total: 3, truncated: false });
  // Not asked again for six hours, unless something new was shared (then after ten minutes).
  assert.equal((await s.refreshMine()).status, "fresh");
  clock.advance(C.MINE_EVERY + 1000);
  assert.equal((await s.refreshMine()).status, "updated");
  s.settings.mineStale = true;
  assert.equal((await s.refreshMine()).status, "fresh");
  clock.advance(C.MINE_MIN_GAP + 1000);
  assert.equal((await s.refreshMine()).status, "updated");
  assert.equal(mineCalls().length, 3);
  // Kept across restarts, tied to this install id.
  const again = new CommunityService({ dir, fetch, now: clock.now, baseUrl: "https://bf.example.test" });
  assert.equal(again.mine.keys.size, 3);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "community", "mine.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "community", "mine.json"), JSON.stringify({ ...saved, installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }));
  assert.equal(new CommunityService({ dir, fetch, now: clock.now, baseUrl: "https://bf.example.test" }).mine, null, "a list for another install id is not used");
  fs.writeFileSync(path.join(dir, "community", "mine.json"), JSON.stringify(saved));
  // A bad or missing answer never replaces the last good list and never throws.
  for (const [reply, status] of [[() => json(200, { ok: true, keys: { nodes: { columns: ["kind"], rows: [["herb"]] } } }), "invalid"], [() => json(200, { ...MINE, keys: { ...MINE.keys, npcs: { columns: MINE.keys.npcs.columns, rows: [[900, 1413, 7, 0.3]] } } }), "invalid"],
    [() => json(200, { ok: false }), "invalid"], [() => json(404, { ok: false, error: "not_found" }), "unsupported"], [() => json(429, { ok: false }), "offline"], [() => { throw Error("down"); }, "offline"]]) {
    answer = reply;
    assert.equal((await s.refreshMine({ force: true })).status, status);
    assert.equal(s.mine.keys.size, 3);
  }
  // Sharing off: the install id is not sent anywhere, this request included.
  const before = mineCalls().length;
  s.setSettings({ share: false });
  assert.deepEqual(await s.refreshMine({ force: true }), { status: "off" });
  assert.equal(mineCalls().length, before);
  // Strict parser.
  assert.deepEqual(validateMine({ ok: true, keys: {} }), { total: 0, truncated: false, keys: [] });
  assert.equal(mineKey.node("ore", null, "Copper Vein", 1413, 0.3, 0.3), "ore:n:Copper Vein:1413:0.3:0.3");
  for (const bad of [null, {}, { ok: true }, { ok: true, keys: { nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y"], rows: [["herb", 1617, "Both", 1413, 0.4, 0.4]] } } },
    { ok: true, keys: { vendors: { columns: ["npcId", "itemId"], rows: [[1, "2"]] } } }, { ok: true, keys: { npcs: { columns: ["npcId", "mapId", "x", "y"], rows: Array.from({ length: 6001 }, () => [1, 1, 0.5, 0.5]) } } }])
    assert.throws(() => validateMine(bad), /Invalid contributions list/);
});

test("forget and delete-all-local-data both drop the list of your own contributions", async () => {
  const fetch = fakeFetch((c) => (c.route === "/v1/mine" ? json(200, { ok: true, total: 1, truncated: false, counts: {}, keys: { npcs: { columns: ["npcId", "mapId", "x", "y"], rows: [[900, 1413, 0.3, 0.3]] } } })
    : c.route === "/v1/forget" ? json(200, { ok: true, removed: { observations: 4, reports: 0 } }) : c.route === "/v1/pack?v=2" ? json(200, PACK2) : json(200, { ok: true, stored: 1 })));
  const { s, dir } = service({ fetch });
  await s.refreshPack(); await s.submit(); await s.refreshMine();
  const file = path.join(dir, "community", "mine.json");
  assert.ok(fs.existsSync(file)); assert.equal(s.index().mine.size, 1);
  const old = s.settings.installId;
  await s.forget();
  assert.notEqual(s.settings.installId, old);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual([s.mine, s.index().mine, s.status().mine], [null, null, null]);
  assert.deepEqual(await s.refreshMine({ force: true }), { status: "nothing" }, "the new install id has shared nothing, so nothing is asked");
  s.settings.sentTotal = 1; await s.refreshMine({ force: true });
  assert.ok(fs.existsSync(file));
  s.reset();
  assert.equal(fs.existsSync(file), false); assert.equal(s.mine, null);
});

test("the map: fresh and stale spots, exact and guessed 'from you', names from the community, objects as their own layer", () => {
  const community = indexPack(validatePack(PACK2));
  const opts = { staticNpcIds: new Set(), npcName: (id) => (id === 902 ? "Bundled Name" : null), nodeFacts: (n) => (n.objectId === 1617 ? { name: "Peacebloom", skill: 1 } : null), skills: { herb: 40, ore: 40 }, now: NOW };
  const exact = new Set([mineKey.node("herb", 1617, null, 1413, 0.45, 0.6), mineKey.npc(901, 1413, 0.35, 0.3)]);
  const pins = W.communityPins({ ...community, mine: exact }, 1413, { ...opts, mine: exact });
  const by = (label) => pins.find((p) => p.label === label);
  assert.deepEqual(pins.map((p) => p.layer).sort(), ["c-chest", "c-herb", "c-npc", "c-npc", "c-object", "c-ore", "c-vendor"]);
  assert.deepEqual([by("Peacebloom").sub, by("Peacebloom").ageDays, by("Peacebloom").stale, by("Peacebloom").yours], ["Herb · seen 3 days ago by 5 players · skill 1", 3, false, true]);
  assert.deepEqual([by("Copper Vein").ageDays, by("Copper Vein").stale, by("Copper Vein").lastSeen], [54, true, "2026-10-01"]);
  assert.deepEqual([by("Object").sub, by("Object").gatherable, by("Object").itemIds], ["Object · seen yesterday by 4 players", true, [4862]]);
  assert.equal(by("Chest").sub, "Chest · seen today by 3 players");
  // A name only the community knows is used and marked; the bundled name wins where there is one.
  assert.deepEqual([by("Wandering Trader").communityName, by("Wandering Trader").layer, by("Wandering Trader").sub], [true, "c-vendor", "Vendor · seen 2 days ago by 4 players · name from the community"]);
  assert.match(by("Wandering Trader").source, /name from the community \(4 players\)/);
  assert.deepEqual([by("Old Hermit").stale, by("Old Hermit").yours, by("Old Hermit").ageDays], [true, true, 114]);
  assert.deepEqual([by("Bundled Name").communityName, by("Bundled Name").sub], [undefined, "Seen here · seen today by 3 players"]);
  const sum = W.communitySummary({ ...community, mine: exact }, pins, { now: NOW });
  assert.deepEqual({ total: sum.total, yours: sum.yours, yoursExact: sum.yoursExact, perFactDates: sum.perFactDates, stale: sum.stale, staleDays: sum.staleDays, names: sum.names, objects: sum.layers["c-object"] },
    { total: 7, yours: 2, yoursExact: true, perFactDates: true, stale: 2, staleDays: 30, names: 2, objects: 1 });
  // An older pack: no days, and "yours" is a guess from the finds saved here.
  const plain = indexPack(validatePack(PACK1));
  const guess = W.ownSpotKeys([profile()]);
  const oldPins = W.communityPins(plain, 1413, { ...opts, mine: guess });
  assert.deepEqual(oldPins.map((p) => [p.sub, p.ageDays, p.stale, p.yours]), [["Herb · seen by 5 players · skill 1", null, undefined, true], ["Seen here · seen by 4 players", null, undefined, false]]);
  const oldSum = W.communitySummary(plain, oldPins, { now: NOW });
  assert.deepEqual([oldSum.perFactDates, oldSum.yoursExact, oldSum.stale, oldSum.ageDays], [false, false, 0, 3]);
});

function worldMapView() {
  const c = { window: { addEventListener() {} }, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve("../src/renderer/world-map.js"), "utf8"), c);
  return c.window.WorldMapView;
}
test("UI states: the community card and a spot's card say only what the pack really knows", () => {
  const view = worldMapView();
  const base = { ageDays: 2, total: 12, yours: 0, yoursExact: false, perFactDates: false, stale: 0, staleDays: 30, names: 0, beyondSkill: 0, layers: { "c-herb": 7, "c-ore": 3, "c-chest": 1, "c-object": 1, "c-npc": 0, "c-vendor": 0 }, skills: { herb: 40, ore: null } };
  // An older pack: one date for everything, no date filter offered.
  let html = view._communityMarkup(base);
  assert.match(html, /one date for everything/);
  assert.doesNotMatch(html, /data-wm-seen-within|is from you|are from you|faded/);
  assert.match(html, /<b>1<\/b> <span>objects<\/span>/);
  // Dated pack: the filter, the faded count, and the pack's own age.
  html = view._communityMarkup({ ...base, perFactDates: true, stale: 3 });
  assert.match(html, /<select data-wm-seen-within aria-label="Show spots seen"><option value="0" selected>at any time<\/option><option value="7">in the last 7 days<\/option><option value="30">in the last 30 days<\/option><option value="90">in the last 90 days<\/option><\/select>/);
  assert.match(html, /<b>3<\/b> <span>are faded: not seen for over 30 days<\/span>/);
  assert.match(html, /when it was last seen\.<\/span> <span>Pack from<\/span> <span>2 days ago<\/span>/);
  assert.doesNotMatch(html, /one date for everything/);
  assert.match(view._communityMarkup({ ...base, perFactDates: true, stale: 1 }), /<b>1<\/b> <span>is faded: not seen for over 30 days<\/span>/);
  // With the filter on, it says how many it hides instead.
  html = view._communityMarkup({ ...base, perFactDates: true, stale: 3 }, { seenWithin: 7, tooOldHere: 5 });
  assert.match(html, /<option value="7" selected>/);
  assert.match(html, /<b>5<\/b> <span>hidden as older<\/span>/);
  assert.doesNotMatch(html, /faded/);
  // "From you": exact when the service listed it, otherwise the older, weaker wording.
  assert.match(view._communityMarkup({ ...base, yours: 2, yoursExact: true }), /<b data-wm-c-yours="exact">2<\/b> <span>are from you<\/span>/);
  assert.match(view._communityMarkup({ ...base, yours: 1, yoursExact: true }), /<b data-wm-c-yours="exact">1<\/b> <span>is from you<\/span>/);
  assert.match(view._communityMarkup({ ...base, yours: 2, yoursExact: false }), /<b data-wm-c-yours="guess">2<\/b> <span>match finds of yours<\/span>/);
  assert.match(view._communityMarkup({ ...base, total: 0, layers: {} }), /The community has no spots in this zone yet/);
  // One spot.
  const spot = { installs: 5, ageDays: 3, stale: false, yours: true, itemIds: [], gather: "herb" };
  let card = view._communityDetails(spot, { ...base, yoursExact: true });
  assert.match(card, /<strong>Seen by 5 players<\/strong> · <span>Last seen<\/span> <span data-wm-last-seen>3 days ago<\/span>/);
  assert.match(card, /data-wm-yours="exact">You shared this one\./);
  assert.doesNotMatch(card, /data-wm-stale|Pack from/);
  card = view._communityDetails({ ...spot, ageDays: 54, stale: true, yours: true }, { ...base, yoursExact: false });
  assert.match(card, /data-wm-stale>Not seen for over 30 days\. It may be gone\./);
  assert.match(card, /data-wm-yours="guess">You found this one too\./);
  card = view._communityDetails({ installs: 1, ageDays: null, yours: false, itemIds: [], gather: "object" }, base);
  assert.match(card, /<strong>Seen by 1 player<\/strong> · <span>Pack from<\/span> <span>2 days ago<\/span>/, "no day for the spot: only the pack's date is claimed");
  assert.match(card, /An object another player looted/);
  assert.doesNotMatch(card, /data-wm-last-seen|data-wm-yours/);
  assert.match(view._communityDetails({ ...spot, ageDays: 0 }, base), /data-wm-last-seen>today</);
});

test("Settings: See exactly what is sent lists every discovery field in plain words, in every language", () => {
  const P = require("../src/renderer/privacy-wording.js");
  const desk = fs.readFileSync(path.join(__dirname, "../src/renderer/desk.js"), "utf8");
  assert.match(desk, /data-desk-see-share/);
  assert.match(desk, /W\.FIELDS\.discoveries\.map/); assert.doesNotMatch(desk, /As above/, "this list stands first on the screen"); assert.match(desk, /W\.FIELDS\.contributions\[0\]\[2\]/); assert.match(desk, /W\.FIELDS\.pack\.map/);
  // Every sentence the app shows from these lists, and every new map string, has German, French and Spanish.
  const full = Object.fromEntries(P.FIELDS.statistics.map(([key, , what]) => [key, what]));
  const shown = [...P.FIELDS.discoveries.flatMap(([key, name, what]) => [name, full[key] || what]), P.FIELDS.contributions[0][2], ...P.FIELDS.pack.flatMap(([, name, what]) => [name, what]),
    "Community objects", "objects", "is from you", "are from you", "Show spots seen", "at any time", "in the last 7 days", "in the last 30 days", "in the last 90 days", "hidden as older",
    "is faded: not seen for over 30 days", "are faded: not seen for over 30 days", "Each spot says how many players saw it and when it was last seen.", "Last seen", "Not seen for over 30 days. It may be gone.", "You shared this one.",
    "Shared anonymously. An object another player looted, not a live one.", "Which spots are yours.", "What comes back.",
    "These are all the fields a shared discovery can hold. A spot reaches other players only once at least three installs reported it.", "Sharing is off, so nothing is sent. This is what would be sent if you switched it on."];
  const { s } = service({ fetch: fakeFetch(() => json(200, {})) });
  shown.push(...s.status().shares);
  for (const lang of ["de", "fr", "es"]) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../data/i18n/${lang}.json`), "utf8")).app;
    for (const en of shown) assert.ok(typeof d[en] === "string" && d[en].trim() && d[en] !== en, `${lang}: ${en}`);
  }
  // The site's privacy page prints the same lists.
  const site = fs.readFileSync(path.join(__dirname, "../scripts/build-site.cjs"), "utf8");
  assert.match(site, /fields\(FIELDS\.contributions\)/); assert.match(site, /fields\(FIELDS\.pack\)/);
});
