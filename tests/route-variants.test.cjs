"use strict";
// Route variants (roadmap Q8) and the route editor with its share code (Q9).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const G = require("../src/core/guided-route.cjs");
const V = require("../src/core/route-variants.cjs");
const E = require("../src/core/route-editor.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const { recover } = require("../src/core/desktop-route-recovery.cjs");
const root = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(root, f), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 60000, maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

// A small world: one Horde start zone with a hub of three givers, an elite quest, a dungeon quest
// and a quest two levels up; then a second zone. One dungeon (levels 8-12) stands in the start zone.
const npc = (id, name, mapId, x, y) => ({ id, name, positions: [{ mapId, x, y }] });
const q = (id, title, level, giver, turnIn, extra = {}) => ({ id, title, level, minLevel: 1, raceMask: "ffffffffffffffff", sides: ["Horde"], givers: [{ kind: "npc", id: giver }], turnIns: [{ kind: "npc", id: turnIn }], objectives: [], ...extra });
const pack = {
  npcs: { "npc:1": npc(1, "Elder", 1411, 0.5, 0.5), "npc:2": npc(2, "Scout", 1411, 0.51, 0.5), "npc:3": npc(3, "Cook", 1411, 0.5, 0.52), "npc:4": npc(4, "Warden", 1413, 0.5, 0.5), "npc:5": npc(5, "Far Hermit", 1411, 0.9, 0.9) },
  creatures: { 900: { name: "Big Brute" }, 901: { name: "Cave Lord" }, 902: { name: "Boar" } },
  quests: {
    10: q(10, "First Steps", 1, 1, 1, { objectiveLocations: [{ positions: [{ mapId: 1411, x: 0.7, y: 0.7 }] }] }),
    11: q(11, "Boars", 2, 2, 1, { objectives: [{ type: "monster", objectId: 902 }], objectiveLocations: [{ positions: [{ mapId: 1411, x: 0.3, y: 0.3 }] }] }),
    12: q(12, "Spices", 3, 3, 1),
    13: q(13, "The Brute", 4, 1, 1, { objectives: [{ type: "monster", objectId: 900 }], objectiveLocations: [{ positions: [{ mapId: 1411, x: 0.2, y: 0.8 }] }] }),
    14: q(14, "Into the Deep Den", 9, 5, 5, { objectives: [{ type: "monster", objectId: 901 }] }),
    15: q(15, "Hard Lesson", 6, 5, 5),
    16: q(16, "Deep Den Supplies", 10, 2, 2, { objectiveEvidence: "Bring supplies out of the Deep Den." }),
    17: q(17, "Seven", 7, 1, 1), 18: q(18, "Eight", 8, 2, 2), 19: q(19, "Nine", 9, 3, 3),
    ...Object.fromEntries([20, 21, 22].map((id, i) => [id, q(id, `Barrens ${i}`, 10 + i, 4, 4)])),
  },
};
const zones = [{ mapId: 1411, min: 1, max: 10, faction: "Horde", starter: ["Orc"] }, { mapId: 1413, min: 10, max: 25, faction: "Horde" }];
const creatures = [{ id: 900, name: "Big Brute", elite: true }, { id: 901, name: "Cave Lord", elite: true }, { id: 902, name: "Boar" }];
const baseline = [["den", "Deep Den", "dungeon", 8, 12, null, "Durotar", 1411, [40, 60], 999, ["Cave Lord"]], ["raid", "Big Raid", "raid", 60, 60, null, "X", 1411, [1, 1], 998, ["Boss"]]];
const dungeons = V.dungeonList(baseline), flags = V.questFlags(pack, creatures, dungeons);
const build = (variant) => G.buildGuidedRoutes({ pack, zones, tune: V.tuneFor(variant, { flags, dungeons }) }).routes.find((r) => r.key === "Orc");
const ids = (route) => new Set(route.steps.flatMap((s) => s.ids));

test("flags come only from the data: elite targets from the creature pack, dungeon quests from boss and dungeon names", () => {
  assert.deepEqual(dungeons.map((d) => d.key), ["den"], "raids are not dungeon visits");
  assert.deepEqual([dungeons[0].x, dungeons[0].y, dungeons[0].mapId], [0.4, 0.6, 1411]);
  assert.deepEqual([...flags.entries()].sort((a, b) => a[0] - b[0]), [[13, { elite: true }], [14, { elite: true, dungeon: "den" }], [16, { dungeon: "den" }]]);
  assert.equal(V.questFlags({ quests: { 1: q(1, "Deep Den Errand", 1, 1, 1) } }, [], dungeons).size, 0, "a level-1 errand that names the dungeon is not a dungeon quest");
  assert.equal(V.tuneFor("solo"), null, "solo leaves the engine untouched");
  assert.equal(V.variantId("nonsense"), "solo");
  assert.deepEqual(V.VARIANTS.map((v) => v.id), V.VARIANT_IDS);
  for (const v of V.VARIANTS) assert.ok(v.changes.length > 20 && v.cannot.length > 20 && v.changes.length < 240 && v.cannot.length < 240, v.id);
});

test("solo is today's route byte for byte, and every variant is deterministic", () => {
  const plain = G.buildGuidedRoutes({ pack, zones }).routes, solo = G.buildGuidedRoutes({ pack, zones, tune: V.tuneFor("solo", { flags, dungeons }) }).routes;
  assert.equal(JSON.stringify(solo), JSON.stringify(plain));
  for (const v of V.VARIANT_IDS) assert.equal(JSON.stringify(build(v)), JSON.stringify(build(v)), v);
  // The shipped addon data is still the solo route.
  const out = spawnSync(process.execPath, [path.join(root, "scripts/build-guided-route.cjs"), "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
});

test("careful leaves out elite and dungeon quests and takes nothing more than one level above", () => {
  const solo = build("solo"), careful = build("careful");
  assert.ok(ids(solo).has(13) && ids(solo).has(14), "solo keeps them: it cannot know you are alone");
  for (const id of [13, 14, 16]) assert.ok(!ids(careful).has(id), `quest ${id} is left out`);
  assert.ok(ids(careful).has(10) && ids(careful).has(12));
  // The first round, before anything is handed in: solo reaches two levels up, careful only one.
  const firstRound = (route) => { const end = route.steps.findIndex((s) => s.kind === "turnin"); return route.steps.slice(0, end).filter((s) => s.kind === "pickup").flatMap((s) => s.ids).sort(); };
  assert.deepEqual(firstRound(solo), [10, 11, 12]); assert.deepEqual(firstRound(careful), [10, 11]);
  assert.equal(V.tuneFor("careful").above, V.CAREFUL_ABOVE); assert.ok(V.tuneFor("careful").below > 4, "and it reaches further down for easier quests");
  const numbers = V.summary(careful, flags);
  assert.equal(numbers.eliteQuests, 0); assert.equal(numbers.dungeonQuests, 0);
  assert.equal(V.summary(solo, flags).eliteQuests, 2);
});

test("duo reaches one level higher and does flagged objectives first", () => {
  const tune = V.tuneFor("duo", { flags, dungeons });
  assert.equal(tune.above, 3);
  const duo = build("duo"), first = duo.steps.filter((s) => s.kind === "pickup")[0];
  assert.ok(first.ids.includes(13), "the quest three levels up is in the first round for a pair");
  assert.ok(!build("solo").steps.filter((s) => s.kind === "pickup")[0].ids.includes(13), "and not for one player");
  const objectives = duo.steps.filter((s) => s.kind === "objective").map((s) => s.ids[0]);
  assert.ok(objectives.indexOf(13) < objectives.indexOf(11), "the elite quest's objective is walked before the plain one of the same round");
});

test("fewest trips: givers in one hub are one stop, hand-ins to one person are one step, fewer steps in all", () => {
  const solo = build("solo"), trips = build("trips");
  assert.ok(trips.steps.length < solo.steps.length);
  assert.deepEqual([...ids(trips)].sort(), [...ids(solo)].sort(), "the same quests, in fewer stops");
  const hub = trips.steps.find((s) => s.kind === "pickup" && /in one stop around/.test(s.text));
  assert.ok(hub && hub.ids.length >= 3, "three givers within the hub radius merge");
  const many = trips.steps.find((s) => s.kind === "turnin" && s.ids.length > 1);
  assert.match(many.text, /^Hand in \d+ quests to Elder: /);
  assert.ok(V.summary(trips, flags).stops < V.summary(solo, flags).stops);
});

test("dungeon-heavy: the visit comes two levels into the band, its quests are picked up right before and handed in after", () => {
  const route = build("dungeons"), at = route.steps.findIndex((s) => s.kind === "dungeon");
  assert.ok(at > 0);
  const visit = route.steps[at];
  assert.equal(visit.id, "dungeon:den"); assert.equal(visit.level, 10); assert.deepEqual([visit.mapId, visit.x, visit.y], [1411, 0.4, 0.6]);
  assert.match(visit.text, /^Dungeon visit: Deep Den \(levels 8–12\)\. Bring a full group\. You carry 2 quests for it\.$/);
  const picks = route.steps.slice(0, at).filter((s) => s.kind === "pickup" && /^For Deep Den: /.test(s.text)).map((s) => s.ids[0]).sort();
  assert.deepEqual(picks, [14, 16]);
  assert.ok(route.steps.slice(0, at).every((s) => /^For Deep Den/.test(s.text) || !s.ids.some((id) => id === 14 || id === 16)), "held back until the visit");
  assert.deepEqual(route.steps.slice(at + 1, at + 3).map((s) => [s.kind, s.ids[0]]), [["turnin", 14], ["turnin", 16]]);
  assert.equal(V.summary(route, flags).dungeonVisits, 1);
  // Position and recovery treat a visit as a step with no quest behind it.
  assert.equal(G.stepDone(visit, { completed: new Set(), inLog: new Set(), complete: new Set(), level: 10 }), false);
  assert.equal(G.stepDone(visit, { completed: new Set(), inLog: new Set(), complete: new Set(), level: 15 }), true);
});

test("the real data: every variant builds for all eight races, and careful holds no flagged quest", () => {
  const real = JSON.parse(read("data/forever/pack.json")), z = JSON.parse(read("data/forever-leveling/pack.json")).zones;
  const D = V.dungeonList(require("../src/core/dungeon-atlas.cjs").BASELINE), F = V.questFlags(real, JSON.parse(read("data/forever-creatures/pack.json")).creatures, D);
  assert.ok(F.size > 50);
  for (const v of V.VARIANT_IDS) {
    const { routes } = G.buildGuidedRoutes({ pack: real, zones: z, tune: V.tuneFor(v, { flags: F, dungeons: D }) });
    assert.equal(routes.length, 8, v);
    for (const r of routes) {
      assert.ok(r.steps.length > 100, `${v} ${r.key}`);
      assert.equal(new Set(r.steps.map((s) => s.id)).size, r.steps.length, `${v} ${r.key}: step ids are unique`);
      const n = V.summary(r, F);
      if (v === "careful") assert.equal(n.eliteQuests + n.dungeonQuests, 0, r.key);
      if (v === "dungeons") assert.ok(n.dungeonVisits >= 8, r.key);
    }
    // Both sides get the same treatment: every variant exists for Horde and Alliance races alike.
    assert.deepEqual([...new Set(routes.map((r) => r.faction))].sort(), ["Alliance", "Horde"]);
  }
});

// ---- Q9: the editor ----
const base = () => build("solo");
const act = (o, action, route = base()) => E.edit(o, action, route);

test("edits are an overlay: skip, note, move, own steps; a rebuilt route keeps what still fits", () => {
  const route = base(), first = route.steps[0].id, second = route.steps[1].id, third = route.steps[2].id;
  let o = E.empty();
  o = act(o, { type: "note", id: second, text: "  Sell   junk first  " });
  o = act(o, { type: "skip", id: third });
  o = act(o, { type: "add", text: "Train First Aid", after: first, mapId: 1411, x: 0.123456, y: 0.5 });
  o = act(o, { type: "add", text: "Buy arrows", after: null });
  o = act(o, { type: "down", id: first });
  const shown = E.applyOverlay(route, o, { keepSkipped: true }), live = E.applyOverlay(route, o);
  assert.deepEqual(shown.steps.slice(0, 4).map((s) => s.id), ["custom:2", "custom:1", first, second], "own steps sit where they were put, and the moved step follows");
  assert.equal(shown.steps.find((s) => s.id === second).note, "Sell junk first");
  assert.deepEqual(shown.steps.find((s) => s.id === "custom:1"), { id: "custom:1", kind: "custom", ids: [], text: "Train First Aid", mapId: 1411, x: 0.1235, y: 0.5, level: route.steps[0].level, custom: true });
  assert.equal(shown.steps.find((s) => s.id === "custom:2").mapId, null);
  assert.ok(shown.steps.find((s) => s.id === third).skipped && !live.steps.some((s) => s.id === third));
  assert.deepEqual(shown.edits, { notes: 1, skipped: 1, moved: 1, custom: 2, lost: 0 });
  assert.equal(route.steps[0].id, first, "the generated route is never changed");
  // The same overlay on another variant: what fits stays, the rest waits and is counted.
  const other = build("careful"), again = E.applyOverlay(other, o);
  assert.ok(again.edits.lost >= 0 && again.edits.notes + again.edits.skipped + again.edits.custom + again.edits.lost >= 4);
  const gone = E.applyOverlay({ ...route, steps: route.steps.filter((s) => ![first, second, third].includes(s.id)) }, o);
  assert.deepEqual(gone.edits, { notes: 0, skipped: 0, moved: 0, custom: 1, lost: 4 }, "only the step at the start still has its place");
  assert.equal(JSON.stringify(E.cleanOverlay(o)), JSON.stringify(o), "what is stored is already clean");
  // Removing an own step moves what hung on it; reset keeps the route choice.
  let r = act(o, { type: "note", id: "custom:1", text: "bandages" });
  r = act(r, { type: "remove", id: "custom:1" });
  assert.ok(!r.custom.some((c) => c.id === "custom:1") && !r.notes["custom:1"]);
  assert.deepEqual(act(act(o, { type: "variant", variant: "careful" }), { type: "reset" }), { ...E.empty(), variant: "careful" });
});

test("up, down and drag follow the order the player sees; bad edits are refused in plain words", () => {
  const route = base(), a = route.steps[0].id, b = route.steps[1].id, c = route.steps[2].id;
  const order = (o) => E.applyOverlay(route, o, { keepSkipped: true }).steps.slice(0, 3).map((s) => s.id);
  assert.deepEqual(order(act(E.empty(), { type: "down", id: a })), [b, a, c]);
  assert.deepEqual(order(act(E.empty(), { type: "up", id: c })), [a, c, b]);
  assert.deepEqual(order(act(E.empty(), { type: "move", id: c, after: null })), [c, a, b]);
  assert.deepEqual(order(act(E.empty(), { type: "move", id: a, after: c })), [b, c, a]);
  assert.deepEqual(act(E.empty(), { type: "up", id: a }), E.empty(), "the first step cannot go higher");
  let o = E.empty();
  for (let i = 0; i < 5; i++) o = act(o, { type: "down", id: a });
  assert.equal(o.moves.length, 1, "moving one step again and again is one move");
  assert.throws(() => act(E.empty(), { type: "skip", id: "pickup:999999" }), /Unknown step/);
  assert.throws(() => act(E.empty(), { type: "note", id: a, text: "x".repeat(E.LIMITS.note + 1) }), /1 to 200 characters/);
  assert.throws(() => act(E.empty(), { type: "note", id: a, text: "two\nlines" }), /plain text on one line/);
  assert.throws(() => act(E.empty(), { type: "add", text: "", after: null }), /Write the step/);
  assert.throws(() => act(E.empty(), { type: "add", text: "ok", after: null, mapId: 1411, x: 2, y: 0.5 }), /map point/);
  assert.throws(() => act(E.empty(), { type: "remove", id: a }), /Only your own steps/);
  assert.throws(() => act(E.empty(), { type: "variant", variant: "fast" }), /Unknown route choice/);
  assert.throws(() => act(E.empty(), { type: "explode" }), /Unknown/);
  // A stored overlay with junk in it is cleaned, entry by entry.
  const dirty = E.cleanOverlay({ variant: "x", skip: [a, a, "<script>", 5], notes: { [a]: "ok", [b]: "bad\u0007", "evil:1": "x" }, moves: [[a, a], [a, b], "x"], custom: [{ id: "custom:1", text: "ok", after: null }, { id: "custom:1", text: "twice", after: null }, { id: "pickup:1", text: "no", after: null }] });
  assert.deepEqual(dirty, { v: 1, variant: "solo", skip: [a], notes: { [a]: "ok" }, moves: [[a, b]], custom: [{ id: "custom:1", text: "ok", after: null }] });
});

const knows = { quest: (id) => Boolean(pack.quests[id]), map: (id) => id === 1411 || id === 1413, dungeon: (k) => k === "den" };
test("the share code round-trips and is refused whole for anything it should not hold", () => {
  const route = base(), a = route.steps[0].id, b = route.steps[1].id;
  let o = act(E.empty(), { type: "note", id: a, text: "<b>bold</b> & “quotes” | pipes" });
  o = act(o, { type: "skip", id: b });
  o = act(o, { type: "add", text: "Bank run", after: a, mapId: 1411, x: 0.25, y: 0.75 });
  o = act(o, { type: "down", id: a });
  o = act(o, { type: "variant", variant: "trips" });
  const code = E.exportCode(o, "Orc");
  assert.match(code, /^BFROUTE1\.[A-Za-z0-9_-]+\.[0-9a-f]{10}$/);
  assert.equal(E.exportCode(o, "Orc"), code, "the same edits give the same code");
  assert.deepEqual(E.importCode(`  ${code}\n`, knows), { race: "Orc", overlay: o });
  assert.throws(() => E.exportCode(E.empty(), "Orc"), /no edits to share/);
  assert.throws(() => E.exportCode(o, "Pandaren"), /no route to share/);
  // Hand-made codes: right check digits, wrong content.
  const crypto = require("node:crypto");
  const make = (data) => { const body = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8").toString("base64url"); return `BFROUTE1.${body}.${crypto.createHash("sha256").update(`BFROUTE1:${body}`).digest("hex").slice(0, 10)}`; };
  const good = { v: 1, r: "Orc", t: "solo", s: [a], n: [[a, "note"]], m: [], c: [] };
  assert.ok(E.importCode(make(good), knows), "the hand-made base case is accepted");
  const bad = {
    "another version": { ...good, v: 2 }, "an extra key": { ...good, x: 1 }, "a missing key": (() => { const g = { ...good }; delete g.c; return g; })(),
    "an unknown race": { ...good, r: "Pandaren" }, "an unknown route choice": { ...good, t: "speedrun" },
    "an unknown quest": { ...good, s: ["pickup:424242"] }, "a step id that is not one": { ...good, s: ["<img src=x>"] }, "an unknown zone": { ...good, s: ["travel:9999"] }, "an unknown dungeon": { ...good, s: ["dungeon:nope"] },
    "a long note": { ...good, n: [[a, "x".repeat(E.LIMITS.note + 1)]] }, "a note with a line break": { ...good, n: [[a, "a\nb"]] }, "a note with a control character": { ...good, n: [[a, "a\u0000b"]] },
    "a note that is not text": { ...good, n: [[a, { html: "<b>" }]] }, "an untrimmed note": { ...good, n: [[a, " padded "]] }, "a note on an own step that is not there": { ...good, n: [["custom:3", "x"]] },
    "too many skips": { ...good, s: Array.from({ length: E.LIMITS.skip + 1 }, () => a) }, "a repeated skip": { ...good, s: [a, a] },
    "a move onto itself": { ...good, m: [[a, a]] }, "an own step with a bad point": { ...good, c: [["custom:1", "x", null, 1411, 2, 0.5]] }, "an own step in an unknown zone": { ...good, c: [["custom:1", "x", null, 77, 0.5, 0.5]] },
    "an own step with a wrong id": { ...good, c: [["pickup:10", "x", null, 0, 0, 0]] }, "a list instead of an object": [1, 2, 3], "not JSON": "{oops",
  };
  for (const [what, data] of Object.entries(bad)) assert.equal(E.importCode(make(data), knows), null, what);
  assert.equal(E.importCode(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0"), knows), null, "wrong check digits");
  assert.equal(E.importCode(code.replace("BFROUTE1", "BFROUTE2"), knows), null);
  assert.equal(E.importCode(`BFROUTE1.${"A".repeat(E.LIMITS.code)}.0000000000`, knows), null, "too large");
  for (const junk of [null, 5, "", "hello", {}, "BFRACE1.abc.def"]) assert.equal(E.importCode(junk, knows), null);
  assert.equal(E.importCode(code, { ...knows, quest: () => false }), null, "a code for quests this app does not know is refused");
});

test("the next steps travel in the hand-off: bounded, plain text, | codes taken out, schema still 1", () => {
  const route = base(), a = route.steps[0].id;
  let o = act(E.empty(), { type: "note", id: a, text: "Bring |cffff0000red|r bags |Hitem:1|h[x]|h" });
  o = act(o, { type: "add", text: "Own step | no point", after: a });
  const edited = E.applyOverlay(route, o), steps = E.handoffSteps(edited, 0);
  assert.equal(steps.length, Math.min(E.LIMITS.handoffSteps, edited.steps.length));
  assert.equal(steps[0].note, "Bring /cffff0000red/r bags /Hitem:1/h[x]/h");
  assert.deepEqual([steps[1].kind, steps[1].text, steps[1].mapId, steps[1].x], ["x", "Own step / no point", 0, null]);
  assert.ok(steps.every((s) => !/[|\x00-\x1f]/.test(s.text + s.note)));
  assert.deepEqual(E.handoffSteps(edited, edited.steps.length), []);
  assert.equal(E.handoffSteps({ steps: [{ ...edited.steps[0], note: "n".repeat(500) }] })[0].note.length, E.LIMITS.handoffNote);
  const saved = (id, name) => ({ id, name, realm: "Thunder Hold", source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });
  const text = handoff.compile({ profiles: [saved("a", "Abel"), saved("b", "Zed")], routes: (id) => (id === "a" ? { variant: "careful", steps } : null) });
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n/);
  assert.match(text, /\["Abel-Thunder Hold"\]=\{wish=\{\},rt=\{v="careful",s=\{\{"[pco]",/);
  assert.doesNotMatch(text, /Zed/, "a character with nothing to hand over is not named");
  assert.doesNotMatch(text, /\|/);
  assert.equal(text, handoff.compile({ profiles: [saved("b", "Zed"), saved("a", "Abel")], routes: (id) => (id === "a" ? { variant: "careful", steps } : null) }), "deterministic");
  // Anything that is not a clean list is left out whole; so is a route too long, and the first thing dropped when space is short.
  for (const broken of [{ variant: "fast", steps }, { variant: "solo", steps: [...steps, ...steps].slice(0, handoff.MAX_ROUTE_STEPS + 1) }, { variant: "solo", steps: [{ ...steps[0], text: "a|b" }] }, { variant: "solo", steps: [{ ...steps[0], x: 2 }] }, { variant: "solo", steps: [{ ...steps[0], kind: "z" }] }, { variant: "solo", steps: [] }])
    assert.equal(handoff.compile({ profiles: [saved("a", "Abel")], routes: () => broken }), handoff.EMPTY);
  const crowd = Array.from({ length: 100 }, (_, i) => saved("p" + i, "N".repeat(50) + i));
  const big = handoff.compile({ profiles: crowd, wishlist: () => Array.from({ length: 200 }, (_, i) => 2000000000 + i), routes: () => ({ variant: "trips", steps: steps.map((s) => ({ ...s, text: "t".repeat(200), note: "n".repeat(120) })) }) });
  assert.ok(Buffer.byteLength(big) <= handoff.MAX_BYTES);
  assert.ok(/rt=\{/.test(big) && big.split("\n").filter((l) => l.startsWith("[")).some((l) => !/rt=\{/.test(l)), "route steps ride while there is room and are left out after");
  // The game reads it back: its own character only, validated, notes as plain text.
  const out = lua(String.raw`
DEFAULT_CHAT_FRAME={AddMessage=function() end}
dofile('addon/BackstageForever/BackstageForeverRoute.lua')
${text.split("\n").filter((l) => !l.startsWith("--")).join("\n")}
local r=BackstageForeverDesktopRouteRead(BackstageForeverDesktopData,'Abel','Thunder Hold')
assert(r and r.variant=='careful' and #r.s==${steps.length})
assert(r.s[1][9]=='Bring /cffff0000red/r bags /Hitem:1/h[x]/h', r.s[1][9])
assert(r.s[2][1]=='x' and r.s[2][3]==nil and r.s[2][4]==nil and r.s[2][2]=='Own step / no point')
assert(BackstageForeverDesktopRouteRead(BackstageForeverDesktopData,'Zed','Thunder Hold')==nil)
assert(BackstageForeverDesktopRouteRead(BackstageForeverDesktopData,nil,'Thunder Hold')==nil)
-- '|' never reaches a font string, even from a hand-edited file.
local row=BackstageForeverDesktopData.characters['Abel-Thunder Hold']
row.rt.s[1][9]='|cffff0000x|r'
assert(BackstageForeverDesktopRouteRead(BackstageForeverDesktopData,'Abel','Thunder Hold').s[1][9]=='/cffff0000x/r')
-- The guide's own position logic walks the sent steps: an own step stays until skipped.
dofile('addon/BackstageForever/BackstageForeverGuideData.lua')
local pos=BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=1,mapId=1411},{})
assert(pos.index==1 and not pos.ended)
local skipped={} for _,s in ipairs(r.s) do if s[1]~='x' then skipped[s[8]]=true end end
pos=BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=1,mapId=1411},skipped)
assert(pos.index==2 and pos.steps[1][1]=='x','the own step is the one left')
skipped[r.s[2][8]]=true
assert(BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=1,mapId=1411},skipped).ended)
-- Damaged shapes are refused whole.
local function bad(change) local copy={v='careful',s={}} for i,s in ipairs(row.rt.s) do local c={} for k=1,9 do c[k]=s[k] end copy.s[i]=c end change(copy)
  return BackstageForeverDesktopRouteRead({schema=1,characters={['A-B']={rt=copy}}},'A','B')==nil end
assert(bad(function(c) c.v='fast' end)) assert(bad(function(c) c.s[1][1]='q' end)) assert(bad(function(c) c.s[1][2]='' end))
assert(bad(function(c) c.s[1][4]=2 end)) assert(bad(function(c) c.s[1][6]=0 end)) assert(bad(function(c) c.s[1][7]={'x'} end))
assert(bad(function(c) c.s[1][9]=5 end)) assert(bad(function(c) c.s[1][2]='a\nb' end)) assert(bad(function(c) for i=1,13 do c.s[i]=c.s[1] end end))
assert(not bad(function() end))
assert(BackstageForeverDesktopRouteRead({schema=2,characters={['A-B']={rt=row.rt}}},'A','B')==nil)
print('ok')`);
  assert.equal(out, "ok");
});

test("the desktop shows an own step and a dungeon visit as written, and a several-quest hand-in by the quest you hold", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const profile = { id: "p", name: "Abel", race: "Orc", faction: "Horde", level: 1, clientBuild: "1.60.1.70888", locale: "enUS", quests: [], history: { completedIdsKnown: true, completedIds: [] }, location: { mapId: 1411 },
    source: { kind: "wow-addon", id: "s", updatedAt: "2026-11-22T11:00:00.000Z" } };
  const refPack = { ...pack, build: "1.60.1.70888" };
  let o = act(E.empty(), { type: "add", text: "Buy a bag", after: null });
  let got = recover({ route: E.applyOverlay(base(), o), profile, pack: refPack, now });
  assert.equal(got.reason, null); assert.equal(got.step.kind, "custom"); assert.equal(got.map, null); assert.equal(got.free, true);
  o = act(E.empty(), { type: "add", text: "Meet at the gate", after: null, mapId: 1411, x: 0.4, y: 0.6 });
  o = act(o, { type: "note", id: "custom:1", text: "<i>bring water</i>" });
  got = recover({ route: E.applyOverlay(base(), o), profile, pack: refPack, now });
  assert.deepEqual(got.map, { profileId: "p", mapId: 1411, x: 0.4, y: 0.6 }); assert.equal(got.step.note, "<i>bring water</i>");
  got = recover({ route: E.applyOverlay(base(), o), profile, pack: refPack, now, skips: ["custom:1"] });
  assert.notEqual(got.step.kind, "custom", "a desktop skip moves past an own step");
  const trips = build("trips"), many = trips.steps.find((s) => s.kind === "turnin" && s.ids.length > 1), held = many.ids[1];
  const before = trips.steps.slice(0, trips.steps.indexOf(many)).map((s) => s.id);
  got = recover({ route: trips, profile: { ...profile, level: 3, quests: [{ id: held, title: pack.quests[held].title, complete: true }] }, pack: refPack, now, skips: before });
  assert.equal(got.reason, null); assert.equal(got.quest.id, held);
  // The renderer writes notes and step text as escaped text only.
  const view = read("src/renderer/route-editor.js"), page = read("src/renderer/guided-route.js");
  assert.match(view, /<span data-no-translate>\$\{esc\(s\.note\)\}<\/span>/); assert.match(view, /<strong data-no-translate>\$\{esc\(s\.text\)\}<\/strong>/);
  assert.match(page, /\$\{esc\(step\.note\)\}/);
  assert.doesNotMatch(view.replace(/slot\.innerHTML = html\(\);/, ""), /innerHTML/, "one place sets HTML, from the escaping template");
});

test("route edits are kept per character in one bounded file", () => {
  const written = [];
  const store = new E.RouteEdits({ file: "Z:/none/route-edits.json", write: (f, t) => written.push([f, t]) });
  assert.deepEqual(store.get("a"), E.empty());
  const o = act(E.empty(), { type: "skip", id: base().steps[0].id });
  assert.deepEqual(store.set("a", o), o);
  assert.deepEqual(JSON.parse(written[0][1]), { version: 1, characters: { a: o } });
  assert.throws(() => store.set("__proto__", o), /Unknown character/);
  store.set("b", o);
  assert.equal(store.absorb({ profiles: [{ id: "b" }] }), true);
  assert.deepEqual(store.get("a"), E.empty(), "a deleted character takes its edits along");
  assert.deepEqual(store.get("b"), o);
});

test("the handlers: a view per character, edits private, the code copied or saved only on request, the hand-off only when the route differs", async () => {
  const { registerRouteEditor } = require("../src/core/route-editor-ipc.cjs");
  const handlers = {}, privates = new Set(), log = { copied: [], written: [], changed: 0 };
  const profile = { id: "p", name: "Abel", realm: "Thunder Hold", race: "Orc", faction: "Horde", level: 1, quests: [], history: { completedIdsKnown: true, completedIds: [] }, location: { mapId: 1411 }, source: { kind: "wow-addon", id: "s", updatedAt: "2026-11-22T11:00:00.000Z" } };
  const state = { activeProfileId: "p", profiles: [profile, { ...profile, id: "manual", name: "Typed", source: { kind: "manual" } }] };
  const edits = new E.RouteEdits({ write: () => {} });
  const api = registerRouteEditor({ handle: (name, fn, o = {}) => { handlers[name] = fn; if (o.privateOnly) privates.add(name); }, getState: () => state, edits, getPack: () => pack, getZones: () => zones,
    getCreatures: () => creatures, getBaseline: () => baseline, mapNames: { 1411: "Durotar", 1413: "The Barrens" }, copyText: (t) => log.copied.push(t), onChange: () => log.changed++,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: "C:/x/route.txt" }), showOpenDialog: async () => ({ canceled: false, filePaths: ["C:/x/in.txt"] }) },
    writeFile: async (f, t) => log.written.push([f, t]), statFile: () => ({ size: log.file.length }), readFile: () => log.file });
  assert.deepEqual([...privates].sort(), ["copyRouteCode", "importRouteCode", "openRouteCode", "routeEdit", "saveRouteCode"]);
  assert.throws(() => handlers.routeEditor(), /Invalid/); assert.throws(() => handlers.routeEditor({ profileId: "p", page: -1 }), /Invalid/);
  assert.equal(handlers.routeEditor({ profileId: null, page: null }).route, null);
  let view = handlers.routeEditor({ profileId: "p", page: null });
  assert.equal(view.variant, "solo"); assert.deepEqual(view.variants.map((v) => v.id), V.VARIANT_IDS);
  assert.ok(view.variants.every((v) => v.numbers && v.numbers.steps > 0 && v.changes && v.cannot));
  assert.equal(view.route.page, 0); assert.equal(view.route.here, view.route.steps[0].id); assert.equal(view.route.canShare, false); assert.equal(view.route.inGame, 0);
  assert.equal(api.handoff("p"), null, "the addon already carries the solo route: nothing extra is sent");
  assert.throws(() => handlers.routeEdit({ profileId: "other", action: { type: "reset" } }), (e) => e.name === "JourneyError");
  assert.throws(() => handlers.routeEdit({ profileId: "p", action: { type: "skip", id: "pickup:99" } }), (e) => e.name === "JourneyError" && /Unknown step/.test(e.message));
  const first = view.route.steps[0].id;
  view = handlers.routeEdit({ profileId: "p", action: { type: "note", id: first, text: "Sell first" }, page: 0 });
  assert.equal(view.route.steps[0].note, "Sell first"); assert.equal(view.route.edits.notes, 1); assert.equal(log.changed, 1);
  assert.equal(view.route.inGame, Math.min(E.LIMITS.handoffSteps, view.route.total));
  assert.equal(api.handoff("p").steps[0].note, "Sell first"); assert.equal(api.handoff("manual"), null, "only characters the addon saved");
  assert.equal(api.routeFor(profile).route.steps[0].note, "Sell first");
  view = handlers.routeEdit({ profileId: "p", action: { type: "variant", variant: "careful" }, page: null });
  assert.equal(view.variant, "careful"); assert.equal(api.handoff("p").variant, "careful");
  assert.ok(!api.routeFor(profile).route.steps.some((s) => s.ids.includes(13)), "the careful route is what the desktop walks");
  await handlers.copyRouteCode({ profileId: "p" });
  assert.match(log.copied[0], /^BFROUTE1\./);
  assert.deepEqual(await handlers.saveRouteCode({ profileId: "p" }), { saved: true }); assert.deepEqual(log.written, [["C:/x/route.txt", `${log.copied[0]}\n`]]);
  // Import: a friend's code replaces the edits; junk changes nothing.
  assert.throws(() => handlers.importRouteCode({ profileId: "p", code: "<script>alert(1)</script>" }), (e) => e.name === "JourneyError" && /Nothing was changed/.test(e.message));
  assert.equal(edits.get("p").notes[first], "Sell first");
  const friend = E.exportCode(E.edit(E.edit(E.empty(), { type: "skip", id: first }, base()), { type: "note", id: "pickup:424242", text: "x" }, { steps: [{ id: "pickup:424242", kind: "pickup", ids: [424242] }] }), "Orc");
  assert.throws(() => handlers.importRouteCode({ profileId: "p", code: friend }), /Nothing was changed/, "a code naming a quest this app does not know");
  const good = E.exportCode(E.edit(E.empty(), { type: "skip", id: first }, base()), "Orc");
  view = handlers.importRouteCode({ profileId: "p", code: good });
  assert.equal(view.variant, "solo"); assert.match(view.note, /^Imported a Solo route made for the Orc start\. 1 edit fit your route\. It replaced your earlier edits\.$/);
  assert.deepEqual(edits.get("p").notes, {});
  log.file = good + "\n"; assert.equal((await handlers.openRouteCode({ profileId: "p" })).route.edits.skipped, 1);
  log.file = "x".repeat(E.LIMITS.code + 500); await assert.rejects(handlers.openRouteCode({ profileId: "p" }), /too large/);
  // Main wires the routes into the hand-off and the desktop route.
  const main = read("src/main.cjs");
  assert.match(main, /routes: \(id\) => routeEditor\?\.handoff\(id\) \|\| null/); assert.match(main, /const mine = routeEditor\.routeFor\(p\);/);
});
