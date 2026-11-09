"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../src/core/store.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { applyJourneyAction } = require("../src/core/journeys.cjs");
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (x) => Buffer.from(x),
  decryptString: (x) => x.toString(),
};
const baseline = "2026-01-03T00:00:00.000Z",
  later = "2026-01-04T00:00:00.000Z";
function fixture(t) {
  const temp = fs.realpathSync(os.tmpdir()),
    dir = fs.realpathSync(fs.mkdtempSync(path.join(temp, "bf-journeys-")));
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved), temp);
    assert.ok(path.basename(resolved).startsWith("bf-journeys-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { dir, store: new Store(dir, safe) };
}
function tracking() {
  let state = validateState({
    ...defaultState(),
    profiles: [
      {
        id: "p",
        name: "Synthetic",
        realm: "Fixture",
        className: "Mage",
        level: 10,
        notes: "private journal",
        goals: [{ id: "g", text: "Keep", done: false }],
        clientBuild: "1.15.8.64000",
        source: {
          kind: "wow-addon",
          id: "fixture-identity",
          updatedAt: baseline,
        },
        quests: [
          { id: 1061, title: "Saved quest", complete: false, objectives: [] },
        ],
        history: { recent: [], completedIdsKnown: true, completedIds: [] },
      },
    ],
  });
  let n = 0;
  state = applyJourneyAction(
    state,
    { type: "create", title: "Plan" },
    { id: () => `id${++n}` },
  );
  return applyJourneyAction(
    state,
    { type: "add-quest", journeyId: "id1", profileId: "p", questId: 1061 },
    { id: () => "step" },
  );
}
function completed(state) {
  const next = structuredClone(state);
  next.profiles[0].source.updatedAt = later;
  next.profiles[0].quests = [];
  next.profiles[0].history.completedIds = [1061];
  return next;
}

test("Store reconciles load and save, persisting proof across stale inputs and pruned history", (t) => {
  const { store, dir } = fixture(t),
    start = tracking();
  store.saveState(start);
  const proof = store.saveState(completed(start));
  assert.deepEqual(proof.journeys[0].steps[0].observed, {
    at: later,
    via: "completed-id",
  });
  const stale = completed(start);
  delete stale.profiles[0].history;
  const saved = store.saveState(stale);
  assert.deepEqual(saved.journeys, proof.journeys);
  assert.deepEqual(new Store(dir, safe).state.journeys, proof.journeys);
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify(completed(start)),
  );
  assert.deepEqual(new Store(dir, safe).state.journeys, proof.journeys);
});

test("Store exports private journeys but no credentials; invalid imports preserve all state and keys", (t) => {
  const { store } = fixture(t);
  store.saveState(tracking());
  store.saveKey("openai", "synthetic-secret");
  const before = structuredClone(store.state),
    exported = store.exportData();
  assert.deepEqual(JSON.parse(exported).journeys, before.journeys);
  assert.equal(exported.includes("synthetic-secret"), false);
  const malformed = { ...before, journeys: [{ id: "broken" }] };
  assert.throws(() => store.importData(JSON.stringify(malformed)));
  assert.deepEqual(store.state, before);
  assert.equal(store.getKey("openai"), "synthetic-secret");
  const restored = store.importData(exported);
  assert.equal(restored.profiles[0].notes, "private journal");
  assert.equal(restored.profiles[0].goals[0].text, "Keep");
  assert.equal(store.getKey("openai"), "synthetic-secret");
});

test("deliberate imports replace proof, old backups normalize empty plans, and reset clears plans and keys", (t) => {
  const { store } = fixture(t),
    start = tracking();
  store.saveKey("openai", "synthetic-secret");
  store.saveState(completed(start));
  const restored = store.importData(JSON.stringify(start));
  assert.equal(restored.journeys[0].steps[0].observed, undefined);
  const legacy = { ...defaultState() };
  delete legacy.journeys;
  assert.deepEqual(store.importData(JSON.stringify(legacy)).journeys, []);
  assert.equal(store.getKey("openai"), "synthetic-secret");
  store.saveState(start);
  assert.deepEqual(store.reset().journeys, []);
  assert.equal(store.getKey("openai"), "");
});

test("proof carry-forward requires exact tracking metadata and preserves orphan plans", (t) => {
  const { store } = fixture(t),
    start = tracking();
  const proof = store.saveState(completed(start));
  const orphan = { ...proof, profiles: [], activeProfileId: null };
  assert.deepEqual(store.saveState(orphan).journeys, proof.journeys);
  const manual = structuredClone(start);
  delete manual.journeys[0].steps[0].quest;
  manual.journeys[0].steps[0].profileId = null;
  assert.equal(
    store.saveState(manual).journeys[0].steps[0].observed,
    undefined,
  );
  store.saveState(proof);
  const changed = structuredClone(start);
  changed.journeys[0].steps[0].quest.sourceHash = "f".repeat(64);
  assert.equal(
    store.saveState(changed).journeys[0].steps[0].observed,
    undefined,
  );
});

test("ordinary writes cannot rewrite an already latched observation on identical tracking", (t) => {
  const { store } = fixture(t),
    start = tracking(),
    proof = store.saveState(completed(start));
  const stale = structuredClone(proof);
  stale.journeys[0].steps[0].observed.at = "2026-01-03T12:00:00.000Z";
  assert.deepEqual(store.saveState(stale).journeys, proof.journeys);
});

test(
  "Store round trip uses a genuine Windows 8.3 directory alias",
  { skip: process.platform !== "win32", timeout: 20000 },
  (t) => {
    const { dir } = fixture(t);
    const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfJourneyShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfJourneyShortPath]::GetShortPathName($env:BF_JOURNEY_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
    const alias = require("node:child_process")
      .execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          env: { ...process.env, BF_JOURNEY_ALIAS_PATH: dir },
          encoding: "utf8",
          timeout: 15000,
        },
      )
      .trim();
    if (alias.toLowerCase() === dir.toLowerCase())
      return t.skip("This volume does not create 8.3 aliases.");
    assert.match(alias, /~\d/);
    assert.equal(fs.statSync(alias).ino, fs.statSync(dir).ino);
    const store = new Store(alias, safe),
      start = tracking();
    store.saveState(start);
    store.saveKey("openai", "fixture-secret");
    const done = store.saveState(completed(start));
    assert.equal(done.journeys[0].steps[0].observed.via, "completed-id");
    assert.deepEqual(new Store(dir, safe).state, done);
    assert.deepEqual(store.importData(store.exportData()), done);
    assert.deepEqual(store.reset().journeys, []);
    assert.equal(new Store(dir, safe).getKey("openai"), "");
  },
);
