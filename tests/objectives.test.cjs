"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { Store } = require("../src/core/store.cjs");
const { mergeOrdinaryState } = require("../src/core/company-ipc.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const at = n => `2026-11-10T12:00:${String(n).padStart(2, "0")}.000Z`;
const toon = id => ({ id, name: id, realm: "Fixture", className: "Mage", level: 20, notes: "", goals: [], clientBuild: "1.15.2.12345", source: { kind: "wow-addon", id: `game-${id}`, updatedAt: at(5) }, history: { completedIdsKnown: true, completedIds: [], recent: [] } });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-objective-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, {});
  store.saveState({ ...defaultState(), profiles: [toon("alpha"), toon("beta")], activeProfileId: "alpha" });
  return store;
}
const pin = (questId = 123, expectedId = null) => ({ profileId: "alpha", expectedId, target: { kind: "quest", questId, title: `Quest ${questId}` } });
function update(store, id, fn) {
  const next = structuredClone(store.state);
  fn(next.profiles.find(p => p.id === id));
  store.saveState(next);
}
const profession = (p, rank, n) => { p.readiness = { workshop: { professions: { observedAt: at(n), complete: false, items: [{ skillLineId: 171, professionId: 171, name: "Alchemy", rank, maxRank: 150 }] } } }; };

function savedSnapshot(n, extras = {}, altExtras = {}) {
  const updatedAt = Date.parse(at(n)) / 1000;
  const record = (name, fields) => ({ id: `Player-fixture-${name}`, name, realm: "Fixture", className: "Mage", level: 20,
    clientBuild: "1.15.2.12345", updatedAt, history: { completedIdsKnown: true, completedIds: [], recent: [] }, ...fields });
  const raw = { schema: 1, activeId: "Player-fixture-alpha", observedAt: updatedAt,
    characters: [record("alpha", extras), record("beta", altExtras)] };
  return parseSavedVariables(`BackstageForeverExport = [=[${JSON.stringify(raw)}]=]`);
}

function importSaved(store, n, extras, altExtras) {
  store.saveState(mergeSnapshot(store.state, savedSnapshot(n, extras, altExtras)));
}

test("SavedVariables roster imports retain a pin and persist completion from a newer character save", t => {
  const store = fixture(t);
  store.saveState({ ...defaultState() });
  importSaved(store, 5);
  const profileId = store.state.activeProfileId;
  const { id } = store.changeObjective({ ...pin(), profileId }).objectives[0];
  const history = { completedIdsKnown: true, completedIds: [123], recent: [] };
  importSaved(store, 10, {}, { history });
  assert.equal(store.state.objectives[0].completion, undefined, "the alt cannot complete the pin");
  importSaved(store, 9, { history });
  assert.equal(store.state.objectives[0].completion, undefined, "an older export cannot prove completion");
  importSaved(store, 12, { history });
  importSaved(store, 15, { history: undefined });
  const [objective] = new Store(store.dir, {}).state.objectives;
  assert.equal(objective.id, id);
  assert.deepEqual(objective.completion, { at: at(12), via: "completed-id" });
});

function objectiveView(store) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/objectives.js"), "utf8"), { window });
  window.ObjectiveView.init(() => store.state);
  return window.ObjectiveView;
}

test("a quest back in the saved log can be pinned again but needs a newly dated turn-in", t => {
  const store = fixture(t), view = objectiveView(store);
  const action = pin();
  const quests = [{ id: 123, title: "Repeatable delivery", complete: true, objectives: [] }];
  const event = n => ({ id: 123, title: quests[0].title, completedAt: Date.parse(at(n)) / 1000 });
  const history = { completedIdsKnown: true, completedIds: [123], recent: [event(6)] };
  importSaved(store, 7, { history });
  action.profileId = store.state.activeProfileId;
  assert.equal(view.pin(action.target, action.profileId), "", "historical completion alone is not actionable");
  assert.throws(() => store.changeObjective(action), /already recorded/);
  importSaved(store, 8, { quests, history });
  assert.match(view.pin(action.target, action.profileId), /Pin quest objective/);
  store.changeObjective(action);
  importSaved(store, 10, { history });
  assert.equal(store.state.objectives[0].completion, undefined, "an old turn-in and an ID already present prove nothing new");
  importSaved(store, 12, { history: { ...history, recent: [event(11), event(6)] } });
  const [finished] = new Store(store.dir, {}).state.objectives;
  assert.deepEqual(finished.completion, { at: at(11), via: "turn-in" });
  importSaved(store, 14, { quests, history });
  assert.match(view.pin(action.target, action.profileId), /Replace pinned objective/);
  const [repeated] = store.changeObjective({ ...action, expectedId: finished.id }).objectives;
  assert.notEqual(repeated.id, finished.id);
  assert.equal(repeated.completion, undefined);
});

for (const kind of ["quest", "profession"]) {
  test(`unknown client builds cannot prove ${kind} objective completion`, t => {
    const store = fixture(t);
    update(store, "alpha", p => { delete p.clientBuild; profession(p, 75, 5); });
    const target = kind === "quest" ? pin().target : { kind, skillLineId: 171, targetRank: 76 };
    store.changeObjective({ ...pin(), target });
    update(store, "alpha", p => {
      p.source.updatedAt = at(10);
      p.history.completedIds = [123];
      p.history.recent = [{ id: 123, title: "Quest 123", completedAt: Date.parse(at(9)) / 1000 }];
      profession(p, 76, 10);
    });
    assert.equal(new Store(store.dir, {}).state.objectives[0].completion, undefined);
    assert.match(objectiveView(store).card(), /unverified.*build/i);
  });
}

