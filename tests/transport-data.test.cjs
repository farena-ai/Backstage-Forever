"use strict";
// Transport graph pack (roadmap D3): compiler rules, validation, the bundled pack and its lock.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const T = require("../src/core/transport-data.cjs");
const fx = require("./fixtures/transport.cjs");
const inv = require("./pack-invariants.cjs");
const compile = (builds = [{ build: fx.build, files: fx.buffers() }]) => T.compileTransport(builds, { commit: fx.commit });

test("flight seconds are the middle of everything recorded; prices keep full and Honored apart", () => {
  assert.equal(T.medianSeconds({ 100: 2, 104: 1 }), 100);
  assert.equal(T.medianSeconds({ 259: 2, 314: 1 }), 259);
  assert.equal(T.medianSeconds({}), null);
  const p = compile();
  const edge = (a, b) => p.edges.find((e) => e.from === a && e.to === b);
  assert.deepEqual(edge(1, 2), { from: 1, to: 2, seconds: 100, samples: 3, cost: 100, honored: 90 });
  assert.deepEqual(edge(2, 1), { from: 2, to: 1, seconds: null, samples: 0, cost: null, honored: 90 }, "a price seen only at Honored stays an Honored price");
});

test("a hop that only appears inside a longer route becomes a connection with no time and no price", () => {
  const p = compile();
  assert.deepEqual(p.edges.find((e) => e.from === 3 && e.to === 5), { from: 3, to: 5, seconds: null, samples: 0, cost: null, honored: null });
  assert.deepEqual(p.routes.map((r) => [r.from, r.to, r.hops, r.seconds, r.cost]), [[1, 3, [1, 2, 3], 280, 400], [2, 5, [2, 3, 5], null, 700]]);
  assert.equal(p.counts.edges, 6); assert.equal(p.counts.timedEdges, 2); assert.equal(p.counts.routes, 2); assert.equal(p.counts.timedRoutes, 1);
});

test("flight points take place and faction from their flight master, else from where players landed and whom they link to", () => {
  const p = compile();
  const node = (id) => p.nodes.find((n) => n.id === id);
  assert.deepEqual(node(1), { id: 1, npcId: 11, master: "Ann", side: "Horde", sideFrom: "master", mapId: 1413, x: 0.1, y: 0.1, wx: 900, wy: 900, instance: 1, positionFrom: "master" });
  assert.deepEqual(node(4), { id: 4, npcId: null, master: null, side: "Horde", sideFrom: "links", mapId: null, x: null, y: null, wx: null, wy: null, instance: null, positionFrom: null });
  assert.equal(p.counts.placedNodes, 3);
  // Without the flight master's NPC record, the landing spot places the point.
  const n = fx.npcs(); delete n.npcs[12];
  const landed = compile([{ build: fx.build, files: fx.buffers(fx.flights(), n) }]).nodes.find((x) => x.id === 2);
  assert.equal(landed.positionFrom, "arrival"); assert.equal(landed.wx, 500); assert.equal(landed.sideFrom, "links");
  // A point linked to flight masters of both factions is marked Both.
  const mixed = fx.npcs(); mixed.npcs[13].side = "Alliance";
  const both = compile([{ build: fx.build, files: fx.buffers(fx.flights(), mixed) }]).nodes.find((x) => x.id === 2);
  assert.equal(both.side, "Horde", "the master's own side wins");
  const f = fx.flights(); delete f.masters[12];
  assert.equal(compile([{ build: fx.build, files: fx.buffers(f, mixed) }]).nodes.find((x) => x.id === 2).side, "Both");
});

test("zone map positions convert to world yards through the fitted line, and odd points are trimmed", () => {
  const p = compile();
  assert.deepEqual(p.maps[1413], { instance: 1, x0: 1000, x1: 0, y0: 1000, y1: 0, points: 5 });
  assert.deepEqual(T.toWorld(p, 1413, 0.25, 0.75), { instance: 1, wy: 750, wx: 250 });
  assert.equal(T.toWorld(p, 9999, 0.5, 0.5), null);
  const pts = [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => ({ x: v, y: v, wx: 1000 - 1000 * v, wy: 1000 - 1000 * v, instance: 1 }));
  assert.equal(T.fitMap([...pts, { x: 0.2, y: 0.2, wx: 5000, wy: -300, instance: 1 }]), null, "one wild point among six is too many to trust the map");
  assert.equal(T.fitMap([...pts, ...pts, { x: 0.2, y: 0.2, wx: 5000, wy: -300, instance: 1 }]).points, 10);
  assert.equal(T.fitMap(pts.slice(0, 2)), null);
});

test("the newest build wins a fact and older builds fill gaps", () => {
  const old = fx.flights(fx.older);
  old.routes["1>2"] = { hops: [1, 2], seconds: { 300: 1 }, costs: { 5: 999 } };
  old.routes["2>1"].costs = { 4: 100 };
  old.routes["3>1"] = { seconds: { 77: 1 } };
  old.routes["9>1"] = { seconds: { 50: 1 } };
  const p = compile([{ build: fx.build, files: fx.buffers() }, { build: fx.older, files: fx.buffers(old, fx.npcs(fx.older)) }]);
  const edge = (a, b) => p.edges.find((e) => e.from === a && e.to === b);
  assert.equal(edge(1, 2).cost, 100); assert.equal(edge(1, 2).seconds, 100); assert.equal(edge(1, 2).samples, 4);
  assert.equal(edge(2, 1).cost, 100, "the older build supplies the full price the newest lacked");
  assert.equal(edge(3, 1), undefined, "a flight without a hop list is not a connection unless its reverse is one");
  assert.equal(p.counts.routesWithoutHops, 2);
  assert.deepEqual(p.builds, [fx.build, fx.older]);
  assert.equal(p.flightSpeed > 1, true);
});

