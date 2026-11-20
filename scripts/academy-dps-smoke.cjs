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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
    page.setDefaultTimeout(8000);
    await page.waitForFunction(() => innerWidth === 984 && innerHeight === 635);
    await page.locator('[data-shell-control="nav:characters"]').click();
    const entry = page.locator('[data-shell-control="subtab:talents"]');
    await entry.focus();
    await page.keyboard.press("Enter");
    const card = page.locator("[data-academy-dps]");
    const first = card.getByLabel("Frostbolt, Rank 4");
    const second = card.getByLabel("Ice Lance, Rank 1");
    const opener = card.getByRole("heading", { name: "Opener", exact: true });
    const template = card.getByText("Just learned this?", { exact: true });
    const placement = card.getByLabel("Ice Lance (Rank 1) on an action bar?", { exact: true });
    const binding = card.getByLabel("A key bound to the Ice Lance slot?");
    const readout = card.locator("[data-spellbook-readout]");
    const initial = await fs.readFile(stateFile, "utf8");
    const storage = () => page.evaluate(() => JSON.stringify(localStorage));
    const initialStorage = await storage();
    assert.equal(await template.count(), 0);
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
    const focusFailures = [];
    const checkFocus = async (control, arrival) => {
      const result = await control.evaluate(node => {
        const style = getComputedStyle(node);
        const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map((v, i) => {
          const c = Number(v) / 255;
          return [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        }).reduce((a, b) => a + b);
        const colors = [style.outlineColor, getComputedStyle(node.closest("[data-academy-dps]")).backgroundColor].map(luminance);
        const contrast = (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
        const width = parseFloat(style.outlineWidth), outset = Math.max(0, width + parseFloat(style.outlineOffset));
        const rect = node.getBoundingClientRect();
        const ring = [rect.left - outset, rect.top - outset, rect.right + outset, rect.bottom + outset];
        const clip = [0, 0, innerWidth, innerHeight];
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const { overflowX, overflowY } = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          const x = bounds.left + parent.clientLeft, y = bounds.top + parent.clientTop;
          if (overflowX !== "visible") { clip[0] = Math.max(clip[0], x); clip[2] = Math.min(clip[2], x + parent.clientWidth); }
          if (overflowY !== "visible") { clip[1] = Math.max(clip[1], y); clip[3] = Math.min(clip[3], y + parent.clientHeight); }
        }
        return {
          visible: node === document.activeElement && node.matches(":focus-visible") && style.outlineStyle !== "none" && width > 0,
          contrast, ring, clip
        };
      });
      const { visible, contrast, ring, clip } = result;
      if (!visible || contrast < 3 || ring.some((edge, i) => i < 2 ? edge < clip[i] : edge > clip[i])) {
        focusFailures.push({ arrival, ...result });
      }
    };
    await page.keyboard.press("Tab");
    await checkFocus(template, "forward to disclosure");
    await page.keyboard.press("Enter");
    await placement.waitFor();
    assert.match(await card.locator("[data-spellbook-review]").innerText(), /Ice Lance · Rank 1 \(spell 1312002\) · learned rank self-reported/);
    assert.match(await readout.innerText(), /Action bar: unknown.*Keybind: unknown/s);
    await page.keyboard.press("Tab");
    await checkFocus(placement, "forward to placement");
    await page.keyboard.press("End");
    assert.match(await readout.innerText(), /Action bar: not placed \(self-reported\).*Keybind: unknown/s);
    await page.keyboard.press("ArrowUp");
    assert.match(await readout.innerText(), /Action bar: placed \(self-reported\).*Keybind: unknown/s);
    await page.keyboard.press("Tab");
    await checkFocus(binding, "forward to binding");
    await page.keyboard.press("End");
    assert.match(await readout.innerText(), /Keybind: no key bound \(self-reported\)/);
    await page.keyboard.press("ArrowUp");
    assert.match(await readout.innerText(), /Keybind: key bound \(self-reported\)/);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await checkFocus(binding, "reverse to binding");
    await page.keyboard.press("Shift+Tab");
    await checkFocus(placement, "reverse to placement");
    await page.keyboard.press("Shift+Tab");
    await checkFocus(template, "reverse to disclosure");
    assert.deepEqual(focusFailures, [], "Spellbook focus rings must have at least 3:1 contrast and fit inside the scrollport");
    await placement.selectOption("unknown");
    assert.match(await readout.innerText(), /Action bar: unknown.*Keybind: unknown/s);
    assert.equal(await binding.inputValue(), "unknown");
    assert.ok(await binding.isDisabled());
    await placement.selectOption("yes");
    await binding.selectOption("yes");
    assert.ok(await card.evaluate(node => node.getBoundingClientRect().right <= innerWidth && node.scrollWidth <= node.clientWidth));
    assert.equal(await fs.readFile(stateFile, "utf8"), initial);
    assert.equal(await storage(), initialStorage);
    if (process.env.BF_ACADEMY_PNG) await card.screenshot({ path: process.env.BF_ACADEMY_PNG });
    await second.focus();
    await page.keyboard.press("Space");
    assert.equal(await template.count(), 0);
    await page.keyboard.press("Space");
    await template.focus();
    await page.keyboard.press("Enter");
    assert.match(await readout.innerText(), /Action bar: unknown.*Keybind: unknown/s);
    await placement.selectOption("yes");
    await binding.selectOption("yes");
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
    assert.equal(await readout.count(), 0);
    assert.equal(await fs.readFile(stateFile, "utf8"), initial);
    await app.evaluate(() => globalThis.releaseAcademyPicker());
    await card.getByText(/No recommendations/).waitFor();
    assert.equal(await opener.count(), 0);
    assert.equal(await first.count(), 0);
    await picker.selectOption("academy-mage");
    await first.waitFor();
    assert.equal(await first.isChecked(), false);
    assert.equal(await opener.count(), 0);
    assert.equal(await template.count(), 0);
    await first.check();
    await second.check();
    await template.focus();
    await page.keyboard.press("Enter");
    assert.match(await readout.innerText(), /Action bar: unknown.*Keybind: unknown/s);
    assert.deepEqual(errors, []);
    console.log("PASS desktop Academy DPS and Spellbook: exact rank gates, keyboard review, unknown/self-reported states, no persistence, held character switch and clean return");
  } finally {
    try { await app?.close(); } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
