"use strict";
// 1.4 (J17, J18): this week's recap and reminders across characters.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { weeklyRecap, reminders, WEEK } = require("../src/core/weekly.cjs");
const now = 1800000000, day = 86400;
const alpha = { id: "a", name: "Alpha", level: 21, journal: { levels: [{ level: 19, at: now - 9 * day, played: 1000 }, { level: 20, at: now - 2 * day, played: 4000 }, { level: 21, at: now - day, played: 6000 }], firsts: [{ key: "flight", at: now - day }, { key: "hearth", at: now - 20 * day }], zones: [] },
  ledger: { money: 50000, moneyLog: [[20000, now - 10 * day], [30000, now - 6 * day]] } };
const beta = { id: "b", name: "Beta", level: 30, progress: { current: 0, max: 1000, rested: 1500 }, source: { kind: "wow-addon", id: "x", updatedAt: new Date((now - 10 * day) * 1000).toISOString() },
  ledger: { money: 0, cooldowns: [{ key: "transmute", readyAt: now - 10 }], mail: { seenAt: now - day, complete: true, items: [], letters: 2, money: 0, expiresAt: now + 2 * day } } };

test("the week: levels, badges earned in it, gold change, fastest level, sessions", () => {
  const hist = (id) => (id === "a" ? { sessions: [{ startedAt: (now - day) * 1000, minutes: 90, deaths: 2 }, { startedAt: (now - 10 * day) * 1000, minutes: 60, deaths: 5 }] } : null);
  const r = weeklyRecap({ profiles: [alpha, beta], activeProfileId: "a" }, { history: hist, now });
  const me = r.active;
  assert.equal(me.levelsGained, 2);
  assert.deepEqual(me.badges.map((b) => b.id).sort(), ["first-flight", "level-20"]);
  assert.equal(me.gold, 50000 - 20000, "from the last sample before the week");
  assert.deepEqual(me.bestSplit, { level: 20, seconds: 2000 });
  assert.equal(me.minutes, 90); assert.equal(me.deaths, 2);
  assert.equal(r.characters.length, 1, "Beta did nothing this week");
  assert.equal(r.to - r.from, WEEK);
});

test("reminders: full rested, ready cooldowns, mail about to expire, a reached goal", () => {
  const list = reminders({ profiles: [alpha, beta], goldGoal: { copper: 40000, label: "Mount", setAt: 1 } }, { now });
  const kinds = list.map((x) => x.kind);
  assert.deepEqual(kinds, ["rested", "cooldown", "mail", "goal"]);
  assert.match(list[0].text, /Beta's rested XP is full/);
  assert.match(list[1].text, /Transmute \(Alchemy\) is ready/);
  assert.match(list[2].text, /mail expires in 2 days/);
  assert.match(list[3].text, /Gold goal reached: Mount/);
});

test("wiring: weekly IPC, Now's reminder strip and Journey's This week card", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.match(read("src/main.cjs"), /handle\("weekly"/);
  assert.match(read("src/preload.cjs"), /weekly: \(\) => invoke\("weekly"\)/);
  assert.match(read("src/renderer/now.js"), /\$\{weekStrip\(\)\}\$\{body\(\)\}/);
  assert.match(read("src/renderer/journey.js"), /<h2>This week<\/h2>/);
});
