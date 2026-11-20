"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { _electron: electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.BF_SMOKE_TMPDIR || process.env.TMPDIR || os.tmpdir(), "bf-academy-dps-"));
  let app;
  try {
    const profile = (id, name, clientBuild) => ({ id, name, clientBuild, className: "Mage", level: 24, realm: "Synthetic", notes: "", goals: [], source: { kind: "wow-addon", id, updatedAt: new Date().toISOString() } });
    const state = validateState({ ...defaultState(), onboarded: true, activeProfileId: "academy-mage", profiles: [profile("academy-mage", "Frost Fixture", "1.60.1.70959"), profile("other-mage", "Wrong Build", "1.60.1.70888")] });
    const stateFile = path.join(dir, "state.json");
    await fs.writeFile(stateFile, JSON.stringify(state));
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 25000 });
    await app.evaluate(async ({ app, session }, userData) => {
      if (app.getPath("userData") !== userData) throw Error("Unexpected test profile");
      const ready = app.whenReady();
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      await ready;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, done) => done({ cancel: true }));
    }, dir);
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    page.setDefaultTimeout(8000);
    await page.locator('[data-shell-control="nav:characters"]').click();
    const entry = page.locator('[data-shell-control="subtab:talents"]');
    await entry.focus();
    await page.keyboard.press("Enter");
    const card = page.locator("[data-academy-dps]");
    const first = card.getByLabel("Frostbolt, Rank 4");
    const second = card.getByLabel("Ice Lance, Rank 1");
    const opener = card.getByRole("heading", { name: "Opener", exact: true });
    const initial = await fs.readFile(stateFile, "utf8");
    await first.focus();
    await page.keyboard.press("Space");
    assert.equal(await opener.count(), 0);
    await page.keyboard.press("Tab");
    assert.ok(await second.evaluate(node => node === document.activeElement));
    await page.keyboard.press("Space");
    await opener.waitFor();
    const evidence = card.getByText("Evidence and limits", { exact: true });
    await evidence.click();
    assert.match(await card.innerText(), /7322[\s\S]*1312002[\s\S]*19 Nov 2026/);
    for (const control of [card.locator("label").first(), evidence]) {
      assert.ok(await control.evaluate(node => {
        const luminance = value => value.match(/\d+/g).slice(0, 3).map((v, i) => {
          const c = Number(v) / 255;
          return [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        }).reduce((a, b) => a + b);
        const values = [getComputedStyle(node).color, getComputedStyle(node.closest("[data-academy-dps]")).backgroundColor].map(luminance);
        return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05) >= 4.5;
      }), "Interactive text should have at least 4.5:1 contrast against the card");
    }
    assert.ok(await card.evaluate(node => node.getBoundingClientRect().right <= innerWidth));
    assert.equal(await fs.readFile(stateFile, "utf8"), initial);
    if (process.env.BF_ACADEMY_PNG) await card.screenshot({ path: process.env.BF_ACADEMY_PNG });
    const picker = page.getByLabel("Active character");
    await app.evaluate(({ ipcMain }) => {
      const channel = "backstage:saveState", save = ipcMain._invokeHandlers.get(channel);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, save);
        await new Promise(resolve => { globalThis.releaseAcademyPicker = resolve; });
        return save(...args);
      });
    });
    await picker.selectOption("other-mage");
    await opener.waitFor({ state: "detached" });
    await app.evaluate(() => globalThis.releaseAcademyPicker());
    await card.getByText(/No recommendations/).waitFor();
    assert.equal(await opener.count(), 0);
    assert.equal(await first.count(), 0);
    await picker.selectOption("academy-mage");
    await first.waitFor();
    assert.equal(await first.isChecked(), false);
    assert.equal(await opener.count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS desktop Academy DPS: offline, exact rank checks via keyboard, sources, private temporary result, wrong-build switch and clean return");
  } finally {
    try { await app?.close(); } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
