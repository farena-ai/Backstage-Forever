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
  const watchdog = setTimeout(() => { console.error("World map fixture exceeded 240 seconds"); app?.process().kill(); process.exitCode = 1; }, 240000);
  try {
    const profile = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", clientBuild: "1.60.1.70888", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.52, y: 0.29 },
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
    // A small community pack in the Barrens, away from the map centre: 24 herb and ore spots in one
    // corner, one chest elsewhere, and a spot that matches one of this character's own finds.
    // Pack format minor 1: every spot says when it was first and last seen. Half of the cluster and
    // the chest were not seen for over a month; one herb is listed by the service as this install's own.
    const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
    const packRows = [["herb", 1618, null, 1413, 0.44, 0.36, 4, day(20), day(2)], ["chest", 2843, null, 1413, 0.8, 0.8, 3, day(60), day(45)]];
    for (let i = 0; i < 24; i++) packRows.push([i % 2 ? "ore" : "herb", null, i % 2 ? "Tin Vein" : "Mageroyal", 1413, 0.2 + (i % 6) * 0.01, 0.7 + Math.floor(i / 6) * 0.01, 3 + (i % 5), day(50), day(i < 12 ? 5 : 40)]);
    const installId = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
    await fs.mkdir(path.join(dir, "community"), { recursive: true });
    await fs.writeFile(path.join(dir, "community", "pack.json"), JSON.stringify({ format: 1, minor: 1, version: "smoke-1", generatedAt: new Date(Date.now() - 3 * 86400000).toISOString(), minInstalls: 3,
      nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs", "firstSeen", "lastSeen"], rows: packRows } }));
    await fs.writeFile(path.join(dir, "community", "settings.json"), JSON.stringify({ installId, share: false, download: true, lastPackCheckAt: Date.now() }));
    await fs.writeFile(path.join(dir, "community", "mine.json"), JSON.stringify({ schemaVersion: 1, installId, total: 1, truncated: false, keys: ["herb:1618:1413:0.44:0.36"] }));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-worldmap-fixture", version: "0.15.0", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      load('./src/core/community.cjs').CommunityService.prototype.start=function(){};
      const { clipboard, ipcMain } = require('electron');
      clipboard.writeText=value=>{globalThis.fixtureClipboard=value;};
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => handle(channel, async (...args) => {
        const result = await fn(...args);
        if (channel.endsWith(':worldMapNpc') && globalThis.holdNpcDetails) {
          globalThis.holdNpcDetails = false;
          await new Promise(resolve => { globalThis.releaseNpcDetails = resolve; });
        }
        return result;
      });
      const L=load('./src/core/live-bridge.cjs');
      L.LiveBridge.prototype.readPreference=function(){globalThis.liveFixture={bridge:this};return false;};L.LiveBridge.prototype.start=function(){};
      load('./src/main.cjs');
    `);
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(10000);
    const setSize = (width, height) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await setSize(1500, 1000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "world-map");
    await page.locator("[data-wm-title]").getByText("The Barrens").waitFor();
    const s = () => page.evaluate(() => { const v = WorldMapView._state(); return { mapId: v.model?.mapId, pins: v.model?.pins.length, counts: v.model?.counts, selected: v.selected?.label, results: v.results?.results.length }; });
    let st = await s();
    assert.equal(st.mapId, 1413);
    assert.ok(st.counts["quest-turnin"] >= 1, "turn-in pin");
    assert.ok(st.counts["quest-giver"] >= 5 && st.counts.flight >= 1 && st.counts.vendor >= 5);
    const legend = page.locator("[data-wm-legend]");
    const layerGroups = {
      Questing: ["quest-turnin", "quest-objective", "objective-area", "quest-giver"],
      Gathering: ["herb", "ore", "find", "heat"],
      Community: ["c-herb", "c-ore", "c-chest", "c-object", "c-npc", "c-vendor"],
      Services: ["flight", "class-trainer", "profession-trainer", "vendor", "npc", "otherFaction"],
      Journey: ["journey"],
    };
    for (const [name, keys] of Object.entries(layerGroups)) {
      const group = legend.getByRole("group", { name, exact: true });
      assert.deepEqual(await group.locator("[data-wm-layer]").evaluateAll((inputs) => inputs.map((input) => input.dataset.wmLayer)), keys, `${name} contains its own layer choices`);
    }
    assert.equal(await legend.getByRole("checkbox", { name: /Other NPCs/ }).isChecked(), false);
    assert.equal(await legend.getByRole("checkbox", { name: /My path this session/ }).isChecked(), true);
    assert.equal(await legend.getByRole("checkbox", { name: /Other faction's NPCs/ }).count(), st.counts.otherFaction ? 1 : 0);
    assert.equal(await legend.getByRole("checkbox", { name: /NPCs players placed/ }).isChecked(), false, "the busiest community layer starts off");
    const community = legend.getByRole("checkbox", { name: /Community herbs/ });
    await community.focus();
    await page.keyboard.press("Space");
    assert.equal(await community.isChecked(), false, "a focused layer toggles with Space");
    await page.keyboard.press("Space");
    assert.equal(await community.isChecked(), true);
    const layout = () => page.evaluate(() => {
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const root = document.querySelector("[data-world-map]");
      return { root: bounds("[data-world-map]"), canvas: bounds("[data-wm-canvas]"), card: bounds("[data-wm-card]"), tools: bounds(".wm-tools"), overflow: root.scrollWidth - root.clientWidth };
    });
    const desktop = await layout();
    assert.ok(desktop.tools.bottom <= desktop.canvas.top, "map controls do not cover the drawing");
    assert.ok(desktop.card.left >= desktop.canvas.right && desktop.card.top <= desktop.canvas.top, "selection starts beside the desktop workspace");
    assert.ok(desktop.canvas.width > desktop.card.width * 1.5 && desktop.overflow <= 1, "the desktop map is the widest surface");
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
    const areaReason = page.locator("[data-wm-card] details[data-wm-provenance]");
    await areaReason.locator("summary").press("Enter");
    await areaReason.getByText(/Approximate area/).waitFor();
    assert.match(await areaReason.innerText(), /Efficient Games · merged Forever quest reference[\s\S]*Exact build not recorded[\s\S]*not a live spawn/i);
    await page.screenshot({ path: path.join(capture, "world-map-objective-area.png") });
    await page.locator('[data-wm-card] [data-wm-act="focus-area"]').click();
    await page.waitForFunction((id) => { const v = WorldMapView._state(); return v.focused?.pin?.id === id && v.focused.pin.kind === "objective-area" && v.view.zoom > 1; }, picked.id);
    await page.locator("[data-wm-goal]").waitFor();
    await page.locator(".wm-head").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(capture, "world-map-objective-focus.png") });
    await page.locator('[data-wm-act="unfocus"]').click();
    // A quest-page point with no matched observation may be marked, but must not invent an area.
    await page.evaluate(() => WorldMapView.focus({ kind: "objective-area", questId: 999999, index: 1, mapId: 1413, x: 0.5, y: 0.5, label: "Unmatched objective" }));
    await page.waitForFunction(() => WorldMapView._state().selected?.label === "Unmatched objective");
    await page.locator("[data-wm-card]").getByText(/No matching objective area/).waitFor();
    assert.equal(await page.evaluate(() => WorldMapView._state().model.areas.length), areaCount);
    // Search across zones, open a result.
    await page.locator("[data-wm-search] input").fill("flight master");
    await page.locator("[data-wm-search] button").click();
    await page.locator("[data-wm-results] li").first().waitFor();
    st = await s();
    assert.ok(st.results >= 3);
    await app.evaluate(() => { globalThis.holdNpcDetails = true; });
    await page.locator("[data-wm-results] li button", { hasText: "Devrak" }).click();
    await page.locator("[data-wm-card] h3").getByText("Devrak").waitFor();
    await page.locator("[data-wm-card]").getByText(/From you \(live\): /).waitFor();
    const firstPinReason = page.locator("[data-wm-card] details[data-wm-provenance]");
    const firstPinSummary = firstPinReason.locator('summary');
    const loadingNpc = page.locator('[data-wm-card]').getByText('Loading details…');
    await loadingNpc.waitFor();
    await firstPinSummary.press('Enter');
    await firstPinReason.getByText('Verified reference pin').waitFor();
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && !globalThis.releaseNpcDetails; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!globalThis.releaseNpcDetails) throw Error('NPC details did not reach the hold');
      globalThis.releaseNpcDetails();
    });
    await loadingNpc.waitFor({ state: 'hidden' });
    assert.deepEqual(await firstPinSummary.evaluate(el => [el.parentElement.open, el === document.activeElement]), [true, true], 'NPC enrichment preserves the open keyboard disclosure');
    await page.locator("[data-wm-act=way]").click();
    const clip = await app.evaluate(() => globalThis.fixtureClipboard);
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
    // At the minimum native window width, the map stacks directly above the selection.
    await setSize(1000, 720);
    await page.waitForFunction(() => innerWidth < 1050);
    const compact = await layout();
    assert.ok(compact.card.top >= compact.canvas.bottom && compact.card.top - compact.canvas.bottom < 80, "compact selection immediately follows the map");
    assert.ok(compact.tools.bottom <= compact.canvas.top && compact.canvas.width > compact.root.width * .9 && compact.overflow <= 1, "compact map and toolbar fit without overlap or sideways scrolling");
    await page.locator("[data-wm-canvas]").focus();
    await page.keyboard.press("0");
    assert.equal(await page.evaluate(() => WorldMapView._state().view.zoom), 1);
    await page.keyboard.press("=");
    assert.ok(await page.evaluate(() => WorldMapView._state().view.zoom > 1), "the focused canvas still zooms from the keyboard");
    const search = page.getByRole("searchbox", { name: "Find on the map" });
    await search.fill("flight master");
    await search.press("Enter");
    const resultsPanel = page.getByRole("region", { name: "Map search results" });
    await page.waitForFunction(() => document.activeElement.matches("[data-wm-results]"));
    await resultsPanel.getByRole("button", { name: /Devrak/ }).press("Enter");
    const selection = page.getByRole("region", { name: "Map selection" });
    const heading = selection.getByRole("heading", { name: "Devrak" });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement.matches("[data-wm-card]"));
    const headingBounds = await heading.boundingBox();
    assert.ok(headingBounds.y >= 0 && headingBounds.y + headingBounds.height <= await page.evaluate(() => innerHeight), "compact search selection is brought into view");
    await selection.getByText("Loading details…").waitFor({ state: "hidden" });
    const pinReason = selection.locator("details[data-wm-provenance]");
    const summary = pinReason.locator("summary", { hasText: "Why is this pin here?" });
    assert.equal(await pinReason.evaluate((el) => el.open), false);
    await summary.press("Enter");
    await pinReason.getByText(/Verified reference pin/).waitFor();
    assert.deepEqual(await summary.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.color, style.outlineColor, style.outlineWidth, el === document.activeElement];
    }), ["rgb(74, 50, 24)", "rgb(122, 31, 20)", "2px", true], "the keyboard disclosure and focus ring use dark ink on parchment");
    assert.match(await pinReason.innerText(), /Efficient Games · reviewed travel reference[\s\S]*1\.60\.1\.70862[\s\S]*not a live spawn/i);
    assert.doesNotMatch(await pinReason.innerText(), /1\.60\.1\.70888/);
    await page.screenshot({ path: path.join(capture, "world-map-compact-selection.png") });
    await page.locator(".wm-head").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(capture, "world-map-compact.png") });
    await resultsPanel.getByRole("button", { name: "Clear search" }).press("Enter");
    assert.equal(await search.evaluate((input) => input === document.activeElement), true);
    await setSize(1500, 1000);
    await page.waitForFunction(() => innerWidth > 1400);
    await app.evaluate(() => { const b = liveFixture.bridge; b.frame = { ...b.frame, seq: 2, receivedAt: Date.now(), position: { mapId: 1413, x: 0.55, y: 0.2, facing: 0 } }; b.emit(); });
    await page.locator("[data-wm-near]").getByRole("button", { name: /Battered Chest/ }).press("Enter");
    const findReason = selection.locator("details[data-wm-provenance]");
    await findReason.locator("summary").press("Enter");
    await findReason.getByText("Private find", { exact: true }).waitFor();
    assert.match(await findReason.innerText(), /Source: Your addon[\s\S]*1\.60\.1\.70888[\s\S]*where you stood[\s\S]*not a live spawn/);
    // Instance Atlas: difficulty colours, your quests, and the jump to the World Map.
    await navigate(page, "dungeons");
    const rfc = page.locator('[data-atlas-card="rfc"]');
    await rfc.waitFor();
    assert.match(await rfc.getAttribute("class"), /d-right/);
    await page.locator(".atlas-chip", { hasText: "Ragefire Chasm" }).waitFor();
    await rfc.locator("[data-atlas-open]").click();
    await rfc.getByText("Hidden Enemies").waitFor();
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
    // Community layers: counted marks at the default zoom, the coverage line, freshness and the skill filter.
    await page.locator("[data-wm-canvas]").press("0");
    const shared = () => page.evaluate(() => { const v = WorldMapView._state(); return { community: v.model.community, marks: v.clusters.filter((c) => c.shared).map((c) => c.pins.length), counts: v.model.counts, only: v.onlyGatherable, within: v.seenWithin, stale: v.model.pins.filter((p) => p.community && p.stale).length }; });
    let sh = await shared();
    assert.equal(sh.community.total, 26); assert.equal(sh.community.ageDays, 3); assert.equal(sh.community.perFactDates, true);
    assert.deepEqual([sh.community.yours, sh.community.yoursExact], [1, true], "the one spot the service lists for this install, not a guess from local finds");
    assert.deepEqual([sh.community.stale, sh.stale, sh.within], [13, 13, 0], "twelve of the cluster and the chest were not seen for over 30 days");
    assert.deepEqual([sh.counts["c-herb"], sh.counts["c-ore"], sh.counts["c-chest"]], [13, 12, 1]);
    assert.ok(sh.marks.length <= 4 && sh.marks.reduce((t, n) => t + n, 0) === 26 && sh.marks[0] >= 20, `26 shared spots are a few counted marks at the default zoom: ${sh.marks}`);
    const cbox = page.locator("[data-wm-community]");
    await cbox.locator("[data-wm-c-line]").getByText(/The community has\s+26\s+spots here/).waitFor();
    await cbox.getByText("3 days ago").waitFor();
    await cbox.getByText(/how many players saw it and when it was last seen/).waitFor();
    assert.equal(await cbox.getByText(/one date for everything/).count(), 0);
    assert.equal((await cbox.locator('[data-wm-c-yours="exact"]').innerText()).trim(), "1");
    await cbox.getByText("is from you").waitFor();
    await cbox.locator("[data-wm-c-fresh]").getByText(/are faded: not seen for over 30 days/).waitFor();
    await cbox.scrollIntoViewIfNeeded();
    await cbox.screenshot({ path: path.join(capture, "world-map-community-panel.png") });
    await page.locator("[data-wm-canvas]").screenshot({ path: path.join(capture, "world-map-community-faded.png") });
    // "Seen in the last 7 days" hides the older spots and says how many; the choice is kept.
    const within = cbox.getByRole("combobox", { name: "Show spots seen" });
    assert.deepEqual(await within.locator("option").allInnerTexts(), ["at any time", "in the last 7 days", "in the last 30 days", "in the last 90 days"]);
    await within.selectOption("7");
    sh = await shared();
    assert.equal(sh.within, 7); assert.equal(sh.marks.reduce((t, n) => t + n, 0), 13, "the herb seen 2 days ago and the twelve seen 5 days ago stay");
    await cbox.locator("[data-wm-c-fresh]").getByText(/^13$/).waitFor();
    await cbox.locator("[data-wm-c-fresh]").getByText("hidden as older").waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bf-world-map-v2")).seenWithin), 7);
    await cbox.screenshot({ path: path.join(capture, "world-map-community-panel-7-days.png") });
    await cbox.getByRole("combobox", { name: "Show spots seen" }).selectOption("30");
    assert.equal((await shared()).marks.reduce((t, n) => t + n, 0), 13);
    await cbox.getByRole("combobox", { name: "Show spots seen" }).selectOption("90");
    assert.equal((await shared()).marks.reduce((t, n) => t + n, 0), 26);
    await cbox.getByRole("combobox", { name: "Show spots seen" }).selectOption("0");
    assert.equal((await shared()).marks.reduce((t, n) => t + n, 0), 26);
    assert.equal(await page.locator("[data-wm-fill]").isHidden(), true, "a well covered zone shows no help card");
    // This character has no saved professions, so nothing is known to be out of reach: the filter hides nothing it cannot prove.
    await cbox.getByRole("checkbox", { name: "Only what my skill can gather" }).check();
    sh = await shared();
    assert.equal(sh.only, true); assert.equal(sh.marks.reduce((t, n) => t + n, 0), 26);
    await cbox.getByRole("checkbox", { name: "Only what my skill can gather" }).uncheck();
    await page.locator("[data-wm-layer=c-ore]").uncheck();
    assert.equal((await shared()).marks.reduce((t, n) => t + n, 0), 14, "a community layer hides only its own spots");
    await page.locator("[data-wm-layer=c-ore]").check();
    assert.equal(await page.locator("[data-wm-layer=c-object]").isChecked(), false, "the objects layer starts off");
    // A thin zone says what is missing and how to help; plain words, nothing else changes.
    await page.locator("[data-wm-zone]").selectOption({ label: "Alterac Mountains" });
    await page.locator("[data-wm-title]").getByText("Alterac Mountains").waitFor();
    const fill = page.locator("[data-wm-fill]");
    await fill.getByRole("heading", { name: "Help fill this zone" }).waitFor();
    await fill.getByText("/bf scout on").waitFor();
    assert.ok(await fill.locator("li").count() >= 2);
    await page.locator("[data-wm-zone]").selectOption({ label: "The Barrens" });
    await page.locator("[data-wm-title]").getByText("The Barrens").waitFor();

    // Search everything (Ctrl+K): an overlay over any page; results open the right screen.
    const rail = page.locator(".rail [data-world-search-open]");
    assert.equal(await rail.count(), 1); assert.equal(await rail.getAttribute("aria-label"), "Search everything");
    await page.keyboard.press("Control+k");
    const ws = page.locator("[data-world-search]"), wsInput = ws.locator("[data-ws-input]");
    await wsInput.waitFor();
    assert.equal(await wsInput.evaluate((n) => document.activeElement === n), true, "the box has the keyboard");
    assert.equal(await page.locator("[data-world-map]").count(), 1, "the page under the overlay is still there");
    await wsInput.fill("hidden enemies");
    await ws.locator('[data-ws-row] .ws-name', { hasText: "Hidden Enemies" }).first().waitFor();
    const found = await page.evaluate(() => { const v = WorldSearchView._state(); return { groups: v.data.groups.map((g) => g.kind), first: v.flat[0], ms: v.data.ms, entries: v.data.index.entries, built: v.data.index.builtMs }; });
    assert.equal(found.groups[0], "quest"); assert.equal(found.first.name, "Hidden Enemies"); assert.equal(found.first.sourceLabel, "Bundled reference");
    assert.ok(found.entries > 8000 && found.ms < 250, `${found.entries} entries, ${found.ms} ms`);
    assert.equal(await ws.locator('[data-ws-row][aria-selected="true"]').count(), 1);
    await ws.locator("[data-ws-detail]").getByText("Opens this quest in Quests.").waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await ws.locator('[data-ws-row][aria-selected="true"]').getAttribute("data-ws-row"), "1", "arrow keys move the selection");
    await page.keyboard.press("ArrowUp");
    await ws.screenshot({ path: path.join(capture, "world-search.png") });
    await page.keyboard.press("Enter");
    await page.locator("[data-quest-guide], .quest-guide, [data-quest-details]").first().waitFor();
    assert.equal(await ws.isHidden(), true, "opening a result closes the overlay");
    assert.equal(await page.evaluate(() => document.body.dataset.page), "quest-guide");
    // A zone opens the World Map on it; a command opens Help → Commands on its row; Esc closes.
    await rail.click();
    await wsInput.fill("durotar");
    await ws.locator('[data-ws-row]:has(.ws-name:text-is("Durotar"))').first().click();
    await page.locator("[data-wm-title]").getByText("Durotar").waitFor();
    await page.keyboard.press("Control+k");
    await wsInput.fill("/bf way");
    await ws.locator('[data-ws-row] .ws-name', { hasText: "/bf way" }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.locator(".cmd-row.cmd-found .cmd-name").getByText("/bf way").waitFor();
    await page.keyboard.press("Control+k");
    await wsInput.fill("bazzalan");
    await ws.locator('[data-ws-row]:has(.ws-name:text-is("Bazzalan"))').first().click();
    await page.locator('[data-atlas-card="rfc"] .atlas-bosses li.atlas-found').getByText("Bazzalan").waitFor();
    await page.keyboard.press("Control+k");
    await wsInput.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await ws.isHidden(), true);
    // Quest loop receipt belongs to this character and this map; a second read can advance it.
    const loopReceipt = { profileId: "Alpha", loop: { mapId: 1413, currentIndex: 0, stops: [
      { kind: "turnin", questId: 96, title: "Hand in Call of Water", evidence: "verified-turn-in", where: { mapId: 1413, x: .47, y: .4 }, detail: "Talk to the recorded quest finisher.", done: false },
      { kind: "objective", questId: 5728, title: "Continue Hidden Enemies", evidence: "recorded-objective", where: { mapId: 1413, x: .57, y: .53 }, detail: "Work on your objective in this area.", done: false },
    ] } };
    await app.evaluate(({ ipcMain }, receipt) => {
      const name = "backstage:questLoop";
      globalThis.fixtureQuestLoop = receipt;
      ipcMain.removeHandler(name);
      ipcMain.handle(name, () => globalThis.fixtureQuestLoop);
    }, loopReceipt);
    await navigate(page, "world-map");
    await page.evaluate(() => WorldMapView.focus({ mapId: 1413, x: .47, y: .4, label: "Call of Water", goal: { title: "Hand in Call of Water", questId: 96, evidence: "likely-quest-giver" } }, { fitLoop: true }));
    const stops = page.locator("[data-wm-quest-loop]");
    await stops.locator('[data-wm-quest-stop="0"][aria-current="step"]').getByText("Hand in Call of Water").waitFor();
    const goal = page.locator("[data-wm-goal]");
    await goal.getByText("Likely quest giver", { exact: true }).waitFor();
    assert.match(await goal.innerText(), /Check the turn-in in your quest log/);
    assert.equal(await page.getByRole("button", { name: "Copy waypoint for WoW" }).count(), 1);
    await stops.locator('[data-wm-quest-stop="1"]').click();
    await goal.getByText("Continue Hidden Enemies", { exact: true }).waitFor();
    await goal.getByText("Recorded objective area", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => WorldMapView._state().view.cx), .57);
    const mapSurface = page.locator("[data-wm-canvas]");
    await mapSurface.scrollIntoViewIfNeeded();
    const firstPin = await mapSurface.evaluate((canvas) => {
      const { view } = WorldMapView._state(), bounds = canvas.getBoundingClientRect();
      return { x: bounds.width * ((.47 - view.cx) * view.zoom + .5), y: bounds.height * ((.4 - view.cy) * view.zoom + .5) };
    });
    await mapSurface.click({ position: firstPin });
    await goal.getByText("Verified turn-in", { exact: true }).waitFor();
    await app.evaluate(() => { fixtureQuestLoop.loop.stops[0].done = true; fixtureQuestLoop.loop.currentIndex = 1; });
    await stops.locator('[data-wm-quest-stop="1"][aria-current="step"]').getByText("Continue Hidden Enemies").waitFor();
    assert.match(await stops.locator('[data-wm-quest-stop="0"]').innerText(), /Completed/);
    await page.evaluate(() => WorldMapView.focusZone(1411));
    await page.locator("[data-wm-title]").getByText("Durotar").waitFor();
    await stops.waitFor({ state: "hidden" });
    assert.deepEqual(pageErrors, [], "no uncaught errors in the main renderer");
    console.log("World map smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
