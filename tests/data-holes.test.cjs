"use strict";
// Data holes: what a newer upstream snapshot and the player's own game files add, and how the
// compilers treat names seen in a game in another language than English.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { latinName } = require("../src/core/latin-name.cjs");
const knowledge = require("../src/core/knowledge.cjs");
const V = require("../src/core/vendor-facts.cjs");
const T = require("../src/core/trainer-data.cjs");
const X = require("../src/core/transport-data.cjs");
const P = require("../src/core/travel-planner.cjs");
const ipc = require("../src/core/travel-planner-ipc.cjs");
const rep = require("../src/core/rep-planner.cjs");
const book = require("../src/core/recipe-book.cjs");
const vfx = require("./fixtures/vendor-facts.cjs"), tfx = require("./fixtures/transport.cjs");
const root = path.join(__dirname, "..");
const KOREAN = "지나", KOREAN_ITEM = "곡궁";

test("a name in another script is told apart from an English one", () => {
  for (const ok of ["Dungar Longdrink", "Sen'jin Village", "Zul'Farrak", "Café", ""]) assert.equal(latinName(ok), true, ok);
  for (const no of [KOREAN, "Thor " + KOREAN, "Тор", "雷霆", undefined, null, 5]) assert.equal(latinName(no), false, String(no));
});

test("quest sides: a race mask that allows one side's races only gives the side", () => {
  const side = knowledge.raceMaskSide;
  assert.equal(side("ffffffffffffffff"), null, "every race");
  assert.equal(side("000000000000004d"), "Alliance"); assert.equal(side("0000000000000001"), "Alliance");
  assert.equal(side("00000000000000b2"), "Horde"); assert.equal(side("0000000000000020"), "Horde");
  assert.equal(side("0000000000000003"), null, "Human and Orc");
  assert.equal(side("0000000000000100"), null, "no classic race");
  for (const bad of [undefined, "", "4d", "zzzzzzzzzzzzzzzz"]) assert.equal(side(bad), null);
  // The bundled pack: a quest never has a side its race mask rules out.
  const pack = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  let fromMask = 0;
  for (const q of Object.values(pack.quests)) { const s = side(q.raceMask); if (s && q.sides) { assert.deepEqual(q.sides, [s], `quest ${q.id}`); fromMask++; } }
  assert.ok(fromMask > 500, `${fromMask} quests carry a side that their race mask confirms`);
});

test("sellers: a listing keeps the full price, the Honored price, its stack and limited stock; other costs are left out", () => {
  const raw = vfx.fixture();
  const entries = raw["vendors.json"].vendors[10].entries;
  entries["item:10"] = { itemId: 10, name: "Honored Only", sources: 1, stack: 1, costs: { 6: 900 } };
  entries["item:11"] = { itemId: 11, name: "Rare Pattern", sources: 1, stack: 1, costs: { 4: 2000, 6: 1800 }, limited: true, stockMax: 1 };
  entries["item:12"] = { itemId: 12, name: "Token Goods", sources: 1, stack: 1, costItems: [{ currencyId: 3402, amount: 30, name: "Merchant's Favor" }] };
  entries["item:13"] = { itemId: 13, name: "Bartered", sources: 1, stack: 1, bartered: { 2: { 5: 5 } } };
  entries["item:14"] = { itemId: 14, name: KOREAN_ITEM, sources: 1, stack: 1, costs: { 5: 5 } };
  const p = V.normalizeVendors(raw, { commit: vfx.commit, build: vfx.build });
  const rows = Object.fromEntries(p.vendors[0].listings.map((l) => [l.itemId, l]));
  assert.deepEqual(rows[2320], { key: "item:2320", itemId: 2320, name: "Coarse Thread", sources: 1, price: 10, stack: 5 });
  assert.deepEqual(rows[10], { key: "item:10", itemId: 10, name: "Honored Only", sources: 1, honored: 900 });
  assert.deepEqual(rows[11], { key: "item:11", itemId: 11, name: "Rare Pattern", sources: 1, price: 2000, honored: 1800, stock: 1 });
  assert.deepEqual(rows[12], { key: "item:12", itemId: 12, name: "Token Goods", sources: 1 });
  assert.deepEqual(rows[13], { key: "item:13", itemId: 13, name: "Bartered", sources: 1 });
  assert.equal(rows[14], undefined, "a listing named in another language is left out");
  assert.equal(p.counts.droppedListings, 1);
  for (const bad of [{ price: 0 }, { price: 1.5 }, { honored: -1 }, { stack: 1 }, { stock: 0 }, { limited: true }]) {
    const broken = structuredClone(p); Object.assign(broken.vendors[0].listings[0], bad);
    assert.throws(() => V.validateVendorPack(broken), /Invalid historical seller data/, JSON.stringify(bad));
  }
  // A seller whose name was seen in another language is left out of that build.
  const other = vfx.fixture();
  for (const f of ["vendors.json", "npcs.json", "creatures.json"]) Object.values(other[f])[1][10].name = KOREAN;
  other["vendors.json"].vendors[11] = { ...structuredClone(raw["vendors.json"].vendors[10]), name: "Second seller" };
  other["npcs.json"].npcs[11] = { name: "Second seller", interactions: ["Merchant"] };
  other["creatures.json"].creatures[11] = { name: "Second seller", sources: 1, reactions: {} };
  const q = V.normalizeVendors(other, { commit: vfx.commit, build: vfx.build });
  assert.deepEqual(q.vendors.map((v) => v.id), [11]); assert.equal(q.counts.droppedVendors, 1);
});

