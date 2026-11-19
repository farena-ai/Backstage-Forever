"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { version } = require("../package.json");

(async () => {
  const scratch = await fs.mkdtemp(path.join(process.env.BF_TEST_TMP || os.tmpdir(), "bf-dispatch-desktop-"));
  let app, page, cdp;
  const errors = [];
  const repo = path.resolve(__dirname, "..");
  const installed = async (name, running, { legacy = true, source = false, holdTour = false } = {}) => {
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
  try {
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
    assert.deepEqual(await shown().locator(".field-dispatch__version").allTextContents(), [`Version ${version}`, "Version 1.11.0", "Version 1.10.0"]);
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
    assert.deepEqual(errors, []);
    console.log("Source build opened bundled history without creating installed release state");
  } finally {
    if (app) await app.close();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
