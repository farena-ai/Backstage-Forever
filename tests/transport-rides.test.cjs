"use strict";
// Boats, zeppelins, airships and the tram in the travel planner (roadmap Q15, D3): which transports
// the pack names, where the game files say they stop, who may board, and the trips planned with them.
const test = require("node:test"), assert = require("node:assert/strict");
const T = require("../src/core/transport-data.cjs");
const R = require("../src/core/transport-rides.cjs");
const P = require("../src/core/travel-planner.cjs");
const ipc = require("../src/core/travel-planner-ipc.cjs");
const fx = require("./fixtures/transport.cjs");

// The fixture pack has one Kalimdor map (1413, instance 1, world 0..1000). These tests add three
// Eastern Kingdoms maps (instance 0) so there is another continent to reach and two cities for the
// tram, and Duskwood for a dock that stands at no flight point.
function pack() {
  const p = T.compileTransport([{ build: fx.build, files: fx.buffers(fx.flights(), fx.npcs(), fx.objects()) }], { commit: fx.commit });
  p.maps[1429] = { instance: 0, x0: 1000, x1: 0, y0: 1000, y1: 0, points: 3 };
  p.maps[1431] = { instance: 0, x0: 3000, x1: 2000, y0: 3000, y1: 2000, points: 3 };
  p.maps[1453] = { instance: 0, x0: 2200, x1: 2000, y0: 2200, y1: 2000, points: 3 };
  p.maps[1455] = { instance: 0, x0: 5200, x1: 5000, y0: 5200, y1: 5000, points: 3 };
  return p;
}
const rides = (p = pack(), game = fx.game(), reference = null) => R.transportRides(p, game, reference);
const byName = (r, name) => r.transports.find((t) => t.name === name);
const east = (x, y) => ({ mapId: 1429, x, y }), west = (x, y) => ({ mapId: 1413, x, y });

test("the pack names the moving transports upstream recorded, and nothing about where they go", () => {
  const p = pack();
  assert.deepEqual(p.transports.map((t) => [t.id, t.name, t.mode, t.pathId, t.speed, t.accel]), [
    [9001, "Zeppelin - Anntown to Hordeport", "zeppelin", 70, 30, 1], [9002, "Sea Lark", "boat", 71, 30, 1], [9003, "Long Ferry", "boat", 72, 30, 1], [9006, "TEST Ship", "boat", 73, 30, null], [9007, "Cloud Skycutter", "airship", 74, 30, 1],
  ], "an object that is no transport, has no path or is of an unknown model is left out");
  assert.equal(p.counts.transports, 5);
  for (const t of p.transports) assert.deepEqual(Object.keys(t), ["id", "name", "mode", "pathId", "speed", "accel"]);
  // The newest build that saw a transport wins; an older build can still add one.
  const old = fx.objects(fx.older); old.objects[9001].name = "Old Zeppelin"; old.objects[9010] = { type: 15, name: "Zeppelin - Old Only", displayId: 3031, data: [80, 25, 1] };
  const merged = T.compileTransport([{ build: fx.build, files: fx.buffers(fx.flights(), fx.npcs(), fx.objects()) }, { build: fx.older, files: fx.buffers(fx.flights(fx.older), fx.npcs(fx.older), old) }], { commit: fx.commit });
  assert.equal(merged.transports.find((t) => t.id === 9001).name, "Zeppelin - Anntown to Hordeport"); assert.equal(merged.transports.find((t) => t.id === 9010).speed, 25);
  // A build without the file simply adds none.
  assert.deepEqual(T.compileTransport([{ build: fx.build, files: fx.buffers() }], { commit: fx.commit }).transports, []);
  const bad = structuredClone(p); bad.transports[0].mode = "portal";
  assert.throws(() => T.validateTransportPack(bad), /Invalid transport data/);
  const wrong = fx.objects(fx.older);
  assert.throws(() => T.compileTransport([{ build: fx.build, files: fx.buffers(fx.flights(), fx.npcs(), wrong) }], { commit: fx.commit }), /Source metadata/);
});

test("the ride time is the path length over the speed, with the time to speed up and slow down", () => {
  assert.equal(R.rideSeconds(3000, 30, 1), 130);
  assert.equal(R.rideSeconds(3000, 30, null), 100);
  assert.equal(R.rideSeconds(400, 30, 1), 40, "too short to reach full speed");
  assert.equal(R.rideSeconds(0, 30, 1), 0);
});