test("sellers: the newest build's price wins; an older build fills a missing price and limited stock", () => {
  const newer = vfx.fixture("1.60.1.70888"), older = vfx.fixture("1.60.1.70862");
  newer["vendors.json"].vendors[10].entries = {
    "item:2320": { itemId: 2320, name: "Coarse Thread", sources: 1, stack: 5, costs: { 5: 12 } },
    "item:20": { itemId: 20, name: "Unpriced Now", sources: 1, stack: 1 },
    "item:21": { itemId: 21, name: "Honored Now", sources: 1, stack: 1, costs: { 6: 90 } },
  };
  older["vendors.json"].vendors[10].entries = {
    "item:2320": { itemId: 2320, name: "Coarse Thread", sources: 1, stack: 5, costs: { 5: 10, 6: 9 }, limited: true, stockMax: 3 },
    "item:20": { itemId: 20, name: "Unpriced Now", sources: 1, stack: 20, costs: { 5: 400 } },
    "item:21": { itemId: 21, name: "Honored Now", sources: 1, stack: 5, costs: { 5: 500 } },
  };
  const merged = V.mergeVendorPacks([V.normalizeVendors(newer, { commit: vfx.commit, build: "1.60.1.70888" }), V.normalizeVendors(older, { commit: vfx.commit, build: "1.60.1.70862" })]);
  const rows = Object.fromEntries(merged.vendors[0].listings.map((l) => [l.itemId, l]));
  assert.deepEqual([rows[2320].price, rows[2320].honored, rows[2320].stack, rows[2320].stock], [12, 9, 5, 3]);
  assert.deepEqual([rows[20].price, rows[20].stack], [400, 20], "a price comes with its own stack");
  assert.deepEqual([rows[21].price, rows[21].honored, rows[21].stack], [undefined, 90, undefined], "a price for another stack size is not mixed in");
});

test("the bundled seller pack has prices and limited stock, and no name in another script", () => {
  const pack = V.loadVendorPack();
  const listings = pack.vendors.flatMap((v) => v.listings);
  assert.ok(listings.filter((l) => l.price !== undefined || l.honored !== undefined).length > listings.length * 0.8);
  assert.ok(listings.some((l) => l.stock >= 1));
  for (const v of pack.vendors) { assert.ok(latinName(v.name), v.name); for (const l of v.listings) assert.ok(latinName(l.name), l.name); }
});

test("no bundled pack or addon data file carries a name in another script", () => {
  const other = /[Ͱ-᷿⺀-퟿豈-﫿＀-￯]/;
  for (const dir of fs.readdirSync(path.join(root, "data")).filter((d) => d.startsWith("forever"))) {
    const file = path.join(root, "data", dir, "pack.json");
    if (fs.existsSync(file)) assert.equal(other.test(fs.readFileSync(file, "utf8")), false, dir);
  }
  for (const name of ["BackstageForeverReference.lua", "BackstageForeverSources.lua", "BackstageForeverFind.lua", "BackstageForeverTravelData.lua", "BackstageForeverAdvisorData.lua", "BackstageForeverGuideData.lua", "BackstageForeverRareData.lua"]) {
    const text = fs.readFileSync(path.join(root, "addon", "BackstageForever", name), "utf8").replace(/(?:\\\d{3})+/g, (m) => Buffer.from(m.split("\\").filter(Boolean).map(Number)).toString("utf8"));
    assert.equal(other.test(text), false, name);
  }
});

