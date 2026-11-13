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
    const profile = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.52, y: 0.29 }, journal: { levels: [{ level: 13, at: 1700000000, played: 30000 }, { level: 14, at: 1700003600, played: 33000 }, { level: 15, at: 1700009000, played: 38400 }], firsts: [{ key: "flight", at: 1700002000 }], zones: [1411, 1413, 1454, 1456, 1412, 1441], played: 39000 },
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
    // You are here: the zone card, with every row able to open the map dialed in.
    await page.locator(".now-zonecard h2").getByText("The Barrens").waitFor();
    assert.ok(await page.locator(".now-zonecard .now-zr").count() >= 2, "zone card lists places nearby");
    assert.ok(await page.locator(".now-zonecard [data-now-map]").count() >= 2);
    // Entering a new zone: a painted arrival banner that dismisses itself.
    await page.evaluate(() => NowView._arrive({ mapId: 1413, name: "The Barrens", band: { min: 10, max: 25 }, questsForYou: 54 }));
    await page.locator(".bf-arrive").getByText("The Barrens").waitFor();
    await page.screenshot({ path: path.join(capture, "now-arrival.png") });
    await page.locator(".bf-arrive").click(); await page.locator(".bf-arrive").waitFor({ state: "detached" });
    await page.screenshot({ path: path.join(capture, "now.png") });
    // Live frame in another zone: Now refreshes from it.
    await app.evaluate(() => { const b = liveFixture.bridge; b.enabled = true; b.frame = { version: 2, seq: 1, combat: false, characterHash: 0, mounted: false, position: { mapId: 1413, x: 0.51, y: 0.30, facing: 1 }, level: 16, receivedAt: Date.now() }; b.signal = "live"; b.emit(); });
    await page.locator("[data-now-live]").getByText(/Level 16/).waitFor({ timeout: 15000 });
    // First-run checklist and this session's card.
    assert.match(await page.locator(".now-setup h2").innerText(), /Get set up/);
    // One click sets up what the app can do itself (stubbed here: never touch a real game folder in tests).
    await app.evaluate(({ ipcMain }) => { globalThis.setupCalls = 0; ipcMain.removeHandler("backstage:startCompanion"); ipcMain.handle("backstage:startCompanion", () => { globalThis.setupCalls++; return { connected: true, addonCurrent: true }; }); });
    await page.locator('[data-now-act="setup"]').click();
    await page.locator(".now-oneclick").getByText(/Done\. Log in to WoW/).waitFor({ timeout: 15000 });
    assert.equal(await app.evaluate(() => globalThis.setupCalls), 1);
    await page.locator(".now-session").waitFor();
    // Playing on: a level-up celebrates, a death puts "run back to your body" first.
    const frame = (o) => app.evaluate((_e, o) => { const b = liveFixture.bridge; b.frame = { version: 3, combat: false, dead: false, characterHash: 0, mounted: false, level: 16, xpPercent: 40, position: { mapId: 1413, x: 0.51, y: 0.30, facing: 1 }, ...o, receivedAt: Date.now() }; b.signal = "live"; b.emit(); }, o);
    await frame({ seq: 2, position: { mapId: 1413, x: 0.53, y: 0.31, facing: 1 } });
    await frame({ seq: 3, level: 17, xpPercent: 1, position: { mapId: 1413, x: 0.55, y: 0.33, facing: 1 } });
    await page.locator(".bf-celebrate [data-bf-level]").getByText("17", { exact: true }).waitFor(); await page.locator(".bf-celebrate").getByText("You reached level 17").waitFor(); await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(capture, "now-level-up.png") });
    await page.locator("[data-celebrate-close]").click(); await page.locator(".bf-celebrate").waitFor({ state: "detached" });
    await frame({ seq: 4, level: 17, dead: true, position: { mapId: 1413, x: 0.56, y: 0.34, facing: 1 } });
    await page.locator(".now-step.now-death").waitFor({ timeout: 15000 });
    assert.match(await page.locator(".now-step h3").first().innerText(), /You died/);
    const s = await page.evaluate(() => NowView._state().session);
    assert.equal(s.deaths, 1); assert.equal(s.level, 17);
    await page.screenshot({ path: path.join(capture, "now-session.png"), fullPage: true });
    await frame({ seq: 5, level: 17, dead: false, position: { mapId: 1413, x: 0.51, y: 0.30, facing: 1 } });
    // Link audit: every "Show on map" on Now dials in on exactly its target, with what to do there.
    const mapLinks = await page.locator("[data-now-map]").evaluateAll((els) => els.map((e) => JSON.parse(e.dataset.nowMap)));
    assert.ok(mapLinks.length >= 4, `expected several map links, got ${mapLinks.length}`);
    assert.ok(mapLinks.every((l) => l.goal && l.goal.title), "every map link says what to do there");
    for (let i = 0; i < mapLinks.length; i++) {
      const want = mapLinks[i];
      if (i) { await page.locator('[data-nav="now"]').first().click(); await page.locator("[data-now-body] .now-step").first().waitFor(); }
      // Click the link for this exact target (nearest-first lists may reorder as the position updates).
      const at = await page.locator("[data-now-map]").evaluateAll((els, w) => els.findIndex((e) => e.dataset.nowMap === JSON.stringify(w)), want);
      if (at < 0) continue;
      await page.locator("[data-now-map]").nth(at).click();
      await page.locator("[data-world-map]").waitFor();
      await page.waitForFunction((w) => { const f = WorldMapView._state().focused; return f && f.pin.mapId === w.mapId && (w.npcId ? f.pin.npcId === w.npcId : Math.hypot(f.pin.x - w.x, f.pin.y - w.y) < 1e-6); }, want);
      const got = await page.evaluate(() => ({ selected: WorldMapView._state().selected === WorldMapView._state().focused.pin, title: document.querySelector("[data-wm-goal] h4")?.textContent }));
      assert.ok(got.selected, `link ${i} selects its target`);
      assert.equal(got.title, want.goal.title, `link ${i} shows its goal`);
      if (i === 0) await page.screenshot({ path: path.join(capture, "now-to-map.png") });
    }
    // Leave the audit on a map focused on a Now link (the loop may end on Now).
    await page.locator('[data-nav="now"]').first().click(); await page.locator("[data-now-body] .now-step").first().waitFor();
    await page.locator("[data-now-map]").first().click(); await page.locator("[data-world-map]").waitFor();
    await page.waitForFunction(() => Boolean(WorldMapView._state().focused));
    // "Show the full map" leaves focus mode.
    await page.locator('[data-wm-act="unfocus"]').click();
    assert.equal(await page.evaluate(() => WorldMapView._state().focused), null);
    // Hover any quest: a rich card with how to do it (no click needed).
    await page.locator('[data-nav="now"]').first().click(); await page.locator("[data-now-body] .now-step").first().waitFor();
    await page.locator("[data-now-body] [data-quest-open]").first().hover();
    await page.locator(".hover-card").waitFor({ timeout: 10000 }); await page.waitForTimeout(300);
    assert.match(await page.locator(".hover-card").innerText(), /Click to open the quest/);
    await page.screenshot({ path: path.join(capture, "hover-card.png") });
    await page.mouse.move(5, 5); await page.mouse.down(); await page.mouse.up();
    // Every "Open quest" on Now opens that exact quest.
    await page.locator('[data-nav="now"]').first().click(); await page.locator("[data-now-body] .now-step").first().waitFor();
    const questIds = [...new Set(await page.locator("[data-now-body] [data-quest-open]").evaluateAll((els) => els.map((e) => Number(e.dataset.questOpen))))].slice(0, 4);
    assert.ok(questIds.length >= 2);
    for (const id of questIds) {
      await page.locator('[data-nav="now"]').first().click(); await page.locator("[data-now-body] .now-step").first().waitFor();
      await page.locator(`[data-now-body] [data-quest-open="${id}"]`).first().click();
      await page.locator(`[data-quest-control="detail:${id}"]`).waitFor();
    }
    // The quest page shows where to go; each place opens the map dialed in with what to do.
    const tile = page.locator(".quest-where .quest-map-btn").first();
    await tile.waitFor();
    await page.screenshot({ path: path.join(capture, "quest-page.png"), fullPage: true });
    const wantTile = JSON.parse(await tile.getAttribute("data-map-focus"));
    await tile.click();
    await page.locator("[data-world-map]").waitFor();
    await page.waitForFunction((w) => WorldMapView._state().focused?.goal?.title === w.goal.title, wantTile);
    // Live quest pages: Call of Water was handed in since the last save, so it moves to "Just completed".
    await page.locator('[data-nav="now"]').first().click();
    await frame({ seq: 6, level: 17, position: { mapId: 1413, x: 0.51, y: 0.30, facing: 1 }, questLog: [{ id: 5728, complete: false }], turnedIn: [96] });
    await page.locator(".now-done").getByText("Call of Water").waitFor({ timeout: 15000 });
    assert.match(await page.locator(".now-questlog h2").innerText(), /Live/);
    assert.ok(!(await page.locator(".now-step h3").allTextContents()).some((t) => /Call of Water/.test(t)), "a handed-in quest is not a step any more");
    // Layout: two independent columns (no gaps between cards) and a main menu that fits without scrolling.
    const layout = await page.evaluate(() => {
      const gaps = [...document.querySelectorAll(".now-col")].map((col) => { const cards = [...col.children].map((c) => c.getBoundingClientRect()); return Math.max(0, ...cards.slice(1).map((r, i) => r.top - cards[i].bottom)); });
      const nav = document.querySelector('.rail nav[aria-label="Main navigation"]');
      return { cols: gaps.length, maxGap: Math.max(...gaps), navScrolls: nav.scrollHeight > nav.clientHeight + 1 };
    });
    assert.equal(layout.cols, 2); assert.ok(layout.maxGap <= 20, `cards stack evenly (gap ${layout.maxGap}px)`); assert.equal(layout.navScrolls, false, "main menu fits");
    // The running game still has an older addon: Now asks for one /reload.
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("backstage:gameStatus"); ipcMain.handle("backstage:gameStatus", () => ({ connected: true, addonCurrent: true, addonVersion: "0.21.0", loadedCaptureVersion: "0.20.0", lastSync: new Date(Date.now() - 60000).toISOString(), addonUpdatedAt: new Date(Date.now() - 33000).toISOString(), runtime: { state: "running" } })); });
    await page.locator('[data-nav="now"]').first().click();
    await page.locator('[data-now-act="refresh"]').click();
    await page.locator(".now-reload").getByText(/last save came from Backstage Forever 0\.20\.0/).waitFor();
    assert.match(await page.locator(".now-reload").innerText(), /27 seconds before the update landed/, "an early reload is named with times");
    // Help → Commands explains every command and filters as you type.
    await page.locator('[data-nav="guide"]').first().click();
    await page.locator('[data-nav="commands"]').first().click();
    await page.locator("[data-commands]").waitFor();
    assert.ok(await page.locator(".cmd-row code.cmd-name").count() >= 15);
    await page.screenshot({ path: path.join(capture, "commands.png"), fullPage: true });
    await page.locator("[data-cmd-filter]").fill("trainer");
    const names = await page.locator("[data-cmd-list] .cmd-name").allTextContents();
    assert.ok(names.includes("/bf train") && !names.includes("/bf junk [on|off]"), names.join(","));
    // Help → Data coverage: zone cards per faction.
    await page.locator('[data-nav="coverage"]').first().click();
    await page.locator(".cov-card").first().waitFor();
    assert.ok(await page.locator(".cov-card").count() >= 30);
    await page.locator('[data-cov-faction="Alliance"]').click();
    await page.waitForFunction(() => CoverageView._state().faction === "Alliance");
    await page.screenshot({ path: path.join(capture, "coverage.png"), fullPage: true });
    // Characters → Talents explains itself without game data (no install in this fixture).
    await page.locator('[data-nav="characters"]').first().click();
    await page.locator('[data-nav="talents"]').first().click();
    await page.locator("[data-talents] .tal-empty").first().waitFor();
    assert.match(await page.locator("[data-talents]").innerText(), /Talent trees aren't available yet|Choose a character/);
    // Characters → Journey: painted badge wall, speed splits, rested planner; a new badge celebrates once.
    await page.evaluate(() => localStorage.removeItem("bf-badges-seen"));
    await page.locator('[data-nav="journey"]').first().click();
    await page.locator(".jr-badge.earned").first().waitFor();
    const earned = await page.locator(".jr-badge.earned strong").allTextContents();
    assert.ok(earned.includes("Level 10") && earned.includes("Taking wing") && earned.includes("Wanderer") && earned.includes("Fast learner"), earned.join(","));
    assert.equal(await page.locator(".jr-splits li").count(), 2);
    await page.screenshot({ path: path.join(capture, "journey.png"), fullPage: true });
    await page.evaluate(() => JourneyView._show({ id: "first-dungeon", name: "Into the depths", how: "Enter your first dungeon." }, 1));
    await page.locator(".bf-badge-pop").getByText("Into the depths").waitFor();
    await page.screenshot({ path: path.join(capture, "badge-pop.png") });
    console.log("Now smoke passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
