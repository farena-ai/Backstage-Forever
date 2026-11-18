"use strict";
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "bf-route-recovery-"));
  let app;
  try {
    const repo = path.resolve(__dirname, "..");
    const alpha = { id: "Alpha", name: "Alpha", className: "Warrior", realm: "Fixture", level: 2, race: "Orc", faction: "Horde", goals: [], notes: "", locale: "enUS",
      source: { kind: "wow-addon", id: "Alpha-Fixture", updatedAt: "2026-11-12T13:00:00.000Z" }, clientBuild: "1.60.1.70888",
      location: { zone: "Durotar", mapId: 1411, x: .42, y: .68 }, quests: [{ id: 788, title: "Cutting Teeth", complete: false, objectives: [] }],
      history: { recent: [], completedIdsKnown: true, completedIds: [789, 4402, 97279] } };
    const beta = { ...alpha, id: "Beta", name: "Beta", source: { ...alpha.source, id: "Beta-Fixture" }, clientBuild: "1.60.1.70862", quests: [] };
    const initial = { ...defaultState(), onboarded: true, activeProfileId: alpha.id, profiles: [alpha, beta] };
    assert.equal(validateState(initial).activeProfileId, alpha.id);
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-route-recovery-fixture", version: "1.0.0", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=()=>false; L.LiveBridge.prototype.start=()=>{};
      const {ipcMain}=require('electron'), handle=ipcMain.handle.bind(ipcMain);
      globalThis.routeFixture={arm:false, release:null};
      ipcMain.handle=(name,fn)=>handle(name,async (...args)=>{
        const held=name==='backstage:worldMap' && routeFixture.arm;
        if(held) routeFixture.arm=false;
        const result=await fn(...args);
        if(held) await new Promise(resolve=>{routeFixture.release=resolve;});
        return result;
      });
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(7500);
    const outer = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(...w.getMinimumSize()); return w.getSize();
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "guided-route");
    const press = async (el) => { await el.focus(); await page.keyboard.press("Enter"); };
    const route = page.locator("[data-gr-recovery]");
    await route.getByText(/availability/i).waitFor();
    await route.locator('[data-quest-open="788"]').waitFor();
    await press(route.getByRole("button", { name: "Skip this step" }));
    await route.getByRole("button", { name: "Show on Map" }).waitFor();
    await page.reload();
    await navigate(page, "guided-route");
    await route.getByRole("button", { name: "Show on Map" }).waitFor();
    await page.locator("#active-character").selectOption("Beta");
    await route.getByText(/matching reference/i).waitFor();
    assert.equal(await route.locator("[data-map-focus], [data-quest-open]").count(), 0);
    await page.locator("#active-character").selectOption("Alpha");
    await press(route.getByRole("button", { name: "Show on Map" }));
    const first = page.locator('[data-wm-goal] [data-quest-open="788"]');
    await first.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[data-wm-goal] [data-quest-open="788"]'));
    const geometry = await first.evaluate((el) => {
      const r = el.getBoundingClientRect(), view = WorldMapView._state();
      const clip = el.closest("main").getBoundingClientRect();
      return { visible: r.top >= Math.max(0, clip.top) && r.bottom <= Math.min(innerHeight, clip.bottom) && r.left >= 0 && r.right <= innerWidth,
        viewport: [innerWidth, innerHeight], target: [view.model.mapId, view.model.profileId, view.focused.pin.questId] };
    });
    assert.deepEqual(geometry.target, [1411, "Alpha", 788]);
    assert.ok(geometry.visible, JSON.stringify(geometry));
    if (process.env.BF_ROUTE_CAPTURE) await page.screenshot({ path: process.env.BF_ROUTE_CAPTURE });
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Cutting Teeth", exact: true }).first().waitFor();
    // Retire a genuine Alpha map response when the player selects Beta before it settles.
    await navigate(page, "guided-route");
    await app.evaluate(() => { routeFixture.arm = true; });
    await press(route.getByRole("button", { name: "Show on Map" }));
    await page.locator("[data-world-map]").waitFor();
    const held = await app.evaluate(async () => {
      for (let i = 0; i < 100 && !routeFixture.release; i++) await new Promise((r) => setTimeout(r, 20));
      return Boolean(routeFixture.release);
    });
    assert.equal(held, true, "Alpha map response held before changing character");
    await page.locator("#active-character").selectOption("Beta");
    await page.waitForFunction(() => profile()?.id === "Beta");
    await app.evaluate(() => routeFixture.release());
    await page.waitForFunction(() => WorldMapView._state().model?.profileId === "Beta");
    assert.equal(await first.count(), 0);
    await navigate(page, "guided-route");
    await page.locator("#active-character").selectOption("Alpha");
    await press(route.getByRole("button", { name: "Restore skipped steps" }));
    await route.getByText(/availability/i).waitFor();
    assert.deepEqual(errors, []);
    console.log(`Desktop route recovery passed at ${outer.join("×")} outer, ${geometry.viewport.join("×")} renderer.`);
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 4 });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
