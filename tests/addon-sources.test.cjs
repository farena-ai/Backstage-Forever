"use strict";
// 1.19: "Dropped by / Found in / Sold by" lines on item tooltips, from the bundled loot and seller packs.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("the committed addon source data is what the bundled packs compile to", () => {
  const { compile } = require("../scripts/build-addon-sources.cjs");
  const file = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverSources.lua"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(file, compile());
  assert.ok(Buffer.byteLength(file) < 200 * 1024, "stays small");
  assert.match(file, /Efficient Games.*CC BY 4\.0/);
  const rows = [...file.matchAll(/^\[(\d+)\]="([^"]*)",$/gm)];
  assert.ok(rows.length > 1000);
  for (const [, , row] of rows) for (const part of row.split("|")) assert.match(part, /^(?:[no]~[^~|]+~\d{1,3}|[^~|]+~\d+~[AHB])$/, part);
});

test("the tooltip names up to three drops, objects and sellers for your side, with zone names", () => lua(String.raw`
DEFAULT_CHAT_FRAME={AddMessage=function() end}
dofile('addon/BackstageForever/BackstageForeverLedger.lua')
BackstageForeverSourceData={drops={[1]='n~Kobold Worker~33|o~Water Barrel~100|n~Goretusk~29',[2]='o~Food Crate~100'},
  sold={[1]='Tharynn Bouden~1429~A|Tamar~1454~H|Innkeeper~1413~B|Gina~1436~A|Amy~1433~A',[3]='Tamar~1454~H'}}
local names={[1429]='Elwynn Forest',[1454]='Orgrimmar',[1413]='The Barrens'}
local function name(id) return names[id] end
local a=BackstageForeverSourceLines(1,'Alliance',name)
assert(#a==3 and a[1]=='Dropped by: Kobold Worker (33%), Goretusk (29%)' and a[2]=='Found in: Water Barrel',a[1])
assert(a[3]=='Sold by: Tharynn Bouden (Elwynn Forest), Innkeeper (The Barrens), Gina',a[3])
local h=BackstageForeverSourceLines(1,'Horde',name)
assert(h[3]=='Sold by: Tamar (Orgrimmar), Innkeeper (The Barrens)',h[3])
assert(#BackstageForeverSourceLines(3,'Alliance',name)==0,'a seller for the other side only is left out')
assert(BackstageForeverSourceLines(2,'Horde',name)[1]=='Found in: Food Crate')
assert(#BackstageForeverSourceLines(99,'Horde',name)==0 and #BackstageForeverSourceLines('x','Horde',name)==0)
BackstageForeverSourceData=nil;assert(#BackstageForeverSourceLines(1,'Horde',name)==0)
`));
