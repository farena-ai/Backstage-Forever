"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { launch, testWindow } = require('./test-window.cjs');
const { defaultState, validateState } = require('../src/core/validation.cjs');

(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(process.env.BF_TEST_TMP || os.tmpdir()), 'bf-atlas-a11y-'));
  let app;
  try {
    const state = JSON.stringify(validateState({ ...defaultState(), onboarded: true, activeProfileId: 'main', profiles: [{
      id: 'main', name: 'Atlas Fixture', className: 'Rogue', faction: 'Alliance', realm: 'Synthetic', level: 20,
      notes: '', goals: [], clientBuild: '1.60.1.70862', source: { kind: 'wow-addon', id: 'Player-atlas-fixture', updatedAt: '2026-11-12T00:00:00.000Z' },
      journal: { encounters: [{ encounterId: 1144, name: 'Edwin VanCleef', instanceMap: 36, instanceType: 'party', difficultyId: 1, at: 1700000000 }] },
      quests: [{ id: 166, title: 'The Defias Brotherhood', complete: true, objectives: [{ text: 'Edwin VanCleef defeated', done: true }] }],
    }] }));
    await fs.writeFile(path.join(dir, 'state.json'), state);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'atlas-a11y-fixture', version: require('../package.json').version, main: 'fixture.cjs' }));
    await fs.writeFile(path.join(dir, 'fixture.cjs'), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});
      const { app, session } = require('electron');
      app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true })));
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/claude.cjs').status = async () => ({available:false, connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({state:'not-running', launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({available:false, recognizers:[], voices:[]});
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      load('./src/main.cjs');
    `);
    app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: '1' }, timeout: 20000 });
    const page = await testWindow(app), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(6000);
    const atlas = page.locator('[data-atlas]');
    const captures = process.env.BF_ATLAS_CAPTURE_DIR;
    if (captures) await fs.mkdir(captures, { recursive: true });
    async function capture(name) {
      if (!captures) return;
      const cdp = await page.context().newCDPSession(page);
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false });
        await fs.writeFile(path.join(captures, `${name}.png`), Buffer.from(data, 'base64'));
      } finally { await cdp.detach(); }
    }
    const tab = id => atlas.locator(`[data-atlas-tab="${id}"]`);
    const focus = selector => page.waitForFunction(s => document.activeElement.matches(s), selector);
    const press = key => page.keyboard.press(key);
    async function contrast(locator, surface, property, minimum) {
      const sample = await locator.evaluate((el, { surface, property }) => {
        const fg = getComputedStyle(el)[property];
        const bg = getComputedStyle(el.closest(surface)).backgroundColor;
        const lum = color => color.match(/\d+/g).slice(0, 3).map(x => {
          const v = Number(x) / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const pair = [lum(fg), lum(bg)].sort((a, b) => b - a);
        return { fg, bg, ratio: (pair[0] + 0.05) / (pair[1] + 0.05) };
      }, { surface, property });
      assert.ok(sample.ratio >= minimum, `${property} needs ${minimum}:1; ${JSON.stringify(sample)}`);
    }
    async function ring(locator) {
      const result = await locator.evaluate(el => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const n = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
        let bounds = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
        for (let p = el.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          if (css.overflowX !== 'visible') { bounds.left = Math.max(bounds.left, rect.left); bounds.right = Math.min(bounds.right, rect.right); }
          if (css.overflowY !== 'visible') { bounds.top = Math.max(bounds.top, rect.top); bounds.bottom = Math.min(bounds.bottom, rect.bottom); }
        }
        return { visible: el.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
          inside: r.left - n >= bounds.left && r.right + n <= bounds.right && r.top - n >= bounds.top && r.bottom + n <= bounds.bottom,
          rect: r.toJSON(), bounds };
      });
      assert.ok(result.visible && result.inside, `focused outline clipped or missing: ${JSON.stringify(result)}`);
    }
    for (const { lang, size, zoom } of [
      { lang: 'en', size: [1480, 900], zoom: 1 },
      { lang: 'de', size: [1000, 700], zoom: 1 },
      { lang: 'de', size: [1480, 900], zoom: 1.25 },
      { lang: 'de', size: [1000, 700], zoom: 1.25 },
    ]) {
      await page.evaluate(lang => {
        localStorage.setItem('bf-setup-v4', 'complete');
        localStorage.setItem('bf-tour-v1', 'done');
        localStorage.setItem('bf-lang-v1', lang);
        localStorage.setItem('bf-desktop-view-prefs:main', '{"version":1,"preset":"planner","overrides":{}}');
      }, lang);
      await page.reload();
      const [width, height] = await app.evaluate(({ BrowserWindow }, { size, zoom }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w.isMaximized()) w.unmaximize();
        w.setSize(...size);
        w.webContents.setZoomFactor(zoom);
        return w.getContentSize();
      }, { size, zoom });
      await page.waitForFunction(([w, h, z]) => Math.abs(innerWidth - w / z) <= 1 && Math.abs(innerHeight - h / z) <= 1, [width, height, zoom]);
      await page.locator('.primary-navigation [data-nav="adventure"]').press('Enter');
      await page.locator('[data-shell-control="subtab:dungeons"]').press('Enter');
      await atlas.locator('[data-atlas-card="dm"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const german = lang === 'de';
      const label = `${lang}-${size[0]}-${zoom * 100}`;
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      assert.equal(await atlas.locator('h1').innerText(), german ? 'Instanz-Atlas' : 'Instance Atlas');
      const tabs = atlas.getByRole('tablist', { name: german ? 'Instanztypen' : 'Instance types', exact: true });
      const panel = atlas.getByRole('tabpanel', { name: 'Dungeons', exact: true });
      assert.match(await tabs.ariaSnapshot(), /tab "Dungeons" \[selected\]/);
      await panel.locator('[data-atlas-card="dm"]').waitFor();
      await tab('dungeon').focus();
      await press('ArrowRight');
      await focus('[data-atlas-tab="raid"]');
      await panel.waitFor(); // Manual activation: focus alone does not change the results.
      await press('Space');
      await atlas.getByRole('tabpanel', { name: german ? 'Schlachtzüge' : 'Raids' }).waitFor();
      await press('End');
      await focus('[data-atlas-tab="forever"]');
      await press('Home');
      await focus('[data-atlas-tab="dungeon"]');
      await press('Enter');
      await panel.waitFor();
      await press('Tab');
      await focus('[data-atlas-suggest] [data-atlas-prep]');
      await press('Shift+Tab');
      await focus('[data-atlas-tab="dungeon"]');
      await ring(tab('dungeon'));
      await capture(`atlas-${label}`);
      const recap = atlas.getByRole('region', { name: german ? 'Deine Begegnungsübersicht' : 'Your encounter recap', exact: true });
      await recap.getByText('Edwin VanCleef', { exact: true }).waitFor();
      const link = recap.getByRole('button', { name: german ? 'Vorbereitung für The Deadmines öffnen' : 'Open prep for The Deadmines', exact: true });
      await link.press('Enter');
      const dm = atlas.locator('[data-atlas-card="dm"]');
      await focus('[data-atlas-prep-heading]');
      assert.equal(await dm.locator('[data-atlas-prep-heading]').innerText(), german ? 'Vorbereitung für The Deadmines' : 'Prepare for The Deadmines');
      const copy = dm.getByRole('button', { name: german ? 'Eingangspfadpunkt kopieren' : 'Copy entrance waypoint', exact: true });
      const rect = await copy.boundingBox();
      const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
      assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport[1], `first action on arrival: ${JSON.stringify({ rect, viewport })}`);
      const prep = dm.locator('[data-atlas-prep-heading]');
      if (german) {
        await dm.getByText(/^Ungefährer Eingang in Classic: .+ · 42, 72\. In Forever prüfen\.$/).waitFor();
        await dm.getByRole('button', { name: 'Quest öffnen: The Defias Brotherhood', exact: true }).waitFor();
        const ask = dm.getByRole('button', { name: 'Dazu fragen', exact: true });
        assert.equal(await ask.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent),
          'Öffnet einen bearbeitbaren Companion-Entwurf für The Deadmines (#dm). Erst wenn du „Senden“ wählst, wird etwas gesendet.');
      }
      await contrast(prep, '.atlas-preflight', 'color', 4.5);
      await contrast(prep, '.atlas-preflight', 'outlineColor', 3);
      await press('Tab');
      await focus('[data-atlas-way="dm"]');
      await ring(copy);
      await contrast(copy, '.atlas-preflight', 'outlineColor', 3);
      await press('Tab');
      await focus('[data-atlas-map="dm"]');
      await press('Shift+Tab');
      await focus('[data-atlas-way="dm"]');
      await ring(copy);
      await capture(`prep-${label}`);
      await press('Tab');
      await focus('[data-atlas-map="dm"]');
      await press('Tab');
      await focus('[data-fieldbook-mode]');
      await press('Space');
      const fieldbook = dm.locator('[data-dungeon-fieldbook="compact"]');
      await fieldbook.waitFor();
      assert.equal(await dm.locator('[data-fieldbook-mode]').getAttribute('aria-pressed'), 'true');
      const practice = fieldbook.getByRole('button', { name: german ? 'Kampfbeginn üben' : 'Practice the opener', exact: true });
      await practice.press('Enter');
      await focus('#drill-title');
      const firstChoice = page.locator('#practice-action-start');
      const choice = await firstChoice.boundingBox();
      assert.ok(choice?.y >= 0 && choice.y + choice.height <= viewport[1], `Lab first choice on arrival: ${JSON.stringify(choice)}`);
      await press('Tab');
      await focus('#practice-action-start');
      await press('Space');
      await focus('#result-title');
      await page.getByRole('button', { name: german ? 'Zurück zum Handbuch für The Deadmines' : 'Back to Deadmines Fieldbook', exact: true }).press('Enter');
      await focus('[data-fieldbook-practice="opener"][data-fieldbook-instance="dm"]');
      await fieldbook.waitFor();
      await ring(practice);
      await contrast(practice, '.atlas-preflight', 'outlineColor', 3);
      await capture(`return-${label}`);
      const summaries = fieldbook.locator('.atlas-fieldbook-support > summary');
      assert.equal(await summaries.count(), 2);
      await summaries.first().press('Space');
      assert.match(await fieldbook.ariaSnapshot(), german ? /heading "Boss-Referenz und Tipps"/ : /heading "Boss reference & tips"/);
      await press('Tab');
      await focus('.atlas-fieldbook-support:last-child > summary');
      await ring(summaries.last());
      await press('Shift+Tab');
      await focus('.atlas-fieldbook-support:not(:last-child) > summary');
      await ring(summaries.first());
      assert.deepEqual(await atlas.evaluate(el => [document.documentElement, el.closest('.main'), el, el.querySelector('[data-atlas-card="dm"]')]
        .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className)), [], 'no shell or card horizontal overflow');
      if (german && zoom === 1.25 && size[0] === 1000) {
        const hero = atlas.locator('.page-hero');
        const motion = () => hero.evaluate(el => getComputedStyle(el, '::before').animationName);
        assert.notEqual(await motion(), 'none');
        await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
        assert.equal(await motion(), 'none');
        assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
        await ring(summaries.first());
        assert.match(await dm.evaluate(el => getComputedStyle(el).backgroundColor), /^rgb\(/, 'forced-colors card needs an opaque backdrop behind the focus ring');
        await contrast(summaries.first(), '.atlas-card', 'outlineColor', 3);
        assert.match(await tab('dungeon').evaluate(el => getComputedStyle(el).textDecorationLine), /underline/);
        await capture(`contrast-${label}`);
      }
      console.log(`Atlas ${lang} ${size.join('×')} at ${zoom * 100}%: ${viewport.join('×')} CSS px`);
    }
    assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), state);
    assert.deepEqual(errors, []);
  } finally {
    try { await app?.close(); } finally { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