test("the validator refuses tampered packs", () => {
  const good = () => structuredClone(compile());
  assert.doesNotThrow(() => T.validateTransportPack(good()));
  const bad = [
    (p) => { p.attribution = "x"; }, (p) => { p.nodes[0].side = "Neutral"; }, (p) => { p.edges[0].seconds = -1; }, (p) => { p.edges.push({ ...p.edges[0] }); },
    (p) => { p.routes[0].hops = [1, 4, 3]; }, (p) => { p.counts.edges++; }, (p) => { p.maps["1413"].x1 = p.maps["1413"].x0; }, (p) => { p.nodes[0].wx = null; }, (p) => { p.build = "1.60.2.100"; },
  ];
  for (const change of bad) { const p = good(); change(p); assert.throws(() => T.validateTransportPack(p), /Invalid transport data/); }
  assert.throws(() => T.compileTransport([{ build: fx.build, files: fx.buffers(fx.flights(fx.older)) }], { commit: fx.commit }), /Source metadata/);
});

test("the bundled pack matches its lock, its notice and its licence, and says what it does not have", () => {
  const tool = require("../scripts/build-forever-transport.cjs");
  const pack = tool.checkBundle(), lock = tool.readLock();
  inv.assertNewestFirst(pack.builds, 1);
  assert.match(lock.commit, inv.COMMIT); assert.match(lock.compiled.sha256, inv.SHA256);
  for (const b of lock.builds) for (const f of Object.values(b.files)) { assert.match(f.sha256, inv.SHA256); assert.ok(f.url.includes(`/${lock.commit}/data/wowf/${b.build}/`)); }
  assert.equal(T.loadTransportPack(), T.loadTransportPack());
  assert.deepEqual(T.loadTransportPack(), pack);
  assert.ok(fs.statSync(path.join(__dirname, "../data/forever-transport/pack.json")).size <= T.PACK_LIMIT);
  // Both factions are covered, and nothing was invented for what upstream lacks.
  for (const side of ["Alliance", "Horde"]) assert.ok(pack.nodes.filter((n) => n.side === side && n.sideFrom === "master").length >= 8, side);
  assert.ok(pack.counts.timedEdges < pack.counts.edges, "untimed connections stay untimed");
  for (const e of pack.edges) assert.equal(e.seconds === null, e.samples === 0);
  const notice = fs.readFileSync(path.join(__dirname, "../data/forever-transport/NOTICE"), "utf8");
  assert.match(notice, /Not in the upstream data: flight point names, boats, zeppelins/);
  assert.ok(notice.includes(lock.commit) && notice.includes(pack.attribution));
});

test("the pack tool locks, rebuilds and catches a changed source file", () => {
  const { packTool } = require("../scripts/forever-pack-tool.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-transport-")), src = path.join(tmp, "src"), dir = path.join(tmp, "pack");
  try {
    fs.mkdirSync(path.join(src, fx.build), { recursive: true }); fs.mkdirSync(dir);
    for (const [name, bytes] of Object.entries(fx.buffers())) fs.writeFileSync(path.join(src, fx.build, name), bytes);
    fs.copyFileSync(path.join(__dirname, "../data/forever-transport/LICENSE"), path.join(dir, "LICENSE"));
    const tool = packTool({ name: "Test transport", dir, files: T.FILES, rawLimits: T.RAW_LIMITS, packLimit: T.PACK_LIMIT, compile: T.compileTransport, validate: T.validateTransportPack, notice: (p, l) => `${p.attribution}\n${l.commit}\n`, summary: () => "ok" });
    const lock = tool.relock(src, fx.commit), built = tool.compile(src, lock);
    for (const [name, key] of [["pack.json", "pack"], ["source-lock.json", "lock"], ["NOTICE", "notice"]]) fs.writeFileSync(path.join(dir, name), built[key]);
    assert.equal(tool.checkBundle().counts.nodes, 5);
    assert.equal(tool.compile(src).pack, built.pack, "the same locked bytes give the same pack");
    fs.writeFileSync(path.join(dir, "pack.json"), built.pack.replace('"seconds":100', '"seconds":101'));
    assert.throws(() => tool.checkBundle(), /checksum mismatch/);
    const changed = fx.flights(); changed.routes["1>2"].costs["5"] = 101;
    fs.writeFileSync(path.join(src, fx.build, "flights.json"), JSON.stringify(changed));
    assert.throws(() => tool.compile(src), /Source (size|hash) mismatch/);
    assert.throws(() => tool.checkLock({ ...lock, builds: [...lock.builds, { ...lock.builds[0], build: "1.60.1.200" }] }), /Invalid Test transport source lock/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
