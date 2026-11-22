"use strict";
// Roadmap C1: the talent planner's rules, share code, saved builds and the screen's one handler.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const P = require("../src/core/talent-planner.cjs");
const { TalentBuilds, MAX_BUILDS } = require("../src/core/talent-builds.cjs");
const { registerTalentPlanner } = require("../src/core/talent-planner-ipc.cjs");

// A small class: two trees. Row 1 needs 5 points in the tree, row 2 needs 10.
const talent = (id, row, column, maxRank, name, prerequisites = []) => ({ id, row, column, maxRank, name, iconFileId: null, ranks: [], descriptions: [], prerequisites });
const trees = () => ({ className: "Rogue", tabs: [
  { id: 1, name: "Combat", talents: [
    talent(11, 0, 0, 5, "Precision"), talent(12, 0, 1, 3, "Improved Gouge"),
    talent(13, 1, 0, 1, "Riposte"), talent(14, 1, 1, 2, "Endurance", [{ talentId: 12, rank: 3 }]),
    talent(15, 2, 1, 1, "Blade Flurry", [{ talentId: 14, rank: 2 }]), talent(16, 2, 2, 5, "Aggression")] },
  { id: 2, name: "Subtlety", talents: [talent(21, 0, 0, 5, "Camouflage"), talent(22, 1, 0, 5, "Elusiveness")] },
] });
const rep = (id, n) => Array(n).fill(id);

test("one point per level from 10, never below zero", () => {
  assert.deepEqual([1, 9, 10, 11, 24, 60, 61, 99, NaN, "20"].map(P.pointsAt), [0, 0, 1, 2, 15, 51, 51, 51, 0, 0]);
  assert.equal(P.levelOfPick(0), 10); assert.equal(P.levelOfPick(14), 24);
  assert.equal(P.MAX_POINTS, 51);
});

test("adding a point obeys rows, prerequisites, the highest rank and the level", () => {
  const t = trees();
  let r = P.add(t, [], 13);
  assert.equal(r.ok, false); assert.equal(r.reason, "Spend 5 points in Combat first (0 so far)."); assert.deepEqual(r.order, []);
  assert.equal(P.add(t, rep(21, 5), 13).reason, "Spend 5 points in Combat first (0 so far).", "points in another tree do not open a row");
  r = P.add(t, rep(11, 5), 13);
  assert.equal(r.ok, true); assert.deepEqual(r.order, [11, 11, 11, 11, 11, 13]);
  assert.equal(P.add(t, rep(11, 5), 14).reason, "Needs Improved Gouge at rank 3 first.");
  assert.equal(P.add(t, [...rep(11, 5), 12, 12], 14).reason, "Needs Improved Gouge at rank 3 first.");
  assert.equal(P.add(t, [...rep(11, 5), 12, 12, 12], 14).ok, true);
  assert.equal(P.add(t, rep(11, 5), 11).reason, "Precision is already at its highest rank.");
  assert.equal(P.add(t, [...rep(11, 5), 12, 12, 12, 13], 15).reason, "Spend 10 points in Combat first (9 so far).");
  assert.equal(P.add(t, [11, 11, 11], 11, 12).reason, "No points left: level 12 gives 3.");
  assert.equal(P.add(t, [11, 11], 11, 12).ok, true);
  assert.equal(P.add(t, [], 11, 9).reason, "Talent points start at level 10.");
  assert.equal(P.add(t, [], 999).reason, "This talent is not in your trees.");
  assert.equal(P.add(t, [13], 11).reason, "This build breaks the talent rules. Reset it and start again.", "a broken build takes no more points");
  const full = [...rep(11, 5), ...rep(12, 3), 13, 14, 14, 15, ...rep(16, 5), ...rep(21, 5), ...rep(22, 5)];
  assert.equal(P.legal(t, full), true); assert.equal(full.length, 27);
});

