"use strict";
// Run with node scripts/objectives-smoke.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "bf-objectives-ui-"));
  const stamp = "2026-11-10T12:00:00.000Z";
  const saved = (id, name) => ({ id, name, realm: "Fixture", className: "Mage", level: 20, notes: "", goals: [], clientBuild: "1.15.2.12345", source: { kind: "wow-addon", id: `source-${id}`, updatedAt: stamp }, history: { recent: [], completedIdsKnown: true, completedIds: [] } });
  const alpha = { ...saved("alpha", "Aelora"), quests: [{ id: 666001, title: "Sample Delivery", complete: false, objectives: [{ text: "Collect the parcel", done: false }] }], readiness: { workshop: { professions: { observedAt: stamp, complete: false, items: [{ skillLineId: 171, professionId: 171, name: "Alchemy", rank: 75, maxRank: 150 }] } } } };
  let app;
  try {
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(validateState({ ...defaultState(), onboarded: true, activeProfileId: "alpha", profiles: [alpha, saved("beta", "Bellan")] })));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "objectives-fixture", version: require("../package.json").version, main: "main.cjs" }));
    await fs.writeFile(path.join(dir, "main.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, "../package.json"))});
      load('./src/core/model-catalog.cjs').listModels = async () => ({models:[], source:'fixture'});
      load('./src/core/claude.cjs').status = async () => ({available:false, connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe = async () => ({state:'not-running', launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities = async () => ({available:false, recognizers:[], voices:[]});
      const L = load('./src/core/live-bridge.cjs').LiveBridge;
      L.prototype.readPreference = () => false; L.prototype.start = () => {};
      const S = load('./src/core/store.cjs').Store, start = S.prototype.startRecovery;
      S.prototype.startRecovery = function () { globalThis.objectiveFixtureStore = this; return start.call(this); };
      load('./src/main.cjs');
    `);
    const errors = [];
    async function open() {
      app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
      const page = await testWindow(app);
      page.on("pageerror", e => errors.push(e.message));
      page.setDefaultTimeout(7000);
      return page;
    }
    let page = await open();
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); });
    await page.reload();
    const nav = name => page.locator(`[data-nav="${name}"]:visible`).first().click();
    const objective = () => page.locator("[data-now-objective]");
    await objective().getByRole("heading", { name: "Your objective" }).waitFor();
    await page.locator('[data-now] [data-quest-open="666001"]').first().click();
    await page.getByRole("button", { name: "Pin quest objective" }).press("Enter");
    await objective().getByText("Sample Delivery", { exact: true }).waitFor();
    await objective().getByText("Collect the parcel", { exact: true }).waitFor();
    await objective().getByRole("button", { name: "Resume quest" }).press("Enter");
    await page.locator(".quest-detail").getByRole("heading", { name: "Sample Delivery" }).waitFor();
    await nav("adventure");
    await nav("preparation");
    await page.getByRole("button", { name: "Replace pinned objective" }).press("Enter");
    await page.getByRole("button", { name: "Keep current objective" }).press("Enter");
    await page.getByRole("button", { name: "Replace pinned objective" }).press("Enter");
    await page.getByRole("button", { name: "Confirm replacement" }).press("Enter");
    await objective().getByText("Alchemy · Rank 76", { exact: true }).waitFor();
    await page.locator("#active-character").selectOption("beta");
    await objective().getByText(/No objective pinned/).waitFor();
    await page.locator("#active-character").selectOption("alpha");
    await objective().getByText("Alchemy · Rank 76", { exact: true }).waitFor();
    await app.close(); app = null;
    page = await open();
    await objective().getByText("Alchemy · Rank 76", { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(1000, 760); });
    await page.waitForFunction(() => innerWidth <= 1000);
    console.log(`Compact renderer: ${await page.evaluate(() => `${innerWidth}×${innerHeight}`)}`);
    assert.ok(await objective().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const resume = objective().getByRole("button", { name: "Resume profession" });
    const box = await resume.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= await page.evaluate(() => innerHeight));
    await resume.press("Enter");
    await page.waitForFunction(() => document.querySelector('[aria-label="Owned profession"]')?.value === "171");
    await app.evaluate(() => {
      const store = globalThis.objectiveFixtureStore, next = structuredClone(store.state);
      const p = next.profiles.find(p => p.id === "alpha"), professions = p.readiness.workshop.professions;
      p.source.updatedAt = professions.observedAt = "2026-11-10T12:15:00.000Z";
      professions.items[0].rank = 76;
      store.saveState(next);
    });
    await nav("now");
    await objective().getByText(/Completed from a saved profession rank/).waitFor();
    await objective().getByRole("button", { name: "Clear objective" }).press("Enter");
    await objective().getByText(/No objective pinned/).waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")).objectives, []);
    assert.deepEqual(errors, []);
    console.log("Desktop objectives smoke passed");
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
