"use strict";
// Real main/preload/renderer; the screen-capture worker is replaced by a synthetic decoded strip.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
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
      const L=load('./src/core/live-bridge.cjs'); globalThis.liveLib=L;
      L.LiveBridge.prototype.start=function(){globalThis.liveFixture={bridge:this,started:(globalThis.liveFixture?.started||0)+1};this.signal='no-signal';};
      L.LiveBridge.prototype.stop=function(){this.signal='off';this.frame=null;};
      load('./src/main.cjs');
    `);
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
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
    await page.locator("[data-live-link-line]").getByText(/no live line/).waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "live-link.json"), "utf8")).enabled, true);
    // A decoded frame arrives from the (synthetic) worker.
    await app.evaluate(() => {
      const b = liveFixture.bridge;
      b.frame = { version: 1, seq: 3, combat: false, position: { mapId: 1456, x: 0.551, y: 0.502, facing: 0 }, level: 12, target: { npcId: 3057, healthPercent: 100 }, receivedAt: Date.now() };
      b.signal = "live"; b.emit();
    });
    await page.locator("[data-live-link-line]").getByText("Live · Thunder Bluff 55.1, 50.2 · level 12 · target NPC #3057").waitFor();
    await page.screenshot({ path: path.join(capture, "live-link-settings.png") });
    // 0.38 hairline: a captured line (as the worker sends it, read from the game window) goes
    // through the real decoder; then WoW is minimized, then the line is there but unreadable.
    await app.evaluate(() => {
      const L = liveLib;
      const b = liveFixture.bridge, width = 544, height = 4, rgb = Buffer.alloc(width * height * 3, 140);
      const main = new Array(27).fill(0);
      Object.assign(main, { 0: 5, 1: 9, 2: 1456 >> 8, 3: 1456 & 255, 4: 0x8d, 5: 0x0f, 6: 0x80, 7: 0x83, 8: 12, 9: 100, 10: 64, 15: 255, 16: 255, 25: 1 });
      main[26] = L.crc8(main, 26);
      L.encodeHairlineCells(L.encodeHairlineFrame(main, [])).forEach((c, i) => { for (let dx = 0; dx < 2; dx++) { const o = (i * 2 + dx) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } });
      b.frame = null; b.line(`ok topleft ${width} ${height} ${rgb.toString("base64")} pw`);
    });
    await page.locator("[data-live-link-line]").getByText(/^Live · Thunder Bluff 55\.1, 50\.2 · level 12$/).waitFor();
    await page.locator("[data-live-link-strip]").getByText("Mode: Hairline · Placement: top edge · 528×1 px · read from the game window (works behind other windows)").waitFor();
    await page.screenshot({ path: path.join(capture, "live-link-hairline.png") });
    await app.evaluate(() => { const b = liveFixture.bridge; b.frame.receivedAt -= 120000; b.line("minimized"); });
    await page.locator("[data-live-link-line]").getByText(/^WoW is minimized — live updates are paused and resume when you bring it back\. Last live: Thunder Bluff 55\.1, 50\.2 · level 12 · 2 min ago\.$/).waitFor();
    await page.screenshot({ path: path.join(capture, "live-link-minimized.png") });
    await app.evaluate(() => { liveFixture.bridge.line("nogame"); });
    await page.locator("[data-live-link-line]").getByText(/^WoW window not found — live updates are paused and resume when the game is back\./).waitFor();
    await app.evaluate(() => { const b = liveFixture.bridge; b.signal = "hairline-unreadable"; b.emit(); });
    await page.locator("[data-live-link-line]").getByText(/Type \/bf live safe in WoW/).waitFor();
    await app.evaluate(() => {
      const b = liveFixture.bridge;
      b.frame = { version: 1, seq: 3, combat: false, position: { mapId: 1456, x: 0.551, y: 0.502, facing: 0 }, level: 12, target: { npcId: 3057, healthPercent: 100 }, receivedAt: Date.now() };
      b.signal = "live"; b.emit();
    });
    await page.locator("[data-live-link-line]").getByText("Live · Thunder Bluff 55.1, 50.2 · level 12 · target NPC #3057").waitFor();
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
