"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { FieldDispatchStore } = require("../src/core/field-dispatch-desktop.cjs");

const stable = version => ({ version, channel: "stable" });
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.BF_TEST_TMP || os.tmpdir(), "bf-dispatch-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { file: path.join(dir, "field-dispatch.json"), open: (version, flags = {}) => new FieldDispatchStore({ dir, running: stable(version), installed: true, ...options, ...flags }) };
}

test("an upgrade journals the exact interval before offering it and only acknowledges the presented ID", t => {
  const { open, file } = fixture(t);
  assert.equal(open("1.9.0", { freshInstall: true }).start(), "fresh");
  const upgrade = open("1.11.0");
  assert.equal(upgrade.start(), "upgrade");
  const pending = upgrade.offer();
  assert.deepEqual(pending.model.rangeVersions, ["1.10.0", "1.11.0"]);
  assert.deepEqual(pending.model.recapReleases.map(r => r.version), ["1.11.0", "1.10.0"]);
  assert.deepEqual(pending.model.releases.slice(0, 3).map(r => r.version), ["1.11.0", "1.10.0", "1.9.0"]);
  assert.equal(JSON.parse(fs.readFileSync(file)).pending.id, pending.id);
  assert.equal(upgrade.acknowledge(pending.id), false);
  assert.equal(upgrade.presented(pending.id), true);
  assert.equal(upgrade.offer(), null);
  assert.equal(upgrade.acknowledge("stable:1.10.0..1.11.0"), false);
  assert.equal(upgrade.acknowledge(pending.id), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).acknowledged.id, pending.id);
  assert.equal(open("1.11.0").start(), "same");
  assert.equal(open("1.11.0").offer(), null);
});

test("existing legacy, malformed, and source profiles never fabricate an upgrade", t => {
  const { open, file } = fixture(t);
  const source = open("1.11.0", { installed: false });
  assert.equal(source.manual().status, "current");
  assert.equal(source.start(), "source");
  assert.equal(fs.existsSync(file), false);
  assert.equal(open("1.11.0").start(), "unknown");
  fs.writeFileSync(file, "{broken");
  const malformed = open("1.11.0", { freshInstall: true });
  assert.equal(malformed.start(), "unknown");
  assert.equal(malformed.offer(), null);
});

test("a write failure leaves the old bytes intact and does not offer an unrecorded upgrade", t => {
  const { open, file } = fixture(t, { write(file, text) {
    if (JSON.parse(text).lastRun.version === "1.11.0") throw new Error("fixture write failure");
    fs.writeFileSync(file, text);
  } });
  open("1.9.0", { freshInstall: true }).start();
  const before = fs.readFileSync(file, "utf8");
  const upgrade = open("1.11.0");
  assert.equal(upgrade.start(), "unavailable");
  assert.equal(upgrade.offer(), null);
  assert.equal(upgrade.manual().toVersion, "1.11.0");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});