test("trainers and flight masters: a row seen in another language gives way to an older build's English one", () => {
  const commit = "b".repeat(40), build = "1.60.1.100", older = "1.60.1.90";
  const meta = (dataset, clientBuild) => ({ attribution: T.ATTRIBUTION, clientBuild, collectedOn: { first: "2026-11-10", last: "2026-11-12" }, dataset, license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources: 1 });
  const files = (b, services) => ({
    "trainers.json": Buffer.from(JSON.stringify({ meta: meta("trainers", b), trainers: { 100: { name: "Mage One", trainerType: 0, services } } })),
    "creature_details.enUS.json": Buffer.from(JSON.stringify({ meta: meta("creature_details", b), creatures: { 100: { name: "Mage One", title: "Mage Trainer" } } })),
  });
  const s = (spellId, name, level, extra = {}) => ({ spellId, name, level, costs: { 5: 100 }, sources: 1, ...extra });
  const p = T.compileTrainers([
    { build, files: files(build, { 1: s(1, KOREAN, 20), 2: s(2, "Blink", 20, { rankText: KOREAN }), 3: s(3, "Scorch", 22) }) },
    { build: older, files: files(older, { 1: s(1, "Frostbolt", 0), 4: s(4, KOREAN_ITEM, 8) }) },
  ], { commit });
  assert.deepEqual(p.classes.Mage.map((r) => [r.id, r.name, r.level]), [[3, "Scorch", 22], [1, "Frostbolt", 0]]);
  assert.equal(p.counts.droppedServices, 3);

  const newest = tfx.flights(tfx.build), old = tfx.flights(tfx.older);
  newest.masters[11].name = KOREAN;
  const pack = X.compileTransport([{ build: tfx.build, files: tfx.buffers(newest) }, { build: tfx.older, files: tfx.buffers(old, tfx.npcs(tfx.older)) }], { commit: tfx.commit });
  assert.equal(pack.nodes.find((n) => n.id === 1).master, "Ann");
});

// --- The player's own game files ------------------------------------------------------------------
const transport = () => X.compileTransport([{ build: tfx.build, files: tfx.buffers() }], { commit: tfx.commit });
const GAME = { points: { 1: ["Annville, Barrens", 1, 900, 900, 2], 2: ["Bobton, Barrens", 1, 1, 1, 2], 4: ["Fourth Post, Barrens", 1, 100, 100, 3], 5: ["", 1, 0, 0, 0], 9: ["Elsewhere", 0, 5, 5, 1] }, costs: { "1>2": 9999, "2>1": 100, "3>5": 250, "9>1": 5 } };

test("game files add flight point names, missing places and missing prices; what players recorded stays", () => {
  const p = transport();
  const same = P.withGameFiles(p, null);
  assert.equal(same.pack, p); assert.deepEqual(same.filled, { names: 0, places: 0, prices: 0 });
  const { pack, names, filled } = P.withGameFiles(p, GAME);
  assert.deepEqual(names, { 1: "Annville, Barrens", 2: "Bobton, Barrens", 4: "Fourth Post, Barrens" });
  assert.deepEqual(filled, { names: 3, places: 1, prices: 1 });
  const node = (id) => pack.nodes.find((n) => n.id === id), edge = (k) => pack.edges.find((e) => `${e.from}>${e.to}` === k);
  assert.deepEqual([node(2).wx, node(2).wy, node(2).positionFrom], [p.nodes.find((n) => n.id === 2).wx, p.nodes.find((n) => n.id === 2).wy, "master"], "a recorded place is kept");
  assert.deepEqual([node(4).wx, node(4).wy, node(4).instance, node(4).positionFrom, node(4).mapId], [100, 100, 1, "game", null]);
  assert.equal(node(5).wx, null, "a flight point the game files do not name stays as it was");
  assert.equal(edge("1>2").cost, 100, "a seen price is never replaced");
  assert.deepEqual([edge("2>1").cost, edge("2>1").honored], [null, 90], "a price seen at Honored is kept as seen");
  assert.equal(edge("3>5").cost, 250);
  assert.equal(p.edges.find((e) => e.from === 3 && e.to === 5).cost, null, "the bundled pack itself is not changed");
  // The route through point 4 now has a time estimate and a price where it had neither.
  const before = P.flightRoute(p, 3, 5, new Set([1, 2, 3, 4, 5])), after = P.flightRoute(pack, 3, 5, new Set([1, 2, 3, 4, 5]));
  assert.equal(before.cost, null); assert.equal(after.cost, 250);
});

