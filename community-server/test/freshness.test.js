"use strict";
// Pack format minor 1: first/last seen days, NPC names, the "object" kind, POST /v1/mine, and the
// promise that apps released before it keep getting a pack they accept.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { Store, hashInstall, SCHEMA_VERSION } = require("../lib/store");
const { PackCache, buildPackData } = require("../lib/pack");
const { validateSubmit, validateMine, packVariant, ValidationError } = require("../lib/validate");
const { validatePack: oldAppValidatePack } = require("./fixtures/app-1.26-validate-pack");
const { SALT, T0, DAY, uuid, submit, boot, post, tempDb, asSchema3 } = require("./helpers");

function send(store, installId, observations, now = T0) {
  const sub = validateSubmit(submit(installId, observations));
  return store.recordSubmission(hashInstall(SALT, sub.installId), sub, now);
}
const invalid = (fn, re) => assert.throws(fn, (e) => e instanceof ValidationError && re.test(e.message));

test("first and last seen: the earliest and latest UTC day any install reported the fact, day precision only", () => {
  const store = new Store(":memory:"), ids = [uuid(), uuid(), uuid()];
  const obs = { nodes: [{ kind: "herb", objectId: 1617, mapId: 1429, x: 0.45, y: 0.6 }], npcs: [{ npcId: 197, mapId: 1429, x: 0.485, y: 0.42 }], vendors: [{ npcId: 1213, itemIds: [159] }] };
  send(store, ids[0], obs, T0 - 9 * DAY);
  send(store, ids[1], obs, T0 - 4 * DAY);
  assert.equal(buildPackData(store, 3, 2).nodes.rows.length, 0, "two installs publish nothing, dates included");
  send(store, ids[2], obs, T0 - 2 * DAY + 3_600_000);
  const p = buildPackData(store, 3, 2);
  assert.deepEqual(p.nodes.columns, ["kind", "objectId", "name", "mapId", "x", "y", "installs", "firstSeen", "lastSeen"]);
  assert.deepEqual(p.nodes.rows, [["herb", 1617, null, 1429, 0.45, 0.6, 3, "2026-11-15", "2026-11-22"]]);
  assert.deepEqual(p.npcs.rows, [[197, 1429, 0.485, 0.42, 3, "2026-11-15", "2026-11-22"]]);
  assert.deepEqual(p.vendors.rows, [[1213, 159, 3, "2026-11-15", "2026-11-22"]]);
  // The same install seeing it again later moves lastSeen, never firstSeen, and adds no reporter.
  send(store, ids[0], obs, T0);
  assert.deepEqual(buildPackData(store, 3, 2).npcs.rows, [[197, 1429, 0.485, 0.42, 3, "2026-11-15", "2026-11-24"]]);
  for (const row of [...p.nodes.rows, ...p.npcs.rows, ...p.vendors.rows]) for (const v of row.slice(-2)) assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(JSON.stringify(buildPackData(store, 3, 2)), /T\d\d:\d\d/, "no time of day anywhere");
});

