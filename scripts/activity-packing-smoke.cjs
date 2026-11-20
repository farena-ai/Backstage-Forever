"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { _electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");

(async () => {
  const output = path.resolve(process.argv[2] || process.env.TMPDIR || require("node:os").tmpdir());
  await fs.mkdir(output, { recursive: true });
  const data = await fs.mkdtemp(path.join(output, "bf-raid-packing-"));
  let app;
  try {
    const at = Math.floor(Date.now() / 1000) - 2;
    const id = "Player-Veteran", alt = "Player-Alt";
    const row = (id, name) => ({ id, name, realm: "Synthetic", className: "Mage", faction: "Alliance", level: 60, updatedAt: at, clientBuild: "1.60.1.70862" });
    const stored = { seenAt: at, complete: true, items: [{ id: 13446, n: 99 }] };
    const exportData = { schema: 1, observedAt: at, activeId: id, characters: [
      { ...row(id, "Veteran"), readiness: { bags: { free: 0, total: 40 }, equipment: [{ slot: 1, itemId: 9 }] }, ledger: { bags: { seenAt: at - 86400 + 10, complete: true, items: {} }, bank: stored, mail: stored } },
      { ...row(alt, "Alt"), ledger: { bank: stored } },
    ] };
    const parsed = parseSavedVariables("BackstageForeverExport = " + JSON.stringify(JSON.stringify(exportData)));
    const initial = validateState({ ...mergeSnapshot(defaultState(), parsed), onboarded: true, followGameCharacter: false });
    const statePath = path.join(data, "state.json");
    await fs.writeFile(statePath, JSON.stringify(initial));
    app = await launch(_electron, { args: [await syntheticLaunch(data)], env: { ...process.env, BF_USER_DATA: data, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await page.evaluate(() => {
      localStorage.setItem("bf-setup-v4", "complete");
      localStorage.setItem("bf-share-character", "false");
    });
    await page.reload();
    await page.getByRole("heading", { name: "Veteran", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    const state = () => page.evaluate(async () => (await window.backstage.bootstrap()).state);
    const prefs = () => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => /share|consent/i.test(key)).sort()));
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setSize(1000, 700);
    });
    await page.waitForFunction(() => innerWidth <= 1000);
    await page.clock.setFixedTime(new Date(at * 1000));
    await navigate(page, "preparation");
    const panel = page.locator("[data-activity-packing]"), summary = panel.locator("summary");
    const before = await state(), beforePrefs = await prefs(), beforeBytes = await fs.readFile(statePath);
    await summary.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("[data-activity-packing]")?.open);
    assert.ok(await summary.evaluate(n => n === document.activeElement));
    assert.match(await panel.innerText(), /Saved evidence for Veteran/);
    assert.match(await panel.innerText(), /0 \/ 40 slots free/);
    assert.match(await panel.innerText(), /Known empty carried scan · 0 Major Healing Potions/);
    assert.doesNotMatch(await panel.innerText(), /Older than 24 hours/);
    await page.clock.setFixedTime(new Date((at + 11) * 1000));
    await panel.getByText(/Older than 24 hours/).waitFor();
    assert.ok(await panel.evaluate(n => n.open && n.querySelector("summary") === document.activeElement));
    assert.match(await panel.locator("li").first().innerText(), /Bag-space observation time unknown/);
    assert.match(await panel.innerText(), /Durability unknown/);
    assert.doesNotMatch(await panel.innerText(), /99 Major Healing Potions/);
    assert.ok(await panel.evaluate(n => n.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth));
    await panel.evaluate(n => n.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(output, "live-p03-raid-packing-compact.png") });
    assert.deepEqual(await state(), before);
    assert.deepEqual(await fs.readFile(statePath), beforeBytes);
    assert.equal(await prefs(), beforePrefs);
    const altId = initial.profiles.find(p => p.name === "Alt").id;
    await app.evaluate(({ ipcMain }) => {
      const channel = "backstage:saveState", save = ipcMain._invokeHandlers.get(channel);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        await new Promise(resolve => { globalThis.releasePackingPicker = resolve; });
        return save(...args);
      });
    });
    await page.getByLabel("Active character", { exact: true }).selectOption(altId);
    await panel.waitFor({ state: "detached" });
    assert.equal((await state()).activeProfileId, before.activeProfileId);
    await app.evaluate(async () => {
      const end = Date.now() + 5000;
      while (!globalThis.releasePackingPicker && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
      globalThis.releasePackingPicker();
    });
    await panel.getByText("Alt", { exact: true }).waitFor({ state: "attached" });
    assert.equal(await panel.evaluate(n => n.open), false);
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-activity-packing]")?.open);
    assert.match(await panel.innerText(), /Bag space unknown/);
    assert.match(await panel.innerText(), /Potion count unknown · no usable saved carried scan/);
    assert.doesNotMatch(await panel.innerText(), /Veteran|Known empty carried scan|99 Major Healing Potions/);
    const after = await state();
    assert.equal(after.activeProfileId, altId);
    assert.deepEqual(after.profiles, before.profiles);
    assert.deepEqual(after.provider, before.provider);
    assert.deepEqual(after.journeys, before.journeys);
    assert.equal(await prefs(), beforePrefs);
    assert.deepEqual(errors, []);
    console.log("Raid packing smoke PASS: keyboard disclosure, compact layout, dated empty vs unknown, character isolation and no state or consent write from packing");
  } finally {
    try { await app?.close(); } finally { await fs.rm(data, { recursive: true, force: true, maxRetries: 5 }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
