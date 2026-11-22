"use strict";
// Journey extras: the IPC layer (story, timeline, races, Coach's notes, overlay switch, share
// cards) and the pages that paint its models.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const { registerJourneyExtras, isPng } = require("../src/core/journey-extras-ipc.cjs");
const { JourneyStore } = require("../src/core/journey-store.cjs");
const R = require("../src/core/level-race.cjs");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const T = 1790000000, DAY = 86400, H = 3600;
const iso = (at) => new Date(at * 1000).toISOString();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-extras-")), shots = path.join(root, "Screenshots");
  fs.mkdirSync(shots);
  fs.writeFileSync(path.join(shots, "WoWScrnShot_1.jpg"), Buffer.alloc(100, 1)); fs.utimesSync(path.join(shots, "WoWScrnShot_1.jpg"), T + H, T + H);
  const a = { id: "a", name: "Aeralyn", realm: "Stormhold", className: "Mage", level: 13, faction: "Alliance", source: { kind: "wow-addon", id: "s", updatedAt: iso(T + DAY) },
    journal: { played: 60000, zones: [1436], levels: [{ level: 12, at: T - DAY, played: 50000 }, { level: 13, at: T + 2 * H, played: 54000 }], firsts: [{ key: "dungeon", at: T + 3 * H }], givers: [{ q: 1, n: 5, m: 1436, x: 0.5, y: 0.5, at: T + H + 60 }] },
    history: { completedIdsKnown: true, completedIds: [1], recent: [{ id: 1, completedAt: T + 2 * H }] } };
  const b = { id: "b", name: "Bram", realm: "Stormhold", level: 13, journal: { levels: [{ level: 12, at: 5, played: 1000 }, { level: 13, at: 6, played: 9000 }] } };
  const state = { activeProfileId: "a", profiles: [a, b] };
  const journey = new JourneyStore({ validFriend: R.importCode });
  journey.data.captures.a = { previous: { savedAt: iso(T), level: 12, played: 52000, quests: 0, money: null }, current: { savedAt: iso(T + DAY), level: 13, played: 60000, quests: 1, money: null } };
  journey.recordDeath("a", { at: (T + 4 * H) * 1000, mapId: 1436 });
  const handlers = {}, privates = new Set(), log = { shown: [], images: [], text: [], written: [], starts: [], stops: 0 };
  const overlay = { running: false, port: null, status() { return { running: this.running, port: this.port, url: this.running ? `http://127.0.0.1:${this.port}/` : null }; },
    async start(preferred) { log.starts.push(preferred); this.running = true; this.port = preferred || 50123; return this.status(); }, async stop() { log.stops++; this.running = false; this.port = null; return this.status(); } };
  const dialog = { save: { canceled: false, filePath: "C:/x/race.txt" }, open: { canceled: true, filePaths: [] }, showSaveDialog: async () => dialog.save, showOpenDialog: async () => dialog.open };
  const files = new Map();
  const pages = registerJourneyExtras({
    handle: (name, fn, options = {}) => { handlers[name] = fn; if (options.privateOnly) privates.add(name); },
    getState: () => state, journey, economy: { data: { runs: { a: [{ id: "36:1", instanceMap: 36, instanceType: "party", timed: true, startedAt: T + 3 * H, endedAt: T + 3 * H + 2500, deaths: 1, loot: [], bosses: [{ encounterId: 1, name: "Rhahk'Zor", at: T + 3 * H + 60 }] }] } } },
    sessions: (id) => (id === "a" ? { sessions: [{ startedAt: (T + H) * 1000, endedAt: (T + 5 * H) * 1000, minutes: 200, deaths: 1, zones: [1436], startLevel: 12, level: 13 }] } : null),
    leveling: { pack: { zones: [{ mapId: 1436, min: 10, max: 20 }] }, tracker: () => ({ continents: [{ zones: [{ mapId: 1436, name: "Westfall", mastered: true, done: 30, total: 32 }, { mapId: 1429, name: "Elwynn Forest", mastered: false, done: 1, total: 30 }] }] }),
      advise: () => ({ character: { level: 13, zone: "Westfall", xpPercent: 41.4, live: true, position: null }, log: { ready: [{ id: 9, title: "Red Silk Bandanas", turnIn: { name: "Scout Riell", mapId: 1436, mapName: "Westfall", x: 0.56, y: 0.475 } }] } }) },
    chains: () => ({ quests: new Map(), prev: new Map() }), badgesFor: () => ({ badges: [{ name: "Into the depths", earned: true, at: T + 3 * H }] }),
    getRoot: () => root, thumbs: { get: (dir, shot) => (shot.name === "WoWScrnShot_1.jpg" ? Buffer.from([1, 2, 3]) : null) }, overlay, playSummary: () => ({ active: true, deaths: 2 }), dialog, getWindow: () => null,
    showFile: (file) => log.shown.push(file), copyImage: (png) => log.images.push(png), copyText: (text) => log.text.push(text),
    readFile: (file) => files.get(file), statFile: (file) => ({ size: files.get(file).length }), writeFile: async (file, text) => { log.written.push([file, text]); },
  });
  return { root, shots, state, journey, handlers, privates, log, overlay, dialog, files, pages, a, b };
}

