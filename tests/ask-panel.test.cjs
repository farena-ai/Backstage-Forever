"use strict";
// 0.38 (A15): the in-game answer panel (placement math, a window that never takes focus, auto-hide,
// settings, IPC from its own page only) and the routing of in-game questions through the
// Companion's answer path with the Companion page's own sharing choice.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const P = require("../src/core/ask-panel.cjs");
const { InGameAsk, sharing, playerMessage } = require("../src/core/ask-in-game.cjs");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }, SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

test("placement: top-right of the game, just under the minimap, inside the screen", () => {
  const game = { x: 1920, y: 0, width: 2560, height: 1440 };
  const p = P.placePanel({ game, areas: [PRIMARY, SECOND], fallback: PRIMARY });
  assert.deepEqual(p, { x: 1920 + 2560 - 420 - 16, y: Math.round(1440 * 0.25) + 8, width: 420, height: 260, anchor: "game" });
  // A windowed game: the panel follows the window, not the screen.
  assert.deepEqual(P.placePanel({ game: { x: 200, y: 100, width: 1280, height: 720 }, areas: [PRIMARY] }), { x: 200 + 1280 - 436, y: 100 + 180 + 8, width: 420, height: 260, anchor: "game" });
  // A game window hanging off the right of the screen: clamped back in.
  const off = P.placePanel({ game: { x: 1700, y: 900, width: 1280, height: 720 }, areas: [PRIMARY] });
  assert.equal(off.x, 1920 - 420); assert.equal(off.y, 1040 - 260);
  // Smaller than the panel: still on screen.
  const tiny = P.placePanel({ game: { x: 0, y: 0, width: 300, height: 200 }, areas: [PRIMARY] });
  assert.ok(tiny.x >= 0 && tiny.y >= 0 && tiny.x + 420 <= 1920);
  // A game across two screens: the screen that holds its top-right corner.
  const span = P.placePanel({ game: { x: 1000, y: 0, width: 1600, height: 900 }, areas: [PRIMARY, SECOND] });
  assert.ok(span.x >= SECOND.x && span.x + 420 <= SECOND.x + SECOND.width, JSON.stringify(span));
});

test("placement without a game rectangle uses the display the player is on; a dragged spot wins while it is on screen", () => {
  assert.deepEqual(P.placePanel({ areas: [PRIMARY, SECOND], fallback: SECOND }), { x: 1920 + 2560 - 436, y: 350 + 8, width: 420, height: 260, anchor: "display" });
  assert.deepEqual(P.placePanel({ areas: [PRIMARY], fallback: null }), { x: 1920 - 436, y: 260 + 8, width: 420, height: 260, anchor: "display" });
  assert.equal(P.placePanel({ areas: [PRIMARY, SECOND], saved: { x: 2000, y: 40 }, game: { x: 0, y: 0, width: 800, height: 600 } }).anchor, "saved");
  assert.equal(P.placePanel({ areas: [PRIMARY], saved: { x: 1800, y: 40 }, fallback: PRIMARY }).anchor, "display", "a spot that no longer fits (monitor unplugged) is ignored");
  assert.equal(P.placePanel({ areas: [PRIMARY], saved: { x: Number.NaN, y: 1 }, fallback: PRIMARY }).anchor, "display");
});

test("panel state and settings are bounded", () => {
  assert.deepEqual(P.panelState({ status: "answer", question: "q".repeat(500), answer: { text: "a", kind: "travel" }, at: 5 }), { status: "answer", question: "q".repeat(400), at: 5, answer: { text: "a", kind: "travel" } });
  assert.equal(P.panelState({ status: "weird" }).status, "error");
  assert.match(P.panelState({ status: "error" }).message, /Open the app/);
  assert.deepEqual(P.cleanSettings({ enabled: false, hideAfterS: 7, position: { x: 1.5, y: 2 } }), { enabled: false, hideAfterS: 45, position: null });
  assert.deepEqual(P.cleanSettings({ hideAfterS: 0, position: { x: -100, y: 20 } }), { enabled: true, hideAfterS: 0, position: { x: -100, y: 20 } });
});

