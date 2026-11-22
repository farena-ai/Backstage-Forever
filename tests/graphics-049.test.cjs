"use strict";
// Graphics pass 0.49: G9 painted in-game frames, G10 welcome tour, G11 faction themes.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(root, f), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
function tgaSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt16LE(12), h: b.readUInt16LE(14), bits: b[16], bytes: b.length }; }

test("G9 frame art: power-of-two TGAs under the installer's 1 MB limit", () => {
  const dir = path.join(root, "addon/BackstageForever/Art/Frames");
  const want = { "compass.tga": [512, 512], "compass-crest.tga": [128, 64], "step.tga": [256, 128] };
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(want).sort());
  for (const [name, [w, h]] of Object.entries(want)) {
    const t = tgaSize(path.join(dir, name));
    assert.deepEqual([t.w, t.h], [w, h], name); assert.ok(t.bytes <= 1024 * 1024, `${name} ${t.bytes}`);
  }
  assert.equal(tgaSize(path.join(dir, "step.tga")).bits, 32, "the scroll keeps its transparent edges");
});

test("G9 painters cut nine pieces for the Compass and three for the scroll, from our own art only", () => lua(String.raw`
local made={}
local function tex() local t={coords=nil} function t:SetTexture(f) self.file=f end function t:SetTexCoord(...) self.coords={...} end function t:SetPoint() end function t:SetSize() end function t:SetHeight() end function t:SetWidth() end made[#made+1]=t return t end
local frame={CreateTexture=function() return tex() end}
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
BackstageForeverPaintNineSlice(frame,'compass',40,14)
assert(#made==9,#made)
for _,t in ipairs(made) do assert(t.file=='Interface\\AddOns\\BackstageForever\\Art\\Frames\\compass',t.file) end
assert(made[1].coords[1]==64/512 and made[1].coords[2]==448/512,'centre comes from the middle of the atlas')
made={}
BackstageForeverPaintScroll(frame,'step',40)
assert(#made==3 and made[1].file:find('Frames\\step',1,true))
-- A frame without textures is left alone instead of failing.
assert(BackstageForeverPaintNineSlice({},'compass',40,14)==nil)
`));

test("G9 wiring: the Compass drops the stock dialog border, the step frame paints its scroll, and the art installs", () => {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua"), route = read("addon/BackstageForever/BackstageForeverRoute.lua");
  assert.doesNotMatch(hud, /UI-DialogBox-Border/); assert.match(hud, /BackstageForeverPaintNineSlice\(panel,'compass',40,14\)/);
  assert.match(route, /BackstageForeverPaintScroll\(frame,'step',40\)/); assert.doesNotMatch(route, /\|cff9d9d9d/, "no faint grey on parchment");
  assert.ok(require("../src/core/game-sync.cjs").ART_DIRS.some((d) => d.join("/") === "Art/Frames"));
  for (const forbidden of ["hooksecurefunc", "Interface\\\\DialogFrame"]) assert.ok(!hud.includes(forbidden), forbidden);
});

function onboarding({ seen = false, show = true } = {}) {
  const store = new Map(seen ? [["bf-tour-v1", "done"]] : []), body = [], listeners = {};
  const doc = { readyState: "complete", body: { append: (e) => body.push(e) }, addEventListener: (k, f) => { listeners[k] = f; },
    createElement: () => { const e = { className: "", innerHTML: "", handlers: {}, classList: { add() {} }, addEventListener(k, f) { this.handlers[k] = f; }, querySelector: () => null, remove() { e.removed = true; } }; return e; } };
  const ctx = { document: doc, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, setTimeout: (f) => f(), window: { backstage: { onboarding: async () => ({ show }) } } };
  vm.createContext(ctx); vm.runInContext(read("src/renderer/onboarding.js"), ctx);
  const click = (el, act) => el.handlers.click({ target: { closest: () => ({ dataset: { ob: act } }) } });
  return { O: ctx.window.Onboarding, body, store, click };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test("G10: the tour shows once for a new player, walks splash → three cards, and can be replayed", async () => {
  const h = onboarding();
  await tick();
  assert.equal(h.body.length, 1); const el = h.body[0];
  assert.match(el.innerHTML, /<h1>Backstage Forever<\/h1>/); assert.match(el.innerHTML, /art\/splash\/splash\.webp/);
  h.click(el, "begin"); assert.match(el.innerHTML, /Your companion for WoW Forever/);
  h.click(el, "next"); assert.match(el.innerHTML, /art\/splash\/journal\.webp/);
  h.click(el, "next"); assert.match(el.innerHTML, /art\/factions\/horde\.webp/); assert.match(el.innerHTML, /art\/factions\/alliance\.webp/);
  assert.match(el.innerHTML, /Let's go/);
  h.click(el, "finish"); assert.equal(h.store.get("bf-tour-v1"), "done"); assert.equal(el.removed, true);
  h.O.open(); assert.equal(h.body.length, 2, "Replay opens it again");
  const old = onboarding({ show: false }); await tick();
  assert.equal(old.body.length, 0, "players with characters, and test runs, never see it"); assert.equal(old.store.get("bf-tour-v1"), "done");
  const seen = onboarding({ seen: true }); await tick(); assert.equal(seen.body.length, 0);
});

test("G10/G11 wiring: handler, scripts, replay button, faction crest on brand and banners, art notice", () => {
  const main = read("src/main.cjs");
  assert.match(main, /handle\("onboarding"/); assert.match(main, /process\.env\.BF_TEST_INACTIVE !== "1" && !\(!app\.isPackaged && process\.env\.BF_USER_DATA && process\.env\.BF_ONBOARDING !== "1"\) && !\(store\.state\.profiles \|\| \[\]\)\.length/);
  assert.match(read("src/preload.cjs"), /onboarding: \(\) => invoke\("onboarding"\)/);
  const html = read("src/renderer/index.html");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);
  const appIndex = scripts.indexOf("app.js");
  for (const dependency of ["onboarding.js", "practice-lab-model.js", "practice-lab.js"]) {
    const index = scripts.indexOf(dependency);
    assert.ok(index >= 0 && index < appIndex, `${dependency} must load before app.js`);
  }
  assert.ok(scripts.indexOf("practice-lab-model.js") < scripts.indexOf("practice-lab.js"));
  assert.match(html, /href="onboarding\.css"/);
  const app = read("src/renderer/app.js");
  assert.match(app, /data-ob-replay/); assert.match(app, /class="brand-faction" src="art\/factions\/\$\{profile\(\)\.faction\.toLowerCase\(\)\}\.webp"/);
  assert.match(read("src/renderer/page-hero.js"), /<span class="ph-faction" aria-hidden="true"><\/span>/);
  const css = read("src/renderer/page-hero.css");
  for (const side of ["horde", "alliance"]) {
    assert.match(css, new RegExp(`body\\[data-faction="${side}"\\] \\{ --faction-crest: url\\("art/factions/${side}\\.webp"\\)`));
    assert.ok(fs.statSync(path.join(root, `src/renderer/art/factions/${side}.webp`)).size > 10000, `${side} crest`);
  }
  for (const f of ["splash/splash.webp", "splash/journal.webp"]) assert.ok(fs.existsSync(path.join(root, "src/renderer/art", f)), f);
  assert.match(read("src/renderer/art/NOTICE.md"), /factions\/\*\.webp/);
});