test("a build is legal only when its order can be replayed", () => {
  const t = trees();
  assert.equal(P.legal(t, []), true);
  assert.equal(P.legal(t, [13]), false);
  assert.equal(P.legal(t, [...rep(11, 5), 13]), true);
  assert.equal(P.legal(t, [13, ...rep(11, 5)]), false, "the same ranks in an order the game would refuse");
  assert.equal(P.legal(t, rep(11, 6)), false);
  assert.equal(P.legal(t, [11, 11, 11], 11), false, "three points at level 11");
  assert.equal(P.legal(t, [11, "x"]), false); assert.equal(P.legal(t, "text"), false); assert.equal(P.legal(t, [0]), false);
  const r = P.replay(t, [11, 11, 13, 11]);
  assert.equal(r.ok, false); assert.equal(r.at, 2); assert.equal(r.total, 2);
  assert.equal(P.legal({ tabs: [] }, [11]), false); assert.equal(P.legal(null, []), true);
});

test("taking a point back never leaves an illegal build", () => {
  const t = trees();
  assert.deepEqual(P.remove(t, [11, 11], 11), { ok: true, order: [11], reason: null });
  assert.equal(P.remove(t, [], 11).reason, "No point to take back here.", "never below zero");
  assert.equal(P.remove(t, [11], 12).ok, false);
  assert.equal(P.remove(t, [11], 999).ok, false);
  // The fifth row-0 point holds row 1 up.
  let r = P.remove(t, [...rep(11, 5), 13], 11);
  assert.equal(r.ok, false); assert.equal(r.reason, "Talents further down Combat need these points. Take those back first.");
  assert.deepEqual(r.order, [...rep(11, 5), 13], "a refused click changes nothing");
  // With a spare point in row 0 the same click works.
  assert.equal(P.remove(t, [...rep(11, 5), 12, 13], 11).ok, true);
  // A prerequisite cannot drop below the rank its follower needs.
  r = P.remove(t, [...rep(11, 5), 12, 12, 12, 14], 12);
  assert.equal(r.ok, false); assert.equal(r.reason, "Endurance needs Improved Gouge at this rank. Take that point back first.");
  assert.equal(P.remove(t, [...rep(11, 5), 12, 12, 12, 14], 14).ok, true);
  // The last occurrence goes, so the rank drops by one and earlier levels keep their pick.
  assert.deepEqual(P.remove(t, [11, 12, 11, 12], 11).order, [11, 12, 12]);
  // A point placed later moves forward when that is all it takes: 4 + 1 in row 0 still opens row 1.
  r = P.remove(t, [...rep(11, 5), 13, 12], 11);
  assert.equal(r.ok, true); assert.deepEqual(r.order, [11, 11, 11, 11, 12, 13]); assert.equal(P.legal(t, r.order), true);
  // Row 2 leans on ten points above it, wherever they sit.
  const deep = [...rep(11, 5), 12, 12, 12, 14, 14, 15];
  assert.equal(P.remove(t, deep, 11).reason, "Talents further down Combat need these points. Take those back first.");
  assert.equal(P.remove(t, deep, 15).ok, true); assert.equal(P.remove(t, [...deep, 13], 11).ok, true, "an eleventh point above frees one");
  assert.equal(P.remove(t, [13, 11], 11).reason, "This build breaks the talent rules. Reset it and start again.");
  // Every removal the rules allow leaves a legal build, on a long build, for every talent.
  const full = [...rep(11, 5), ...rep(12, 3), 13, 14, 14, 15, ...rep(16, 5), ...rep(21, 5), ...rep(22, 5)];
  for (const id of new Set(full)) { const x = P.remove(t, full, id); assert.equal(P.legal(t, x.order), true); if (x.ok) assert.equal(x.order.length, full.length - 1); }
});

test("reset one tree, and rebuild an order from ranks alone", () => {
  const t = trees();
  assert.deepEqual(P.resetTree(t, [11, 21, 11, 21], "Combat"), [21, 21]);
  assert.deepEqual(P.resetTree(t, [11, 21], "Nothing"), [11, 21]);
  const order = P.orderFromRanks(t, { 13: 1, 11: 5, 21: 2 });
  assert.equal(P.legal(t, order), true); assert.equal(order.length, 8); assert.equal(order.indexOf(13), 5);
  assert.equal(P.orderFromRanks(t, { 13: 1 }), null, "no order reaches these ranks");
  assert.equal(P.orderFromRanks(t, { 11: 6 }), null); assert.equal(P.orderFromRanks(t, { 999: 1 }), null);
  assert.deepEqual(P.orderFromRanks(t, new Map([[11, 2]])), [11, 11]); assert.deepEqual(P.orderFromRanks(t, null), []);
});