test("stops come from the game files: named by the flight point beside them, with the faction of those flight points", () => {
  const r = rides();
  assert.equal(r.known, 5); assert.equal(r.unread, 1, "the airship has no path in these game files"); assert.equal(r.gameFiles, true);
  const zep = byName(r, "Zeppelin - Anntown to Hordeport");
  assert.deepEqual(zep.stops.map((s) => [s.label, s.instance, s.wx, s.wy]), [["Anntown zeppelin tower", 1, 880, 900], ["Hordeport zeppelin tower", 0, 120, 100]]);
  assert.equal(zep.side, "Horde"); assert.equal(zep.sideFrom, "flight-points"); assert.equal(zep.timing, "estimated"); assert.equal(zep.source, "game-files");
  assert.deepEqual(zep.rides.map((x) => [x.from, x.to, x.seconds, x.dock]), [[0, 1, 130, 60], [1, 0, 80, 60]]);
  assert.equal(zep.roundSeconds, 130 + 80 + 120, "both rides and both stays at the dock");
  // A stop at a town of both factions and one at an Alliance town: Alliance only. Hordeport's
  // flight point is within reach of that dock too, but it is another town.
  assert.equal(byName(r, "Sea Lark").side, "Alliance");
  assert.deepEqual(byName(r, "Sea Lark").stops.map((s) => s.label), ["Cidport dock", "Eastdock dock"]);
  // The node the game keeps for the transport itself (no faction) never names a stop.
  assert.ok(r.transports.every((t) => t.stops.every((s) => !/Transport/.test(s.label))));
  // A placeholder name is not shown, and both its stops are open to both factions.
  const nameless = r.transports.find((t) => t.id === 9006);
  assert.equal(nameless.name, null); assert.equal(nameless.side, "Both");
});

test("a stop with no flight point nearby takes the zone's name and leaves the faction unknown", () => {
  const ferry = byName(rides(), "Long Ferry");
  assert.deepEqual(ferry.stops.map((s) => s.label), ["Cidport dock", "Duskwood dock", "Dock with no recorded name"]);
  assert.equal(ferry.side, null); assert.equal(ferry.sideFrom, null);
  // Three stops in a loop: every stop reaches every other, staying on board at the one between.
  const ride = (a, b) => ferry.rides.find((x) => x.from === a && x.to === b);
  assert.equal(ferry.rides.length, 6);
  assert.equal(ride(0, 1).seconds, 130); assert.deepEqual(ride(0, 1).via, []);
  assert.equal(ride(0, 2).seconds, 130 + 45 + 130, "the stay at the stop between counts"); assert.deepEqual(ride(0, 2).via, ["Duskwood dock"]);
  assert.deepEqual(ride(2, 1).via, ["Cidport dock"]);
});

test("a ferry that calls at its home dock twice in a round has one stop there; unreadable paths are left out", () => {
  const p = pack(), game = fx.game();
  game.paths[71] = { stops: [[1, 100, 130, 30], [0, 500, 520, 60], [1, 100, 131, 30]], yards: [900, 3000, 800] };
  const lark = byName(R.transportRides(p, game), "Sea Lark");
  assert.equal(lark.stops.length, 2);
  assert.deepEqual(lark.rides.map((x) => [x.from, x.to, x.seconds]), [[0, 1, 60], [1, 0, 130]]);
  // Two stops that share the nearest flight point: the nearer keeps the name.
  game.points[9] = ["Cidport, The Barrens", 1, 100, 100, 3];
  game.paths[70] = { stops: [[1, 100, 150, 60], [1, 100, 900, 60]], yards: [900, 900] };
  delete game.points[3]; delete game.points[2]; delete game.points[1];
  assert.deepEqual(byName(R.transportRides(p, game), "Zeppelin - Anntown to Hordeport").stops.map((s) => s.label), ["Cidport zeppelin tower", "The Barrens zeppelin tower"]);
  for (const broken of [null, { stops: [[1, 1, 1, 60]], yards: [5] }, { stops: [[1, 1, 1, 60], [1, "x", 1, 60]], yards: [5, 5] }, { stops: [[1, 1, 1, 60], [1, 900, 1, 60]], yards: [5] }, { stops: [[1, 1, 1, 60], [1, 2, 1, 60]], yards: [5, 5] }]) {
    const g = fx.game(); g.paths = { 70: broken };
    const out = R.transportRides(p, g);
    assert.equal(out.transports.length, 0); assert.equal(out.unread, 5);
  }
  const none = R.transportRides(p, null);
  assert.deepEqual([none.transports.length, none.known, none.unread, none.gameFiles], [0, 5, 5, false]);
  assert.deepEqual(R.transportRides({ maps: {} }, fx.game()).transports, []);
});

