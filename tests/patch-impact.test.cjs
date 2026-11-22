"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshot, reviewStatus } = require("../src/core/patch-impact.cjs");
const routeBuild = "1.60.1.70888", mageBuild = "1.60.1.70959", nextBuild = "1.60.2.71500", laterBuild = "1.60.1.71037";
const now = Date.parse("2026-11-20T12:00:00Z");
const saved = clientBuild => ({ clientBuild, source: { kind: "wow-addon", id: "private-source", updatedAt: "2026-11-20T11:00:00Z" }, name: "private-character" });
const statuses = (profile, build = routeBuild) => Object.fromEntries(snapshot(profile, build, now).rows.map(r => [r.id, r.status]));

test("only the scopes missing a review for the patch retire across a patch boundary", () => {
  const patch = build => statuses(saved(build), mageBuild);
  assert.deepEqual(patch(mageBuild), { "desktop-route": "reviewed", "frost-mage-guide": "reviewed", "frost-mage-abilities": "reviewed" });
  assert.deepEqual(patch(nextBuild), { "desktop-route": "needs-review", "frost-mage-guide": "needs-review", "frost-mage-abilities": "needs-review" });
  assert.deepEqual(statuses(saved(nextBuild), nextBuild), { "desktop-route": "reviewed", "frost-mage-guide": "needs-review", "frost-mage-abilities": "needs-review" });
  assert.deepEqual(statuses(saved(mageBuild), nextBuild), { "desktop-route": "needs-review", "frost-mage-guide": "reviewed", "frost-mage-abilities": "reviewed" }, "reviewing the route for a different build does not retire either Mage scope");
  assert.deepEqual(patch(mageBuild), { "desktop-route": "reviewed", "frost-mage-guide": "reviewed", "frost-mage-abilities": "reviewed" }, "returning to an explicitly reviewed save restores its scopes");
});

test("a review covers the other builds of its patch and says which build it came from", () => {
  assert.deepEqual(statuses(saved(laterBuild), routeBuild), { "desktop-route": "reviewed", "frost-mage-guide": "reviewed", "frost-mage-abilities": "reviewed" });
  const rows = snapshot(saved(laterBuild), routeBuild, now).rows;
  assert.deepEqual(rows.map(r => r.carriedFrom), [routeBuild, mageBuild, mageBuild]);
  assert.deepEqual(snapshot(saved(mageBuild), mageBuild, now).rows.map(r => r.carriedFrom), [null, null, null]);
  assert.deepEqual(snapshot(saved(nextBuild), routeBuild, now).rows.map(r => r.carriedFrom), [null, null, null]);
});

test("only a review for the patch restores a scope; malformed and unobserved builds cannot activate anything", () => {
  assert.equal(reviewStatus(nextBuild, [mageBuild]), "needs-review");
  assert.equal(reviewStatus(nextBuild, [mageBuild, nextBuild]), "reviewed");
  for (const profile of [null, saved(`${mageBuild}\n`), saved(70959), { ...saved(mageBuild), source: { kind: "manual" } }, { ...saved(mageBuild), source: { ...saved(mageBuild).source, updatedAt: "2026-11-21" } }]) {
    const result = snapshot(profile, routeBuild, now);
    assert.equal(result.savedBuild, null);
    assert.ok(result.rows.every(r => r.status === "unknown-build"));
  }
  assert.doesNotMatch(JSON.stringify(snapshot(saved(mageBuild), routeBuild, now)), /private/);
});
