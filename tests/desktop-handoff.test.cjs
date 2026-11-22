"use strict";
// 1.20 (roadmap F3): the desktop hands your wish list to the game through one data-only addon file.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), fsp = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const root = path.join(__dirname, "..");
const handoff = require("../src/core/desktop-handoff.cjs");
const { GameSync, ADDON_FILES } = require("../src/core/game-sync.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const saved = (id, name, realm) => ({ id, name, realm, source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });

test("the file is data only, deterministic, bounded and names only saved characters with wishes", () => {
  const profiles = [saved("b", "Zed", "Thunder Hold"), saved("a", "Abel", "Thunder Hold"), { id: "m", name: "Manual", realm: "R", source: { kind: "manual" } },
    saved("e", "Empty", "R"), saved("q", 'Quo"te', "R\\x"), saved("d", "Abel", "Thunder Hold")];
  const wish = { a: [5202, 2991, 5202, -1, 1.5, "7"], b: Array.from({ length: 300 }, (_, i) => i + 1), q: [9], d: [1], m: [3] };
  const text = handoff.compile({ profiles, wishlist: (id) => wish[id] || [] });
  assert.equal(text, handoff.compile({ profiles: [...profiles].reverse().filter((p) => p.id !== "d").concat(profiles[5]), wishlist: (id) => wish[id] || [] }).replace(/\{wish=\{1\}\}/, "{wish={5202,2991}}"), "order of input does not change the bytes for the same characters");
  assert.match(text, /^-- Written by the Backstage Forever desktop app/);
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n/);
  assert.match(text, /\["Abel-Thunder Hold"\]=\{wish=\{5202,2991\}\},/);
  assert.doesNotMatch(text, /Manual|Empty/);
  assert.match(text, /\["Quo\\034te-R\\092x"\]=\{wish=\{9\}\},/, "names are escaped, never executable");
  const zed = text.match(/\["Zed-Thunder Hold"\]=\{wish=\{([\d,]+)\}\}/)[1].split(",");
  assert.equal(zed.length, handoff.MAX_ITEMS);
  for (const line of text.split("\n")) assert.ok(/^(--.*|BackstageForeverDesktopData=\{schema=1,characters=\{|\["(?:[ -!#-\[\]-~]|\\\d{3})+"\]=\{wish=\{[\d,]+\}\},|\}\}|)$/.test(line), line);
  assert.equal(fs.readFileSync(path.join(root, "addon/BackstageForever", handoff.FILE), "utf8").replace(/\r\n/g, "\n"), handoff.EMPTY, "the shipped file is the empty hand-off");
  assert.ok(ADDON_FILES.includes(handoff.FILE));
  // The caps keep the worst case (100 characters, 200 ten-digit ids each) well inside the size limit.
  const worst = handoff.compile({ profiles: Array.from({ length: 150 }, (_, i) => saved("p" + i, "N".repeat(50) + i, "R".repeat(50))), wishlist: () => Array.from({ length: 300 }, (_, i) => 2000000000 + i) });
  assert.ok(Buffer.byteLength(worst) < 256 * 1024);
  assert.equal(worst.split("\n").filter((l) => l.startsWith("[")).length, handoff.MAX_CHARACTERS);
});

test("the game reads only its own character's wishes and ignores a damaged file", () => lua(String.raw`
DEFAULT_CHAT_FRAME={AddMessage=function() end}
dofile('addon/BackstageForever/BackstageForeverDesktop.lua')
assert(type(BackstageForeverDesktopData)=='table' and BackstageForeverDesktopData.schema==1)
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
assert(next(BackstageForeverWishSet('Abel','Thunder Hold'))==nil,'the shipped file holds no wishes')
BackstageForeverDesktopData={schema=1,characters={['Abel-Thunder Hold']={wish={5202,2991,'x'}},['Zed-Thunder Hold']={wish={7}}}}
local set=BackstageForeverWishSet('Abel','Thunder Hold')
assert(set[5202] and set[2991] and not set[7])
assert(next(BackstageForeverWishSet('Nobody','Thunder Hold'))==nil and next(BackstageForeverWishSet(nil,'x'))==nil)
local row={'dm','The Deadmines','d',17,26,'A',1436,.42,.72,{{'Edwin VanCleef','5202~100|2991~50|1822~33'},{'Mr. Smite','5202~10|7230~67'}}}
assert(BackstageForeverWishCount(row,set)==2,'an item wished once counts once')
assert(BackstageForeverWishCount(row,{})==0)
for _,bad in ipairs({{schema=2,characters={['Abel-Thunder Hold']={wish={1}}}},{schema=1},{schema=1,characters='x'},'text'}) do
  BackstageForeverDesktopData=bad
  assert(next(BackstageForeverWishSet('Abel','Thunder Hold'))==nil)
end
`));