test("travel view and plan: names from the game files show, names a character saw in game come first", () => {
  const p = transport();
  const profile = { id: "p1", name: "Tester", faction: "Horde", clientBuild: tfx.build, source: { kind: "wow-addon", updatedAt: "2026-11-20T10:00:00Z" }, travel: { seenAt: 1, nodes: [{ id: 2, name: "Bobstadt", known: true }, { id: 1, known: true }, { id: 3, known: true }] } };
  const state = { profiles: [profile], activeProfileId: "p1" };
  const plain = ipc.travelView(state, { transport: p, now: 1000 });
  assert.deepEqual(plain.gameFiles, { names: 0, places: 0, prices: 0 });
  const view = ipc.travelView(state, { transport: p, now: 1000, game: GAME });
  assert.deepEqual(view.gameFiles, { names: 3, places: 1, prices: 1 });
  const label = (id) => view.places.find((x) => x.id === `node:${id}`).label;
  assert.equal(label(1), "Annville, Barrens"); assert.equal(label(2), "Bobstadt"); assert.equal(label(4), "Fourth Post, Barrens");
  assert.equal(view.character.namedFlightPoints, 1, "only names the addon saw count as seen in game");
  assert.ok(view.places.find((x) => x.id === "node:1").search.includes("annville"));
  const plan = ipc.travelPlan(state, { from: "node:1", to: "node:3" }, { transport: p, now: 1000, game: GAME });
  const fly = plan.options.find((o) => o.kind === "flight");
  assert.deepEqual(fly.legs.map((l) => [l.from, l.to]), [["Annville, Barrens", "Bobstadt"], ["Bobstadt", plain.places.find((x) => x.id === "node:3").label]]);
  // A broken game read changes nothing.
  const handlers = {};
  const api = ipc.registerTravelPlannerHandlers({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, gameData: { flights() { throw Error("unreadable"); }, spellLevels() { throw Error("unreadable"); } } });
  assert.equal(typeof handlers.travelPlaces, "function"); assert.equal(typeof api.trainerView, "function");
});

test("at the trainer: a skill with no recorded level takes its level from the game files, and says so", () => {
  const row = (id, name, level, cost = 100) => ({ id, name, rank: null, level, cost, honored: null, from: "class" });
  const pack = { build: "1.60.1.100", builds: ["1.60.1.100"], classes: { Warrior: [row(1, "Rend", 4), row(2, "Thunder Clap", 0), row(3, "Parry", 0), row(4, "Overpower", 0), row(5, "Mocking Blow", 0)] }, coverage: { Warrior: { trainers: 1, services: 5, withLevel: 1, priced: 5 } } };
  const without = T.trainerPlan(pack, "Warrior", 4);
  assert.deepEqual(without.levels[0].rows.map((r) => r.id), [1]);
  assert.ok(without.notes.some((n) => /^4 of 5 recorded Warrior skills have no recorded level/.test(n)));
  assert.equal(without.nextLevel, null);
  // Parry: level 1 in the game files is the default for passive skills, not a trainer level.
  const plan = T.trainerPlan(pack, "Warrior", 4, { spellLevels: { 2: 6, 3: 1, 4: 12, 5: 0, 1: 99 } });
  assert.deepEqual(plan.levels.map((l) => [l.level, l.rows.map((r) => [r.id, r.levelFrom])]), [[4, [[1, undefined]]], [5, []], [6, [[2, "game"]]]]);
  assert.equal(plan.levels[2].total, 100); assert.equal(plan.nextLevel, 12);
  assert.ok(plan.notes.some((n) => n === "2 Warrior skills have no level recorded at a trainer; their levels come from your game files."));
  assert.ok(plan.notes.some((n) => /^2 of 5 recorded Warrior skills have no recorded level/.test(n)));
  const one = T.trainerPlan(pack, "Warrior", 6, { spellLevels: { 2: 6 } });
  assert.ok(one.notes.some((n) => /^1 Warrior skill has no level recorded at a trainer; its level comes from your game files\.$/.test(n)));
  // Through the IPC view.
  const state = { profiles: [{ id: "p1", className: "Warrior", level: 6, clientBuild: "1.60.1.100", source: { kind: "wow-addon", updatedAt: "2026-11-20T10:00:00Z" } }], activeProfileId: "p1" };
  assert.deepEqual(ipc.trainerView(state, "Warrior", 6, { trainers: pack, spellLevels: { 2: 6 } }).levels[0].rows.map((r) => r.id), [2]);
});