test("the view says what each click would do and lists the level-up order", () => {
  const t = trees(), order = [...rep(11, 5), 12, 13];
  const v = P.view(t, order, { planLevel: 60, level: 14 });
  assert.equal(v.ok, true); assert.equal(v.total, 7); assert.equal(v.budget, 51); assert.equal(v.left, 44);
  assert.deepEqual(v.tabs, [{ name: "Combat", points: 7 }, { name: "Subtlety", points: 0 }]);
  assert.deepEqual(v.talents[11], { rank: 5, maxRank: 5, canAdd: false, addWhy: "Precision is already at its highest rank.", canRemove: true, removeWhy: null });
  assert.equal(v.talents[12].canAdd, true); assert.equal(v.talents[12].canRemove, true);
  const tight = P.view(t, [...rep(11, 5), 13]).talents[11];
  assert.equal(tight.canRemove, false, "taking it back would close row 1 under Riposte"); assert.match(tight.removeWhy, /further down Combat/);
  assert.equal(v.talents[13].canRemove, true); assert.equal(v.talents[15].canAdd, false);
  assert.equal(v.talents[22].addWhy, "Spend 5 points in Subtlety first (0 so far).");
  assert.deepEqual(v.steps[0], { level: 10, talentId: 11, name: "Precision", tab: "Combat", rank: 1, maxRank: 5 });
  assert.deepEqual(v.steps[6], { level: 16, talentId: 13, name: "Riposte", tab: "Combat", rank: 1, maxRank: 1 });
  assert.equal(v.steps[5].level, 15); assert.equal(v.dueNow, 5, "level 14 has five points"); assert.equal(v.endLevel, 16);
  const small = P.view(t, [11, 11], { planLevel: 11 });
  assert.equal(small.left, 0); assert.equal(small.talents[12].addWhy, "No points left: level 11 gives 2.");
  const broken = P.view(t, [11, 13, 11]);
  assert.equal(broken.ok, false); assert.deepEqual(broken.order, [11]); assert.equal(broken.steps.length, 1);
  assert.equal(P.view(t, []).endLevel, null);
});

test("two builds compare tree by tree and talent by talent", () => {
  const t = trees();
  const d = P.diff(t, [...rep(11, 5), 12], [...rep(11, 3), ...rep(21, 5)]);
  assert.equal(d.same, false); assert.equal(d.totalA, 6); assert.equal(d.totalB, 8);
  assert.deepEqual(d.tabs, [{ name: "Combat", a: 6, b: 3 }, { name: "Subtlety", a: 0, b: 5 }]);
  assert.deepEqual(d.rows.map((r) => [r.name, r.a, r.b]), [["Precision", 5, 3], ["Improved Gouge", 1, 0], ["Camouflage", 0, 5]]);
  assert.equal(P.diff(t, [11, 12], [12, 11]).same, true, "the order alone is not a difference");
});

