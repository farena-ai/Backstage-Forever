"use strict";
// Shared structural checks for the bundled data packs. The packs are re-pinned to a newer
// upstream snapshot regularly, so tests compare a pack with its own source lock and the
// *-sources.cjs constants instead of pinning the commit, build list, sizes or counts.
const assert = require("node:assert/strict");

const BUILD = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,8})$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// Builds are unique, well formed and listed newest first; returns the list for chaining.
function assertNewestFirst(builds, min = 4) {
  assert.ok(Array.isArray(builds) && builds.length >= min, `at least ${min} merged builds, got ${builds?.length}`);
  for (const b of builds) assert.match(b, BUILD);
  const n = builds.map((b) => Number(BUILD.exec(b)[2]));
  for (let i = 1; i < n.length; i++) assert.ok(n[i - 1] > n[i], `builds newest first: ${builds.join(", ")}`);
  return builds;
}

// A build of another PATCH: bundled data is refused there (same-patch builds carry, see build-compat.cjs).
function otherPatch(build) {
  const [a, b, c, n] = build.split(".");
  return `${a}.${b}.${Number(c) + 1}.${n}`;
}

module.exports = { BUILD, COMMIT, SHA256, assertNewestFirst, otherPatch };