test("reputation sizes are the game's own: the built-in table, the game files when readable, and losses", () => {
  assert.deepEqual(rep.TIER_AMOUNT, { 1: 10, 2: 25, 3: 50, 4: 75, 5: 100, 6: 150, 7: 200, 8: 1, 9: 5 });
  assert.deepEqual(rep.rewardAmount({ tier: 5 }), { amount: 100, exact: false });
  const own = [0, 11, 26, 51, 76, 101, 151, 201, 2, 6];
  assert.deepEqual(rep.rewardAmount({ tier: 5 }, own), { amount: 101, exact: false });
  assert.deepEqual(rep.rewardAmount({ tier: 5, amount: 325 }, own), { amount: 325, exact: true }, "a recorded amount still wins");
  assert.deepEqual(rep.rewardAmount({ tier: 5 }, [0, 0, 0]), { amount: 100, exact: false }, "an unusable table falls back");
  assert.equal(rep.rewardAmount({ tier: -5 }, own), null);
  assert.equal(rep.standardAmount(3), 50); assert.equal(rep.standardAmount(-5), -500); assert.equal(rep.standardAmount(0), null); assert.equal(rep.standardAmount(12), null);
  // The quest view says what a size usually pays where the quest records no exact amount.
  const pack = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  const index = new knowledge.KnowledgeIndex(pack);
  const sized = Object.values(pack.quests).find((q) => q.rewards?.reputation?.some((r) => r.tier === 5 && r.amount === undefined));
  const shown = index.details({}, sized.id);
  assert.ok(shown.rewards.reputation.some((r) => r.tier === 5 && r.standard === 100), JSON.stringify(shown.rewards.reputation));
  const exact = Object.values(pack.quests).find((q) => q.rewards?.reputation?.some((r) => Number.isInteger(r.amount)));
  assert.ok(index.details({}, exact.id).rewards.reputation.every((r) => !Number.isInteger(r.amount) || r.standard === undefined), "an exact amount needs no usual one");
});

test("recipe book: a vendor source carries what others paid and limited stock", () => {
  const vendorPack = { build: "1.60.1.100", vendors: [{ id: 7, name: "Seller", positions: [{ mapId: 1454, x: 0.5, y: 0.5 }], observedReactionsByFaction: { Horde: [5] },
    listings: [{ key: "item:900", itemId: 900, name: "Recipe: Soup", sources: 1, price: 400, stock: 1 }, { key: "item:901", itemId: 901, name: "Recipe: Stew", sources: 1, honored: 900, stack: 5 }, { key: "item:902", itemId: 902, name: "Recipe: Pie", sources: 1 }] }] };
  const index = book.sourceIndex({ vendorPack });
  assert.deepEqual(index.vendors.get(900)[0], { npcId: 7, name: "Seller", zone: "Orgrimmar", sides: ["Horde"], listed: { copper: 400, estimated: false, stack: 1 }, stock: 1 });
  assert.deepEqual(index.vendors.get(901)[0].listed, { copper: 1000, estimated: true, stack: 5 });
  assert.deepEqual([index.vendors.get(902)[0].listed, index.vendors.get(902)[0].stock], [null, null]);
  const game = { recipes: { lines: { 185: ["Cooking", 9, 0] }, rows: [[5000, 185, 50, 90, 0, 1, 0, 0, [77, 1]]], teach: { 5000: [900, 40] } }, spells: (ids) => ids.map((id) => ({ id, name: "Soup", iconFileId: 1 })), items: (ids) => ids.map((id) => ({ id, name: id === 900 ? "Recipe: Soup" : "Thing", quality: 1, iconFileId: 1 })) };
  const { recipes } = book.lineRecipes(game, 185, index);
  assert.deepEqual(recipes[0].sources[0].listed, { copper: 400, estimated: false, stack: 1 }); assert.equal(recipes[0].sources[0].stock, 1);
  const html = fs.readFileSync(path.join(root, "src", "renderer", "recipe-book.js"), "utf8");
  assert.match(html, /others paid/); assert.match(html, /limited stock \(/);
});

test("the one-command refresh keeps early builds that have no quest text for the other packs", () => {
  const quest = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "source-lock.json"), "utf8")).builds.map((b) => b.build);
  const sellers = JSON.parse(fs.readFileSync(path.join(root, "data", "forever-vendors", "source-lock.json"), "utf8")).builds.map((b) => b.build);
  const patch = (b) => b.split(".").slice(0, 3).join(".");
  for (const b of sellers) assert.equal(patch(b), patch(quest[0]), "every merged build is of the same patch");
  assert.ok(quest.every((b) => sellers.includes(b)));
  assert.ok(sellers.length <= V.MAX_BUILDS);
  const tool = fs.readFileSync(path.join(root, "scripts", "refresh-forever-data.cjs"), "utf8");
  assert.match(tool, /no quest text upstream; used by the other packs only/);
});
