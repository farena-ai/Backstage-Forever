"use strict";
// Share cards (S9): one card description for every kind of picture; name and realm only when ticked.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const C = require("../src/core/share-cards.cjs");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const who = { name: "Aeralyn", realm: "Stormhold", level: 24, className: "Mage" };
const T = 1790000000;

test("name and realm are off unless ticked, each on its own", () => {
  const data = { level: 24, seconds: 5400, at: T };
  const plain = C.shareCard("level", data, who);
  assert.equal(plain.who, ""); assert.equal(plain.sub, "", "no class or level line without a name or realm either");
  assert.doesNotMatch(JSON.stringify(plain), /Aeralyn|Stormhold/);
  assert.equal(C.shareCard("level", data, who, { name: false, realm: false }).who, "");
  assert.equal(C.shareCard("level", data, who, { name: true }).who, "Aeralyn");
  assert.equal(C.shareCard("level", data, who, { realm: true }).who, "Stormhold");
  const both = C.shareCard("level", data, who, { name: true, realm: true });
  assert.equal(both.who, "Aeralyn · Stormhold"); assert.equal(both.sub, "Level 24 Mage");
  assert.equal(C.shareCard("level", data, who, { name: "yes", realm: 1 }).who, "", "only a real tick counts");
  assert.equal(C.identity(null, { name: true, realm: true }), "");
});

test("every kind makes a card from its facts and refuses facts that do not make one", () => {
  const level = C.shareCard("level", { level: 24, seconds: 5400, at: T, played: 90000, personalBest: true });
  assert.equal(level.title, "Level 24"); assert.equal(level.art, "level-20"); assert.match(level.lines[0], /Level 23 to 24 took 1h 30m of play/);
  assert.match(level.lines.join(" "), /fastest this level has gone/); assert.deepEqual(level.stats.map((s) => s.label), ["Level", "This level", "Played in all"]);
  assert.equal(C.shareCard("level", { level: 7 }).art, "level-10"); assert.equal(C.shareCard("level", { level: 60 }).art, "level-60");
  assert.equal(C.shareCard("level", { level: 0 }), null); assert.equal(C.shareCard("level", {}), null);

  const badge = C.shareCard("badge", { id: "first-mount", name: "In the saddle", how: "Ride your first mount.", at: T, earned: 12, total: 54 });
  assert.equal(badge.kicker, "Badge earned"); assert.equal(badge.art, "first-mount"); assert.deepEqual(badge.stats, [{ label: "Badges", value: "12 of 54" }]);
  assert.equal(C.shareCard("badge", { id: "../../x", name: "N" }).art, null, "art keys are plain names only");
  assert.equal(C.shareCard("badge", { id: "x" }), null);

  const wall = C.shareCard("badges", { earned: 2, total: 54, badges: [{ id: "level-10", name: "Level 10" }, { id: "a", art: "level-20", name: "Twenty" }, { id: "b" }] });
  assert.equal(wall.title, "2 of 54 badges"); assert.deepEqual(wall.grid, [{ name: "Level 10", art: "level-10" }, { name: "Twenty", art: "level-20" }]);
  assert.match(C.shareCard("badges", { earned: 0, total: 54, badges: [] }).lines[0], /first badges come quickly/);

  const run = C.shareCard("run", { name: "The Deadmines", instanceType: "party", bosses: 6, knownBosses: 6, timed: true, seconds: 2500, deaths: 1, personalBest: true, at: T });
  assert.equal(run.kicker, "Dungeon run"); assert.match(run.lines.join(" "), /6 bosses defeated of 6\. In and out in 42m\. My fastest full run here\./);
  assert.deepEqual(run.stats, [{ label: "Bosses", value: "6 / 6" }, { label: "Time", value: "42m" }, { label: "Deaths", value: "1" }]);
  const untimed = C.shareCard("run", { name: "Zul'Gurub", instanceType: "raid", bosses: 1, timed: false, seconds: null, deaths: null, personalBest: false });
  assert.equal(untimed.kicker, "Raid run"); assert.match(untimed.lines.join(" "), /saved without a time/); assert.deepEqual(untimed.stats.map((s) => s.label), ["Bosses"], "no time or deaths are made up");

  const best = C.shareCard("best", { level: 23, seconds: 3000, previousSeconds: 4200 });
  assert.equal(best.title, "Level 23 to 24"); assert.match(best.lines[1], /time to beat was 1h 10m/);
  assert.equal(C.shareCard("best", { name: "The Deadmines", seconds: 2500 }).title, "The Deadmines");
  assert.equal(C.shareCard("best", { seconds: 100 }), null); assert.equal(C.shareCard("best", { level: 3 }), null);

  const chain = C.shareCard("chain", { name: "The Defias Brotherhood", steps: 7, first: "A Messenger", at: T });
  assert.match(chain.lines[0], /story of 7 quests that began with “A Messenger”/); assert.equal(C.shareCard("chain", { name: "X", steps: 1 }), null);
  const zone = C.shareCard("zone", { name: "Westfall", done: 38, total: 40, min: 10, max: 20 });
  assert.match(zone.lines.join(" "), /38 of 40 known quests done\. A zone for levels 10 to 20\./); assert.equal(C.shareCard("zone", { name: "W", done: 5, total: 4 }), null);
  const story = C.shareCard("story", { title: "The story so far", lines: ["One.", "Two."], stats: [["Level", "24"], ["bad"], null, ["Zones", "5"]] });
  assert.deepEqual(story.lines, ["One.", "Two."]); assert.deepEqual(story.stats, [{ label: "Level", value: "24" }, { label: "Zones", value: "5" }]);
  assert.equal(C.shareCard("story", { lines: [] }), null);

  assert.equal(C.shareCard("nope", {}), null); assert.equal(C.shareCard("level", null), null); assert.equal(C.shareCard("level", [1]), null);
  for (const kind of C.KINDS) assert.match(`Backstage-Forever-${kind}.png`, /^[A-Za-z-]+\.png$/);
});

