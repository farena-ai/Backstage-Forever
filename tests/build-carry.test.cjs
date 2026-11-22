"use strict";
// One rule in the app and the addon: data checked on one build is used on the other
// builds of the same patch (and says so); another patch is a mismatch.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const compat = require("../src/core/build-compat.cjs");

function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

const CASES = [
  ["1.60.1.70888", "1.60.1.70888", "match"],
  ["1.60.1.70888", "1.60.1.71037", "carried"],
  ["1.60.1.71037", "1.60.1.70888", "carried"],
  ["1.60.1.70888", "1.60.2.71500", "mismatch"],
  ["1.60.1.70888", "1.61.0.72000", "mismatch"],
  ["1.60.1.70888", undefined, "unknown"],
  [undefined, "1.60.1.70888", "unknown"],
  ["1.60.1", "1.60.1.70888", "unknown"],
  ["1.60.1.70888 ", "1.60.1.70888", "unknown"],
];

test("the app relates a data build to the game build by patch", () => {
  for (const [data, client, expected] of CASES) {
    assert.equal(compat.relation(data, client), expected, `${data} vs ${client}`);
    assert.equal(compat.usable(data, client), expected === "match" || expected === "carried");
  }
  assert.equal(compat.carriedNote("1.60.1.70888", "1.60.1.70888"), null);
  assert.match(compat.carriedNote("1.60.1.70888", "1.60.1.71037"), /build 70888; your game is on 71037 of the same patch/);
});

test("the addon applies the same relation, and /bf status says which build is in use", () => {
  const rows = CASES.map(([d, c, e]) => `{${d ? `'${d}'` : "nil"},${c ? `'${c}'` : "nil"},'${e}'}`).join(",");
  lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
for _,row in ipairs({${rows}}) do
  assert(BackstageForeverBuildRelation(row[1],row[2])==row[3],tostring(row[1])..' vs '..tostring(row[2]))
  assert(BackstageForeverBuildUsable(row[1],row[2])==(row[3]=='match' or row[3]=='carried'))
end
local number='71037'
GetBuildInfo=function() return '1.60.1',number end
BackstageForeverReference={build='1.60.1.70888'}
local lines=BackstageForeverBuildStatus()
assert(lines[1]=='Game build 1.60.1.71037.' and lines[2]:find('checked on build 70888 of this patch, in use',1,true),lines[2])
number='70888';lines=BackstageForeverBuildStatus()
assert(lines[2]=='Quest reference: checked on this exact build.')
GetBuildInfo=function() return '1.60.2','71500' end
lines=BackstageForeverBuildStatus()
assert(lines[2]:find('made for patch 1.60.1',1,true) and lines[2]:find('off until an update checks this patch',1,true),lines[2])
issecretvalue=function() return true end
assert(#BackstageForeverBuildStatus()==0,'a hidden build number prints nothing')
`);
});

test("the Compass quest plan keeps its reference on another build of the same patch", () => {
  lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
BackstageForeverReference={schemaVersion=1,build='1.60.1.70888',locale='enUS',license='CC BY 4.0',attribution='Data from Efficient Games',
  sourceCommit=string.rep('a',40),observedThrough='2026-11-12',quests={}}
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local function status(build)
  local plan=BackstageForeverBuildPlan({id='c1',clientBuild=build,locale='enUS',quests={}})
  return plan and plan.reference and plan.reference.status
end
assert(status('1.60.1.70888')=='match',tostring(status('1.60.1.70888')))
assert(status('1.60.1.71037')=='carried',tostring(status('1.60.1.71037')))
assert(status('1.60.2.71500')=='build-mismatch',tostring(status('1.60.2.71500')))
`);
});

test("quest lookups answer for a character on another build of the same patch", () => {
  const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const index = new KnowledgeIndex(structuredClone(require("../data/forever/pack.json")));
  const [data] = [index.pack.build];
  const patch = compat.parts(data).patch;
  const same = { clientBuild: `${patch}.99999`, locale: "enUS", quests: [] };
  const other = { clientBuild: "9.99.9.99999", locale: "enUS", quests: [] };
  const id = Number(Object.keys(index.pack.quests)[0]);
  const hit = index.details(same, id);
  assert.notEqual(hit.status, "missing");
  assert.ok(hit.warnings.some((w) => /of the same patch/.test(w)), "carried data says so");
  assert.equal(index.details(other, id).status, "missing");
  const title = index.pack.quests[id].title;
  assert.ok(index.search(title, same, { includeReferenceOnly: true }).length > 0);
  assert.deepEqual(index.search(title, other, { includeReferenceOnly: true }), []);
});
