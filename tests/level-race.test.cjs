"use strict";
// Leveling races with friends (S4): a small text code, strict validation on import, a private board.
const test = require("node:test"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const R = require("../src/core/level-race.cjs");
const DAY = 86400, T = 1790000000;
const levels = (rows) => ({ id: "a", name: "Aeralyn", realm: "Stormhold", className: "Mage", journal: { levels: rows.map(([level, played], i) => ({ level, played, at: T + i * DAY })) } });
const me = levels([[10, 36000], [11, 40000], [12, 45000], [13, 52000]]);
// A code built by hand with valid check digits, to prove every rule is checked beyond the checksum.
const forge = (payload) => { const body = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8").toString("base64url"); return `BFRACE1.${body}.${crypto.createHash("sha256").update(`BFRACE1:${body}`).digest("hex").slice(0, 10)}`; };

test("a code carries only the typed name, the levels, the played time and the day", () => {
  const code = R.exportCode(me, "  Frank  ");
  assert.match(code, /^BFRACE1\.[A-Za-z0-9_-]+\.[0-9a-f]{10}$/);
  const json = JSON.parse(Buffer.from(code.split(".")[1], "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(json), ["v", "n", "l"]); assert.equal(json.n, "Frank");
  assert.deepEqual(json.l[0], [10, 36000, Math.floor(T / DAY)]);
  assert.doesNotMatch(JSON.stringify(json), /Aeralyn|Stormhold|Mage/, "no character name, realm or class travels");
  const back = R.importCode(`  ${code}\n`);
  assert.equal(back.name, "Frank"); assert.equal(back.rows.length, 4); assert.equal(back.id, code.split(".")[2]);
  assert.equal(R.exportCode(me, "Frank"), code, "the same facts give the same code");
});

test("export needs a usable name and at least two timed levels", () => {
  for (const bad of ["", "   ", "x".repeat(25), "a\nb", "<b>", 5, null]) assert.throws(() => R.exportCode(me, bad), /display name/);
  assert.throws(() => R.exportCode(levels([[10, 100]]), "Frank"), /fewer than two levels/);
  assert.throws(() => R.exportCode({ journal: { levels: [{ level: 10, at: T }, { level: 11, at: T + 1 }] } }, "Frank"), /fewer than two levels/, "levels without a /played time are not raced");
  assert.deepEqual(R.rowsOf(levels([[10, 500], [11, 400], [12, 900], [61, 1000], [12, 950]])).map((r) => r[0]), [10, 12], "falling times, repeats and levels over 60 are left out");
});

test("import refuses anything that is not exactly a race code", () => {
  const good = R.exportCode(me, "Frank"), [, body, check] = good.split(".");
  assert.ok(R.importCode(good));
  const flipped = `BFRACE1.${body.slice(0, -2)}${body.slice(-2) === "AA" ? "BB" : "AA"}.${check}`;
  for (const bad of [null, 5, {}, "", "hello", good.slice(1), good.replace("BFRACE1", "BFRACE2"), `${good}x`, `${good}.x`, good.toUpperCase(), flipped, `BFRACE1.${body}.0000000000`, `BFRACE1.${body}`, `BFRACE1..${check}`, "x".repeat(5000)]) assert.equal(R.importCode(bad), null, String(bad).slice(0, 30));
  const row = (l, p, d = 20000) => [l, p, d];
  const ok = { v: 1, n: "Mia", l: [row(5, 100), row(6, 200)] };
  assert.equal(R.importCode(forge(ok)).name, "Mia");
  const wrong = [
    { ...ok, v: 2 }, { ...ok, n: "" }, { ...ok, n: " Mia" }, { ...ok, n: "x".repeat(25) }, { ...ok, n: "<img>" }, { ...ok, n: "a\u0000b" }, { ...ok, n: 5 },
    { ...ok, extra: 1 }, { v: 1, n: "Mia" }, { ...ok, l: [row(5, 100)] }, { ...ok, l: "x" }, { ...ok, l: [row(6, 100), row(5, 200)] }, { ...ok, l: [row(5, 200), row(6, 100)] },
    { ...ok, l: [row(5, 100), row(5, 200)] }, { ...ok, l: [row(0, 100), row(6, 200)] }, { ...ok, l: [row(5, 100), row(61, 200)] }, { ...ok, l: [row(5, -1), row(6, 200)] },
    { ...ok, l: [row(5, 1.5), row(6, 200)] }, { ...ok, l: [[5, 100], [6, 200]] }, { ...ok, l: [row(5, 100, 20000), row(6, 200, 19000)] }, { ...ok, l: [row(5, 100), row(6, 2e9)] },
    { ...ok, l: [row(5, 100), { 0: 6, 1: 200, 2: 0, length: 3 }] }, { ...ok, l: Array.from({ length: 61 }, (_, i) => row(i + 1, i * 10)) }, [1, 2, 3], "text", null,
  ];
  for (const bad of wrong) assert.equal(R.importCode(forge(bad)), null, JSON.stringify(bad).slice(0, 60));
  assert.equal(R.importCode(forge("{not json")), null);
  assert.equal(R.importCode(forge('{"v":1,"n":"Mia","l":[[5,100,0],[6,200,0]],"__proto__":{"x":1}}')), null, "an extra key is refused even when it is __proto__");
});

test("the board compares level by level and says who was fastest and how far apart", () => {
  const friend = R.importCode(forge({ v: 1, n: "Mia", l: [[10, 30000, 0], [11, 41000, 0], [12, 44000, 0]] }));
  const alt = { id: "p:b", name: "Bram", kind: "yours", rows: [[12, 50000, 0], [13, 51000, 0], [14, 60000, 0]] };
  const b = R.board([{ id: "p:a", name: "Frank", kind: "you", rows: R.rowsOf(me) }, alt, { id: `f:${friend.id}`, name: friend.name, kind: "friend", rows: friend.rows }, { id: "empty", name: "E", kind: "friend", rows: [] }]);
  assert.deepEqual(b.columns.map((c) => [c.name, c.kind, c.topLevel, c.wins]), [["Frank", "you", 13, 1], ["Bram", "yours", 14, 1], ["Mia", "friend", 12, 2]]);
  assert.deepEqual(b.rows.map((r) => r.level), [10, 11, 12, 13, 14]);
  const at = (level) => b.rows.find((r) => r.level === level).cells;
  assert.deepEqual(at(10).map((c) => c.seconds), [36000, null, 30000]); assert.deepEqual(at(10).map((c) => c.fastest), [false, false, true]);
  assert.deepEqual(at(11).map((c) => c.fastest), [true, false, false]); assert.equal(at(11)[2].gap, 1000, "Mia reached 11 a thousand seconds after you");
  assert.deepEqual(at(12).map((c) => c.gap), [0, 5000, -1000]);
  assert.deepEqual(at(14).map((c) => [c.seconds, c.fastest, c.gap]), [[null, false, null], [60000, false, null], [null, false, null]], "a lone time is not a win, and no gap without your own time");
  assert.deepEqual(b.standings, [{ id: "p:b", name: "Bram", level: 13, gap: 1000 }, { id: `f:${friend.id}`, name: "Mia", level: 12, gap: 1000 }]);
  assert.deepEqual(R.board([]), { columns: [], rows: [], standings: [] });
  assert.deepEqual(R.board([{ id: "x", name: "X", kind: "friend", rows: [[5, 1, 0], [6, 2, 0]] }]).standings, [], "no standings without your own character");
});
