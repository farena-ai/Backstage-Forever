"use strict";
// Community sharing (0.34): privacy of what leaves the computer, rounding, dedupe, batching,
// pack validation, quiet failure, the off switch, forget and problem reports.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const C = require("../src/core/community.cjs");
const { CommunityService, collectObservations, planBatches, submitBody, validatePack, indexPack, round, redactLog, resolveBaseUrl } = C;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-community-"));
const GUID = "Player-4184-0A1B2C3D";
function gatherRecord(method, entityId, mapId, x, y, itemIds, name) {
  const build = "1.60.1.70888";
  return { id: `wowf:${method}:${entityId}:${mapId}:${Math.floor(x * 10000 + 0.5)}:${Math.floor(y * 10000 + 0.5)}:${build}`, method, entityId, itemIds, mapId, x, y, observedAt: "2026-11-12T10:00:00.000Z", clientBuild: build, name, evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true };
}
// Fixture characters: everything private is filled in so the test can prove none of it is sent.
const profiles = () => [
  {
    id: "wow-abc", name: "Thrallson", realm: "Draenor-EU", className: "Shaman", level: 23, race: "Orc", faction: "Horde", notes: "my secret note", goals: [{ id: "g", text: "secret goal", done: false }],
    source: { kind: "wow-addon", id: GUID, updatedAt: "2026-11-12T10:00:00.000Z" }, clientBuild: "1.60.1.70888",
    location: { zone: "The Barrens", subZone: "Crossroads", mapId: 1413, x: 0.5212, y: 0.2934 },
    gathering: { schemaVersion: 1, status: "available", recording: true, observedAt: "2026-11-12T10:00:00.000Z", limited: false, totalRecords: 3, records: [
      gatherRecord("herbalism", 1617, 1413, 0.4512, 0.6024, [765, 2447], "Peacebloom"),
      gatherRecord("mining", 1731, 1413, 0.3027, 0.2976, [2770], "Copper Vein"),
      gatherRecord("chest", 2843, 1411, 0.1, 0.9, [118], "Battered Chest"),
    ] },
    lootSources: { schemaVersion: 1, items: [{ itemId: 4862, name: "Scorpid Worker Tail", questIds: [789], lastSeen: "2026-11-12T10:00:00.000Z", sources: [
      { kind: "creature", id: 3124, name: "Scorpid Worker", count: 4, lastSeen: "2026-11-12T10:00:00.000Z", positions: [{ mapId: 1411, x: 0.4471, y: 0.2433 }] },
      { kind: "object", id: 55, name: "Crate", count: 1, lastSeen: "2026-11-12T10:00:00.000Z", positions: [{ mapId: 1411, x: 0.3, y: 0.3 }] },
    ] }] },
    quests: [{ id: 789, title: "Sting of the Scorpid", complete: false, objectives: [] }],
  },
  // A manual journal: nothing observed by the addon, so nothing to share.
  { id: "manual", name: "Notreal", realm: "Nowhere", className: "Mage", level: 5, gathering: { records: [gatherRecord("herbalism", 999, 1, 0.5, 0.5, [1], "X")] } },
];

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  };
  fn.calls = calls;
  return fn;
}
function service(opts = {}) {
  let t = Date.parse("2026-11-13T12:00:00Z");
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const s = new CommunityService({ dir: opts.dir ?? tmp(), getProfiles: () => opts.profiles ?? profiles(), appVersion: "0.34.0", now: clock.now, baseUrl: "https://bf.example.test", fetch: opts.fetch, getSupportText: opts.support || (() => "App version: 0.34.0"), redact: opts.redact });
  return { s, clock };
}
const PACK = {
  format: 1, version: "a1b2c3d4e5f6a7b8c9d0", generatedAt: "2026-11-13T18:00:00.000Z", minInstalls: 3, coordStep: 0.005,
  nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs"], rows: [["herb", 1617, null, 1429, 0.45, 0.6, 3], ["ore", null, "Copper Vein", 1429, 0.305, 0.3, 4]] },
  nodeItems: { columns: ["kind", "objectId", "name", "itemId", "installs"], rows: [["herb", 1617, null, 2447, 3]] },
  npcs: { columns: ["npcId", "mapId", "x", "y", "installs"], rows: [[197, 1429, 0.485, 0.42, 3]] },
  vendors: { columns: ["npcId", "itemId", "installs"], rows: [[1213, 159, 3]] },
  drops: { columns: ["npcId", "itemId", "rate", "samples", "installs"], rows: [[448, 1931, 0.3, 30, 3]] },
  recipes: { columns: ["source", "npcId", "spellId", "itemId", "installs"], rows: [["trainer", 1215, 2330, null, 3]] },
};