test("a trip to another continent walks to the stop, rides and walks on, and never counts the wait", () => {
  const p = pack(), r = rides(p);
  const trip = P.planTrip(p, { from: { nodeId: 1 }, to: east(0.9, 0.9), character: { faction: "Horde" }, now: 1000, rides: r });
  assert.equal(trip.status, "ok");
  assert.deepEqual(trip.options.map((o) => o.kind), ["ride"], "nothing else crosses the sea");
  const o = trip.options[0];
  assert.equal(o.mode, "zeppelin"); assert.equal(o.title, "Zeppelin"); assert.equal(o.plusWait, true); assert.equal(o.exact, false); assert.equal(o.rides, 1); assert.equal(o.cost, 0);
  assert.deepEqual(o.legs.map((l) => l.kind), ["walk", "ride", "walk"]);
  assert.deepEqual([o.legs[1].from, o.legs[1].to, o.legs[1].seconds, o.legs[1].timing, o.legs[1].name], ["Anntown zeppelin tower", "Hordeport zeppelin tower", 130, "estimated", "Zeppelin - Anntown to Hordeport"]);
  assert.equal(o.seconds, Math.round(20 / P.RUN_SPEED + 130 + 20 / P.RUN_SPEED), "walks and ride only: no wait is added");
  assert.match(o.notes[0], /wait for the next departure is not in the time/);
  assert.ok(o.notes.some((n) => /estimates/.test(n)));
  assert.ok(o.notes.some((n) => /full round of the zeppelin \(Zeppelin - Anntown to Hordeport\) takes about 6 min/.test(n)));
  assert.match(trip.transportNote, /the data names 5; 4 have their stops in your game files/);
  assert.match(trip.transportNote, /wait for the next departure is never known/);
  // And back again: the other half of the loop.
  const back = P.planTrip(p, { from: east(0.9, 0.9), to: { nodeId: 1 }, character: { faction: "Horde" }, now: 1000, rides: r });
  assert.equal(back.options[0].legs.find((l) => l.kind === "ride").seconds, 80);
});

test("faction limits: each side boards only what its flight points allow, and an unknown side is said", () => {
  const p = pack(), all = rides(p), r = { ...all, transports: all.transports.filter((t) => t.id !== 9006) }; // without the boat for both sides
  const plan = (faction, from, to) => P.planTrip(p, { from, to, character: { faction, knownNodes: [] }, now: 1000, rides: r });
  const names = (t) => t.options.flatMap((o) => o.legs).filter((l) => l.kind === "ride").map((l) => l.name);
  // From Anntown the zeppelin is a few steps away; an Alliance character has to cross the zone to the boat.
  const horde = plan("Horde", west(0.1, 0.1), east(0.9, 0.9)), alliance = plan("Alliance", west(0.1, 0.1), east(0.9, 0.9));
  assert.deepEqual(names(horde), ["Zeppelin - Anntown to Hordeport"]);
  assert.ok(!names(alliance).includes("Zeppelin - Anntown to Hordeport"), "the Horde zeppelin is never offered to the Alliance");
  assert.ok(alliance.options[0].seconds > horde.options[0].seconds);
  // The Alliance boat is not offered to the Horde even when it is the nearest thing.
  const nearBoat = plan("Horde", west(0.87, 0.9), east(0.48, 0.5));
  assert.ok(!names(nearBoat).includes("Sea Lark"));
  assert.deepEqual(names(plan("Alliance", west(0.87, 0.9), east(0.48, 0.5))), ["Sea Lark"]);
  // No faction known: everything counts, and a one-faction transport says why it is counted so.
  const anyone = plan(null, west(0.1, 0.1), east(0.9, 0.9));
  assert.deepEqual(names(anyone), ["Zeppelin - Anntown to Hordeport"]);
  assert.ok(anyone.options[0].notes.some((n) => /counts as a Horde transport: its stops stand at Horde flight points/.test(n)));
  // Only the ferry with an unknown side is left: it is used, and the card says the side is not known.
  const lone = { ...r, transports: r.transports.filter((t) => t.name === "Long Ferry") };
  const unknown = P.planTrip(p, { from: west(0.87, 0.9), to: east(0.48, 0.5), character: { faction: "Horde", knownNodes: [] }, now: 1000, rides: lone });
  assert.deepEqual(names(unknown), ["Long Ferry"]);
  assert.ok(unknown.options[0].notes.some((n) => /does not say which faction may board the boat \(Long Ferry\)/.test(n)));
  // Nothing this character may board: said plainly.
  const zepOnly = { ...r, transports: r.transports.filter((t) => t.mode === "zeppelin") };
  const stuck = P.planTrip(p, { from: west(0.1, 0.1), to: east(0.9, 0.9), character: { faction: "Alliance", knownNodes: [] }, now: 1000, rides: zepOnly });
  assert.equal(stuck.status, "no-route");
  assert.ok(stuck.notes.some((n) => /no boat or zeppelin this character can board connects them/.test(n)));
});

