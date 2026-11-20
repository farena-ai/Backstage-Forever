"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { launch, testWindow } = require('./test-window.cjs');
const { navigate } = require('./player-navigation.cjs');
const { defaultState, validateState } = require('../src/core/validation.cjs');

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'atlas-draft-'));
  let app;
  try {
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: 'alpha',
      profiles: ['alpha', 'beta'].map(id => ({ id, name: id, className: 'Mage', realm: 'Synthetic', level: 20, goals: [], notes: 'ATLAS_PRIVATE_NOTE' })),
      provider: { id: 'ollama', model: 'fixture', endpoint: 'http://127.0.0.1:11434' } });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'atlas-draft-fixture', version: require('../package.json').version, main: 'main.cjs' }));
    await fs.writeFile(path.join(dir, 'main.cjs'), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
      const { ipcMain } = require('electron');
      globalThis.fixture = { asks: [], provider: [] };
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => {
        if (channel === 'backstage:askCompanion') fixture.asks.push(args[0]);
        return fn(event, ...args);
      });
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/providers.cjs').ask = async input => { fixture.provider.push(input.prompt); return 'Unrelated synthetic answer'; };
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
    page.setDefaultTimeout(6000);
    await page.evaluate(() => { localStorage.setItem('bf-setup-v4', 'complete'); localStorage.setItem('bf-tour-v1', 'done'); });
    await page.reload();
    const call = (method, ...args) => page.evaluate(({method, args}) => window.backstage[method](...args), {method, args});
    const question = page.getByRole('textbox', {name:'Your question', exact:true});
    const send = page.getByRole('button', {name:'Send question', exact:true});
    const ask = page.getByRole('button', {name:'Ask about this', exact:true});
    const draft = 'Dungeon prep for #dm';
    async function openAtlas() {
      await navigate(page, 'dungeons');
      const toggle = page.locator('[data-atlas-open="dm"]');
      await toggle.waitFor();
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.press('Enter');
      await ask.waitFor();
    }
    await openAtlas();
    assert.equal(await ask.count(), 1);
    // A real, different Atlas record does not offer this pilot action.
    await page.locator('[data-atlas-open="dme"]').press('Enter');
    assert.equal(await ask.count(), 0);
    await openAtlas();
    // Reject a substituted instance rather than guessing by display name.
    await ask.evaluate(button => { button.dataset.atlasAsk = 'dme'; button.click(); button.dataset.atlasAsk = 'dm'; });
    assert.equal(await question.count(), 0);
    // Even for the same character, closing the source retires an admitted draft.
    await page.evaluate(() => { autosaveQueue = new Promise(resolve => { window.releaseAtlasDraft = resolve; }); });
    await ask.press('Enter');
    await page.locator('[data-atlas-open="dm"]').press('Enter');
    assert.equal(await ask.count(), 0);
    await page.evaluate(async () => { window.releaseAtlasDraft(); await autosaveQueue; });
    assert.equal(await question.count(), 0);
    await openAtlas();
    // An admitted click cannot open a draft after its source profile changes.
    await page.evaluate(() => { autosaveQueue = new Promise(resolve => { window.releaseAtlasDraft = resolve; }); });
    await ask.press('Enter');
    await page.getByLabel('Active character', {exact:true}).selectOption('beta');
    await page.evaluate(async () => { window.releaseAtlasDraft(); await autosaveQueue; });
    await page.waitForFunction(() => state.activeProfileId === 'beta');
    assert.equal(await question.count(), 0);
    await page.getByLabel('Active character', {exact:true}).selectOption('alpha');
    await page.waitForFunction(() => state.activeProfileId === 'alpha');
    await openAtlas();
    await ask.focus();
    await page.keyboard.down('Enter');
    await page.waitForFunction(value => document.activeElement?.matches('#chat-form textarea') && document.activeElement.value === value, draft);
    await page.keyboard.down('Enter'); // Repeat of the same physical activation, not a new Send gesture.
    await page.keyboard.up('Enter');
    assert.equal(await question.inputValue(), draft);
    assert.deepEqual(await question.evaluate(field => [field.selectionStart, field.selectionEnd]), [draft.length, draft.length]);
    assert.deepEqual(await app.evaluate(() => fixture), {asks:[], provider:[]});
    assert.equal(await call('memoryDraft', 'alpha'), null);
    assert.deepEqual(await call('memoryList', 'alpha'), []);

    // Preserve an existing unsent question when opening the same source again.
    await question.fill('My unfinished question');
    await openAtlas();
    await ask.press('Enter');
    await page.waitForFunction(() => document.activeElement?.matches('#chat-form textarea') && document.activeElement.value === 'My unfinished question');
    assert.deepEqual(await app.evaluate(() => fixture), {asks:[], provider:[]});

    // Follow the preservation notice: clearing the prior text must really discard it.
    await question.fill('');
    await openAtlas();
    await ask.press('Enter');
    await page.waitForFunction(value => document.activeElement?.matches('#chat-form textarea') && document.activeElement.value === value, draft);

    const edited = `${draft}?`;
    await question.fill(edited);
    await send.press('Enter');
    await page.locator('#chatlog').getByText('The Deadmines (#dm)', {exact:true}).waitFor();
    await page.locator('#chatlog').getByText(/No verified Forever preparation details/).waitFor();
    let trace = await app.evaluate(() => fixture);
    assert.deepEqual(trace.asks.map(x => x.prompt), [edited]);
    assert.deepEqual(trace.provider, []);
    assert.equal(await call('memoryDraft', 'alpha'), null);
    assert.deepEqual(await call('memoryList', 'alpha'), []);

    const next = 'Explain how to organize a weekly study schedule';
    await question.fill(next);
    await send.press('Enter');
    await page.locator('#chatlog').getByText('Unrelated synthetic answer', {exact:true}).waitFor();
    trace = await app.evaluate(() => fixture);
    assert.deepEqual(trace.asks.map(x => x.prompt), [edited, next]);
    assert.equal(trace.provider.length, 1);
    assert.match(trace.provider[0], /weekly study schedule/);
    assert.doesNotMatch(trace.provider[0], /#dm|Deadmines|No verified Forever preparation|ATLAS_PRIVATE_NOTE/);
    const review = await call('memoryDraft', 'alpha');
    assert.equal(review.question, next);
    assert.doesNotMatch(JSON.stringify(review), /#dm|Deadmines|ATLAS_PRIVATE_NOTE/);
    assert.deepEqual(await call('memoryList', 'alpha'), []);
    assert.deepEqual(errors, []);
    console.log('Atlas Companion draft PASS: keyboard opening, edit, explicit offline send, retained unsent input, clean next provider turn and Memory.');
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
