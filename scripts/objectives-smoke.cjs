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
  const base = Date.now() - 60 * 60000;
  const stamp = new Date(base).toISOString();
  const captures = path.resolve(__dirname, "../.superpowers/sdd/daily-loop-captures");
  const saved = (id, name) => ({ id, name, realm: "Fixture", className: "Mage", level: 20, notes: "", goals: [], clientBuild: "1.15.2.12345", source: { kind: "wow-addon", id: `source-${id}`, updatedAt: stamp }, history: { recent: [], completedIdsKnown: true, completedIds: [] } });
  const alpha = { ...saved("alpha", "Aelora"), race: "Human", sex: "female", faction: "Alliance", location: { mapId: 1436, zone: "Westfall", x: 0.56, y: 0.47 }, progress: { current: 9500, max: 23200, rested: 1200 }, quests: [{ id: 666001, title: "Sample Delivery", complete: false, objectives: [{ text: "Collect the parcel", done: false }] }], readiness: { workshop: { professions: { observedAt: stamp, complete: false, items: [{ skillLineId: 171, professionId: 171, name: "Alchemy", rank: 75, maxRank: 150 }] } } } };
  let app;
  try {
    await fs.mkdir(captures, { recursive: true });
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
    await page.locator('.now-questlog [data-quest-open="666001"]').click();
    await page.getByRole("button", { name: "Pin quest objective" }).press("Enter");
    await objective().getByText("Sample Delivery", { exact: true }).waitFor();
    await objective().getByText("Collect the parcel", { exact: true }).waitFor();
    await objective().getByText(/Last character save: .*not live/).waitFor();
    const next = () => page.locator(".now-next");
    assert.equal(await next().count(), 1);
    assert.match(await next().innerText(), /Why this\? You pinned this objective\.[\s\S]*Character snapshot/);
    await next().getByRole("button", { name: "Not now" }).press("Enter");
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-now-next-heading"));
    await next().getByText("Sample Delivery", { exact: false }).waitFor({ state: "hidden" });
    await objective().getByText("Sample Delivery", { exact: true }).waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")).objectives[0].questId, 666001);
    await page.reload();
    await objective().getByRole("heading", { name: "Your objective" }).waitFor();
    await objective().getByRole("button", { name: "Resume quest" }).press("Enter");
    await page.locator(".quest-detail").getByRole("heading", { name: "Sample Delivery" }).waitFor();
    const pinned = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")).objectives;
    await page.clock.setFixedTime(base + 25 * 3600000);
    await nav("now");
    await objective().getByText(/Plan B:.*No supported next step/).waitFor();
    assert.equal(await objective().getByRole("button", { name: "Resume quest" }).count(), 0);
    await objective().getByRole("button", { name: "Review pinned quest" }).press("Enter");
    await page.locator(".quest-detail").getByRole("heading", { name: "Sample Delivery" }).waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")).objectives, pinned);
    await page.clock.setFixedTime(Date.now());
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
    const resume = objective().getByRole("button", { name: "Resume profession" });
    for (const [name, width, height] of [["desktop", 1500, 1000], ["compact", 1000, 760]]) {
      const outer = await app.evaluate(({ BrowserWindow }, [width, height]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(width, height); return win.getSize(); }, [width, height]);
      await page.waitForFunction(w => Math.abs(innerWidth - w) < 50, width);
      await page.locator(".now-session").waitFor();
      await page.locator('[data-page-hero="now"] img').first().evaluate(img => img.decode());
      const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
      const box = await resume.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= viewport[1], JSON.stringify({ box, viewport }));
      assert.ok(await page.locator(".now-page").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      const layout = await page.evaluate(() => {
        const action = document.querySelector(".now-next").getBoundingClientRect(), progress = document.querySelector(".now-session").getBoundingClientRect();
        return progress.top >= action.bottom ? "compact" : Math.abs(progress.top - action.top) < 1 && progress.left >= action.right ? "desktop" : "misaligned";
      });
      assert.equal(layout, name);
      await page.screenshot({ path: path.join(captures, `now-${name}.png`) });
      console.log(`${name}: outer ${outer.join("×")}, viewport ${viewport.join("×")}`);
    }
    await resume.press("Enter");
    await page.waitForFunction(() => document.querySelector('[aria-label="Owned profession"]')?.value === "171");
    await app.evaluate((_, at) => {
      const store = globalThis.objectiveFixtureStore, next = structuredClone(store.state);
      const p = next.profiles.find(p => p.id === "alpha"), professions = p.readiness.workshop.professions;
      p.source.updatedAt = professions.observedAt = at;
      professions.items[0].rank = 76;
      store.saveState(next);
    }, new Date(base + 15 * 60000).toISOString());
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
