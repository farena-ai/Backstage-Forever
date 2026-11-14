"use strict";
// Boss loot pack, upgrade verdicts, wish list and the loot/item-card IPC.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const { validateBossLootPack, loadBossLootPack, dropIndex, hash } = require("../src/core/boss-loot-data.cjs");
const { upgradeVerdict, equipmentContext, atlasLootSummary, instanceLoot, itemCard } = require("../src/core/boss-loot.cjs");
const { registerBossLootHandlers } = require("../src/core/boss-loot-ipc.cjs");
const { WishList } = require("../src/core/wishlist.cjs");
const { BASELINE } = require("../src/core/dungeon-atlas.cjs");

const clone = (v) => structuredClone(v);
const tiny = () => ({ schemaVersion: 1, kind: "forever-boss-loot", product: "wowf", sourceCommit: "a".repeat(40), builds: ["1.60.1.70888"], license: "CC BY 4.0", attribution: "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.", minChance: 0.03,
  instances: { dm: { bosses: [{ name: "Edwin VanCleef", npcIds: [639], items: [{ itemId: 9001, chance: 1, drops: 3 }, { itemId: 9002, chance: 0.5, drops: 2 }, { itemId: 9003, chance: 0.25, drops: 1 }] }, { name: "Sneed", npcIds: [], items: [] }] } } });
// Item views in the shape game-data.cjs itemView() returns.
const chest = (id, sub, stats, extra = {}) => ({ id, name: `Chest ${id}`, quality: 2, itemLevel: 22, requiredLevel: 17, classId: 4, subclassId: sub, inventoryType: 5, slot: "Chest", kind: null, armor: 100, stats, damage: null, speed: null, dps: null, bonding: null, classes: null, iconFileId: 1234, ...extra });
const ITEMS = {
  500: chest(500, 2, [{ stat: "Strength", amount: 2 }], { armor: 60 }), // worn leather chest
  9001: chest(9001, 3, [{ stat: "Strength", amount: 6 }, { stat: "Stamina", amount: 4 }]), // better mail
  9002: chest(9002, 4, [{ stat: "Strength", amount: 9 }]), // plate before 40
  9003: chest(9003, 1, [], { armor: 10 }), // weak cloth
  9004: chest(9004, 3, [{ stat: "Strength", amount: 8 }], { requiredLevel: 24 }),
  9005: { id: 9005, name: "Linen Cloth", quality: 1, itemLevel: 5, requiredLevel: 0, classId: 7, subclassId: 0, inventoryType: 0, slot: null, kind: null, armor: 0, stats: [], iconFileId: 77 },
};
const gameData = { items: (ids) => ids.map((id) => ITEMS[id] || null) };
const warrior = { id: "p1", name: "Thrall", className: "Warrior", level: 20, faction: "Horde", readiness: { equipment: [{ slot: 5, itemId: 500, name: "Old Chest" }] } };