test("respec cost follows the classic schedule", () => {
  assert.deepEqual(P.RESPEC_SCHEDULE, [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.equal(P.respecCost(12), 50); assert.equal(P.respecCost(200), 50);
  assert.equal(P.respecCost(0), null); assert.equal(P.respecCost(1.5), null); assert.equal(P.respecCost("2"), null);
});

// The same check the module puts at the end of a code, so the tests can forge one.
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const sign = (head) => `${head}-${(fnv(head.toLowerCase()) % 1679616).toString(36).padStart(4, "0")}`;

test("a share code carries class, ranks and order, and comes back the same", () => {
  const t = trees(), order = [...rep(11, 5), 12, 13, 12, 12, 14, 21];
  const code = P.encode(t, "Rogue", order);
  assert.match(code, /^BF1-ROG-[0-9a-z]{4}-(?:[0-9a-z]{2}[1-9])+-[0-9a-z]{4}$/);
  assert.ok(code.length < 50, code);
  assert.deepEqual(P.decode(t, "Rogue", code), { ok: true, error: null, order });
  assert.deepEqual(P.decode(t, "Rogue", `  ${code.toLowerCase().replace(/-/g, " -\n")} `).order, order, "spaces, line breaks and letter case do not matter");
  assert.equal(P.encode(t, "Rogue", order), code, "the same build gives the same code");
  assert.notEqual(P.encode(t, "Rogue", [...rep(11, 5), 12, 12, 13, 12, 14, 21]), code, "another order is another code");
  const long = [...rep(11, 5), ...rep(12, 3), 13, 14, 14, 15, ...rep(16, 5), ...rep(21, 5), ...rep(22, 5)];
  assert.deepEqual(P.decode(t, "Rogue", P.encode(t, "Rogue", long)).order, long);
  assert.throws(() => P.encode(t, "Rogue", []), /at least one point/);
  assert.throws(() => P.encode(t, "Rogue", [13]), /breaks the talent rules/);
  assert.throws(() => P.encode(t, "Monk", [11]), /not available/);
  assert.throws(() => P.encode({ tabs: [] }, "Rogue", [11]), /not available/);
});

test("importing a code is strict: wrong class, damage, other trees, illegal builds and garbage load nothing", () => {
  const t = trees(), code = P.encode(t, "Rogue", [...rep(11, 5), 13]);
  const refused = (r, pattern) => { assert.equal(r.ok, false); assert.equal(r.order, null); assert.match(r.error, pattern); };
  refused(P.decode(t, "Mage", code), /^This code is for a Rogue, not a Mage\.$/);
  for (const junk of ["", "hello", "BF1", "BF2-ROG-0000-001-0000", code.slice(0, -1), code + "0", code.replace("BF1", "BF9"), "BF1-ROG-00!0-001-0000", null, 42, {}, "x".repeat(500)]) refused(P.decode(t, "Rogue", junk), /not a Backstage Forever talent code/);
  // One changed character anywhere trips the check.
  for (let i = 4; i < code.length; i++) {
    if (code[i] === "-") continue;
    const other = code.slice(0, i) + (code[i] === "1" ? "2" : "1") + code.slice(i + 1);
    assert.equal(P.decode(t, "Rogue", other).ok, false, other);
  }
  refused(P.decode(t, "Rogue", code.slice(0, 13) + "9" + code.slice(14)), /damaged/);
  // A code with a valid check but made on other trees.
  const moved = trees(); moved.tabs[0].talents[2].row = 2;
  refused(P.decode(moved, "Rogue", code), /different talent trees/);
  refused(P.decode({ tabs: [] }, "Rogue", code), /not available/);
  // Forged codes with a correct check: an illegal order, a talent that does not exist, an unknown class, too many points.
  const head = code.split("-").slice(0, 3).join("-");
  refused(P.decode(t, "Rogue", sign(`${head}-021`)), /breaks the talent rules/);
  refused(P.decode(t, "Rogue", sign(`${head}-006`)), /breaks the talent rules/);
  refused(P.decode(t, "Rogue", sign(`${head}-zz1`)), /your trees do not have/);
  refused(P.decode(t, "Rogue", sign(`BF1-XXX-${head.split("-")[2]}-001`)), /not a Backstage Forever talent code/);
  refused(P.decode(t, "Rogue", sign(`${head}-${"009".repeat(6)}`)), /more than 51 points/);
  assert.deepEqual(P.decode(t, "Rogue", sign(`${head}-005021`)).order, [...rep(11, 5), 13], "the forger's check itself is right");
});

// --- Saved builds ------------------------------------------------------------------------------
const names = { 11: ["Precision", "Combat", 5], 12: ["Improved Gouge", "Combat", 3], 13: ["Riposte", "Combat", 1] };
const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-talent-builds-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const counter = () => { let n = 0; return () => "build" + String(++n).padStart(3, "0"); };

test("builds are saved per character, survive a restart, and one can be marked for the game", (t) => {
  const dir = tmp(t), store = new TalentBuilds(dir, { newId: counter() });
  assert.deepEqual(store.list("a"), { active: null, builds: [] });
  const id = store.save("a", { name: "  Combat\tswords  ", className: "Rogue", order: [11, 11, 12], names });
  assert.equal(id, "build001");
  assert.deepEqual(store.list("a").builds, [{ id, name: "Combat swords", className: "Rogue", order: [11, 11, 12], names: { 11: names[11], 12: names[12] } }]);
  assert.deepEqual(store.list("b").builds, [], "another character has its own list");
  assert.throws(() => store.save("a", { name: "combat SWORDS", className: "Rogue", order: [11], names }), /already have a build named/);
  assert.equal(store.save("a", { id, name: "Combat swords", className: "Rogue", order: [11, 11, 12, 12], names }), id, "saving under the same id updates it");
  assert.equal(store.list("a").builds.length, 1); assert.equal(store.list("a").builds[0].order.length, 4);
  const second = store.save("a", { name: "Daggers", className: "Rogue", order: [12], names });
  assert.equal(store.handoff("a", "Rogue"), null, "nothing goes to the game until a build is marked");
  store.activate("a", second);
  assert.deepEqual(store.handoff("a", "Rogue"), { name: "Daggers", picks: [{ name: "Improved Gouge", tab: "Combat", maxRank: 3 }] });
  assert.equal(store.handoff("a", "Mage"), null, "a build for another class is never handed to the game");
  assert.throws(() => store.activate("a", "nope000"), /no longer saved/); assert.throws(() => store.remove("a", "nope000"), /no longer saved/);
  const again = new TalentBuilds(dir);
  assert.deepEqual(again.list("a"), store.list("a")); assert.equal(again.list("a").active, second);
  again.remove("a", second);
  assert.equal(again.list("a").active, null); assert.equal(again.handoff("a", "Rogue"), null);
  again.activate("a", id); again.activate("a", null); assert.equal(again.list("a").active, null);
  again.clear();
  assert.deepEqual(new TalentBuilds(dir).list("a"), { active: null, builds: [] }); assert.equal(fs.existsSync(path.join(dir, "talent-builds.json")), false);
  // A list handed out is a copy.
  const s2 = new TalentBuilds(dir, { newId: counter() }); s2.save("a", { name: "X", className: "Rogue", order: [11], names });
  s2.list("a").builds[0].order.push(99); assert.deepEqual(s2.list("a").builds[0].order, [11]);
});

test("the store refuses what it cannot keep clean and drops a damaged file", (t) => {
  const dir = tmp(t), store = new TalentBuilds(dir, { newId: counter() });
  const ok = { name: "Fine", className: "Rogue", order: [11], names };
  assert.throws(() => store.save("", ok), /Choose a character/);
  assert.throws(() => store.save("a", { ...ok, name: " \n " }), /Give the build a name/);
  for (const bad of [{ className: "Monk" }, { order: [] }, { order: [1.5] }, { order: Array(52).fill(11) }, { names: {} }, { names: { 11: ["Precision", "Combat", 0] } }, { names: { 11: ["Bad\nname", "Combat", 5] } }, { order: "x" }]) assert.throws(() => store.save("a", { ...ok, ...bad }), /cannot be saved/);
  assert.equal(store.list("a").builds.length, 0);
  assert.equal(store.list("a").builds.length, 0);
  for (let i = 0; i < MAX_BUILDS; i++) store.save("a", { ...ok, name: "Build " + i });
  assert.throws(() => store.save("a", { ...ok, name: "One more" }), /holds up to 20 builds/);
  const firstId = store.list("a").builds[0].id;
  assert.equal(store.save("a", { ...ok, name: "x".repeat(80) + "é", id: firstId }), firstId);
  assert.equal(store.list("a").builds[0].name.length, 40);
  fs.writeFileSync(path.join(dir, "talent-builds.json"), "{ not json");
  assert.deepEqual(new TalentBuilds(dir).list("a").builds, []);
  fs.writeFileSync(path.join(dir, "talent-builds.json"), JSON.stringify({ schemaVersion: 1, profiles: { a: { active: "gone00", builds: [
    { id: "good01", name: "Good", className: "Rogue", order: [11], names }, { id: "good01", name: "Twin", className: "Rogue", order: [11], names },
    { id: "BAD", name: "Bad id", className: "Rogue", order: [11], names }, { id: "noname", name: "", className: "Rogue", order: [11], names },
    { id: "nonames", name: "No names", className: "Rogue", order: [14], names }, "text", null] }, b: "text", c: { builds: [] } } }));
  const cleaned = new TalentBuilds(dir).list("a");
  assert.deepEqual(cleaned.builds.map((b) => b.name), ["Good"]); assert.equal(cleaned.active, null);
  fs.writeFileSync(path.join(dir, "talent-builds.json"), JSON.stringify({ schemaVersion: 2, profiles: { a: { builds: [{ id: "good01", name: "Good", className: "Rogue", order: [11], names }] } } }));
  assert.deepEqual(new TalentBuilds(dir).list("a").builds, []);
});

// --- The screen's handler ----------------------------------------------------------------------
function screen(t, { profile = { id: "a", name: "Abel", realm: "Thunder Hold", className: "Rogue", level: 14, source: { kind: "wow-addon" } }, available = true } = {}) {
  const handlers = {}, changes = [];
  const builds = new TalentBuilds(tmp(t), { newId: counter() });
  registerTalentPlanner({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => ({ activeProfileId: profile?.id, profiles: profile ? [profile] : [] }),
    gameData: { talents: (c) => (available && c === "Rogue" ? trees() : null) }, builds, onChange: () => changes.push(1) });
  return { call: (input) => handlers.talentPlanner({ className: "Rogue", ...input }), builds, changes };
}

test("the handler places and takes back points and reports why a click was refused", (t) => {
  const { call } = screen(t);
  let r = call({ op: "open" });
  assert.equal(r.ok, true); assert.deepEqual(r.order, []); assert.equal(r.view.total, 0); assert.deepEqual(r.respec, P.RESPEC_SCHEDULE);
  assert.deepEqual(r.saved, { canSave: true, inGame: true, active: null, builds: [] });
  r = call({ op: "add", order: [], talentId: 11, level: 14 });
  assert.deepEqual(r.order, [11]); assert.equal(r.view.talents[11].rank, 1); assert.equal(r.view.level, 14);
  r = call({ op: "add", order: [11], talentId: 13 });
  assert.equal(r.ok, false); assert.equal(r.reason, "Spend 5 points in Combat first (1 so far)."); assert.deepEqual(r.order, [11]);
  r = call({ op: "add", order: [11, 11], talentId: 11, planLevel: 11 });
  assert.equal(r.ok, false); assert.match(r.reason, /level 11 gives 2/);
  assert.deepEqual(call({ op: "remove", order: [11, 12], talentId: 11 }).order, [12]);
  assert.equal(call({ op: "remove", order: [...rep(11, 5), 13], talentId: 11 }).ok, false);
  assert.deepEqual(call({ op: "resetTree", order: [11, 21, 11], tab: "Combat" }).order, [21]);
  assert.deepEqual(call({ op: "resetAll", order: [11, 21, 11] }).order, []);
  r = call({ op: "open", order: [11, 13, 11] });
  assert.equal(r.ok, false); assert.deepEqual(r.order, [11]); assert.match(r.reason, /no longer fits your talent trees/);
  for (const bad of [{ op: "nope" }, { op: "add", order: [11], talentId: "11" }, { op: "add", order: "x", talentId: 11 }, { op: "add", order: [-1], talentId: 11 }, { op: "add", order: Array(52).fill(11), talentId: 11 },
    { op: "resetTree", order: [], tab: "Nothing" }, { op: "open", className: "Monk" }, { op: "open", className: "constructor" }, { op: "compare", order: [11], other: [13] }, { op: "compare", order: [11] }]) assert.throws(() => call(bad));
  assert.throws(() => call({ op: "open", className: "Mage" }), /not available from your game install/);
  assert.throws(() => handlersOf(t).talentPlanner(null), /Invalid talent planner request/);
});
function handlersOf(t) { const h = {}; registerTalentPlanner({ handle: (n, fn) => { h[n] = fn; }, getState: () => ({}), gameData: { talents: () => null }, builds: new TalentBuilds(tmp(t)) }); return h; }

test("the handler saves, marks, compares, shares and deletes builds", (t) => {
  const { call, builds, changes } = screen(t);
  const order = [...rep(11, 5), 12, 13];
  assert.throws(() => call({ op: "save", order: [], name: "Empty" }), /at least one point/);
  assert.throws(() => call({ op: "save", order: [13], name: "Broken" }), /breaks the talent rules/);
  assert.throws(() => call({ op: "save", order, name: "" }), /Give the build a name/);
  assert.equal(changes.length, 0);
  let r = call({ op: "save", order, name: "Combat swords" });
  assert.equal(r.savedId, "build001"); assert.equal(changes.length, 1);
  assert.deepEqual(r.saved.builds, [{ id: "build001", name: "Combat swords", order, points: 7, split: [7, 0] }]);
  assert.deepEqual(builds.list("a").builds[0].names[12], ["Improved Gouge", "Combat", 3], "talent names are kept for the game hand-off");
  r = call({ op: "save", order: [21, 21], name: "Sneaky" });
  assert.deepEqual(r.saved.builds.map((b) => b.split), [[7, 0], [0, 2]]);
  r = call({ op: "activate", order, id: "build001" });
  assert.equal(r.saved.active, "build001"); assert.equal(builds.handoff("a", "Rogue").picks.length, 7); assert.equal(changes.length, 3);
  assert.equal(call({ op: "activate", order, id: null }).saved.active, null);
  assert.throws(() => call({ op: "activate", order, id: "gone000" }), /no longer saved/);
  r = call({ op: "compare", order, other: [21, 21] });
  assert.equal(r.diff.same, false); assert.deepEqual(r.diff.tabs, [{ name: "Combat", a: 7, b: 0 }, { name: "Subtlety", a: 0, b: 2 }]);
  const code = call({ op: "export", order }).code;
  assert.deepEqual(call({ op: "import", order: [21], code }).order, order);
  r = call({ op: "import", order: [21], code: code.slice(0, -1) + (code.endsWith("0") ? "1" : "0") });
  assert.equal(r.ok, false); assert.deepEqual(r.order, [21], "a refused code leaves the plan as it was"); assert.match(r.reason, /damaged/);
  assert.equal(call({ op: "import", order: [], code: "garbage" }).ok, false);
  assert.throws(() => call({ op: "export", order: [] }), /at least one point/);
  r = call({ op: "save", order: [21], name: "Sneaky", id: "build002", activate: true });
  assert.equal(r.saved.active, "build002"); assert.deepEqual(r.saved.builds[1].order, [21]);
  r = call({ op: "delete", order, id: "build002" });
  assert.equal(r.saved.builds.length, 1); assert.equal(r.saved.active, null);
  assert.throws(() => call({ op: "delete", order, id: "build002" }), /no longer saved/);
});

test("without a character nothing is saved, and a manual character is never sent to the game", (t) => {
  const none = screen(t, { profile: null });
  assert.deepEqual(none.call({ op: "open" }).saved, { canSave: false, inGame: false, active: null, builds: [] });
  assert.throws(() => none.call({ op: "save", order: [11], name: "X" }), /Choose a character first/);
  assert.throws(() => none.call({ op: "activate", order: [11], id: null }), /Choose a character first/);
  const manual = screen(t, { profile: { id: "m", name: "Manual", className: "Rogue", level: 20, source: { kind: "manual" } } });
  assert.equal(manual.call({ op: "open" }).saved.inGame, false);
});

test("main wires the planner, the hand-off and the wipe", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8"), preload = fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8");
  assert.match(main, /registerTalentPlanner\(\{ handle, getState: \(\) => store\.state, gameData, builds: talentBuilds, onChange: \(\) => \{ game\?\.writeHandoff\(\)/);
  assert.match(main, /talents: \(id\) => talentBuilds\?\.handoff\(id, profiles\.find\(\(p\) => p\.id === id\)\?\.className\) \|\| null/);
  assert.match(main, /talentBuilds\?\.clear\(\);/);
  assert.match(preload, /talentPlanner: \(input\) => invoke\("talentPlanner", input\)/);
  const page = fs.readFileSync(path.join(__dirname, "../src/renderer/talents.js"), "utf8");
  assert.match(page, /Reference: the classic schedule/); assert.match(page, /Not checked on WoW Forever/);
  assert.match(page, /The app never spends points for you/);
});
