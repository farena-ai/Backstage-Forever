"use strict";
// Guided route hand review (0.51, roadmap 4.1 part 2).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const G = require("../src/core/guided-route.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const route = { key: "Orc", steps: ["a", "b", "c", "d"].map((id) => ({ id, kind: "pickup", text: id, level: 1 })) };
const ids = (r) => r.steps.map((s) => s.id).join("");

test("review: skips drop out (or stay marked for the review page), approvals are marked, moves apply in order", () => {
  assert.equal(ids(G.applyReview(route, { skip: ["b"] })), "acd");
  const kept = G.applyReview(route, { skip: ["b"], approved: ["c"] }, { keepSkipped: true });
  assert.equal(ids(kept), "abcd"); assert.equal(kept.steps[1].skipped, true); assert.equal(kept.steps[2].approved, true);
  assert.equal(kept.reviewed, 1); assert.equal(kept.skipped, 1);
  assert.equal(ids(G.applyReview(route, { moves: [["d", null]] })), "dabc", "null: to the start");
  assert.equal(ids(G.applyReview(route, { moves: [["a", "c"], ["d", "a"]] })), "bcad");
  assert.equal(ids(G.applyReview(route, { moves: [["x", "a"], ["a", "nope"]] })), "abcd", "unknown steps change nothing");
});

test("review actions: approve, skip, undo, up and down build a local review that merges over the bundled one", () => {
  let local = null;
  local = G.reviewAction(local, "Orc", "b", "approve", route);
  local = G.reviewAction(local, "Orc", "c", "skip", route);
  local = G.reviewAction(local, "Orc", "c", "approve", route);
  assert.deepEqual(local.routes.Orc.approved, ["b", "c"]); assert.deepEqual(local.routes.Orc.skip, [], "approving undoes a skip");
  local = G.reviewAction(local, "Orc", "d", "up", route);
  assert.deepEqual(local.routes.Orc.moves.at(-1), ["d", "b"], "up: after the step two above");
  local = G.reviewAction(local, "Orc", "b", "up", route);
  assert.deepEqual(local.routes.Orc.moves.at(-1), ["b", null]);
  local = G.reviewAction(local, "Orc", "a", "down", route);
  assert.deepEqual(local.routes.Orc.moves.at(-1), ["a", "b"]);
  assert.throws(() => G.reviewAction(local, "Orc", "a", "explode", route));
  const bundled = { version: 1, note: "n", routes: { Orc: { skip: ["a"], approved: ["d"] }, Troll: { skip: ["x"] } } };
  local = G.reviewAction(local, "Orc", "a", "clear", route);
  const merged = G.mergeReviews(bundled, local);
  assert.deepEqual(merged.routes.Orc.skip, [], "undo on this computer wins over the bundled skip");
  assert.deepEqual(merged.routes.Orc.approved.sort(), ["b", "c", "d"]);
  assert.deepEqual(merged.routes.Troll.skip, ["x"]);
  const exported = G.exportReview(bundled, local);
  assert.equal(exported.version, 1); assert.equal(exported.note, "n");
  assert.ok(!("unskip" in exported.routes.Orc) && !("unapprove" in exported.routes.Orc), "local undo lists stay local");
  assert.equal(ids(G.applyReview(route, exported.routes.Orc)), ids(G.applyReview(route, merged.routes.Orc)), "the export builds the same route");
});

test("main keeps edits on this computer, checks every action, exports the merged review and clears it on reset", () => {
  const main = read("src/main.cjs");
  for (const h of ["routeReview", "setRouteReview", "exportRouteReview"]) assert.match(main, new RegExp(`handle\\("${h}"`));
  assert.match(main, /route-review\.json/);
  assert.match(main, /\["approve", "skip", "clear", "up", "down"\]\.includes\(input\.action\)/);
  assert.match(main, /if \(!current\.steps\.some\(\(s\) => s\.id === input\.id\)\) throw Error\("Unknown step\."\);/);
  assert.match(main, /fs\.rmSync\(path\.join\(app\.getPath\("userData"\), "route-review\.json"\), \{ force: true \}\)/);
  const preload = read("src/preload.cjs");
  for (const k of ["routeReview: (input) =>", "setRouteReview: (input) =>", "exportRouteReview: () =>"]) assert.ok(preload.includes(k), k);
});

test("the review panel lists steps with keep, leave out, move and undo, and sends each action", async () => {
  const calls = [];
  const view = { race: "Orc", races: ["Human", "Orc"], page: 0, pages: 2, total: 50, approved: 1, skipped: 1, edits: true,
    steps: [{ n: 1, id: "pickup:1", kind: "pickup", text: "Pick up <b>", level: 1, mapName: "Durotar", mapId: 1411, x: 0.5, y: 0.5, approved: true, skipped: false }, { n: 2, id: "turnin:1", kind: "turnin", text: "Hand in", level: 1, approved: false, skipped: true }] };
  const listeners = {};
  const body = { contains: () => false, innerHTML: "" };
  const root = { isConnected: true, addEventListener: (k, f) => { listeners[k] = f; }, querySelector: () => body };
  const slot = { innerHTML: "" };
  const ctx = {
    setTimeout, clearTimeout,
    window: { backstage: { guidedRoute: async () => null, routeReview: async (i) => { calls.push(["read", i]); return view; }, setRouteReview: async (i) => { calls.push(["set", i]); return true; }, exportRouteReview: async () => true } },
    profile: () => null, characterSelectionPending: () => false, PageHero: { render: () => "" }, document: { querySelector: (q) => (q === "[data-guided-route]" ? root : q === "[data-gr-review-slot]" ? slot : null) },
  };
  vm.createContext(ctx); vm.runInContext(read("src/renderer/guided-route.js"), ctx);
  const V = ctx.window.GuidedRouteView;
  assert.match(V.page(), /Start reviewing/);
  V.mounted();
  const click = (attrs) => listeners.click({ target: { closest: (q) => { const k = q.slice(1, -1); return attrs[k] !== undefined ? { dataset: attrs.dataset } : null; } } });
  await click({ "data-gr-review": 1, dataset: { grReview: "open" } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["read", { race: "Human", page: 0 }]);
  assert.match(slot.innerHTML, /Pick up &lt;b&gt;/); assert.match(slot.innerHTML, /✓ kept/); assert.match(slot.innerHTML, /✗ left out/);
  assert.match(slot.innerHTML, /data-gr-act="up"/); assert.match(slot.innerHTML, /data-gr-act="clear"/); assert.match(slot.innerHTML, /page 1 of 2/);
  await listeners.click({ target: { closest: (q) => (q === "[data-gr-act]" ? { dataset: { grAct: "skip" } } : q === "[data-gr-id]" ? { dataset: { grId: "pickup:1" } } : null) } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find((c) => c[0] === "set")[1])), { race: "Orc", id: "pickup:1", action: "skip" });
  await click({ "data-gr-review": 1, dataset: { grReview: "export" } });
  assert.match(slot.innerHTML, /Review exported/);
});
