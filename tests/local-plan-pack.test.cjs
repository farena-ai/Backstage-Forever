"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { registerLocalPlanPack } = require("../src/core/local-plan-pack.cjs");

const base = { format: "backstage-forever-plan-pack", version: 1, scope: "forever:deadmines:preparation", revision: 1, steps: ["check-supplies", "agree-meeting-point"] };
const wire = (patch = {}) => JSON.stringify({ ...base, ...patch }, null, 2) + "\n";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || os.tmpdir()), "bf-local-plan-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "local-plan-pack.json");
  const open = () => {
    let invoke;
    const controller = registerLocalPlanPack({ dataDir: dir, handle(name, fn, options) {
      assert.equal(name, "localPlanPack"); assert.equal(options.privateOnly, true); invoke = fn;
    } });
    return { invoke, ...controller };
  };
  return { dir, file, open };
}

test("review is read-only and authorizes exactly one promotion of the reviewed plan", t => {
  const { file, open } = fixture(t), { invoke } = open();
  const raw = wire(), review = invoke("preview", raw);
  assert.equal(review.active, null);
  assert.deepEqual(review.proposed, base);
  assert.equal(fs.existsSync(file), false);
  assert.throws(() => invoke("apply", review.token, wire({ revision: 2 })), /invalid/i);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(invoke("apply", review.token).active, base);
  assert.equal(JSON.parse(fs.readFileSync(file)).active, raw);
  assert.throws(() => invoke("apply", review.token), /no longer current/i);
});

function install(invoke, raw) { return invoke("apply", invoke("preview", raw).token); }

test("invalid imports leave active and rollback bytes untouched", t => {
  const { file, open } = fixture(t), { invoke } = open();
  install(invoke, wire());
  install(invoke, wire({ revision: 2 }));
  const bytes = fs.readFileSync(file);
  for (const [raw, reason] of [
    [wire({ revision: 3, version: 2 }), /not supported/i],
    [wire({ revision: 3, scope: "forever:ragefire:preparation" }), /only WoW Forever/i],
    [wire({ revision: 3 }) + " ".repeat(4096), /4 KiB/],
    [wire({ revision: 3, steps: ["check-supplies", "check-supplies"] }), /invalid/i],
    [wire({ revision: 3, steps: ["unreviewed-step"] }), /invalid/i],
    [wire({ revision: 3, script: "not a step" }), /invalid/i],
    [wire({ revision: 3 }).replace('"revision": 3', '"revision": 2, "revisi\\u006fn": 3'), /invalid/i],
    [wire({ revision: 3 }).slice(0, -3), /invalid/i],
    [wire({ revision: 2, steps: ["repair-gear"] }), /newer/i],
  ]) {
    assert.throws(() => invoke("preview", raw), reason);
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
});

test("rollback is explicitly reviewed after restart and restores exact previous bytes once", t => {
  const { file, open } = fixture(t), first = open().invoke;
  const raw = wire() + "\t\n";
  install(first, raw);
  install(first, wire({ revision: 2, steps: ["confirm-roles", "repair-gear"] }));
  const second = open().invoke, bytes = fs.readFileSync(file);
  assert.equal(second("status").previousRevision, 1);
  const review = second("previewRollback");
  assert.equal(review.active.revision, 2);
  assert.deepEqual(review.proposed, base);
  assert.deepEqual(fs.readFileSync(file), bytes);
  second("cancel");
  assert.throws(() => second("apply", review.token), /no longer current/i);
  assert.deepEqual(fs.readFileSync(file), bytes);
  second("apply", second("previewRollback").token);
  assert.equal(JSON.parse(fs.readFileSync(file)).active, raw);
  assert.equal(open().invoke("status").previousRevision, null);
  assert.throws(() => second("previewRollback"), /no previous/i);
});

test("failed atomic rename preserves both slots and removes only the stage", t => {
  const { dir, file, open } = fixture(t), { invoke } = open();
  install(invoke, wire());
  install(invoke, wire({ revision: 2 }));
  const bytes = fs.readFileSync(file), rename = fs.renameSync;
  try {
    fs.renameSync = (src, dest) => {
      assert.equal(dest, file); assert.equal(src, file + ".tmp");
      throw Error("synthetic rename failure");
    };
    assert.throws(() => install(invoke, wire({ revision: 3 })), /could not be updated/i);
    assert.throws(() => invoke("apply", invoke("previewRollback").token), /could not be updated/i);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(file)]);
});

test("a stale preview cannot overwrite a different committed generation", t => {
  const { file, open } = fixture(t), { invoke } = open();
  install(invoke, wire());
  const review = invoke("preview", wire({ revision: 2 }));
  install(open().invoke, wire({ revision: 3 }));
  const bytes = fs.readFileSync(file);
  assert.throws(() => invoke("apply", review.token), /no longer current/i);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("reset retires pending preview and removes owned files without touching the journal", t => {
  const { dir, file, open } = fixture(t), { invoke, reset } = open();
  const journal = path.join(dir, "state.json");
  fs.writeFileSync(journal, "journal sentinel");
  install(invoke, wire());
  const review = invoke("preview", wire({ revision: 2 }));
  fs.writeFileSync(file + ".tmp", "interrupted stage");
  reset();
  assert.throws(() => invoke("apply", review.token), /no longer current/i);
  assert.equal(open().invoke("status").active, null);
  assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  assert.equal(fs.readFileSync(journal, "utf8"), "journal sentinel");
});