test("a ride is compared with the land options, flights may lead to the dock, and staying on board is shown", () => {
  const p = pack(), r = rides(p);
  // Same continent: Anntown to Cidport has a flight and a walk. Sailing away and back is slower, so it is not shown.
  const land = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { faction: "Horde" }, now: 1000, rides: r });
  assert.deepEqual(land.options.map((o) => o.kind).sort(), ["flight", "walk"]);
  // A ride that does beat the land is shown first: a fast ferry along the same coast.
  const coast = { ...r, transports: [{ ...r.transports[0], name: "Coaster", mode: "boat", side: "Both", stops: [{ label: "Anntown dock", instance: 1, wx: 900, wy: 900 }, { label: "Cidport dock", instance: 1, wx: 100, wy: 100 }], rides: [{ from: 0, to: 1, seconds: 30, dock: 60, yards: 900, via: [] }], roundSeconds: 180 }] };
  const quick = P.planTrip(p, { from: { nodeId: 1 }, to: { nodeId: 3 }, character: { faction: "Horde" }, now: 1000, rides: coast });
  assert.deepEqual(quick.options.map((o) => o.kind), ["ride", "walk", "flight"]);
  assert.deepEqual(quick.options[0].legs.map((l) => l.kind), ["ride"]);
  // Fly to the dock, then ride: the flight's price and its caveats come along.
  const lone = { ...r, transports: r.transports.filter((t) => t.id === 9006) };
  const quickFlights = pack(); // the same graph with flights that beat walking
  for (const e of quickFlights.edges) if (e.seconds) e.seconds = 10;
  quickFlights.routes.find((x) => x.from === 1 && x.to === 3).seconds = 20;
  const mixed = P.planTrip(quickFlights, { from: { nodeId: 1 }, to: east(0.48, 0.5), character: { faction: "Horde" }, now: 1000, rides: lone });
  const o = mixed.options[0];
  assert.deepEqual(o.legs.map((l) => l.kind), ["fly", "fly", "walk", "ride", "walk"]);
  assert.equal(o.legs[3].name, null, "a placeholder name is not shown");
  assert.equal(o.cost, 400); assert.ok(o.notes.some((n) => /If you know these flight points/.test(n)));
  assert.ok(o.notes.some((n) => /full round of the boat takes about/.test(n)));
  // Three stops: the ride past the middle stop is one leg that names where you stay on board.
  const ferry = { ...r, transports: r.transports.filter((t) => t.name === "Long Ferry") };
  const far = P.planTrip(p, { from: { mapId: 1431, x: 0.4, y: 0.4 }, to: west(0.87, 0.9), character: { faction: null, knownNodes: [] }, now: 1000, rides: ferry });
  const leg = far.options[0].legs.find((l) => l.kind === "ride");
  assert.deepEqual(leg.via, ["Dock with no recorded name"]); assert.equal(leg.seconds, 305);
  // The options stay fastest first.
  for (const t of [land, mixed, far]) for (let i = 1; i < t.options.length; i++) assert.ok(t.options[i - 1].seconds <= t.options[i].seconds);
});

test("the Hearthstone can be followed by a ride, and still says plus the wait", () => {
  const p = pack(), r = rides(p);
  const character = { faction: "Horde", knownNodes: [], hearth: { name: "Ann's Inn", mapId: 1413, x: 0.1, y: 0.12, readyAt: 1000 } };
  const trip = P.planTrip(p, { from: west(0.9, 0.9), to: east(0.9, 0.9), character, now: 1000, rides: r });
  const h = trip.options.find((o) => o.kind === "hearth");
  assert.deepEqual(h.legs.map((l) => l.kind), ["hearth", "ride", "walk"], "the inn stands at the zeppelin tower");
  assert.equal(h.plusWait, true); assert.equal(h.then, "ride");
  assert.equal(trip.options[0].kind, "hearth", "ten seconds of casting beat the walk across the zone");
});