test("the default pack is byte-for-byte the old shape and the 1.26 validator accepts both packs' data", () => {
  const store = new Store(":memory:"), ids = [uuid(), uuid(), uuid()];
  for (const id of ids) send(store, id, {
    nodes: [{ kind: "herb", objectId: 1617, mapId: 1429, x: 0.45, y: 0.6, itemIds: [2447] }, { kind: "object", objectId: 2843, mapId: 1429, x: 0.3, y: 0.3, itemIds: [752] }],
    npcs: [{ npcId: 197, mapId: 1429, x: 0.485, y: 0.42, name: "Marshal McBride" }],
    vendors: [{ npcId: 1213, itemIds: [159], name: "Godric Rothgar" }],
    drops: [{ npcId: 448, loots: 10, items: [{ itemId: 1931, count: 3 }] }],
    recipes: [{ source: "trainer", npcId: 1215, spellId: 2330 }],
  });
  const cache = new PackCache(store, { minInstalls: 3, rebuildMs: 0, now: () => T0 });
  const v1 = JSON.parse(cache.get().body), v2 = JSON.parse(cache.get(2).body);
  // Default: exactly the keys and columns of pack format 1 as first shipped.
  assert.deepEqual(Object.keys(v1), ["format", "version", "generatedAt", "minInstalls", "coordStep", "nodes", "nodeItems", "npcs", "vendors", "drops", "recipes"]);
  assert.deepEqual(v1.nodes, { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs"], rows: [["herb", 1617, null, 1429, 0.45, 0.6, 3]] });
  assert.deepEqual(v1.nodeItems.rows, [["herb", 1617, null, 2447, 3]]);
  assert.deepEqual(v1.npcs, { columns: ["npcId", "mapId", "x", "y", "installs"], rows: [[197, 1429, 0.485, 0.42, 3]] });
  assert.deepEqual(v1.vendors, { columns: ["npcId", "itemId", "installs"], rows: [[1213, 159, 3]] });
  assert.doesNotMatch(JSON.stringify(v1), /object"|Seen|McBride|Rothgar|minor/);
  const old = oldAppValidatePack(v1);
  assert.equal(old.nodes.length, 1);
  assert.equal(old.npcs.length, 1);
  // The new shape is asked for explicitly and carries the additions.
  assert.equal(v2.format, 1);
  assert.equal(v2.minor, 1);
  assert.deepEqual(v2.nodes.rows.map((r) => r[0]), ["herb", "object"]);
  assert.deepEqual(v2.nodeItems.rows, [["herb", 1617, null, 2447, 3], ["object", 2843, null, 752, 3]]);
  assert.deepEqual(v2.npcNames, { columns: ["npcId", "name", "installs"], rows: [[197, "Marshal McBride", 3], [1213, "Godric Rothgar", 3]] });
  assert.notEqual(cache.get().etag, cache.get(2).etag);
  // Why the default must stay: the 1.26 app throws on a kind it does not know (it would keep its
  // last good pack and never update again), while extra columns alone would have been fine.
  assert.throws(() => oldAppValidatePack(v2), /nodes\[1\]\.kind/);
  const noObject = { ...v2, nodes: { ...v2.nodes, rows: v2.nodes.rows.filter((r) => r[0] !== "object") }, nodeItems: { ...v2.nodeItems, rows: v2.nodeItems.rows.filter((r) => r[0] !== "object") } };
  assert.equal(oldAppValidatePack(noObject).nodes.length, 1);
});

test("NPC names: published only when 3 installs sent the same name for the same id", () => {
  const store = new Store(":memory:");
  const a = uuid(), b = uuid(), c = uuid(), d = uuid();
  const named = (name) => ({ npcs: [{ npcId: 197, mapId: 1429, x: 0.485, y: 0.42, ...(name ? { name } : {}) }] });
  send(store, a, named("Marshal McBride"));
  for (let i = 0; i < 5; i++) send(store, b, named("Marshal McBride")); // repeats from one install do not count
  send(store, c, named("Pet Name Someone Typed"));
  let p = buildPackData(store, 3, 2);
  assert.equal(p.npcs.rows.length, 1, "the place itself has three reporters");
  assert.deepEqual(p.npcNames.rows, [], "but no name has");
  assert.doesNotMatch(JSON.stringify(p), /McBride|Typed/);
  send(store, d, named("Marshal McBride"));
  p = buildPackData(store, 3, 2);
  assert.deepEqual(p.npcNames.rows, [[197, "Marshal McBride", 3]]);
  assert.doesNotMatch(JSON.stringify(p), /Typed/);
  // A second name reaching k does not win over the more common one; one row per id.
  for (const id of [uuid(), uuid()]) send(store, id, named("Marshall McBride"));
  send(store, c, named("Marshall McBride"));
  assert.deepEqual(buildPackData(store, 3, 2).npcNames.rows, [[197, "Marshal McBride", 3]]);
  send(store, uuid(), named("Marshall McBride"));
  assert.deepEqual(buildPackData(store, 3, 2).npcNames.rows, [[197, "Marshall McBride", 4]]);
  // Names from a vendor entry count for the same id, once per install and submission.
  const v = new Store(":memory:");
  for (const id of [a, b, c]) assert.equal(send(v, id, { vendors: [{ npcId: 1213, itemIds: [159, 4540], name: "Godric Rothgar" }], npcs: [{ npcId: 1213, mapId: 1429, x: 0.4, y: 0.4, name: "Godric Rothgar" }] }), 4);
  assert.deepEqual(buildPackData(v, 3, 2).npcNames.rows, [[1213, "Godric Rothgar", 3]]);
  // Forgetting one install takes the name back below k at the next build.
  v.purgeInstall(hashInstall(SALT, a));
  assert.deepEqual(buildPackData(v, 3, 2).npcNames.rows, []);
});

test("submit validation: names are game strings only, capped, and nothing else new is accepted", () => {
  const base = (extra) => submit(uuid(), { npcs: [{ npcId: 1, mapId: 2, x: 0.5, y: 0.5, ...extra }] });
  assert.equal(validateSubmit(base({ name: "  Marshal   McBride " })).npcs[0].name, "Marshal McBride");
  assert.equal(validateSubmit(base({})).npcs[0].name, undefined);
  invalid(() => validateSubmit(base({ name: "x".repeat(81) })), /npcs\[0\]\.name: must be 1\.\.80/);
  invalid(() => validateSubmit(base({ name: "" })), /name/);
  invalid(() => validateSubmit(base({ name: "Bob|1" })), /not allowed/);
  invalid(() => validateSubmit(base({ name: "a\nb\u202e" })), /not allowed/);
  invalid(() => validateSubmit(base({ name: "<script>" })), /not allowed/);
  invalid(() => validateSubmit(base({ name: 5 })), /must be a string/);
  invalid(() => validateSubmit(base({ character: "Thrall" })), /unknown field/);
  invalid(() => validateSubmit(base({ locale: "enUS" })), /unknown field/);
  invalid(() => validateSubmit(submit(uuid(), { vendors: [{ npcId: 1, itemIds: [2], realm: "X" }] })), /unknown field/);
  invalid(() => validateSubmit(submit(uuid(), { nodes: [{ kind: "object", objectId: 1, mapId: 2, x: 0.5, y: 0.5, skill: 75 }] })), /unknown field/);
  assert.equal(validateSubmit(submit(uuid(), { nodes: [{ kind: "object", objectId: 1, mapId: 2, x: 0.5, y: 0.5 }] })).nodes[0].kind, "object");
  invalid(() => validateSubmit(submit(uuid(), { nodes: [{ kind: "fish", objectId: 1, mapId: 2, x: 0.5, y: 0.5 }] })), /kind/);
  invalid(() => validateMine({ schema: 1 }), /installId: is required/);
  invalid(() => validateMine({ schema: 1, installId: uuid(), map: 1429 }), /unknown field/);
  invalid(() => validateMine({ schema: 1, installId: "not-a-uuid" }), /UUID/);
  const q = (s) => packVariant(new URLSearchParams(s));
  assert.deepEqual([q(""), q("v=1"), q("v=2"), q("v=3"), q("v=2&v=2"), q("x=2"), q("v=02")], [1, 1, 2, 1, 1, 1, 1]);
});

test("the live schema (3) with data: old rows are untouched by the schema 4 upgrade and publish their stored days", () => {
  // The live database as the 1.0.0 server left it: schema 3, rows written by the old code.
  const db = tempDb();
  const old = new Store(db.file);
  const ids = [uuid(), uuid(), uuid()];
  const obs = { npcs: [{ npcId: 197, mapId: 1429, x: 0.485, y: 0.42 }], vendors: [{ npcId: 1213, itemIds: [159] }] };
  ids.forEach((id, i) => send(old, id, obs, T0 - (30 - i * 10) * DAY));
  const before = old.db.prepare("SELECT * FROM obs ORDER BY kind, key, install").all();
  const cols = old.db.prepare("PRAGMA table_info(obs)").all().map((c) => c.name);
  old.close();
  asSchema3(db.file);
  assert.deepEqual(cols, ["kind", "key", "install", "n", "first_day", "last_day"]);
  const raw = new DatabaseSync(db.file);
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 3);
  raw.close();
  // Opening it twice with this server changes nothing and loses nothing.
  for (let pass = 0; pass < 2; pass++) {
    const store = new Store(db.file);
    // Schema 4 only adds the Backstage Live tables; no table or row of schema 3 changes. (Going back to the
    // 1.0.0 server afterwards needs the version number set back: OPERATIONS.md, "Rolling back".)
    assert.equal(SCHEMA_VERSION, 4);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 4);
    assert.deepEqual(store.db.prepare("SELECT * FROM obs ORDER BY kind, key, install").all(), before);
    assert.deepEqual(buildPackData(store, 3, 2).npcs.rows, [[197, 1429, 0.485, 0.42, 3, "2026-10-25", "2026-11-14"]]);
    assert.deepEqual(buildPackData(store, 3, 1).npcs.rows, [[197, 1429, 0.485, 0.42, 3]]);
    assert.deepEqual(store.mine(hashInstall(SALT, ids[0]), 10).rows.map((r) => r.kind), ["npc", "vendor"]);
    store.close();
  }
  db.cleanup();
});

test("HTTP: ?v=2 pack and meta, default unchanged, unknown v falls back to the old shape", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const obs = { nodes: [{ kind: "object", objectId: 2843, mapId: 1429, x: 0.3, y: 0.3 }], npcs: [{ npcId: 197, mapId: 1429, x: 0.4826, y: 0.4185, name: "Marshal McBride" }] };
  for (let i = 0; i < 3; i++) { s.clock.t = T0 + i * DAY; assert.equal((await post(s.base, "/v1/submit", submit(uuid(), obs))).status, 200); }
  const def = await fetch(`${s.base}/v1/pack`), v1 = await fetch(`${s.base}/v1/pack?v=1`), v2 = await fetch(`${s.base}/v1/pack?v=2`), v9 = await fetch(`${s.base}/v1/pack?v=9`);
  const [pd, p1, p2, p9] = await Promise.all([def, v1, v2, v9].map((r) => r.json()));
  assert.deepEqual(p1, pd);
  assert.deepEqual(p9, pd);
  assert.equal(pd.minor, undefined);
  assert.deepEqual(pd.nodes.rows, []);
  assert.deepEqual(pd.npcs.rows, [[197, 1429, 0.485, 0.42, 3]]);
  oldAppValidatePack(pd);
  assert.equal(p2.minor, 1);
  assert.deepEqual(p2.nodes.rows, [["object", 2843, null, 1429, 0.3, 0.3, 3, "2026-11-24", "2026-11-26"]]);
  assert.deepEqual(p2.npcs.rows, [[197, 1429, 0.485, 0.42, 3, "2026-11-24", "2026-11-26"]]);
  assert.deepEqual(p2.npcNames.rows, [[197, "Marshal McBride", 3]]);
  assert.equal(v2.headers.get("etag"), `"${p2.version}"`);
  assert.notEqual(v2.headers.get("etag"), def.headers.get("etag"));
  assert.equal((await fetch(`${s.base}/v1/pack?v=2`, { headers: { "If-None-Match": v2.headers.get("etag") } })).status, 304);
  assert.equal((await fetch(`${s.base}/v1/pack?v=2`, { headers: { "If-None-Match": def.headers.get("etag") } })).status, 200);
  const m1 = await (await fetch(`${s.base}/v1/pack/meta`)).json(), m2 = await (await fetch(`${s.base}/v1/pack/meta?v=2`)).json();
  assert.deepEqual([m1.version, m1.minor, m1.counts.nodes, m1.counts.npcNames], [pd.version, undefined, 0, undefined]);
  assert.deepEqual([m2.version, m2.minor, m2.counts.nodes, m2.counts.npcNames], [p2.version, 1, 1, 1]);
  const h = await (await fetch(`${s.base}/v1/health`)).json();
  assert.deepEqual([h.packFormat, h.packMinor, h.mine], [1, 1, true]);
});

