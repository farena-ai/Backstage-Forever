"use strict";
// Real main/preload/renderer with synthetic journal data and a synthetic live frame.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
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
    // Remembered nodes: herbs, ore and chests in the Barrens plus one in Durotar (gathering heat layer).
    const at = "2026-11-01T12:00:00.000Z", node = (method, entityId, mapId, x, y, name) => ({ id: `wowf:${method}:${entityId}:${mapId}:${Math.floor(x * 10000 + .5)}:${Math.floor(y * 10000 + .5)}:1.60.1.70888`, method, entityId, itemIds: [2449], mapId, x, y, observedAt: at, clientBuild: "1.60.1.70888", name, evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true });
    const records = [];
    for (let i = 0; i < 9; i++) records.push(node("herbalism", 1618, 1413, 0.44 + (i % 3) * 0.02, 0.36 + Math.floor(i / 3) * 0.02, "Earthroot"));
    for (let i = 0; i < 5; i++) records.push(node("mining", 1731, 1413, 0.6 + i * 0.015, 0.5 - i * 0.01, "Copper Vein"));
    records.push(node("chest", 2843, 1413, 0.55, 0.2, "Battered Chest"), node("herbalism", 1617, 1411, 0.5, 0.5, "Silverleaf"));
    profile.gathering = { schemaVersion: 1, status: "available", recording: true, observedAt: at, limited: false, totalRecords: records.length, records };
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
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
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
    // Gathering heat: drawn from the remembered nodes, counted per zone, zone rows switch maps.
    assert.equal(st.counts.heat, 15);
    assert.equal(st.counts.find, 15);
    const heatBox = page.locator("[data-wm-heat]");
    await heatBox.getByText("9 herbs").waitFor();
    assert.match(await heatBox.innerText(), /5 ore nodes[\s\S]*1 chest[\s\S]*The Barrens[\s\S]*Durotar/);
    assert.ok(!(await page.locator(".wm-heat [style]").count()), "no inline styles");
    // Objective areas: on by default, toggled from the legend, clickable, and dialed in from their card.
    const areaLayer = page.locator("[data-wm-layer=objective-area]");
    assert.equal(await areaLayer.isChecked(), true, "objective areas are on by default");
    const areaCount = await page.evaluate(() => WorldMapView._state().model.areas.length);
    assert.ok(areaCount >= 5, `Barrens objective areas: ${areaCount}`);
    await areaLayer.uncheck();
    assert.equal(await page.evaluate(() => WorldMapView._state().layers["objective-area"]), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bf-world-map-v2")).layers["objective-area"]), false, "the choice is remembered");
    await areaLayer.check();
    // Click an area centre that no pin covers.
    const spot = await page.evaluate(() => {
      const { model, view } = WorldMapView._state(), c = document.querySelector("[data-wm-canvas]"), r = c.getBoundingClientRect();
      const toScreen = (x, y) => [(x - view.cx) * c.width * view.zoom + c.width / 2, (y - view.cy) * c.height * view.zoom + c.height / 2];
      const pins = model.pins.filter((p) => p.kind !== "town").map((p) => toScreen(p.x, p.y));
      for (const a of [...model.areas].sort((p, q) => q.radius - p.radius)) {
        const [sx, sy] = toScreen(a.x, a.y);
        if (pins.every(([px, py]) => Math.hypot(px - sx, py - sy) > 26)) return { id: a.id, label: a.label, x: r.left + sx * r.width / c.width, y: r.top + sy * r.height / c.height };
      }
      return null;
    });
    assert.ok(spot, "an objective area clear of pins");
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(() => WorldMapView._state().selected?.kind === "objective-area");
    // The smallest area under the cursor wins, so read back which one was picked.
    const picked = await page.evaluate(() => { const a = WorldMapView._state().selected; return { id: a.id, label: a.label }; });
    await page.locator("[data-wm-card] h3").getByText(picked.label, { exact: true }).waitFor();
    await page.locator("[data-wm-card] [data-quest-open]").first().waitFor();
    await page.screenshot({ path: path.join(capture, "world-map-objective-area.png") });
    await page.locator('[data-wm-card] [data-wm-act="focus-area"]').click();
    await page.waitForFunction((id) => { const v = WorldMapView._state(); return v.focused?.pin?.id === id && v.focused.pin.kind === "objective-area" && v.view.zoom > 1; }, picked.id);
    await page.locator("[data-wm-goal]").waitFor();
    await page.locator(".wm-head").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(capture, "world-map-objective-focus.png") });
    await page.locator('[data-wm-act="unfocus"]').click();
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
    // Pop-out radar tracks the chosen pin around the live position.
    const radarOpen = app.waitForEvent("window");
    await page.locator("[data-wm-act=track]").click();
    const radar = await radarOpen;
    await radar.waitForLoadState("domcontentloaded");
    await radar.waitForFunction(() => window.__radar?.().state?.target?.label === "Devrak" && window.__radar().state.live);
    assert.match(await radar.locator("[data-radar-target]").innerText(), /Devrak[\s\S]*south/);
    assert.match(await radar.locator("[data-radar-zone]").innerText(), /The Barrens · 60\.0, 8\.0/);
    const rimPainted = await radar.evaluate(() => { const c = document.querySelector("[data-radar-canvas]"); const d = c.getContext("2d").getImageData(c.width / 2, 6, 1, 1).data; return d[3]; });
    assert.ok(rimPainted > 0, "radar ring painted");
    await radar.screenshot({ path: path.join(capture, "radar.png") });
    await radar.locator('[data-radar="close"]').click();
    // Zone switch and layer toggle.
    await page.locator("[data-wm-zone]").selectOption("1456");
    await page.locator("[data-wm-title]").getByText("Thunder Bluff").waitFor();
    st = await s();
    assert.ok(st.counts["class-trainer"] >= 5 && st.counts["profession-trainer"] >= 5, "trainers split into class and profession pins");
    await page.locator("[data-wm-layer=profession-trainer]").uncheck();
    await page.locator("[data-wm-layer=profession-trainer]").check();
    await page.screenshot({ path: path.join(capture, "world-map-thunder-bluff.png") });
    // NPC card: a class trainer lists what it teaches; quests open from the card.
    await page.locator("[data-wm-search] input").fill("hunter trainer");
    await page.locator("[data-wm-search] button").click();
    await page.locator("[data-wm-result]").first().click();
    await page.locator("[data-wm-card]").getByText(/Trains · /).waitFor();
    await page.screenshot({ path: path.join(capture, "world-map-npc-card.png") });
    // NPC hover card from the search results (0.30).
    const npcName = page.locator("[data-wm-results] [data-card-npc]").first();
    await npcName.waitFor();
    await page.mouse.move(5, 5); await npcName.hover({ position: { x: 6, y: 4 } });
    await page.locator(".hover-card.hc-kind-npc").waitFor({ timeout: 6000 });
    assert.match(await page.locator(".hover-card.hc-kind-npc").innerText(), /Trainer|skill/i);
    await page.screenshot({ path: path.join(capture, "world-map-npc-hover.png") });
    await page.mouse.move(5, 5);
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
    // Loot browser (0.30): boss sections with item tiles, hover cards and the wish list.
    await rfc.locator(".atlas-loot-btn").click();
    await rfc.locator(".loot-boss", { hasText: "Bazzalan" }).waitFor();
    assert.equal(await rfc.locator(".loot-boss").count(), 4, "one section per Ragefire Chasm boss");
    const tiles = rfc.locator(".loot-tile[data-card-item]");
    assert.ok(await tiles.count() >= 4, "Ragefire Chasm bosses drop recorded items");
    assert.match(await rfc.locator(".loot-chance").first().innerText(), /^\d+%$/);
    await page.mouse.move(5, 5); await tiles.first().locator(".loot-body").hover();
    await page.locator(".hover-card.hc-kind-item").waitFor({ timeout: 6000 });
    assert.match(await page.locator(".hover-card.hc-kind-item").innerText(), /Drops from .+ \(Ragefire Chasm\)/);
    await page.screenshot({ path: path.join(capture, "dungeon-atlas-loot.png") });
    await tiles.first().locator("[data-loot-wish]").click();
    await rfc.locator(".atlas-wishes [data-card-item]").first().waitFor();
    assert.equal(await rfc.locator(".loot-tile.wished").count(), 1);
    assert.equal(await rfc.locator('[data-loot-wish][aria-pressed="true"]').count(), 1);
    await rfc.locator(".loot-tile.wished [data-loot-wish]").click();
    await rfc.locator(".atlas-wishes").waitFor({ state: "detached" });
    await rfc.locator("[data-atlas-open]").click();
    await page.locator('[data-atlas-tab="forever"]').click();
    await page.locator(".atlas-card", { hasText: "Shade of the Archmage" }).first().waitFor().catch(async () => { await page.locator(".atlas-card").first().locator("[data-atlas-open]").click(); });
    await page.locator('[data-atlas-tab="dungeon"]').click();
    await page.locator('[data-atlas-card="rfc"] [data-atlas-open]').click();
    await page.locator('[data-atlas-map="rfc"]').click();
    await page.waitForFunction(() => window.WorldMapView._state().selected?.label === "Ragefire Chasm entrance");
    await page.locator("[data-wm-title]").getByText("Orgrimmar").waitFor();
    await page.screenshot({ path: path.join(capture, "world-map-instance.png") });
    // Gathering heat zone rows switch maps (from Orgrimmar back to the Barrens) and the layer toggles.
    await page.locator("[data-wm-heat-zone='1413']").click();
    await page.locator("[data-wm-title]").getByText("The Barrens").waitFor();
    await heatBox.getByText("9 herbs").waitFor();
    await page.locator("[data-wm-canvas]").screenshot({ path: path.join(capture, "world-map-heat.png") });
    await heatBox.screenshot({ path: path.join(capture, "world-map-heat-panel.png") });
    await page.locator("[data-wm-layer=heat]").uncheck(); assert.equal(await heatBox.isHidden(), true); await page.locator("[data-wm-layer=heat]").check();
    console.log("World map smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
