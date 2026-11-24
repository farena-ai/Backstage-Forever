"use strict";
// Travel planner (roadmap Q15): routing, the compared options, saved character facts and the IPC views.
const test = require("node:test"), assert = require("node:assert/strict");
const T = require("../src/core/transport-data.cjs");
const P = require("../src/core/travel-planner.cjs");
const ipc = require("../src/core/travel-planner-ipc.cjs");
const fx = require("./fixtures/transport.cjs");
const { otherPatch } = require("./pack-invariants.cjs");
const pack = () => T.compileTransport([{ build: fx.build, files: fx.buffers() }], { commit: fx.commit });
const all = new Set([1, 2, 3, 4, 5]);

test("a direct connection is used as recorded, and a missing time is estimated from the distance and says so", () => {
  const p = pack();
  const there = P.flightRoute(p, 1, 2, all);
  assert.deepEqual([there.hops, there.seconds, there.timing, there.cost, there.costEstimated, there.source], [[1, 2], 100, "observed", 100, false, "direct"]);
  const back = P.flightRoute(p, 2, 1, all);
  assert.equal(back.timing, "estimated"); assert.equal(back.estimatedLegs, 1);
  assert.equal(back.seconds, Math.round(Math.hypot(400, 400) / p.flightSpeed));
  assert.equal(back.cost, 100, "full price worked out from the Honored price"); assert.equal(back.costEstimated, true);
  assert.equal(P.flightRoute(p, 1, 1, all), null); assert.equal(P.flightRoute(p, 1, 99, all), null);
});

test("the game's own longer route wins with its whole-flight time; without it Dijkstra adds single connections", () => {
  const p = pack();
  const seen = P.flightRoute(p, 1, 3, all);
  assert.deepEqual([seen.hops, seen.seconds, seen.timing, seen.cost, seen.source], [[1, 2, 3], 280, "observed", 400, "game-route"]);
  assert.equal(seen.legs.reduce((n, l) => n + l.seconds, 0), 300, "the legs still show their own times");
  const worked = P.flightRoute(p, 1, 4, all);
  assert.deepEqual(worked.hops, [1, 2, 3, 4]); assert.equal(worked.source, "worked-out");
  assert.equal(worked.unknownLegs, 1, "3>4 has no time and point 4 has no place"); assert.equal(worked.timing, "unknown");
  assert.equal(worked.cost, 450);
  const unpriced = P.flightRoute(p, 3, 5, all);
  assert.equal(unpriced.cost, null);
});

test("only learned flight points are flown through", () => {
  const p = pack();
  assert.equal(P.flightRoute(p, 1, 3, new Set([1, 3])), null, "2 is not learned, and 1 has no direct connection to 3");
  assert.equal(P.flightRoute(p, 1, 3, new Set([1, 2])), null);
  assert.deepEqual(P.usableNodes(p, { knownNodes: [1, 2, 777] }), { allowed: new Set([1, 2]), assumed: false });
  const guess = P.usableNodes(p, { faction: "Alliance", knownNodes: null });
  assert.equal(guess.assumed, true);
  assert.deepEqual([...guess.allowed].sort(), [4, 5], "points whose own flight master is Horde are left out for Alliance; linked-only points stay");
  assert.equal(P.usableNodes(p, { faction: "Horde" }).allowed.size, 5);
});

