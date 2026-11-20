"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const scratch = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes", "cache", "scratch") : os.tmpdir();
  await fs.mkdir(scratch, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratch, "private-after-action-"));
  let app;
  try {
    const now = Date.now(), at = Math.floor(now / 1000) - 900;
    const common = { className: "Rogue", faction: "Alliance", realm: "Synthetic", level: 20, notes: "", goals: [] };
    const defeat = { name: "Edwin VanCleef", encounterId: 1144, instanceMap: 36, instanceType: "party", difficultyId: 1, at };
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: "main", profiles: [
      { ...common, id: "main", name: "Example", source: { kind: "wow-addon", id: "Player-A", updatedAt: new Date(now).toISOString() }, clientBuild: "1.60.1.70862", journal: { encounters: [defeat] } },
      { ...common, id: "main-alt", name: "Alt" },
    ] });
    const observed = { id: "play", profileId: "main", savedSourceId: "Player-A", startedAt: now - 1800000, endedAt: now - 1200000, minutes: 10, deaths: 1 };
    const journal = path.join(dir, "state.json"), sessions = path.join(dir, "sessions.json"), backup = path.join(dir, "backup.json");
    await fs.writeFile(journal, JSON.stringify(state));
    await fs.writeFile(sessions, JSON.stringify({ version: 1, sessions: [observed] }));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "after-action-fixture", main: "main.cjs" }));
    await fs.writeFile(path.join(dir, "main.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
      const { app, clipboard, dialog, ipcMain, session } = require('electron');
      app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, done) => done({ cancel: true })));
      globalThis.trace = { writes: 0, asks: 0, copies: 0, shares: 0 };
      clipboard.writeText = () => trace.copies++;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(backup)} });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(backup)}] });
      dialog.showMessageBox = async () => ({ response: globalThis.confirmDestructive ? 1 : 0 });
      const register = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => register(channel, async (event, ...args) => {
        if (channel === 'backstage:askCompanion') trace.asks++;
        if (channel === 'backstage:saveSharePicture') trace.shares++;
        if (channel === 'backstage:savePrivateAfterAction') trace.writes++;
        if (channel === 'backstage:saveState' && globalThis.holdPicker) {
          globalThis.holdPicker = false;
          await new Promise(resolve => { globalThis.releasePicker = resolve; });
        }
        if (channel === 'backstage:savePrivateAfterAction' && globalThis.holdWrite) {
          globalThis.holdWrite = false;
          await new Promise(resolve => { globalThis.releaseWrite = resolve; });
        }
        return fn(event, ...args);
      });
      const weekly = load('./src/core/weekly.cjs');
      for (const key of ['weeklyRecap', 'reminders']) {
        const model = weekly[key];
        weekly[key] = (state, options) => model(state, { ...options, now: ${Math.floor(now / 1000)} });
      }
      load('./src/core/model-catalog.cjs').listModels = async () => ({ models: [], source: 'fixture' });
      load('./src/core/claude.cjs').status = async () => ({ available: false, connected: false });
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({ state: 'not-running', launchAvailable: false });
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({ available: false, recognizers: [], voices: [] });
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      load('./src/main.cjs');
    `);
    const start = () => launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const reveal = async page => {
      const panel = page.locator("[data-private-after-action]");
      const summary = panel.locator("summary");
      await summary.press("Enter", { timeout: 7000 });
      assert.equal(await panel.evaluate(el => el.open), true);
      return panel;
    };
    const open = async page => {
      await page.locator('[data-nav="characters"]').first().click();
      await page.locator('[data-shell-control="subtab:journey"]').click();
      return reveal(page);
    };
    app = await start();
    const page = await testWindow(app), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(1000, 720); });
    const before = await Promise.all([fs.readFile(journal), fs.readFile(sessions), page.evaluate(() => window.backstage.weekly())]);
    const panel = await open(page);
    assert.deepEqual(await panel.locator("summary, label").evaluateAll(nodes => nodes.map(el => getComputedStyle(el).color)),
      ["rgb(61, 34, 12)", "rgb(61, 34, 12)", "rgb(61, 34, 12)"]);
    const dates = await panel.locator("ol time").evaluateAll(times => times.map(t => t.dateTime));
    assert.deepEqual(dates, [new Date(at * 1000).toISOString(), new Date(observed.startedAt).toISOString()]);
    assert.match(await panel.locator("ol li").first().textContent(), /Addon save.*Edwin VanCleef/s);
    assert.match(await panel.locator("ol li").last().textContent(), /Live link.*session started.*1 recorded death/s);
    const note = "PRIVATE_DEBRIEF_<img src=x>", improvement = "PRIVATE_NEXT_Ask before pulling";
    await panel.getByLabel("Private note (optional)", { exact: true }).fill(note);
    await panel.getByLabel("Next improvement", { exact: true }).fill(improvement);
    const button = panel.getByRole("button", { name: "Save private review", exact: true });
    await page.keyboard.press("Tab");
    assert.equal(await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el === document.activeElement && el.matches(":focus-visible") && r.left >= 5 && r.right <= innerWidth - 5 && r.top >= 5 && r.bottom <= innerHeight - 5 && getComputedStyle(el).outlineColor === "rgb(61, 34, 12)";
    }), true);
    await page.keyboard.press("Enter");
    await panel.getByText("Private review saved.", { exact: true }).waitFor();
    if (process.env.BF_AFTER_ACTION_CAPTURE) {
      await panel.locator("summary").evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: process.env.BF_AFTER_ACTION_CAPTURE });
    }
    assert.equal(await panel.locator("img").count(), 0);
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.deepEqual(await Promise.all([fs.readFile(journal), fs.readFile(sessions), page.evaluate(() => window.backstage.weekly())]), before);
    await page.evaluate(() => window.backstage.exportData());
    assert.doesNotMatch(await fs.readFile(backup, "utf8"), /PRIVATE_(DEBRIEF|NEXT)/);
    assert.deepEqual(await app.evaluate(() => trace), { writes: 1, asks: 0, copies: 0, shares: 0 });

    const token = (await page.evaluate(() => window.backstage.privateAfterAction())).token;
    const picker = page.getByRole("combobox", { name: "Active character" });
    await app.evaluate(() => { globalThis.holdPicker = globalThis.holdWrite = true; });
    const stale = page.evaluate(input => window.backstage.savePrivateAfterAction(input), { token, note: "", improvement: "Wrong owner" });
    const waitHeld = name => app.evaluate((_, name) => new Promise(resolve => {
      const interval = setInterval(() => { if (globalThis[name]) { clearInterval(interval); clearTimeout(deadline); resolve(true); } }, 10);
      const deadline = setTimeout(() => { clearInterval(interval); resolve(false); }, 5000);
    }), name);
    assert.equal(await waitHeld("releaseWrite"), true);
    await picker.selectOption("main-alt");
    assert.equal(await waitHeld("releasePicker"), true);
    await panel.waitFor({ state: "detached" });
    await app.evaluate(() => globalThis.releasePicker());
    await reveal(page);
    await panel.getByText("No eligible observations in this window.", { exact: true }).waitFor();
    await app.evaluate(() => globalThis.releaseWrite());
    assert.equal(await stale, null);
    assert.equal(await panel.getByLabel("Next improvement", { exact: true }).inputValue(), "");
    await picker.selectOption("main");
    await reveal(page);
    assert.equal(await panel.getByLabel("Next improvement", { exact: true }).inputValue(), improvement);
    await page.reload();
    await open(page);
    assert.equal(await panel.getByLabel("Private note (optional)", { exact: true }).inputValue(), note);
    await panel.getByRole("button", { name: "Clear private review", exact: true }).press("Enter");
    await panel.getByText("Private review cleared.", { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("Next improvement", { exact: true }).inputValue(), "");
    assert.equal((await page.evaluate(() => window.backstage.privateAfterAction())).review, null);
    const beforeImport = await page.evaluate(async input => {
      const { token } = await window.backstage.privateAfterAction();
      return window.backstage.savePrivateAfterAction({ token, ...input });
    }, { note, improvement });
    assert.equal(beforeImport.review.improvement, improvement);
    await app.evaluate(() => { globalThis.confirmDestructive = true; });
    assert.equal((await page.evaluate(() => window.backstage.importData())).activeProfileId, "main");
    const imported = await page.evaluate(() => window.backstage.privateAfterAction());
    assert.equal(imported.review, null);
    assert.notEqual(imported.token, beforeImport.token);
    assert.equal(await page.evaluate(input => window.backstage.savePrivateAfterAction(input), { token: beforeImport.token, note, improvement }), null);
    assert.ok(await page.evaluate(input => window.backstage.savePrivateAfterAction(input), { token: imported.token, note, improvement }));
    assert.deepEqual(errors, []);
    await app.close();
    app = await start();
    const reopened = await testWindow(app);
    const clean = await open(reopened);
    assert.equal(await clean.getByLabel("Next improvement", { exact: true }).inputValue(), "");
    await clean.getByText(/Edwin VanCleef/).waitFor();
    const changed = JSON.parse(await fs.readFile(backup, "utf8"));
    changed.profiles.find(p => p.id === "main").source.id = "Player-Z";
    await fs.writeFile(backup, JSON.stringify(changed));
    await app.evaluate(() => { globalThis.confirmDestructive = true; });
    const replaced = await reopened.evaluate(() => window.backstage.importData());
    assert.equal(replaced.profiles.find(p => p.id === "main").source.id, "Player-Z");
    assert.equal((await reopened.evaluate(() => window.backstage.privateAfterAction())).rows.some(r => r.kind === "session"), false);
    await app.close();
    app = await start();
    const differentSource = await testWindow(app);
    assert.equal((await differentSource.evaluate(() => window.backstage.privateAfterAction())).rows.some(r => r.kind === "session"), false);
    console.log("Private after-action Electron smoke passed: attribution, compact keyboard, local review, privacy, stale writes, replacement and restart.");
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
