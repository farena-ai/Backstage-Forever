"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { fixture, commit, build } = require("./fixtures/vendor-facts.cjs");
function api() { assert.ok(fs.existsSync(path.join(__dirname, "../src/core/vendor-facts.cjs")), "Strict historical seller API must exist"); return require("../src/core/vendor-facts.cjs"); }
const profile = () => ({ source: { kind: "wow-addon", updatedAt: "2026-11-09T12:00:00.000Z" }, clientBuild: build, faction: "Horde" });
const normalize = raw => api().normalizeVendors(raw, { commit, build });

for (const suffix of ["", "#2", "#9", "#10", "#19", "#20", "#100", "#1000", "#1999"]) {
  const key = `item:2320${suffix}`;
  test(`raw seller listings preserve the canonical ordinal ${key}`, () => {
    const raw = fixture(), entries = raw["vendors.json"].vendors[10].entries;
    entries[key] = entries["item:2320"];
    const pack = normalize(raw);
    assert.ok(pack.vendors[0].listings.some(row => row.key === key));
    assert.equal(pack.counts.droppedListings, 0);
  });
  test(`compiled seller listings accept the canonical ordinal ${key}`, () => {
    const pack = normalize(fixture());
    pack.vendors[0].listings[0].key = key;
    assert.deepEqual(api().validateVendorPack(pack), pack);
  });
}

for (const suffix of ["#0", "#1", "#00", "#01", "#02", "#09", "#010", "#0100"]) {
  const key = `item:2320${suffix}`;
  test(`raw and compiled seller listings reject noncanonical ordinal ${key}`, () => {
    const raw = fixture(), entries = raw["vendors.json"].vendors[10].entries;
    entries[key] = entries["item:2320"];
    const pack = normalize(raw);
    assert.deepEqual(pack.vendors[0].listings.map(row => row.key), ["item:2320"]);
    assert.equal(pack.counts.droppedListings, 1);
    pack.vendors[0].listings[0].key = key;
    assert.throws(() => api().validateVendorPack(pack), /Invalid historical seller data/);
  });
}

test("seller normalizer joins exact positive IDs, names and Merchant evidence; retains only historical facts", () => {
  const pack = normalize(fixture());
  assert.equal(pack.vendors.length, 1); assert.equal(pack.counts.listings, 1);
  assert.deepEqual(pack.vendors[0].listings, [{ key: "item:2320", itemId: 2320, name: "Coarse Thread", sources: 1 }]);
  assert.deepEqual(pack.vendors[0].observedReactionsByFaction, { Horde: [4, 5] });
  assert.equal(pack.vendors[0].reactionSources, 2);
  assert.doesNotMatch(JSON.stringify(pack), /costs|price|stack|stock|side|worldX/);
  assert.deepEqual(api().validateVendorPack(pack), pack);
  for (const mutate of [r => r["npcs.json"].npcs[10].name = "Other", r => r["creatures.json"].creatures[10].name = "Other", r => r["npcs.json"].npcs[10].interactions = [], r => r["vendors.json"].vendors[0] = r["vendors.json"].vendors[10]]) {
    const raw = fixture(); mutate(raw); const p = normalize(raw); assert.ok(p.counts.droppedVendors > 0);
  }
  const raw = fixture(); raw["vendors.json"].vendors[10].entries["item:2321"] = { itemId: 2320, name: "Wrong ID", sources: 1 };
  assert.equal(normalize(raw).counts.droppedListings, 1);
  delete raw["vendors.json"].vendors[10].entries;
  assert.equal(normalize(raw).counts.droppedVendors, 1);
});

