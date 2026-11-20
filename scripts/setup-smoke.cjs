"use strict";
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const releaseVersion = require("../package.json").version;
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const macSavedOnly = process.argv.includes("--mac-saved-only");
const liveBaseline = process.argv.includes("--live-baseline");
const baseline = liveBaseline && require("./live-baseline.cjs");
(async () => {
  const scratch = process.env.TMPDIR || os.tmpdir();
  const data = await fs.realpath(await fs.mkdtemp(path.join(scratch, "bf-setup-")));
  const repo=path.resolve(__dirname,'..'), captures=path.join(repo,'.superpowers/sdd/native-setup-captures',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(captures,{recursive:true});
  let app;
  try {
    const game = path.join(data, "synthetic-client"),
      exportFile = path.join(
        game,
        "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua",
      );
    await fs.mkdir(path.dirname(exportFile), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    for(const [folder,preferences] of [['updates',{automatic:false,installOnQuit:false}],['knowledge-v1',{automatic:false,checked:{}}]]){
      await fs.mkdir(path.join(data,folder),{recursive:true});await fs.writeFile(path.join(data,folder,'preferences.json'),JSON.stringify(preferences));
    }
    await fs.mkdir(path.join(data, "community"));
    await fs.writeFile(path.join(data, "community", "settings.json"), JSON.stringify({ share: false, download: false }));
    const livePreference = macSavedOnly || liveBaseline ? '{ "enabled": true }\n' : '{"enabled":false}';
    const pref = path.join(data, "live-link.json");
    await fs.writeFile(pref, livePreference);
    await fs.writeFile(path.join(data,'package.json'),JSON.stringify({name:'synthetic-native-map-setup',version:releaseVersion,main:'entry.cjs'}));
    await fs.writeFile(path.join(data, "entry.cjs"), `
      const load = require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      const live = load('./src/core/live-bridge.cjs');
      ${liveBaseline ? `require(${JSON.stringify(require.resolve("./live-baseline.cjs"))}).installWorker(live, ${macSavedOnly});` : `live.LiveBridge = class FixtureBridge extends live.LiveBridge {
        constructor(options) {
          super({ ...options, ${macSavedOnly ? 'platform: "darwin",' : ''} spawn: () => {
            throw Error('Capture is forbidden in the saved setup fixture');
          } });
        }
      };`}
      require('./fixture.cjs');
    `);
    await fs.writeFile(path.join(data,'fixture.cjs'),`const load=require('node:module').createRequire(${JSON.stringify(path.join(repo,'package.json'))});globalThis.mapSetup={providers:0,keys:0,game:0,external:0};load('./src/core/catalog-cache.cjs').CatalogCache.prototype.get=async()=>({models:[],source:'synthetic'});load('./src/core/model-catalog.cjs').listModels=async()=>({models:[]});load('./src/core/claude.cjs').status=async()=>({installed:false,loggedIn:false});load('./src/core/providers.cjs').ask=async()=>{mapSetup.providers++;throw Error('No provider');};load('./src/core/store.cjs').Store.prototype.getKey=function(){mapSetup.keys++;return '';};load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});load('./src/core/game-runtime.cjs').GameRuntime.prototype.launch=async()=>{mapSetup.game++;throw Error('No game');};load('./src/core/game-sync.cjs').GameSync.prototype.discover=async()=>[{id:'synthetic',label:'Synthetic Forever',path:${JSON.stringify(game)}}];load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});load('./src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});load('electron').clipboard.writeText=()=>{mapSetup.external++;};load('electron').shell.openExternal=async()=>{mapSetup.external++;};load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};load('./src/core/updater.cjs').Updater.prototype.start=function(){};load('./src/main.cjs');`);
    const open = () => launchElectron(electron, {
      args: [data],
      env: { ...process.env, BF_USER_DATA: data, ...(liveBaseline ? { BF_TEST_INACTIVE: "1" } : {}) },
      timeout: 20000,
    });
    app = await open();
    const page = await testWindow(app);
    const cspErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /Content Security Policy|Refused to/.test(message.text())
      )
        cspErrors.push(message.text());
    });
    await app.evaluate(({ app, dialog }, {root,repo}) => {
      const p = process.getBuiltinModule("node:path"),
        r = process
          .getBuiltinModule("node:module")
          .createRequire(p.join(repo, "package.json"));
      r("./src/core/game-sync.cjs").GameSync.prototype.discover =
        async () => [{ id: "synthetic", label: "Synthetic Forever", path: root }];
      r("./src/core/game-runtime.cjs").GameRuntime.prototype.probe =
        async () => ({ state: "unknown", checkedAt: null, launchAvailable: false });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, {root:game,repo});
    await page
      .getByRole("heading", { name: "A companion for the road ahead.", exact: true })
      .waitFor({ timeout: 10000 });
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
    await page.waitForFunction(()=>innerWidth<=1000);
    const actionBounds = await page
      .getByRole("button", { name: "Start my adventure", exact: true })
      .boundingBox();
    assert.ok(
      actionBounds.y + actionBounds.height <=
        (await page.evaluate(() => innerHeight)),
      "Primary setup action is visible without scrolling",
    );
    await page
      .getByRole("button", { name: "Start my adventure", exact: true })
      .click();
    await page.locator("[data-now]").waitFor();
    await navigate(page, "adventure");
    await page
      .getByRole("heading", { name: "Your adventure starts in the world.", exact: true })
      .waitFor();
    for (const name of [
      "BackstageForever.toc",
      "BackstageForeverReference.lua",
      "BackstageForeverPlan.lua",
      "BackstageForeverCoach.lua",
    "BackstageForeverAcquisition.lua",
    "BackstageForeverProfession.lua",
    "BackstageForeverGathering.lua",
    "BackstageForeverMapPlan.lua",
    "BackstageForeverMap.lua",
    "BackstageForeverMap.xml",
      "BackstageForever.lua",
      "BackstageForeverHUD.lua",
    ])
      assert.equal(
        await fs.readFile(
          path.join(game, "Interface/AddOns/BackstageForever", name),
          "utf8",
        ),
        await fs.readFile(path.join(__dirname, "../addon/BackstageForever", name), "utf8"),
      );
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedGatheringSchema,null);
    await page.screenshot({path:path.join(captures,'setup-files-prepared.png'),fullPage:true});
    const now = liveBaseline ? baseline.SAVED_AT : Math.floor(Date.now() / 1000);
    const shot = {
      schema: 1,
      activeId: "Player-Synthetic",
      observedAt: now,
      characters: [
        {
          id: "Player-Synthetic",
          name: "Compass Hero",
          realm: "Synthetic Realm",
          className: "Hunter",
          level: 18,
          faction: "Alliance",
          updatedAt: now,
          captureVersion:releaseVersion,clientBuild:'1.60.1.70888',
          gathering:{schemaVersion:1,status:'unavailable',recording:false,observedAt:now,limited:false,totalRecords:0,records:[]},
          location: liveBaseline ? { zone: "Durotar", subZone: "", mapId: 1411, x: 0.42, y: 0.68 } : { zone: "Synthetic Forest", subZone: "Camp" },
          progress: { current: 250, max: 1000 },
          quests: [
            {
              id: 123,
              title: "Synthetic rescue",
              level: 17,
              zone: "Synthetic Forest",
              complete: true,
              objectives: [{ text: "Find the lost scout", done: true }],
            },
          ],
        },
      ],
    };
    await fs.writeFile(
      exportFile,
      "BackstageForeverExport = " + JSON.stringify(JSON.stringify(shot)),
    );
    if (liveBaseline) {
      await baseline.check({ page, app, macSavedOnly, pref, livePreference });
      await app.close(); app = null;
      // Restart with no source available: a fresh import cannot stand in for a journal read.
      await fs.unlink(exportFile);
      app = await open();
      await baseline.checkReopen({ page: await testWindow(app), app, macSavedOnly, pref, livePreference });
      assert.deepEqual(cspErrors, []);
      console.log(`PASS LIVE-T01: ${macSavedOnly ? "simulated darwin saved-only" : "synthetic worker live → stale → reconnect → window loss"}, disconnected dated journal and offline action after restart.`);
      return;
    }
    await page
      .getByRole("heading", { name: "Compass Hero", exact: true })
      .waitFor();
    await page.getByText("Synthetic rescue", { exact: true }).first().waitFor();
    // The saved quest reaches Adventure; the saved experience (250 / 1000) shows on Now's XP bar.
    await navigate(page, "adventure");
    assert.match(await page.locator(".adventure-page .ph-sub").innerText(), /Level 18 Hunter.*1 of 1 quest ready to hand in/);
    await page.locator('[data-nav="now"]').first().click();
    await page.getByRole("img", { name: "25% through level 18" }).waitFor();
    assert.match(await page.locator(".now-xp-line").innerText(), /25%.*level 18/);
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedGatheringSchema,1);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).version,releaseVersion);
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedCaptureVersion,releaseVersion);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.profiles[0].gathering.status,'unavailable');
    await page.screenshot({path:path.join(captures,'setup-new-format-saved-character.png'),fullPage:true});
    if (macSavedOnly) {
      await navigate(page, "game");
      await page.getByText(/Saved-only:.*Screen Recording is not needed/).waitFor({ timeout: 5000 });
      assert.equal(await page.locator("#live-link-toggle").isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.backstage.setLiveLink(true)), {
        enabled: false, signal: "unsupported", frame: null, strip: null, last: null,
      });
      assert.equal(await fs.readFile(pref, "utf8"), livePreference);
      const before = (await page.evaluate(() => window.backstage.bootstrap())).state.profiles[0];
      await page.screenshot({ path: path.join(captures, "mac-saved-only-settings.png"), fullPage: true });
      await app.close(); app = null;
      // Remove the input before restart so an import cannot masquerade as durable journal state.
      await fs.unlink(exportFile);
      app = await launchElectron(electron, { args: [data], env: { ...process.env, BF_USER_DATA: data } });
      const reopened = await testWindow(app);
      const after = (await reopened.evaluate(() => window.backstage.bootstrap())).state.profiles[0];
      assert.equal(after.id, before.id);
      assert.equal(after.name, "Compass Hero");
      assert.equal(after.level, 18);
      assert.equal(await fs.readFile(pref, "utf8"), livePreference);
      assert.deepEqual(cspErrors, []);
      console.log("PASS: synthetic darwin bridge, real Electron saved setup/import and journal restart, hidden capture control, unchanged preference.");
      return;
    }
    for (const section of ["Adventure", "Characters", "AI Companion", "Game Connection", "Connections", "Field Guide", "Updates"]) {
      await navigate(page, section);
      assert.equal(await page.locator(".companion-dock").count(), 0,
        `Successful setup must not show a repeated banner on ${section}`);
    }
    // Adventure's "Explain my plan" opens an editable companion question about the saved quest; nothing is sent.
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await page
      .getByRole("button", { name: "Explain my plan", exact: true })
      .click();
    assert.match(await page.getByLabel("Your question").inputValue(), /Synthetic rescue/);
    assert.equal(await page.locator(".message.user").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      true,
    );
    await navigate(page, "game");
    await page
      .getByRole("button", { name: "Set up my companion", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your companion is prepared", exact: true })
      .waitFor();
    const otherGame = path.join(data, "another-client");
    await fs.mkdir(path.join(otherGame, "WTF", "Account"), { recursive: true });
    await fs.writeFile(path.join(otherGame, ".flavor.info"), "wowf");
    await page.evaluate(
      (root) => window.backstage.connectGame(root),
      otherGame,
    );
    await page
      .getByRole("heading", { name: "Your companion is prepared", exact: true })
      .waitFor({ timeout: 10000 });
    assert.equal(
      (await page.evaluate(() => window.backstage.bootstrap())).state.profiles
        .length,
      1,
    );
    assert.deepEqual(cspErrors, []);
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedGatheringSchema,null);
    const counters=await app.evaluate(()=>mapSetup);assert.deepEqual(counters,{providers:0,keys:0,game:0,external:0});
    await fs.writeFile(path.join(captures,'manifest.json'),JSON.stringify({kind:'synthetic-source-setup-only',version:releaseVersion,files:12,receipt:'null before valid save, 1 for schema, null after source replacement',liveClientCertified:false,counters},null,2));
    console.log(
      "PASS: first-run single-install preparation, exact sixteen-file readback and connected schema receipt, no-snapshot entry, auto-import, quest/XP briefing, explicit AI drafting, reduced motion and reopenable setup.",
    );
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(await fs.realpath(data)),await fs.realpath(scratch));
    assert.ok(path.basename(data).startsWith('bf-setup-'));
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
