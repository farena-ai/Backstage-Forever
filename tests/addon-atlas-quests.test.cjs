"use strict";
// 1.20: "Quests to bring" in the in-game Instance Atlas.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("quests are filtered to your side and carry done / in-log state", () => lua(String.raw`
DEFAULT_CHAT_FRAME={AddMessage=function() end}
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
local row={'dm','The Deadmines','d',17,26,'A',1436,.42,.72,{},{
  {166,'The Defias Brotherhood',22,'A','Gryan Stoutmantle',1436,.56,.47},
  {900,'A Horde Errand',20,'H','Someone',1413,.5,.5},
  {2040,'Underground Assault',20,'B','',0,0,0}}}
local state=function(id) return id==166 and 'log' or id==2040 and 'done' or nil end
local a=BackstageForeverAtlasQuests(row,'Alliance',state)
assert(#a==2 and a[1].id==166 and a[1].state=='log' and a[1].giver=='Gryan Stoutmantle' and a[1].map==1436)
assert(a[2].id==2040 and a[2].state=='done' and a[2].giver==nil and a[2].map==0)
local h=BackstageForeverAtlasQuests(row,'Horde',state)
assert(#h==2 and h[1].id==900 and h[2].id==2040)
assert(#BackstageForeverAtlasQuests(row,nil)==3,'an unknown side sees them all')
assert(#BackstageForeverAtlasQuests({'x','X','d',1,2,'B',0,0,0,{}},'Horde')==0,'a row without quests is fine')
`));

test("the bundled atlas rows carry quests for the leveling dungeons", () => {
  const file = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverAtlasData.lua"), "utf8");
  const withQuests = file.split("\n").filter((line) => /\},\{\{\d+,"/.test(line)).length;
  assert.ok(withQuests >= 10, `instances with quests: ${withQuests}`);
  assert.match(file, /"The Defias Brotherhood"/);
});
