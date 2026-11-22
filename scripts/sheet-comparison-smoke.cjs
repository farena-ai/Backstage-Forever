"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { _electron } = require("playwright");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { launch, testWindow } = require("./test-window.cjs");
const { navigate } = require("./player-navigation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "sheet-compare-"));
  let app;
  try {
    const build = "1.60.1.70888";
    const main = { id: "main", name: "Example", className: "Paladin", faction: "Alliance", realm: "Synthetic", level: 35, notes: "", goals: [], clientBuild: build,
      source: { kind: "wow-addon", id: "fixture-main", updatedAt: new Date(Date.now() - 60000).toISOString() },
      gearSets: { sets: [{ name: "Strength", savedAt: 1, items: [{ slot: 5, itemId: 2041 }] }, { name: "Healing", savedAt: 2, items: [{ slot: 5, itemId: 6682 }] }] } };
    const alt = { ...main, id: "alt", name: "Alt", clientBuild: "1.60.2.70862", gearSets: undefined, source: { ...main.source, id: "fixture-alt" } };
    const weaponSet = (name, mainId, offId) => ({ name, savedAt: 1, items: [{ slot: 16, itemId: mainId }, { slot: 17, itemId: offId }] });
    const rogue = { ...main, id: "rogue", name: "Rogue Fixture", className: "Rogue", source: { ...main.source, id: "fixture-rogue" },
      gearSets: { sets: [weaponSet("First pair", 101, 102), weaponSet("Second pair", 103, 104)] } };
    const warrior = { ...main, id: "warrior", name: "Warrior Fixture", className: "Warrior", source: { ...main.source, id: "fixture-warrior" },
      gearSets: { sets: [weaponSet("First pair", 101, 102), weaponSet("Second pair", 103, 105)] } };
    const stateFile = path.join(dir, "state.json"), wishFile = path.join(dir, "wishlist.json");
    const keyFile = path.join(dir, "credentials.json"), communityDir = path.join(dir, "community");
    const wish = JSON.stringify({ schemaVersion: 1, profiles: { main: [6682] } });
    await fs.writeFile(stateFile, JSON.stringify(validateState({ ...defaultState(), onboarded: true, profiles: [main, alt, rogue, warrior], activeProfileId: main.id })));
    await fs.writeFile(wishFile, wish);
    await fs.writeFile(keyFile, JSON.stringify({ openai: "synthetic-fixture" }));
    const bootstrap = await syntheticLaunch(dir), file = path.join(bootstrap, "main.cjs");
    const startup = await fs.readFile(file, "utf8");
    assert.equal(startup.split("load('./src/main.cjs');").length, 2);
    await fs.writeFile(file, startup.replace("load('./src/main.cjs');", `
      const GameData = load('./src/core/game-data.cjs').GameData;
      GameData.prototype.build = () => '${build}';
      GameData.prototype.items = ids => ids.map(id => [2041,6682].includes(id) ? ({ id, name: id === 2041 ? 'Tunic of Westfall' : 'Death Speaker Robes',
        classId: 4, subclassId: 1, inventoryType: id === 2041 ? 5 : 20, requiredLevel: 10, classes: null, armor: 0, quality: 2,
        stats: id === 2041 ? [{stat:'Strength', amount:10}] : [{stat:'Healing', amount:20}] }) : [101,102,103,104,105].includes(id) ? ({
        id, name: 'Weapon ' + id, classId: 2, subclassId: id === 105 ? 8 : 7, inventoryType: id === 105 ? 17 : 13,
        requiredLevel: 1, classes: null, quality: 2, stats: [], dps: id - 100 }) : null);
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      const ipc = electron.ipcMain, handle = ipc.handle.bind(ipc);
      const fs = require('node:fs'), path = require('node:path');
      const locked = path.join(process.env.BF_USER_DATA, 'local-craft.json');
      const unlink = fs.unlinkSync;
      globalThis.legacyUnlinkAttempts = 0;
      fs.unlinkSync = file => {
        if (globalThis.lockLegacyCraft && file === locked) {
          globalThis.legacyUnlinkAttempts++;
          throw Object.assign(new Error('Synthetic unlink denial'), { code: 'EPERM' });
        }
        return unlink(file);
      };
      const confirm = electron.dialog.showMessageBox.bind(electron.dialog);
      electron.dialog.showMessageBox = (window, options) => options?.title === 'Delete all local data?'
        ? Promise.resolve({ response: globalThis.confirmReset ? 1 : 0 }) : confirm(window, options);
      globalThis.craftConsentCalls = 0;
      ipc.handle = (name, fn) => handle(name, async (event, ...args) => {
        if (name === 'backstage:changeLocalCraft') globalThis.craftConsentCalls++;
        const value = await fn(event, ...args);
        if (name === 'backstage:sheetComparison' && args.length === 5 && globalThis.holdComparison) {
          globalThis.holdComparison = false;
          await new Promise(resolve => { globalThis.releaseComparison = resolve; });
          globalThis.comparisonReleased = true;
        }
        return value;
      });
      load('./src/main.cjs');`));
    app = await launch(_electron, { args: [bootstrap], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1000, 760); });
    await navigate(page, "sheet");
    const summary = page.getByText("Compare two options", { exact: true });
    const panel = page.locator("[data-sheet-pair]");
    const compare = panel.getByRole("button", { name: "Compare", exact: true });
    const role = panel.getByLabel("Role", { exact: true });
    const fill = async () => {
      await panel.getByLabel("Option A item ID", { exact: true }).fill("2041");
      await panel.getByLabel("Option B item ID", { exact: true }).fill("6682");
    };
    await summary.press("Enter");
    assert.equal(await role.inputValue(), "", "no role is selected for the player");
    await panel.locator('option[value="6682"]').waitFor({ state: "attached" });
    assert.equal(await panel.locator('option[value="6682"]').count(), 1);
    assert.match(await panel.locator('option[value="6682"]').getAttribute("label"), /Death Speaker Robes.*Wish list/);
    const stateBefore = await fs.readFile(stateFile, "utf8");
    await fill();
    await role.selectOption("leveling");
    await compare.press("Enter");
    await panel.getByText("Option A leads by 6 points.").waitFor();
    const resultHeading = panel.getByRole("heading", { name: "Comparison result", exact: true });
    assert.equal(await resultHeading.evaluate(el => {
      const r = el.getBoundingClientRect();
      return document.activeElement === el && r.top >= 0 && r.bottom <= innerHeight;
    }), true);
    await role.selectOption("healer");
    assert.equal(await panel.getByText("Option A leads by 6 points.").count(), 0);
    await compare.press("Enter");
    await panel.getByText("Option B leads by 10 points.").waitFor();
    await panel.getByRole("row", { name: "Healing 1 0 20 +20" }).waitFor();
    await panel.getByText(/Random affixes, enchants, procs/).waitFor();
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const bounds = await resultHeading.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= await page.evaluate(() => innerHeight));
    if (process.argv[2]) await page.screenshot({ path: process.argv[2], animations: "disabled" });
    await page.evaluate(() => render());
    assert.equal(await resultHeading.evaluate(el => document.activeElement === el), true);
    await panel.getByText("Option B leads by 10 points.").waitFor();
    await panel.getByLabel("Options", { exact: true }).selectOption("sets");
    await panel.getByLabel("Option A gear set", { exact: true }).selectOption("Strength");
    await panel.getByLabel("Option B gear set", { exact: true }).selectOption("Healing");
    await compare.press("Enter");
    await panel.getByText("Option B leads by 10 points.").waitFor();
    assert.equal(await fs.readFile(stateFile, "utf8"), stateBefore);
    assert.equal(await fs.readFile(wishFile, "utf8"), wish);
    await app.evaluate(() => { globalThis.holdComparison = true; });
    await compare.press("Enter");
    for (let i = 0; !await app.evaluate(() => !!globalThis.releaseComparison); i++) {
      if (i >= 100) throw Error("Real comparison IPC was not held");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await page.getByLabel("Active character", { exact: true }).selectOption("alt");
    await page.getByRole("heading", { name: "Alt", exact: true }).waitFor();
    await summary.press("Enter");
    await role.selectOption("leveling"); await fill(); await compare.press("Enter");
    await panel.getByText(/installed WoW Forever game on the same patch are required/).waitFor();
    await app.evaluate(() => globalThis.releaseComparison());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await panel.getByText("Option B leads by 10 points.").count(), 0);
    const compareHands = async (id, name, verdict) => {
      await page.getByLabel("Active character", { exact: true }).selectOption(id);
      await page.getByRole("heading", { name, exact: true }).waitFor();
      await page.waitForFunction(id => !characterSelectionPending() && state.activeProfileId === id, id);
      const bytes = await fs.readFile(stateFile);
      await summary.press("Enter");
      await role.selectOption("leveling");
      await panel.getByLabel("Options", { exact: true }).selectOption("sets");
      await panel.getByLabel("Option A gear set", { exact: true }).selectOption("First pair");
      await panel.getByLabel("Option B gear set", { exact: true }).selectOption("Second pair");
      await compare.press("Enter");
      await panel.getByText(verdict, { exact: true }).waitFor();
      assert.deepEqual(await fs.readFile(stateFile), bytes);
    };
    // The sidecar is retired; assert on its historical filename, not an active writer API.
    const craftFile = path.join(dir, "local-craft.json");
    await assert.rejects(fs.access(craftFile), { code: "ENOENT" });
    await compareHands("rogue", "Rogue Fixture", "Option B leads by 24 points.");
    await panel.getByRole("row", { name: "Melee DPS 6 3 7 +24" }).waitFor();
    await panel.getByText("Weapon 102 (#102) · Off hand", { exact: true }).waitFor();
    await compareHands("warrior", "Warrior Fixture", "No ranked result.");
    await panel.getByText("#105: Not scoreable equipment for this slot.", { exact: true }).waitFor();
    assert.equal(await panel.getByText("Score unavailable", { exact: true }).count(), 1);
    assert.equal(await app.evaluate(() => globalThis.craftConsentCalls), 0);
    await assert.rejects(fs.access(craftFile), { code: "ENOENT" });
    assert.equal(await fs.readFile(wishFile, "utf8"), wish);
    const obsolete = Buffer.from("synthetic retired craft data");
    await fs.writeFile(craftFile, obsolete);
    await fs.mkdir(communityDir, { recursive: true });
    const communityFixture = path.join(communityDir, "owned-fixture.json");
    await fs.writeFile(communityFixture, "{}");
    const beforeReset = await fs.readFile(stateFile), keysBeforeReset = await fs.readFile(keyFile);
    await app.evaluate(() => { globalThis.lockLegacyCraft = true; });
    assert.equal(await page.evaluate(() => window.backstage.resetData()), null);
    assert.deepEqual(await fs.readFile(stateFile), beforeReset);
    assert.deepEqual(await fs.readFile(craftFile), obsolete);
    assert.equal(await app.evaluate(() => globalThis.legacyUnlinkAttempts), 0);
    assert.deepEqual(await fs.readFile(keyFile), keysBeforeReset);
    assert.equal(await fs.readFile(wishFile, "utf8"), wish);
    assert.equal(await fs.readFile(communityFixture, "utf8"), "{}");
    await app.evaluate(() => { globalThis.confirmReset = true; });
    const fresh = await page.evaluate(() => window.backstage.resetData());
    assert.deepEqual(fresh.profiles, []);
    assert.deepEqual(JSON.parse(await fs.readFile(stateFile, "utf8")).profiles, []);
    assert.deepEqual(JSON.parse(await fs.readFile(keyFile, "utf8")), {});
    await assert.rejects(fs.access(wishFile), { code: "ENOENT" });
    await assert.rejects(fs.access(communityFixture), { code: "ENOENT" });
    assert.equal(await app.evaluate(() => globalThis.legacyUnlinkAttempts), 1);
    assert.deepEqual(await fs.readFile(craftFile), obsolete);
    await app.evaluate(() => { globalThis.lockLegacyCraft = false; });
    assert.deepEqual((await page.evaluate(() => window.backstage.resetData())).profiles, []);
    await assert.rejects(fs.access(craftFile), { code: "ENOENT" });
    assert.deepEqual(errors, []);
    console.log("Sheet comparison and reset smoke passed: saved hand compatibility without craft consent, read-only bytes, compact viewport, stale reply, and confirmed reset/retry with retired craft cleanup blocked.");
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