test("the handlers serve each view from saved data and refuse stray arguments", async () => {
  const x = setup();
  try {
    const { handlers: h } = x;
    const story = h.story();
    assert.equal(story.name, "Aeralyn"); assert.deepEqual(story.character, { name: "Aeralyn", realm: "Stormhold", level: 13, className: "Mage" }); assert.equal(story.hasQuestReference, true);
    assert.ok(story.chapters.some((c) => c.key === "zones-done" && c.sentences[0] === "Westfall: 30 of 32 known quests done."));
    assert.ok(story.chapters.find((c) => c.key === "dungeons").sentences[0].startsWith("The Deadmines: 1 run"), "the bundled dungeon list names the instance");
    assert.ok(story.chapters.find((c) => c.key === "deaths").sentences[0].startsWith("Died once in Westfall"));
    const line = h.journeyTimeline();
    assert.deepEqual(line.folder, { connected: true, found: true, limit: 200 }); assert.deepEqual(line.counts, { rows: 6, shots: 1, placed: 1 });
    const shot = line.days.flatMap((d) => d.rows).find((r) => r.kind === "shot");
    assert.deepEqual([shot.name, shot.level, shot.zone, shot.basis], ["WoWScrnShot_1.jpg", 12, "Westfall", "session"]);
    assert.deepEqual([...h.screenshotThumb("WoWScrnShot_1.jpg")], [1, 2, 3]);
    for (const bad of ["../state.json", "missing.jpg", "", 5, "a/b.jpg", "C:\\x.jpg"]) { assert.throws(() => h.screenshotThumb(bad), /screenshot/i, String(bad)); assert.throws(() => h.showScreenshot(bad), /screenshot/i); }
    assert.equal(h.showScreenshot("WoWScrnShot_1.jpg"), true); assert.deepEqual(x.log.shown, [path.join(x.shots, "WoWScrnShot_1.jpg")]);
    const notes = h.coachNotes();
    assert.equal(notes.status, "ok"); assert.equal(notes.tomorrow.title, "Hand in Red Silk Bandanas");
    assert.deepEqual(notes.wentWell.map((w) => w.kind), ["levels", "quests", "best", "bosses", "badges"]);
    assert.deepEqual(h.shareCharacter(), { name: "Aeralyn", realm: "Stormhold", level: 13, className: "Mage" }); assert.equal(h.shareCharacter("b").name, "Bram"); assert.equal(h.shareCharacter("zz"), null);
    for (const name of ["story", "journeyTimeline", "raceBoard", "coachNotes", "streamOverlay"]) assert.throws(() => h[name](1), /Invalid/, name);
    for (const name of ["copyRaceCode", "copyOverlayAddress"]) await assert.rejects(h[name](1), /Invalid/, name);
    assert.throws(() => h.shareCharacter(5)); assert.throws(() => h.screenshotThumb());
    x.state.activeProfileId = "none";
    for (const name of ["story", "journeyTimeline", "coachNotes"]) assert.equal(h[name](), null, name);
    assert.deepEqual([...x.privates].sort(), ["addRaceCode", "copyOverlayAddress", "copyRaceCode", "copySharePicture", "openRaceCode", "removeRaceFriend", "saveRaceCode", "screenshotThumb", "setRaceName", "setStreamOverlay", "showScreenshot"],
      "everything that changes, copies, opens a dialog or reads a picture stays out of the companion's tools");
  } finally { fs.rmSync(x.root, { recursive: true, force: true }); }
});

