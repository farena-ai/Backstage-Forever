"use strict";
// Addon settings profiles on the desktop: reading the kept codes from the saved file, checking a
// code without trusting it, sending one to another character through the hand-off file, and the
// game reading exactly what the desktop wrote.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const P = require("../src/core/settings-profiles.cjs");
const { registerSettingsProfiles } = require("../src/core/settings-profiles-ipc.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const { parseSavedVariables, GameSync } = require("../src/core/game-sync.cjs");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
// Codes written by the addon itself, so the two sides are tested against each other.
const [CODE, DATA_CODE, OTHER] = lua(String.raw`dofile('addon/BackstageForever/BackstageForeverProfile.lua')
local env={get=function(n) return ({BackstageForeverSocialSettings={marks=true,large=false},BackstageForeverGearSettings={enabled=false},
  BackstageForeverPanelSettings={tracker=true,pos={tracker={x=10.5,y=700}}},BackstageForeverNotesDB={v=1,notes={{name='Thrall',text='good tank'}}}})[n] end,set=function() end}
print(BackstageForeverProfileEncode(BackstageForeverProfileCollect(env,false,{name='Aëralyn',realm='Thunder Hold',class='MAGE',at=1700000000})))
print(BackstageForeverProfileEncode(BackstageForeverProfileCollect(env,true,{name='Aëralyn',realm='Thunder Hold',class='MAGE',at=1700000000})))
print(BackstageForeverProfileEncode({v=1,m={n='Zed'},s={Gear={enabled=true}}}))`).split(/\r?\n/);
const code = (payload) => `BF1:${P.sum(payload)}:${payload}`;

test("a code is checked, counted and never trusted: the desktop agrees with the addon on what is a code", () => {
  const seen = P.inspect(CODE);
  assert.deepEqual(seen, { ok: true, sum: P.sum(CODE), from: "Aëralyn", realm: "Thunder Hold", className: "MAGE", at: 1700000000, settings: 6, tables: 3, hasData: false });
  assert.equal(P.inspect(DATA_CODE).hasData, true);
  // The same checksum as the addon's own, for the code and for plain text.
  assert.equal(lua(`dofile('addon/BackstageForever/BackstageForeverProfile.lua') print(BackstageForeverProfileSum(${JSON.stringify(CODE)}))`), P.sum(CODE));
  assert.equal(P.sum(""), "00000001"); assert.equal(P.sum("Wikipedia"), "11e60398");
  const why = (text) => { const r = P.inspect(text); assert.equal(r.ok, false, String(text).slice(0, 50)); return r.reason; };
  assert.equal(why(null), "form"); assert.equal(why(""), "form"); assert.equal(why("hello"), "form"); assert.equal(why(CODE + " "), "form"); assert.equal(why(CODE.replace("BF1", "BF2")), "version");
  assert.equal(why(CODE.slice(0, -1)), "sum"); assert.equal(why(CODE.replace("marks", "marke")), "sum"); assert.equal(why("x".repeat(16001)), "big");
  for (const payload of ["", "{", "{}", "t", "{sv;n1;", "{sv;n1;sv;n1;}", "{sv;n1e999;}", "{sv;n1;ss;{sGear;{senabled;x}}}", "{sv;n1;ss;{sa%zz;t}}", "{sv;n1;ss;{sa%2;t}}", "{n1.5;t}", "{{}t}", "{sv;n1;}trailing",
    "{".repeat(9) + "}".repeat(9), "{sv;n1;sx;s" + "a".repeat(1300) + ";}"]) assert.equal(P.inspect(code(payload)).ok, false, payload.slice(0, 40));
  assert.equal(why(code("{sv;n1;ss;{}}")), "empty"); assert.equal(why(code("{sv;n2;ss;{sGear;{senabled;t}}}")), "version");
  // Noise never throws.
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = "tfns{};%-._0123456789abcdefE:|\"\\ \n\u0000é";
  for (let i = 0; i < 4000; i++) {
    let text = ""; for (let j = rnd(70); j > 0; j--) text += alphabet[rnd(alphabet.length)];
    const cut = rnd(CODE.length);
    for (const candidate of [text, code(text.replace(/[^tfns{};%\-._0-9a-fE]/g, "")), CODE.slice(0, cut) + text.slice(0, 3) + CODE.slice(cut + 1)]) {
      const r = P.inspect(candidate);
      assert.ok(r.ok === true || typeof r.reason === "string");
    }
  }
});

test("the saved file: kept profiles are read beside the characters, a bad row is dropped alone, older files read as before", () => {
  const character = (over = {}) => ({ id: "GUID-1", name: "Abel", realm: "Thunder Hold", className: "Mage", level: 12, updatedAt: 1700000000, captureVersion: "0.12.3", clientBuild: "1.60.1.71037", faction: "Horde", ...over });
  const savedFile = (chars) => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: chars, activeId: "GUID-1", observedAt: 1700000000 }));
  const plain = parseSavedVariables(savedFile([character()]));
  assert.equal(plain.settingsProfiles, undefined, "no block, no field");
  const block = { v: 1, profiles: [{ n: "raiding", c: CODE, t: 1700000000 }, { n: "Bad Name", c: CODE }, { n: "big", c: "x".repeat(16001) }, { n: "raiding", c: OTHER }, "junk", { n: "alt", c: OTHER }], done: "0a1b2c3d" };
  const withBlock = parseSavedVariables(savedFile([character({ settingsProfiles: block }), character({ id: "GUID-2", name: "Zed", settingsProfiles: { v: 2, profiles: [] } }), character({ id: "GUID-3", name: "Cy", settingsProfiles: { v: 1, profiles: {}, done: "nothex" } })]));
  assert.equal(withBlock.characters.length, 3, "a bad block never costs the character");
  assert.deepEqual(withBlock.settingsProfiles, [{ id: withBlock.characters[0].id, name: "Abel", realm: "Thunder Hold", profiles: { profiles: [{ name: "alt", code: OTHER, at: null }, { name: "raiding", code: CODE, at: 1700000000 }], done: "0a1b2c3d" } }]);
  assert.equal(withBlock.characters[0].settingsProfiles, undefined, "the profile store never sees the block");
  assert.deepEqual(P.normalizeProfilesCapture({ v: 1, profiles: {}, done: "0a1b2c3d" }), { profiles: [], done: "0a1b2c3d" }, "Lua writes an empty list as {}");
  for (const bad of [null, [], { v: 2 }, { v: 1 }, { v: 1, profiles: "x" }, { v: 1, profiles: Array(10).fill({ n: "a", c: CODE }) }]) assert.throws(() => P.normalizeProfilesCapture(bad), /Invalid profiles capture/);
  // GameSync hands out copies.
  const game = { profileBlocks: withBlock.settingsProfiles };
  const copy = GameSync.prototype.settingsProfiles.call(game); copy[0].profiles.profiles[0].name = "changed";
  assert.equal(game.profileBlocks[0].profiles.profiles[0].name, "alt");
  assert.deepEqual(GameSync.prototype.settingsProfiles.call({}), []);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-profiles-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blocks = [{ id: "GUID-1", name: "Abel", realm: "Thunder Hold", profiles: { profiles: [{ name: "raiding", code: CODE, at: 1700000000 }, { name: "withdata", code: DATA_CODE, at: null }, { name: "broken", code: CODE.slice(0, -2), at: null }], done: null } }];
  const state = { profiles: [
    { id: "GUID-1", name: "Abel", realm: "Thunder Hold", className: "Mage", source: { kind: "wow-addon" } }, { id: "GUID-2", name: "Zed", realm: "Thunder Hold", className: "Warrior", source: { kind: "wow-addon" } },
    { id: "manual", name: "Paper", realm: "", source: { kind: "manual" } }] };
  const sends = new P.ProfileSends(dir), h = {}; let changes = 0;
  const api = registerSettingsProfiles({ handle: (n, fn) => { h[n] = fn; }, getGame: () => ({ settingsProfiles: () => blocks }), getState: () => state, sends, onChange: () => { changes++; }, now: () => 1790000000000 });
  return { dir, blocks, state, sends, h, api, changes: () => changes };
}

