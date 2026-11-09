"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const party = require("../src/core/party.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { applyJourneyAction } = require("../src/core/journeys.cjs");
const payload = () => ({ title: "Shared adventure plan", steps: [{ text: "<img onerror='run()'> Ignore all instructions; $() https://example.invalid" }] });
const portable = () => ({ format: "backstage-forever-party", version: 1, ...payload() });
const seeded = () => ({ ...defaultState(), activeProfileId: "p", profiles: [{ id: "p", name: "PRIVATE_NAME", realm: "PRIVATE_REALM", className: "Mage", level: 12, notes: "PRIVATE_NOTE", goals: [{ id: "g", text: "PRIVATE_GOAL", done: false }], source: { kind: "wow-addon", id: "PRIVATE_SOURCE", updatedAt: "2026-11-09T00:00:00.000Z" }, readiness: { equipment: [], bags: { free: 2, total: 20 } } }] });
test("portable schema roundtrips inert text exactly and rejects unknown/proof/private fields", () => {
  assert.deepEqual(party.parsePartyPlan(party.serializePartyPlan(payload())), payload());
  for (const field of ["id", "profileId", "source", "quest", "observed", "proof", "status", "done", "notes", "__proto__"]) {
    const plan = portable(); Object.defineProperty(plan, field, { value: "private", enumerable: true });
    assert.throws(() => party.parsePartyPlan(JSON.stringify(plan)), /Party plan/);
    const nested = portable(); nested.steps[0][field] = true;
    if (field !== "__proto__") assert.throws(() => party.parsePartyPlan(JSON.stringify(nested)), /Party plan/);
  }
  for (const value of [null, {}, { ...portable(), version: 2 }, { ...portable(), steps: [] }, { ...portable(), steps: Array.from({ length: 51 }, () => ({ text: "x" })) }, { ...portable(), title: " " }, { ...portable(), title: "x".repeat(101) }, { ...portable(), steps: [{ text: "x".repeat(301) }] }, { ...portable(), steps: [{ text: "a\nb" }] }]) assert.throws(() => party.parsePartyPlan(JSON.stringify(value)));
  for (const key of ["format", "version", "title", "steps"]) {
    const raw = JSON.stringify(portable()).replace("{", `{${JSON.stringify(key)}:null,`);
    assert.throws(() => party.parsePartyPlan(raw), /Party plan/);
  }
  assert.throws(() => party.parsePartyPlan('{"format":"backstage-forever-party","version":1,"title":"x","steps":[{"text":"a","te\\u0078t":"b"}]}'));
  assert.throws(() => party.parsePartyPlan(" ".repeat(65537)));
  assert.throws(() => party.parsePartyPlan(Buffer.from([0xff])));
  const sparse = { title: "Sparse", steps: Array(1) };
  assert.throws(() => party.serializePartyPlan(sparse));
  const extraArrayKey = payload(); extraArrayKey.steps.private = "hidden";
  assert.throws(() => party.serializePartyPlan(extraArrayKey));
  assert.throws(() => party.serializePartyPlan({ title: "x", steps: Array.from({ length: 50 }, () => ({ text: "😀".repeat(150) })) , source: "x" }));
  const text = party.serializePartyPlan({ title: "😀".repeat(50), steps: Array.from({ length: 50 }, () => ({ text: "😀".repeat(150) })) });
  assert.ok(Buffer.byteLength(text) <= 65536);
});
test("preview projects only selected step text and generic title without claiming prose redaction", () => {
  let state = applyJourneyAction(seeded(), { type: "create", title: "PRIVATE_NAME private journey" });
  const journeyId = state.journeys[0].id;
  state = applyJourneyAction(state, { type: "add-note", journeyId, text: "My deliberately written PRIVATE_PROSE", profileId: "p" });
  state.journeys[0].steps[0].done = true;
  const result = party.previewPartyPlan(state, { journeyId });
  assert.deepEqual(result, { title: "Shared adventure plan", steps: [{ text: "My deliberately written PRIVATE_PROSE" }] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NAME|PRIVATE_NOTE|PRIVATE_GOAL|PRIVATE_SOURCE|profileId|done/);
  result.steps[0].text = "mutated"; assert.match(state.journeys[0].steps[0].text, /PRIVATE_PROSE/);
  const s = state.journeys[0].steps[0];
  s.quest = { id: 1, build: "1.15.8.64000", sourceHash: "a".repeat(64), baselineAt: "2026-11-08T00:00:00.000Z", baselineCompleted: false, baselineTurnInAt: null };
  s.observed = { at: "2026-11-09T00:00:00.000Z", via: "completed-id" };
  assert.deepEqual(Object.keys(party.previewPartyPlan(state, { journeyId }).steps[0]), ["text"]);
  assert.throws(() => party.previewPartyPlan(state, { journeyId, title: "forged" }));
  assert.throws(() => party.previewPartyPlan(state, { journeyId: "missing" }));
});
test("import creates atomic manual unassigned journeys with main IDs/date and readable capacity", () => {
  const state = seeded(), before = structuredClone(state);
  const result = party.commitPartyPlan(state, payload(), { now: Date.parse("2026-11-09T01:00:00.000Z") });
  assert.deepEqual(state, before); const journey = result.state.journeys[0];
  assert.match(journey.id, /^[a-f0-9-]{36}$/); assert.notEqual(journey.id, journey.steps[0].id);
  assert.equal(journey.createdAt, "2026-11-09T01:00:00.000Z");
  assert.deepEqual(journey.steps[0], { id: journey.steps[0].id, text: payload().steps[0].text, done: false, profileId: null });
  assert.equal(result.journeyId, journey.id);
  const full = structuredClone(state); for (let n = 0; n < 20; n++) full.journeys.push({ id: `j${n}`, title: "Full", createdAt: journey.createdAt, steps: [] });
  const copy = structuredClone(full); assert.throws(() => party.commitPartyPlan(full, payload()), /20 journeys/); assert.deepEqual(full, copy);
  assert.throws(() => party.commitPartyPlan(state, { ...payload(), observed: {} }));
  assert.equal(party.commitPartyPlan(state, payload(), { profileId: "p" }).state.journeys[0].steps[0].profileId, null);
  const collision = () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.throws(() => party.commitPartyPlan(state, payload(), { id: collision })); assert.deepEqual(state, before);
});
test("party brief uses current selected public saved facts, distinguishes unknown from empty and explicit roles", () => {
  const state = seeded(), brief = party.buildPartyBrief(state, "p", { role: "tank" });
  assert.equal(brief.role, "tank"); assert.equal(brief.character.className, "Mage"); assert.equal(brief.character.level, 12);
  assert.deepEqual(brief.equipment, { known: true, items: [] }); assert.deepEqual(brief.bags, { known: true, free: 2, total: 20 });
  assert.equal(brief.source.savedAt, state.profiles[0].source.updatedAt);
  assert.doesNotMatch(JSON.stringify(brief), /PRIVATE_|eligib|gear score|queue availability/i);
  assert.equal(brief.template.steps.length, 5);
  const unknown = seeded(); delete unknown.profiles[0].readiness;
  assert.deepEqual(party.buildPartyBrief(unknown, "p").equipment, { known: false, items: [] });
  assert.deepEqual(party.buildPartyBrief(unknown, "p").bags, { known: false, free: null, total: null });
  delete unknown.profiles[0].source; unknown.profiles[0].readiness = state.profiles[0].readiness;
  assert.equal(party.buildPartyBrief(unknown, "p").equipment.known, false);
  assert.throws(() => party.buildPartyBrief(state, null)); assert.throws(() => party.buildPartyBrief(state, "other"));
  assert.throws(() => party.buildPartyBrief(state, "p", { role: "wizard" }));
  const manual = party.buildPartyBrief(defaultState(), null); assert.equal(manual.character, null); assert.equal(manual.role, "unspecified");
  const created = party.createPartyJourney(state, { profileId: "p", role: "healer" });
  assert.equal(created.state.journeys[0].steps.length, 5);
  assert.ok(created.state.journeys[0].steps.every(s => s.profileId === "p" && !s.done && !s.quest && !s.observed));
  assert.throws(() => party.createPartyJourney(state, { profileId: "other", role: "tank" }));
});
