"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  normalizeData,
  validatePack,
  mergePacks,
  hash,
  MERGE_CAPS,
} = require("../src/core/knowledge.cjs");
const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
const { fixture } = require("./fixtures/forever-facts.cjs");
const NEW = "1.60.1.70888",
  OLD = "1.60.1.70862",
  commit = "c".repeat(40);
function rawFor(build, edit = () => {}) {
  const raw = fixture();
  for (const f of Object.values(raw)) f.meta.clientBuild = build;
  edit(raw);
  return raw;
}
const packFor = (build, edit, c = commit) =>
  normalizeData(rawFor(build, edit), { commit: c, build });

test("merge unions givers, turn-ins, positions and quests; newest build's scalars win", () => {
  const newer = packFor(NEW, (raw) => {
    raw["quests.enUS.json"].quests[1061].title = "Newest Title";
    delete raw["quests.enUS.json"].quests[854];
  });
  const older = packFor(OLD, (raw) => {
    raw["quests.enUS.json"].quests[1061].level = 99;
    raw["quests.enUS.json"].quests[1061].title = "Old Title";
    const npc = raw["npcs.json"].npcs[3216];
    npc.positions.push({ uiMap: 1429, mapX: 0.5, mapY: 0.5 });
    npc.side = "Alliance";
    raw["npcs.json"].npcs[777777] = {
      name: "Older Only",
      sources: 1,
      side: "Alliance",
      positions: [{ uiMap: 1429, mapX: 0.42, mapY: 0.66 }],
      offers: { 1061: { title: "Old Title" } },
      takes: { 1062: { title: "x" } },
    };
    raw["objectives.json"].quests[1062][1].positions.push({ uiMap: 1413, mapX: 0.1, mapY: 0.2 });
  });
  const merged = mergePacks([newer, older]);
  assert.equal(merged.build, NEW);
  assert.deepEqual(merged.builds.map((b) => b.build), [NEW, OLD]);
  assert.deepEqual(merged.files, newer.files);
  // Union: a quest only in the older build survives; refs from both builds are present.
  assert.ok(merged.quests[854]);
  assert.ok(merged.quests[1061].givers.some((g) => g.id === 777777));
  assert.ok(merged.quests[1062].turnIns.some((g) => g.id === 777777));
  assert.ok(merged.quests[1061].sides.includes("Alliance"), "an older build's Alliance giver adds its side");
  for (const side of newer.quests[1061].sides || []) assert.ok(merged.quests[1061].sides.includes(side));
  // Newest wins for scalar facts that it reports; positions are newest-first, deduped.
  assert.equal(merged.quests[1061].title, "Newest Title");
  assert.equal(merged.quests[1061].level, newer.quests[1061].level);
  assert.equal(merged.npcs["npc:3216"].side, newer.npcs["npc:3216"].side ?? "Alliance");
  assert.deepEqual(merged.npcs["npc:3216"].positions.slice(0, newer.npcs["npc:3216"].positions.length), newer.npcs["npc:3216"].positions);
  assert.ok(merged.npcs["npc:3216"].positions.some((p) => p.mapId === 1429 && p.x === 0.5));
  const loc = merged.quests[1062].objectiveLocations.find((o) => o.index === 1);
  assert.equal(loc.positions.length, 2);
  assert.equal(merged.counts.quests, Object.keys(merged.quests).length);
  assert.ok(merged.counts.npcs >= newer.counts.npcs + 1);
  // Merging is idempotent and the result validates.
  assert.deepEqual(validatePack(merged), merged);
  assert.deepEqual(mergePacks([merged, older]).quests, merged.quests);
});

test("merge caps unions at the validator limits and keeps exact dedupe", () => {
  const many = (n, map) => Array.from({ length: n }, (_, i) => ({ uiMap: map, mapX: i / 1000, mapY: 0.5 }));
  const newer = packFor(NEW, (raw) => { raw["npcs.json"].npcs[3216].positions = many(80, 1429); });
  const older = packFor(OLD, (raw) => { raw["npcs.json"].npcs[3216].positions = [...many(80, 1429), ...many(80, 1436)]; });
  const merged = mergePacks([newer, older]);
  const positions = merged.npcs["npc:3216"].positions;
  assert.equal(positions.length, MERGE_CAPS.positions);
  assert.equal(new Set(positions.map((p) => `${p.mapId}:${p.x}:${p.y}`)).size, positions.length);
  assert.ok(positions.slice(0, 80).every((p) => p.mapId === 1429), "newest build's points come first");
});