test("the installer writes the hand-off with the addon, and a wish change rewrites only that file", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "bf-handoff-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const game = path.join(dir, "Game"), addon = path.join(dir, "source");
  await fsp.mkdir(path.join(game, "WTF"), { recursive: true });
  await fsp.writeFile(path.join(game, ".flavor.info"), "wowf");
  await fsp.mkdir(addon);
  for (const file of ADDON_FILES) await fsp.writeFile(path.join(addon, file), file.endsWith(".toc") ? "## Version: 9.9.9\n" : file === handoff.FILE ? handoff.EMPTY : "fixture " + file);
  let wishes = [5202];
  const sync = new GameSync({ dataDir: path.join(dir, "data"), addonDir: addon, handoff: () => handoff.compile({ profiles: [saved("a", "Abel", "Thunder Hold")], wishlist: () => wishes }) });
  t.after(() => sync.close());
  assert.equal(await sync.writeHandoff(), false, "nothing is written before the addon is installed");
  assert.equal((await sync.prepare(game)).addonCurrent, true);
  const installed = path.join(game, "Interface", "AddOns", "BackstageForever");
  const read = () => fs.readFileSync(path.join(installed, handoff.FILE), "utf8");
  assert.match(read(), /\["Abel-Thunder Hold"\]=\{wish=\{5202\}\},/);
  assert.equal(await sync.writeHandoff(), false, "unchanged content is not rewritten");
  const before = fs.statSync(path.join(installed, "BackstageForever.toc")).mtimeMs;
  wishes = [5202, 2991];
  assert.equal(await sync.writeHandoff(), true);
  assert.match(read(), /wish=\{5202,2991\}/);
  assert.equal(fs.statSync(path.join(installed, "BackstageForever.toc")).mtimeMs, before, "no other file is touched");
  assert.deepEqual(fs.readdirSync(installed).filter((f) => f.endsWith(".tmp")), [], "no staging file is left behind");
  assert.equal((await sync.prepare()).addonCurrent, true, "a later repair keeps the hand-off instead of the shipped empty file");
  assert.match(read(), /wish=\{5202,2991\}/);
  // A hand-off that fails to compile falls back to the shipped empty file rather than blocking the install.
  const broken = new GameSync({ dataDir: path.join(dir, "data2"), addonDir: addon, handoff: () => { throw Error("boom"); } });
  t.after(() => broken.close());
  assert.equal((await broken.prepare(game)).addonCurrent, true);
  assert.equal(read(), handoff.EMPTY);
});

