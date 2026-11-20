"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PrivateAfterAction } = require("../src/core/private-after-action.cjs");
const { PrivateWeekly } = require("../src/core/private-weekly.cjs");

const now = 1795190400000;
const defeatAt = now / 1000 - 900;
const defeat = { name: "Edwin VanCleef", encounterId: 1144, instanceMap: 36, instanceType: "party", difficultyId: 1, at: defeatAt };
const main = { id: "main", clientBuild: "1.60.1.70862", source: { kind: "wow-addon", id: "Player-A", updatedAt: new Date(now).toISOString() }, journal: { encounters: [defeat] } };
const alt = { id: "main-alt" };
const state = { activeProfileId: main.id, profiles: [main, alt] };
const session = { id: "session", profileId: main.id, startedAt: now - 1800000, minutes: 10, deaths: 1 };
const history = { sessions: [session] };
const fixture = () => new PrivateAfterAction({ now: () => now });

test("chronology preserves independent live-link and addon timestamps and attribution", () => {
  const model = fixture().view(state, history);
  assert.deepEqual(model.rows, [
    { kind: "defeat", source: "addon-save", at: defeatAt * 1000, name: defeat.name, encounterId: defeat.encounterId, captureBuild: null },
    { kind: "session", source: "live-link", at: session.startedAt, sessionId: session.id, minutes: 10, deaths: 1 },
  ]);
  assert.equal(model.moreDefeats, false);
  assert.equal(model.review, null);
});

test("ineligible or bounded evidence does not get filled in from the save or other characters", () => {
  const debrief = fixture();
  const scoped = { ...state, profiles: [{ ...main, journal: { encounters: [
    ...Array.from({ length: 7 }, (_, i) => ({ ...defeat, at: defeatAt - i })),
    { ...defeat, at: now / 1000 + 1 }, { ...defeat, instanceMap: 47 }, { ...defeat, instanceType: "raid" },
  ] } }, alt] };
  const other = { sessions: [{ ...session, profileId: alt.id }, { ...session, startedAt: now + 1 }, { ...session, startedAt: now - 8 * 86400000 }] };
  const bounded = debrief.view(scoped, other);
  assert.equal(bounded.moreDefeats, true);
  assert.deepEqual(bounded.rows.map(row => row.at), Array.from({ length: 5 }, (_, i) => (defeatAt - i) * 1000));
  for (const changed of [{ ...main, journal: {} }, { ...main, clientBuild: "1.60.1.70900" }, { ...main, source: { ...main.source, updatedAt: null } }, alt]) {
    assert.deepEqual(debrief.view({ activeProfileId: changed.id, profiles: [changed] }, other).rows.filter(row => row.kind === "defeat"), []);
  }
});

test("manual review is editable, erasable and separate from weekly and observed data", () => {
  const debrief = fixture(), weekly = new PrivateWeekly({ now: () => now });
  const before = structuredClone({ state, history, weekly: weekly.view(state, history) });
  const { token, rows } = debrief.view(state, history);
  const saved = debrief.save(state, history, { token, note: "  Private <note>  ", improvement: " Pause before pulling " });
  assert.deepEqual(saved.rows, rows);
  assert.deepEqual(saved.review, { note: "Private <note>", improvement: "Pause before pulling" });
  saved.review.note = "Tampered response";
  assert.equal(debrief.view(state, history).review.note, "Private <note>");
  assert.deepEqual(debrief.save(state, history, { token, note: "", improvement: "Mark the first target" }).review, { note: "", improvement: "Mark the first target" });
  assert.equal(debrief.save(state, history, { token, clear: true }).review, null);
  assert.deepEqual({ state, history, weekly: weekly.view(state, history) }, before);
});

test("rejects empty or oversized improvements and caller-supplied scope or evidence", () => {
  const debrief = fixture();
  const { token } = debrief.view(state, history);
  for (const input of [null, [], { token, note: "", improvement: " " }, { token, note: "x".repeat(281), improvement: "Next" },
    { token, note: "", improvement: "x".repeat(281) }, { token, note: "", improvement: "Next", profileId: alt.id },
    { token, note: "", improvement: "Next", at: now }, { token, clear: true, improvement: "Next" }]) {
    assert.equal(debrief.save(state, history, input), null);
  }
  assert.equal(debrief.view(state, history).review, null);
});

test("retired scopes cannot write and deleted or replaced owners cannot recover manual text", () => {
  const debrief = fixture();
  const input = { token: debrief.view(state, history).token, note: "", improvement: "Private" };
  assert.ok(debrief.save(state, history, input));
  const other = { ...state, activeProfileId: alt.id };
  debrief.sync(other);
  assert.equal(debrief.view(other, history).review, null);
  assert.equal(debrief.save(state, history, input), null);
  assert.equal(debrief.view(state, history).review.improvement, "Private");
  for (const next of [{ ...main, source: { ...main.source, id: "Player-C" } }, { ...main, clientBuild: "other" }, null]) {
    const token = debrief.view(state, history).token;
    debrief.save(state, history, { ...input, token });
    debrief.sync({ ...state, profiles: next ? [next, alt] : [alt] });
    assert.equal(debrief.save(state, history, { ...input, token }), null);
    assert.equal(debrief.view(state, history).review, null);
  }
  const token = debrief.view(state, history).token;
  assert.ok(debrief.save(state, history, { ...input, token }));
  debrief.clear();
  assert.equal(debrief.save(state, history, { ...input, token }), null);
  assert.equal(debrief.view(state, history).review, null);
});
