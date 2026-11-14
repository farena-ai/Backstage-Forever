"use strict";
// Boots the real HTTP server on a random port with a temp database.
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const http = require("node:http");
const { Store, hashInstall } = require("../lib/store");
const { createApp } = require("../lib/app");
const { SALT, uuid, tempDb, submit, testConfig } = require("./helpers");

async function boot(configOverrides = {}) {
  const db = tempDb();
  const store = new Store(db.file);
  const logs = [];
  const { server } = createApp({ store, config: testConfig(configOverrides), log: (l) => logs.push(l) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, store, logs,
    async close() { await new Promise((r) => server.close(r)); store.close(); db.cleanup(); },
  };
}

function post(base, path, body, headers = {}) {
  return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

// fetch() always decompresses; use http.get to see the raw gzip bytes.
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

test("submit -> publish -> pack, with ETag, gzip and 304", async (t) => {
  const s = await boot();
  t.after(() => s.close());

  const health = await fetch(`${s.base}/v1/health`);
  assert.equal(health.status, 200);
  const h = await health.json();
  assert.equal(h.ok, true);
  assert.equal(h.service, "bf-community");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("cache-control"), "no-store");

  const empty = await (await fetch(`${s.base}/v1/pack/meta`)).json();
  assert.equal(empty.counts.nodes, 0);

  const obs = {
    nodes: [{ kind: "herb", objectId: 1617, mapId: 1429, x: 0.4512, y: 0.6021, itemIds: [2447] }],
    npcs: [{ npcId: 197, mapId: 1429, x: 0.4826, y: 0.4185 }],
    vendors: [{ npcId: 1213, itemIds: [159] }],
    drops: [{ npcId: 448, loots: 10, items: [{ itemId: 1931, count: 3 }] }],
    recipes: [{ source: "trainer", npcId: 1215, spellId: 2330 }],
  };
  for (let i = 0; i < 3; i++) {
    const r = await post(s.base, "/v1/submit", submit(uuid(), obs));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, stored: 7 });
    if (i === 1) {
      const meta = await (await fetch(`${s.base}/v1/pack/meta`)).json();
      assert.equal(meta.counts.nodes, 0, "two installs are not enough");
    }
  }

  const raw = await rawGet(`${s.base}/v1/pack`, { "Accept-Encoding": "gzip" });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers["content-encoding"], "gzip");
  assert.equal(raw.headers["cache-control"], "public, max-age=3600");
  assert.equal(raw.headers.vary, "Accept-Encoding");
  const pack = JSON.parse(zlib.gunzipSync(raw.body));
  assert.equal(pack.format, 1);
  assert.equal(pack.minInstalls, 3);
  assert.equal(raw.headers.etag, `"${pack.version}"`);
  assert.deepEqual(pack.nodes.rows, [["herb", 1617, null, 1429, 0.45, 0.6, 3]]);
  assert.deepEqual(pack.nodeItems.rows, [["herb", 1617, null, 2447, 3]]);
  assert.deepEqual(pack.npcs.rows, [[197, 1429, 0.485, 0.42, 3]]);
  assert.deepEqual(pack.vendors.rows, [[1213, 159, 3]]);
  assert.deepEqual(pack.drops.rows, [[448, 1931, 0.3, 30, 3]]);
  assert.deepEqual(pack.recipes.rows, [["trainer", 1215, 2330, null, 3]]);

  const plain = await rawGet(`${s.base}/v1/pack`, {});
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(plain.body), pack);

  const notModified = await rawGet(`${s.base}/v1/pack`, { "If-None-Match": raw.headers.etag });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body.length, 0);

  const meta = await (await fetch(`${s.base}/v1/pack/meta`)).json();
  assert.equal(meta.version, pack.version);
  assert.equal(meta.counts.drops, 1);
  assert.ok(meta.gzipBytes > 0 && meta.gzipBytes < meta.bytes + 100);

  const head = await fetch(`${s.base}/v1/pack`, { method: "HEAD" });
  assert.equal(head.status, 200);

  // Nothing identifying reached the database or the log.
  const dump = JSON.stringify(s.store.db.prepare("SELECT * FROM obs").all());
  assert.doesNotMatch(dump, /[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.ok(s.logs.every((l) => !/127\.0\.0\.1|[0-9a-f]{8}-[0-9a-f]{4}-/.test(l)), s.logs.join("\n"));
});

