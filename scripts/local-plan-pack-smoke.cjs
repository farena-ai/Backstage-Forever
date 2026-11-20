"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { launch, testWindow } = require("./test-window.cjs"), { navigate } = require("./player-navigation.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "bf-plan-ui-"));
  const dir = path.join(root, "profile"), journal = path.join(dir, "state.json"), store = path.join(dir, "local-plan-pack.json");
  const fixture = path.join(root, "deadmines.json");
  const plan = { format: "backstage-forever-plan-pack", version: 1, scope: "forever:deadmines:preparation", revision: 1, steps: ["repair-gear", "check-supplies"] };
  const first = JSON.stringify(plan, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const second = JSON.stringify({ ...plan, revision: 2, steps: ["confirm-roles"] });
  const errors = [];
  let app, page;
  const dialog = () => page.getByRole("dialog", { name: "Local plan pack" });
  const button = name => dialog().getByRole("button", { name, exact: true });
  const press = async name => { await button(name).focus(); await page.keyboard.press("Enter"); };
  const heading = name => dialog().getByRole("heading", { name, exact: true });
  const ipc = (...args) => page.evaluate(args => window.backstage.localPlanPack(...args), args);
  async function open() {
    app = await launch(electron, { args: [root], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    page = await testWindow(app); page.setDefaultTimeout(8000);
    page.on("pageerror", err => errors.push(err.message));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(984, 635); });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "guide");
    const opener = page.getByRole("button", { name: "Open local plan pack", exact: true });
    await opener.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector("[data-plan-preview]")?.disabled);
    await page.waitForFunction(() => innerWidth === 984 && innerHeight === 635);
  }
  try {
    await fs.mkdir(dir);
    const profile = { id: "mage", name: "PRIVATE_PLAN_FIXTURE", realm: "Fixture", className: "Mage", level: 20, notes: "PRIVATE_PLAN_NOTE", goals: [] };
    await fs.writeFile(journal, JSON.stringify(validateState({ ...defaultState(), onboarded: true, activeProfileId: profile.id, profiles: [profile] })));
    await fs.writeFile(fixture, first);
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "bf-plan-fixture", version: "1.0.0", main: "fixture.cjs" }));
    await fs.writeFile(path.join(root, "fixture.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, "../package.json"))});
      globalThis.fetch = async () => { throw Error('Network disabled in local plan fixture'); };
      load('./src/core/claude.cjs').status = async () => ({ available: false, connected: false });
      load('./src/core/claude.cjs').clearCredentials = async () => {};
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({ state: 'not-running', launchAvailable: false });
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({ available: false, recognizers: [], voices: [] });
      const Live = load('./src/core/live-bridge.cjs').LiveBridge;
      Live.prototype.readPreference = () => false; Live.prototype.start = () => {};
      require('electron').dialog.showMessageBox = async (_w, options) => ({ response: options.title === 'Delete all local data?' && globalThis.confirmPlanReset ? 1 : 0 });
      load('./src/main.cjs');
    `);
    await open();
    const journalBytes = await fs.readFile(journal);
    await heading("No active plan").waitFor();
    await dialog().locator('input[type=file]').setInputFiles(fixture);
    const proposed = heading("Proposed plan · revision 1");
    await proposed.waitFor();
    assert.equal(await proposed.evaluate(el => document.activeElement === el), true);
    assert.ok(await button("Import reviewed plan").evaluate(el => {
      const r = el.getBoundingClientRect(), d = el.closest("dialog").getBoundingClientRect();
      return d.top >= 0 && d.bottom <= innerHeight && r.top >= d.top && r.bottom <= d.bottom;
    }), "The modal and first confirmation fit on keyboard arrival before Tab scrolls the dialog");
    assert.deepEqual(await dialog().locator("[data-plan-review-steps] li").allTextContents(), [
      "Check durability and repair your gear before leaving.", "Check your consumables and free bag space.",
    ]);
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
    if (process.env.BF_PLAN_REVIEW_PNG) await page.screenshot({ path: process.env.BF_PLAN_REVIEW_PNG });
    await press("Cancel preview");
    assert.equal(await proposed.isVisible(), false);
    assert.equal(await dialog().getByLabel(/Preview a local JSON file/).evaluate(el => document.activeElement === el), true,
      "Cancelling a file review returns keyboard focus to the file picker");
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
    await dialog().locator('input[type=file]').setInputFiles(fixture);
    await proposed.waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await button("Cancel preview").evaluate(el => document.activeElement === el), true);
    await page.keyboard.press("Tab");
    assert.equal(await button("Import reviewed plan").evaluate(el => {
      const r = el.getBoundingClientRect(), d = el.closest("dialog").getBoundingClientRect();
      return document.activeElement === el && el.matches(":focus-visible") && r.top >= d.top && r.bottom <= d.bottom && d.right <= innerWidth;
    }), true);
    await page.keyboard.press("Enter");
    await heading("Active plan · revision 1").waitFor();
    assert.equal(JSON.parse(await fs.readFile(store, "utf8")).active, first);
    const textarea = dialog().locator("textarea");
    const insert = async text => { await textarea.focus(); await page.keyboard.insertText(text); };
    const exactLimit = second.padEnd(4096, " ");
    await insert(exactLimit);
    await press("Preview import");
    await heading("Proposed plan · revision 2").waitFor();
    await press("Import reviewed plan");
    await heading("Active plan · revision 2").waitFor();
    const bytes = await fs.readFile(store);
    assert.deepEqual(JSON.parse(bytes), { active: exactLimit, previous: first });
    const next = JSON.stringify({ ...plan, revision: 3 });
    const oversized = next.padEnd(4096, " ") + "not JSON";
    const utf8Oversized = next.padEnd(4094, " ") + "€";
    assert.equal(Buffer.byteLength(oversized), 4104);
    assert.equal(Buffer.byteLength(utf8Oversized), 4097);
    assert.ok(utf8Oversized.length < 4096);
    await assert.rejects(() => ipc("preview", oversized), /4 KiB/);
    for (const input of [oversized, utf8Oversized]) {
      await textarea.fill(next);
      await press("Preview import");
      const proposedNext = heading("Proposed plan · revision 3");
      await proposedNext.waitFor();
      const pending = await ipc("preview", next);
      await textarea.selectText();
      await insert(input);
      await press("Preview import");
      await dialog().getByRole("status").getByText("Plan pack exceeds the 4 KiB limit.").waitFor();
      assert.equal(await textarea.inputValue(), input, "The native editor must not truncate the rejected input");
      assert.equal(await proposedNext.isVisible(), false);
      assert.equal(await button("Import reviewed plan").isVisible(), false);
      await assert.rejects(() => ipc("apply", pending.token), /no longer current/i);
      assert.deepEqual(await fs.readFile(store), bytes);
      assert.deepEqual(await fs.readFile(journal), journalBytes);
      await assert.rejects(fs.stat(store + ".tmp"), { code: "ENOENT" });
    }
    await dialog().locator("textarea").fill(JSON.stringify({ ...plan, version: 2, revision: 3 }));
    await press("Preview import");
    await dialog().getByRole("status").getByText("Plan pack format or version is not supported.").waitFor();
    assert.deepEqual(await fs.readFile(store), bytes);
    assert.deepEqual(await fs.readFile(journal), journalBytes);
    await app.close(); app = null;

    await open();
    await heading("Active plan · revision 2").waitFor();
    await press("Preview previous plan");
    await heading("Previous plan · revision 1").waitFor();
    await press("Cancel preview");
    assert.equal(await button("Preview previous plan").evaluate(el => document.activeElement === el), true);
    await press("Preview previous plan");
    await heading("Previous plan · revision 1").waitFor();
    assert.deepEqual(await fs.readFile(store), bytes);
    await press("Restore previous plan");
    await heading("Active plan · revision 1").waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(store, "utf8")), { active: first, previous: null });
    assert.deepEqual(await fs.readFile(journal), journalBytes);
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-open-local-plan-pack"));
    const pending = await ipc("preview", second);
    assert.equal(await page.evaluate(() => window.backstage.resetData()), null);
    assert.equal(JSON.parse(await fs.readFile(store, "utf8")).active, first);
    await app.evaluate(() => { globalThis.confirmPlanReset = true; });
    await page.evaluate(() => window.backstage.resetData());
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
    await assert.rejects(() => ipc("apply", pending.token), /no longer current/i);
    assert.deepEqual(errors, []);
    console.log("Local plan pack Electron smoke passed: file/paste preview, keyboard confirmation, exact bytes, rejection, restart rollback and reset.");
  } finally {
    try { await app?.close(); } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