test("without game files the sea cannot be crossed, and the planner says why", () => {
  const p = pack();
  for (const r of [null, R.transportRides(p, null)]) {
    const trip = P.planTrip(p, { from: { nodeId: 1 }, to: east(0.9, 0.9), character: { faction: "Horde" }, now: 1000, rides: r });
    assert.equal(trip.status, "no-route");
    assert.ok(trip.notes.some((n) => /different continents.*read from your own game files, and no game folder is connected/.test(n)));
  }
  assert.match(P.transportNote(null), /Boats, zeppelins, the tram and portals are not in this data/);
  assert.match(P.transportNote(R.transportRides(p, null)), /names 5 boats, zeppelins and airships but not where they stop/);
  assert.match(P.transportNote(R.transportRides({ transports: [], maps: {} }, null)), /No boat or zeppelin is in this data/);
});

test("the tram is reference only: no time, never ranked, offered last and only to its faction", () => {
  const p = pack(), r = R.transportRides(p, null, fx.reference());
  const tram = r.transports.find((t) => t.mode === "tram");
  assert.deepEqual([tram.name, tram.side, tram.sideFrom, tram.timing, tram.source, tram.roundSeconds], ["Deeprun Tram", "Alliance", "reference", "unknown", "reference", null]);
  assert.deepEqual(tram.stops.map((s) => [s.label, s.approximate]), [["Stormwind City tram station", true], ["Ironforge tram station", true]]);
  const trip = (faction) => P.planTrip(p, { from: { mapId: 1453 }, to: { mapId: 1455 }, character: { faction, knownNodes: [] }, now: 1000, rides: r });
  const a = trip("Alliance");
  assert.deepEqual(a.options.map((o) => [o.kind, o.mode || null]), [["walk", null], ["ride", "tram"]]);
  const o = a.options[1];
  assert.equal(o.unknownTime, true); assert.equal(o.reference, true); assert.equal(o.plusWait, true);
  assert.deepEqual(o.legs.map((l) => [l.kind, l.seconds, l.timing]), [["ride", null, "unknown"]]);
  assert.match(o.notes[0], /published travel guide.*not from recorded data.*never ranked/);
  assert.deepEqual(trip("Horde").options.map((x) => x.kind), ["walk"], "the guide lists the tram for the Alliance");
  assert.ok(trip(null).options.at(-1).notes.some((n) => /guide lists it for Alliance characters/.test(n)));
  // Far from both cities the tram would only add walking, so it is not offered.
  const off = P.planTrip(p, { from: east(0.1, 0.1), to: east(0.2, 0.1), character: { faction: "Alliance", knownNodes: [] }, now: 1000, rides: r });
  assert.deepEqual(off.options.map((x) => x.kind), ["walk"]);
  assert.match(a.transportNote, /Deeprun Tram is known only from a published guide: no place and no time/);
  // A reference without a tram, or with a city the pack cannot place, adds nothing.
  assert.equal(R.transportRides(p, null, { nodes: [], edges: [] }).transports.length, 0);
  const noMap = pack(); delete noMap.maps[1455];
  assert.equal(R.transportRides(noMap, null, fx.reference()).transports.length, 0);
});

test("the desktop passes the game files and the reference through, and tells the screen what it has", () => {
  const p = pack();
  const profile = { id: "p1", name: "Thrall", className: "Shaman", level: 20, faction: "Horde", clientBuild: fx.build, location: { zone: "The Barrens", mapId: 1413, x: 0.1, y: 0.1 } };
  const state = { profiles: [profile], activeProfileId: "p1" };
  const view = ipc.travelView(state, { transport: p, now: 1000, game: fx.game(), reference: fx.reference() });
  assert.deepEqual(view.transports, { known: 5, read: 4, gameFiles: true, tram: true });
  assert.deepEqual(ipc.travelView(state, { transport: p, now: 1000 }).transports, { known: 5, read: 0, gameFiles: false, tram: false });
  const handlers = {};
  ipc.registerTravelPlannerHandlers({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, reference: fx.reference(), gameData: { flights: () => ({ points: fx.game().points, costs: {} }), transportPaths: () => fx.game().paths, spellLevels: () => null } });
  // The bundled pack has no map for the fixture's far shore, so only the pass-through is checked here.
  assert.equal(handlers.travelPlaces().transports.gameFiles, true);
  const broken = {};
  ipc.registerTravelPlannerHandlers({ handle: (name, fn) => { broken[name] = fn; }, getState: () => state, gameData: { flights: () => ({ points: fx.game().points, costs: {} }), transportPaths() { throw Error("unreadable"); } } });
  assert.equal(broken.travelPlaces().transports.gameFiles, false, "an unreadable path table leaves the flights working");
  const plan = ipc.travelPlan(state, { to: "node:3" }, { transport: p, now: 1000, game: fx.game() });
  assert.equal(plan.status, "ok"); assert.match(plan.transportNote, /4 have their stops in your game files/);
});