// 1.21: the same file also carries the dungeon drops the desktop rates as upgrades.
test("upgrades ride along: sorted, bounded, and a character with only upgrades is still named", () => {
  const profiles = [saved("a", "Abel", "Thunder Hold"), saved("b", "Zed", "Thunder Hold"), saved("c", "Cara", "Thunder Hold")];
  const text = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5202] : []), upgrades: (id) => (id === "a" ? [9, 3, 9, -1, "x", 7] : id === "b" ? Array.from({ length: 300 }, (_, i) => 300 - i) : []) });
  assert.match(text, /\["Abel-Thunder Hold"\]=\{wish=\{5202\},up=\{3,7,9\}\},/);
  const zed = text.match(/\["Zed-Thunder Hold"\]=\{wish=\{\},up=\{([\d,]+)\}\}/)[1].split(",").map(Number);
  assert.equal(zed.length, handoff.MAX_ITEMS); assert.equal(zed[0], 1); assert.equal(zed[199], 200);
  assert.doesNotMatch(text, /Cara/);
  assert.equal(handoff.compile({ profiles, wishlist: () => [], upgrades: () => { throw Error("no data"); } }), handoff.EMPTY, "a failing supplier leaves the file empty, never broken");
  assert.equal(lua(String.raw`
DEFAULT_CHAT_FRAME={AddMessage=function() end}
${text.replace(/^--.*$/gm, "")}
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
local up,wish=BackstageForeverUpgradeSet('Abel','Thunder Hold'),BackstageForeverWishSet('Abel','Thunder Hold')
assert(up[3] and up[7] and up[9] and not up[5202] and wish[5202] and not wish[3])
assert(next(BackstageForeverWishSet('Zed','Thunder Hold'))==nil and BackstageForeverUpgradeSet('Zed','Thunder Hold')[200])
assert(next(BackstageForeverUpgradeSet('Cara','Thunder Hold'))==nil)
assert(BackstageForeverAtlasMarks(5202,wish,up)=='|cffffd100Wish|r ')
assert(BackstageForeverAtlasMarks(7,wish,up)=='|cff40ff40Upgrade|r ')
assert(BackstageForeverAtlasMarks(1,wish,up)=='' and BackstageForeverAtlasMarks(7,nil,nil)=='')
local both={[7]=true}
assert(BackstageForeverAtlasMarks(7,both,both)=='|cffffd100Wish|r |cff40ff40Upgrade|r ')
local row={'dm','The Deadmines','d',17,26,'A',1436,.42,.72,{{'Edwin VanCleef','5202~100|7~50|3~33'},{'Mr. Smite','5202~10|7~67'}}}
assert(BackstageForeverAtlasCountsLine(row,wish,up)=='|cffffd1001 on your wish list|r  ·  |cff40ff402 upgrades for you|r')
assert(BackstageForeverAtlasCountsLine(row,{},{[3]=true})=='|cff40ff401 upgrade for you|r')
assert(BackstageForeverAtlasCountsLine(row,{},{})=='')
assert(BackstageForeverAtlasListMarks(row,wish,up)=='|cffffd1001|r |cff40ff40+2|r ')
assert(BackstageForeverAtlasListMarks(row,{},{[3]=true})=='|cff40ff40+1|r ')
assert(BackstageForeverAtlasListMarks(row,wish,{})=='|cffffd1001|r ' and BackstageForeverAtlasListMarks(row,{},{})=='')
io.write('ok')
`), "ok");
});

test("upgrade ids come only from drops rated an upgrade right now", () => {
  const { upgradeIds } = require("../src/core/boss-loot.cjs");
  const pack = { instances: { rfc: { bosses: [{ name: "Boss", npcIds: [1], items: [{ itemId: 30 }, { itemId: 10 }, { itemId: 20 }, { itemId: 40 }] }] } } };
  const item = (id, stamina, requiredLevel = 10) => ({ id, name: "Item " + id, quality: 2, itemLevel: 20, requiredLevel, classId: 4, subclassId: 1, inventoryType: 1, slot: "Head", kind: "Cloth", armor: 10, stats: [{ stat: "Stamina", amount: stamina }], classes: null });
  const table = { 1: item(1, 2), 10: item(10, 9), 20: item(20, 1), 30: item(30, 8), 40: item(40, 20, 60) };
  const gameData = { build: () => "1.60.1.71037", items: (ids) => ids.map((id) => table[id] || null) };
  const profile = { className: "Mage", level: 20, clientBuild: "1.60.1.71037", readiness: { equipment: [{ slot: 1, itemId: 1, name: "Item 1" }] } };
  assert.deepEqual(upgradeIds(pack, { profile, gameData }), [10, 30], "better now: yes; worse or too high a level: no");
  assert.deepEqual(upgradeIds(pack, { profile: { ...profile, clientBuild: "1.60.2.1" }, gameData }), [], "a saved file from another build is not compared");
  assert.deepEqual(upgradeIds(pack, { profile: null, gameData }), []);
  assert.deepEqual(upgradeIds(null, { profile, gameData }), []);
});