test("report is stored for the owner; forget deletes an install's data", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const installId = uuid();
  const r = await post(s.base, "/v1/report", { schema: 1, installId, category: "data", text: "Peacebloom pin is in a lake", appVersion: "0.31.0", build: "1.15.8.66000", log: "[app] started\n[app] pack ok" });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const rows = s.store.listReports();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(s.store.getReport(id).install, hashInstall(SALT, installId));
  assert.equal(s.store.getReport(id).log, "[app] started\n[app] pack ok");

  await post(s.base, "/v1/submit", submit(installId, { npcs: [{ npcId: 1, mapId: 1, x: 0.5, y: 0.5 }] }));
  const f = await post(s.base, "/v1/forget", { schema: 1, installId });
  assert.equal(f.status, 200);
  assert.deepEqual(await f.json(), { ok: true, removed: { observations: 1, reports: 1 } });
  assert.equal(s.store.reportCount(), 0);
});

test("rejects non-JSON, oversized, unknown fields, wrong routes and methods without leaking internals", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = uuid();

  const wrongType = await fetch(`${s.base}/v1/submit`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 415);

  const badJson = await post(s.base, "/v1/submit", "{not json");
  assert.equal(badJson.status, 400);
  assert.deepEqual(await badJson.json(), { ok: false, error: "invalid_json" });

  const unknown = await post(s.base, "/v1/submit", { ...submit(id, { npcs: [{ npcId: 1, mapId: 1, x: 0, y: 0 }] }), realm: "Somewhere" });
  assert.equal(unknown.status, 400);
  const body = await unknown.json();
  assert.equal(body.error, "invalid");
  assert.equal(body.detail, "realm: unknown field");
  assert.doesNotMatch(JSON.stringify(body), /at |\.js:/);

  const big = await post(s.base, "/v1/report", { schema: 1, installId: id, category: "bug", text: "x", appVersion: "1", log: "y".repeat(200 * 1024) });
  assert.equal(big.status, 413);

  assert.equal((await fetch(`${s.base}/v1/nope`)).status, 404);
  assert.equal((await fetch(`${s.base}/`)).status, 404);
  const m = await fetch(`${s.base}/v1/submit`);
  assert.equal(m.status, 405);
  assert.equal(m.headers.get("allow"), "POST");
  assert.equal((await post(s.base, "/v1/pack", {})).status, 405);
});

test("per-install, global and per-IP rate limits return 429 with Retry-After", async (t) => {
  const s = await boot({
    limits: {
      perIp: { limit: 1000, windowMs: 60000 },
      submitPerInstall: { limit: 2, windowMs: 3600000 },
      submitGlobal: { limit: 4, windowMs: 60000 },
      reportPerInstall: { limit: 1, windowMs: 3600000 },
      reportGlobal: { limit: 10, windowMs: 3600000 },
      forgetPerInstall: { limit: 1, windowMs: 3600000 },
    },
  });
  t.after(() => s.close());
  const obs = { npcs: [{ npcId: 1, mapId: 1, x: 0.5, y: 0.5 }] };
  const a = uuid();
  assert.equal((await post(s.base, "/v1/submit", submit(a, obs))).status, 200);
  assert.equal((await post(s.base, "/v1/submit", submit(a, obs))).status, 200);
  const limited = await post(s.base, "/v1/submit", submit(a, obs));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await post(s.base, "/v1/submit", submit(uuid(), obs))).status, 200);
  assert.equal((await post(s.base, "/v1/submit", submit(uuid(), obs))).status, 200);
  assert.equal((await post(s.base, "/v1/submit", submit(uuid(), obs))).status, 429, "global cap");

  const rep = { schema: 1, installId: a, category: "bug", text: "x", appVersion: "1" };
  assert.equal((await post(s.base, "/v1/report", rep)).status, 201);
  assert.equal((await post(s.base, "/v1/report", rep)).status, 429);

  const s2 = await boot({ limits: { ...testConfig().limits, perIp: { limit: 3, windowMs: 60000 } } });
  t.after(() => s2.close());
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s2.base}/v1/health`)).status, 200);
  assert.equal((await fetch(`${s2.base}/v1/health`)).status, 429);
  // Behind the proxy each forwarded client gets its own bucket.
  assert.equal((await fetch(`${s2.base}/v1/health`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).status, 200);
});

test("blocked installs are refused", async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const id = uuid();
  s.store.purgeInstall(hashInstall(SALT, id), { block: true });
  const r = await post(s.base, "/v1/submit", submit(id, { npcs: [{ npcId: 1, mapId: 1, x: 0, y: 0 }] }));
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { ok: false, error: "blocked" });
});
