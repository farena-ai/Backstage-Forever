"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.join(__dirname, ".."), dir = path.join(root, "data/forever-acquisition");
function api() {
  assert.ok(fs.existsSync(path.join(root, "src/core/acquisition-data.cjs")), "Acquisition data module must exist");
  const a = require("../src/core/acquisition-data.cjs");
  for (const name of ["compileAcquisition", "validateAcquisitionPack", "loadAcquisitionPack", "acquisitionFacts", "buildAddonAcquisition"]) assert.equal(typeof a[name], "function", name);
  return a;
}
const profile = () => ({ clientBuild: "1.60.1.70862", faction: "Horde", source: { kind: "wow-addon", updatedAt: "2026-11-11T12:00:00Z" } });
const hash = v => createHash("sha256").update(v).digest("hex");
const clone = v => structuredClone(v);
const originals = () => Object.fromEntries(["loot", "npcs", "creatures", "vendors"].map(n => [`eg-${n}.json`, fs.readFileSync(path.resolve(root, process.env.ACQUISITION_SOURCE_DIR, `eg-${n}.json`))]));
function tempBundle(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "bf-acquisition-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  for (const n of ["pack.json", "source-lock.json", "LICENSE", "NOTICE.md"]) fs.copyFileSync(path.join(dir, n), path.join(target, n));
  return target;
}
function cli(...args) { return spawnSync(process.execPath, ["scripts/build-forever-acquisition.cjs", ...args], { cwd: root, encoding: "utf8", timeout: 20000 }); }