function fakeElectron() {
  const handlers = new Map(), windows = [], timers = [];
  class Win {
    constructor(opts) { this.opts = opts; this.events = {}; this.once = this.on; this.sent = []; this.visible = false; this.destroyed = false; this.calls = []; windows.push(this); this.bounds = null; this.position = [0, 0];
      this.webContents = { send: (c, v) => this.sent.push([c, v]), setWindowOpenHandler: () => {}, on: () => {}, mainFrame: {} }; this.webContents.mainFrame = { url: null }; }
    on(e, f) { (this.events[e] ||= []).push(f); }
    emit(e) { for (const f of this.events[e] || []) f(); }
    setAlwaysOnTop(...a) { this.calls.push(["setAlwaysOnTop", ...a]); }
    loadURL(u) { this.url = u; this.webContents.mainFrame.url = u; }
    setBounds(b) { this.bounds = b; }
    getPosition() { return this.position; }
    showInactive() { this.visible = true; this.calls.push(["showInactive"]); }
    show() { this.calls.push(["show"]); } focus() { this.calls.push(["focus"]); }
    hide() { this.visible = false; } isVisible() { return this.visible; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const ipcMain = { handle: (c, f) => handlers.set(c, f), removeHandler: (c) => handlers.delete(c) };
  const screen = { getAllDisplays: () => [{ workArea: PRIMARY }, { workArea: SECOND }], getCursorScreenPoint: () => ({ x: 2500, y: 500 }), getDisplayNearestPoint: () => ({ workArea: SECOND }), getPrimaryDisplay: () => ({ workArea: PRIMARY }), screenToDipRect: (_w, r) => ({ ...r }) };
  const setTimer = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  return { BrowserWindow: Win, ipcMain, screen, handlers, windows, timers, setTimer, clearTimer };
}

test("the panel window: frameless, always on top above full-screen games, off the taskbar, never focusable, shown inactive", () => {
  const e = fakeElectron(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ask-panel-"));
  let rect = { x: 1920, y: 0, width: 2560, height: 1440 }, opened = 0;
  const panel = P.createAskPanel({ ...e, rendererDir: path.join(root, "src/renderer"), dataDir: dir, gameRect: () => rect, onOpenApp: () => opened++ });
  assert.equal(panel.show({ status: "thinking", question: "Where is the inn?" }), true);
  const w = e.windows[0];
  assert.equal(w.opts.frame, false); assert.equal(w.opts.alwaysOnTop, true); assert.equal(w.opts.skipTaskbar, true); assert.equal(w.opts.focusable, false); assert.equal(w.opts.show, false);
  assert.equal(w.opts.width, 420); assert.equal(w.opts.height, 260);
  assert.equal(w.opts.webPreferences.sandbox, true); assert.equal(w.opts.webPreferences.contextIsolation, true); assert.equal(w.opts.webPreferences.nodeIntegration, false);
  assert.match(w.opts.webPreferences.preload, /ask-panel-preload\.cjs$/);
  assert.deepEqual(w.calls[0], ["setAlwaysOnTop", true, "screen-saver"]);
  assert.match(w.url, /ask-panel\.html$/);
  w.emit("ready-to-show");
  assert.deepEqual(w.bounds, { x: 1920 + 2560 - 436, y: 368, width: 420, height: 260 });
  assert.ok(w.calls.some((c) => c[0] === "showInactive") && !w.calls.some((c) => c[0] === "show" || c[0] === "focus"), "never takes focus");
  assert.equal(e.timers.filter((t) => !t.cleared).length, 0, "no auto-hide while thinking");
  // The answer replaces the thinking state in place and starts the auto-hide clock.
  panel.show({ status: "answer", question: "Where is the inn?", answer: { text: "**North** of the bank.", kind: "npc" } });
  assert.equal(e.windows.length, 1);
  assert.equal(w.sent.at(-1)[0], "askPanel:state"); assert.equal(w.sent.at(-1)[1].answer.text, "**North** of the bank.");
  const live = e.timers.filter((t) => !t.cleared);
  assert.equal(live.length, 1); assert.equal(live[0].ms, 45000);
  // IPC only from the panel's own page.
  const ev = (sender) => ({ sender, senderFrame: sender.mainFrame });
  assert.throws(() => e.handlers.get("askPanel:state")(ev({ mainFrame: { url: w.url } })), /Untrusted/);
  assert.equal(e.handlers.get("askPanel:state")(ev(w.webContents)).status, "answer");
  // Hovering holds it; leaving restarts the clock; the clock hides it.
  e.handlers.get("askPanel:hold")(ev(w.webContents), true);
  assert.equal(e.timers.filter((t) => !t.cleared).length, 0);
  e.handlers.get("askPanel:hold")(ev(w.webContents), false);
  const due = e.timers.filter((t) => !t.cleared)[0]; due.cleared = true; due.fn();
  assert.equal(w.visible, false);
  // A new question shows it again, placed again (the game window moved).
  rect = { x: 0, y: 0, width: 1920, height: 1040 };
  panel.show({ status: "thinking", question: "Next?" });
  assert.equal(w.visible, true); assert.deepEqual(w.bounds, { x: 1920 - 436, y: 268, width: 420, height: 260 });
  // Open in app: hides the panel and asks the main window to show the Companion page.
  e.handlers.get("askPanel:openApp")(ev(w.webContents));
  assert.equal(opened, 1); assert.equal(w.visible, false);
  // The player drags it: that spot is kept (and saved) until reset in Settings.
  w.position = [2100, 600]; w.emit("moved");
  assert.equal(panel.settings().moved, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "ask-panel.json"), "utf8")).position, { x: 2100, y: 600 });
  panel.show({ status: "thinking", question: "Again" });
  assert.deepEqual([w.bounds.x, w.bounds.y], [2100, 600]);
  assert.equal(panel.setSettings({ resetPosition: true }).moved, false);
  // Settings: off means no panel at all; bad values are refused; the choice is remembered.
  assert.deepEqual(panel.setSettings({ hideAfterS: 0 }), { enabled: true, hideAfterS: 0, moved: false, choices: [0, 20, 45, 90, 180] });
  panel.show({ status: "answer", question: "x", answer: { text: "y" } });
  assert.equal(e.timers.filter((t) => !t.cleared).length, 0, "0 = stays until closed");
  assert.throws(() => panel.setSettings({ hideAfterS: 13 }), /Invalid/); assert.throws(() => panel.setSettings({ enabled: "no" }), /Invalid/); assert.throws(() => panel.setSettings(null), /Invalid/);
  panel.setSettings({ enabled: false });
  assert.equal(w.visible, false);
  assert.equal(panel.show({ status: "thinking", question: "hidden?" }), false);
  assert.equal(w.visible, false);
  const again = P.createAskPanel({ ...fakeElectron(), rendererDir: path.join(root, "src/renderer"), dataDir: dir });
  assert.equal(again.settings().enabled, false); assert.equal(again.settings().hideAfterS, 0);
  panel.close();
  assert.equal(w.destroyed, true); assert.equal(e.handlers.size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sharing follows the Companion page's choice and never describes another character", () => {
  assert.deepEqual(sharing({ share: false, expected: 7, characterHash: 7 }), { shareProfile: false, note: null });
  assert.deepEqual(sharing({ share: true, expected: 7, characterHash: 7 }), { shareProfile: true, note: null });
  assert.deepEqual(sharing({ share: true, expected: null, characterHash: 7 }), { shareProfile: true, note: null });
  const other = sharing({ share: true, expected: 7, characterHash: 8 });
  assert.equal(other.shareProfile, false); assert.match(other.note, /another character/);
  assert.match(playerMessage(Error("Choose a model in Connections for AI questions.")), /free AI \(one click/);
  assert.equal(playerMessage(Error("Could not reach Ollama.")), "Could not reach Ollama.");
  assert.equal(playerMessage(Error("ENOENT C:\\secret\\path")), "The companion could not answer. Open the app to try again.");
});

function routing({ share = true, results = [], activeKey = 4242 } = {}) {
  const asked = [], shown = [], notified = [], waits = [];
  let t = 0;
  const companion = { ask: async (req) => { asked.push(req); const r = results.shift(); if (r instanceof Error) throw r; return r; } };
  const state = { activeProfileId: "p1", provider: { id: "local", model: "local" }, profiles: [{ id: "p1", name: "Aeralyn", source: { kind: "wow-addon", id: "S1" } }] };
  const ask = new InGameAsk({ companion, getState: () => state, liveKeyFor: (id) => (id === "S1" ? activeKey : null), panel: { show: (s) => shown.push(s) }, notify: (x) => notified.push(x), getShare: () => share, wait: async (ms) => { waits.push(ms); t += ms; }, now: () => t });
  return { ask, asked, shown, notified, waits };
}

test("an in-game question goes through the Companion's answer path with only the typed text and the existing sharing choice", async () => {
  const r = routing({ results: [{ text: "Head **north**.", kind: "travel", conversation: { usedTurns: 0 } }] });
  await r.ask.handle({ id: 3, text: "  How do I get to Thunder Bluff?  ", characterHash: 4242 });
  assert.deepEqual(r.asked, [{ provider: "local", prompt: "How do I get to Thunder Bluff?", shareProfile: true, memoryIds: [], profileId: "p1" }]);
  assert.deepEqual(r.shown.map((s) => s.status), ["thinking", "answer"]);
  assert.equal(r.shown[1].answer.text, "Head **north**."); assert.equal(r.shown[1].answer.kind, "travel"); assert.equal(r.shown[1].question, "How do I get to Thunder Bluff?");
  assert.equal(r.notified.length, 1); assert.equal(r.notified[0].question, "How do I get to Thunder Bluff?"); assert.equal(r.notified[0].shareProfile, true);
  // Sharing off on the Companion page: off here too.
  const off = routing({ share: false, results: [{ text: "ok", kind: "ai" }] });
  await off.ask.handle({ id: 4, text: "Hi", characterHash: 4242 });
  assert.equal(off.asked[0].shareProfile, false);
  // Asked by a character that is not the app's active one: no character details, and the panel says so.
  const other = routing({ results: [{ text: "ok", kind: "ai" }] });
  await other.ask.handle({ id: 5, text: "Hi", characterHash: 99 });
  assert.equal(other.asked[0].shareProfile, false); assert.match(other.shown[1].note, /another character/);
});

test("in-game questions are answered one at a time, wait briefly for a busy companion, and explain a missing AI", async () => {
  const busy = Error("Provider request already in progress.");
  const r = routing({ results: [busy, busy, { text: "first", kind: "quick" }, Error("Choose a model in Connections for AI questions. Local NPC locations need no model."), { text: "third", kind: "ai" }] });
  await Promise.all([r.ask.handle({ text: "one" }), r.ask.handle({ text: "two" }), r.ask.handle({ text: "three" }), r.ask.handle({ text: "" }), r.ask.handle({ text: 5 })]);
  assert.deepEqual(r.asked.map((q) => q.prompt), ["one", "one", "one", "two", "three"]);
  assert.deepEqual(r.waits, [2000, 2000]);
  const final = r.shown.filter((s) => s.status !== "thinking");
  assert.deepEqual(final.map((s) => s.status), ["answer", "error", "answer"]);
  assert.match(final[1].message, /free AI/);
  assert.deepEqual(r.notified.map((n) => n.result.text), ["first", "third"], "only answers join the conversation");
  // A companion that stays busy gives up after 30 seconds with a clear message.
  const stuck = routing({ results: Array(40).fill(busy) });
  await stuck.ask.handle({ text: "stuck" });
  assert.equal(stuck.shown.at(-1).status, "error"); assert.ok(stuck.waits.length >= 15 && stuck.waits.length <= 16);
});

test("main wires the strip's questions to the panel; the panel page keeps the renderer rules", () => {
  const main = read("src/main.cjs");
  assert.match(main, /liveBridge\.subscribeQuestions\(\(question\) => \{ void inGameAsk\.handle\(question\); \}\)/);
  assert.match(main, /createAskPanel\(/); assert.match(main, /closeAskPanel\?\.\(\)/); assert.match(main, /win\.on\("closed", \(\) => dropAskPanelWindow\?\.\(\)\)/);
  for (const name of ["askInGameSettings", "setAskInGameSettings", "setInGameShare"]) assert.match(main, new RegExp(`handle\\("${name}"`));
  const html = read("src/renderer/ask-panel.html");
  assert.match(html, /Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self';/);
  for (const f of ["src/renderer/ask-panel.html", "src/renderer/ask-panel.js", "src/renderer/ask-in-game.js"]) {
    assert.doesNotMatch(read(f), /style=|\.style\.|<script>[^<]/, `${f}: no inline styles or scripts`);
  }
  assert.match(read("src/renderer/ask-panel.js"), /CompanionReply\.render\(/, "answers are formatted and escaped like the companion chat");
  assert.match(html, /<script src="companion-reply\.js"><\/script>/);
  const preload = read("src/ask-panel-preload.cjs");
  assert.deepEqual([...preload.matchAll(/invoke\("([^"]+)"/g)].map((m) => m[1]), ["askPanel:state", "askPanel:close", "askPanel:openApp", "askPanel:hold"]);
  assert.match(read("src/renderer/index.html"), /<script src="ask-in-game\.js"><\/script>/);
});

test("Settings -> Game connection shows the panel switch (on by default) and the hide choice; the share choice is reported", () => {
  const calls = [], listeners = {};
  const store = { "bf-share-character": "false" };
  const c = {
    window: { backstage: { askInGameSettings: async () => ({ enabled: true, hideAfterS: 45, moved: false, choices: [0, 20, 45, 90, 180] }), setAskInGameSettings: async (x) => { calls.push(["set", x]); return { enabled: true, hideAfterS: 45, moved: false, choices: [0, 20, 45, 90, 180] }; }, setInGameShare: async (v) => { calls.push(["share", v]); return true; } } },
    document: { querySelectorAll: () => [], addEventListener: (e, f) => { listeners[e] = f; } },
    localStorage: { getItem: (k) => store[k] ?? null },
  };
  vm.createContext(c);
  vm.runInContext(read("src/renderer/ask-in-game.js"), c);
  const html = c.window.AskInGame.markup();
  assert.match(html, /<input type="checkbox" id="ask-panel-toggle" checked>Answer in-game questions in a panel over the game/);
  assert.match(html, /<option value="45" selected>after 45 seconds<\/option>/); assert.match(html, /only when I close it/);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(["share", false]), "the Companion page's choice is reported at start");
  listeners.change({ target: { id: "share-profile", checked: true } });
  listeners.change({ target: { id: "ask-panel-toggle", checked: false } });
  assert.equal(JSON.stringify(calls.slice(1)), JSON.stringify([["share", true], ["set", { enabled: false }]]));
  assert.match(read("src/renderer/app.js"), /window\.AskInGame \? AskInGame\.markup\(\) : ""/);
  assert.match(read("src/renderer/app.js"), /data-guide-ask-in-game/);
});
