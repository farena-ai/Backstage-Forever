"use strict";
// The app's community client against the real community server (community-server/), booted on a
// random local port with a temp database: proves the payloads match CLIENT-CONTRACT.md.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
let sqlite = true;
try { require("node:sqlite"); } catch { sqlite = false; }
const { CommunityService, resolveBaseUrl } = require("../src/core/community.cjs");

function profile(seed) {
  const build = "1.60.1.70888", x = 0.4512 + seed * 0.0003, y = 0.6024;
  return [{
    id: `wow-${seed}`, name: `Hero${seed}`, realm: "Draenor-EU", className: "Druid", level: 20,
    source: { kind: "wow-addon", id: `Player-1-${seed}`, updatedAt: "2026-11-12T10:00:00.000Z" }, clientBuild: build,
    gathering: { records: [{ id: `wowf:herbalism:1617:1413:${Math.floor(x * 10000 + 0.5)}:${Math.floor(y * 10000 + 0.5)}:${build}`, method: "herbalism", entityId: 1617, itemIds: [2447], mapId: 1413, x, y, observedAt: "2026-11-12T10:00:00.000Z", clientBuild: build, name: "Peacebloom", evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true }] },
    lootSources: { schemaVersion: 1, items: [{ itemId: 4862, questIds: [789], lastSeen: "2026-11-12T10:00:00.000Z", sources: [{ kind: "creature", id: 3124, count: 2, lastSeen: "2026-11-12T10:00:00.000Z", positions: [{ mapId: 1411, x: 0.4471, y: 0.2433 }] }] }] },
  }];
}

test("submit, pack, report and forget against the real community server", { skip: !sqlite && "node:sqlite unavailable" }, async (t) => {
  const { Store } = require("../community-server/lib/store");
  const { createApp } = require("../community-server/lib/app");
  const { loadConfig } = require("../community-server/lib/config");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-community-contract-"));
  const store = new Store(path.join(dir, "community.db"));
  const { server } = createApp({ store, config: loadConfig({}, { salt: "test-salt-0123456789abcdef0123456789abcdef", packRebuildMs: 0 }), log: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => { await new Promise((r) => server.close(r)); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const baseUrl = resolveBaseUrl({ BF_COMMUNITY_URL: `http://127.0.0.1:${server.address().port}` });

  const installs = [1, 2, 3].map((seed) => new CommunityService({ dir: fs.mkdtempSync(path.join(dir, "app-")), getProfiles: () => profile(seed), appVersion: "0.34.0", baseUrl }));
  for (const c of installs) assert.deepEqual(await c.submit(), { status: "sent", sent: 2 });

  const reader = installs[0];
  assert.equal((await reader.refreshPack()).status, "updated");
  const idx = reader.index();
  const herbs = idx.nodesByMap.get(1413);
  assert.deepEqual(herbs.map((n) => [n.kind, n.objectId, n.x, n.y, n.installs]), [["herb", 1617, 0.45, 0.6, 3]]);
  assert.deepEqual(herbs[0].items, [{ itemId: 2447, installs: 3 }]);
  assert.deepEqual(idx.npcPositions.get(3124), [{ mapId: 1411, x: 0.445, y: 0.245, installs: 3 }]);
  assert.ok(!fs.readFileSync(path.join(reader.dir, "pack.json"), "utf8").includes("Hero"));
  // Same content: the stored ETag gets a 304.
  assert.equal((await reader.refreshPack({ force: true })).status, "unchanged");

  const preview = reader.reportPreview();
  const sent = await reader.report({ category: "data", text: "The Peacebloom pin is in the lake.", logId: preview.id });
  assert.ok(Number.isSafeInteger(sent.id));

  const forgotten = await installs[2].forget();
  assert.ok(forgotten.removed.observations >= 2);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM obs").get().n > 0, true, "other installs keep their facts");
});