test("options come fastest first with time and price each, and say what is assumed or estimated", () => {
  const p = pack();
  const r = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { faction: "Horde", knownNodes: null }, now: 1000 });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.options.map((o) => o.kind), ["walk", "flight"]);
  const [walk, fly] = r.options;
  assert.equal(walk.seconds, Math.round(Math.hypot(800, 800) / P.RUN_SPEED)); assert.equal(walk.cost, 0); assert.equal(walk.exact, false);
  assert.match(walk.notes[0], /straight line/);
  assert.deepEqual(fly.legs.map((l) => l.kind), ["fly", "fly"]);
  assert.equal(fly.cost, 400); assert.equal(fly.flightSeconds, 280); assert.equal(fly.seconds, 280); assert.equal(fly.exact, true);
  // Standing a short walk from a flight point adds the walk as its own leg.
  const near = P.planTrip(p, { from: { mapId: 1413, x: 0.1, y: 0.12 }, to: { nodeId: 2 }, character: { faction: "Horde" }, now: 1000 }).options.find((o) => o.kind === "flight");
  assert.deepEqual(near.legs.map((l) => [l.kind, l.yards]), [["walk", 20], ["fly", undefined]]);
  assert.equal(near.seconds, Math.round(20 / P.RUN_SPEED + 100)); assert.equal(near.exact, false);
  assert.equal(fly.assumed, true); assert.match(fly.notes[0], /^If you know these flight points/);
  assert.ok(fly.notes.some((n) => /does not land in between/.test(n)));
  assert.ok(r.options[0].seconds <= r.options[1].seconds);
  assert.match(r.coverage, /connections timed\)\.$/);
  assert.match(r.transportNote, /Boats, zeppelins, the tram and portals are not in this data/);
  assert.ok(r.notes.some((n) => /Hearthstone: the saved character data does not say/.test(n)));
});

test("with saved flight points the route uses only those, and an unlearned destination lands at the nearest known one", () => {
  const p = pack();
  const r = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { faction: "Horde", knownNodes: [1, 2] }, now: 1000 });
  const fly = r.options.find((o) => o.kind === "flight");
  assert.deepEqual(fly.hops, [1, 2]); assert.equal(fly.assumed, false);
  assert.deepEqual(fly.legs.map((l) => l.kind), ["fly", "walk"]);
  assert.ok(fly.notes.some((n) => /is not among your learned flight points/.test(n)));
  assert.ok(!fly.notes.some((n) => /If you know/.test(n)));
  const none = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { knownNodes: [] }, now: 1000 });
  assert.deepEqual(none.options.map((o) => o.kind), ["walk"]);
  assert.ok(none.notes.some((n) => /no learned flight points saved yet/.test(n)));
});

test("the Hearthstone is compared when its place and cooldown are known, and explained when they are not", () => {
  const p = pack();
  const character = { faction: "Horde", knownNodes: [1, 2, 3], hearth: { name: "Cid's Inn", mapId: 1413, x: 0.9, y: 0.88, readyAt: 1000 } };
  const ready = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character, now: 1000 });
  assert.equal(ready.options[0].kind, "hearth");
  assert.deepEqual(ready.options[0].legs.map((l) => l.kind), ["hearth", "walk"]);
  assert.equal(ready.options[0].seconds, P.HEARTH_CAST + Math.round(20 / P.RUN_SPEED));
  const waiting = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { ...character, hearth: { ...character.hearth, readyAt: 1000 + 1800 } }, now: 1000 });
  const h = waiting.options.find((o) => o.kind === "hearth");
  assert.equal(h.waits, 1800); assert.equal(h.legs[0].kind, "wait"); assert.equal(waiting.options.at(-1).kind, "hearth", "a long cooldown puts the Hearthstone last");
  const unknownCooldown = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { ...character, hearth: { ...character.hearth, readyAt: null } }, now: 1000 });
  assert.ok(unknownCooldown.options.find((o) => o.kind === "hearth").notes.some((n) => /does not know your Hearthstone cooldown/.test(n)));
  const unplaced = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { ...character, hearth: { name: "Somewhere" } }, now: 1000 });
  assert.equal(unplaced.options.some((o) => o.kind === "hearth"), false);
  assert.ok(unplaced.notes.some((n) => /goes to Somewhere, but the app does not know where that is/.test(n)));
  // A bind name that matches a flight point name the game gave stands in for the inn's spot.
  const named = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 2 }, character: { ...character, names: { 3: "Crossroads, The Barrens" }, hearth: { name: "The Crossroads", readyAt: 1000 } }, now: 1000 });
  assert.ok(named.options.find((o) => o.kind === "hearth").notes.some((n) => /exact spot was not recorded/.test(n)));
});

