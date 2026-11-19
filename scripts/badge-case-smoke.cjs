"use strict";
// Run with node scripts/badge-case-smoke.cjs [capture-directory].
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "forever-badge-case-"));
  const capture = process.argv[2];
  let app;
  try {
    const profiles = [
      { id: "alpha", name: "Aelora", className: "Hunter", race: "Tauren", faction: "Horde", level: 19, journal: {
        firsts: [{ key: "flight", at: 1700002000 }],
        encounters: [{ encounterId: 1144, name: "Edwin VanCleef", instanceMap: 36, instanceType: "party", difficultyId: 1, at: 1700002001 }],
      },
        source: { kind: "wow-addon", id: "synthetic-alpha", updatedAt: "2026-11-09T12:00:00.000Z" },
        clientBuild: "1.60.1.70888",
        ledger: { reputations: { seenAt: 1794225600, scanId: 1, factions: [{ id: 76, name: "Orgrimmar", standing: 7,
          min: 21000, max: 42000, value: 21000, observedAt: 1794225600, observedBuild: "1.60.1.70888", scanId: 1 }] } },
        history: { recent: [], completedIdsKnown: true, completedIds: [440, 441, 530, 887, 890] },
        readiness: { workshop: { professions: { observedAt: "2026-11-09T12:00:00.000Z", complete: false, items: [{ skillLineId: 171, professionId: 1171, name: "Alchemy", rank: 150, maxRank: 300 }] } } } },
      { id: "beta", name: "Bellan", className: "Priest", race: "Human", faction: "Alliance", level: 7 },
    ].map((p) => ({ realm: "Synthetic", notes: "", goals: [], ...p }));
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(validateState({ ...defaultState(), onboarded: true, activeProfileId: "alpha", profiles })));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "badge-case-fixture", version: require("../package.json").version, main: "main.cjs" }));
    await fs.writeFile(path.join(dir, "main.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, "../package.json"))});
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/claude.cjs').status = async () => ({available:false, connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({state:'not-running', launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({available:false, recognizers:[], voices:[]});
      const L = load('./src/core/live-bridge.cjs').LiveBridge;
      L.prototype.readPreference = () => false; L.prototype.start = () => {};
      const Store = load('./src/core/store.cjs').Store, start = Store.prototype.startRecovery;
      Store.prototype.startRecovery = function () { globalThis.badgeFixtureStore = this; return start.call(this); };
      const { dialog } = require('electron');
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(path.join(dir, "badge-case-export.png"))} });
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    app.process().stderr?.on("data", (chunk) => process.stderr.write(chunk));
    const page = await testWindow(app), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const channel = "backstage:badgeArt", original = ipcMain._invokeHandlers.get(channel);
      globalThis.exportArtKeys = [];
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, keys) => { globalThis.exportArtKeys.push(...keys); return original(event, keys); });
    });
    page.setDefaultTimeout(10000);
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    const resize = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [w, h]);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      console.log(`native ${w}×${h}, viewport ${await page.evaluate(() => `${innerWidth}×${innerHeight}`)}`);
    };
    const screenshot = async (name) => {
      if (!capture) return;
      await fs.mkdir(capture, { recursive: true });
      await page.screenshot({ path: path.join(capture, `${name}.png`), animations: "disabled" });
    };
    await resize(1480, 980);
    await page.locator("[data-now-body] .now-next").waitFor();
    const shortcut = page.locator("[data-now]").getByRole("button", { name: "Open Badge Case" });
    await shortcut.waitFor({ timeout: 3000 });
    const box = await shortcut.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= await page.evaluate(() => innerHeight), "Now shortcut starts in the viewport");
    await screenshot("badge-case-now");
    await shortcut.press("Enter");
    const badges = page.locator("[data-badges]"), flight = badges.locator('[data-badge="first-flight"]');
    await badges.getByRole("heading", { name: "Aelora's Badge Case" }).waitFor();
    await flight.waitFor();
    await screenshot("badge-case-desktop");
    const professionArt = badges.locator('[data-badge="profession-alchemy-150"] img');
    assert.match(await professionArt.getAttribute("src"), /\/profession-150\.png$/);
    assert.equal(await professionArt.evaluate(async (img) => { await img.decode(); return img.naturalWidth > 0; }), true);

    const search = badges.getByRole("searchbox", { name: "Search character badges" });
    await search.fill("take your first flight");
    assert.equal(await badges.locator("[data-badge]:not([data-badge^='account-'])").count(), 1);
    assert.equal(await search.evaluate((el) => el === document.activeElement), true);
    await badges.getByRole("heading", { name: "Account badges", exact: true }).waitFor();
    await search.fill("no badge matches this");
    await badges.getByText("No character badges match these filters.").waitFor();
    await badges.getByRole("button", { name: "Clear filters" }).press("Enter");
    assert.equal(await search.evaluate((el) => el === document.activeElement && el.value === ""), true);
    const category = badges.getByLabel("Category", { exact: true });
    await category.selectOption("Levels");
    await badges.locator('[data-badge="level-20"]').waitFor();
    assert.equal(await flight.count(), 0);
    await badges.getByRole("button", { name: "Earned", exact: true }).press("Enter");
    assert.equal(await badges.locator("[data-badge-results] [data-badge]").count(), 1);
    await badges.locator('[data-badge-jump="first-flight"]').press("Enter");
    await page.waitForFunction(() => document.activeElement?.dataset.badge === "first-flight");
    assert.equal(await category.inputValue(), "");
    await category.selectOption("Dungeons");
    const victory = badges.locator('[data-badge="dungeon-first-victory"]');
    await victory.getByText("Desktop only", { exact: true }).waitFor();
    await victory.getByText("Earned", { exact: true }).waitFor();
    const progress = badges.getByRole("progressbar", { name: "Progress toward Dungeon veteran" });
    assert.equal(await progress.getAttribute("aria-valuenow"), "1");
    assert.equal(await progress.getAttribute("aria-valuemax"), "5");
    await badges.getByRole("button", { name: /Bellan/ }).press("Enter");
    await badges.getByRole("heading", { name: "Bellan's Badge Case" }).waitFor();
    await victory.getByText("No saved progress", { exact: true }).waitFor();
    assert.equal(await progress.count(), 0);
    assert.equal(await badges.getByRole("button", { name: /Bellan/ }).getAttribute("aria-pressed"), "true");
    await category.selectOption("Quest chains");
    const revenge = badges.locator('[data-badge="quest-chain-husbands-revenge"]');
    await revenge.getByText("No saved progress", { exact: true }).waitFor();
    await badges.getByRole("button", { name: /Aelora/ }).press("Enter");
    await revenge.getByText("Earned", { exact: true }).waitFor();
    await revenge.getByText("Desktop only", { exact: true }).waitFor();
    const shipment = badges.getByRole("progressbar", { name: "Progress toward The Missing Shipment" });
    assert.equal(await shipment.getAttribute("aria-valuenow"), "2");
    assert.equal(await shipment.getAttribute("aria-valuemax"), "4");
    const shipmentTile = badges.locator('[data-badge="quest-chain-missing-shipment"]');
    const rows = shipmentTile.locator('ol li');
    await rows.first().waitFor();
    assert.deepEqual(await rows.allTextContents(), [
      'Southsea Freebooters — Confirmed in save',
      'The Missing Shipment — Confirmed in save',
      'The Missing Shipment — Not confirmed in save',
      'Stolen Booty — Not confirmed in save',
    ]);
    assert.equal(await revenge.locator('ol').count(), 0);
    await shipmentTile.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await screenshot('badge-case-quest-steps-desktop');
    await badges.getByRole("button", { name: /Bellan/ }).press("Enter");
    await revenge.getByText("No saved progress", { exact: true }).waitFor();
    assert.equal(await rows.count(), 0);
    await category.selectOption("Reputation");
    const medal = badges.locator('[data-badge="rep-orgrimmar-revered"]');
    await medal.getByText("No saved progress", { exact: true }).waitFor();
    await badges.getByRole("button", { name: /Aelora/ }).press("Enter");
    await medal.getByText("Earned", { exact: true }).waitFor();
    await medal.getByText("Desktop only", { exact: true }).waitFor();
    assert.match(await medal.locator("img").getAttribute("src"), /\/rep-revered\.png$/);
    const exalted = badges.getByRole("progressbar", { name: "Progress toward Orgrimmar · Exalted" });
    assert.equal(await exalted.getAttribute("aria-valuenow"), "7");
    assert.equal(await exalted.getAttribute("aria-valuemax"), "8");
    await badges.getByRole("button", { name: /Bellan/ }).press("Enter");
    await medal.getByText("No saved progress", { exact: true }).waitFor();
    await resize(940, 760);
    await badges.getByRole("heading", { name: "Bellan's Badge Case" }).scrollIntoViewIfNeeded();
    assert.ok(await badges.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "Badge Case fits compact content width");
    await screenshot("badge-case-compact");
    await badges.getByRole("heading", { name: "Bellan's badges", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await screenshot("badge-case-compact-collection");
    await page.locator('[data-nav="now"]').first().click();
    await shortcut.click();
    await badges.getByRole("heading", { name: "Aelora's Badge Case" }).waitFor();
    await badges.getByRole("button", { name: "Save a picture" }).press("Enter");
    await page.getByText("Picture saved.", { exact: true }).waitFor();
    assert.equal((await fs.readFile(path.join(dir, "badge-case-export.png"))).subarray(1, 4).toString(), "PNG");
    const keys = await app.evaluate(() => globalThis.exportArtKeys);
    assert.equal(keys.filter((id) => id === "profession-150").length, 1, "earned profession badges share one artwork request");
    assert.ok(!keys.includes("profession-alchemy-150"), "export does not request a missing ID image");
    assert.ok(keys.includes("first-dungeon"), "dungeon victories reuse the original dungeon artwork in the picture");
    assert.ok(keys.includes("quests-100"), "quest chains reuse the original quest artwork in the picture");
    assert.equal(keys.filter((id) => id === "rep-revered").length, 1, "generic and faction badges share reputation artwork in the picture");
    assert.ok(!keys.includes("rep-orgrimmar-revered"), "medals do not request nonexistent per-faction artwork");
    await badges.locator('[data-badge="level-20"]:not(.earned)').waitFor();
    await app.evaluate(() => { const store = globalThis.badgeFixtureStore; const state = structuredClone(store.state); state.profiles[0].level = 20; store.saveState(state); });
    await badges.locator('[data-badge="level-20"].earned').waitFor();
    const picker = page.locator('#active-character');
    const toJourney = async () => {
      await page.locator('[data-nav="characters"]').first().press("Enter");
      await page.locator('[data-nav="journey"]').first().press("Enter");
    };
    await resize(1480, 980);
    await toJourney();
    const defeats = page.locator('[data-journey-defeats]');
    const boss = defeats.getByText('Edwin VanCleef', { exact: true });
    await boss.waitFor();
    assert.equal(await defeats.locator('li time').getAttribute('datetime'), new Date(1700002001 * 1000).toISOString());
    assert.match(await defeats.innerText(), /1 distinct boss encounter in retained history/);
    await page.locator('.bf-badge-pop').waitFor({ state: 'hidden' });
    await screenshot('journey-defeats-desktop');
    await page.evaluate(() => I18n.choose('de'));
    await page.locator('html[lang="de"]').waitFor({ state: 'attached' });
    await resize(1000, 700);
    await page.locator('[data-nav="characters"]').first().press("Enter");
    await page.locator('[data-nav="badges"]').first().press("Enter");
    await badges.locator('[data-badge-category]').selectOption('Quest chains');
    await shipmentTile.getByRole('list', { name: 'Questschritte in diesem Spielstand' }).waitFor();
    await rows.nth(2).getByText('Im Spielstand nicht bestätigt', { exact: true }).waitFor();
    await shipmentTile.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    assert.ok(await shipmentTile.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const stepBox = await shipmentTile.boundingBox();
    assert.ok(stepBox.y >= 0 && stepBox.y + stepBox.height <= await page.evaluate(() => innerHeight));
    await screenshot('badge-case-quest-steps-compact-de');
    await toJourney();
    await defeats.getByRole('heading', { name: 'Persönliche Bosssiege in Dungeons' }).waitFor();
    await boss.waitFor();
    assert.ok(await defeats.evaluate(el => el.closest('[data-journey]').scrollWidth <= el.closest('[data-journey]').clientWidth + 1));
    await screenshot('journey-defeats-compact-de-top');
    await defeats.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const compact = await defeats.boundingBox();
    assert.ok(compact.y >= 0 && compact.y + compact.height <= await page.evaluate(() => innerHeight));
    await screenshot('journey-defeats-compact-de');

    // Arm after leaving Now, which also uses the Journey IPC.
    await page.reload();
    await page.locator('[data-nav="characters"]').first().press("Enter");
    // Hold the real completed Alpha result, not the invocation (which could read Beta).
    await app.evaluate(({ ipcMain }) => {
      const channel = 'backstage:journey', original = ipcMain._invokeHandlers.get(channel);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        const result = await original(...args);
        if (result?.id === 'alpha' && !globalThis.journeyHeld) {
          globalThis.journeyHeld = true;
          await new Promise(resolve => { globalThis.releaseJourney = resolve; });
        }
        return result;
      });
    });
    await page.locator('[data-nav="journey"]').first().press("Enter");
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && !globalThis.releaseJourney; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!globalThis.releaseJourney) throw Error('Alpha Journey IPC did not reach the hold');
    });
    await picker.selectOption('beta');
    await defeats.getByText('Keine persönlichen Bosssiege in Dungeons gespeichert.', { exact: true }).waitFor();
    await app.evaluate(() => globalThis.releaseJourney());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await boss.count(), 0);
    assert.equal(await defeats.locator('li,time').count(), 0, 'missing evidence has no count, rows or dates');
    assert.equal(await page.evaluate(() => JourneyView._state().data.id), 'beta');
    assert.deepEqual(errors, []);
    console.log("Badge Case smoke passed");
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
