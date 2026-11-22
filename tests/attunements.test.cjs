"use strict";
// Roadmap G5 (attunements and keys) and C11 (collections): only what the data can confirm.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { CHAINS, verifyChains, attunementView } = require("../src/core/attunements.cjs");
const { collections } = require("../src/core/collections.cjs");
const { registerGearPlanning } = require("../src/core/gear-planning-ipc.cjs");

const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"), "utf8"));
// Item names as the player's game files hold them (ids and names checked against a real install).
const GAME_NAMES = { 18412: "Core Fragment", 16309: "Drakefire Amulet", 12344: "Seal of Ascension", 12219: "Unadorned Seal of Ascension", 18249: "Crescent Key", 13704: "Skeleton Key",
  12382: "Key to the City", 11000: "Shadowforge Key", 7146: "The Scarlet Key", 6893: "Workshop Key", 9241: "Sacred Mallet", 9240: "Mallet of Zul'Farrak" };
const itemName = (id) => GAME_NAMES[id] || null;
const chain = (view, id) => view.chains.find((c) => c.id === id);
const hero = (extra = {}) => ({ id: "p1", name: "Vael", faction: "Horde", level: 60, history: { completedIdsKnown: true, completedIds: [], recent: [] }, quests: [],
  readiness: { equipment: [] }, ledger: { bags: { seenAt: 1, items: [] }, bank: { seenAt: 1, items: [] } }, ...extra });

test("every quest step is in the bundled Forever quest data under the same id and title", () => {
  const checked = verifyChains({ pack: bundled, itemName });
  assert.equal(checked.length, CHAINS.length);
  for (const c of checked) for (const s of c.steps) {
    assert.equal(s.confirmed, true, `${c.id}: ${s.type === "item" ? s.name : s.title}`);
    if (s.type === "quest") for (const id of s.confirmedIds) assert.equal(bundled.quests[id].title, s.title);
  }
  // Versions the bundled data does not hold are simply not used.
  assert.deepEqual(checked.find((c) => c.id === "mc").steps[1].confirmedIds, [7487]);
  assert.deepEqual(checked.find((c) => c.id === "naxx").steps[0].confirmedIds, [9121, 9122]);
  assert.deepEqual(new Set(CHAINS.map((c) => c.id)).size, CHAINS.length);
});

test("both sides get their own Onyxia and Scholomance chains, and the same shared ones", () => {
  const horde = attunementView(hero(), { pack: bundled, itemName }), alliance = attunementView(hero({ faction: "Alliance" }), { pack: bundled, itemName });
  assert.deepEqual(horde.chains.map((c) => c.id).sort(), ["brd", "bwl", "dm", "gnomer", "mc", "naxx", "ony-horde", "scholo-horde", "sm", "strat", "ubrs", "zf"]);
  assert.deepEqual(alliance.chains.map((c) => c.id).sort(), ["brd", "bwl", "dm", "gnomer", "mc", "naxx", "ony-alliance", "scholo-alliance", "sm", "strat", "ubrs", "zf"]);
  assert.equal(attunementView(null, { pack: bundled, itemName }).chains.length, CHAINS.length, "without a character every chain is listed");
});

test("a step the data cannot confirm is marked and never counts as progress", () => {
  const noGame = attunementView(hero(), { pack: bundled });
  assert.equal(chain(noGame, "dm").status, "unconfirmed");
  assert.equal(chain(noGame, "dm").steps[0].state, "unconfirmed");
  assert.equal(chain(noGame, "mc").unconfirmedSteps, 1);
  assert.equal(chain(noGame, "mc").totalSteps, 1);
  assert.equal(chain(noGame, "ubrs").key.confirmed, true, "Seal of Ascension is in the bundled item names");
  const wrongName = attunementView(hero(), { pack: bundled, itemName: (id) => (id === 18249 ? "Some Other Key" : itemName(id)) });
  assert.equal(chain(wrongName, "dm").status, "unconfirmed", "the id alone is not enough; the name must match");
  const noPack = attunementView(hero(), { itemName });
  assert.equal(chain(noPack, "bwl").status, "unconfirmed");
  assert.equal(chain(noPack, "bwl").steps[0].confirmed, false);
});