test("five public interfaces and canonical seven-relation seventeen-point matrix", () => {
  const a = api(), p = a.loadAcquisitionPack();
  assert.equal(p.rows.length, 7); assert.equal(p.rows.reduce((n, r) => n + r.positions.length, 0), 17);
  assert.deepEqual(p.rows.map(r => r.itemId), [765, 2447, 2449, 2770, 2835, 2589, 2320]);
  assert.deepEqual(p.counts, { relations: 7, positions: 17 });
  assert.equal(p.rows.find(r => r.itemId === 2589).kind, "creature-corpse-loot");
  assert.ok(p.rows.every(r => r.requiredSkillLineId === null && r.requiredRank === null && r.availableNow === null && r.exactObjectPosition === false));
  assert.ok(!JSON.stringify(p).includes("562111"));
});
test("exact source keys retain quest/talent contexts and never invent skinning or requirements", () => {
  const p = api().loadAcquisitionPack();
  const corpse = p.rows.find(r => r.itemId === 2589), talent = p.rows.find(r => r.itemId === 2447);
  assert.equal(corpse.sourceKey, "npc:11910|quest"); assert.equal(corpse.gatherSpellId, null); assert.deepEqual(corpse.context, ["quest"]);
  assert.deepEqual(talent.context, ["bountifulHarvest:1"]); assert.equal(talent.gatherSpellId, 2368);
  assert.equal(corpse.referenceName, "Grimtotem Ruffian");
  assert.deepEqual(p.rows[0].positions, [{ mapId: 1411, x: .5027, y: .4874 }, { mapId: 1411, x: .4773, y: .476 }]);
  assert.deepEqual(talent.positions[0], { mapId: 1421, x: .3811, y: .2616 });
  assert.equal(p.rows[3].positionCountInOriginal, 14); assert.equal(p.rows[3].contributingFiles, 2); assert.equal(p.rows[3].observedLootWindows, 14);
});
test("per-file contribution dates are distinct from November 9 point observations", () => {
  const p = api().loadAcquisitionPack();
  assert.deepEqual(p.sourceDates["eg-creatures.json"], { first: "2026-11-07", last: "2026-11-09" });
  for (const name of ["eg-loot.json", "eg-npcs.json", "eg-vendors.json"]) assert.deepEqual(p.sourceDates[name], { first: "2026-11-09", last: "2026-11-09" });
  assert.ok(p.rows.every(r => r.observedOn === "2026-11-09" && r.clientBuild === "1.60.1.70862"));
});
test("matching dated addon yields historical places only, with explicit uncovered item", () => {
  const a = api(), dto = a.acquisitionFacts(a.loadAcquisitionPack(), profile(), [765, 2320, 562111]);
  assert.deepEqual(Object.keys(dto), ["version", "status", "reference", "rows", "limitations"]); assert.equal(dto.version, 1); assert.equal(dto.status, "available");
  assert.equal(dto.rows[0].status, "qualified-historical"); assert.equal(dto.rows[1].sources[0].qualification, "qualified-historical");
  assert.equal(dto.rows[2].status, "unknown"); assert.deepEqual(dto.rows[2].sources, []);
  assert.match(dto.rows[2].reason, /no observed source/i);
  assert.match(dto.limitations.join(" "), /current.*unknown/i);
  assert.equal(dto.rows[0].sources[0].availableNow, null);
});
test("current 70888, manual and missing or malformed date are browse-only with reasons", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const [update, reason] of [[q => q.clientBuild = "1.60.1.70888", /build mismatch/i], [q => q.source.kind = "manual", /saved addon/i], [q => delete q.source.updatedAt, /dated/i], [q => q.source.updatedAt = "garbage", /dated/i]]) {
    const q = profile(); update(q); const dto = a.acquisitionFacts(p, q, [765, 2320]);
    for (const row of dto.rows) { assert.equal(row.status, "browse-only"); assert.match(row.sources[0].reason, reason); }
  }
});
test("a parseable date shortcut or impossible calendar date cannot qualify an addon snapshot", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const updatedAt of ["1", "2026-02-31T12:00:00Z", "2026-11-11", "2026-11-11T25:00:00Z"]) {
    const q = profile(); q.source.updatedAt = updatedAt;
    const row = a.acquisitionFacts(p, q, [765]).rows[0];
    assert.equal(row.status, "browse-only"); assert.match(row.sources[0].reason, /dated/i);
  }
});
test("vendor needs actual saved-faction wholly nonhostile reactions and preserves stock unknown", () => {
  const a = api(), p = a.loadAcquisitionPack(); const vendor = p.rows.find(r => r.itemId === 2320);
  assert.deepEqual(vendor.observedReactionsByFaction, { Horde: [5] }); assert.equal(vendor.limitedStock, null);
  assert.equal(vendor.reactionContributingFiles, 2); assert.equal(vendor.listingContributingFiles, 2);
  assert.equal(a.acquisitionFacts(p, { ...profile(), faction: "Alliance" }, [2320]).rows[0].status, "browse-only");
  assert.match(a.acquisitionFacts(p, { ...profile(), faction: "Alliance" }, [2320]).rows[0].sources[0].reason, /faction.*unknown/i);
  for (const reactions of [{ Horde: [2] }, { Horde: [2, 5] }, {}, { Alliance: [5] }]) {
    const q = clone(p); q.rows.find(r => r.itemId === 2320).observedReactionsByFaction = reactions;
    assert.equal(a.acquisitionFacts(q, profile(), [2320]).rows[0].status, "browse-only");
  }
});
test("schema rejects malformed arrays, text, points, IDs, counts, dates and unknown fields atomically", () => {
  const a = api(), p = a.loadAcquisitionPack();
  const edits = [q => q.rows[0].secret = "PRIVATE", q => q.private = "PRIVATE", q => q.rows[0].itemId = 562111, q => q.rows[0].entityId = 0, q => q.rows[0].referenceName = "bad\nname", q => q.rows[0].referenceName = "x".repeat(201), q => q.rows[0].positions[0].x = Infinity, q => q.rows[0].positions[0].y = -1, q => q.rows[0].positions[0].mapId = 0, q => q.rows[0].positions[0].worldX = 1, q => q.rows[0].positions.push(...Array(17).fill(q.rows[0].positions[0])), q => q.rows[0].positions.foo = 1, q => q.rows[0].positions = { length: 1 }, q => q.rows.push(q.rows[0]), q => q.rows[0].requiredRank = 0, q => q.rows[0].availableNow = true, q => q.rows[0].exactObjectPosition = true, q => q.rows[0].observedOn = "2026-11-07", q => q.sourceDates["eg-creatures.json"].first = "2026-11-09", q => q.counts.positions++, q => q.rows[0].contributingFiles = 4, q => q.rows[0].positionCountInOriginal = 0, q => q.rows[0].observedLootWindows = -1];
  for (const edit of edits) { const q = clone(p); edit(q); assert.throws(() => a.validateAcquisitionPack(q)); const dto = a.acquisitionFacts(q, profile(), [765]); assert.equal(dto.status, "unavailable"); assert.deepEqual(dto.rows[0].sources, []); }
});
test("known relation grammar, item membership, kind, spell and context cannot be relabeled", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const edit of [q => q.rows[0].sourceKey += "|quest", q => q.rows[0].kind = "creature-corpse-loot", q => q.rows[0].gatherSpellId = 8613, q => q.rows[1].context = [], q => q.rows[5].context = ["bountifulHarvest:1"], q => q.rows[5].gatherSpellId = 8613, q => q.rows[6].observedReactionsByFaction = { Horde: [9] }, q => q.rows[6].observedReactionsByFaction.Horde = [5, 5], q => q.license = "MIT", q => q.clientBuild = "1.60.1.70888", q => q.sourceCommit = "0".repeat(40)]) {
    const q = clone(p); edit(q); assert.throws(() => a.validateAcquisitionPack(q));
  }
});
test("valid known subset remains bounded without unrelated missing materials", () => {
  const a = api(), p = a.loadAcquisitionPack(); p.rows = p.rows.slice(0, 1); p.counts = { relations: 1, positions: 2 };
  assert.equal(a.validateAcquisitionPack(p).rows.length, 1);
  assert.equal(a.acquisitionFacts(p, profile(), [765, 2320]).rows[1].status, "unknown");
});
test("projection request bounds, deduplication and defensive copies", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const ids of [null, [0], ["765"], [NaN], Array.from({ length: 41 }, (_, i) => i + 1)]) assert.throws(() => a.acquisitionFacts(p, profile(), ids));
  const dto = a.acquisitionFacts(p, profile(), [765, 765]); assert.equal(dto.rows.length, 1);
  dto.rows[0].sources[0].positions[0].x = 1; dto.reference.sourceDates["eg-creatures.json"].first = "bad";
  assert.equal(a.acquisitionFacts(p, profile(), [765]).rows[0].sources[0].positions[0].x, .5027);
  const validated = a.validateAcquisitionPack(p); validated.rows[0].positions[0].x = 1; assert.equal(p.rows[0].positions[0].x, .5027);
});
test("privacy canaries and material names never cross public projection", () => {
  const a = api(), q = { ...profile(), name: "PRIVATE_CANARY", id: "PRIVATE_CANARY", path: "PRIVATE_CANARY", notes: "PRIVATE_CANARY", goals: "PRIVATE_CANARY", apiKey: "PRIVATE_CANARY", materials: [{ itemId: 765, name: "PRIVATE_CANARY" }] };
  q.source.path = "PRIVATE_CANARY";
  const dto = a.acquisitionFacts(a.loadAcquisitionPack(), q, [765, 2320]);
  assert.ok(!JSON.stringify(dto).includes("PRIVATE_CANARY"));
  assert.ok(dto.rows.every(r => !Object.hasOwn(r, "name")));
  assert.ok(dto.rows.every(r => r.sources.every(s => s.nameKind === "reference-source-name")));
});
function malformedArrayVariants(values) {
  const sparse = values.slice(); delete sparse[0];
  const compensated = values.slice(); delete compensated[0]; compensated.extra = values[0];
  const inherited = values.slice(); delete inherited[0]; inherited.extra = values[0];
  Object.setPrototypeOf(inherited, Object.create(Array.prototype, { 0: { value: values[0], enumerable: true } }));
  const nonenumerableExtra = values.slice(); Object.defineProperty(nonenumerableExtra, "extra", { value: values[0] });
  const symbolicExtra = values.slice(); symbolicExtra[Symbol("extra")] = values[0];
  const nonenumerableIndex = values.slice(); Object.defineProperty(nonenumerableIndex, "0", { value: values[0], enumerable: false });
  const accessorIndex = values.slice(); Object.defineProperty(accessorIndex, "0", { get: () => values[0], enumerable: true });
  return [sparse, compensated, inherited, nonenumerableExtra, symbolicExtra, nonenumerableIndex, accessorIndex];
}
test("malformed reaction arrays cannot qualify a merchant through skipped or inherited evidence", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const ns of malformedArrayVariants([5])) {
    const q = clone(p); q.rows.find(r => r.itemId === 2320).observedReactionsByFaction.Horde = ns;
    assert.throws(() => a.validateAcquisitionPack(q), "nonordinary reactions must reject");
    const dto = a.acquisitionFacts(q, profile(), [2320]);
    assert.equal(dto.status, "unavailable"); assert.equal(dto.rows[0].status, "unavailable"); assert.deepEqual(dto.rows[0].sources, []);
  }
});
test("shared array boundary rejects holes and unrelated properties in positions and contexts", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const field of ["positions", "context"]) {
    for (const bad of malformedArrayVariants(p.rows[1][field])) {
      const q = clone(p); q.rows[1][field] = bad;
      assert.throws(() => a.validateAcquisitionPack(q), field);
      assert.equal(a.acquisitionFacts(q, profile(), [2447]).status, "unavailable");
    }
  }
});
test("requested IDs require dense own indices with no compensating or unrelated keys", () => {
  const a = api(), p = a.loadAcquisitionPack();
  for (const bad of malformedArrayVariants([765])) assert.throws(() => a.acquisitionFacts(p, profile(), bad));
  assert.deepEqual(a.acquisitionFacts(p, profile(), []).rows, []);
  const dto = a.acquisitionFacts(p, profile(), [765, 765, 2320]);
  assert.deepEqual(dto.rows.map(r => r.itemId), [765, 2320]);
  assert.ok(dto.rows.every(r => r.status === "qualified-historical"));
  dto.rows[0].sources[0].positions[0].x = .1;
  assert.equal(a.acquisitionFacts(p, profile(), [765]).rows[0].sources[0].positions[0].x, .5027);
});
test("runtime load rejects changed facts even if adjacent checksum is recomputed", t => {
  const a = api(), target = tempBundle(t), p = JSON.parse(fs.readFileSync(path.join(target, "pack.json")));
  p.rows[0].positions[0].x = .1234; const bytes = Buffer.from(JSON.stringify(p) + "\n"); fs.writeFileSync(path.join(target, "pack.json"), bytes);
  const lock = JSON.parse(fs.readFileSync(path.join(target, "source-lock.json"))); lock.compiled = { bytes: bytes.length, sha256: hash(bytes) }; fs.writeFileSync(path.join(target, "source-lock.json"), JSON.stringify(lock));
  assert.throws(() => a.loadAcquisitionPack(target), /^Error: Acquisition reference unavailable\.$/);
});
test("runtime validates every raw descriptor and exact license; missing/oversize fail privately", t => {
  const a = api();
  for (const name of ["eg-loot.json", "eg-npcs.json", "eg-creatures.json", "eg-vendors.json"]) {
    for (const edit of [f => f.sha256 = "0".repeat(64), f => f.bytes++, f => f.maxBytes++, f => f.url += "/other", f => f.meta.clientBuild = "1.60.1.70888", f => f.meta.license = "MIT", f => f.meta.collectedOn.first = "2026-11-01"]) {
      const target = tempBundle(t), lock = JSON.parse(fs.readFileSync(path.join(target, "source-lock.json"))); edit(lock.files[name]); fs.writeFileSync(path.join(target, "source-lock.json"), JSON.stringify(lock)); assert.throws(() => a.loadAcquisitionPack(target), /unavailable/);
    }
  }
  for (const [name, value] of [["LICENSE", "Creative Commons"], ["pack.json", " ".repeat(131073)], ["source-lock.json", "{}"], ["pack.json", "{"], ["NOTICE.md", "missing attribution"]]) {
    const target = tempBundle(t); fs.writeFileSync(path.join(target, name), value); assert.throws(() => a.loadAcquisitionPack(target), /^Error: Acquisition reference unavailable\.$/);
  }
  assert.throws(() => a.loadAcquisitionPack(path.join(root, "PRIVATE_CANARY_ABSENT")), /^Error: Acquisition reference unavailable\.$/);
});
test("offline CLI shipped check and invalid options are bounded", () => {
  api(); const checked = cli("--check"); assert.equal(checked.status, 0, checked.stderr); assert.match(checked.stdout, /shipped|bundled/i);
  for (const args of [[], ["--output-dir", ".."], ["--source-dir"], ["--check", "--fetch"]]) assert.notEqual(cli(...args).status, 0);
});
test("Lua is data-only, deterministic and actually roundtrips every shipped fact through Fengari", () => {
  const a = api(), p = a.loadAcquisitionPack(), lua = a.buildAddonAcquisition(p);
  assert.equal(lua, a.buildAddonAcquisition(clone(p))); assert.equal(lua, fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverAcquisition.lua"), "utf8")); assert.ok(!lua.includes("\r"));
  assert.doesNotMatch(lua, /\b(function|loadstring|require|dofile|RunScript|SendChatMessage)\s*\(/);
  // Traverse in JS-authored order so nil-valued unknowns and empty arrays remain testable.
  const checks = [];
  function visit(v, expr) {
    if (v === null) checks.push(`assert(${expr} == nil)`);
    else if (typeof v === "object") { checks.push(`assert(type(${expr}) == 'table')`); if (Array.isArray(v)) checks.push(`assert(#${expr} == ${v.length})`); for (const [k, x] of Object.entries(v)) visit(x, `${expr}[${Array.isArray(v) ? Number(k) + 1 : JSON.stringify(k)}]`); }
    else checks.push(`assert(${expr} == ${typeof v === "string" ? JSON.stringify(v) : v})`);
  }
  visit(p, "BackstageForeverAcquisition");
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: lua + checks.join("\n") + "\nprint('ok')", encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); assert.equal(r.stdout.trim(), "ok");
  const bad = clone(p); bad.rows[0].referenceName = "bad\nname"; assert.throws(() => a.buildAddonAcquisition(bad));
});
test("raw originals compile identically; all four pins reject changes before parsing", { skip: !process.env.ACQUISITION_SOURCE_DIR }, () => {
  const a = api(), inputs = originals(); assert.deepEqual(a.compileAcquisition(inputs), a.loadAcquisitionPack());
  for (const name of Object.keys(inputs)) {
    const changed = { ...inputs, [name]: Buffer.from(inputs[name]) }; changed[name][0] ^= 1; assert.throws(() => a.compileAcquisition(changed), /source.*mismatch/i);
    assert.throws(() => a.compileAcquisition({ ...inputs, [name]: inputs[name].subarray(1) }), /source.*mismatch/i);
  }
  assert.throws(() => a.compileAcquisition({ ...inputs, extra: Buffer.from("PRIVATE_CANARY") }));
  const missing = { ...inputs }; delete missing["eg-npcs.json"]; assert.throws(() => a.compileAcquisition(missing));
  assert.throws(() => a.compileAcquisition({ ...inputs, "eg-loot.json": Buffer.alloc(2097153) }));
  assert.throws(() => a.compileAcquisition({ ...inputs, "eg-npcs.json": inputs["eg-npcs.json"].toString("utf8") }));
  for (const [name, edit] of [
    ["eg-loot.json", r => r.format = 2],
    ["eg-loot.json", r => r.meta.license = "MIT"],
    ["eg-loot.json", r => r.meta.clientBuild = "1.60.1.70888"],
    ["eg-loot.json", r => delete r.sources["object:1731|spell:2576"].items["2770"]],
    ["eg-loot.json", r => r.sources["object:1731|spell:2576|quest"] = r.sources["object:1731|spell:2576"]],
    ["eg-npcs.json", r => r.approached["1617"].name = "PRIVATE_CANARY"],
    ["eg-vendors.json", r => r.vendors["3005"].entries["item:2320"].itemId = 2321],
    ["eg-creatures.json", r => r.creatures["3005"].name = "Wrong exact identity"],
  ]) {
    const r = JSON.parse(inputs[name]); edit(r);
    assert.throws(() => a.compileAcquisition({ ...inputs, [name]: Buffer.from(JSON.stringify(r)) }), /source.*mismatch/i);
  }
  const p = a.compileAcquisition(inputs); p.rows[0].positions[0].x = 1; assert.equal(a.compileAcquisition(inputs).rows[0].positions[0].x, .5027);
  const checked = cli("--source-dir", process.env.ACQUISITION_SOURCE_DIR, "--check"); assert.equal(checked.status, 0, checked.stderr); assert.match(checked.stdout, /raw.*reproduction/i);
});
