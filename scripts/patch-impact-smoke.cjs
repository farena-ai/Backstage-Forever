"use strict";
const { _electron: electron } = require("playwright");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "bf-patch-impact-"));
  const stateFile = path.join(dir, "state.json"), supportFile = path.join(dir, "support.txt");
  let app;
  try {
    const repo = path.resolve(__dirname, "..");
    const mage = { id: "mage", name: "PrivateFixtureMage", className: "Mage", realm: "PrivateFixtureRealm", level: 23, race: "Human", faction: "Alliance", goals: [], notes: "", locale: "enUS",
      source: { kind: "wow-addon", id: "PrivateFixtureSource", updatedAt: new Date(Date.now() - 60000).toISOString() }, clientBuild: "1.60.1.70959",
      ledger: { schemaVersion: 1, bags: { seenAt: Math.floor(Date.now() / 1000) - 60, complete: true, items: [{ id: 2589, name: "Linen Cloth", n: 25, q: 1 }] } } };
    const prepare = async build => {
      const state = { ...defaultState(), onboarded: true, activeProfileId: mage.id, profiles: [{ ...mage, clientBuild: build }] };
      assert.equal(validateState(state).profiles[0].clientBuild, build);
      await fs.writeFile(stateFile, JSON.stringify(state));
    };
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-patch-fixture", version: "1.0.0", main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=()=>false; L.LiveBridge.prototype.start=()=>{};
      require('electron').clipboard.writeText=text=>require('node:fs').writeFileSync(${JSON.stringify(supportFile)},text);
      load('./src/main.cjs');
    `);
    const run = async (build, routeReviewed, mageReviewed) => {
      const unknown = build === undefined;
      await prepare(build);
      app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
      const page = await testWindow(app), errors = [];
      page.on("pageerror", err => errors.push(err.message));
      page.setDefaultTimeout(8000);
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(...w.getMinimumSize()); });
      await page.evaluate(unknown => {
        localStorage.setItem("bf-setup-v4", "complete");
        localStorage.setItem("bf-lang-v1", unknown ? "de" : "en");
      }, unknown);
      await page.reload();
      const open = async (group, subtab) => {
        await page.locator(`[data-shell-control="nav:${group}"]`).click();
        await page.locator(`[data-shell-control="subtab:${subtab}"]`).click();
      };
      await open("guide", "coverage");
      const patch = page.getByRole("region", { name: unknown ? "Auswirkungen des Patches" : "Patch impact" });
      if (unknown) await patch.locator("li").getByText("Gespeicherter Build unbekannt", { exact: true }).first().waitFor();
      else await patch.locator("p").first().getByText(build, { exact: true }).waitFor();
      const status = id => patch.locator(`[data-patch-capability="${id}"]`).getAttribute("data-patch-status");
      const expected = reviewed => unknown ? "unknown-build" : reviewed ? "reviewed" : "needs-review";
      assert.equal(await status("desktop-route"), expected(routeReviewed));
      for (const id of ["frost-mage-guide", "frost-mage-abilities"]) assert.equal(await status(id), expected(mageReviewed));
      if (unknown) assert.equal(await patch.locator("p").first().innerText(), "Gespeicherter Build unbekannt");
      await page.locator(".cov-summary").waitFor();
      const before = await fs.readFile(stateFile);
      const preview = await page.evaluate(() => window.backstage.diagnosticsPreview());
      assert.ok(preview.text.includes(`Patch impact (saved build): ${build ?? "unknown"}\n`));
      assert.ok(preview.text.includes(`desktop-route: ${expected(routeReviewed)}`));
      assert.doesNotMatch(preview.text, /PrivateFixture/);
      const community = await page.evaluate(() => window.backstage.communityReportPreview());
      assert.doesNotMatch(community.text, /Patch impact|desktop-route:/);
      await page.evaluate(id => window.backstage.copyDiagnostics(id), preview.id);
      assert.equal(await fs.readFile(supportFile, "utf8"), preview.text);
      assert.equal(await patch.evaluate(node => node.getBoundingClientRect().right <= innerWidth && node.scrollWidth <= node.clientWidth), true);
      await open("characters", "talents");
      if (mageReviewed) {
        const checklist = page.locator("[data-academy-rank]");
        for (const check of await checklist.all()) { await check.focus(); await page.keyboard.press("Space"); }
        await page.getByRole("heading", { name: "Opener" }).waitFor();
        await page.locator("[data-spellbook-review] summary").focus(); await page.keyboard.press("Enter");
        await page.getByLabel("Ice Lance (Rank 1) on an action bar?", { exact: true }).waitFor();
      } else {
        if (!unknown) await page.locator("[data-academy-dps]").getByText(/needs review/i).waitFor();
        assert.equal(await page.locator("[data-academy-rank], [data-spellbook-review]").count(), 0);
      }
      const route = await page.evaluate(id => window.backstage.guidedRoute({ profileId: id, skips: [] }), mage.id);
      assert.ok(route.coverage.length > 0, "static route coverage remains browseable");
      assert.equal(route.recovery.reason === "build", !routeReviewed);
      if (!routeReviewed) assert.deepEqual([route.recovery.map, route.recovery.fallback], [null, null]);
      await page.locator('[data-shell-control="nav:ledger"]').click();
      await page.locator('[data-ledger-search="items"]').waitFor();
      assert.deepEqual(await fs.readFile(stateFile), before, "patch status, hand checks and support preview do not write the journal");
      assert.deepEqual(errors, []);
      await app.close(); app = null;
    };
    await run("1.60.1.70888", true, false);
    await run("1.60.1.70960", false, false); // Only the previously reviewed desktop route retires.
    await run(undefined, false, false); // Missing addon-build evidence, with German UI.
    await run("1.60.1.70888", true, false);
    await run("1.60.1.70959", false, true);
    console.log("Patch impact: exact saved-build transition, scoped fallbacks, reactivation and unaffected coverage passed");
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