test("the step you are on comes from finished quests, the quest log and held keys", () => {
  const p = hero({ history: { completedIdsKnown: true, completedIds: [838, 964, 4903, 4183, 4184], recent: [{ id: 5514 }] }, quests: [{ id: 5802, title: "Fire Plume Forged", complete: true }, { id: 4941, title: "Eitrigg's Wisdom", complete: false }] });
  const view = attunementView(p, { pack: bundled, itemName });
  const scholo = chain(view, "scholo-horde");
  assert.equal(scholo.status, "started"); assert.equal(scholo.finishedSteps, 3); assert.equal(scholo.totalSteps, 6);
  assert.equal(scholo.current.title, "Fire Plume Forged"); assert.equal(scholo.current.state, "in-log"); assert.equal(scholo.current.detail, "ready to hand in");
  const ony = chain(view, "ony-horde");
  assert.equal(ony.current.title, "Eitrigg's Wisdom"); assert.equal(ony.steps[0].state, "done");
  assert.equal(chain(view, "bwl").status, "not-started");
  assert.equal(chain(view, "bwl").current.title, "Blackhand's Command");
  assert.equal(view.chains[0].status, "started", "chains you are on come first");
  assert.deepEqual(view.counts, { done: 0, started: 2, total: 12 });
});

test("a later step or the key itself settles the steps before it", () => {
  const view = attunementView(hero({ faction: "Alliance", history: { completedIdsKnown: true, completedIds: [4264, 4183], recent: [] },
    readiness: { equipment: [{ slot: 11, itemId: 12344 }] }, ledger: { bags: { seenAt: 1, items: [{ id: 9241, n: 1 }] }, bank: { seenAt: 1, items: [{ id: 7146, n: 1 }] } } }), { pack: bundled, itemName });
  const ony = chain(view, "ony-alliance");
  assert.equal(ony.steps[0].state, "done"); assert.equal(ony.steps[0].detail, "a later step is saved");
  assert.equal(ony.steps[4].state, "done"); assert.equal(ony.current.title, "A Shred of Hope");
  const ubrs = chain(view, "ubrs");
  assert.equal(ubrs.status, "done"); assert.equal(ubrs.key.held, "worn"); assert.equal(ubrs.current, null);
  assert.ok(ubrs.steps.every((s) => s.state === "done"));
  assert.equal(chain(view, "sm").key.held, "bank");
  const zf = chain(view, "zf");
  assert.equal(zf.status, "started"); assert.equal(zf.current.title, "Mallet of Zul'Farrak");
  const masters = attunementView(hero({ faction: "Alliance", history: { completedIdsKnown: true, completedIds: [4182, 4183, 4184], recent: [] } }), { pack: bundled, itemName });
  const step = chain(masters, "ony-alliance").steps[1];
  assert.equal(step.state, "in-progress"); assert.equal(step.detail, "2 of 6 parts finished");
});

test("unknown history is said plainly, and data-backed drop sources are attached", () => {
  const view = attunementView(hero({ history: {}, ledger: undefined }), { pack: bundled, itemName, bossLoot: { instances: { gnomer: { bosses: [{ name: "Electrocutioner 6000", npcIds: [6235], items: [{ itemId: 6893, chance: 1, drops: 2 }] }] } } }, instanceNames: { gnomer: "Gnomeregan" } });
  assert.equal(chain(view, "bwl").status, "unknown");
  assert.equal(chain(view, "dm").status, "not-started", "an item-only key needs no quest history");
  assert.ok(view.notes.some((n) => /Finished quests are not known/.test(n)));
  assert.ok(view.notes.some((n) => /Bags are not saved/.test(n)));
  assert.match(view.notes[0], /^Taken from the classic game/);
  assert.deepEqual(chain(view, "gnomer").steps[0].seenFrom, { instanceId: "gnomer", boss: "Electrocutioner 6000" });
  assert.equal(chain(view, "gnomer").instance, "Gnomeregan");
});

