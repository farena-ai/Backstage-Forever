"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { testWindow, launch } = require('./test-window.cjs');
const { defaultState, validateState } = require('../src/core/validation.cjs');

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'atlas-recap-'));
  let app;
  try {
    const boss = { encounterId: 1144, name: 'Edwin VanCleef', instanceMap: 36, instanceType: 'party', difficultyId: 1, at: 1700000000 };
    const encounters = [boss, { ...boss, encounterId: 99, name: 'Unmapped <boss>', instanceMap: 99999, instanceType: 'raid', at: boss.at + 1 }];
    const profile = { className: 'Rogue', faction: 'Alliance', realm: 'Synthetic', level: 20, notes: '', goals: [] };
    const profiles = [{ ...profile, id: 'main', name: 'Example', journal: { encounters } }, { ...profile, id: 'alt', name: 'Alt' }];
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: 'main', profiles });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'atlas-recap-fixture', version: require('../package.json').version, main: 'main.cjs' }));
    await fs.writeFile(path.join(dir, 'main.cjs'), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/claude.cjs').status = async () => ({available:false, connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({state:'not-running', launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({available:false, recognizers:[], voices:[]});
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: '1' }, timeout: 20000 });
    const page = await testWindow(app), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.evaluate(() => { localStorage.setItem('bf-setup-v4', 'complete'); localStorage.setItem('bf-tour-v1', 'done'); });
    await page.reload();
    await page.locator('[data-nav="adventure"]').first().click();
    await page.locator('[data-shell-control="subtab:dungeons"]').click();
    const atlas = page.locator('[data-atlas]'), recap = atlas.getByRole('region', { name: 'Your encounter recap' });
    const picker = page.getByRole('combobox', { name: 'Active character' });
    const rows = recap.locator('li');
    for (const size of [[1480, 900], [1000, 760]]) {
      const native = await app.evaluate(({ BrowserWindow }, size) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w.isMaximized()) w.unmaximize();
        w.setSize(...size);
        return w.getSize();
      }, size);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      console.log(`Native ${native.join('×')}; viewport ${await page.evaluate(() => `${innerWidth}×${innerHeight}`)}`);
      await recap.getByText(boss.name, { exact: true }).waitFor();
      assert.deepEqual(await rows.locator('strong').allTextContents(), [encounters[1].name, boss.name]);
      assert.deepEqual(await rows.locator('time').evaluateAll(times => times.map(time => time.dateTime)), encounters.slice().reverse().map(row => new Date(row.at * 1000).toISOString()));
      await rows.first().getByText('Unknown raid', { exact: true }).waitFor();
      await rows.last().getByText('The Deadmines', { exact: true }).waitFor();
      assert.ok(await recap.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'recap fits available width');
      if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], `atlas-recap-${size[0]}.png`), animations: 'disabled' });
    }
    await atlas.getByRole('tab', { name: 'Raids', exact: true }).click();
    await recap.getByText(boss.name, { exact: true }).waitFor();
    await atlas.getByRole('tab', { name: 'Dungeons', exact: true }).click();
    const deadmines = atlas.locator('[data-atlas-card="dm"]');
    await deadmines.getByRole('button', { name: /Bosses, roles & prep/ }).click();
    await deadmines.getByRole('heading', { name: 'Before you go' }).waitFor();
    await picker.selectOption('alt');
    await recap.getByText(/No saved encounter defeats yet/).waitFor();
    assert.equal(await rows.count(), 0);
    await picker.selectOption('main');
    await recap.getByText(boss.name, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Dungeon Atlas recap smoke passed');
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