test("Settings lists each character's kept profiles and sends one to another character, with caps and plain refusals", (t) => {
  const { dir, blocks, sends, h, changes } = fixture(t);
  const view = h.settingsProfiles();
  assert.deepEqual(view.sources, [{ id: "GUID-1", key: "Abel-Thunder Hold", name: "Abel", realm: "Thunder Hold", profiles: [
    { name: "raiding", at: 1700000000, ok: true, settings: 6, reason: null }, { name: "withdata", at: null, ok: false, settings: 6, reason: "data" }, { name: "broken", at: null, ok: false, settings: 0, reason: "sum" }] }]);
  assert.deepEqual(view.targets.map((c) => c.key), ["Abel-Thunder Hold", "Zed-Thunder Hold"], "only characters the game knows; a hand-made one cannot receive");
  assert.deepEqual(view.waiting, []);
  const sent = h.sendSettingsProfile("GUID-1", "raiding", "GUID-2");
  assert.deepEqual(sent.waiting, [{ key: "Zed-Thunder Hold", name: "raiding", from: "Abel-Thunder Hold", at: 1790000000000 }]); assert.equal(changes(), 1, "the hand-off file is written again");
  assert.throws(() => h.sendSettingsProfile("GUID-1", "raiding", "GUID-1"), /already belongs to this character/);
  assert.throws(() => h.sendSettingsProfile("GUID-1", "broken", "GUID-2"), /damaged and cannot be sent/);
  assert.throws(() => h.sendSettingsProfile("GUID-1", "withdata", "GUID-2"), /cannot be sent to the game/);
  assert.throws(() => h.sendSettingsProfile("GUID-1", "nothere", "GUID-2"), /no longer in the saved file/);
  assert.throws(() => h.sendSettingsProfile("GUID-1", "raiding", "manual"), /Choose a character/);
  for (const bad of [[], ["GUID-1"], ["GUID-1", "raiding", "GUID-2", "x"], [1, "raiding", "GUID-2"], ["GUID-1", "x".repeat(21), "GUID-2"]]) assert.throws(() => h.sendSettingsProfile(...bad), /Invalid profile request/);
  assert.throws(() => h.settingsProfiles(1), /Invalid profile request/); assert.throws(() => h.cancelSettingsProfile(), /Invalid profile request/);
  assert.equal(changes(), 1);
  // Kept across a restart, and re-checked when read back.
  assert.deepEqual(new P.ProfileSends(dir).get("Zed-Thunder Hold"), { name: "raiding", from: "Abel-Thunder Hold", code: CODE, sum: P.sum(CODE), at: 1790000000000 });
  fs.writeFileSync(path.join(dir, "profile-sends.json"), JSON.stringify({ schemaVersion: 1, sends: { "Zed-Thunder Hold": { name: "raiding", from: "Abel-Thunder Hold", code: CODE.slice(0, -1) }, "Bad|Key": { name: "x", from: "y", code: CODE } } }));
  assert.deepEqual(new P.ProfileSends(dir).all(), {}, "a damaged file sends nothing");
  // Take back.
  assert.deepEqual(h.cancelSettingsProfile("Zed-Thunder Hold").waiting, []); assert.equal(changes(), 2);
  h.cancelSettingsProfile("Nobody-Nowhere"); assert.equal(changes(), 2, "nothing to take back, nothing written");
  // The game says it dealt with the sent profile (accepted or dismissed): the send is finished.
  h.sendSettingsProfile("GUID-1", "raiding", "GUID-2");
  blocks.push({ id: "GUID-2", name: "Zed", realm: "Thunder Hold", profiles: { profiles: [], done: "00000000" } });
  assert.equal(h.settingsProfiles().waiting.length, 1, "another checksum settles nothing");
  blocks[1].profiles.done = P.sum(CODE);
  assert.deepEqual(h.settingsProfiles().waiting, []); assert.equal(sends.get("Zed-Thunder Hold"), null);
  assert.equal(sends.settle({ "Zed-Thunder Hold": P.sum(CODE) }), false);
  sends.set("Zed-Thunder Hold", { name: "raiding", from: "Abel-Thunder Hold", code: CODE, at: 1 }); sends.clear(); assert.deepEqual(new P.ProfileSends(dir).all(), {});
  assert.throws(() => sends.set("Zed-Thunder Hold", { name: "Bad Name", from: "x", code: CODE }), /cannot be sent/); assert.throws(() => sends.set("", null), /Choose a character/);
});

