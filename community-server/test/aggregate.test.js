"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { Store, hashInstall } = require("../lib/store");
const { PackCache, buildPackData, aggregateDrops } = require("../lib/pack");
const { validateSubmit } = require("../lib/validate");
const { SALT, uuid, submit } = require("./helpers");

function freshStore() { return new Store(":memory:"); }
function send(store, installId, observations) {
  const sub = validateSubmit(submit(installId, observations));
  return store.recordSubmission(hashInstall(SALT, sub.installId), sub);
}

test("install ids are stored only as salted hashes", () => {
  const store = freshStore(), id = uuid();
  send(store, id, { npcs: [{ npcId: 1, mapId: 2, x: 0.5, y: 0.5 }] });
  const rows = store.db.prepare("SELECT install FROM obs").all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].install, id);
  assert.match(rows[0].install, /^[0-9a-f]{64}$/);
  assert.equal(rows[0].install, hashInstall(SALT, id.toUpperCase()));
  assert.notEqual(hashInstall("another-salt-0123456789abcdef0123456789", id), rows[0].install);
});

test("k-anonymity: a fact is published only once 3 distinct installs agree", () => {
  const store = freshStore();
  const npc = (x) => ({ npcs: [{ npcId: 197, mapId: 1429, x, y: 0.4185 }] });
  const a = uuid(), b = uuid(), c = uuid();
  send(store, a, npc(0.4826));
  for (let i = 0; i < 10; i++) send(store, b, npc(0.4826)); // repeats from one install do not count
  assert.equal(buildPackData(store, 3).npcs.rows.length, 0);
  // 0.4826*200 = 96.52 -> cell 97, but 0.4812*200 = 96.24 -> cell 96: a different spot.
  send(store, c, npc(0.4812));
  assert.equal(buildPackData(store, 3).npcs.rows.length, 0);
  send(store, c, npc(0.4830)); // 96.6 -> cell 97: same spot as a and b
  assert.deepEqual(buildPackData(store, 3).npcs.rows, [[197, 1429, 0.485, 0.42, 3]]);
});

test("nodes, node items, vendors and recipes aggregate per pairing", () => {
  const store = freshStore();
  const ids = [uuid(), uuid(), uuid()];
  ids.forEach((id, i) => send(store, id, {
    nodes: [
      { kind: "herb", objectId: 1617, mapId: 1429, x: 0.45, y: 0.6, itemIds: i < 2 ? [2447] : [2447, 765] },
      { kind: "ore", name: "Copper Vein", mapId: 1429, x: 0.3, y: 0.3 },
    ],
    vendors: [{ npcId: 1213, itemIds: i === 0 ? [159] : [159, 4540] }],
    recipes: [{ source: "vendor", npcId: 1250, itemId: 2889 }, { source: "trainer", npcId: 1215, spellId: 2330 }],
  }));
  const p = buildPackData(store, 3);
  assert.deepEqual(p.nodes.rows, [
    ["herb", 1617, null, 1429, 0.45, 0.6, 3],
    ["ore", null, "Copper Vein", 1429, 0.3, 0.3, 3],
  ]);
  assert.deepEqual(p.nodeItems.rows, [["herb", 1617, null, 2447, 3]]); // 765 seen by only one install
  assert.deepEqual(p.vendors.rows, [[1213, 159, 3]]); // 4540 seen by only two
  assert.deepEqual(p.recipes.rows, [["trainer", 1215, 2330, null, 3], ["vendor", 1250, null, 2889, 3]]);
});

test("drop rates are pooled across installs with a per-install cap", () => {
  const store = freshStore();
  const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
  send(store, a, { drops: [{ npcId: 448, loots: 10, items: [{ itemId: 1931, count: 2 }] }] });
  send(store, a, { drops: [{ npcId: 448, loots: 10, items: [{ itemId: 1931, count: 2 }] }] }); // a: 4/20
  send(store, b, { drops: [{ npcId: 448, loots: 20, items: [{ itemId: 1931, count: 6 }] }] }); // b: 6/20
  assert.equal(buildPackData(store, 3).drops.rows.length, 0);
  // c looted without seeing the item: counts toward the denominator but not the pairing.
  send(store, c, { drops: [{ npcId: 448, loots: 20, items: [] }] });
  assert.equal(buildPackData(store, 3).drops.rows.length, 0);
  send(store, d, { drops: [{ npcId: 448, loots: 20, items: [{ itemId: 1931, count: 5 }] }] }); // d: 5/20
  assert.deepEqual(buildPackData(store, 3).drops.rows, [[448, 1931, 0.25, 60, 3]]); // 15/60
});

test("aggregateDrops caps one heavy install and ignores rows without loots", () => {
  const rows = [
    { key: "1|2", install: "a", hits: 1000, loots: 1000 }, // capped to 500/500
    { key: "1|2", install: "b", hits: 0, loots: 250 },
    { key: "1|2", install: "c", hits: 50, loots: 250 },
    { key: "1|2", install: "d", hits: 5, loots: 0 }, // no denominator
  ];
  assert.deepEqual(aggregateDrops(rows, 3), [[1, 2, 0.55, 1000, 3]]);
  assert.deepEqual(aggregateDrops(rows.slice(1), 3), []);
});

test("pack: stable version/ETag, gzip round trip, lazy rebuild throttle", () => {
  const store = freshStore();
  let clock = 1_000_000;
  const cache = new PackCache(store, { minInstalls: 3, rebuildMs: 60_000, now: () => clock });
  const first = cache.get();
  assert.equal(JSON.parse(first.body).format, 1);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(first.gzip)), JSON.parse(first.body));
  assert.equal(first.etag, `"${first.version}"`);

  // Unpublishable data changes the revision but not the content: same version and generatedAt.
  send(store, uuid(), { npcs: [{ npcId: 5, mapId: 1, x: 0.1, y: 0.1 }] });
  clock += 60_000;
  const second = cache.get();
  assert.equal(second.version, first.version);
  assert.equal(second.generatedAt, first.generatedAt);

  for (let i = 0; i < 3; i++) send(store, uuid(), { vendors: [{ npcId: 9, itemIds: [10] }] });
  clock += 1000; // within throttle: still the old pack
  assert.equal(cache.get().version, first.version);
  clock += 60_000;
  const third = cache.get();
  assert.notEqual(third.version, first.version);
  assert.deepEqual(JSON.parse(third.body).vendors.rows, [[9, 10, 3]]);
  assert.equal(third.counts.vendors, 1);
});

test("purge removes an install's contributions and can block it", () => {
  const store = freshStore();
  const ids = [uuid(), uuid(), uuid()];
  for (const id of ids) send(store, id, { vendors: [{ npcId: 9, itemIds: [10] }] });
  assert.equal(buildPackData(store, 3).vendors.rows.length, 1);
  const h = hashInstall(SALT, ids[0]);
  assert.deepEqual(store.purgeInstall(h, { block: true }), { observations: 1, reports: 0, blocked: true });
  assert.equal(store.isBlocked(h), true);
  assert.equal(buildPackData(store, 3).vendors.rows.length, 0);
});