test("strict compiled loader rejects malformed schema, counts, dates, IDs, names, positions and reactions", t => {
  const pack = normalize(fixture());
  for (const mutate of [p => p.private = true, p => p.product = "classic", p => p.sourceCommit = "main", p => p.counts.listings++, p => p.vendors[0].id = 0, p => p.vendors[0].name = "x".repeat(201), p => p.vendors[0].lastSeen = "2026-02-30", p => p.vendors[0].lastSeen = "2027-01-01", p => p.vendors[0].positions[0].x = NaN, p => p.vendors[0].positions[0].mapId = 0, p => p.vendors[0].positions[0].worldX = 1, p => p.vendors[0].observedReactionsByFaction.Horde = [9], p => p.vendors[0].reactionSources = 0, p => p.vendors[0].listings[0].key = "item:9", p => p.vendors[0].listings[0].price = 1, p => p.vendors.push(structuredClone(p.vendors[0]))]) {
    const bad = structuredClone(pack); mutate(bad); assert.throws(() => api().validateVendorPack(bad), /Invalid historical seller data/);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-vendor-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pack.json"); fs.writeFileSync(file, JSON.stringify(pack)); assert.deepEqual(api().loadVendorPack(file), pack);
  fs.writeFileSync(file, " ".repeat(1024 * 1024 + 1)); assert.throws(() => api().loadVendorPack(file), /exceeds/);
});

test("default suggestions require exact addon build and nonempty wholly nonhostile observed faction reactions", () => {
  const raw = fixture(), p = profile();
  const facts = () => api().sellerFacts(normalize(raw), p, [2320, 999]);
  assert.equal(facts().rows[0].suggestions.length, 1); assert.equal(facts().rows[1].status, "unobserved");
  assert.match(facts().rows[0].suggestions[0].qualification, /Historical.*nonhostile.*Horde/);
  for (const change of [() => p.faction = "Alliance", () => p.faction = null, () => p.clientBuild = "1.60.1.0", () => delete p.source, () => delete p.source.updatedAt]) {
    Object.assign(p, profile()); change(); const row = facts().rows[0]; assert.equal(row.suggestions.length, 0); assert.equal(row.browse.length, 1); assert.match(row.browse[0].qualification, /unknown|mismatch|saved addon/i);
  }
  Object.assign(p, profile());
  for (const reactions of [{}, { Horde: [] }, { Horde: [3, 5] }, { Horde: [2] }]) { raw["creatures.json"].creatures[10].reactions = reactions; assert.equal(facts().rows[0].suggestions.length, 0); }
  raw["creatures.json"].creatures[10].reactions = { Horde: [5] }; raw["vendors.json"].vendors[10].positions.push({ uiMap: 1457, mapX: .2, mapY: .3 });
  assert.equal(facts().rows[0].suggestions.length, 0); assert.match(facts().rows[0].browse[0].qualification, /multiple maps/);
});

test("seller projection is detached, deterministic, capped at 20 material rows and three unique sellers per row", () => {
  const raw = fixture();
  for (const id of [14, 11, 13, 12]) for (const [file, key] of [["vendors.json", "vendors"], ["npcs.json", "npcs"], ["creatures.json", "creatures"]]) raw[file][key][id] = structuredClone(raw[file][key][10]);
  const pack = normalize(raw), facts = api().sellerFacts(pack, profile(), Array.from({ length: 25 }, (_, i) => i === 0 ? 2320 : i));
  assert.equal(facts.rows.length, 20); assert.deepEqual(facts.rows[0].suggestions.map(v => v.id), [10, 11, 12]);
  assert.equal(facts.rows[0].observedSellerCount, 5); assert.equal(facts.rows[0].browse.length, 0);
  facts.rows[0].suggestions[0].positions[0].x = 1; assert.equal(pack.vendors[0].positions[0].x, .4);
  assert.equal(JSON.stringify(normalize(raw)), JSON.stringify(normalize(Object.fromEntries(Object.entries(raw).reverse()))));
});

test("compiler source/meta/license/build/schema and size guards remain bounded", () => {
  for (const [key, val] of [["license", "unknown"], ["clientBuild", "bad"], ["product", "classic"], ["schemaVersion", 2], ["dataset", "other"], ["attribution", "missing"], ["sources", 0]]) { const raw = fixture(); raw["vendors.json"].meta[key] = val; assert.throws(() => normalize(raw)); }
  const raw = fixture(); raw["vendors.json"] = " ".repeat(1024 * 1024 + 1); assert.throws(() => normalize(raw), /exceeds/);
  assert.throws(() => api().normalizeVendors(fixture(), { commit: "main", build }));
  const positions = fixture(); positions["vendors.json"].vendors[10].positions = Array.from({ length: 101 }, () => ({ uiMap: 1, mapX: .1, mapY: .1 })); assert.throws(() => normalize(positions));
  const vendors = fixture(); vendors["vendors.json"].vendors = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i + 1, vendors["vendors.json"].vendors[10]])); assert.throws(() => normalize(vendors));
  const listings = fixture(); listings["vendors.json"].vendors[10].entries = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`item:${i + 1}`, { itemId: i + 1, name: "Item", sources: 1 }])); assert.throws(() => normalize(listings));
});

test("compiled dropped counts cannot contradict the bounded source totals", () => {
  for (const change of [p => p.counts.droppedVendors = 1000, p => p.counts.droppedListings = 10000, p => p.counts.droppedPositions = 100001]) {
    const pack = normalize(fixture()); change(pack); assert.throws(() => api().validateVendorPack(pack), /Invalid historical seller data/);
  }
});
