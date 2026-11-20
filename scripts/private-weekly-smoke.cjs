"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const scratch = path.join(process.env.LOCALAPPDATA, "hermes", "cache", "scratch");
  const dir = await fs.mkdtemp(path.join(scratch, "private-weekly-"));
  const profile = { className: "Rogue", faction: "Alliance", realm: "Synthetic", level: 20, notes: "", goals: [] };
  const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: "main", profiles: [{ ...profile, id: "main", name: "Example" }, { ...profile, id: "main-alt", name: "Alt" }] });
  const now = Date.now();
  const at = now - 3600000;
  const session = { id: "observed", profileId: "main", startedAt: at, endedAt: at + 600000, minutes: 10, deaths: 1 };
  const journalFile = path.join(dir, "state.json"), sessionsFile = path.join(dir, "sessions.json"), backup = path.join(dir, "backup.json");
  await fs.writeFile(journalFile, JSON.stringify(state));
  await fs.writeFile(sessionsFile, JSON.stringify({ version: 1, sessions: [session] }));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "private-weekly-fixture", main: "main.cjs" }));
  await fs.writeFile(path.join(dir, "main.cjs"), `
    const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
    const { app, clipboard, dialog, ipcMain, session } = require('electron');
    app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, done) => done({ cancel: true })));
    globalThis.trace = { writes: 0, asks: 0, copies: 0, share: 0 };
    clipboard.writeText = () => trace.copies++;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(backup)} });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(backup)}] });
    dialog.showMessageBox = async () => ({ response: globalThis.confirmDestructive ? 1 : 0 });
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, fn) => handle(channel, async (event, ...args) => {
      if (channel === 'backstage:addPrivateWeekly') {
        trace.writes++;
        if (globalThis.holdWrite) {
          globalThis.holdWrite = false;
          await new Promise(resolve => { globalThis.releaseWrite = resolve; });
        }
      }
      if (channel === 'backstage:askCompanion') trace.asks++;
      if (channel === 'backstage:saveSharePicture') trace.share++;
      if (channel === 'backstage:saveState' && globalThis.holdPicker) {
        globalThis.holdPicker = false;
        await new Promise(resolve => { globalThis.releasePicker = resolve; });
      }
      return fn(event, ...args);
    });
    // Compare public recap and reminders at the same instant, without freezing Electron's clock.
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
  let app;
  const start = () => launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
  const open = async page => {
    await page.locator('[data-nav="characters"]').first().click();
    await page.locator('[data-shell-control="subtab:journey"]').click();
    const panel = page.locator("[data-private-weekly]");
    await panel.waitFor({ timeout: 10000 });
    return panel;
  };
  try {
    app = await start();
    const page = await testWindow(app), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
    const journalBytes = await fs.readFile(journalFile), sessionBytes = await fs.readFile(sessionsFile);
    const panel = await open(page);
    const before = await page.evaluate(() => window.backstage.weekly());
    const picker = page.getByRole("combobox", { name: "Active character" });
    const form = panel.locator('[data-private-weekly-form="accomplishment"]');
    const note = "Private <img src=x> accomplishment";
    const date = await page.evaluate(() => {
      const d = new Date(Date.now() - 300000);
      return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    });
    await form.getByLabel("Accomplishment date and time", { exact: true }).fill(date);
    await form.getByLabel("Accomplishment", { exact: true }).fill(note);
    await page.keyboard.press("Tab");
    const submitFocus = await page.evaluate(() => {
      const el = document.activeElement;
      const css = getComputedStyle(el);
      return [el.id, el.matches(":focus-visible"), css.outlineColor];
    });
    assert.deepEqual(submitFocus, ["private-weekly-accomplishment-submit", true, "rgb(61, 34, 12)"]);
    await page.keyboard.press("Enter");
    await panel.getByText(note, { exact: true }).waitFor();
    assert.equal(await panel.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), "private-weekly-accomplishment-added");
    const correction = panel.locator('[data-private-weekly-form="correction"]');
    await correction.getByLabel("Observed session", { exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await correction.getByLabel("Correction", { exact: true }).fill("Private correction");
    await correction.getByRole("button", { name: "Add private correction" }).press("Enter");
    await panel.getByText("Private correction", { exact: true }).waitFor();
    assert.deepEqual(await panel.locator("li strong").allTextContents(), ["Manual accomplishment", "Observed session", "Manual correction"]);
    assert.deepEqual(await panel.locator("li time").evaluateAll(times => times.slice(1).map(t => t.dateTime)), [new Date(at).toISOString(), new Date(at).toISOString()]);
    assert.match(await panel.getByText(/10m played/).textContent(), /1 death/);
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.deepEqual(await page.evaluate(() => window.backstage.weekly()), before);
    assert.deepEqual(await fs.readFile(journalFile), journalBytes);
    assert.deepEqual(await fs.readFile(sessionsFile), sessionBytes);
    await page.evaluate(() => window.backstage.exportData());
    assert.doesNotMatch(await fs.readFile(backup, "utf8"), /Private (correction|<img)/);
    assert.deepEqual(await app.evaluate(() => trace), { writes: 2, asks: 0, copies: 0, share: 0 });
    assert.equal(await page.evaluate(() => window.backstage.resetData()), null);
    await panel.getByText(note, { exact: true }).waitFor();
    const retired = await page.evaluate(() => window.backstage.privateWeekly());
    await app.evaluate(() => { globalThis.holdPicker = globalThis.holdWrite = true; });
    const stale = page.evaluate(input => window.backstage.addPrivateWeekly(input), { token: retired.token, kind: "accomplishment", at, text: "Wrong owner" });
    await app.evaluate(() => new Promise(resolve => {
      const interval = setInterval(() => { if (globalThis.releaseWrite) { clearInterval(interval); clearTimeout(deadline); resolve(true); } }, 10);
      const deadline = setTimeout(() => { clearInterval(interval); resolve(false); }, 5000);
    })).then(reached => assert.equal(reached, true, "the old write reached the held IPC"));
    await picker.selectOption("main-alt");
    await panel.getByText(note, { exact: true }).waitFor({ state: "detached" });
    await app.evaluate(() => globalThis.releasePicker());
    await panel.getByText("No dated sessions or manual entries for this character this week.").waitFor();
    await app.evaluate(() => globalThis.releaseWrite());
    assert.equal(await stale, null);
    await picker.selectOption("main");
    await panel.getByText(note, { exact: true }).waitFor();
    await page.reload();
    await open(page);
    await panel.getByText(note, { exact: true }).waitFor();
    if (process.env.BF_WEEKLY_CAPTURE) {
      await panel.getByRole("heading").evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: process.env.BF_WEEKLY_CAPTURE });
    }
    await app.evaluate(() => { globalThis.confirmDestructive = true; });
    assert.equal((await page.evaluate(() => window.backstage.importData())).activeProfileId, "main");
    const imported = await page.evaluate(() => window.backstage.privateWeekly());
    assert.notEqual(imported.token, retired.token);
    assert.deepEqual(imported.rows.map(row => row.source), ["observed"]);
    assert.ok(await page.evaluate(input => window.backstage.addPrivateWeekly(input), { token: imported.token, kind: "accomplishment", at, text: note }));
    assert.deepEqual(errors, []);
    await app.close();
    app = await start();
    const reopened = await testWindow(app), clean = await open(reopened);
    assert.equal(await clean.getByText(note, { exact: true }).count(), 0);
    await clean.getByText("Observed session", { exact: true }).first().waitFor();
    const current = await reopened.evaluate(() => window.backstage.privateWeekly());
    assert.ok(await reopened.evaluate(input => window.backstage.addPrivateWeekly(input), { token: current.token, kind: "accomplishment", at, text: "Reset marker" }));
    await app.evaluate(() => { globalThis.confirmDestructive = true; });
    assert.deepEqual((await reopened.evaluate(() => window.backstage.resetData())).profiles, []);
    assert.equal(await reopened.evaluate(() => window.backstage.privateWeekly()), null);
    assert.equal(await reopened.evaluate(input => window.backstage.addPrivateWeekly(input), { token: current.token, kind: "correction", at, sessionId: session.id, text: "Late correction" }), null);
    console.log("Private weekly Electron smoke passed: keyboard, timeline, no sharing, picker, reload, same-ID import, restart and reset.");
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