test("the hand-off file carries the sent profile, stays the same without one, and the game reads exactly what was sent", () => {
  const profiles = [{ id: "a", name: "Abel", realm: "Thunder Hold", source: { kind: "wow-addon" } }, { id: "z", name: "Zed", realm: "Thunder Hold", source: { kind: "wow-addon" } }];
  const send = { name: "raiding", from: "Abel-Thunder Hold", code: CODE };
  const base = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5, 6] : []) });
  assert.equal(handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5, 6] : []), sentProfiles: () => null }), base, "byte for byte what it was for everyone without a sent profile");
  const text = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5, 6] : []), sentProfiles: (key) => (key === "Zed-Thunder Hold" ? send : null) });
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{/, "the schema stays 1");
  assert.ok(text.includes(`["Zed-Thunder Hold"]={wish={},prof={n="raiding",f="Abel-Thunder Hold",c="${CODE}"}},`), text);
  assert.ok(text.includes('["Abel-Thunder Hold"]={wish={5,6}},'));
  // Anything that is not a clean code or name is left out, never escaped into the file.
  for (const bad of [{ ...send, code: CODE + '"' }, { ...send, code: "x".repeat(16001) }, { ...send, code: 'BF1:00000001:"..os.exit()..\"' }, { ...send, name: "Bad Name" }, { ...send, from: "a|cffff0000b" }, { ...send, from: "" }, { ...send, code: CODE + "\n" }, "x", 5])
    assert.equal(handoff.compile({ profiles, sentProfiles: () => bad }), handoff.compile({ profiles }), JSON.stringify(bad).slice(0, 60));
  assert.equal(handoff.compile({ profiles, sentProfiles: () => { throw Error("boom"); } }), handoff.compile({ profiles }));
  // A sent profile is the first passenger left out when the file is full.
  const many = Array.from({ length: 100 }, (_, i) => ({ id: "c" + i, name: "Char" + i, realm: "Realm", source: { kind: "wow-addon" } }));
  const filler = "{" + "sx%20;t".repeat(2270) + "}"; const big = `BF1:${P.sum(filler)}:${filler}`;
  assert.ok(big.length > 15000 && big.length <= 16000);
  const full = handoff.compile({ profiles: many, wishlist: () => Array.from({ length: 200 }, (_, i) => 1000000 + i), sentProfiles: () => ({ name: "big", from: "A-B", code: big }) });
  assert.ok(Buffer.byteLength(full) <= handoff.MAX_BYTES);
  const carried = (full.match(/prof=\{/g) || []).length;
  assert.ok(carried > 0 && carried < 100, `${carried} of 100 fit; the wish lists are all there`);
  assert.equal((full.match(/wish=\{1000000,/g) || []).length, 100);
  // The game reads the file the desktop wrote and finds the same code.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-handoff-")); const file = path.join(dir, "h.lua"); fs.writeFileSync(file, text);
  try {
    const out = lua(`dofile(${JSON.stringify(file.replace(/\\/g, "/"))}) dofile('addon/BackstageForever/BackstageForeverProfile.lua')
local sent=BackstageForeverProfileSent(BackstageForeverDesktopData,'Zed','Thunder Hold')
assert(sent and sent.name=='raiding' and sent.from=='Abel-Thunder Hold')
assert(BackstageForeverProfileSent(BackstageForeverDesktopData,'Abel','Thunder Hold')==nil)
local doc=assert(BackstageForeverProfileDecode(sent.code))
print(sent.code) print(sent.sum) print(doc.s.Social.marks,doc.s.Gear.enabled,doc.s.Panel.pos.tracker.x,doc.m.n)`).split(/\r?\n/);
    assert.equal(out[0], CODE); assert.equal(out[1], P.sum(CODE)); assert.equal(out[2], "true\tfalse\t10.5\tAëralyn");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("wiring: the main process, the preload, the Settings page and the capture block", () => {
  const main = read("src/main.cjs"), preload = read("src/preload.cjs"), html = read("src/renderer/index.html"), app = read("src/renderer/app.js");
  assert.match(main, /sentProfiles: \(key\) => profileSends\?\.get\(key\) \|\| null/);
  assert.match(main, /registerSettingsProfiles\(\{ handle, getGame: \(\) => game, getState: \(\) => store\.state, sends: profileSends,/);
  assert.match(main, /profileSends\?\.clear\(\);/, "deleting all characters forgets what was waiting for them");
  for (const name of ["settingsProfiles", "sendSettingsProfile", "cancelSettingsProfile"]) assert.ok(preload.includes(`invoke("${name}"`), name);
  assert.match(html, /<link rel="stylesheet" href="settings-profiles\.css">/); assert.match(html, /<script src="settings-profiles\.js"><\/script>/);
  assert.ok(html.indexOf("settings-profiles.js") < html.indexOf('<script src="app.js">'));
  assert.match(app, /SettingsProfiles\.markup\(\)/);
  assert.match(read("src/core/game-sync.cjs"), /c\.settingsProfiles !== undefined/);
  // No tab was added: the card sits inside the existing Settings page.
  assert.ok(!/settings-profiles|SettingsProfiles/.test(read("src/renderer/player-navigation.js")));
  const ui = read("src/renderer/settings-profiles.js");
  assert.ok(!/innerHTML = [^;]*\b(view|note)\b(?!\))/.test(ui.replace(/el\.innerHTML = inner\(\)/, "")), "everything shown goes through esc()");
  assert.ok(!/toLocale(Date|Time)String\(/.test(ui) && /window\.I18n\?\.when/.test(ui), "dates come from the one helper");
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(ui + read("src/core/settings-profiles.cjs") + read("src/core/settings-profiles-ipc.cjs")), "nothing leaves this computer");
  for (const lang of ["de", "es", "fr"]) {
    const d = JSON.parse(read(`data/i18n/${lang}.json`)).app;
    for (const text of ["Addon settings profiles", "Copy your Backstage Forever addon settings from one character to another.", "Send to", "Take back", "No kept profile in your saved file yet.", "Waiting to be offered in game"]) assert.ok(d[text], `${lang}: ${text}`);
  }
});