test("races: a typed name makes the code, friends are added by code or file, and the board compares them", async () => {
  const x = setup();
  try {
    const { handlers: h } = x;
    let view = h.raceBoard();
    assert.equal(view.code, null); assert.equal(view.exportError, "Type a display name to make your code."); assert.equal(view.levelsSaved, 2);
    assert.deepEqual(view.board.columns.map((c) => [c.name, c.kind]), [["You", "you"], ["Bram", "yours"]]);
    await assert.rejects(h.copyRaceCode(), /Type a display name/); await assert.rejects(h.saveRaceCode(), /Type a display name/);
    assert.throws(() => h.setRaceName("<b>"), /1 to 24 characters/); assert.throws(() => h.setRaceName(5));
    view = h.setRaceName("Frank");
    assert.match(view.code, /^BFRACE1\./); assert.equal(R.importCode(view.code).name, "Frank"); assert.doesNotMatch(Buffer.from(view.code.split(".")[1], "base64url").toString(), /Aeralyn|Stormhold/);
    assert.equal(await h.copyRaceCode(), true); assert.deepEqual(x.log.text, [view.code]);
    assert.deepEqual(await h.saveRaceCode(), { saved: true }); assert.deepEqual(x.log.written, [["C:/x/race.txt", `${view.code}\n`]]);
    x.dialog.save = { canceled: true }; assert.deepEqual(await h.saveRaceCode(), { saved: false });
    const mia = R.exportCode({ journal: { levels: [{ level: 12, played: 40000, at: T }, { level: 13, played: 43000, at: T + DAY }] } }, "Mia");
    for (const bad of ["", "hello", `${mia}x`, "x".repeat(9000), 5, null]) assert.throws(() => h.addRaceCode(bad), /not a leveling race code/, String(bad).slice(0, 20));
    view = h.addRaceCode(`  ${mia}  `);
    assert.equal(view.added, true); assert.deepEqual(view.friends, [{ id: mia.split(".")[2], name: "Mia", topLevel: 13 }]);
    assert.equal(h.addRaceCode(mia).added, false);
    assert.deepEqual(view.board.columns.map((c) => c.name), ["Frank", "Bram", "Mia"]);
    assert.deepEqual(view.board.rows.find((r) => r.level === 13).cells.map((c) => [c.seconds, c.fastest]), [[54000, false], [9000, true], [43000, false]]);
    assert.equal((await h.openRaceCode()).added, null, "a cancelled dialog adds nothing");
    const zed = R.exportCode({ journal: { levels: [{ level: 2, played: 100, at: T }, { level: 3, played: 300, at: T }] } }, "Zed");
    x.files.set("C:/in/zed.txt", Buffer.from(`${zed}\r\n`)); x.dialog.open = { canceled: false, filePaths: ["C:/in/zed.txt"] };
    assert.equal((await h.openRaceCode()).friends.length, 2);
    x.files.set("C:/in/big.txt", Buffer.alloc(50000, 65)); x.dialog.open = { canceled: false, filePaths: ["C:/in/big.txt"] };
    await assert.rejects(h.openRaceCode(), /too large/);
    x.files.set("C:/in/junk.txt", Buffer.from("not a code")); x.dialog.open = { canceled: false, filePaths: ["C:/in/junk.txt"] };
    await assert.rejects(h.openRaceCode(), /not a leveling race code/);
    assert.throws(() => h.removeRaceFriend("../x"), /Invalid/);
    assert.deepEqual(h.removeRaceFriend(mia.split(".")[2]).friends.map((f) => f.name), ["Zed"]);
  } finally { fs.rmSync(x.root, { recursive: true, force: true }); }
});

test("the overlay starts only from its switch, keeps its port, and shows only its few facts", async () => {
  const x = setup();
  try {
    const { handlers: h } = x;
    assert.deepEqual(h.streamOverlay(), { running: false, port: null, url: null, enabled: false,
      facts: { level: 13, xpPercent: 41, zone: "Westfall", splitSeconds: 4000, splitLabel: "Level 12 to 13", deaths: 2, step: "Hand in Red Silk Bandanas", stepDetail: "To Scout Riell at 56.0, 47.5", live: true } });
    assert.equal(await x.pages.resume(), false, "off by default: nothing starts at launch"); assert.deepEqual(x.log.starts, []);
    await assert.rejects(h.copyOverlayAddress(), /Switch the overlay on first/);
    await assert.rejects(h.setStreamOverlay("on"), /Invalid/); await assert.rejects(h.setStreamOverlay(), /Invalid/);
    const on = await h.setStreamOverlay(true);
    assert.equal(on.running, true); assert.equal(on.url, "http://127.0.0.1:50123/"); assert.deepEqual(x.journey.data.overlay, { enabled: true, port: 50123 });
    assert.equal(await h.copyOverlayAddress(), true); assert.deepEqual(x.log.text, ["http://127.0.0.1:50123/"]);
    const off = await h.setStreamOverlay(false);
    assert.equal(off.running, false); assert.deepEqual(x.journey.data.overlay, { enabled: false, port: 50123 }, "the port is remembered for next time");
    await h.setStreamOverlay(true);
    assert.deepEqual(x.log.starts, [null, 50123]);
    x.overlay.running = false;
    assert.equal(await x.pages.resume(), true, "left on: it starts again at launch, on the same port"); assert.deepEqual(x.log.starts, [null, 50123, 50123]);
    assert.doesNotMatch(JSON.stringify(x.pages.overlayFacts()), /Aeralyn|Stormhold/, "no name or realm reaches the overlay");
  } finally { fs.rmSync(x.root, { recursive: true, force: true }); }
});

