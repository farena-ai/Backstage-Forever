"use strict";
// Real main/preload/renderer with synthetic journal data and a synthetic live frame.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, "forever-worldmap-"));
  let app;
  const capture = path.join(__dirname, "..", ".superpowers", "sdd", "world-map-captures");
  await fs.mkdir(capture, { recursive: true });
  const watchdog = setTimeout(() => { console.error("World map fixture exceeded 150 seconds"); app?.process().kill(); process.exitCode = 1; }, 150000);
  try {
    const profile = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.52, y: 0.29 },
      quests: [{ id: 96, title: "Call of Water", complete: true, objectives: [] }, { id: 5728, title: "Hidden Enemies", complete: false, objectives: [{ text: "0/1 Bazzalan slain", done: false, type: "monster", required: 1, fulfilled: 0 }, { text: "0/1 Jergosh the Invoker slain", done: false, type: "monster", required: 1, fulfilled: 0 }] }] };
    const initial = { ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [profile], provider: { id: "ollama", model: "fixture", endpoint: "http://127.0.0.1:11434" } };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-worldmap-fixture", version: "0.15.0", main: "fixture-main.cjs" }));
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
    await navigate(page, "world-map");
    await page.locator("[data-wm-title]").getByText("The Barrens").waitFor();
    const s = () => page.evaluate(() => { const v = WorldMapView._state(); return { mapId: v.model?.mapId, pins: v.model?.pins.length, counts: v.model?.counts, selected: v.selected?.label, results: v.results?.results.length }; });
    let st = await s();
    assert.equal(st.mapId, 1413);
    assert.ok(st.counts["quest-turnin"] >= 1, "turn-in pin");
    assert.ok(st.counts["quest-giver"] >= 5 && st.counts.flight >= 1 && st.counts.vendor >= 5);
    // Canvas really painted parchment (not blank).
    const painted = await page.evaluate(() => { const c = document.querySelector("[data-wm-canvas]"); const d = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2]]; });
    assert.ok(painted[0] > 120 && painted[0] > painted[2], "parchment tone at map centre");
    // Live frame arrives: arrow and live label.
    await app.evaluate(() => { const b = liveFixture.bridge; b.enabled = true; b.frame = { version: 2, seq: 1, combat: false, characterHash: 0, mounted: true, position: { mapId: 1413, x: 0.6, y: 0.08, facing: 2.4 }, level: 15, receivedAt: Date.now() }; b.signal = "live"; b.emit(); });
    await page.locator("[data-wm-live]").getByText(/Live · 60\.0, 8\.0 · mounted/).waitFor();
    await page.screenshot({ path: path.join(capture, "world-map-barrens.png") });
    // Search across zones, open a result.
    await page.locator("[data-wm-search] input").fill("flight master");
    await page.locator("[data-wm-search] button").click();
    await page.locator("[data-wm-results] li").first().waitFor();
    st = await s();
    assert.ok(st.results >= 3);
    await page.locator("[data-wm-results] li button", { hasText: "Devrak" }).click();
    await page.locator("[data-wm-card] h3").getByText("Devrak").waitFor();
    await page.locator("[data-wm-card]").getByText(/From you \(live\): /).waitFor();
    await page.locator("[data-wm-act=way]").click();
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(clip, /^\/bf way 1413 \d+\.\d \d+\.\d Devrak$/);
    await page.screenshot({ path: path.join(capture, "world-map-search.png") });
    // Zone switch and layer toggle.
    await page.locator("[data-wm-zone]").selectOption("1456");
    await page.locator("[data-wm-title]").getByText("Thunder Bluff").waitFor();
    st = await s();
    assert.ok(st.counts.trainer >= 10);
    await page.locator("[data-wm-layer=trainer]").uncheck();
    await page.screenshot({ path: path.join(capture, "world-map-thunder-bluff.png") });
    // Instance Atlas: difficulty colours, your quests, and the jump to the World Map.
    await navigate(page, "dungeons");
    const rfc = page.locator('[data-atlas-card="rfc"]');
    await rfc.waitFor();
    assert.match(await rfc.getAttribute("class"), /d-right/);
    await rfc.getByText("Hidden Enemies").waitFor();
    await page.locator(".atlas-chip", { hasText: "Ragefire Chasm" }).waitFor();
    await rfc.locator("[data-atlas-open]").click();
    await rfc.locator(".atlas-bosses").getByText("Bazzalan").waitFor();
    await page.screenshot({ path: path.join(capture, "dungeon-atlas.png") });
    await page.locator('[data-atlas-tab="forever"]').click();
    await page.locator(".atlas-card", { hasText: "Shade of the Archmage" }).first().waitFor().catch(async () => { await page.locator(".atlas-card").first().locator("[data-atlas-open]").click(); });
    await page.locator('[data-atlas-tab="dungeon"]').click();
    await page.locator('[data-atlas-card="rfc"] [data-atlas-open]').click();
    await page.locator('[data-atlas-map="rfc"]').click();
    await page.waitForFunction(() => window.WorldMapView._state().selected?.label === "Ragefire Chasm entrance");
    await page.locator("[data-wm-title]").getByText("Orgrimmar").waitFor();
    await page.screenshot({ path: path.join(capture, "world-map-instance.png") });
    console.log("World map smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
