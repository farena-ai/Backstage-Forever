"use strict";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { version } = require("../package.json");

(async () => {
  const cases = new Set(process.argv.slice(2));
  const reviews = ["focus", "retry", "combat", "reset"];
  for (const name of cases) assert.ok(reviews.includes(name), `Unknown regression: ${name}`);
  const scratch = await fs.mkdtemp(path.join(process.env.BF_TEST_TMP || os.tmpdir(), "bf-dispatch-desktop-"));
  let app, page, cdp;
  const errors = [];
  const repo = path.resolve(__dirname, "..");
  const installed = async (name, running, { legacy = true, source = false, holdTour = false, setup = "" } = {}) => {
    const dir = path.join(scratch, name);
    await fs.mkdir(dir, { recursive: true });
    const journal = validateState({ ...defaultState(), onboarded: true, activeProfileId: "Fixture", profiles: [
      { id: "Fixture", name: "Fixture", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", goals: [], notes: "" },
    ] });
    if (legacy) await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(journal), { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-dispatch-fixture", version: running, main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const electron = require('electron');
      const { app, BrowserWindow } = electron;
      app.setPath('userData', ${JSON.stringify(dir)});
      Object.defineProperty(app, 'isPackaged', { value: ${!source} });
      const load = require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      const Module = require('node:module'), originalLoad = Module._load;
      const replacement = Object.create(electron);
      Object.defineProperty(replacement, 'BrowserWindow', { value: new Proxy(BrowserWindow, {
        construct(Target, [options]) {
          const win = new Target({ ...options, show: false });
          win.isFocused = () => !!app.fixtureForeground;
          return win;
        },
      }) });
      Module._load = function(id, parent, ...rest) {
        return id === 'electron' && parent?.filename === load.resolve('./src/main.cjs') ? replacement : originalLoad.call(this, id, parent, ...rest);
      };
      electron.shell.openExternal = async () => { throw Error('Unexpected external link'); };
      if (${holdTour}) {
        const handle = electron.ipcMain.handle.bind(electron.ipcMain);
        electron.ipcMain.handle = (name, fn) => handle(name, name === 'backstage:onboarding' ? async (...args) => {
          await fn(...args); // Retain the real sender checks; only control the fixture tour decision.
          return new Promise(resolve => { app.releaseFixtureTour = () => resolve({ show: true }); });
        } : fn);
      }
      load('./src/core/updater.cjs').Updater.prototype.start = () => {};
      load('./src/core/community.cjs').CommunityService.prototype.start = () => {};
      load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.setContext = () => {};
      load('./src/core/model-catalog.cjs').listModels = async () => ({ models: [], source: 'fixture' });
      load('./src/core/claude.cjs').status = async () => ({ available: false, connected: false });
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({ state: 'not-running', launchAvailable: false });
      const L = load('./src/core/live-bridge.cjs').LiveBridge;
      L.prototype.readPreference = () => false; L.prototype.start = () => {};
      const fixtureFs = require('node:fs');
      const fixtureFile = ${JSON.stringify(path.join(dir, "field-dispatch.json"))};
      ${setup}
      load('./src/main.cjs');
    `);
    app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 25000 });
    app.on("console", message => { if (/Error occurred in handler/.test(message.text())) console.error(message.text()); });
    page = await testWindow(app);
    page.setDefaultTimeout(10000);
    page.on("pageerror", e => errors.push(e.message));
    cdp = await page.context().newCDPSession(page);
    return path.join(dir, "field-dispatch.json");
  };
  const close = async () => { await cdp.detach(); await app.close(); app = null; };
  const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
  const absent = file => assert.rejects(fs.access(file), { code: "ENOENT" });
  const shown = () => page.locator("dialog.field-dispatch[open]");
  const gate = async (native, visible = true) => {
    await app.evaluate(({ app: electronApp, BrowserWindow }, { native, visible }) => {
      electronApp.fixtureForeground = native;
      const w = BrowserWindow.getAllWindows()[0];
      if (visible) w.showInactive(); else w.hide();
    }, { native, visible });
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  };
  const complete = async (language = "en") => {
    await page.evaluate(lang => { localStorage.setItem("bf-lang-v1", lang); localStorage.setItem("bf-setup-v4", "complete"); }, language);
    await page.reload();
    await page.locator("#main-content").waitFor();
  };
  const updates = async () => {
    await page.locator('.secondary-navigation [data-nav="game"]').press("Enter");
    await page.locator('.player-subtabs [data-nav="updates"]').press("Enter");
  };
  const opener = () => page.locator('[data-command="field-dispatch"]');
  const noRecap = async () => assert.equal(await shown().count(), 0);
  const recorded = async (file, check) => {
    for (let i = 0; i < 100; i++) {
      try { if (check(await read(file))) return; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Expected field dispatch record in ${file}`);
  };
  const checkLayout = async filename => {
    if (filename) {
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setSize(1000, 700); });
      await page.waitForFunction(() => innerWidth <= 1000 && innerHeight <= 700);
    }
    await shown().locator("img").evaluate(img => img.decode());
    const bounds = await shown().evaluate(el => {
      const fits = node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
      const luminance = css => css.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => {
        const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      const paper = luminance(getComputedStyle(el.querySelector('.field-dispatch__content')).backgroundColor);
      const contrast = [...el.querySelectorAll('.field-dispatch__content h3')].map(h => {
        const text = luminance(getComputedStyle(h).color);
        return (Math.max(paper, text) + .05) / (Math.min(paper, text) + .05);
      });
      return { viewport: [innerWidth, innerHeight], fit: fits(el) && [...el.querySelectorAll('footer button')].every(fits),
        overflow: el.scrollWidth > el.clientWidth + 1, artwork: el.querySelector('img').getAttribute('src'), contrast };
    });
    assert.ok(bounds.fit, JSON.stringify(bounds));
    assert.equal(bounds.overflow, false);
    assert.ok(bounds.contrast.length && bounds.contrast.every(ratio => ratio >= 4.5), `Heading contrast: ${bounds.contrast}`);
    assert.match(bounds.artwork, /art\/heroes\/whats-new\.webp$/);
    if (process.env.BF_DISPATCH_SCREENSHOTS) {
      await fs.mkdir(process.env.BF_DISPATCH_SCREENSHOTS, { recursive: true });
      const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: false });
      await fs.writeFile(path.join(process.env.BF_DISPATCH_SCREENSHOTS, filename || "upgrade.png"), Buffer.from(data, "base64"));
    }
    return bounds.viewport;
  };
  const expectMain = async check => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("Timed out waiting for the fixture's main-process checkpoint");
  };
  const run = name => !cases.size || cases.has(name);
  const reviewScenarios = async () => {
    if (run("focus")) {
      await installed("focus", version);
      await gate(true);
      await complete("de");
      await updates();
      await opener().press("Enter");
      await shown().getByRole("heading", { name: "Änderungsverlauf" }).waitFor();
      await checkLayout("review-focus-compact-de.png");
      await page.keyboard.press("Tab");
      assert.equal(await shown().getByRole("searchbox").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      const ring = await shown().getByRole("button", { name: "Suche leeren" }).evaluate(el => {
        const luminance = css => css.match(/\d+/g).slice(0, 3).map(Number).reduce((sum, n, i) => {
          const c = n / 255;
          return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
        }, 0);
        const style = getComputedStyle(el);
        const outline = luminance(style.outlineColor);
        const paper = luminance(getComputedStyle(el.closest(".field-dispatch__content")).backgroundColor);
        return { visible: el.matches(":focus-visible") && style.outlineStyle === "solid" && parseFloat(style.outlineWidth) >= 2,
          contrast: (Math.max(outline, paper) + .05) / (Math.min(outline, paper) + .05) };
      });
      assert.ok(ring.visible && ring.contrast >= 3, `Clear search focus: ${JSON.stringify(ring)}`);
      await close();
      console.log(`German compact Clear search keyboard outline: ${ring.contrast.toFixed(2)}:1`);
    }
    if (run("retry")) {
      const file = await installed("retry", "1.9.0");
      await complete();
      await gate(true);
      await recorded(file, state => state.lastRun.version === "1.9.0");
      const before = await fs.readFile(file, "utf8");
      await close();
      await installed("retry", version, { setup: `
        const rename = fixtureFs.renameSync;
        fixtureFs.renameSync = (from, to) => {
          if (to === fixtureFile && !app.fixtureFailedRename) {
            app.fixtureFailedRename = true;
            throw Object.assign(new Error('fixture promotion failure'), { code: 'EBUSY' });
          }
          return rename(from, to);
        };
      ` });
      await page.locator("#main-content").waitFor();
      await gate(true);
      await expectMain(() => app.evaluate(({ app }) => !!app.fixtureFailedRename));
      await noRecap();
      assert.equal(await fs.readFile(file, "utf8"), before);
      assert.deepEqual((await fs.readdir(path.dirname(file))).filter(name => /^field-dispatch.*\.tmp$/.test(name)), []);
      await gate(true);
      await shown().getByRole("heading", { name: `Updated from 1.9.0 to ${version}` }).waitFor();
      assert.equal((await read(file)).pending.id, `stable:1.9.0..${version}`);
      await close();
      console.log("Failed promotion preserved exact bytes; the next foreground readiness event retried");
    }
    if (run("combat")) {
      const file = await installed("combat", "1.9.0");
      await complete();
      await gate(true);
      await recorded(file, state => state.lastRun.version === "1.9.0");
      const before = await fs.readFile(file, "utf8");
      await close();
      await installed("combat", version, { setup: `
        const { HAIRLINE, HAIRLINE_WIDTH, crc8, encodeHairlineFrame, encodeHairlineCells } = load('./src/core/live-bridge.cjs');
        const subscribe = L.prototype.subscribe;
        L.prototype.subscribe = function(fn) {
          this.platform = 'win32'; this.enabled = true;
          let now = 10000;
          this.now = () => now;
          app.fixtureCombat = (combat, seq) => {
            const payload = Buffer.alloc(27);
            payload[0] = HAIRLINE.version;
            payload[1] = seq;
            payload[10] = Number(combat);
            payload.writeUInt16BE(4242, 23);
            payload[25] = ++now % 256;
            payload[26] = crc8(payload, 26);
            const cells = encodeHairlineCells(encodeHairlineFrame(payload, []));
            const rgb = Buffer.from(cells.flatMap(cell => [...cell, ...cell]));
            this.read('ok topleft ' + HAIRLINE_WIDTH + ' 1 ' + rgb.toString('base64') + ' pw\\n');
            const frame = this.current();
            return { seq: frame?.seq, characterHash: frame?.characterHash, combat: frame?.combat };
          };
          app.fixtureCombatExpires = () => {
            this.line('nogame'); // Signal changes but the last frame is still fresh.
            now += 5000;
            this.line('nogame'); // Same worker signal, but the observation is now stale.
          };
          return subscribe.call(this, fn);
        };
        const handle = electron.ipcMain.handle.bind(electron.ipcMain);
        electron.ipcMain.handle = (name, fn) => handle(name, name === 'backstage:fieldDispatchStartup' ? async (...args) => {
          const result = await fn(...args);
          if (app.holdFixtureDispatch && result?.offer) {
            app.holdFixtureDispatch = false;
            await new Promise(resolve => { app.releaseFixtureDispatch = resolve; });
          }
          return result;
        } : fn);
      ` });
      await page.locator("#main-content").waitFor();
      const frame = async (combat, seq) => assert.deepEqual(
        await app.evaluate(({ app }, [combat, seq]) => app.fixtureCombat(combat, seq), [combat, seq]),
        { seq, characterHash: 4242, combat }, "The worker sample must decode to the intended live frame");
      await frame(true, 6);
      await gate(true);
      assert.equal(await page.evaluate(() => backstage.fieldDispatchStartup()), null, "Main must defer during fresh combat");
      await noRecap();
      assert.equal(await fs.readFile(file, "utf8"), before);
      await updates();
      await opener().press("Enter");
      await shown().getByRole("heading", { name: "Dispatch history" }).waitFor();
      await page.keyboard.press("Escape");
      await shown().waitFor({ state: "hidden" });
      await page.evaluate(() => backstage.onLiveLink(status => { window.fixtureLive = status; }));
      await app.evaluate(({ app }) => { app.holdFixtureDispatch = true; });
      await frame(false, 7);
      await expectMain(() => app.evaluate(({ app }) => !!app.releaseFixtureDispatch));
      await frame(true, 7); // Same sequence, identity and worker signal as the held offer.
      assert.equal(await page.evaluate(() => backstage.fieldDispatchStartup()), null);
      await app.evaluate(({ app }) => app.releaseFixtureDispatch());
      const result = await page.waitForFunction(() => {
        if (document.querySelector("dialog.field-dispatch[open]")) return "stale recap opened";
        if (window.fixtureLive?.frame?.combat === true && window.fixtureLive.frame.seq === 7) return "combat delivered";
      });
      assert.equal(await result.jsonValue(), "combat delivered", "A held offer cannot open on same-sequence combat entry");
      await noRecap();
      assert.equal((await read(file)).pending.id, `stable:1.9.0..${version}`);
      // Keep verifying that repeated worker status can retire a stale frame, but
      // do it in the background so it cannot mask the same-sequence exit below.
      await gate(false);
      await app.evaluate(({ app }) => app.fixtureCombatExpires());
      await page.waitForFunction(() => window.fixtureLive?.signal === "nogame" && !window.fixtureLive.frame);
      await frame(true, 7);
      await page.waitForFunction(() => window.fixtureLive?.frame?.combat === true);
      await gate(true);
      assert.equal(await page.evaluate(() => backstage.fieldDispatchStartup()), null);
      await frame(false, 7);
      await shown().getByRole("heading", { name: `Updated from 1.9.0 to ${version}` }).waitFor();
      await close();
      console.log("Same-sequence combat blocked the held recap, not manual history; same-sequence combat exit resumed it");
    }
    if (run("reset")) {
      const file = await installed("reset", "1.9.0");
      const dir = path.dirname(file);
      const journalPath = path.join(dir, "state.json");
      const marker = path.join(dir, "field-dispatch.reset");
      const routeReview = path.join(dir, "route-review.json");
      const routeBytes = Buffer.from('{ "routes": {} }\n');
      await fs.writeFile(routeReview, routeBytes);
      await complete();
      await gate(true);
      await recorded(file, state => state.lastRun.version === "1.9.0");
      await close();
      const failUnlink = `
        const rm = fixtureFs.rmSync;
        fixtureFs.rmSync = (file, options) => {
          if (file === fixtureFile) {
            app.fixtureFailedUnlink = true;
            throw Object.assign(new Error('fixture unlink failure'), { code: 'EBUSY' });
          }
          return rm(file, options);
        };
      `;
      await installed("reset", version, { setup: failUnlink + `
        const rename = fixtureFs.renameSync;
        const marker = require('node:path').join(app.getPath('userData'), 'field-dispatch.reset');
        fixtureFs.renameSync = (from, to) => {
          if (to === marker && app.fixtureFailRetirement) {
            app.fixtureFailRetirement = false;
            throw Object.assign(new Error('fixture retirement promotion failure'), { code: 'EBUSY' });
          }
          return rename(from, to);
        };
        const GameSync = load('./src/core/game-sync.cjs').GameSync;
        const reset = GameSync.prototype.reset;
        GameSync.prototype.reset = function (...args) {
          app.fixtureGameReset = (app.fixtureGameReset || 0) + 1;
          return reset.apply(this, args);
        };
        electron.dialog.showMessageBox = async (_win, options) => {
          if (options.title !== 'Delete all local data?') throw Error('Unexpected dialog');
          return { response: app.fixtureConfirmReset ? 1 : 0 };
        };
      ` });
      await gate(true);
      await shown().getByRole("heading", { name: `Updated from 1.9.0 to ${version}` }).waitFor();
      await shown().getByRole("button", { name: "Not now" }).press("Enter");
      await shown().waitFor({ state: "hidden" });
      const old = await fs.readFile(file, "utf8");
      await page.locator('.secondary-navigation [data-nav="guide"]').press("Enter");
      assert.equal(await page.evaluate(() => backstage.resetData()), null);
      assert.equal(await fs.readFile(file, "utf8"), old);
      assert.equal(await page.evaluate(async () => (await backstage.bootstrap()).state.profiles[0]?.id), "Fixture");
      const journalBytes = await fs.readFile(journalPath);
      await app.evaluate(({ app }) => { app.fixtureConfirmReset = app.fixtureFailRetirement = true; });
      await page.locator('[data-command="reset"]').press("Enter");
      await page.locator('#toast.error').getByText('The action could not be completed. Check your input or file and try again.', { exact: true }).waitFor();
      assert.equal(await app.evaluate(({ app }) => app.fixtureFailRetirement), false, "The retirement promotion fault must fire");
      assert.equal(await app.evaluate(({ app }) => app.fixtureGameReset || 0), 0,
        "Failed retirement must not start resetting game state");
      assert.deepEqual(await fs.readFile(routeReview), routeBytes, "Failed retirement must preserve local route review bytes");
      assert.deepEqual(await fs.readFile(journalPath), journalBytes);
      assert.equal(await fs.readFile(file, "utf8"), old);
      await absent(marker);
      assert.deepEqual((await fs.readdir(dir)).filter(name => /^field-dispatch.*\.tmp$/.test(name)), []);

      // Retry the same action with only the failed promotion released; the old file stays locked.
      await page.locator('[data-command="reset"]').press("Enter");
      await expectMain(() => app.evaluate(({ app }) => !!app.fixtureFailedUnlink));
      const journal = await page.evaluate(async () => (await backstage.bootstrap()).state);
      assert.deepEqual(journal.profiles, []);
      assert.equal(journal.onboarded, false);
      await page.getByText("Local data and saved keys deleted.", { exact: true }).waitFor({ timeout: 2500 });
      await noRecap();
      await absent(routeReview);
      await cdp.detach();
      const child = app.process(), exited = once(child, "exit");
      // app.exit bypasses before-quit and its cleanup, without stranding Chromium subprocesses.
      await app.evaluate(({ app }) => { setTimeout(() => app.exit(23), 50); });
      assert.deepEqual(await exited, [23, null]);
      app = null;
      assert.equal(await fs.readFile(file, "utf8"), old, "The locked predecessor must survive forced exit");
      assert.equal(await fs.readFile(marker, "utf8"), "reset\n");
      await installed("reset", version, { legacy: false, setup: failUnlink });
      await gate(true);
      await page.locator('[data-command="setup-manual"]').press("Enter");
      await page.locator('.onboarding-form [data-command="setup-company"]').press("Enter");
      await page.locator("#main-content").waitFor();
      await recorded(file, state => state.lastRun.version === version && !state.pending && !state.acknowledged);
      await absent(marker);
      await noRecap();
      await updates();
      await opener().press("Enter");
      await shown().getByRole("heading", { name: "Dispatch history" }).waitFor();
      await close();
      console.log("Failed retirement preserved local data; retry succeeded with a locked predecessor and forced restart did not revive it");
    }
  };
  try {
    await reviewScenarios();
    if (cases.size) { assert.deepEqual(errors, []); return; }
    let file = await installed("fresh", version, { legacy: false });
    await gate(true);
    await page.locator('[data-command="setup-manual"]').press("Enter");
    await page.locator('.onboarding-form [data-command="setup-company"]').press("Enter");
    await recorded(file, state => state.lastRun.version === version && !state.pending);
    await noRecap();
    await close();
    console.log("Fresh installed startup finished setup without showing an upgrade");

    file = await installed("upgrade", "1.9.0");
    await gate(true);
    await page.locator('[data-command="setup-defer"]').waitFor();
    await absent(file); // setup has priority even when foreground
    await complete();
    await recorded(file, state => state.lastRun.version === "1.9.0" && !state.pending);
    await noRecap();
    await page.evaluate(() => localStorage.removeItem("bf-tour-v1"));
    await close();
    console.log("Existing legacy profile established 1.9.0 without claiming a predecessor");

    file = await installed("upgrade", version, { holdTour: true });
    await page.locator("#main-content").waitFor();
    await gate(false);
    assert.equal(await page.evaluate(() => backstage.fieldDispatchStartup()), null);
    await gate(true, false);
    assert.equal(await page.evaluate(() => backstage.fieldDispatchStartup()), null);
    assert.equal((await read(file)).lastRun.version, "1.9.0");
    await noRecap();
    await gate(true);
    await page.waitForTimeout(250); // Allow the foreground IPC round trip while the tour stays held.
    await noRecap();
    assert.equal((await read(file)).lastRun.version, "1.9.0");
    await app.evaluate(({ app }) => app.releaseFixtureTour());
    await page.locator('.bf-onboarding [data-ob="skip"]').press("Enter");
    await shown().getByRole("heading", { name: `Updated from 1.9.0 to ${version}` }).waitFor();
    const pending = (await read(file)).pending;
    assert.equal(pending.id, `stable:1.9.0..${version}`);
    assert.deepEqual(await shown().locator(".field-dispatch__version").allTextContents(), [`Version ${version}`, "Version 1.12.1", "Version 1.12.0", "Version 1.11.0", "Version 1.10.0"]);
    assert.equal(await shown().locator("#field-dispatch-title:focus").count(), 1);
    assert.equal(await page.evaluate(() => backstage.fieldDispatchAcknowledge("stable:1.10.0..1.11.0")), false);
    await checkLayout();
    const exact = await fs.readFile(file, "utf8");
    await shown().getByRole("button", { name: "Not now" }).press("Enter");
    await shown().waitFor({ state: "hidden" });
    await complete(); // reload cannot re-open a deferred recap during the same process
    await noRecap();
    await updates();
    await opener().press("Enter");
    await shown().getByRole("heading", { name: "Dispatch history" }).waitFor();
    const search = shown().getByRole("searchbox");
    await search.fill("1.9.0 dungeon badges");
    assert.equal(await shown().getByRole("heading", { name: "Version 1.9.0" }).count(), 1);
    await search.press("Escape");
    await shown().waitFor({ state: "hidden" });
    assert.equal(await opener().evaluate(node => node === document.activeElement), true);
    assert.equal(await fs.readFile(file, "utf8"), exact);
    await page.evaluate(() => localStorage.setItem("bf-lang-v1", "de"));
    await close();
    console.log("Upgrade was foreground-gated; deferral and Settings history kept exact pending bytes");

    file = await installed("upgrade", version);
    await gate(true);
    await shown().getByRole("heading", { name: `Von 1.9.0 auf ${version} aktualisiert` }).waitFor();
    const compact = await checkLayout("upgrade-compact-de.png");
    await shown().getByRole("button", { name: "Alle Änderungen anzeigen" }).press("Enter");
    await shown().getByRole("heading", { name: "Änderungsverlauf" }).waitFor();
    await shown().getByRole("searchbox", { name: "Änderungen suchen" }).fill("1.11.0 dungeon");
    await checkLayout("history-compact-de.png");
    await shown().getByRole("searchbox").press("Escape");
    await shown().waitFor({ state: "hidden" });
    assert.equal(await fs.readFile(file, "utf8"), exact);
    await close();
    console.log(`German compact recap and history fit at ${compact.join("×")}; Escape deferred`);

    file = await installed("upgrade", version);
    await gate(true);
    await shown().getByRole("button", { name: "Verstanden" }).press("Enter");
    await recorded(file, state => state.acknowledged?.id === pending.id && !state.pending);
    await close();
    file = await installed("upgrade", version);
    await gate(true);
    await page.locator("#main-content").waitFor();
    assert.deepEqual(await page.evaluate(() => backstage.fieldDispatchStartup()), { offer: null });
    await noRecap();
    await updates();
    await opener().press("Enter");
    await shown().getByRole("searchbox").fill("1.11.0 dungeon");
    await shown().getByRole("button", { name: "Begleiter öffnen" }).first().press("Enter");
    await page.locator('body[data-page="assistant"] #main-content:focus').waitFor();
    assert.equal((await read(file)).acknowledged.id, pending.id);
    await close();
    console.log("Acknowledgement persisted across restart; Settings action navigated and restored page focus");

    file = await installed("source", version, { source: true });
    await gate(true);
    await complete();
    await updates();
    await opener().press("Enter");
    await shown().getByRole("heading", { name: "Dispatch history" }).waitFor();
    await absent(file);
    await close();
    console.log("Source build opened bundled history without creating installed release state");
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
