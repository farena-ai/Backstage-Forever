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
    lootSources: { schemaVersion: 1, items: [{ itemId: 4862, questIds: [789], lastSeen: "2026-11-12T10:00:00.000Z", sources: [{ kind: "creature", id: 3124, name: "Scorpid Worker", count: 2, lastSeen: "2026-11-12T10:00:00.000Z", positions: [{ mapId: 1411, x: 0.4471, y: 0.2433 }] },
      { kind: "object", id: 3640, name: "Laden Mushroom", count: 1, lastSeen: "2026-11-12T10:00:00.000Z", positions: [{ mapId: 1411, x: 0.3, y: 0.3 }] }] }] },
    locale: "enUS",
    wares: { version: 1, vendors: [{ npcId: 3158, name: "Duokna", itemIds: [159, 4540], seenAt: 1700000000, mapId: 1411, x: 0.5212, y: 0.4188 }] },
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
  // Vendor stock goes out from the first submit on; the fields of pack format minor 1 wait for a pack that says so.
  for (const c of installs) assert.deepEqual(await c.submit(), { status: "sent", sent: 4 });
  const today = new Date().toISOString().slice(0, 10);

  const reader = installs[0];
  assert.equal((await reader.refreshPack()).status, "updated");
  const idx = reader.index();
  const herbs = idx.nodesByMap.get(1413);
  assert.deepEqual(herbs.map((n) => [n.kind, n.objectId, n.x, n.y, n.installs]), [["herb", 1617, 0.45, 0.6, 3]]);
  assert.deepEqual(herbs[0].items, [{ itemId: 2447, installs: 3 }]);
  assert.deepEqual(idx.npcPositions.get(3124), [{ mapId: 1411, x: 0.445, y: 0.245, installs: 3, firstSeen: today, lastSeen: today }]);
  assert.deepEqual(idx.vendors.get(3158), [{ itemId: 159, installs: 3, firstSeen: today, lastSeen: today }, { itemId: 4540, installs: 3, firstSeen: today, lastSeen: today }]);
  assert.deepEqual([idx.minor, idx.perFactDates, idx.npcNames.size, herbs[0].lastSeen], [1, true, 0, today]);
  assert.ok(!fs.readFileSync(path.join(reader.dir, "pack.json"), "utf8").includes("Hero"));
  // Same content: the stored ETag gets a 304.
  assert.equal((await reader.refreshPack({ force: true })).status, "unchanged");

  // Now that the service is known to speak minor 1, names (English clients) and looted objects follow, once.
  for (const c of installs) {
    c.settings.lastAttemptAt = null;
    assert.equal((await c.submit()).status, c === reader ? "sent" : "nothing", "an install that has not seen a minor-1 pack sends none of the newer fields");
    if (c === reader) continue;
    await c.refreshPack();
    c.settings.lastAttemptAt = null;
    assert.deepEqual(await c.submit(), { status: "sent", sent: 3 }, "the creature and the vendor again with their names, and the object");
    c.settings.lastAttemptAt = null;
    assert.equal((await c.submit()).status, "nothing");
  }
  assert.equal((await reader.refreshPack({ force: true })).status, "updated");
  const idx2 = reader.index();
  assert.deepEqual([...idx2.npcNames], [[3124, { name: "Scorpid Worker", installs: 3 }], [3158, { name: "Duokna", installs: 3 }]]);
  assert.deepEqual(idx2.nodesByMap.get(1411).map((n) => [n.kind, n.objectId, n.x, n.y, n.installs, n.items]), [["object", 3640, 0.3, 0.3, 3, [{ itemId: 4862, installs: 3 }]]]);
  const packText = fs.readFileSync(path.join(reader.dir, "pack.json"), "utf8");
  for (const secret of ["Hero", "Draenor", "Druid", "Player-1-", "Peacebloom", "T10:00"]) assert.ok(!packText.includes(secret), secret);
  // An app from before minor 1 asks without ?v=2 and still gets a pack its own validator accepts.
  const oldPack = await (await fetch(`${baseUrl}/v1/pack`)).json();
  const old = require("../community-server/test/fixtures/app-1.26-validate-pack").validatePack(oldPack);
  assert.deepEqual([old.nodes.length, old.npcs.length, old.vendors.length], [1, 2, 2]);
  assert.ok(!/object"|Seen|Scorpid|Duokna|minor/.test(JSON.stringify(oldPack)));

  // "From you": each install is told only what it sent itself.
  assert.equal(reader.index().mine, null, "not asked yet");
  assert.deepEqual(await reader.refreshMine(), { status: "updated", count: 6 });
  assert.deepEqual([...reader.index().mine].sort(), ["herb:1617:1413:0.45:0.6", "npc:3124:1411:0.445:0.245", "npc:3158:1411:0.52:0.42", "object:3640:1411:0.3:0.3", "vendor:3158:159", "vendor:3158:4540"]);
  const { communityPins, communitySummary } = require("../src/core/world-map.cjs");
  const pins = communityPins(reader.index(), 1411, { mine: reader.index().mine });
  assert.deepEqual(pins.map((p) => [p.layer, p.label, p.yours, p.ageDays, p.communityName === true]), [["c-object", "Object", true, 0, false], ["c-npc", "Scorpid Worker", true, 0, true], ["c-vendor", "Duokna", true, 0, true]],
    "the vendor is placed where its window was opened");
  assert.match(pins[1].sub, /^Seen here · seen today by 3 players · name from the community$/);
  assert.equal(communitySummary(reader.index(), pins).yoursExact, true);

  const preview = reader.reportPreview();
  const sent = await reader.report({ category: "data", text: "The Peacebloom pin is in the lake.", logId: preview.id });
  assert.ok(Number.isSafeInteger(sent.id));

  assert.equal((await installs[2].refreshMine()).status, "updated");
  const forgotten = await installs[2].forget();
  assert.ok(forgotten.removed.observations >= 2);
  // Forget takes the "from you" list with it, here and on the server, and the names fall back below three installs.
  assert.equal(installs[2].mine, null);
  assert.equal(fs.existsSync(path.join(installs[2].dir, "mine.json")), false);
  installs[2].settings.sentTotal = 1; // pretend something was shared so the question is asked at all
  assert.deepEqual(await installs[2].refreshMine({ force: true }), { status: "updated", count: 0 });
  const after = await (await fetch(`${baseUrl}/v1/pack?v=2`)).json();
  assert.deepEqual([after.npcNames.rows, after.nodes.rows, after.npcs.rows], [[], [], []]);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM obs").get().n > 0, true, "other installs keep their facts");
});