test("bundled boss loot pack: checksum, coverage and every atlas boss", () => {
  const dir = path.join(root, "data/forever-boss-loot"), b = fs.readFileSync(path.join(dir, "pack.json"));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json"), "utf8"));
  assert.equal(lock.sha256, hash(b)); assert.equal(lock.bytes, b.length);
  assert.equal(lock.repository, "JIVESCORP/eg-link-output-wowf"); assert.equal(lock.license, "CC BY 4.0");
  assert.equal(lock.commit, JSON.parse(fs.readFileSync(path.join(root, "data/forever-loot/source-lock.json"), "utf8")).commit);
  for (const f of ["LICENSE", "NOTICE"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(fs.readFileSync(path.join(dir, "NOTICE"), "utf8"), /CC BY 4\.0/);
  const p = loadBossLootPack();
  assert.ok(p, "pack validates");
  assert.deepEqual(Object.keys(p.instances).sort(), BASELINE.map((r) => r[0]).sort());
  for (const r of BASELINE) assert.deepEqual(p.instances[r[0]].bosses.map((x) => x.name), r[10], r[0]);
  const bosses = Object.values(p.instances).flatMap((i) => i.bosses);
  assert.equal(bosses.filter((x) => x.items.length).length, lock.bossesWithLoot);
  assert.ok(lock.bossesWithLoot >= 40, `only ${lock.bossesWithLoot} bosses with loot`);
  assert.ok(bosses.every((x) => x.items.every((i) => i.chance >= 0.03) && x.items.length <= 16));
  const r = spawnSync(process.execPath, ["scripts/build-forever-boss-loot.cjs", "--check"], { cwd: root, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Boss loot pack check passed/);
});

test("validator is strict and bounded", () => {
  assert.equal(validateBossLootPack(tiny()).kind, "forever-boss-loot");
  const bad = [
    (p) => { p.kind = "forever-loot"; }, (p) => { p.license = "MIT"; }, (p) => { p.sourceCommit = "abc"; }, (p) => { p.builds = []; },
    (p) => { p.minChance = 0.01; }, (p) => { p.instances = []; }, (p) => { p.instances["Bad Id"] = p.instances.dm; },
    (p) => { p.instances.dm.bosses = []; }, (p) => { p.instances.dm.bosses[1].name = "Edwin VanCleef"; },
    (p) => { p.instances.dm.bosses[0].items[2].chance = 0.02; }, (p) => { p.instances.dm.bosses[0].items[0].chance = 0.1; },
    (p) => { p.instances.dm.bosses[0].items[1].itemId = 9001; }, (p) => { p.instances.dm.bosses[0].items[0].drops = 0; },
    (p) => { p.instances.dm.bosses[0].items[0].itemId = -1; }, (p) => { p.instances.dm.bosses[0].npcIds = [639, 639]; },
    (p) => { p.instances.dm.bosses[0].items = Array.from({ length: 17 }, (_, i) => ({ itemId: i + 1, chance: 0.5, drops: 1 })); },
  ];
  for (const [i, f] of bad.entries()) { const p = clone(tiny()); f(p); assert.throws(() => validateBossLootPack(p), /Invalid boss loot pack/, `case ${i}`); }
  const idx = dropIndex(tiny());
  assert.deepEqual(idx.get(9002), [{ instanceId: "dm", boss: "Edwin VanCleef", chance: 0.5 }]);
});

test("upgrade verdicts compare against what the character wears", () => {
  const eq = equipmentContext(warrior, gameData);
  assert.equal(eq.equipmentKnown, true); assert.equal(eq.bySlot[5].id, 500);
  const v = (id, e = eq) => upgradeVerdict(ITEMS[id] || null, e);
  assert.equal(v(9001).verdict, "upgrade"); assert.equal(v(9001).text, "Upgrade for you"); assert.ok(v(9001).reasons.some((r) => /Strength/.test(r)));
  assert.equal(v(9002).verdict, "not-for-you"); assert.match(v(9002).text, /plate from level 40/);
  assert.equal(v(9003).verdict, "not-upgrade");
  assert.equal(v(9004).verdict, "upgrade-later"); assert.equal(v(9004).text, "Upgrade for you at level 24");
  assert.equal(v(9005).verdict, "not-equipment");
  assert.equal(v(424242).verdict, "unknown");
  assert.equal(upgradeVerdict(ITEMS[9001], equipmentContext({ ...warrior, readiness: {} }, gameData)).verdict, "usable");
  assert.equal(upgradeVerdict(ITEMS[9001], equipmentContext({ ...warrior, className: null }, gameData)).verdict, "no-class");
  // A priest cannot wear mail at any level: never an upgrade.
  assert.equal(upgradeVerdict(ITEMS[9001], equipmentContext({ ...warrior, className: "Priest" }, gameData)).verdict, "not-for-you");
});

test("atlas summary, instance loot and item cards", () => {
  const pack = tiny();
  const s = atlasLootSummary(pack, { profile: warrior, gameData, wished: [9002] });
  assert.deepEqual({ ...s.dm, wished: s.dm.wished.map((w) => w.itemId) }, { bosses: 2, bossesWithLoot: 1, items: 3, upgrades: 1, later: 0, wished: [9002] });
  assert.equal(s.dm.wished[0].boss, "Edwin VanCleef");
  const d = instanceLoot(pack, "dm", { profile: warrior, gameData, wished: [9002] });
  assert.equal(d.name, "The Deadmines"); assert.equal(d.bosses[1].items.length, 0);
  assert.deepEqual(d.bosses[0].items.map((x) => [x.itemId, x.verdict.verdict, x.wished]), [[9001, "upgrade", false], [9002, "not-for-you", true], [9003, "not-upgrade", false]]);
  assert.equal(d.bosses[0].items[0].item.iconFileId, 1234); assert.equal(d.bosses[0].items[0].item.sellPrice, undefined);
  assert.equal(instanceLoot(pack, "nope", {}), null);
  const c = itemCard(pack, 9001, { profile: warrior, gameData });
  assert.deepEqual(c.sources, [{ boss: "Edwin VanCleef", instanceId: "dm", instance: "The Deadmines", chance: 1 }]);
  assert.equal(c.verdict.verdict, "upgrade"); assert.equal(itemCard(pack, 1, { gameData }).sources.length, 0);
});

test("wish list persists per character, bounded", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-wish-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = new WishList(dir);
  assert.deepEqual(w.set("p1", 9001, true), [9001]); assert.deepEqual(w.set("p1", 9002, true), [9002, 9001]); assert.deepEqual(w.set("p1", 9001, true), [9001, 9002]);
  assert.deepEqual(new WishList(dir).get("p1"), [9001, 9002]); assert.deepEqual(new WishList(dir).get("p2"), []);
  assert.deepEqual(w.set("p1", 9001, false), [9002]);
  for (const bad of [["", 1, true], ["p1", 0, true], ["p1", 1.5, true], ["p1", 1, "yes"], ["x".repeat(101), 1, true]]) assert.throws(() => w.set(...bad), /Invalid wish list/);
  fs.writeFileSync(path.join(dir, "wishlist.json"), JSON.stringify({ schemaVersion: 1, profiles: { p1: [1, -2, "3", 1, 4], bad: "x" } }));
  assert.deepEqual(new WishList(dir).get("p1"), [1, 4]);
  fs.writeFileSync(path.join(dir, "wishlist.json"), "{broken"); assert.deepEqual(new WishList(dir).get("p1"), []);
  w.clear(); assert.equal(fs.existsSync(path.join(dir, "wishlist.json")), false);
});

test("loot IPC validates arguments like the other handlers", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-wish-ipc-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {}, state = { activeProfileId: "p1", profiles: [warrior] };
  const wishlist = new WishList(dir);
  const api = registerBossLootHandlers({ handle: (n, fn) => { handlers[n] = fn; }, getState: () => state, gameData, wishlist, getPack: () => tiny() });
  assert.deepEqual(Object.keys(handlers).sort(), ["dungeonLoot", "itemCard", "setLootWish"]);
  const call = async (n, ...a) => handlers[n](...a);
  // itemCard
  for (const args of [[], [null], [null, 1, 2]]) await assert.rejects(call("itemCard", ...args), /Invalid loot request/);
  for (const id of [0, -1, 1.5, "9001", 2147483648, null, NaN]) await assert.rejects(call("itemCard", null, id), /Invalid item ID/);
  for (const p of [42, "", "x".repeat(101), {}]) await assert.rejects(call("itemCard", p, 9001));
  await assert.rejects(call("itemCard", "ghost", 9001), /Choose a character/);
  const card = await call("itemCard", null, 9001);
  assert.equal(card.verdict.verdict, "upgrade"); assert.equal(card.sources[0].boss, "Edwin VanCleef"); assert.equal(card.wished, false);
  assert.equal((await call("itemCard", "p1", 9003)).verdict.verdict, "not-upgrade");
  // dungeonLoot
  for (const id of ["DM", "", "a".repeat(25), 5, null, "dm/../x"]) await assert.rejects(call("dungeonLoot", null, id), /Invalid instance/);
  await assert.rejects(call("dungeonLoot", null), /Invalid loot request/);
  assert.equal((await call("dungeonLoot", null, "dm")).bosses.length, 2);
  assert.deepEqual((await call("dungeonLoot", null, "zz")).bosses, []);
  // setLootWish
  await assert.rejects(call("setLootWish", null, 9001), /Invalid loot request/);
  await assert.rejects(call("setLootWish", null, 9001, "on"), /Invalid wish list/);
  await assert.rejects(call("setLootWish", null, 0, true), /Invalid item ID/);
  assert.deepEqual(await call("setLootWish", null, 9001, true), { itemIds: [9001] });
  assert.equal((await call("itemCard", null, 9001)).wished, true);
  assert.equal(api.summary(warrior).dm.wished[0].itemId, 9001);
  state.activeProfileId = null; state.profiles = [];
  await assert.rejects(call("setLootWish", null, 9001, true), /Choose a character/);
  assert.equal((await call("itemCard", null, 9001)).verdict.verdict, "no-class");
});

test("renderer wiring: preload, hover card targets and CSP-safe markup", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const preload = read("src/preload.cjs");
  for (const m of ["dungeonLoot", "itemCard", "setLootWish"]) assert.match(preload, new RegExp(`${m}: \\(`), m);
  const hc = read("src/renderer/hover-cards.js");
  assert.match(hc, /\[data-card-item\]/); assert.match(hc, /\[data-card-npc\]/);
  assert.ok(!/api\.bootstrap/.test(hc), "hover cards must never call bootstrap");
  assert.match(read("src/renderer/dungeon-atlas.js"), /data-card-item=/);
  assert.match(read("src/renderer/quest-guide.js"), /data-card-item=/);
  assert.match(read("src/renderer/world-map.js"), /data-card-npc=/);
  assert.match(read("src/renderer/now.js"), /data-card-npc=/);
  for (const f of ["src/renderer/dungeon-atlas.js", "src/renderer/hover-cards.js"]) assert.ok(!/style="/.test(read(f)), `${f} uses inline style attributes`);
});
