"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { LiveBridge } = require("../src/core/live-bridge.cjs");
const { candidateRoots } = require("../src/core/game-discovery.cjs");

test("Mac discovery looks in system and user Applications", () => {
  assert.deepEqual(candidateRoots({ platform: "darwin", env: { HOME: "/Users/Fixture" } }), [
    "/Applications/World of Warcraft/_forever_",
    "/Users/Fixture/Applications/World of Warcraft/_forever_",
  ]);
});

test("Mac reports unsupported independently of saved preference and refuses capture without writing it", t => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bf-mac-pref-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pref = path.join(dir, "live-link.json");
  for (const bytes of [null, '{ "enabled": true }\n', '{ "enabled": false }\n']) {
    if (bytes !== null) fs.writeFileSync(pref, bytes);
    const bridge = new LiveBridge({ platform: "darwin", dataDir: dir, spawn: () => assert.fail("capture spawned") });
    assert.equal(bridge.status().signal, "unsupported", "before startup");
    assert.equal(bridge.enabled, false);
    bridge.start();
    for (const wanted of [true, false]) {
      assert.deepEqual(bridge.setEnabled(wanted), { enabled: false, signal: "unsupported", frame: null, strip: null, last: null });
      if (bytes === null) assert.equal(fs.existsSync(pref), false);
      else assert.equal(fs.readFileSync(pref, "utf8"), bytes);
    }
  }
});

test("live settings hide the toggle until support is known and remain saved-only on Mac", async () => {
  const settings = {}, change = {};
  const c = {
    window: { backstage: {
      liveLinkStatus: async () => ({ enabled: false, signal: "unsupported", frame: null }),
      onLiveLink() {}, setLiveLink() { assert.fail("unsupported control called IPC"); },
    } },
    document: {
      querySelectorAll: selector => selector === "[data-live-link-controls]" ? [settings] : [],
      addEventListener: (type, fn) => change[type] = fn,
    },
    setInterval() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/live-link.js"), "utf8"), c);
  const ui = c.window.LiveLink;
  assert.match(ui.markup(), /data-live-link-controls hidden/);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settings.hidden, true);
  assert.match(ui.text(), /Saved-only.*Screen Recording.*log out/i);
  change.change({ target: { id: "live-link-toggle", checked: true } });
});
