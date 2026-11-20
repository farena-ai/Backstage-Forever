"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PrivateWeekly } = require("../src/core/private-weekly.cjs");
const { weeklyRecap } = require("../src/core/weekly.cjs");
const now = Date.parse("2026-11-20T16:00:00Z");
const main = { id: "main", name: "Main", source: { id: "saved-main", kind: "wow-addon" }, clientBuild: "1.2.3" };
const alt = { id: "main-alt", name: "Alt" };
const state = { activeProfileId: main.id, profiles: [main, alt] };
const session = { id: "session-1", profileId: main.id, startedAt: now - 3600000, minutes: 24, deaths: 1 };
const history = { sessions: [session] };
const validAt = now - 1000;

test("private manual entries join the observed chronology without changing evidence or weekly totals", () => {
  const notes = new PrivateWeekly({ now: () => now });
  const weekly = () => weeklyRecap(state, { history: id => id === main.id ? history : null, now: now / 1000 });
  const before = structuredClone(weekly());
  const { token } = notes.view(state, history);
  assert.ok(notes.add(state, history, { token, kind: "accomplishment", at: validAt, text: "  Private <win>  " }));
  assert.ok(notes.add(state, history, { token, kind: "correction", sessionId: session.id, at: session.startedAt, text: "Private context" }));
  const rows = notes.view(state, history).rows;
  assert.deepEqual(rows.map(({ source, kind, at }) => [source, kind, at]), [
    ["manual", "accomplishment", validAt], ["observed", "session", session.startedAt], ["manual", "correction", session.startedAt],
  ]);
  assert.equal(rows[0].text, "Private <win>");
  assert.equal(rows[1].minutes, 24);
  assert.equal(rows[1].deaths, 1);
  assert.equal(rows[2].sessionId, session.id);
  assert.deepEqual(history.sessions, [{ id: "session-1", profileId: main.id, startedAt: now - 3600000, minutes: 24, deaths: 1 }]);
  assert.deepEqual(weekly(), before);
  assert.equal(notes.add(state, history, { token, kind: "accomplishment", at: validAt, text: "Not an overwrite" }), null);
});

test("unknown dates and missing, mismatched or wrong-character correction targets are rejected", () => {
  const notes = new PrivateWeekly({ now: () => now });
  const { token } = notes.view(state, history);
  const add = input => notes.add(state, history, { token, text: "Manual", ...input });
  for (const at of [null, undefined, NaN, "2026-11-20", now + 1, now - 8 * 86400000]) assert.equal(add({ kind: "accomplishment", at }), null);
  for (const [sessionId, at] of [["missing", session.startedAt], [session.id, validAt], [session.id, null]]) assert.equal(add({ kind: "correction", sessionId, at }), null);
  const alien = { ...session, profileId: alt.id };
  assert.equal(notes.add(state, { sessions: [alien] }, { token, text: "Manual", kind: "correction", sessionId: alien.id, at: alien.startedAt }), null);
  const invalidHistory = { sessions: [alien, { ...session, startedAt: null }, { ...session, startedAt: now + 1 }] };
  assert.deepEqual(notes.view(state, invalidHistory).rows, []);
  assert.equal(add({ kind: "accomplishment", at: validAt, text: "x".repeat(281) }), null);
  assert.equal(add({ kind: "accomplishment", at: validAt, profileId: alt.id }), null);
  assert.equal(notes.view(state, history).rows.length, 1);
});

test("switches, replacement, deletion and source/build changes retire old ownership", () => {
  const notes = new PrivateWeekly({ now: () => now });
  const input = { token: notes.view(state, history).token, kind: "accomplishment", at: validAt, text: "Secret" };
  assert.ok(notes.add(state, history, input));
  const other = { ...state, activeProfileId: alt.id };
  assert.deepEqual(notes.view(other, history).rows, []);
  assert.equal(notes.add(other, history, input), null);
  assert.equal(notes.add(state, history, input), null, "switching away and back renews the token");
  assert.equal(notes.view(state, history).rows[0].text, "Secret");
  const renewed = { ...input, token: notes.view(state, history).token };
  notes.sync({ ...state, profiles: [alt], activeProfileId: alt.id });
  assert.equal(notes.add(state, history, renewed), null);
  assert.equal(notes.view(state, history).rows.length, 1, "same-ID re-add does not resurrect manual notes");
  const current = { ...input, token: notes.view(state, history).token };
  assert.ok(notes.add(state, history, current));
  for (const changed of [{ ...main, source: { ...main.source, id: "replacement" } }, { ...main, clientBuild: "1.2.4" }]) {
    assert.equal(notes.add({ ...state, profiles: [changed, alt] }, history, current), null);
  }
  assert.ok(notes.add(state, history, { ...input, token: notes.view(state, history).token }));
  const beforeReset = { ...input, token: notes.view(state, history).token };
  notes.clear();
  assert.equal(notes.add(state, history, beforeReset), null);
  assert.equal(notes.view(state, history).rows.length, 1);
});
