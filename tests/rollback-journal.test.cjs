"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const { Store, StoreStartupError } = require("../src/core/store.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { badgesFor } = require("../src/core/badges.cjs");

const LEGACY = "profession-alchemy-150";
const NEW = ["dungeon-first-victory", "quest-chain-defias-westfall", "rep-stormwind-revered"];
const RELEASE = "e498f8276210c8bce18c2fd3d9ec7406f1f244bb"; // v1.8.0
const root = path.resolve(__dirname, "..");
const at = "2023-11-14T22:13:20.000Z";
const snapshot = (updatedAt, journal) => ({ activeId: "example", observedAt: updatedAt, characters: [
  { id: "example", name: "Synthetic", realm: "Fixture", className: "Mage", level: 20, updatedAt, journal },
] });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || os.tmpdir()), "bf-rollback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  // Use realistic persisted latches after their original evidence has aged out.
  const state = mergeSnapshot(defaultState(), snapshot(at, { zones: [42] }));
  state.profiles[0].badgeAwards = [LEGACY, ...NEW];
  store.saveState(state);
  return { dir, store };
}
function assertAwards(state) {
  assert.deepEqual(new Set(state.profiles[0].badgeAwards), new Set([LEGACY, ...NEW]));
  const book = badgesFor(state.profiles[0], { desktop: true });
  for (const id of NEW) assert.equal(book.badges.find(b => b.id === id).earned, true, id);
}

test("candidate keeps schema-1 journal and recovery payloads compatible without dropping earned badges", t => {
  const { dir, store } = fixture(t);
  const onDisk = JSON.parse(fs.readFileSync(store.file, "utf8"));
  assert.equal(onDisk.schemaVersion, 1);
  assert.deepEqual(onDisk.profiles[0].badgeAwards, [LEGACY]);
  assert.deepEqual(onDisk.profiles[0].journal.zones, [42]);
  assertAwards(new Store(dir).state);

  const point = store.recovery.create(store.state, "manual");
  const envelope = JSON.parse(fs.readFileSync(path.join(dir, "recovery", point.id + ".json"), "utf8"));
  assert.deepEqual(envelope.payload.profiles[0].badgeAwards, [LEGACY]);
  assertAwards(store.recovery.read(point.id, point.sha256).state);
  assertAwards(store.importData(store.exportData()));
  assertAwards(store.restoreCheckpoint(point.id, point.sha256));

  // Exercise the Store-bypassing damaged-startup restore writer too.
  fs.writeFileSync(store.file, "damaged journal");
  store.recovery.restoreDamaged(store.recovery.prepareStartupRestore(point.id));
  assertAwards(new Store(dir).state);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file, "utf8")).profiles[0].badgeAwards, [LEGACY]);
});

function releaseStore(t, dir) {
  const git = spawnSync("git", ["cat-file", "-t", RELEASE], { cwd: root, encoding: "utf8" });
  if (git.stdout?.trim() !== "commit") {
    t.skip("v1.8.0 Git object unavailable (shallow or source-only checkout)");
    return;
  }
  const archive = path.join(dir, "v1.8.0.tar");
  execFileSync("git", ["archive", "--format=tar", "-o", archive, RELEASE, "src/core"], { cwd: root });
  execFileSync("tar", ["-xf", path.basename(archive)], { cwd: dir });
  return require(path.join(dir, "src", "core", "store.cjs")).Store;
}

test("the real v1.8.0 Store can open, save, and checkpoint a candidate journal", t => {
  const { dir, store } = fixture(t);
  const OldStore = releaseStore(t, dir);
  if (!OldStore) return;
  const point = store.recovery.create(store.state, "manual");
  const older = new OldStore(dir);
  assert.deepEqual(older.state.profiles[0].badgeAwards, [LEGACY]);
  assert.deepEqual(older.state.profiles[0].journal.zones, [42]);
  assert.equal(older.recovery.read(point.id, point.sha256).state.profiles[0].name, "Synthetic");
  older.importData(store.exportData());
  older.state.profiles[0].notes = "Saved on 1.8.0";
  older.saveState(older.state);
  older.recovery.create(older.state, "manual");
  const candidate = new Store(dir);
  assert.equal(candidate.state.profiles[0].notes, "Saved on 1.8.0");
  assertAwards(candidate.state);
});

