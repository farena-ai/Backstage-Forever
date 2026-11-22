"use strict";
// Screenshot journal (W7): the game's Screenshots folder is only read; pictures are placed on the
// timeline from saved data; previews live under the app's own folder.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const J = require("../src/core/screenshot-journal.cjs");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const T = 1790000000, DAY = 86400, H = 3600;
const mapName = (id) => ({ 1436: "Westfall", 1429: "Elwynn Forest" })[id] || `Map ${id}`;
function gameFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-shots-")), dir = path.join(root, "Screenshots");
  fs.mkdirSync(dir);
  const put = (name, at, bytes = 2000) => { const file = path.join(dir, name); fs.writeFileSync(file, Buffer.alloc(bytes, 7)); fs.utimesSync(file, at, at); return file; };
  return { root, dir, put };
}
const snapshot = (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((e) => `${e.name}:${e.isFile() ? fs.statSync(path.join(dir, e.name)).size : "dir"}:${Math.floor(fs.statSync(path.join(dir, e.name)).mtimeMs / 1000)}`).sort();

test("the folder is found under the game folder and listed newest first, pictures only, bounded", () => {
  const g = gameFolder();
  try {
    assert.equal(J.screenshotsDir(g.root), g.dir);
    for (const bad of [null, "", "relative/path", path.join(g.root, "missing"), 5, `${g.root}\u0000`]) assert.equal(J.screenshotsDir(bad), null);
    g.put("WoWScrnShot_112026_101500.jpg", T + 100); g.put("WoWScrnShot_112126_101500.JPG", T + DAY); g.put("old.png", T - DAY); g.put("raw.tga", T + 50);
    g.put("notes.txt", T + 500); g.put("evil.jpg.exe", T + 500); g.put("bad<name>.jpg".replace(/[<>]/g, "$"), T + 500); g.put("huge.jpg", T + 600, 100);
    fs.truncateSync(path.join(g.dir, "huge.jpg"), J.LIMITS.bytes + 1);
    fs.writeFileSync(path.join(g.dir, "empty.jpg"), "");
    fs.mkdirSync(path.join(g.dir, "folder.jpg"));
    const before = snapshot(g.dir);
    const shots = J.listScreenshots(g.dir);
    assert.deepEqual(shots.map((s) => [s.name, s.at, s.preview]), [["WoWScrnShot_112126_101500.JPG", T + DAY, true], ["WoWScrnShot_112026_101500.jpg", T + 100, true], ["raw.tga", T + 50, false], ["old.png", T - DAY, true]]);
    assert.equal(shots[0].bytes, 2000);
    assert.deepEqual(J.listScreenshots(g.dir, { limit: 2 }).map((s) => s.name), ["WoWScrnShot_112126_101500.JPG", "WoWScrnShot_112026_101500.jpg"]);
    assert.deepEqual(J.listScreenshots(null), []); assert.deepEqual(J.listScreenshots(path.join(g.root, "missing")), []);
    assert.deepEqual(snapshot(g.dir), before, "listing changes nothing in the game's folder");
  } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
});

test("a picture is placed by a covering session first, then by saved level dates, else not at all", () => {
  const profile = { source: { updatedAt: new Date((T + 3 * DAY) * 1000).toISOString() }, journal: { levels: [{ level: 12, at: T }, { level: 13, at: T + DAY }], givers: [{ q: 1, n: 1, m: 1436, at: T + DAY + 600 }, { q: 2, n: 1, m: 1429, at: T + 100 }] } };
  const sessions = [{ startedAt: (T + DAY) * 1000, endedAt: (T + DAY + H) * 1000, zones: [1436], startLevel: 12, level: 13 }, { startedAt: (T + 2 * DAY) * 1000, endedAt: (T + 2 * DAY + H) * 1000, zones: [1436, 1429], startLevel: 13, level: 13 }];
  const place = (at, extra = {}) => J.placeScreenshot({ name: "a.jpg", at }, { profile, sessions, mapName, ...extra });
  assert.deepEqual(place(T + DAY + 900), { level: 13, zone: "Westfall", basis: "session" });
  assert.deepEqual(place(T + 2 * DAY + 900), { level: 13, zone: null, basis: "session" }, "a session through two zones names no zone without a quest picked up nearby");
  assert.deepEqual(place(T + 200), { level: 12, zone: "Elwynn Forest", basis: "journal" }, "no session, but a level date and a quest picked up within the hour");
  assert.deepEqual(place(T + 12 * H), { level: 12, zone: null, basis: "journal" });
  assert.deepEqual(place(T - 50), { level: null, zone: null, basis: null }, "before the first dated level nothing is claimed");
  assert.deepEqual(place(T + 9 * DAY), { level: null, zone: null, basis: null }, "after the newest save nothing is claimed");
  assert.deepEqual(J.placeScreenshot({ name: "a.jpg", at: T }, {}), { level: null, zone: null, basis: null });
  assert.deepEqual(J.placeScreenshot({ name: "a.jpg", at: T + DAY + 60 }, { sessions, mapName }), { level: 13, zone: "Westfall", basis: "session" }, "a session alone gives its end level");
});

test("the timeline merges saved events and pictures, newest first, by day", () => {
  const profile = { source: { updatedAt: new Date((T + 3 * DAY) * 1000).toISOString() }, journal: { levels: [{ level: 12, at: T }, { level: 13, at: T + DAY }, { level: 2, at: 0 }], firsts: [{ key: "dungeon", at: T + DAY + 5 }, { key: "odd", at: T }] } };
  const view = J.timeline({ profile, shots: [{ name: "a.jpg", at: T + 30, bytes: 1, preview: true }, { name: "b.jpg", at: T + 9 * DAY, bytes: 1, preview: true }],
    deaths: [{ at: (T + 60) * 1000, mapId: 1436, killer: "Defias Pillager" }, { at: (T + 90) * 1000 }], runs: [{ name: "The Deadmines", startedAt: T + DAY + 10, timed: true, deaths: 1, bosses: [{}, {}] }], mapName, firstWords: { dungeon: "First dungeon" } });
  const rows = view.days.flatMap((d) => d.rows);
  assert.deepEqual(rows.map((r) => r.kind), ["shot", "run", "first", "level", "death", "death", "shot", "level"]);
  assert.ok(rows.every((r, i) => !i || rows[i - 1].at >= r.at));
  assert.deepEqual(view.counts, { rows: 8, shots: 2, placed: 1 });
  assert.equal(rows[1].detail, "2 bosses defeated, 1 death"); assert.equal(rows[4].title, "Died"); assert.equal(rows[5].title, "Died in Westfall"); assert.match(rows[5].detail, /Defias Pillager/);
  assert.deepEqual([rows[6].level, rows[6].basis, rows[0].basis], [12, "journal", null]);
  assert.ok(view.days.length >= 3); assert.match(view.days[0].day, /^\d{4}-\d\d-\d\d$/);
  assert.deepEqual(J.timeline().days, []);
});

test("previews are made once, cached in the app's folder, refused for anything unlisted, and pruned", () => {
  const g = gameFolder(), cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-thumbs-"));
  try {
    g.put("a.jpg", T); g.put("raw.tga", T);
    const before = snapshot(g.dir);
    let renders = 0;
    const cache = new J.ThumbCache({ cacheDir, render: (file, width) => { renders++; assert.equal(path.dirname(file), g.dir); assert.equal(width, J.LIMITS.thumbWidth); return Buffer.alloc(64, 1); } });
    const [shot] = J.listScreenshots(g.dir).filter((s) => s.name === "a.jpg");
    assert.equal(cache.get(g.dir, shot).length, 64); assert.equal(cache.get(g.dir, shot).length, 64);
    assert.equal(renders, 1, "the second ask is served from the app's own cache");
    assert.deepEqual(fs.readdirSync(cacheDir), [`${cache.key(shot)}.jpg`]);
    assert.equal(cache.get(g.dir, { ...shot, name: "raw.tga", preview: false }), null, "no preview for a file type the app cannot read");
    for (const name of ["../a.jpg", "..\\a.jpg", "sub/a.jpg", "C:\\Windows\\win.ini", "a.txt", ""]) assert.equal(cache.get(g.dir, { ...shot, name }), null, name);
    assert.equal(cache.get(g.dir, { ...shot, name: "gone.jpg" }), null); assert.equal(cache.get(null, shot), null);
    assert.equal(new J.ThumbCache({ cacheDir, render: () => null }).get(g.dir, { ...shot, at: T + 1 }), null, "an unreadable picture gives no preview");
    assert.equal(new J.ThumbCache({ cacheDir, render: () => { throw Error("x"); } }).get(g.dir, { ...shot, at: T + 2 }), null);
    assert.deepEqual(snapshot(g.dir), before, "nothing is written, moved or changed in the game's folder");
    for (let i = 0; i < J.LIMITS.thumbs + 5; i++) fs.writeFileSync(path.join(cacheDir, `${String(i).padStart(40, "0")}.jpg`), "x");
    fs.writeFileSync(path.join(cacheDir, "keep.txt"), "x");
    assert.ok(cache.prune() >= 5); assert.ok(fs.readdirSync(cacheDir).filter((n) => n.endsWith(".jpg")).length <= J.LIMITS.thumbs);
    cache.clear();
    assert.deepEqual(fs.readdirSync(cacheDir), ["keep.txt"], "clearing removes only the app's own previews");
  } finally { fs.rmSync(g.root, { recursive: true, force: true }); fs.rmSync(cacheDir, { recursive: true, force: true }); }
});

test("the module never writes to the game folder, and the previews stay local", () => {
  const core = read("src/core/screenshot-journal.cjs"), main = read("src/main.cjs"), ipc = read("src/core/journey-extras-ipc.cjs"), page = read("src/renderer/journey-extras.js");
  assert.doesNotMatch(core, /copyFile|rename|rmSync|appendFile|createWriteStream|https?:|fetch\(/);
  assert.equal((core.match(/writeFileSync\(/g) || []).length, 1, "the only write is the preview into the app's cache");
  assert.match(core, /this\.fsi\.writeFileSync\(cached, bytes\)/); assert.equal((core.match(/unlinkSync\(path\.join\(this\.cacheDir/g) || []).length, 2);
  assert.match(main, /cacheDir: path\.join\(app\.getPath\("userData"\), "screenshot-previews"\)/);
  assert.match(ipc, /handle\("screenshotThumb"[\s\S]*?\{ privateOnly: true \}/, "previews are not handed to the companion's tools");
  assert.match(ipc, /shots\.find\(\(s\) => s\.name === name\)/, "only a file in the current listing can be asked for");
  assert.match(page, /canvas width="360" height="203" data-shot=/, "previews are drawn on a canvas; the page's CSP allows no blob images");
  assert.doesNotMatch(page, /\sstyle="/);
});
