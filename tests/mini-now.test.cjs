"use strict";
// Mini Now (0.44, 3.4) and the one-line next step shared with spoken steps (3.5).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const vm = require("node:vm");
const { nextStep, direction } = require("../src/core/next-step.cjs");
const { miniNowView, createMiniNow } = require("../src/core/mini-now-window.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const advice = (o = {}) => ({ character: { name: "Vael", level: 15, zone: "Durotar", live: true, xp: { current: 300, max: 1000, rested: 200 }, xpPercent: 31.6, position: { mapId: 1411, x: 0.5, y: 0.5 }, ...(o.character || {}) },
  log: { ready: [], active: [], ...(o.log || {}) }, next: o.next ?? { mapId: 1411, name: "Durotar", min: 1, max: 10, why: "you're already here", quests: [{ id: 9, title: "Vile Familiars", giver: "Zureetha", x: 0.5, y: 0.2 }] } });

test("directions read like a compass from where you stand; other maps name the zone", () => {
  const me = { mapId: 1, x: 0.5, y: 0.5 };
  assert.equal(direction(me, { mapId: 1, x: 0.7, y: 0.7 }).words, "south-east");
  assert.equal(direction(me, { mapId: 1, x: 0.5, y: 0.45 }).words, "a short way north");
  assert.equal(direction(me, { mapId: 1, x: 0.505, y: 0.5 }).words, "right here");
  assert.equal(direction(me, { mapId: 2, x: 0.1, y: 0.1 }), null);
});

test("next step: hand-ins first, then the nearest objective, then a pickup, then a zone; dead comes first of all", () => {
  const hand = nextStep(advice({ log: { ready: [{ id: 1, title: "Call of Water", turnIn: { name: "Islen Waterseer", mapId: 1411, x: 0.7, y: 0.7 } }], active: [{ id: 2, title: "Raptor Thieves", done: 1, total: 2, next: "Raptor Head 3/12" }] } }));
  assert.equal(hand.kind, "turnin"); assert.equal(hand.title, "Hand in Call of Water");
  assert.equal(hand.spoken, "Hand in Call of Water to Islen Waterseer, south-east.");
  assert.match(hand.detail, /To Islen Waterseer at 70\.0, 70\.0/);
  const obj = nextStep(advice({ log: { active: [{ id: 2, title: "Raptor Thieves", done: 1, total: 2, next: "Raptor Head 3/12", where: { mapId: 1413, mapName: "The Barrens", x: 0.5, y: 0.5 } }] } }));
  assert.equal(obj.kind, "objective"); assert.equal(obj.progress, "1/2"); assert.equal(obj.dir, "in The Barrens");
  assert.equal(obj.spoken, "Raptor Thieves: Raptor Head 3/12, in The Barrens.");
  const pick = nextStep(advice());
  assert.equal(pick.kind, "pickup"); assert.equal(pick.spoken, "Pick up Vile Familiars from Zureetha, north.");
  assert.equal(nextStep(advice({ next: { name: "The Barrens", min: 10, max: 25, why: "next up", quests: [] } })).title, "Head to The Barrens");
  assert.equal(nextStep(advice({ character: { dead: true } })).kind, "dead");
  assert.equal(nextStep({ status: "no-character" }), null);
  // The real advisor answers with status "ok": that is a usable answer, not a failure.
  assert.equal(nextStep({ ...advice(), status: "ok" }).kind, "pickup");
  assert.equal(nextStep({ ...advice(), status: "no-level" }), null);
});

test("mini Now view: step, XP with rested, pace; a plain message without a character", () => {
  const v = miniNowView(advice(), { active: true, levelsPerHour: 1.4, minutesToLevel: 29, activeMinutes: 50, deaths: 1 });
  assert.equal(v.ready, true); assert.equal(v.xpPercent, 31); assert.equal(v.restedPercent, 20);
  assert.equal(v.step.kind, "pickup"); assert.deepEqual(v.pace, { levelsPerHour: 1.4, minutesToLevel: 29, minutes: 50, deaths: 1 });
  assert.equal(miniNowView({ status: "no-character" }).ready, false);
  assert.equal(miniNowView({ ...advice(), status: "ok" }).ready, true, "the advisor's own \"ok\" answer is shown");
  assert.equal(miniNowView(advice(), { active: false }).pace, null);
});

test("mini Now uses the shared choice and labels the quest evidence independently of live location", () => {
  const selected = { kind: "objective", key: "quest:9", title: "Vile Familiars", where: { mapName: "Durotar" }, reason: "Your closest quest" };
  const saved = miniNowView(advice({ log: { live: false, known: true } }), null, selected);
  assert.equal(saved.step, selected);
  assert.equal(saved.evidence, "saved");
  assert.equal(miniNowView(advice({ log: { live: true } }), null, selected).evidence, "live");
  assert.equal(miniNowView(advice(), null, { ...selected, source: "reference" }).evidence, "reference");
  assert.equal(miniNowView(advice(), null, null).step, null);
});

