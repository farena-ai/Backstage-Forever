"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSubmit, validateReport, validateForget, roundCoord, gridToFraction, ValidationError, LIMITS } = require("../lib/validate");
const { uuid, submit } = require("./helpers");

const ID = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
const bad = (fn, re) => assert.throws(fn, (e) => e instanceof ValidationError && (!re || re.test(e.message)));

test("rounding snaps 0..1 fractions to the 0.5% grid", () => {
  assert.equal(roundCoord(0), 0);
  assert.equal(roundCoord(1), 200);
  assert.equal(roundCoord(0.123), 25); // 24.6 -> 25
  assert.equal(roundCoord(0.1224), 24); // 24.48 -> 24
  assert.equal(gridToFraction(25), 0.125);
  assert.equal(gridToFraction(24), 0.12);
  // Spots within the same 0.5% cell collapse to one key.
  assert.equal(roundCoord(0.4512), roundCoord(0.4488));
});

test("valid submission is normalized and rounded", () => {
  const out = validateSubmit(submit(ID.toUpperCase(), {
    nodes: [{ kind: "herb", objectId: 1617, name: "Peacebloom", mapId: 1429, x: 0.4512, y: 0.6021, itemIds: [2447] },
            { kind: "ore", name: "  Copper   Vein ", mapId: 1429, x: 0.1, y: 0.2 }],
    npcs: [{ npcId: 197, mapId: 1429, x: 0.4826, y: 0.4185 }],
    vendors: [{ npcId: 1213, itemIds: [159, 4540] }],
    drops: [{ npcId: 448, loots: 4, items: [{ itemId: 1931, count: 1 }] }],
    recipes: [{ source: "trainer", npcId: 1215, spellId: 2330 }],
  }));
  assert.equal(out.installId, ID);
  assert.deepEqual(out.nodes[0], { kind: "herb", objectId: 1617, name: null, mapId: 1429, x: 90, y: 120, itemIds: [2447] });
  assert.equal(out.nodes[1].name, "Copper Vein");
  assert.deepEqual(out.npcs[0], { npcId: 197, mapId: 1429, x: 97, y: 84 });
  assert.deepEqual(out.recipes[0], { source: "trainer", npcId: 1215, spellId: 2330, itemId: null });
  assert.equal(out.build, "1.15.8.66000");
});

test("unknown fields are rejected at every level", () => {
  bad(() => validateSubmit({ ...submit(ID, { npcs: [] }), character: "Bob" }), /character: unknown field/);
  bad(() => validateSubmit(submit(ID, { npcs: [{ npcId: 1, mapId: 1, x: 0, y: 0, guid: "Player-1" }] })), /npcs\[0\]\.guid: unknown field/);
  bad(() => validateSubmit(submit(ID, { chat: [] })), /observations\.chat: unknown field/);
  bad(() => validateSubmit(submit(ID, { drops: [{ npcId: 1, loots: 1, items: [{ itemId: 2, count: 1, name: "x" }] }] })), /unknown field/);
  bad(() => validateSubmit(JSON.parse(`{"schema":1,"installId":"${ID}","observations":{"npcs":[]},"__proto__":{"x":1}}`)), /__proto__: unknown field/);
});

test("schema, install id, build and types are enforced", () => {
  bad(() => validateSubmit({ ...submit(ID, { npcs: [] }), schema: 2 }), /schema/);
  bad(() => validateSubmit(submit("not-a-uuid", { npcs: [] })), /installId/);
  bad(() => validateSubmit(submit("3f2b8c1e-9d4a-1b7e-8f21-0a1b2c3d4e5f", { npcs: [] })), /installId/); // v1, not v4
  bad(() => validateSubmit(submit(ID, { npcs: [] }, { build: "Realm Kel'Thuzad" })), /build/);
  bad(() => validateSubmit(submit(ID, {})), /at least one entry/);
  bad(() => validateSubmit(submit(ID, { npcs: [{ npcId: 1.5, mapId: 1, x: 0, y: 0 }] })), /npcId/);
  bad(() => validateSubmit(submit(ID, { npcs: [{ npcId: 1, mapId: 1, x: 1.01, y: 0 }] })), /x: must be a number 0\.\.1/);
  bad(() => validateSubmit(submit(ID, { npcs: [{ npcId: 1, mapId: 1, x: "0.5", y: 0 }] })), /x/);
  bad(() => validateSubmit(submit(ID, { nodes: [{ kind: "fish", objectId: 1, mapId: 1, x: 0, y: 0 }] })), /kind/);
  bad(() => validateSubmit(submit(ID, { nodes: [{ kind: "herb", mapId: 1, x: 0, y: 0 }] })), /objectId or name/);
  bad(() => validateSubmit(submit(ID, { nodes: [{ kind: "herb", name: "Peace|bloom", mapId: 1, x: 0, y: 0 }] })), /not allowed/);
  bad(() => validateSubmit(submit(ID, { vendors: [{ npcId: 1, itemIds: [] }] })), /at least 1/);
  bad(() => validateSubmit(submit(ID, { vendors: [{ npcId: 1, itemIds: [5, 5] }] })), /duplicate/);
  bad(() => validateSubmit(submit(ID, { drops: [{ npcId: 1, loots: 2, items: [{ itemId: 9, count: 3 }] }] })), /count/);
  bad(() => validateSubmit(submit(ID, { recipes: [{ source: "trainer", npcId: 1 }] })), /spellId or itemId/);
  bad(() => validateSubmit([]), /must be an object/);
});

test("batch size caps", () => {
  const many = Array.from({ length: LIMITS.maxEntries + 1 }, (_, i) => ({ npcId: i + 1, mapId: 1, x: 0, y: 0 }));
  bad(() => validateSubmit(submit(ID, { npcs: many })), /at most 500/);
  const half = many.slice(0, 300);
  bad(() => validateSubmit(submit(ID, { npcs: half, vendors: half.map(n => ({ npcId: n.npcId, itemIds: [1] })) })), /in total/);
  assert.equal(validateSubmit(submit(ID, { npcs: many.slice(0, 500) })).npcs.length, 500);
});

test("report validation: category, text length, log size, control characters", () => {
  const base = { schema: 1, installId: uuid(), category: "bug", text: "Map pin is wrong", appVersion: "0.31.0" };
  const ok = validateReport({ ...base, log: "line1\r\nline2\t" });
  assert.equal(ok.log, "line1\nline2\t");
  assert.equal(validateReport(base).log, null);
  bad(() => validateReport({ ...base, category: "rant" }), /category/);
  bad(() => validateReport({ ...base, text: "x".repeat(2001) }), /at most 2000/);
  assert.equal(validateReport({ ...base, text: "x".repeat(2000) }).text.length, 2000);
  bad(() => validateReport({ ...base, text: "   " }), /empty/);
  bad(() => validateReport({ ...base, text: "bad \x1b[31m escape" }), /control/);
  bad(() => validateReport({ ...base, log: "x".repeat(64 * 1024 + 1) }), /bytes/);
  assert.ok(validateReport({ ...base, log: "x".repeat(64 * 1024) }));
  bad(() => validateReport({ ...base, email: "a@b.c" }), /email: unknown field/);
  bad(() => validateReport({ ...base, appVersion: undefined }), /appVersion/);
});

test("forget validation", () => {
  assert.equal(validateForget({ schema: 1, installId: ID }).installId, ID);
  bad(() => validateForget({ schema: 1, installId: ID, all: true }), /unknown field/);
});