test("startup makes a preview journal readable by v1.8.0 without an ordinary save", t => {
  const { dir, store } = fixture(t);
  const OldStore = releaseStore(t, dir);
  if (!OldStore) return;
  const preview = structuredClone(store.state);
  preview.profiles[0].notes = "Keep preview notes";
  fs.writeFileSync(store.file, JSON.stringify(preview));
  assert.throws(() => new OldStore(dir), { kind: "journal" });

  const candidate = new Store(dir);
  assertAwards(candidate.state);
  assert.deepEqual(candidate.state, preview);
  const backup = candidate.exportData();
  const older = new OldStore(dir);
  assert.deepEqual(older.state.profiles[0].badgeAwards, [LEGACY]);
  assert.equal(older.state.profiles[0].notes, "Keep preview notes");
  assert.deepEqual(older.state.profiles[0].journal.zones, [42]);
  assert.deepEqual(new Store(dir).state, preview);
  assert.deepEqual(candidate.validateBackup(backup), preview);
});

test("startup migrates new-only inline awards even when the preview has no game journal", t => {
  const { dir, store } = fixture(t);
  const preview = structuredClone(store.state);
  preview.profiles[0].badgeAwards = [...NEW];
  delete preview.profiles[0].journal;
  fs.writeFileSync(store.file, JSON.stringify(preview));

  const reopened = new Store(dir);
  assert.deepEqual(reopened.state, preview);
  const onDisk = JSON.parse(fs.readFileSync(store.file, "utf8"));
  assert.equal(Object.hasOwn(onDisk.profiles[0], "badgeAwards"), false);
  assert.deepEqual(new Store(dir).state, preview);
});

test("startup leaves already compatible files byte-for-byte unchanged", t => {
  const { dir, store } = fixture(t);
  const encoded = JSON.parse(fs.readFileSync(store.file, "utf8"));
  const professionOnly = structuredClone(encoded);
  delete professionOnly.profiles[0].journal.desktopBadgeAwards;
  for (const wire of [professionOnly, encoded]) {
    const original = `\n${JSON.stringify(wire)}\n`;
    fs.writeFileSync(store.file, original);
    new Store(dir);
    assert.equal(fs.readFileSync(store.file, "utf8"), original);
  }
});

test("startup leaves preview bytes untouched when journal or credential validation fails", t => {
  const { dir, store } = fixture(t);
  const preview = structuredClone(store.state);
  const invalid = structuredClone(preview);
  invalid.profiles[0].level = -1;
  const invalidBytes = JSON.stringify(invalid);
  fs.writeFileSync(store.file, invalidBytes);
  assert.throws(() => new Store(dir), { kind: "journal" });
  assert.equal(fs.readFileSync(store.file, "utf8"), invalidBytes);

  const previewBytes = JSON.stringify(preview);
  fs.writeFileSync(store.file, previewBytes);
  fs.writeFileSync(store.keyFile, "invalid credentials");
  assert.throws(() => new Store(dir), { kind: "credentials" });
  assert.equal(fs.readFileSync(store.file, "utf8"), previewBytes);
  assert.equal(fs.readFileSync(store.keyFile, "utf8"), "invalid credentials");
});

test("a failed startup migration preserves the original and is not classified as journal damage", t => {
  const { dir, store } = fixture(t);
  const original = JSON.stringify(store.state);
  fs.writeFileSync(store.file, original);
  const rename = t.mock.method(fs, "renameSync", () => { throw new Error("write blocked"); });
  assert.throws(() => new Store(dir), error => error instanceof StoreStartupError && error.kind === "migration");
  assert.equal(rename.mock.callCount(), 1);
  assert.equal(fs.readFileSync(store.file, "utf8"), original);
  assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
});

test("desktop award persistence refuses malformed data and is not a snapshot input", t => {
  const { dir, store } = fixture(t);
  const initial = JSON.parse(store.exportData());
  const original = fs.readFileSync(store.file);
  for (const invalid of [ ["unknown"], [NEW[0], NEW[0]], [LEGACY], "not an array" ]) {
    const wire = structuredClone(initial);
    wire.profiles[0].journal.desktopBadgeAwards = invalid;
    assert.throws(() => store.importData(JSON.stringify(wire)));
  }
  delete initial.profiles[0].badgeAwards;
  delete initial.profiles[0].source;
  assert.throws(() => store.importData(JSON.stringify(initial)));
  assert.deepEqual(fs.readFileSync(store.file), original);
  assert.throws(() => mergeSnapshot(defaultState(), snapshot(at, { desktopBadgeAwards: NEW })));
  assert.throws(() => validateState({ ...store.state, profiles: [{ ...store.state.profiles[0], badgeAwards: ["unknown"] }] }));
  assertAwards(new Store(dir).state);
});