test("coordinates are snapped to 0.5% of the map before they leave", () => {
  assert.equal(round(0.4512), 0.45); assert.equal(round(0.4526), 0.455); assert.equal(round(0.99999), 1); assert.equal(round(0), 0);
  const obs = collectObservations(profiles());
  for (const o of obs) for (const k of ["x", "y"]) if (k in o.entry) assert.equal(Math.round(o.entry[k] * 200) / 200, o.entry[k]);
  assert.deepEqual(obs.find((o) => o.category === "nodes" && o.entry.objectId === 1617).entry, { kind: "herb", objectId: 1617, mapId: 1413, x: 0.45, y: 0.6, itemIds: [765, 2447] });
  assert.deepEqual(obs.find((o) => o.category === "npcs").entry, { npcId: 3124, mapId: 1411, x: 0.445, y: 0.245 });
});

test("privacy: submit payloads hold only contract fields and nothing about the character", async () => {
  const fetch = fakeFetch(() => json(200, { ok: true, stored: 5 }));
  const { s } = service({ fetch });
  const r = await s.submit();
  assert.equal(r.status, "sent"); assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, "https://bf.example.test/v1/submit"); assert.equal(call.method, "POST");
  assert.equal(call.headers["Content-Type"], "application/json");
  const body = call.body;
  assert.deepEqual(Object.keys(body).sort(), ["appVersion", "build", "installId", "observations", "schema"]);
  assert.equal(body.schema, 1); assert.match(body.installId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(body.build, "1.60.1.70888"); assert.equal(body.appVersion, "0.34.0");
  const allowed = { nodes: ["kind", "objectId", "name", "mapId", "x", "y", "itemIds"], npcs: ["npcId", "mapId", "x", "y"], vendors: ["npcId", "itemIds"], drops: ["npcId", "loots", "items"], recipes: ["source", "npcId", "spellId", "itemId"] };
  for (const [cat, list] of Object.entries(body.observations)) {
    assert.ok(allowed[cat], cat);
    for (const e of list) for (const k of Object.keys(e)) assert.ok(allowed[cat].includes(k), `${cat}.${k}`);
  }
  assert.equal(body.observations.nodes.length, 3); assert.equal(body.observations.npcs.length, 1);
  const text = JSON.stringify(body);
  for (const secret of ["Thrallson", "Draenor", GUID, "0A1B2C3D", "Shaman", "Orc", "Horde", "Barrens", "Crossroads", "secret", "Peacebloom", "Copper Vein", "Battered Chest", "Scorpid", "Crate", "Notreal", "2026-11", "0.4512", "0.5212"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  // Objects that are not gathering nodes, and manual journals, are never shared.
  assert.ok(!body.observations.npcs.some((n) => n.npcId === 55));
  assert.ok(!body.observations.nodes.some((n) => n.objectId === 999));
});

test("nothing is resent: shared finds are remembered, duplicates collapse, new finds go next time", async () => {
  const fetch = fakeFetch(() => json(200, { ok: true, stored: 1 }));
  const dir = tmp();
  const list = profiles();
  list.push({ ...list[0], id: "copy" }); // same character twice: the same spots are sent once
  const { s, clock } = service({ fetch, dir, profiles: list });
  await s.submit();
  assert.equal(fetch.calls[0].body.observations.nodes.length, 3);
  clock.advance(C.SUBMIT_EVERY);
  assert.equal((await s.submit()).status, "nothing");
  assert.equal(fetch.calls.length, 1);
  // A fresh service on the same folder remembers what was sent.
  const again = new CommunityService({ dir, getProfiles: () => list, fetch, now: () => clock.now() + C.SUBMIT_EVERY, baseUrl: "https://bf.example.test" });
  assert.equal((await again.submit()).status, "nothing");
  list[0].gathering.records.push(gatherRecord("herbalism", 1618, 1413, 0.7, 0.7, [785], "Silverleaf"));
  assert.equal((await again.submit()).status, "sent");
  assert.deepEqual(fetch.calls[1].body.observations, { nodes: [{ kind: "herb", objectId: 1618, mapId: 1413, x: 0.7, y: 0.7, itemIds: [785] }] });
  assert.equal(again.status().sent, 5);
});

test("batches stay within 500 entries and 5,000 facts, split by client build", () => {
  const items = [];
  for (let i = 0; i < 1200; i++) items.push({ key: `k${i}`, build: i < 1000 ? "1.60.1.70888" : "1.60.1.70900", category: "nodes", entry: {}, facts: 1 + 16 });
  const batches = planBatches(items);
  assert.equal(batches.reduce((a, b) => a + b.items.length, 0), 1200);
  for (const b of batches) {
    assert.ok(b.items.length <= 500);
    assert.ok(b.items.reduce((a, it) => a + it.facts, 0) <= 5000);
    assert.ok(b.items.every((it) => it.build === b.build));
  }
  const body = submitBody({ installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", appVersion: "bad version!", batch: { build: "nope", items: [{ category: "npcs", entry: { npcId: 1, mapId: 2, x: 0, y: 0 } }] } });
  assert.deepEqual(Object.keys(body).sort(), ["installId", "observations", "schema"]);
});

test("drops, vendors and recipes are not collected: the app has no player-observed loot windows or listings", () => {
  const cats = new Set(collectObservations(profiles()).map((o) => o.category));
  assert.deepEqual([...cats].sort(), ["nodes", "npcs"]);
});

test("the off switch stops every submit; downloads keep their own switch", async () => {
  const fetch = fakeFetch((c) => (c.url.endsWith("/v1/pack") ? json(200, PACK, { etag: '"v1"' }) : json(200, { ok: true, stored: 1 })));
  const { s, clock } = service({ fetch });
  assert.equal(s.status().share, true, "sharing is on by default");
  s.setSettings({ share: false });
  for (let i = 0; i < 3; i++) { assert.equal((await s.submit({ force: true })).status, "off"); clock.advance(C.SUBMIT_EVERY); }
  assert.ok(!fetch.calls.some((c) => c.url.endsWith("/v1/submit")));
  assert.equal((await s.refreshPack()).status, "updated");
  s.setSettings({ download: false });
  assert.equal(s.index(), null, "community data is hidden when downloads are off");
  assert.equal((await s.refreshPack({ force: true })).status, "off");
  assert.throws(() => s.setSettings({ share: "yes" }), /Invalid community settings/);
  assert.throws(() => s.setSettings({ installId: "x" }), /Invalid community settings/);
  // The choice survives a restart.
  const again = new CommunityService({ dir: s.dir.replace(/[\\/]community$/, ""), fetch, baseUrl: "https://bf.example.test" });
  assert.equal(again.status().share, false);
});

test("network down: every call fails quietly, backs off and retries later", async () => {
  const fetch = fakeFetch(() => { throw new TypeError("fetch failed"); });
  const { s, clock } = service({ fetch });
  assert.equal((await s.submit()).status, "offline");
  assert.equal((await s.refreshPack()).status, "offline");
  assert.ok(s.status().retryAt, "a retry time is shown");
  clock.advance(30 * 1000);
  assert.equal((await s.submit()).status, "waiting", "no hammering while backing off");
  const before = fetch.calls.length;
  clock.advance(C.SUBMIT_EVERY);
  assert.equal((await s.submit()).status, "offline");
  assert.equal(fetch.calls.length, before + 1);
  // Exponential: the second failure waits twice as long as the first (1 min, 2 min, … up to 6 h).
  assert.equal(Date.parse(s.status().retryAt) - clock.now(), 2 * 60 * 1000);
  assert.equal(s.status().sent, 0);
  await assert.rejects(s.forget(), /could not be reached/);
  await assert.rejects(s.report({ category: "bug", text: "x" }), /could not be reached/);
});

test("server answers: 400 drops the batch for good, 429 waits Retry-After, 5xx keeps it, 403 stops sharing", async () => {
  let reply = json(400, { ok: false, error: "invalid", detail: "observations.nodes[0].x: must be a number 0..1" });
  const fetch = fakeFetch(() => reply);
  const { s, clock } = service({ fetch });
  await s.submit();
  clock.advance(C.SUBMIT_EVERY);
  assert.equal((await s.submit()).status, "nothing", "a rejected batch is never retried");
  // New finds: a 503 keeps them for later, a 429 honours Retry-After.
  const list = profiles(); list[0].gathering.records = [gatherRecord("herbalism", 1620, 1413, 0.2, 0.2, [3820], "Stranglekelp")]; list[0].lootSources = undefined;
  const s2 = service({ fetch, profiles: list });
  reply = json(503, { ok: false });
  assert.equal((await s2.s.submit()).status, "offline");
  s2.clock.advance(C.SUBMIT_EVERY);
  reply = json(429, { ok: false, error: "rate_limited" }, { "retry-after": "1800" });
  assert.equal((await s2.s.submit()).status, "waiting");
  assert.equal(Date.parse(s2.s.status().retryAt) - s2.clock.now(), 1800 * 1000);
  s2.clock.advance(1800 * 1000);
  reply = json(200, { ok: true, stored: 1 });
  assert.equal((await s2.s.submit()).status, "sent");
  const s3 = service({ fetch, profiles: profiles() });
  reply = json(403, { ok: false, error: "blocked" });
  assert.equal((await s3.s.submit()).status, "blocked");
  s3.clock.advance(C.SUBMIT_EVERY);
  const n = fetch.calls.length;
  assert.equal((await s3.s.submit({ force: true })).status, "blocked");
  assert.equal(fetch.calls.length, n);
});

test("pack validation is strict, reads columns by name and ignores unknown top-level keys", () => {
  const ok = validatePack({ ...PACK, extra: { anything: true } });
  assert.equal(ok.nodes.length, 2); assert.equal(ok.drops[0].rate, 0.3);
  // Columns in another order still read correctly.
  const shuffled = { ...PACK, npcs: { columns: ["installs", "y", "x", "mapId", "npcId", "future"], rows: [[3, 0.42, 0.485, 1429, 197, "z"]] } };
  assert.deepEqual(validatePack(shuffled).npcs[0], { npcId: 197, mapId: 1429, x: 0.485, y: 0.42, installs: 3 });
  const bad = [
    { ...PACK, format: 2 }, { ...PACK, version: "../../x" }, { ...PACK, minInstalls: 0 }, null, [], "pack",
    { ...PACK, nodes: { columns: ["kind", "objectId", "mapId", "x", "y", "installs"], rows: [] } },
    { ...PACK, nodes: { columns: PACK.nodes.columns, rows: [["herb", 1617, "Peacebloom", 1429, 0.45, 0.6, 3]] } },
    { ...PACK, nodes: { columns: PACK.nodes.columns, rows: [["herb", null, null, 1429, 0.45, 0.6, 3]] } },
    { ...PACK, nodes: { columns: PACK.nodes.columns, rows: [["tree", 1, null, 1429, 0.45, 0.6, 3]] } },
    { ...PACK, nodes: { columns: PACK.nodes.columns, rows: [["herb", 1, null, 1429, 1.5, 0.6, 3]] } },
    { ...PACK, nodes: { columns: PACK.nodes.columns, rows: [["herb", null, "<script>alert(1)</script>", 1429, 0.4, 0.6, 3]] } },
    { ...PACK, npcs: { columns: PACK.npcs.columns, rows: [[197, 1429, 0.4, 0.4]] } },
    { ...PACK, drops: { columns: PACK.drops.columns, rows: [[448, 1931, 1.2, 30, 3]] } },
    { ...PACK, recipes: { columns: PACK.recipes.columns, rows: [["trainer", 1215, null, null, 3]] } },
    { ...PACK, vendors: { columns: PACK.vendors.columns, rows: Array.from({ length: C.PACK_LIMITS.vendors + 1 }, () => [1, 1, 3]) } },
  ];
  for (const p of bad) assert.throws(() => validatePack(p), /Invalid community pack/);
  const idx = indexPack(ok);
  assert.equal(idx.nodesByMap.get(1429).length, 2);
  assert.deepEqual(idx.nodesByMap.get(1429)[0].items, [{ itemId: 2447, installs: 3 }]);
  assert.equal(idx.dropsByItem.get(1931)[0].npcId, 448);
  assert.equal(C.provenance(1), "Community · 1 player"); assert.equal(C.provenance(4), "Community · 4 players");
});

test("daily pack: stored with its ETag, 304 keeps it, a bad pack never replaces a good one", async () => {
  let reply = () => json(200, PACK, { etag: '"a1b2"' });
  const fetch = fakeFetch(() => reply());
  const dir = tmp();
  const { s, clock } = service({ fetch, dir });
  assert.equal((await s.refreshPack()).status, "updated");
  assert.equal(s.status().received.total, 7);
  assert.equal((await s.refreshPack()).status, "fresh", "at most once a day");
  clock.advance(C.PACK_EVERY);
  reply = () => new Response(null, { status: 304 });
  assert.equal((await s.refreshPack()).status, "unchanged");
  assert.equal(fetch.calls.at(-1).headers["If-None-Match"], '"a1b2"');
  clock.advance(C.PACK_EVERY);
  reply = () => json(200, { ...PACK, version: "v2", nodes: { columns: PACK.nodes.columns, rows: [["herb", 1, null, 1, 9, 9, 3]] } });
  assert.equal((await s.refreshPack()).status, "invalid");
  assert.equal(s.index().version, PACK.version);
  // The stored pack is validated again on the next start.
  const again = new CommunityService({ dir, fetch, baseUrl: "https://bf.example.test" });
  assert.equal(again.index().version, PACK.version);
  fs.writeFileSync(path.join(dir, "community", "pack.json"), JSON.stringify({ ...PACK, format: 9 }));
  assert.equal(new CommunityService({ dir, fetch, baseUrl: "https://bf.example.test" }).index(), null);
});

test("forget: deletes with exactly schema + installId, then a new install id", async () => {
  const fetch = fakeFetch((c) => (c.url.endsWith("/v1/forget") ? json(200, { ok: true, removed: { observations: 12, reports: 1 } }) : json(200, { ok: true, stored: 1 })));
  const { s, clock } = service({ fetch });
  await s.submit();
  const oldId = fetch.calls[0].body.installId;
  const r = await s.forget();
  const call = fetch.calls.at(-1);
  assert.equal(call.url, "https://bf.example.test/v1/forget");
  assert.deepEqual(call.body, { schema: 1, installId: oldId });
  assert.deepEqual(r.removed, { observations: 12, reports: 1 });
  assert.notEqual(s.settings.installId, oldId); assert.equal(r.status.installId, s.settings.installId.slice(0, 8));
  assert.equal(r.status.sent, 0);
  clock.advance(C.SUBMIT_EVERY);
  assert.equal((await s.submit()).status, "nothing", "forgotten finds are not shared again under the new id");
  const limited = service({ fetch: fakeFetch(() => json(429, { ok: false }, { "retry-after": "60" })) });
  await assert.rejects(limited.s.forget(), /Too many requests/);
});

test("problem report: the log is redacted, shown first, and only that exact text is sent", async () => {
  const fetch = fakeFetch(() => json(201, { ok: true, id: 42 }));
  const support = () => "App version: 0.34.0\nData: C:\\Users\\Frank\\AppData\\Roaming\\Backstage Forever\\state.json\nUser frank wrote to frank.arena@example.com\nOther: D:\\Games\\WoW\\_classic_\nmac /Users/frank/Library\n\u202Eevil\x1b[31m";
  const { s } = service({ fetch, support, redact: (t) => redactLog(t, { home: "C:\\Users\\Frank", username: "Frank" }) });
  s.log("submit: 3 entries accepted");
  const preview = s.reportPreview();
  for (const leak of ["Frank", "frank", "example.com", "D:\\Games", "/Users/", "\u202E", "\x1b"]) assert.ok(!preview.text.includes(leak), `log leaks ${JSON.stringify(leak)}`);
  assert.match(preview.text, /~\\AppData/); assert.match(preview.text, /<email>/); assert.match(preview.text, /submit: 3 entries accepted/);
  assert.ok(preview.bytes <= C.MAX_LOG_BYTES);
  await assert.rejects(s.report({ category: "bug", text: "Pin in the lake", logId: "0".repeat(32) }), /Review the log again/);
  const r = await s.report({ category: "data", text: "  The Peacebloom pin is in the lake.\u202E ", logId: preview.id });
  assert.deepEqual(r, { id: 42 });
  const body = fetch.calls[0].body;
  assert.deepEqual(Object.keys(body).sort(), ["appVersion", "category", "installId", "log", "schema", "text"]);
  assert.equal(body.log, preview.text); assert.equal(body.text, "The Peacebloom pin is in the lake.");
  await s.report({ category: "bug", text: "No log this time" });
  assert.ok(!("log" in fetch.calls[1].body));
  await assert.rejects(s.report({ category: "rant", text: "x" }), /Invalid problem report/);
  await assert.rejects(s.report({ category: "bug", text: "   " }), /1 to 2,000/);
  await assert.rejects(s.report({ category: "bug", text: "x", email: "a@b.c" }), /Invalid problem report/);
  const full = service({ fetch: fakeFetch(() => json(503, { ok: false, error: "report_inbox_full" })) });
  await assert.rejects(full.s.report({ category: "bug", text: "x" }), /inbox is full/);
});

test("log redaction caps at 64 KB and keeps the newest lines", () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const out = redactLog(big, { home: "", username: "" });
  assert.ok(Buffer.byteLength(out) <= 65536);
  assert.match(out, /line 4999 /); assert.ok(!out.includes("line 0 "));
});

test("install id: random UUID v4 created once and kept in the app data folder", () => {
  const dir = tmp();
  const a = new CommunityService({ dir, baseUrl: "https://bf.example.test" });
  const b = new CommunityService({ dir, baseUrl: "https://bf.example.test" });
  assert.match(a.settings.installId, /^[0-9a-f-]{36}$/);
  assert.equal(a.settings.installId, b.settings.installId);
  assert.ok(fs.existsSync(path.join(dir, "community", "settings.json")));
  a.reset();
  assert.notEqual(a.settings.installId, b.settings.installId);
});

test("base URL: the public service by default; BF_COMMUNITY_URL overrides (http only for this machine)", () => {
  assert.equal(C.BASE_URL, "https://bf.backstagecoding.com");
  assert.equal(resolveBaseUrl({}), C.BASE_URL);
  assert.equal(resolveBaseUrl({ BF_COMMUNITY_URL: "http://127.0.0.1:8787/" }), "http://127.0.0.1:8787");
  assert.equal(resolveBaseUrl({ BF_COMMUNITY_URL: "https://staging.example.test/api/" }), "https://staging.example.test/api");
  assert.equal(resolveBaseUrl({ BF_COMMUNITY_URL: "http://evil.example.com" }), C.BASE_URL);
  assert.equal(resolveBaseUrl({ BF_COMMUNITY_URL: "https://user:pw@x.test" }), C.BASE_URL);
});

test("schedule: first pass after 60 s, then every 30 minutes; stop clears the timers", () => {
  const timers = { set: [], cleared: [] };
  const fake = { setTimeout: (fn, ms) => { timers.set.push(["t", ms]); return { ms }; }, setInterval: (fn, ms) => { timers.set.push(["i", ms]); return { ms }; }, clearTimeout: (h) => timers.cleared.push(h), clearInterval: (h) => timers.cleared.push(h) };
  const s = new CommunityService({ dir: tmp(), baseUrl: "https://bf.example.test", timers: fake });
  s.start(); s.start();
  assert.deepEqual(timers.set, [["t", 60000], ["i", 30 * 60000], ["i", 60 * 60000]]);
  s.stop();
  assert.equal(timers.cleared.length, 3);
});

test("IPC validates arguments and asks before forgetting", async () => {
  const { registerCommunityHandlers } = require("../src/core/community-ipc.cjs");
  const handlers = {};
  const calls = [];
  const community = { status: () => ({ share: true }), setSettings: (x) => { calls.push(["set", x]); return { share: x.share }; }, refreshPack: async () => {}, forget: async () => { calls.push(["forget"]); return { removed: {} }; }, reportPreview: () => ({ id: "a".repeat(32), text: "" }), report: async (x) => { calls.push(["report", x]); return { id: 1 }; } };
  let confirm = false;
  registerCommunityHandlers({ handle: (n, fn) => { handlers[n] = fn; }, community, confirmForget: async () => confirm });
  assert.deepEqual(Object.keys(handlers).sort(), ["communityForget", "communityReport", "communityReportPreview", "communityStatus", "setCommunitySettings"]);
  assert.throws(() => handlers.communityStatus(1), /Invalid/);
  for (const bad of [[], [null], [{}], [{ share: 1 }], [{ share: true, extra: true }], [{ share: true }, 2]]) assert.throws(() => handlers.setCommunitySettings(...bad), /Invalid/);
  assert.deepEqual(handlers.setCommunitySettings({ share: false }), { share: false });
  assert.equal((await handlers.communityForget()).cancelled, true);
  assert.ok(!calls.some((c) => c[0] === "forget"));
  confirm = true; await handlers.communityForget();
  assert.ok(calls.some((c) => c[0] === "forget"));
  for (const bad of [[], [{ category: "bug" }], [{ category: "bug", text: 5 }], [{ category: "bug", text: "x", logId: "nope" }], [{ category: "bug", text: "x", log: "raw" }]]) assert.throws(() => handlers.communityReport(...bad), /Invalid/);
  await handlers.communityReport({ category: "bug", text: "x", logId: null });
  // Preload exposes exactly these calls; main lets community messages through.
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8");
  for (const m of ["communityStatus", "setCommunitySettings", "communityForget", "communityReportPreview", "communityReport"]) assert.match(preload, new RegExp(`${m}: \\(`), m);
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  assert.match(main, /name\.startsWith\("community"\) && e\?\.name === "CommunityError"/);
  assert.match(main, /community\?\.reset\(\)/); assert.match(main, /community\?\.stop\(\)/);
});

test("World Map: community spots get their own layer, NPCs only fill gaps; loot browser labels community drops", () => {
  const { communityPins } = require("../src/core/world-map.cjs");
  const idx = indexPack(validatePack(PACK));
  const pins = communityPins(idx, 1429, { staticNpcIds: new Set(), npcName: (id) => (id === 197 ? "Thomas" : null) });
  const nodes = pins.filter((p) => p.kind === "community");
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((p) => p.community && /^Community · \d+ players/.test(p.source) && ["herb", "ore", "chest"].includes(p.gather)));
  assert.deepEqual(nodes.find((p) => p.gather === "herb").itemIds, [2447]);
  assert.equal(pins.find((p) => p.npcId === 197).label, "Thomas");
  assert.equal(communityPins(idx, 1429, { staticNpcIds: new Set([197]) }).filter((p) => p.npcId).length, 0, "bundled NPCs are never duplicated");
  assert.deepEqual(communityPins(null, 1429), []);
  const { instanceLoot, itemCard } = require("../src/core/boss-loot.cjs");
  const pack = { attribution: "x", instances: { rfc: { bosses: [{ name: "Bazzalan", npcIds: [448], items: [{ itemId: 2, chance: 0.5, drops: 10 }] }] } } };
  const loot = instanceLoot(pack, "rfc", { community: idx });
  assert.deepEqual(loot.bosses[0].items.map((x) => x.itemId), [2], "bundled list unchanged");
  assert.equal(loot.bosses[0].community[0].itemId, 1931);
  assert.equal(loot.bosses[0].community[0].source, "Community · 3 players");
  const card = itemCard(pack, 1931, { community: idx });
  assert.deepEqual(card.communitySources.map((s) => [s.name, s.chance, s.source]), [["Bazzalan", 0.3, "Community · 3 players"]]);
  assert.deepEqual(instanceLoot(pack, "rfc", {}).bosses[0].community, []);
});

test("Settings → Community renders the switch, the lists and the reviewed log preview", async () => {
  const vm = require("node:vm");
  const listeners = {}, painted = [];
  const status = { share: true, download: true, blocked: false, installId: "3f2b8c1e", lastSubmitAt: null, lastPackAt: null, retryAt: null, sent: 12, pending: 2, received: { total: 7 }, shares: ["Herb <spots>"], never: ["Character names"], host: "bf.backstagecoding.com" };
  const api = { communityStatus: async () => status, communityReportPreview: async () => ({ id: "a".repeat(32), text: "line <1>", bytes: 8, max: 65536 }) };
  const c = { window: { backstage: api }, queueMicrotask: (fn) => fn(), Date, Number, document: { addEventListener: (k, fn) => { listeners[k] = fn; }, querySelectorAll: () => painted, activeElement: null } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/community.js"), "utf8"), c);
  const V = c.window.CommunityView;
  await new Promise((r) => setImmediate(r));
  const html = V.markup();
  assert.match(html, /<input type="checkbox" data-community-share checked >Share anonymous finds with other players/);
  assert.match(html, /Herb &lt;spots&gt;/); assert.match(html, /Never shared/); assert.match(html, /Forget my contributions/);
  assert.match(html, /2 new finds will be shared/); assert.match(html, /Report a problem/); assert.match(html, /Attach app log/);
  const box = { innerHTML: "", querySelector: () => null };
  painted.push(box);
  await listeners.change({ target: { checked: true, matches: (sel) => sel === "[data-community-attach]" } });
  assert.match(box.innerHTML, /<pre class="community-log"[^>]*>line &lt;1&gt;<\/pre>/);
  assert.equal(V._state().report.attach, true);
});
