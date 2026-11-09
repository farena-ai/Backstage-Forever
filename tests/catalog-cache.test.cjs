"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CatalogCache } = require("../src/core/catalog-cache.cjs");
test("catalog reads deduplicate, expire, and refresh without changing selection", async () => {
  let now = 0,
    calls = 0;
  const cache = new CatalogCache({ now: () => now, ttl: 10 });
  const read = async () => ({ models: [{ id: String(++calls) }] });
  const [a, b] = await Promise.all([
    cache.get("a", read),
    cache.get("a", read),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await cache.get("a", read);
  assert.equal(calls, 1);
  now = 11;
  await cache.get("a", read);
  assert.equal(calls, 2);
  await cache.get("a", read, true);
  assert.equal(calls, 3);
});
test("authentication invalidation rejects late catalogs and cannot repopulate cache", async () => {
  const cache = new CatalogCache();
  let finish;
  const pending = cache.get(
    "a",
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await Promise.resolve();
  cache.clear();
  finish({ models: [{ id: "old" }] });
  await assert.rejects(pending, /changed/);
  const fresh = await cache.get("a", async () => ({ models: [{ id: "new" }] }));
  assert.equal(fresh.models[0].id, "new");
});