test("text is bounded and stripped of control characters; every card carries the same footer", () => {
  const card = C.shareCard("badge", { id: "x", name: `Long\u0000 name ${"x".repeat(200)}`, how: "y".repeat(400) }, { name: "N".repeat(90), realm: "R\n\tealm" }, { name: true, realm: true });
  assert.ok(card.title.length <= C.LIMITS.title); assert.ok(card.lines[0].length <= C.LIMITS.line); assert.ok(card.who.length <= C.LIMITS.who);
  assert.doesNotMatch(card.title + card.who, /[\x00-\x1f]/); assert.equal(card.footer, "Backstage Forever");
  const many = C.shareCard("story", { lines: Array.from({ length: 30 }, (_, i) => `Line ${i}`), stats: Array.from({ length: 9 }, (_, i) => [`S${i}`, "1"]) });
  assert.equal(many.lines.length, C.LIMITS.lines); assert.equal(many.stats.length, C.LIMITS.stats);
});

test("durations, days and wrapping are plain and never overflow", () => {
  assert.equal(C.duration(59), "1m"); assert.equal(C.duration(3600), "1h 00m"); assert.equal(C.duration(3599), "1h 00m"); assert.equal(C.duration(-1), null); assert.equal(C.duration(NaN), null);
  assert.equal(C.day(0), ""); assert.match(C.day(T), /^\d{1,2} \w{3,4} 20\d\d$/);
  const ruler = (t) => t.length * 10;
  assert.deepEqual(C.wrap("one two three four five", 90, ruler, 3), ["one two", "three", "four five"]);
  const cut = C.wrap("alpha beta gamma delta epsilon zeta", 100, ruler, 2);
  assert.equal(cut.length, 2); assert.ok(cut[1].endsWith("…")); assert.ok(cut.every((row) => ruler(row) <= 100));
  assert.deepEqual(C.wrap("", 100, ruler), []);
  assert.ok(ruler(C.wrap("supercalifragilisticexpialidocious", 100, ruler)[0]) <= 100, "one long word is cut, not left to overflow");
});

test("the renderer paints from the shared model, keeps game art out, and copies or saves only on a button", () => {
  const page = read("src/renderer/share-card.js"), html = read("src/renderer/index.html"), main = read("src/main.cjs"), ipc = read("src/core/journey-extras-ipc.cjs");
  assert.ok(html.indexOf("../core/share-cards.cjs") < html.indexOf("share-card.js") && html.indexOf("share-card.js") < html.indexOf('src="journey.js"'));
  assert.match(page, /const options = \{ name: false, realm: false \}/, "both ticks start off every time the window opens");
  assert.match(page, /data-share-copy>Copy picture</); assert.match(page, /data-share-save>Save picture</);
  assert.match(page, /api\.badgeArt\(batch\)/, "art comes from the app's own badge paintings");
  assert.doesNotMatch(page, /gameData|icon\(|file:\/\/|https?:/, "no game art and nothing remote on a card");
  assert.doesNotMatch(page, /\sstyle="/, "the page's CSP forbids inline styles");
  assert.match(ipc, /handle\("copySharePicture"[\s\S]*?\{ privateOnly: true \}/); assert.match(main, /clipboard\.write\(\[new ClipboardItem\(\{ "image\/png": new Blob\(\[png\]/);
  for (const file of ["src/renderer/badges.js", "src/renderer/economy.js", "src/renderer/journey-extras.js"]) assert.match(read(file), /ShareCard/, `${file} offers share pictures`);
});