test("a picture is copied only as a real PNG of a sane size", async () => {
  const x = setup();
  try {
    assert.equal(await x.handlers.copySharePicture(PNG), true); assert.equal(x.log.images.length, 1); assert.ok(Buffer.isBuffer(x.log.images[0]));
    for (const bad of [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), new Uint8Array(4), "png", null, [0x89, 0x50], new Uint8Array(9 * 1024 * 1024)]) await assert.rejects(x.handlers.copySharePicture(bad), /Invalid picture/);
    await assert.rejects(x.handlers.copySharePicture(PNG, 1), /Invalid picture/); assert.equal(isPng(PNG), true);
  } finally { fs.rmSync(x.root, { recursive: true, force: true }); }
});

function pageContext(models) {
  const context = vm.createContext({ backstage: Object.fromEntries(Object.entries(models).map(([name, value]) => [name, async () => structuredClone(value)])), structuredClone, IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    document: { addEventListener() {}, querySelector: () => null }, setTimeout });
  context.window = context;
  for (const file of ["../src/core/share-cards.cjs", "../src/renderer/share-card.js", "../src/renderer/journey-extras.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  return context;
}

test("the pages paint every view from its model, escaped and without inline styles", async () => {
  const x = setup();
  let models;
  try {
    x.handlers.setRaceName("Frank"); x.handlers.addRaceCode(R.exportCode({ journal: { levels: [{ level: 12, played: 40000, at: T }, { level: 13, played: 43000, at: T + DAY }] } }, "Mia <3".replace("<", "&")));
    x.a.name = "Aer<i>alyn";
    models = { story: x.handlers.story(), journeyTimeline: x.handlers.journeyTimeline(), raceBoard: x.handlers.raceBoard(), coachNotes: x.handlers.coachNotes(), streamOverlay: await x.handlers.setStreamOverlay(true) };
  } finally { fs.rmSync(x.root, { recursive: true, force: true }); }
  const w = pageContext(models), X = w.JourneyExtras;
  assert.deepEqual(Array.from(X.VIEWS, ([id]) => id), ["overview", "story", "timeline", "races", "coach", "overlay"]);
  const tabs = X.tabs("story");
  assert.equal((tabs.match(/data-journey-view=/g) || []).length, 6); assert.match(tabs, /data-journey-view="story" aria-pressed="true"/);
  const root = { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  const html = {};
  for (const [view] of X.VIEWS.slice(1)) {
    assert.match(X.render(view), /Reading what was saved/, `${view} waits for its model`);
    await new Promise((resolve) => { X.mounted(root, view, resolve); });
    html[view] = X.render(view);
    assert.doesNotMatch(html[view], /\sstyle=/, `${view}: the page's CSP forbids inline styles`);
    assert.doesNotMatch(html[view], /undefined|NaN|\[object/, view);
  }
  assert.match(html.story, /The story so far/); assert.match(html.story, /Aer&lt;i&gt;alyn/); assert.doesNotMatch(html.story, /<i>alyn/); assert.match(html.story, /data-story-chapter="zones"/);
  assert.match(html.story, /data-share-card="\{&quot;kind&quot;:&quot;story&quot;/); assert.match(html.story, /Pictures to share/);
  assert.match(html.timeline, /1 screenshot read from your game&#39;s Screenshots folder/); assert.match(html.timeline, /data-shot="WoWScrnShot_1\.jpg"/); assert.match(html.timeline, /Level 12 · Westfall · from a play session/);
  assert.match(html.timeline, /never moves, changes or sends them/); assert.match(html.timeline, /data-shot-show="WoWScrnShot_1\.jpg"/);
  assert.match(html.races, /BFRACE1\./); assert.match(html.races, /Mia &amp;3/); assert.match(html.races, /class="jx-fastest"/); assert.match(html.races, /No realm, class or account/); assert.match(html.races, /there is no server/);
  assert.match(html.coach, /What went well/); assert.match(html.coach, /One thing to change/); assert.match(html.coach, /Tomorrow's first step/); assert.match(html.coach, /Hand in Red Silk Bandanas/);
  assert.match(html.coach, /Unspent talent points are not in the saved data/);
  assert.match(html.overlay, /The overlay is on/); assert.match(html.overlay, /http:\/\/127\.0\.0\.1:50123\//); assert.match(html.overlay, /Only this computer can open it/); assert.match(html.overlay, /aria-pressed="true"/);
  X.invalidate();
  assert.match(X.render("story"), /Reading what was saved/, "a new character starts from nothing");
});

test("the pages say plainly when there is nothing to show", async () => {
  const w = pageContext({ story: { name: "Bram", enough: false, chapters: [], notSaved: ["No level has a saved date yet. Gain a level with the addon on."], cards: [], hasQuestReference: false },
    journeyTimeline: { days: [], counts: { rows: 0, shots: 0, placed: 0 }, folder: { connected: false, found: false, limit: 200 } },
    raceBoard: { name: "", code: null, exportError: "Type a display name to make your code.", levelsSaved: 0, friends: [], limits: { friends: 12, name: 24 }, board: { columns: [], rows: [], standings: [] } },
    coachNotes: { status: "first-save", from: null, to: T, wentWell: [], change: null, tomorrow: null, noStepReason: "No next step can be worked out from the saved data. Open Now after your next save.", message: "Coach's notes compare two saves, and this is the first one the app has kept for this character. They start with your next save." },
    streamOverlay: { running: false, port: null, url: null, enabled: false, facts: {} } });
  const X = w.JourneyExtras, root = { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, html = {};
  for (const [view] of X.VIEWS.slice(1)) { await new Promise((resolve) => { X.mounted(root, view, resolve); }); html[view] = X.render(view); }
  assert.match(html.story, /There is no story to tell yet/); assert.match(html.story, /Not saved/); assert.match(html.story, /quest reference is not loaded/); assert.doesNotMatch(html.story, /Pictures to share/);
  assert.match(html.timeline, /Connect your game folder in Settings/); assert.match(html.timeline, /Nothing with a saved date yet/);
  assert.match(html.races, /Type a display name to make your code/); assert.match(html.races, /No level times to compare yet/); assert.match(html.races, /No friends added yet/);
  assert.match(html.coach, /Not yet/); assert.match(html.coach, /this is the first one the app has kept/); assert.match(html.coach, /No next step can be worked out/); assert.doesNotMatch(html.coach, /What went well/);
  assert.match(html.overlay, /The overlay is off/); assert.match(html.overlay, /While it is off the app listens to nothing/); assert.match(html.overlay, /aria-pressed="false"/);
});

test("Journey keeps one section: the views are a switch inside the page, wired through the preload", () => {
  const journey = read("src/renderer/journey.js"), nav = read("src/renderer/player-navigation.js"), preload = read("src/preload.cjs"), main = read("src/main.cjs"), html = read("src/renderer/index.html");
  assert.match(journey, /JourneyExtras\.tabs\(view\)/); assert.match(journey, /let view = "overview";/);
  assert.doesNotMatch(nav, /"story"|"races"|"coach"|"overlay"|"timeline"/, "no new routes or tabs");
  for (const name of ["story", "journeyTimeline", "screenshotThumb", "showScreenshot", "raceBoard", "setRaceName", "addRaceCode", "removeRaceFriend", "copyRaceCode", "saveRaceCode", "openRaceCode", "coachNotes", "streamOverlay", "setStreamOverlay", "copyOverlayAddress", "shareCharacter", "copySharePicture"]) {
    assert.ok(preload.includes(`invoke("${name}"`), `${name} is exposed`);
  }
  assert.match(main, /journeyStore\?\.absorb\(store\.state\)/); assert.match(main, /journeyStore\?\.recordDeath\(/); assert.match(main, /clearJourneyExtras\?\.\(\)/, "Delete all local data clears the journey file and the previews");
  assert.ok(html.includes('href="journey-extras.css"') && html.includes('src="journey-extras.js"'));
});
