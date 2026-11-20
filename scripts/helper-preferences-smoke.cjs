"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  assert.ok(process.env.BF_TEST_TMP, "Use a dedicated scratch parent via BF_TEST_TMP");
  const dir = await fs.mkdtemp(path.join(await fs.realpath(process.env.BF_TEST_TMP), "bf-helper-smoke-"));
  const journal = path.join(dir, "state.json");
  let app;
  try {
    const character = name => ({ id: name, name, realm: "Synthetic", className: "Hunter", level: 15, goals: [], notes: "" });
    await fs.writeFile(journal, JSON.stringify(validateState({ ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [character("Alpha"), character("Beta")] })));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-helper-smoke", version: "1.0.0", main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs').LiveBridge;
      L.prototype.readPreference=()=>false; L.prototype.start=()=>{};
      globalThis.clipboardWrites=[];
      const {clipboard,ipcMain}=require('electron');
      clipboard.writeText=(value)=>globalThis.clipboardWrites.push(value);
      const handle=ipcMain.handle.bind(ipcMain);
      ipcMain.handle=(channel,fn)=>handle(channel,channel==='backstage:saveState' ? async (event,...args)=>{
        if(globalThis.holdBeta && args[0]?.activeProfileId==='Beta') {
          await new Promise(resolve=>{globalThis.releaseBeta=resolve});
        }
        return fn(event,...args);
      } : fn);
      load('./src/main.cjs');
    `);
    app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => {
      localStorage.setItem("bf-setup-v4", "complete");
      localStorage.setItem("bf-share-character", "false");
      localStorage.setItem("bf-lang-v1", "en");
    });
    await page.reload();
    // Let the seeded character's startup badge/zone bookkeeping settle before
    // taking the read-only handoff baseline. This is not a helper mutation.
    await page.waitForFunction(() => localStorage.getItem('bf-badges-seen') && localStorage.getItem('bf-zones-done'));
    const nav = page.locator('.secondary-navigation [data-nav="game"]');
    const section = page.locator('.ingame-helpers');
    const summary = key => section.locator(`[data-living-disclosure="helper-${key}"] > summary`);
    const check = async (width, height, zoom, heading) => {
      const before = await fs.readFile(journal);
      const prefs = await page.evaluate(() => Object.entries(localStorage));
      await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.unmaximize(); window.setContentSize(width, height); window.webContents.setZoomFactor(zoom);
      }, { width, height, zoom });
      await page.waitForFunction(width => Math.abs(innerWidth - width) < 24, width / zoom);
      await nav.press('Enter');
      await section.waitFor();
      assert.equal(await section.getByRole('heading').innerText(), heading);
      assert.equal(await section.evaluate(node => node.previousElementSibling.matches('[data-moment-settings]')), true);
      assert.equal(await section.locator('p code').innerText(), '/bf helpers panel');
      assert.equal(await section.locator('details:not([data-helper-owner])').count(), 11);
      await summary('questTracker').press('Enter');
      assert.deepEqual(await section.locator('details[open] code').allTextContents(), [
        '/bf helpers questTracker on', '/bf helpers questTracker off', '/bf helpers questTracker',
      ]);
      await page.keyboard.press('Tab');
      assert.equal(await summary('objectiveHints').evaluate(node => node.matches(':focus-visible')), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await summary('questTracker').evaluate(node => node.matches(':focus-visible')), true);
      assert.equal(await section.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await page.keyboard.press('Space');
      assert.equal(await section.locator('details[open]').count(), 0);
      assert.deepEqual(await fs.readFile(journal), before);
      assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), prefs);
    };
    await check(1180, 740, 1, 'In-Game Helpers');
    const beforeBatch = await fs.readFile(journal);
    const prefsBeforeBatch = await page.evaluate(() => Object.entries(localStorage));
    const batch = section.locator('[data-living-disclosure="helper-batch"]');
    await batch.locator('summary').press('Enter');
    assert.match(await batch.innerText(), /Alpha.*Synthetic/);
    const preview = batch.getByRole('textbox', { name: 'Command to paste in WoW' });
    assert.equal(await preview.isVisible(), false);
    await page.keyboard.press('Tab');
    assert.equal(await batch.getByLabel('Quest tracker', { exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await batch.getByLabel('Spell rank reminder', { exact: true }).press('Home');
    await batch.getByLabel('Spell rank reminder', { exact: true }).press('ArrowDown');
    await batch.getByLabel('Spell rank reminder', { exact: true }).press('Enter');
    const expected = '/bf helpers apply questTracker=off spellRankReminder=on commit';
    assert.equal(await preview.inputValue(), expected);
    await batch.getByRole('button', { name: 'Select command' }).press('Enter');
    assert.equal(await preview.evaluate(el => el === document.activeElement && el.readOnly && el.value.slice(el.selectionStart, el.selectionEnd) === el.value), true);
    assert.deepEqual(await fs.readFile(journal), beforeBatch);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), prefsBeforeBatch);
    const picker = page.getByLabel('Active character');
    await app.evaluate(() => { globalThis.holdBeta = true; });
    await picker.selectOption('Beta');
    await batch.waitFor({ state: 'detached' });
    assert.deepEqual(await fs.readFile(journal), beforeBatch);
    assert.equal(await app.evaluate(() => {
      if (!globalThis.releaseBeta) return false;
      globalThis.holdBeta = false;
      globalThis.releaseBeta();
      return true;
    }), true);
    await page.waitForFunction(() => document.querySelector('.ingame-helpers')?.textContent.includes('Beta'));
    await batch.locator('summary').press('Enter');
    assert.equal(await preview.isVisible(), false);
    await picker.selectOption('Alpha');
    await page.waitForFunction(() => document.querySelector('.ingame-helpers')?.textContent.includes('Alpha'));
    await batch.locator('summary').press('Enter');
    assert.equal(await preview.isVisible(), false);
    await page.evaluate(() => localStorage.setItem('bf-lang-v1', 'de'));
    await page.reload();
    await check(1180, 740, 1, 'Helfer im Spiel');
    await check(1000, 690, 1.25, 'Helfer im Spiel');
    await batch.getByText('Änderungen für WoW vorbereiten', { exact: true }).press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await batch.getByLabel('Questübersicht', { exact: true }).evaluate(el => el.matches(':focus-visible')), true);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const dePreview = batch.getByRole('textbox', { name: 'Befehl zum Einfügen in WoW' });
    assert.equal(await dePreview.inputValue(), '/bf helpers apply questTracker=off commit');
    await batch.getByRole('button', { name: 'Befehl markieren' }).press('Enter');
    assert.equal(await dePreview.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.matches(':focus-visible') && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    }), true);
    assert.equal(await section.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(await app.evaluate(() => globalThis.clipboardWrites), []);
    console.log('Helper handoff verified in Electron at normal and compact zoomed widths (English/German, keyboard, unchanged journal and storage, no clipboard writes).');
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