test("builds metadata is validated: first entry must be the pack itself and duplicates are rejected", () => {
  const merged = mergePacks([packFor(NEW), packFor(OLD)]);
  for (const edit of [
    (p) => { p.builds[0].build = OLD; },
    (p) => { p.builds[1] = structuredClone(p.builds[0]); },
    (p) => { p.builds[1].files["npcs.json"].url = "https://example.invalid/npcs.json"; },
    (p) => { p.builds[1].extra = 1; },
    (p) => { p.builds = []; },
    (p) => { p.builds = Array.from({ length: 13 }, () => p.builds[0]); },
  ]) {
    const p = structuredClone(merged);
    edit(p);
    assert.throws(() => validatePack(p), /Invalid Forever reference data/);
  }
  assert.throws(() => mergePacks([]), /Invalid/);
});

test("the bundled pack merges several client builds and keeps Alliance coverage", () => {
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/source-lock.json"), "utf8"));
  assert.equal(pack.build, "1.60.1.70888");
  assert.deepEqual(pack.builds.map((b) => b.build), lock.builds.map((b) => b.build));
  assert.ok(pack.builds.length >= 3);
  for (const b of lock.builds) for (const f of Object.values(b.files)) assert.equal(f.meta.clientBuild, b.build);
  const atMap = (mapId) => Object.values(pack.npcs).filter((n) => n.positions.some((p) => p.mapId === mapId)).length;
  for (const mapId of [1429, 1436, 1433, 1453, 1438]) assert.ok(atMap(mapId) >= 10, `NPC positions on map ${mapId}`);
});

function service(t, fetcher) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-merge-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return new KnowledgeService({ dataDir, fetcher });
}

test("runtime refresh merges one downloaded build into the bundled multi-build pack (coverage never shrinks)", async (t) => {
  const next = "d".repeat(40);
  const raw = rawFor(NEW, (r) => {
    for (const f of Object.values(r)) f.meta.collectedOn.last = "2026-11-30";
    r["quests.enUS.json"].quests[1061].title = "Refreshed Title";
  });
  const s = service(t, async (url) =>
    url.includes("api.github")
      ? new Response(JSON.stringify({ commit: { sha: next } }))
      : new Response(JSON.stringify(raw[url.split("/").at(-1)])),
  );
  const before = s.bundled.pack;
  s.setContext({ clientBuild: NEW }, false);
  await s.refresh();
  const after = s.index().pack;
  assert.equal(after.sourceCommit, next);
  assert.equal(after.observedThrough, "2026-11-30");
  assert.equal(after.quests[1061].title, "Refreshed Title");
  assert.ok(after.counts.quests >= before.counts.quests);
  assert.ok(after.counts.npcs >= before.counts.npcs);
  for (const key of Object.keys(before.npcs))
    assert.ok(after.npcs[key].positions.length >= before.npcs[key].positions.length, key);
  assert.deepEqual(after.builds.slice(1).map((b) => b.build), before.builds.map((b) => b.build));
  // A restart loads the saved cache merged with the bundled pack, still not shrinking.
  const s2 = new KnowledgeService({ dataDir: s.dataDir, fetcher: async () => { throw Error("offline"); } });
  s2.setContext({ clientBuild: NEW }, false);
  assert.equal(s2.status().sourceCommit, next);
  assert.equal(s2.index().pack.counts.quests, after.counts.quests);
});

test("an older single-build cache from a previous app version is merged with the bundled pack on load", (t) => {
  const s = service(t, async () => { throw Error("offline"); });
  const cached = packFor(NEW, (raw) => {
    for (const f of Object.values(raw)) f.meta.collectedOn.last = "2026-11-08";
  }, "e".repeat(40));
  const payload = JSON.stringify(cached);
  s.write(`${NEW}.json`, { schemaVersion: 1, payload, sha256: hash(payload) });
  s.setContext({ clientBuild: NEW }, false);
  const p = s.index().pack;
  assert.equal(p.sourceCommit, s.bundled.pack.sourceCommit, "newer bundled observations lead");
  assert.ok(p.counts.quests >= s.bundled.pack.counts.quests);
  assert.ok(p.builds.some((b) => b.sourceCommit === "e".repeat(40)));
});