test("POST /v1/mine: only the caller's own facts; unknown, forgotten and blocked ids all look empty", async (t) => {
  const s = await boot({ limits: { minePerInstall: { limit: 6, windowMs: 3_600_000 } } });
  t.after(() => s.close());
  const a = uuid(), b = uuid();
  const mine = async (installId) => { const r = await post(s.base, "/v1/mine", { schema: 1, installId }); return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() }; };
  await post(s.base, "/v1/submit", submit(a, {
    nodes: [{ kind: "herb", objectId: 1617, mapId: 1429, x: 0.4512, y: 0.6021, itemIds: [2447] }, { kind: "ore", name: "Copper Vein", mapId: 1429, x: 0.3, y: 0.3 }],
    npcs: [{ npcId: 197, mapId: 1429, x: 0.4826, y: 0.4185, name: "Marshal McBride" }],
    vendors: [{ npcId: 1213, itemIds: [159, 4540] }],
    drops: [{ npcId: 448, loots: 10, items: [{ itemId: 1931, count: 3 }] }],
    recipes: [{ source: "trainer", npcId: 1215, spellId: 2330 }],
  }));
  await post(s.base, "/v1/submit", submit(b, { npcs: [{ npcId: 6, mapId: 1429, x: 0.1, y: 0.1 }, { npcId: 7, mapId: 1411, x: 0.2, y: 0.2 }] }));
  const ra = await mine(a);
  assert.equal(ra.status, 200);
  assert.equal(ra.cache, "no-store");
  assert.deepEqual(ra.body, {
    ok: true, total: 5, truncated: false,
    counts: { 1429: { herb: 1, ore: 1, npc: 1 } },
    keys: {
      nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y"], rows: [["herb", 1617, null, 1429, 0.45, 0.6], ["ore", null, "Copper Vein", 1429, 0.3, 0.3]] },
      npcs: { columns: ["npcId", "mapId", "x", "y"], rows: [[197, 1429, 0.485, 0.42]] },
      vendors: { columns: ["npcId", "itemId"], rows: [[1213, 159], [1213, 4540]] },
    },
  });
  // B sees only B. Nothing of A's appears, and no install id or hash is ever echoed.
  const rb = await mine(b);
  assert.deepEqual(rb.body.keys.npcs.rows, [[6, 1429, 0.1, 0.1], [7, 1411, 0.2, 0.2]]);
  assert.deepEqual(rb.body.counts, { 1411: { npc: 1 }, 1429: { npc: 1 } });
  assert.deepEqual(rb.body.keys.nodes.rows, []);
  assert.doesNotMatch(JSON.stringify(rb.body), /1617|Copper|1213|McBride/);
  for (const r of [ra, rb]) assert.doesNotMatch(JSON.stringify(r.body), new RegExp(`${a}|${b}|${hashInstall(SALT, a)}|${hashInstall(SALT, b)}|[0-9a-f]{32}`));
  // An id the server never saw: the same 200 and the same shape, just empty.
  const empty = { ok: true, total: 0, truncated: false, counts: {}, keys: { nodes: { columns: ra.body.keys.nodes.columns, rows: [] }, npcs: { columns: ra.body.keys.npcs.columns, rows: [] }, vendors: { columns: ra.body.keys.vendors.columns, rows: [] } } };
  const unknown = await mine(uuid());
  assert.deepEqual([unknown.status, unknown.body], [200, empty]);
  // A blocked install gets the same empty answer (not the 403 that submit gives).
  s.store.blockInstall(hashInstall(SALT, b));
  assert.deepEqual((await mine(b)).body, empty);
  // Forget removes it here too.
  assert.equal((await post(s.base, "/v1/forget", { schema: 1, installId: a })).status, 200);
  assert.deepEqual((await mine(a)).body, empty);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM obs WHERE install = ?").get(hashInstall(SALT, a)).c, 0);
  // Strict body, own rate limit per install, and nothing identifying in the log.
  assert.equal((await post(s.base, "/v1/mine", { schema: 1, installId: a, mapId: 1429 })).status, 400);
  assert.equal((await post(s.base, "/v1/mine", { schema: 1, installId: "nope" })).status, 400);
  assert.equal((await fetch(`${s.base}/v1/mine`)).status, 405);
  const c = uuid();
  for (let i = 0; i < 6; i++) assert.equal((await mine(c)).status, 200);
  const limited = await post(s.base, "/v1/mine", { schema: 1, installId: c });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.ok(s.logs.every((l) => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(l)), s.logs.join("\n"));
  assert.ok(s.logs.some((l) => / POST \/v1\/mine 200 /.test(l)));
});

test("/v1/mine is bounded: at most LIMITS.mineKeys keys, with the real total and a truncated flag", () => {
  const store = new Store(":memory:"), id = uuid(), hash = hashInstall(SALT, id);
  const npcs = Array.from({ length: 500 }, (_, i) => ({ npcId: i + 1, mapId: 1429, x: 0.5, y: 0.5 }));
  send(store, id, { npcs });
  const r = store.mine(hash, 120);
  assert.equal(r.rows.length, 120);
  assert.equal(r.total, 500);
  assert.equal(store.mine(hashInstall(SALT, uuid()), 120).total, 0);
});
