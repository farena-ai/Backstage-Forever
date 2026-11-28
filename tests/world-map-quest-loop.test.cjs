const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: { backstage: {}, addEventListener() {} } };
vm.runInNewContext(fs.readFileSync(require.resolve("../src/renderer/world-map.js"), "utf8"), context);
const map = context.window.WorldMapView;

test("map goal evidence distinguishes a verified hand-in from a likely giver and a missing location", () => {
  assert.match(map._goalEvidence("verified-turn-in"), /Verified turn-in/);
  assert.match(map._goalEvidence("likely-quest-giver"), /Likely quest giver.*Check.*quest log/s);
  assert.match(map._goalEvidence("missing-location"), /Location missing/);
  assert.equal(map._goalEvidence("<script>"), "");
});

test("quest loop map panel exposes numbered stops with explicit current and completed states", () => {
  const html = map._questLoopMarkup({ currentIndex: 1, stops: [
    { title: "A < B", done: true },
    { title: "Second stop", evidence: "recorded-objective" },
    { title: "Third stop", evidence: "verified-turn-in" },
  ] });
  assert.match(html, /Nearby quest loop/);
  assert.match(html, /data-wm-quest-stop="0"[^>]*>.*A &lt; B.*Completed/s);
  assert.match(html, /data-wm-quest-stop="1"[^>]*aria-current="step"[^>]*>.*Second stop.*Next stop/s);
  assert.match(html, /data-wm-quest-stop="2"[^>]*>.*Third stop/s);
  assert.doesNotMatch(html, /<script>|href=/);
});