test("places that cannot be measured or reached are said plainly", () => {
  const p = pack();
  const far = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 4 }, character: { faction: "Horde" }, now: 1000 });
  assert.ok(far.notes.some((n) => /Nobody has recorded where .* is on the map/.test(n)));
  assert.deepEqual(far.options.map((o) => o.kind), ["flight"]);
  assert.ok(far.options[0].notes.some((n) => /no recorded time and no known place/.test(n)));
  const off = P.planTrip(p, { from: { mapId: 4242, x: 0.5, y: 0.5 }, to: { nodeId: 3 }, character: {}, now: 1000 });
  assert.equal(off.status, "no-route"); assert.equal(off.options.length, 0);
  assert.equal(P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 999 } }).status, "unknown-place");
  const zone = P.planTrip(p, { from: { nodeId: 1 }, to: { mapId: 1413 }, character: { faction: "Horde" }, now: 1000 });
  assert.match(zone.to.label, /middle of the zone/);
});

test("places are found by zone, flight master or the game's own name", () => {
  const p = pack();
  const list = P.destinations(p, { names: { 2: "Crossroads, The Barrens" }, faction: "Horde" });
  assert.deepEqual(list.map((d) => d.id).sort(), ["node:1", "node:2", "node:3", "node:4", "node:5", "zone:1413"]);
  assert.equal(list.find((d) => d.id === "node:2").label, "Crossroads, The Barrens");
  assert.equal(list.find((d) => d.id === "node:1").label, "The Barrens (Ann)");
  assert.equal(list.find((d) => d.id === "node:4").label, "Flight point 4");
  assert.deepEqual(P.searchDestinations(list, "cross").map((d) => d.id), ["node:2"]);
  assert.deepEqual(P.searchDestinations(list, "cid").map((d) => d.id), ["node:3"]);
  assert.ok(P.searchDestinations(list, "barrens").some((d) => d.id === "zone:1413"));
  assert.equal(P.destinations(p, { faction: "Alliance" }).some((d) => d.id === "node:1"), false, "the other faction's flight masters are not offered");
  assert.deepEqual(P.parsePlace("node:23"), { nodeId: 23 }); assert.deepEqual(P.parsePlace("zone:1413"), { mapId: 1413 }); assert.equal(P.parsePlace("node:x"), null);
});

test("the saved travel block is strict, and the planner reads it with names shared across characters", () => {
  const capture = { seenAt: 1700000000, nodes: [{ id: 2, name: "Crossroads, The Barrens", known: true }, { id: 1, name: "Orgrimmar, Durotar", known: false }], bind: { name: "The Crossroads", mapId: 1413, x: 0.5, y: 0.5 }, hearthReadyAt: 1700000900 };
  const clean = P.normalizeTravelCapture(capture);
  assert.deepEqual(clean.nodes.map((n) => n.id), [1, 2]);
  assert.deepEqual(P.normalizeTravelCapture({ seenAt: 5, nodes: {} }), { seenAt: 5, nodes: [] }, "an empty Lua table arrives as an object");
  for (const bad of [{ ...capture, extra: 1 }, { ...capture, nodes: [{ id: 2, known: "yes" }] }, { ...capture, nodes: [{ id: 2, known: true }, { id: 2, known: true }] }, { ...capture, bind: { name: "" } }, { ...capture, bind: { name: "X", mapId: 1, x: 2, y: 0 } }, { ...capture, hearthReadyAt: -1 }, { nodes: [] }, null])
    assert.throws(() => P.normalizeTravelCapture(bad), /Invalid travel capture/);
  const main = { faction: "Horde", location: { zone: "The Barrens", mapId: 1413, x: 0.2, y: 0.2 }, travel: clean, ledger: { money: 12345 } };
  const alt = { faction: "Horde", travel: { seenAt: 1, nodes: [{ id: 3, name: "Camp Taurajo, The Barrens", known: true }] } };
  const facts = P.characterFacts(main, [main, alt]);
  assert.deepEqual(facts.knownNodes, [2]); assert.equal(facts.names[3], "Camp Taurajo, The Barrens"); assert.equal(facts.money, 12345);
  assert.deepEqual(facts.hearth, { name: "The Crossroads", mapId: 1413, x: 0.5, y: 0.5, readyAt: 1700000900 });
  assert.deepEqual(facts.position, { mapId: 1413, x: 0.2, y: 0.2 });
  assert.equal(P.characterFacts({ faction: "Horde" }).knownNodes, null, "no saved block means the flight points are not known, not that there are none");
  // The profile validator accepts the normalized block and refuses anything else.
  const { validateState, defaultState } = require("../src/core/validation.cjs");
  const profile = { id: "p1", name: "Thrall", realm: "Test", className: "Shaman", level: 20, notes: "", goals: [], travel: clean };
  assert.doesNotThrow(() => validateState({ ...defaultState(), profiles: [profile], activeProfileId: "p1" }));
  assert.throws(() => validateState({ ...defaultState(), profiles: [{ ...profile, travel: { ...clean, extra: true } }], activeProfileId: "p1" }));
});

