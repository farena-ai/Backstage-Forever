"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { _electron: electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.BF_SMOKE_TMPDIR || process.env.TMPDIR || os.tmpdir(), "bf-practice-desktop-"));
  let app;
  try {
    const fixture = JSON.stringify(validateState({ ...defaultState(), onboarded: true }));
    await fs.writeFile(path.join(dir, "state.json"), fixture);
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 25000 });
    await app.evaluate(async ({ app, BrowserWindow, session }, dir) => {
      const ready = app.whenReady();
      if (app.getPath("userData") !== dir) throw Error("Unexpected test profile");
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      await ready;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, done) => done({ cancel: true }));
    }, dir);
    const page = await testWindow(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    const press = async locator => { await locator.focus(); await page.keyboard.press("Enter"); };
    const focused = locator => page.waitForFunction(selector => document.querySelector(selector) === document.activeElement, locator);
    const inView = locator => locator.evaluate(node => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    });
    await press(page.locator('[data-shell-control="nav:adventure"]'));
    const entry = page.locator('[data-shell-control="subtab:practice-lab"]');
    await entry.waitFor();
    await press(entry);
    const lab = page.locator("[data-practice-lab]");
    const picker = lab.getByLabel("Choose a drill");
    const tip = lab.getByRole("region", { name: "Simulated result" });
    await focused("#practice-lab-title");
    assert.equal(await entry.getAttribute("aria-current"), "page");
    assert.match(await lab.innerText(), /Class & Role Academy[\s\S]*no live game data/i);
    assert.equal(await page.locator("#active-character option").innerText(), "No characters yet");
    assert.ok(await inView(picker), "The first control fits the compact viewport on keyboard arrival");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press("Tab");
    await focused("#drill-picker");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Attack before the signal");
    await page.keyboard.press("Space");
    await focused("#result-title");
    assert.match(await tip.innerText(), /before the rest of the group is ready/);
    assert.equal(await tip.getByText("One thing to practice:", { exact: true }).count(), 1);
    if (process.env.BF_PRACTICE_DESKTOP_PNG) await page.screenshot({ path: process.env.BF_PRACTICE_DESKTOP_PNG });
    await page.evaluate(() => render()); // Exercise the real shell repaint while a result is focused.
    await focused("#result-title");
    assert.match(await tip.innerText(), /before the rest of the group is ready/);
    await page.keyboard.press("Tab");
    await focused("#drill-retry");
    assert.ok(await inView(lab.getByRole("button", { name: "Retry drill" })));
    await page.keyboard.press("Enter");
    assert.equal(await tip.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Attack before the signal");
    for (const [id, label, feedback] of [
      ["resource", "Spend 3 energy now", /cannot afford/],
      ["defensive", "Use the guard on the beat the hit lands", /guard is active/],
      ["triage", "Heal the ally about to take the hit", /10% health/],
    ]) {
      await picker.selectOption(id);
      assert.equal(await tip.isVisible(), false);
      await press(lab.getByRole("button", { name: label, exact: true }));
      assert.match(await tip.innerText(), feedback);
    }
    for (const [id, pack] of [
      ["tank-first-pull", require("../src/renderer/academy-tank-pack.js")],
      ["healer-mana-triage", require("../src/renderer/academy-healer-pack.js")],
    ]) {
      await picker.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(value => document.querySelector('#drill-picker').value === value, id);
      const lesson = lab.getByRole("region", { name: pack.lesson.title });
      assert.deepEqual(await lesson.locator('p').allTextContents(), Object.values(pack.lesson).slice(1));
      assert.equal(await lab.getByText('Simulated scenario', { exact: true }).isVisible(), true);
      if (process.env.BF_PRACTICE_SCREENSHOTS) {
        await lesson.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.screenshot({ path: path.join(process.env.BF_PRACTICE_SCREENSHOTS, `${id}-electron.png`) });
      }
      for (const option of pack.drill.options) {
        await press(lab.getByRole("button", { name: option.label, exact: true }));
        await focused("#result-title");
        assert.equal(await tip.locator('#result-feedback').innerText(), option.feedback);
        assert.equal(await tip.locator('#result-improvement span').innerText(), pack.drill.improvement);
        await page.evaluate(() => render());
        await focused("#result-title");
        await page.keyboard.press("Tab");
        await focused("#drill-retry");
        assert.ok(await inView(lab.getByRole("button", { name: "Retry drill" })));
        await page.keyboard.press("Space");
        assert.equal(await tip.isVisible(), false);
        await focused(`#practice-action-${pack.drill.options[0].id}`);
      }
    }
    await picker.focus();
    await page.keyboard.press('Home');
    assert.equal(await lab.locator('#drill-lesson').isVisible(), false);
    assert.equal(await lab.locator('#drill-lesson').innerText(), '');
    const back = '[data-shell-control="subtab:adventure"]';
    await press(page.locator(back));
    await lab.waitFor({ state: "detached" });
    await focused(back);
    await press(entry);
    await focused("#practice-lab-title");
    assert.equal(await picker.inputValue(), "opener");
    assert.equal(await tip.isVisible(), false);
    assert.equal(await fs.readFile(path.join(dir, "state.json"), "utf8"), fixture);
    assert.deepEqual(errors, []);
    console.log("PASS desktop Practice Lab: offline/no character, compact viewport, keyboard entry/answer/retry/back, six drills (all nine W4 branches), repaint focus, fresh re-entry and unchanged journal");
  } finally {
    try { await app?.close(); } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
