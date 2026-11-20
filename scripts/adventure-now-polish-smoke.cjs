"use strict";
// Usage: node scripts/adventure-now-polish-smoke.cjs OUTDIR [--baseline]
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { _electron } = require("playwright");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { launch, testWindow } = require("./test-window.cjs");

async function main() {
  assert.ok(process.argv[2], "Provide a screenshot output directory");
  const out = path.resolve(process.argv[2]);
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-adventure-now-"));
  const repo = path.resolve(__dirname, "..");
  const facts = [], errors = [];
  let app;
  try {
    await fs.mkdir(out, { recursive: true });
    const profile = { id: "fixture", name: "Adventure Fixture", className: "Hunter", race: "Tauren", faction: "Horde", realm: "Synthetic", level: 15, notes: "", goals: [], clientBuild: "1.60.1.70862", source: { kind: "wow-addon", id: "fixture-source", updatedAt: "2023-11-15T00:00:00.000Z" }, location: { zone: "The Barrens", mapId: 1413, x: .52, y: .29 }, quests: [{ id: 96, title: "Call of Water", complete: true, objectives: [] }, { id: 5728, title: "Hidden Enemies", complete: false, objectives: [] }], journal: { levels: [{ level: 14, at: 1700003600, played: 33000 }, { level: 15, at: 1700009000, played: 38400 }], zones: [1411, 1413], played: 39000 } };
    const manual = { id: "manual", name: "Manual Fixture", realm: "Synthetic", className: "Mage", level: 15, goals: [], notes: "" };
    const state = validateState({ ...defaultState(), onboarded: true, followGameCharacter: false, activeProfileId: profile.id, profiles: [profile, manual] });
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-adventure-now-proof", version: require("../package.json").version, main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/catalog-cache.cjs').CatalogCache.prototype.get=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      load('./src/core/live-bridge.cjs').LiveBridge.prototype.start=function(){};
      load('./src/core/live-bridge.cjs').LiveBridge.prototype.readPreference=function(){return false;};
      load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
      load('./src/core/updater.cjs').Updater.prototype.start=function(){};
      load('./src/main.cjs');`);
    app = await launch(_electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(8500);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const go = async (route, parent = route) => {
      await page.locator(`.rail [data-nav="${parent}"]`).click();
      if (parent !== route) await page.locator(`nav [data-nav="${route}"]`).click();
      await page.waitForFunction(route => page === route, route);
    };
    const bounds = (selector) => page.locator(selector).first().evaluate((e) => {
      const r = e.getBoundingClientRect(), m = document.querySelector(".main").getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), focused: document.activeElement === e,
        visible: r.top >= Math.max(0, m.top) && r.bottom <= Math.min(innerHeight, m.bottom) && r.left >= 0 && r.right <= innerWidth };
    });
    for (const lang of ["en", "de"]) {
      await page.evaluate((lang) => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); localStorage.setItem("bf-lang-v1", lang); }, lang);
      await page.reload();
      await page.waitForFunction(lang => document.documentElement.lang === lang, lang);
      for (const [size, dimensions] of [["normal", [1440, 940]], ["compact", [1000, 700]]]) {
        const native = await app.evaluate(({ BrowserWindow }, dimensions) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(...dimensions); return { outer: w.getSize(), content: w.getContentSize() }; }, dimensions);
        await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, native.content);
        const prefix = `${lang}-${size}`, row = { lang, size, ...native };
        await go("now");
        const next = '.now-next [data-quest-open="96"]';
        await page.locator(next).waitFor();
        await page.locator(".now-zonecard").waitFor();
        row.next = await bounds(next);
        row.more = await bounds(".now-followups > summary");
        await shot(`${prefix}-now`);
        await page.locator(next).press("Enter");
        await page.locator('[data-quest-control="detail:96"]').waitFor();
        row.quest = { focused: await page.locator('[data-quest-control="detail:96"]').evaluate(e => document.activeElement === e), firstAction: await bounds('[data-quest-control="detail:96"] [data-objective-change]') };
        await shot(`${prefix}-now-to-quest`);
        // Back to the real home rail; use a goal-bearing map link for this exact quest.
        await go("now");
        await page.locator('.now-next [data-now-map]').press("Enter");
        const mapAction = '[data-wm-goal] [data-quest-open="96"]';
        await page.locator(mapAction).waitFor();
        row.map = await bounds(mapAction);
        await shot(`${prefix}-now-to-map`);
        if (row.map.focused) {
          // Real keyboard arrival, without Playwright focusing or scrolling the target for us.
          await page.keyboard.press("Tab");
          assert.ok((await bounds('[data-wm-goal] [data-wm-act="unfocus"]')).focused);
          await page.keyboard.press("Shift+Tab");
          assert.ok((await bounds(mapAction)).focused);
          await page.keyboard.press("Enter");
          await page.locator('[data-quest-control="detail:96"]:focus').waitFor();
        }
        for (const [route, root] of [["adventure", "[data-coach-action]"], ["guided-route", "[data-gr-recovery]"], ["dungeons", "[data-atlas-card]"], ["practice-lab", "[data-practice-lab]"]]) {
          await go(route, "adventure");
          // Capture only after a mounted view. Root names are also checked by the individual feature smokes.
          await page.waitForFunction(selector => Boolean(document.querySelector(selector)), root);
          await shot(`${prefix}-${route}`);
        }
        const picker = page.locator("#active-character");
        await picker.selectOption("manual");
        await page.waitForFunction(() => document.querySelector("#active-character")?.value === "manual" && state?.profiles?.find(p => p.id === "manual") && state.activeProfileId === "manual");
        await go("now");
        await page.locator(".now-next .now-train").waitFor();
        assert.equal(await page.locator('.now-next [data-quest-open="96"]').count(), 0);
        await shot(`${prefix}-now-missing`);
        await picker.selectOption("fixture");
        await page.waitForFunction(() => state?.activeProfileId === "fixture");
        facts.push(row);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await fs.writeFile(path.join(out, "facts.json"), JSON.stringify({ facts, errors }, null, 2));
    await app?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
  if (!process.argv.includes("--baseline")) {
    const failures = [];
    for (const row of facts) {
      const label = `${row.lang}/${row.size}`;
      if (!row.next.visible || !row.more.visible) failures.push(`${label}: next quest and alternatives must fit without scrolling`);
      if (!row.quest.focused || !row.quest.firstAction.visible) failures.push(`${label}: quest arrival must focus the detail and expose the first action`);
      if (!row.map?.visible || !row.map.focused) failures.push(`${label}: map arrival must focus the exact quest action in view`);
    }
    assert.deepEqual(failures, []);
  }
  console.log(JSON.stringify(facts));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