test("mini Now keeps the detail controls mounted and announces only a changed action", () => {
  const announcements = [], elements = new Map();
  for (const key of ["who", "step", "details", "details-panel"]) elements.set(`[data-mn-${key}]`, { innerHTML: "", textContent: "", hidden: false, querySelectorAll: () => [] });
  elements.set("[data-mn-announcement]", { set textContent(value) { announcements.push(value); } });
  let emit;
  const window = { miniNow: { onState(handler) { emit = handler; }, state: () => new Promise(() => {}) } };
  const document = { addEventListener() {}, querySelector: (key) => elements.get(key) };
  vm.runInNewContext(read("src/renderer/mini-now.js"), { window, document });
  const data = { ready: true, name: "Vael", level: 15, zone: "Durotar", xpPercent: 31, restedPercent: 20, evidence: "saved", step: { key: "quest:9", kind: "objective", title: "Vile Familiars", detail: "Collect 2 heads", where: { mapName: "Durotar" }, dir: "north", reason: "Your closest quest" } };
  emit(data);
  assert.match(elements.get("[data-mn-step]").innerHTML, /Vile Familiars/);
  assert.match(elements.get("[data-mn-step]").innerHTML, /Durotar/);
  assert.match(elements.get("[data-mn-step]").innerHTML, /Last saved/);
  assert.doesNotMatch(elements.get("[data-mn-step]").innerHTML, /Your closest quest|Collect 2 heads/);
  assert.match(elements.get("[data-mn-details]").innerHTML, /Your closest quest/);
  emit({ ...data, xpPercent: 33, evidence: "live", step: { ...data.step, dir: "south" } });
  assert.equal(announcements.length, 1);
  emit({ ...data, step: { ...data.step, key: "quest:10", title: "Sarkoth" } });
  assert.equal(announcements.length, 2);
  assert.match(announcements[1], /Sarkoth/);
});

test("the window opens without taking focus, trusts only its own page and cleans up", () => {
  const handlers = {}, sent = [];
  let created = null;
  class FakeWin {
    constructor(o) { created = this; this.o = o; this.listeners = {}; this.webContents = { send: (c, v) => sent.push([c, v]), setWindowOpenHandler() {}, on() {}, mainFrame: {} }; this.webContents.mainFrame = { url: "" }; }
    setAlwaysOnTop(a, b) { this.top = [a, b]; } once(e, f) { this.listeners[e] = f; } on(e, f) { this.listeners["on:" + e] = f; }
    loadURL(u) { this.url = u; this.webContents.mainFrame.url = u; } showInactive() { this.inactive = (this.inactive || 0) + 1; } show() { throw Error("must not take focus"); } focus() { throw Error("must not take focus"); }
    isDestroyed() { return false; } close() { this.listeners["on:closed"]?.(); }
  }
  let nowOpens = 0;
  const chosen = { kind: "objective", title: "Selected route stop" };
  const m = createMiniNow({ BrowserWindow: FakeWin, ipcMain: { handle: (c, f) => { handlers[c] = f; } }, advise: () => advice(), getStep: () => chosen, onOpenNow: () => { nowOpens++; }, session: () => null, live: { subscribe: () => () => {} }, rendererDir: path.join(__dirname, "../src/renderer") });
  m.open(); created.listeners["ready-to-show"]();
  assert.equal(created.inactive, 1); assert.equal(created.o.show, false); assert.equal(created.o.alwaysOnTop, true);
  assert.equal(created.o.webPreferences.sandbox, true); assert.equal(created.o.webPreferences.contextIsolation, true);
  assert.match(created.o.webPreferences.preload, /mini-now-preload\.cjs$/);
  const own = { sender: created.webContents, senderFrame: created.webContents.mainFrame };
  try {
    assert.equal(handlers["miniNow:state"](own).step, chosen);
    assert.throws(() => handlers["miniNow:state"]({ sender: {}, senderFrame: {} }), /Untrusted/);
    assert.throws(() => handlers["miniNow:openNow"]({ sender: {}, senderFrame: {} }), /Untrusted/);
    assert.throws(() => handlers["miniNow:openNow"](own, "other-page"), /Invalid/);
    assert.equal(handlers["miniNow:openNow"](own), true);
    assert.equal(nowOpens, 1);
    m.push(true); assert.equal(sent[0][0], "miniNow:state");
  } finally { m.close(); }
  assert.equal(m.isOpen(), false);
});

test("mini Now is wired: Now button, preload, CSP without inline styles, help entry", () => {
  assert.match(read("src/renderer/now.js"), /data-now-act="mini"/);
  assert.match(read("src/preload.cjs"), /openMiniNow: \(\) => invoke\("openMiniNow"\)/);
  assert.match(read("src/main.cjs"), /handle\("openMiniNow"/);
  const html = read("src/renderer/mini-now.html");
  assert.match(html, /style-src 'self'/); assert.doesNotMatch(read("src/renderer/mini-now.js"), /style="/);
  assert.match(html, /<details[^>]+data-mn-details-panel/);
  assert.match(html, /data-mn="open-now"/);
  assert.doesNotMatch(html, /<main[^>]+aria-live/);
  assert.match(read("src/renderer/commands.js"), /name: "Mini Now"/);
});
