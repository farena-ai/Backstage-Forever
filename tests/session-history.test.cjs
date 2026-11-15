"use strict";
// Past sessions (0.48, roadmap 3.1).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { SessionHistory, dayOf } = require("../src/core/session-history.cjs");
const { PlaySession } = require("../src/core/play-session.cjs");
const MIN = 60000;

test("a 30-minute break starts a new play session; the summary says when it started and last played", () => {
  let t = 1_000_000;
  const s = new PlaySession({ now: () => t });
  s.observe({ characterHash: "a", level: 10, xpPercent: 0, position: { mapId: 1, x: 0.1, y: 0.1 } });
  t += 10 * MIN; s.observe({ characterHash: "a", level: 10, xpPercent: 50, position: { mapId: 1, x: 0.2, y: 0.2 } });
  const first = s.summary();
  assert.equal(first.startedAt, 1_000_000); assert.equal(first.lastAt, 1_000_000 + 10 * MIN);
  t += 31 * MIN; s.observe({ characterHash: "a", level: 10, xpPercent: 60, position: { mapId: 1, x: 0.3, y: 0.3 } });
  assert.equal(s.summary().startedAt, t, "new session after the break");
});

test("sessions are kept per character, bounded, written at most once a minute, and read back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sessions-")), file = path.join(dir, "sessions.json");
  let now = Date.parse("2026-11-14T20:00:00"), writes = 0;
  const write = (f, text) => { writes++; fs.writeFileSync(f, text); };
  const h = new SessionHistory({ file, now: () => now, write });
  const me = { id: "p1", name: "Vael" };
  const sum = (o) => ({ active: true, startedAt: now - 40 * MIN, lastAt: now, activeMinutes: 40, startLevel: 14, level: 15, levelsGained: 0.9, deaths: 1, zones: [1411, 1413], ...o });
  assert.equal(h.checkpoint(sum({ activeMinutes: 2 }), me), false, "under 3 minutes is not a session");
  assert.equal(h.checkpoint(sum(), me), true); assert.equal(writes, 1);
  const started = now - 40 * MIN;
  now += 20000; h.checkpoint(sum({ startedAt: started, activeMinutes: 41 }), me);
  assert.equal(writes, 1, "not again within a minute"); assert.equal(h.sessions.length, 1, "same session updated in place");
  now += 60000; h.checkpoint(sum({ startedAt: started, activeMinutes: 42 }), me); assert.equal(writes, 2);
  h.checkpoint(sum({ startedAt: now - 86400000, levelsGained: 1.5 }), me);
  h.checkpoint(sum({ startedAt: now - 1000 }), { id: "p2", name: "Ann" });
  h.flush();
  const back = new SessionHistory({ file, now: () => now });
  const v = back.view("p1");
  assert.equal(v.sessions.length, 2); assert.equal(v.sessions[0].minutes, 42, "newest first");
  assert.equal(v.days.length, 14); assert.equal(v.days[13].day, dayOf(now));
  assert.equal(v.days[13].levels, 0.9); assert.equal(v.days[12].levels, 1.5);
  assert.deepEqual(v.totals, { sessions: 2, minutes: 82, levels: 2.4, deaths: 2 });
  assert.equal(back.view("p2").sessions.length, 1);
  fs.writeFileSync(file, '{"sessions":[{"id":"x","profileId":"p1","startedAt":5,"endedAt":1}, "junk"]}');
  assert.equal(new SessionHistory({ file }).sessions.length, 0, "invalid entries are dropped");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Journey shows past sessions; main keeps and clears them", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const main = read("src/main.cjs");
  assert.match(main, /sessions\.json/); assert.match(main, /sessionHistory\.checkpoint\(playSession\.summary\(\), worldMap\.profile\(\)\)/);
  assert.match(main, /history: sessionHistory \? sessionHistory\.view\(p\.id\) : null/);
  assert.match(main, /sessionHistory\.sessions = \[\]; sessionHistory\.dirty = true; sessionHistory\.flush\(\);/, "Delete all local data clears them");
  assert.match(read("src/renderer/journey.js"), /<h2>Past sessions<\/h2>/);
});
