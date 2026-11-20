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
      const GameSync=load('./src/core/game-sync.cjs').GameSync;
      const restore=GameSync.prototype.restore;
      GameSync.prototype.restore=function(){globalThis.fixtureGame=this;return restore.call(this)};
      globalThis.clipboardWrites=[];
      const {clipboard,ipcMain}=require('electron');
      clipboard.writeText=(value)=>globalThis.clipboardWrites.push(value);
      const handle=ipcMain.handle.bind(ipcMain);
      ipcMain.handle=(channel,fn)=>handle(channel,channel==='backstage:saveState' ? async (event,...args)=>{
        if(globalThis.holdBeta && args[0]?.activeProfileId==='Beta') {
          await new Promise(resolve=>{globalThis.releaseBeta=resolve});
        }
        return fn(event,...args);
      } : channel==='backstage:gameSnapshot' ? async (event,...args)=>{
        const result=await fn(event,...args);
        globalThis.lastHelperPoll=result;
        return result;
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
    await page.waitForFunction(() => {
      const badges = JSON.parse(localStorage.getItem('bf-badges-seen') || '{}');
      return badges.Alpha?.includes('level-10') && localStorage.getItem('bf-zones-done') !== null;
    });
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
    // Feed real saved exports through GameSync, the Store and the renderer poll.
    const client = path.join(dir, 'client');
    const saved = path.join(client, 'WTF', 'Account', 'SyntheticAccount', 'SavedVariables', 'BackstageForever.lua');
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(path.join(client, '.flavor.info'), 'wowf');
    const start = Math.floor(Date.now() / 1000) - 30;
    const publish = async (name, offset) => {
      const observedAt = start + offset;
      const bytes = 'BackstageForeverExport = ' + JSON.stringify(JSON.stringify({
        schema: 1, observedAt, activeId: `Player-synthetic-${name}`,
        characters: ['Alpha', 'Beta'].map(name => ({
          id: `Player-synthetic-${name}`, name, realm: 'Synthetic', className: 'Hunter', level: 15, updatedAt: observedAt,
        })),
      }));
      await fs.writeFile(saved, bytes);
      const status = await app.evaluate(async (_, root) => {
        const game = globalThis.fixtureGame;
        if (!root) return game.refresh();
        const status = await game.connect(root);
        clearInterval(game.timer); // Advance fixture reads only at publish().
        return status;
      }, offset === 0 ? client : null);
      const stamp = new Date(observedAt * 1000).toISOString();
      assert.equal(status.lastSync, stamp);
      const journalBytes = await fs.readFile(journal);
      assert.equal(JSON.parse(journalBytes).activeProfileId, name, 'follow-game must commit the saved owner in main');
      return { stamp, bytes, journalBytes };
    };
    const waitForPoll = async ({ stamp }, name) => {
      const deadline = Date.now() + 12000;
      do {
        const seen = await app.evaluate((_, { stamp, name }) => {
          const result = globalThis.lastHelperPoll;
          return result?.gameStatus.lastSync === stamp && result.state.activeProfileId === name;
        }, { stamp, name });
        if (seen) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.fail(`Renderer did not poll the ${name} saved snapshot (${stamp})`);
    };
    await waitForPoll(await publish('Alpha', 0), 'Alpha');
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-helper-owner]')?.dataset.helperOwner || 'null')?.[3] === 'wow-addon');
    assert.equal(await page.locator('#follow-game-character').isChecked(), true);
    const questChoice = batch.getByLabel('Quest tracker', { exact: true });
    // The picker round-trip may already have left the disclosure open.
    if (await batch.getAttribute('open') === null) await batch.locator('summary').press('Enter');
    await questChoice.selectOption('off');
    await batch.getByRole('button', { name: 'Select command' }).press('Enter');
    const selectedCommand = () => preview.evaluate(el => el === document.activeElement && el.readOnly &&
      el.value === '/bf helpers apply questTracker=off commit' && el.selectionStart === 0 && el.selectionEnd === el.value.length);
    assert.equal(await selectedCommand(), true);
    const followPrefs = await page.evaluate(() => Object.entries(localStorage));
    await waitForPoll(await publish('Alpha', 1), 'Alpha');
    await page.waitForFunction(() => !snapshotPolling);
    assert.equal(await selectedCommand(), true, 'a same-owner poll must preserve the selected command');
    const switched = await publish('Beta', 2);
    await waitForPoll(switched, 'Beta');
    await page.waitForFunction(() => !snapshotPolling);
    assert.equal(await page.evaluate(() => {
      const text = document.querySelector('#helper-batch-command');
      return text?.value === '/bf helpers apply questTracker=off commit';
    }), false, 'Observed Beta snapshot left the Alpha command mounted and copyable');
    const expectEmptyDraft = async name => {
      await page.waitForFunction(name => document.querySelector('[data-helper-owner] strong')?.textContent === `${name} · Synthetic`, name);
      assert.equal(await picker.inputValue(), name);
      if (await batch.getAttribute('open') === null) await batch.locator('summary').press('Enter');
      assert.equal(await questChoice.inputValue(), '');
      assert.equal(await batch.locator('#helper-batch-command').inputValue(), '');
      assert.equal(await preview.isVisible(), false);
    };
    await expectEmptyDraft('Beta');
    assert.deepEqual(await fs.readFile(journal), switched.journalBytes);
    await questChoice.selectOption('on');
    // Exercise the shell's ordinary edit guard independently of helper focus.
    const editor = await page.evaluateHandle(() => {
      const form = document.createElement('form');
      const input = form.appendChild(document.createElement('textarea'));
      document.body.append(form);
      input.focus();
      return input;
    });
    await page.keyboard.insertText('unsaved unrelated edit');
    const returned = await publish('Alpha', 3);
    await waitForPoll(returned, 'Alpha');
    await page.waitForFunction(() => !snapshotPolling);
    assert.equal(await batch.count(), 0, 'retire the outgoing batch even while a genuine edit defers repaint');
    assert.equal(await picker.inputValue(), 'Beta', 'the shell must still defer repaint during the edit');
    assert.equal(await editor.evaluate(el => el === document.activeElement && el.value === 'unsaved unrelated edit'), true);
    await editor.evaluate(el => el.form.remove());
    await editor.dispose();
    await expectEmptyDraft('Alpha');
    assert.deepEqual(await fs.readFile(journal), returned.journalBytes);
    assert.equal(await fs.readFile(saved, 'utf8'), returned.bytes);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), followPrefs);

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
    console.log('Helper handoff verified in Electron (English/German, keyboard, picker and follow-game retirement, no draft persistence or clipboard writes).');
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
