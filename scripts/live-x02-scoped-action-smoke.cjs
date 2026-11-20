"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { navigate } = require("./player-navigation.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.BF_TEST_SCRATCH || os.tmpdir(), "bf-live-x02-"));
  let app;
  try {
    const source = { kind: "wow-addon", id: "Synthetic-A", updatedAt: new Date().toISOString() };
    const quest = { id: 1061, title: "The Spirits of Stonetalon", complete: true, objectives: [], destination: { mapId: 1413, x: 0.123456, y: 0.654321 } };
    const alpha = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 24, race: "Tauren", faction: "Horde", goals: [], notes: "",
      source, clientBuild: "1.60.1.70888", locale: "enUS", captureVersion: "0.6.0",
      quests: [quest, { ...quest, id: 1062 }] };
    const beta = { ...alpha, id: "Beta", name: "Beta", source: { ...source, id: "Synthetic-B" } };
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [alpha, beta] });
    const journal = path.join(dir, "state.json");
    await fs.writeFile(journal, JSON.stringify(state));
    await fs.mkdir(path.join(dir, "knowledge-v1"));
    await fs.writeFile(path.join(dir, "knowledge-v1/preferences.json"), JSON.stringify({ automatic: false, checked: {} }));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-x02-fixture", version: "1.0.0", main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.join(__dirname, "../package.json"))});
      const { clipboard, ipcMain } = require('electron');
      globalThis.x02 = { copied: [], provider: [], held: false };
      clipboard.writeText = text => x02.copied.push(text);
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => handle(channel, async (...args) => {
        if (channel === 'backstage:ask') x02.provider.push(channel);
        if (x02.held === 'map' && channel.endsWith(':worldMap')) {
          x02.held = false;
          const result = await fn(...args);
          await new Promise(resolve => { x02.release = resolve; });
          return result;
        }
        return fn(...args);
      });
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({ state: 'not-running', launchAvailable: false });
      load('./src/core/live-bridge.cjs').LiveBridge.prototype.readPreference = () => false;
      load('./src/core/live-bridge.cjs').LiveBridge.prototype.start = function () {};
      load('./src/core/model-catalog.cjs').listModels = async () => ({ models: [], source: 'fixture' });
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "quest-guide");
    const row = page.locator('[data-quest-id="1061"]');
    const detail = page.locator('[data-quest-control="detail:1061"]');
    const show = detail.getByRole("button", { name: "Show saved marker on map", exact: true });
    const back = page.getByRole("button", { name: "Return to Quest Guide", exact: true });
    await row.click();
    const before = await fs.readFile(journal);
    await show.press("Enter");
    await back.waitFor();
    assert.equal(await back.getAttribute("data-quest-open"), "1061");
    assert.deepEqual(await page.evaluate(() => {
      const { questId, x, y, mapId } = WorldMapView._state().selected;
      return { questId, x, y, mapId };
    }), { questId: 1061, x: 0.1235, y: 0.6543, mapId: 1413 });
    assert.match(await page.locator('[data-wm-card]').innerText(), /saved game marker[\s\S]*1\.60\.1\.70888[\s\S]*paste.*game chat/i);
    assert.ok(await back.evaluate(node => node === document.activeElement));
    await back.evaluate(node => { node.dataset.questOpen = '1062'; });
    await page.keyboard.press("Enter");
    await page.locator('#toast').getByText(/saved quest marker is no longer current/).waitFor();
    await back.evaluate(node => { node.dataset.questOpen = '1061'; });
    await page.keyboard.press("Enter");
    await show.waitFor();
    assert.deepEqual(await fs.readFile(journal), before);
    assert.deepEqual(await app.evaluate(() => [x02.copied, x02.provider]), [[], []]);
    await detail.getByRole("button", { name: "Copy game waypoint" }).press("Enter");
    assert.deepEqual(await app.evaluate(() => x02.copied), ["/bf guide 1061 t 1413 0.1235 0.6543 1.60.1.70888"]);

    await app.evaluate(() => { x02.held = 'map'; });
    await show.press("Enter");
    await page.locator('[data-world-map]').waitFor();
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && !x02.release; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!x02.release) throw Error('Map reply did not reach the hold');
    });
    await page.locator('#active-character').selectOption('Beta');
    await page.waitForFunction(() => !characterSelectionPending() && profile()?.id === 'Beta');
    await app.evaluate(() => x02.release());
    await page.waitForFunction(() => WorldMapView._state().model?.profileId === 'Beta');
    assert.equal(await back.count(), 0);
    assert.deepEqual(await app.evaluate(() => [x02.copied.length, x02.provider]), [1, []]);

    // A newer reference request can replace a held scoped request, not just another scoped one.
    await page.locator('#active-character').selectOption('Alpha');
    await page.waitForFunction(() => !characterSelectionPending() && profile()?.id === 'Alpha' && WorldMapView._state().model?.profileId === 'Alpha');
    await navigate(page, 'quest-guide');
    await row.click();
    await app.evaluate(() => { x02.release = null; x02.held = 'map'; });
    await show.press('Enter');
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && !x02.release; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!x02.release) throw Error('Scoped Map reply did not reach the hold');
    });
    await page.evaluate(() => WorldMapView.focus({ kind: 'objective-area', questId: 999999, index: 1, mapId: 1411, x: .5, y: .5, label: 'New reference focus' }));
    await app.evaluate(() => x02.release());
    await page.locator('[data-wm-card]').getByText(/No matching objective area/).waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const { model, selected } = WorldMapView._state();
      return [model.mapId, selected.label, model.areas.some(a => a.questId === 999999)];
    }), [1411, 'New reference focus', false]);
    assert.equal(await back.count(), 0);
    assert.deepEqual(await app.evaluate(() => [x02.copied.length, x02.provider]), [1, []]);
    assert.deepEqual(errors, []);
    console.log("LIVE-X02 Electron: exact keyboard round-trip, manual copy only, stale Map reply discarded and newer reference focus honoured");
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