test("the desktop views follow the same-patch rule and never guess a start", () => {
  const p = pack();
  const profile = { id: "p1", name: "Thrall", className: "Shaman", level: 20, faction: "Horde", clientBuild: "1.60.1.123", location: { zone: "The Barrens", mapId: 1413, x: 0.1, y: 0.1 } };
  const state = { profiles: [profile], activeProfileId: "p1" };
  const view = ipc.travelView(state, { transport: p, now: 1000 });
  assert.equal(view.available, true); assert.match(view.note, /same patch/);
  assert.deepEqual(view.character, { name: "Thrall", faction: "Horde", hasPosition: true, zone: "The Barrens", knownFlightPoints: null, namedFlightPoints: 0, hearth: null });
  const plan = ipc.travelPlan(state, { to: "node:3" }, { transport: p, now: 1000 });
  assert.equal(plan.status, "ok"); assert.match(plan.from.label, /where you last saved/);
  const refused = { profiles: [{ ...profile, clientBuild: otherPatch(fx.build) }], activeProfileId: "p1" };
  assert.equal(ipc.travelView(refused, { transport: p }).available, false);
  assert.equal(ipc.travelPlan(refused, { to: "node:3" }, { transport: p }).status, "unavailable");
  const lost = { profiles: [{ ...profile, location: { zone: "" } }], activeProfileId: "p1" };
  assert.equal(ipc.travelPlan(lost, { to: "node:3" }, { transport: p }).status, "no-start");
  assert.equal(ipc.travelPlan(lost, { from: "node:1", to: "node:3" }, { transport: p, now: 1 }).status, "ok");
  assert.match(ipc.travelView({ profiles: [{ ...profile, clientBuild: undefined }], activeProfileId: "p1" }, { transport: p }).note, /game build is not known/);
  assert.throws(() => ipc.travelPlan(state, { to: 5 }, { transport: p }), /Invalid travel request/);
  assert.throws(() => ipc.travelPlan(state, { to: "nowhere" }, { transport: p }), /Choose a destination/);
});

test("the bundled graph plans a real trip for each faction", () => {
  const p = T.loadTransportPack();
  for (const faction of ["Alliance", "Horde"]) {
    const own = p.nodes.filter((n) => n.side === faction && n.sideFrom === "master" && n.wx !== null);
    const a = own[0], b = own.find((n) => n.instance === a.instance && n.id !== a.id && P.flightRoute(p, a.id, n.id, null));
    assert.ok(b, `${faction} has a connected pair`);
    const r = P.planTrip(p, { from: { nodeId: a.id }, to: { nodeId: b.id }, character: { faction }, now: 1 });
    assert.ok(r.options.some((o) => o.kind === "flight") && r.options.some((o) => o.kind === "walk"), faction);
    for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].seconds <= r.options[i].seconds);
  }
});
