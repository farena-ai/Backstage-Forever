"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { registerSupplyDesk } = require("../src/core/supply-desk-ipc.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.BF_SMOKE_TMPDIR || os.tmpdir(), "bf-supply-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  function open() {
    let invoke;
    const desk = registerSupplyDesk({ dataDir: dir, handle(name, handler, options) {
      assert.equal(name, "supplyDesk");
      assert.deepEqual(options, { privateOnly: true });
      invoke = handler;
    } });
    const read = () => invoke("read");
    const change = (edit, { token, revision } = read()) => invoke("change", { token, revision, edit });
    return { ...desk, invoke, read, change };
  }
  return { dir, open, ...open() };
}
const request = { type: "request", item: "Runecloth", quantity: 20 };

test("a manual request lives only in the current app session without changing the journal", t => {
  const f = fixture(t), journal = path.join(f.dir, "state.json");
  fs.writeFileSync(journal, "private fixture bytes");
  const start = f.read();
  assert.deepEqual(start.requests, []);
  const saved = f.change(request, start);
  assert.equal(saved.requests[0].item, "Runecloth");
  assert.equal(saved.requests[0].quantity, 20);
  assert.deepEqual(f.read().requests, saved.requests);
  assert.deepEqual(f.open().read().requests, []);
  assert.deepEqual(fs.readdirSync(f.dir), ["state.json"]);
  assert.equal(fs.readFileSync(journal, "utf8"), "private fixture bytes");
  assert.throws(() => f.change(request, start), /no longer current/);
  assert.throws(() => f.change({ ...request, bagCount: 200 }), /invalid/);
});


test("four states are distinct and a manual correction records both versions", t => {
  const f = fixture(t), { requests: [row] } = f.change(request);
  const pledge = { type: "commitment", requestId: row.id, volunteer: "Volunteer", quantity: 4, status: "pledged" };
  const original = f.change(pledge).commitments[0];
  f.change({ ...pledge, quantity: 6, status: "reserved" });
  f.change({ ...pledge, quantity: 3, status: "available" });
  const before = f.read();
  assert.deepEqual(before.requests[0].totals, { pledged: 4, reserved: 6, delivered: 0, available: 3 });
  assert.equal(before.requests[0].remaining, 20);
  assert.throws(() => f.change({ ...pledge, id: original.id, status: "delivered" }), /invalid/);
  const corrected = f.change({ ...pledge, id: original.id, status: "delivered", reason: "Handoff confirmed" });
  assert.deepEqual(corrected.requests[0].totals, { pledged: 0, reserved: 6, delivered: 4, available: 3 });
  assert.equal(corrected.requests[0].remaining, 16);
  assert.deepEqual(corrected.history.at(-1).before, original);
  assert.equal(corrected.history.at(-1).after.status, "delivered");
  assert.equal(corrected.history.at(-1).reason, "Handoff confirmed");
  assert.throws(() => f.change({ type: "request", id: row.id, remove: true, reason: "Withdrawn" }), /remove the request.s commitments/);
});

test("Workshop receives only request reference data, never directory, reasons, or edit credentials", t => {
  const f = fixture(t), { requests: [row] } = f.change(request);
  const { capabilities: [entry] } = f.change({ type: "capability", volunteer: "Local alias", offer: "Cloth bandages" });
  f.change({ type: "capability", id: entry.id, remove: true, reason: "Permission withdrawn" });
  const { item, quantity, totals, remaining } = row;
  assert.deepEqual(f.invoke("reference"), { requests: [{ item, quantity, totals, remaining }] });
  assert.deepEqual(f.read().capabilities, []);
  assert.equal(f.read().history.at(-1).before.offer, "Cloth bandages");
});

test("retired files are ignored and only owned files are removed on reset", t => {
  const f = fixture(t), file = path.join(f.dir, "supply-desk.json");
  fs.writeFileSync(file, "retired bytes");
  assert.deepEqual(f.read().requests, []);
  assert.deepEqual(f.invoke("reference"), { requests: [] });
  const start = f.read();
  f.change(request, start);
  assert.equal(fs.readFileSync(file, "utf8"), "retired bytes");
  const staged = `${file}.386487ad-f0a0-4c55-9408-f26338418a96.tmp`;
  fs.writeFileSync(staged, "staging");
  fs.writeFileSync(path.join(f.dir, "supply-desk.json.other.tmp"), "unrelated");
  f.reset();
  assert.deepEqual(fs.readdirSync(f.dir), ["supply-desk.json.other.tmp"]);
  assert.throws(() => f.change(request, { ...start, revision: 0 }), /no longer current/);
  assert.deepEqual(f.read().requests, []);
});
