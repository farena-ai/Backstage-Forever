"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "chest-leads-"));
  let app;
  try {
    const at = "2026-11-19T18:00:00.000Z", build = "1.60.1.70888";
    const profile = { id: "main", name: "Example", className: "Warrior", faction: "Alliance", realm: "Synthetic", level: 35,
      notes: "", goals: [], clientBuild: build, source: { kind: "wow-addon", id: "fixture-main", updatedAt: at },
      journal: { encounters: [{ encounterId: 1144, name: "Edwin VanCleef", instanceMap: 36, instanceType: "party", difficultyId: 1, at: 1700000000 }] },
      quests: [{ id: 166, title: "The Defias Brotherhood", complete: false, objectives: [] }], readiness: { workshop: {
        professions: { observedAt: at, complete: true, items: [{ skillLineId: 164, professionId: 164, name: "Blacksmithing", rank: 80, maxRank: 150 }] },
        recipes: { observedAt: at, complete: false, items: [{ id: 31, skillLineId: 164, name: "Fixture recipe", outputItemId: 100,
          reagentsKnown: true, reagents: [{ itemId: 2840, required: 2 }] }] },
      } } };
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: "main", profiles: [profile,
      { ...profile, id: "alt", name: "Alt", source: { ...profile.source, id: "fixture-alt" }, quests: [], journal: undefined, readiness: undefined, clientBuild: "1.60.1.70862" }] });
    const wishlist = JSON.stringify({ schemaVersion: 1, profiles: { main: [6682] } });
    await fs.writeFile(path.join(dir, "wishlist.json"), wishlist);
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "chest-fixture", version: require('../package.json').version, main: "main.cjs" }));
    await fs.writeFile(path.join(dir, "main.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/claude.cjs').status = async () => ({available:false, connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({state:'not-running', launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({available:false, recognizers:[], voices:[]});
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      const GameData = load('./src/core/game-data.cjs').GameData;
      GameData.prototype.build = () => '${build}';
      const names = {2041:'Tunic of Westfall',285:'Scalemail Vest',100:'Fixture chest',6682:'Death Speaker Robes'};
      GameData.prototype.items = ids => ids.map(id => names[id] ? ({ id, name: names[id], classId: 4, subclassId: 1, inventoryType: id === 6682 ? 20 : 5, requiredLevel: 10, classes: null, quality: 2, stats: [] }) : null);
      const ipc = require('electron').ipcMain, handle = ipc.handle.bind(ipc);
      ipc.handle = (name, fn) => handle(name, async (event, ...args) => {
        const value = await fn(event, ...args);
        if (name === 'backstage:dungeonAtlas' && globalThis.holdAtlas) {
          await new Promise(resolve => { globalThis.releaseAtlas = resolve; });
        }
        if (name === 'backstage:gearAcquisition' && globalThis.holdChest && args[0] === 'main') {
          globalThis.holdChest = false;
          await new Promise(resolve => { globalThis.releaseChest = resolve; });
        }
        return value;
      });
      load('./src/main.cjs');
    `);
    app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    async function atlas() {
      await page.locator('[data-nav="adventure"]').first().click();
      await page.locator('[data-shell-control="subtab:dungeons"]').click();
    }
    await app.evaluate(() => { globalThis.holdAtlas = true; });
    await atlas();
    const summary = page.getByText("Chest gear acquisition leads", { exact: true });
    const panel = page.locator("[data-chest-leads]");
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1000, 760); });
    await summary.press("Enter");
    await panel.getByText(/Dorin Songblade #956/).waitFor();
    assert.deepEqual(await panel.locator("[data-chest-kind]").evaluateAll(els => els.map(el => [el.dataset.chestKind, el.dataset.itemId])),
      [["quest", "2041"], ["vendor", "285"], ["craft", "100"], ["dungeon", "6682"]]);
    await panel.getByText(/Death Speaker Jargba #4428/).waitFor();
    await panel.getByText("On your wish list", { exact: true }).waitFor();
    await panel.getByText(/Stock, price and current access are unknown/).waitFor();
    assert.equal(await summary.evaluate(el => document.activeElement === el), true);
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const dungeonAction = panel.getByRole("button", { name: "Open Razorfen Kraul details" });
    assert.equal(await app.evaluate(() => typeof globalThis.releaseAtlas), "function");
    assert.equal(await dungeonAction.isDisabled(), true, "do not offer a dead dungeon action while Atlas is loading");
    await app.evaluate(() => { globalThis.holdAtlas = false; globalThis.releaseAtlas(); });
    await page.waitForFunction(() => document.querySelector('[data-chest-dungeon]')?.disabled === false);
    const recap = page.getByRole("region", { name: "Your encounter recap" });
    const quest = panel.getByRole("button", { name: "Open quest #166" });
    const bounds = await quest.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= await page.evaluate(() => innerHeight), "first source action is visible at compact width");
    if (process.argv[2]) await page.screenshot({ path: process.argv[2], animations: "disabled" });
    await recap.getByRole("button", { name: "Open prep for The Deadmines" }).press("Enter");
    const fieldbook = page.locator('[data-atlas-card="dm"] [data-dungeon-fieldbook]');
    await fieldbook.getByText(/Reviewed Classic reference · mechanics not verified in Forever/).waitFor();
    await fieldbook.getByRole("region", { name: "Saved defeats here" }).getByText("Edwin VanCleef", { exact: true }).waitFor();
    assert.equal(await panel.getByText("On your wish list", { exact: true }).count(), 1);
    await dungeonAction.press("Enter");
    const dungeon = page.locator('[data-atlas-card="rfk"] [data-atlas-prep-heading]');
    await dungeon.waitFor();
    assert.equal(await dungeon.evaluate(el => document.activeElement === el), true);
    assert.equal(await quest.getAttribute("data-quest-open"), "166");
    await quest.press("Enter");
    await page.locator('[data-quest-control="detail:166"]').getByRole("heading", { name: "The Defias Brotherhood" }).waitFor();
    await atlas();
    await app.evaluate(() => { globalThis.holdChest = true; });
    if (await summary.evaluate(el => el.parentElement.open)) await summary.press("Enter");
    await summary.press("Enter");
    for (let i = 0; !await app.evaluate(() => !!globalThis.releaseChest); i++) {
      if (i >= 100) throw Error("Real IPC response was not held");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const picker = page.getByRole("combobox", { name: "Active character" });
    await picker.selectOption("alt");
    await page.waitForFunction(() => document.querySelector('#active-character')?.value === 'alt' && !document.querySelector('[data-chest-pilot]')?.open);
    await summary.press("Enter");
    await panel.getByText(/saved character and installed game builds must match/).waitFor();
    await app.evaluate(() => globalThis.releaseChest());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await panel.getByText(/saved character and installed game builds must match/).waitFor();
    assert.equal(await panel.locator("[data-chest-kind]").count(), 0);
    await recap.getByText(/No saved encounter defeats yet/).waitFor();
    assert.equal(await fs.readFile(path.join(dir, "wishlist.json"), "utf8"), wishlist);
    assert.deepEqual(errors, []);
    console.log(`Combined Atlas: four exact chest leads, Deadmines Fieldbook and recap, keyboard RFK and quest #166, compact ${await page.evaluate(() => `${innerWidth}×${innerHeight}`)}, retired response, wish list unchanged.`);
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
