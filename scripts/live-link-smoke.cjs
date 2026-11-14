"use strict";
// Real main/preload/renderer; the screen-capture worker is replaced by a synthetic decoded strip.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, "forever-live-"));
  let app;
  const capture = path.join(__dirname, "..", ".superpowers", "sdd", "live-link-captures");
  await fs.mkdir(capture, { recursive: true });
  const watchdog = setTimeout(() => { console.error("Live link fixture exceeded 120 seconds"); app?.process().kill(); process.exitCode = 1; }, 120000);
  try {
    const initial = { ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [{ id: "Alpha", name: "Alpha", className: "Warrior", realm: "Synthetic", level: 12, race: "Orc", faction: "Horde", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.6, y: 0.2 } }], provider: { id: "ollama", model: "fixture", endpoint: "http://127.0.0.1:11434" } };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-live-fixture", version: "0.13.6", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs');
      L.LiveBridge.prototype.start=function(){globalThis.liveFixture={bridge:this,started:(globalThis.liveFixture?.started||0)+1};this.signal='no-signal';};
      L.LiveBridge.prototype.stop=function(){this.signal='off';this.frame=null;};
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(8000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "game");
    const toggle = page.locator("#live-link-toggle");
    assert.equal(await toggle.isChecked(), true, "live link is on by default");
    await toggle.uncheck();
    await page.locator("[data-live-link-line]").getByText(/Off\. Turn it on/).waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "live-link.json"), "utf8")).enabled, false);
    await toggle.check();
    await page.locator("[data-live-link-line]").getByText(/no live strip/).waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "live-link.json"), "utf8")).enabled, true);
    // A decoded frame arrives from the (synthetic) worker.
    await app.evaluate(() => {
      const b = liveFixture.bridge;
      b.frame = { version: 1, seq: 3, combat: false, position: { mapId: 1456, x: 0.551, y: 0.502, facing: 0 }, level: 12, target: { npcId: 3057, healthPercent: 100 }, receivedAt: Date.now() };
      b.signal = "live"; b.emit();
    });
    await page.locator("[data-live-link-line]").getByText("Live · Thunder Bluff 55.1, 50.2 · level 12 · target NPC #3057").waitFor();
    await page.screenshot({ path: path.join(capture, "live-link-settings.png") });
    // Match narrow CI windows, where the Companion side panel collapses.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 720));
    await navigate(page, "assistant");
    // The side panel may be collapsed by the responsive layout on narrow windows; check its content.
    const intel = page.locator(".companion-intel [data-live-link-line]");
    await intel.waitFor({ state: "attached", timeout: 5000 });
    await page.waitForFunction(() => /Live · Thunder Bluff/.test(document.querySelector(".companion-intel [data-live-link-line]")?.textContent || ""), null, { timeout: 5000 });
    await page.screenshot({ path: path.join(capture, "live-link-companion.png") });
    await navigate(page, "game");
    await page.locator("#live-link-toggle").uncheck();
    await page.locator("[data-live-link-line]").getByText(/Off\. Turn it on/).waitFor();
    console.log("Live link smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