test("one objective per character survives restart, stale ordinary edits and backup round-trip", t => {
  const store = fixture(t), old = structuredClone(store.state);
  const first = store.changeObjective(pin()).objectives[0];
  assert.throws(() => store.changeObjective(pin(456)), /changed/);
  const replacement = store.changeObjective(pin(456, first.id)).objectives[0];
  store.saveState({ ...old, activeProfileId: "beta" });
  assert.throws(() => store.changeObjective({ ...pin(), expectedId: replacement.id }), /character/);
  store.changeObjective({ ...pin(789), profileId: "beta" });
  const reopened = new Store(store.dir, {});
  assert.deepEqual(reopened.state.objectives.map(o => [o.profileId, o.questId]), [["alpha", 456], ["beta", 789]]);
  assert.deepEqual(validateState(JSON.parse(reopened.exportData())).objectives, reopened.state.objectives);
  reopened.changeObjective({ profileId: "beta", expectedId: reopened.state.objectives[1].id, target: null });
  assert.deepEqual(reopened.state.objectives, [replacement]);
  const next = structuredClone(reopened.state);
  next.profiles = next.profiles.filter(p => p.id !== "alpha");
  reopened.saveState(mergeOrdinaryState(reopened.state, next));
  assert.deepEqual(reopened.state.objectives, []);
});

test("quest completion needs new positive evidence from the pinned character and survives rotation", t => {
  const store = fixture(t);
  store.changeObjective(pin());
  const objective = () => store.state.objectives[0];
  update(store, "beta", p => { p.source.updatedAt = at(10); p.history.completedIds = [123]; });
  update(store, "alpha", p => { p.history.completedIds = [123]; });
  assert.equal(objective().completion, undefined, "same snapshot is not new evidence");
  update(store, "alpha", p => { p.source.updatedAt = at(10); delete p.history; });
  assert.equal(objective().completion, undefined, "missing log/history proves nothing");
  update(store, "alpha", p => { p.source.updatedAt = at(15); p.source.id = "different"; p.history = { completedIdsKnown: true, completedIds: [123], recent: [] }; });
  assert.equal(objective().completion, undefined);
  update(store, "alpha", p => { p.source.updatedAt = at(20); p.source.id = "game-alpha"; });
  assert.deepEqual(objective().completion, { at: at(20), via: "completed-id" });
  update(store, "alpha", p => { p.source.updatedAt = at(25); delete p.history; });
  assert.deepEqual(new Store(store.dir, {}).state.objectives[0].completion, { at: at(20), via: "completed-id" });
});

test("profession target uses the pinned skill line, a fresh collection, and a positive rank", t => {
  const store = fixture(t);
  const target = { profileId: "alpha", expectedId: null, target: { kind: "profession", skillLineId: 171, targetRank: 76 } };
  assert.throws(() => store.changeObjective(target), /profession/i);
  update(store, "alpha", p => profession(p, 75, 5));
  store.changeObjective(target);
  const objective = () => store.state.objectives[0];
  update(store, "alpha", p => { p.source.updatedAt = at(10); profession(p, 80, 5); });
  assert.equal(objective().completion, undefined);
  update(store, "alpha", p => { profession(p, 80, 10); p.readiness.workshop.professions.items[0].skillLineId = 182; });
  assert.equal(objective().completion, undefined);
  update(store, "alpha", p => { p.source.updatedAt = at(15); profession(p, 76, 15); });
  assert.deepEqual(objective().completion, { at: at(15), via: "profession-rank" });
  update(store, "alpha", p => { p.source.updatedAt = at(20); profession(p, 90, 20); });
  assert.deepEqual(objective().completion, { at: at(15), via: "profession-rank" });
});

test("unknown quest history needs a dated turn-in, not a ready quest or an ID of unknown age", t => {
  const store = fixture(t);
  update(store, "alpha", p => {
    delete p.history;
    p.quests = [{ id: 123, title: "Quest 123", complete: true, objectives: [] }];
  });
  store.changeObjective(pin());
  update(store, "alpha", p => {
    p.source.updatedAt = at(10);
    p.history = { completedIdsKnown: true, completedIds: [123], recent: [{ id: 123, title: "Quest 123", completedAt: Date.parse(at(4)) / 1000 }] };
  });
  assert.equal(store.state.objectives[0].completion, undefined);
  update(store, "alpha", p => {
    p.source.updatedAt = at(15);
    p.clientBuild = "1.15.2.54321";
    p.history.recent[0].completedAt = Date.parse(at(12)) / 1000;
  });
  assert.equal(store.state.objectives[0].completion, undefined);
  update(store, "alpha", p => {
    p.source.updatedAt = at(20);
    p.clientBuild = "1.15.2.12345";
    p.quests = [];
  });
  assert.deepEqual(store.state.objectives[0].completion, { at: at(12), via: "turn-in" });
});
