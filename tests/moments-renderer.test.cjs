"use strict";
// Moment cards and the death screen, run against a tiny fake DOM (no Electron).
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

function fakeDom() {
  const body = [], timers = [];
  const el = (tag) => {
    const e = { tag, className: "", innerHTML: "", dataset: {}, attrs: {}, listeners: {}, removed: false,
      style: { setProperty() {} },
      classList: { add: (c) => { if (!e.className.split(" ").includes(c)) e.className += ` ${c}`; }, remove: (c) => { e.className = e.className.split(" ").filter((x) => x !== c).join(" "); }, contains: (c) => e.className.split(" ").includes(c) },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
      querySelectorAll: () => [], querySelector: () => null, remove() { this.removed = true; const i = body.indexOf(this); if (i >= 0) body.splice(i, 1); } };
    return e;
  };
  const docListeners = {};
  const document = {
    body: { appendChild: (e) => { body.push(e); return e; } },
    createElement: el,
    querySelector: (sel) => (sel === ".bf-celebrate" ? body.find((e) => e.className.includes("bf-celebrate")) || null : null),
    querySelectorAll: () => [],
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); }, removeEventListener() {},
  };
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const flush = (max = 20) => { for (let i = 0; i < max && timers.length; i++) timers.shift().fn(); };
  return { body, timers, flush, document, setTimeout, docListeners, el };
}
function renderer() {
  const dom = fakeDom();
  let onMoment = null;
  const status = { settings: { enabled: true, kinds: { death: true, zone: false } }, kinds: [{ kind: "death", label: "Death screen" }, { kind: "zone", label: "New zones" }], recent: [] };
  const window = { backstage: { moments: async () => status, setMomentSettings: async () => status, onMoment: (fn) => { onMoment = fn; } }, matchMedia: () => ({ matches: false }) };
  const context = { window, document: dom.document, setTimeout: dom.setTimeout, clearTimeout() {}, requestAnimationFrame: (fn) => fn(), Date, console, Promise };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../src/renderer/moments.js"), "utf8"), context);
  return { view: window.MomentsView, dom, send: (m) => onMoment(m) };
}
const card = (over = {}) => ({ id: "m1", at: Date.now(), kind: "elite", title: "Elite defeated", subject: "Defias <Pillager>", line: "Defias Pillager (level 17, elite) is down.", ...over });
const death = (over = {}) => ({ id: "d1", at: Date.now(), kind: "death", title: "You died", line: "x", death: { killer: "Defias Pillager", level: 17, elite: true, share: 72, others: 1, aboveYou: 2, change: "Bring a group.", corpseRun: ["Release", "Run", "Spirit Healer"] }, ...over });

test("a moment shows one painted card at a time, escaped, with its medallion", () => {
  const r = renderer();
  r.send(card());
  r.send(card({ id: "m2", kind: "zone", subject: "Westfall" }));
  const shown = r.dom.body.filter((e) => e.className.includes("bf-moment"));
  assert.equal(shown.length, 1, "no overlapping cards");
  assert.match(shown[0].className, /bf-moment-elite/);
  assert.match(shown[0].innerHTML, /src="art\/moments\/elite\.png"/);
  assert.match(shown[0].innerHTML, /Defias &lt;Pillager&gt;/);
  assert.doesNotMatch(shown[0].innerHTML, /<Pillager>/);
  assert.equal(r.view._state().queue.length, 1, "the next one waits");
  r.dom.flush(4);
  const now = r.dom.body.filter((e) => e.className.includes("bf-moment") && !e.removed);
  assert.equal(now.length, 1); assert.match(now[0].className, /bf-moment-zone/);
});

test("a death opens the death screen first, and the addon's fuller review updates it in place", () => {
  const r = renderer();
  r.send(card());
  r.send(death({ death: { killer: null, unknown: true, corpseRun: ["Release"], change: "Eat and drink." } }));
  assert.match(r.dom.body[0].className, /leaving/, "the card steps aside");
  r.dom.flush(3);
  const screen = r.dom.body.find((e) => e.className === "bf-death");
  assert.ok(screen, "death screen shown");
  assert.equal(screen.attrs.role, "dialog"); assert.equal(screen.attrs["aria-modal"], "true");
  assert.match(screen.innerHTML, /full review arrives/);
  r.send(death({ update: true }));
  assert.match(screen.innerHTML, /Defias Pillager/); assert.match(screen.innerHTML, /What to change/); assert.match(screen.innerHTML, /Bring a group\./);
  assert.match(screen.innerHTML, /data-share="72"/); assert.match(screen.innerHTML, /2 above you/);
  assert.equal(r.view._state().status.recent.length, 2, "one death and one card in Recent");
});

test("moments wait for the level-up celebration", () => {
  const r = renderer();
  const party = r.dom.el("div"); party.className = "bf-celebrate"; r.dom.document.body.appendChild(party);
  r.send(card());
  assert.equal(r.dom.body.filter((e) => e.className.includes("bf-moment")).length, 0);
  party.remove(); r.dom.flush(1);
  assert.equal(r.dom.body.filter((e) => e.className.includes("bf-moment")).length, 1);
});

test("Recent moments and the settings render from the service status", async () => {
  const r = renderer();
  await new Promise((res) => setImmediate(res));
  r.send(card({ subject: "Hogger", line: "Hogger <b> is down." }));
  const html = r.view.recentCard();
  assert.match(html, /Recent moments/); assert.match(html, /Elite defeated: Hogger/); assert.match(html, /Hogger &lt;b&gt; is down\./);
  const s = r.view.settingsMarkup();
  assert.match(s, /data-moment-setting="enabled" checked/);
  assert.match(s, /data-moment-setting="death" checked/);
  assert.doesNotMatch(s, /data-moment-setting="zone" checked/);
  assert.match(s, /\/bf moments off/);
});
