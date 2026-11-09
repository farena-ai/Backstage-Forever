"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeData, validatePack } = require("../src/core/knowledge.cjs");
const { fixture, commit, build } = require("./fixtures/forever-facts.cjs");
const root = path.join(__dirname, "..");
const output = "addon/BackstageForever/BackstageForeverReference.lua";
function compiler() {
  assert.ok(fs.existsSync(path.join(root, "scripts/build-addon-reference.cjs")), "Offline addon reference compiler must exist");
  return require("../scripts/build-addon-reference.cjs");
}
function runLua(input) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.trim(), "ok");
}
function pack() { return validatePack(normalizeData(fixture(), { commit, build })); }

test("offline compiler reproduces the entire pinned reference with LF and complete legal attribution", () => {
  const { compile } = compiler();
  const p = require("../data/forever/pack.json");
  const a = compile(p), b = compile(structuredClone(p));
  assert.equal(a, b);
  assert.equal(a, fs.readFileSync(path.join(root, output), "utf8"));
  assert.ok(Buffer.byteLength(a) <= 1024 * 1024);
  assert.ok(!a.includes("\r"));
  assert.match(a, /Efficient Games/);
  assert.match(a, /https:\/\/creativecommons.org\/licenses\/by\/4.0\//);
  assert.match(a, new RegExp(p.sourceCommit));
  assert.match(a, /Changes:.*phase-specific/);
  assert.match(a, /Blizzard Entertainment/);
  assert.doesNotMatch(a, /\["(?:objectiveEvidence|rewards|raceMask|nextQuestId)"\]/);
  const r = spawnSync(process.execPath, ["scripts/build-addon-reference.cjs", "--check"], { cwd: root, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
});

test("compiled phase facts retain observed finishers, matched objectives and explicitly qualified mentions", () => {
  const { compile } = compiler();
  const p = pack();
  runLua(compile(p) + String.raw`
local r=BackstageForeverReference
assert(r.build=='1.60.1.70862' and r.locale=='enUS')
assert(r.quests[1061].turnIn.name=='Seereth Stonebreak')
assert(r.quests[1061].turnIn.mapId==1413 and r.quests[1061].turnIn.x==0.3528 and r.quests[1061].turnIn.y==0.2786)
assert(r.quests[1061].turnIn.evidence=='observed-turn-in-npc' and r.quests[1061].turnIn.approximate==true)
assert(r.quests[1062].objectives[1].index==1 and r.quests[1062].objectives[1].type=='monster' and r.quests[1062].objectives[1].required==15)
assert(r.quests[98024].turnIn==nil,'A mention must never become a quest finisher')
assert(r.quests[98024].mention.name=='Thork' and r.quests[98024].mention.evidence=='mentioned-in-objective')
print('ok')
`);
});

test("compiler validates normalized source instead of laundering malformed or private fields into Lua", () => {
  const { compile } = compiler();
  for (const mutate of [p => p.quests[1061].private = "PRIVATE", p => p.npcs["npc:4049"].positions[0].x = Infinity, p => p.build = "bad", p => p.quests[1061].title = "bad\ntext"]) {
    const p = pack(); mutate(p);
    assert.throws(() => compile(p), /Invalid Forever reference data/);
  }
});

test("Lua VM round-trips hostile literal bytes without executing closing quotes or long-bracket payloads", () => {
  const { luaString, compile } = compiler();
  const payloads = [
    '\"); _G.INJECTED=true; --', "']; _G.INJECTED=true; --", ']]; _G.INJECTED=true; --[=[',
    'slashes\\\\ quotes"\' digits\\1239', "line\nreturn\rnull\0tab\t\x7f", "é雪🔥",
  ];
  for (const payload of payloads) {
    const bytes = [...Buffer.from(payload)];
    runLua(`local value=${luaString(payload)}\nassert(_G.INJECTED==nil)\nlocal expected={${bytes.join(",")}}\nassert(#value==#expected)\nfor i=1,#expected do assert(value:byte(i)==expected[i]) end\nprint('ok')`);
  }
  const p = pack();
  p.quests[1061].title = payloads[0];
  p.npcs["npc:4049"].name = payloads[2];
  runLua(compile(p) + "\nassert(_G.INJECTED==nil)\nassert(BackstageForeverReference.quests[1061].title==" + luaString(payloads[0]) + ")\nassert(BackstageForeverReference.quests[1061].turnIn.name==" + luaString(payloads[2]) + ")\nprint('ok')");
});

test("compilation is stable across source object insertion order", () => {
  const { compile } = compiler();
  const p = pack(), other = structuredClone(p);
  other.quests = Object.fromEntries(Object.entries(other.quests).reverse());
  other.npcs = Object.fromEntries(Object.entries(other.npcs).reverse());
  assert.equal(compile(p), compile(other));
});

test("compiled actual object finishers retain their relationship kind instead of becoming NPCs", () => {
  const { compile } = compiler();
  runLua(compile(require('../data/forever/pack.json')) + String.raw`
assert(BackstageForeverReference.quests[1061].turnIn.kind=='npc')
assert(BackstageForeverReference.quests[438].turnIn.kind=='object')
print('ok')
`);
});

test("oversized valid source cannot emit a managed Lua resource above 1 MiB", () => {
  const { compile } = compiler();
  const p = structuredClone(require('../data/forever/pack.json'));
  for (const q of Object.values(p.quests)) q.title = '雪'.repeat(200);
  assert.throws(() => compile(p), /exceeds 1 MiB/);
});

test("compiler selects coordinate fields explicitly instead of spreading unrelated valid-schema fields", () => {
  const { compile } = compiler();
  const p = pack();
  p.npcs['npc:4049'].positions[0].objectiveEvidence = 'UNRELATED_POSITION_FIELD';
  p.quests[1062].objectiveLocations[0].positions[0].objectiveEvidence = 'UNRELATED_POSITION_FIELD';
  validatePack(p);
  assert.ok(!compile(p).includes('UNRELATED_POSITION_FIELD'));
});
