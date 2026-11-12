"use strict";
// Now page: real main/preload/renderer, synthetic character and live frame.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, "forever-now-"));
  let app;
  const capture = path.join(__dirname, "..", ".superpowers", "sdd", "now-captures");
  await fs.mkdir(capture, { recursive: true });
  const watchdog = setTimeout(() => { console.error("Now fixture exceeded 150 seconds"); app?.process().kill(); process.exitCode = 1; }, 150000);
  try {
    const profile = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.52, y: 0.29 },
      quests: [{ id: 96, title: "Call of Water", complete: true, objectives: [] }, { id: 5728, title: "Hidden Enemies", complete: false, objectives: [{ text: "0/1 Bazzalan slain", done: false, type: "monster", required: 1, fulfilled: 0 }, { text: "0/1 Jergosh the Invoker slain", done: false, type: "monster", required: 1, fulfilled: 0 }] }] };
    const initial = { ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [profile], provider: { id: "ollama", model: "fixture", endpoint: "http://127.0.0.1:11434" } };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-now-fixture", version: "0.15.0", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs');
      L.LiveBridge.prototype.readPreference=function(){globalThis.liveFixture={bridge:this};return false;};L.LiveBridge.prototype.start=function(){};
      load('./src/main.cjs');
    `);
    app = await electron.launch({ args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    // The app opens on Now.
    await page.locator("[data-now]").waitFor();
    await page.locator("[data-now-body] .now-step").first().waitFor();
    const a = await page.evaluate(() => NowView._state().advice);
    assert.equal(a.status, "ok");
    assert.equal(a.character.name, "Alpha");
    assert.ok(a.log.ready.some((q) => q.title === "Call of Water"), "finished quest is offered as a hand-in");
    assert.ok(a.next && a.zones.length >= 1, "a zone to level in");
    const steps = await page.locator(".now-step h3").allTextContents();
    assert.match(steps[0], /Hand in/);
    assert.ok(steps.some((t) => /Continue/.test(t)), "active quest step");
    await page.locator("[data-now-live]").getByText(/Level 15 Hunter/).waitFor();
    await page.screenshot({ path: path.join(capture, "now.png") });
    // Live frame in another zone: Now refreshes from it.
    await app.evaluate(() => { const b = liveFixture.bridge; b.enabled = true; b.frame = { version: 2, seq: 1, combat: false, characterHash: 0, mounted: false, position: { mapId: 1413, x: 0.51, y: 0.30, facing: 1 }, level: 16, receivedAt: Date.now() }; b.signal = "live"; b.emit(); });
    await page.locator("[data-now-live]").getByText(/Level 16/).waitFor({ timeout: 15000 });
    // "Show on map" jumps to the World Map focused on that spot.
    await page.locator("[data-now-map]").first().click();
    await page.locator("[data-world-map]").waitFor();
    await page.waitForFunction(() => Boolean(WorldMapView._state().selected));
    await page.screenshot({ path: path.join(capture, "now-to-map.png") });
    console.log("Now smoke passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
