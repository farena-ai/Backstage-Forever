"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture() {
  let closed = 0;
  const context = vm.createContext({
    window: {},
    Voice: {
      close: () => {
        closed++;
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      require.resolve("../src/renderer/player-navigation.js"),
      "utf8",
    ),
    context,
  );
  return { nav: context.window.PlayerNavigation, closed: () => closed };
}
test("legacy deep links resolve to their visible player group and readable page", () => {
  const { nav } = fixture();
  for (const [route, group, label] of [
    ["party", "company", "Party"],
    ["preparation", "company", "Preparation"],
    ["connections", "game", "AI connection"],
    ["updates", "game", "Updates"],
    ["guide", "guide", "Field guide"],
  ]) {
    assert.equal(nav.group(route), group);
    assert.equal(nav.current(route).pageLabel, label);
  }
});
test("a paint between native disclosure closure and its queued toggle still retires voice", () => {
  const f = fixture(),
    panel = { dataset: { playerTool: "voice" }, open: true };
  const root = { querySelectorAll: () => [panel], querySelector: () => panel };
  f.nav.remember(root);
  panel.open = false;
  f.nav.remember(root);
  assert.equal(f.closed(), 1);
  assert.doesNotMatch(f.nav.disclosure("voice", "Voice", "content"), / open/);
  f.nav.remember(root);
  assert.equal(
    f.closed(),
    1,
    "Unchanged closed paints do not repeatedly cancel audio",
  );
});
test("removed disclosure toggle cannot cancel a replacement voice owner", () => {
  const f = fixture();
  let toggle;
  const panel = {
    dataset: { playerTool: "voice" },
    open: false,
    isConnected: false,
    addEventListener: (_name, listener) => (toggle = listener),
  };
  f.nav.mounted({ querySelectorAll: () => [panel] });
  toggle();
  assert.equal(f.closed(), 0);
});