test("collections list only what bags, bank and worn gear prove", () => {
  const FACTS = { 5655: { name: "Chestnut Mare Bridle", classId: 15, subclassId: 5, inventoryType: 0, quality: 3 }, 8485: { name: "Cat Carrier (Bombay)", classId: 15, subclassId: 2, inventoryType: 0, quality: 1 },
    5976: { name: "Guild Tabard", classId: 4, subclassId: 0, inventoryType: 19, quality: 1 }, 2406: { name: "Pattern: Fine Leather Boots", classId: 9, subclassId: 1, inventoryType: 0, quality: 1 }, 159: { name: "Refreshing Spring Water", classId: 0, subclassId: 5, inventoryType: 0, quality: 1 } };
  const p = { id: "p1", readiness: { equipment: [{ slot: 19, itemId: 5976, name: "Guild Tabard" }],
    workshop: { professions: { items: [{ skillLineId: 197, name: "Tailoring", rank: 86 }, { skillLineId: 185, name: "Cooking", rank: 74 }, { skillLineId: 182, name: "Herbalism", rank: 88 }] }, recipes: { complete: true, items: [{ id: 1, skillLineId: 197 }, { id: 2, skillLineId: 197 }, { id: 3, skillLineId: 185 }] } } },
    ledger: { bags: { seenAt: 5, items: [{ id: 5655, n: 1 }, { id: 159, n: 20 }, { id: 2406, n: 1 }, { id: 8485, n: 1 }] }, bank: { seenAt: 4, items: [{ id: 8485, n: 2 }, { id: 77777, n: 1, name: "Unknown Thing" }] } } };
  const c = collections(p, { itemFact: (id) => FACTS[id] || null });
  assert.equal(c.status, "available");
  assert.deepEqual(c.families.map((f) => [f.key, f.count]), [["mounts", 1], ["pets", 1], ["tabards", 1], ["recipes", 1]]);
  assert.deepEqual(c.families[1].items[0], { itemId: 8485, name: "Cat Carrier (Bombay)", quality: 1, count: 3, where: ["bags", "bank"], iconFileId: null });
  assert.deepEqual(c.families[2].items[0].where, ["worn"]);
  assert.deepEqual(c.recipes, [{ profession: "Tailoring", rank: 86, count: 2 }, { profession: "Cooking", rank: 74, count: 1 }]);
  assert.equal(c.recipesKnown, 3); assert.equal(c.itemsChecked, 6); assert.equal(c.itemsKnown, 5);
  assert.ok(c.notes.some((n) => /learned is not saved/.test(n)), "it never claims a full collection");
  const blind = collections(p, {});
  assert.ok(blind.families.every((f) => f.count === 0));
  assert.ok(blind.notes.some((n) => /Item kinds are not available/.test(n)));
  assert.ok(collections({ id: "x" }, {}).notes.some((n) => /Bags are not saved/.test(n)));
  assert.equal(collections(null).status, "unavailable");
});

test("IPC: attunements for the active or a named character; collections need a character", () => {
  const handlers = {}, state = { activeProfileId: "p1", profiles: [hero({ history: { completedIdsKnown: true, completedIds: [7761], recent: [] } })] };
  registerGearPlanning({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, gameData: { build: () => "1.60.1.70888", items: (ids) => ids.map((id) => (GAME_NAMES[id] ? { id, name: GAME_NAMES[id] } : null)) },
    statWeights: { get: () => null }, gearPins: { get: () => ({}) }, wishlist: { get: () => [] }, questPack: () => bundled, bossLootPack: () => null });
  const view = handlers.attunements(null);
  assert.equal(view.profileId, "p1");
  assert.equal(chain(view, "bwl").status, "done");
  assert.equal(chain(view, "dm").steps[0].confirmedBy, "your game files");
  assert.equal(handlers.attunements("p1").profileId, "p1");
  assert.throws(() => handlers.attunements("nobody"), /Choose a character/);
  assert.throws(() => handlers.attunements(), /Invalid request/);
  assert.equal(handlers.collections("p1").status, "available");
  assert.throws(() => handlers.collections("nobody"), /Choose a character/);
});
