"use strict";
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const releaseVersion = require("../package.json").version;
const { testWindow } = require("./test-window.cjs");
(async () => {
  const data = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bf-setup-")));
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
    await fs.writeFile(path.join(data,'package.json'),JSON.stringify({name:'synthetic-native-map-setup',version:releaseVersion,main:'fixture.cjs'}));
    await fs.writeFile(path.join(data,'fixture.cjs'),`const load=require('node:module').createRequire(${JSON.stringify(path.join(repo,'package.json'))});globalThis.mapSetup={providers:0,keys:0,game:0,external:0};load('./src/core/catalog-cache.cjs').CatalogCache.prototype.get=async()=>({models:[],source:'synthetic'});load('./src/core/model-catalog.cjs').listModels=async()=>({models:[]});load('./src/core/claude.cjs').status=async()=>({installed:false,loggedIn:false});load('./src/core/providers.cjs').ask=async()=>{mapSetup.providers++;throw Error('No provider');};load('./src/core/store.cjs').Store.prototype.getKey=function(){mapSetup.keys++;return '';};load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});load('./src/core/game-runtime.cjs').GameRuntime.prototype.launch=async()=>{mapSetup.game++;throw Error('No game');};load('./src/core/game-sync.cjs').GameSync.prototype.discover=async()=>[{id:'synthetic',label:'Synthetic Forever',path:${JSON.stringify(game)}}];load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});load('./src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});load('electron').clipboard.writeText=()=>{mapSetup.external++;};load('electron').shell.openExternal=async()=>{mapSetup.external++;};load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};load('./src/core/updater.cjs').Updater.prototype.start=function(){};load('./src/main.cjs');`);
    app = await electron.launch({
      args: [data],
      env: { ...process.env, BF_USER_DATA: data },
    });
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
    const now = Math.floor(Date.now() / 1000);
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
          location: { zone: "Synthetic Forest", subZone: "Camp" },
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
    await page
      .getByRole("heading", { name: "Compass Hero", exact: true })
      .waitFor();
    await page.getByText("Synthetic rescue", { exact: true }).first().waitFor();
    assert.match(await page.locator(".adventure-brief").innerText(), /25%/);
    assert.equal(
      await page
        .getByRole("progressbar", { name: "Level experience" })
        .evaluate((node) => node.value),
      25,
    );
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedGatheringSchema,1);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).version,releaseVersion);
    assert.equal((await page.evaluate(()=>window.backstage.gameStatus())).loadedCaptureVersion,releaseVersion);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.profiles[0].gathering.status,'unavailable');
    await page.screenshot({path:path.join(captures,'setup-new-format-saved-character.png'),fullPage:true});
    for (const section of ["Adventure", "Characters", "AI Companion", "Game Connection", "Connections", "Field Guide", "Updates"]) {
      await navigate(page, section);
      assert.equal(await page.locator(".companion-dock").count(), 0,
        `Successful setup must not show a repeated banner on ${section}`);
    }
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await page
      .getByRole("button", { name: "Plan my next quest", exact: true })
      .click();
    assert.match(await page.getByLabel("Your question").inputValue(), /quest/i);
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
    assert.equal(path.dirname(await fs.realpath(data)),await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(data).startsWith('bf-setup-'));
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
