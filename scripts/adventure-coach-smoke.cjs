"use strict";
const { _electron: electron } = require("playwright");
const { navigate } = require("./player-navigation.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs"),
  { testWindow } = require("./test-window.cjs"),
  { assertSelectContrast } = require("./select-contrast.cjs");
(async () => {
  const dir = await fs.mkdtemp(
      path.join(await fs.realpath(os.tmpdir()), "forever-coach-"),
    ),
    repo = path.resolve(__dirname, ".."),
    captures = path.join(
      repo,
      ".superpowers/sdd/proactive-compass-captures",
      new Date().toISOString().replace(/[:.]/g, "-"),
    );
  let app, page;
  const watchdog = setTimeout(() => {
    console.error("Coach fixture timeout");
    app?.process().kill();
    process.exitCode = 1;
  }, 120000);
  try {
    await fs.mkdir(path.join(dir, "updates"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "updates/preferences.json"),
      JSON.stringify({ automatic: false, installOnQuit: false }),
    );
    await fs.mkdir(path.join(dir, "knowledge-v1"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "knowledge-v1/preferences.json"),
      JSON.stringify({ automatic: false, checked: {} }),
    );
    const at = new Date().toISOString(),
      col = (items) => ({ observedAt: at, complete: true, items });
    const profiles = ["Alliance", "Horde"].map((faction, i) => ({
      id: `p${i}`,
      name: i ? "Vaelric" : "Aeralyn",
      realm: "Synthetic",
      className: i ? "Mage" : "Hunter",
      faction,
      level: 18,
      notes: "PRIVATE_NOTES",
      goals: [],
      clientBuild: "1.60.1.70862",
      source: { kind: "wow-addon", id: `PRIVATE_SOURCE_${i}`, updatedAt: at },
      location: { mapId: 1413, zone: "Forest" },
      quests: [
        {
          id: 42 + i,
          title: i ? "Horde trail" : "Return the scout",
          complete: !i,
          objectives: [{ text: "Observed objective", done: !i }],
        },
      ],
      readiness: {
        bags: { free: 5, total: 16 },
        workshop: {
          professions: col([
            {
              skillLineId: 171,
              professionId: 4,
              name: "Alchemy",
              rank: 75,
              maxRank: 75,
            },
          ]),
          recipes: col([
            {
              id: 100,
              skillLineId: 171,
              name: "Amber restorative",
              canSkillUp: true,
              reagentsKnown: true,
              reagents: [{ itemId: 200, required: 2 }],
            },
          ]),
          materials: { ...col([{ itemId: 200, count: 3 }]), scope: "bags-0-4" },
        },
      },
    }));
    await fs.writeFile(
      path.join(dir, "state.json"),
      JSON.stringify({
        ...defaultState(),
        onboarded: true,
        followGameCharacter: false,
        profiles,
        activeProfileId: "p0",
      }),
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "synthetic-coach",
        version: "0.12.3",
        main: "fixture.cjs",
      }),
    );
    await fs.writeFile(
      path.join(dir, "fixture.cjs"),
      `const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});globalThis.coachFixture={providers:0,keys:0,game:0,external:0};load('./src/core/catalog-cache.cjs').CatalogCache.prototype.get=async()=>({models:[],source:'synthetic'});load('./src/core/model-catalog.cjs').listModels=async()=>({models:[]});load('./src/core/claude.cjs').status=async()=>({installed:false,loggedIn:false});load('./src/core/providers.cjs').ask=async()=>{coachFixture.providers++;throw Error('No providers');};const originalSave=load('./src/core/store.cjs').Store.prototype.saveState;load('./src/core/store.cjs').Store.prototype.saveState=function(...args){coachFixture.store=this;return originalSave.apply(this,args);};load('./src/core/store.cjs').Store.prototype.getKey=function(){coachFixture.keys++;return '';};load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});load('./src/core/game-runtime.cjs').GameRuntime.prototype.launch=async()=>{coachFixture.game++;throw Error('No game');};load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});load('./src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});load('electron').clipboard.writeText=()=>{coachFixture.external++;};load('electron').shell.openExternal=async()=>{coachFixture.external++;};load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};load('./src/core/updater.cjs').Updater.prototype.start=function(){};load('./src/main.cjs');`,
    );
    app = await electron.launch({
      args: [dir],
      env: { ...process.env, BF_USER_DATA: dir },
      timeout: 20000,
    });
    page = await testWindow(app);
    page.setDefaultTimeout(6000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "adventure");
    await page.locator("[data-adventure-coach]").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Return the scout"),
    );
    assert.equal(
      await page.locator("[data-director]").isVisible(),
      false,
      "Detailed quest Director starts folded beneath the proactive choice",
    );
    await page.locator("[data-coach-action]").click();
    await page.locator("[data-director-primary]").waitFor();
    await page
      .locator('[data-player-tool="coach-quest-plan"] > summary')
      .click();
    assert.equal(await page.locator("[data-director]").isVisible(), false);
    await page.evaluate(() => render());
    assert.equal(
      await page.locator("[data-director]").isVisible(),
      false,
      "Explicit folded state survives refresh",
    );
    await page.evaluate(() => document.querySelector(".main")?.scrollTo(0, 0));
    await fs.mkdir(captures, { recursive: true });
    const files = [];
    const shot = async (name) => {
      files.push(name + ".png");
      await page.evaluate(() => {
        scrollTo(0, 0);
        document.querySelector(".main")?.scrollTo(0, 0);
      });
      await page.screenshot({ path: path.join(captures, name + ".png") });
    };
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1456, 1025),
    );
    await shot("alliance-full");
    const mode = page.locator("[data-coach-mode]");
    await mode.selectOption("professions");
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Amber restorative"),
    );
    assert.match(
      await page.locator("[data-adventure-coach]").innerText(),
      /not guaranteed/,
    );
    await mode.focus();
    await mode.evaluate((n) => (window.coachSelect = n));
    await page.evaluate(() => render());
    assert.ok(
      await mode.evaluate(
        (n) => n === window.coachSelect && n === document.activeElement,
      ),
      "Mode node/focus survives ordinary refresh",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    await page.evaluate(() => document.querySelector(".main")?.scrollTo(0, 0));
    assert.ok(
      await page.locator("[data-coach-action]").evaluate((n) => {
        const r = n.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
      "Coach action is in 984x635 first viewport",
    );
    await assertSelectContrast(page, "Coach compact");
    await shot("alliance-compact");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2),
    );
    await page.waitForTimeout(150);
    await shot("alliance-200-reduced");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
    );
    // Hold actual main-owned results to prove mode, profile and navigation retirement.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("backstage:adventureCoach");
      ipcMain.removeHandler("backstage:adventureCoach");
      coachFixture.waiters = [];
      coachFixture.hold = true;
      ipcMain.handle("backstage:adventureCoach", async (...args) => {
        const result = await original(...args);
        if (coachFixture.hold)
          await new Promise((r) => coachFixture.waiters.push(r));
        return result;
      });
    });
    await mode.selectOption("questing");
    await page.waitForTimeout(100);
    await mode.selectOption("professions");
    await app.evaluate(() => {
      coachFixture.hold = false;
      for (const f of coachFixture.waiters.splice(0)) f();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Amber restorative"),
    );
    await app.evaluate(() => {
      coachFixture.hold = true;
    });
    await mode.selectOption("adventure");
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await app.evaluate(() => {
      coachFixture.hold = false;
      for (const f of coachFixture.waiters.splice(0)) f();
    });
    assert.equal(await page.locator("[data-adventure-coach]").count(), 0);
    await page.evaluate(async () => {
      await persist(editedState((s) => (s.activeProfileId = "p1")));
      page = "adventure";
      render();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Amber restorative"),
    );
    await shot("horde-compact");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1456, 1025),
    );
    await shot("horde-full");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2),
    );
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await shot("horde-200-reduced");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
    );
    await app.evaluate(() => {
      coachFixture.hold = true;
    });
    await mode.selectOption("questing");
    await page.waitForTimeout(100);
    await page.evaluate(async () => {
      await persist(editedState((s) => (s.activeProfileId = "p0")));
      render();
    });
    await app.evaluate(() => {
      coachFixture.hold = false;
      for (const f of coachFixture.waiters.splice(0)) f();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Return the scout"),
    );
    assert.doesNotMatch(
      await page.locator("[data-coach-primary]").innerText(),
      /Horde trail/,
    );
    await app.evaluate(() => {
      coachFixture.hold = true;
    });
    await mode.selectOption("professions");
    await page.waitForTimeout(100);
    // A genuine main-owned replacement source invalidates its earlier saved recommendation.
    await app.evaluate(() => {
      const next = structuredClone(coachFixture.store.state),
        p = next.profiles.find((p) => p.id === next.activeProfileId);
      p.source.id = "NEW_PRIVATE_SOURCE";
      p.source.updatedAt = new Date().toISOString();
      p.readiness.bags.free = 1;
      coachFixture.store.saveState(next);
      coachFixture.hold = false;
    });
    await page.evaluate(async () => {
      state = (await api.bootstrap()).state;
      render();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Make room"),
    );
    await app.evaluate(() => {
      for (const f of coachFixture.waiters.splice(0)) f();
    });
    await page.waitForTimeout(100);
    assert.match(
      await page.locator("[data-coach-primary]").innerText(),
      /Make room/,
    );
    assert.doesNotMatch(
      await page.locator("[data-adventure-coach]").innerText(),
      /PRIVATE_/,
    );

    await mode.selectOption("adventure");
    await app.evaluate(() => {
      const next = structuredClone(coachFixture.store.state),
        p = next.profiles.find((p) => p.id === next.activeProfileId);
      p.readiness.bags.free = 5;
      p.quests = [
        {
          id: 42,
          title: "Unknown local objective",
          zone: "Forest",
          complete: false,
          objectives: [{ text: "   ", done: false }],
        },
      ];
      p.source.updatedAt = new Date().toISOString();
      coachFixture.store.saveState(next);
    });
    await page.evaluate(async () => {
      state = (await api.bootstrap()).state;
      render();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Amber restorative"),
    );
    await shot("review-blank-objective");
    await app.evaluate(() => {
      const next = structuredClone(coachFixture.store.state),
        p = next.profiles.find((p) => p.id === next.activeProfileId);
      p.quests[0].destination = { mapId: 1413, x: 0.2, y: 0.3 };
      p.source.updatedAt = new Date().toISOString();
      coachFixture.store.saveState(next);
    });
    await page.evaluate(async () => {
      state = (await api.bootstrap()).state;
      render();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Unknown local objective"),
    );
    await shot("review-valid-marker");
    await app.evaluate(() => {
      const next = structuredClone(coachFixture.store.state),
        p = next.profiles.find((p) => p.id === next.activeProfileId);
      p.quests = Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        title: i === 3 ? "Known local task" : `Blank local ${i + 1}`,
        level: 12,
        zone: "Forest",
        complete: false,
        objectives: [{ text: i === 3 ? "Find the scout" : "   ", done: false }],
      }));
      p.readiness.workshop.recipes.complete = false;
      p.source.updatedAt = new Date().toISOString();
      coachFixture.store.saveState(next);
    });
    await page.evaluate(async () => {
      state = (await api.bootstrap()).state;
      render();
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-coach-primary]")
        ?.textContent.includes("Known local task"),
    );
    assert.match(
      await page.locator(".coach-alternatives").innerText(),
      /Amber restorative/,
    );
    assert.equal(await page.locator("[data-director]").isVisible(), false);
    await shot("review-fourth-local-quest");

    assert.ok(
      await page.evaluate(() =>
        [...document.images].every((i) => i.complete && i.naturalWidth > 0),
      ),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button")
        .count(),
      8,
    );
    assert.deepEqual(
      await app.evaluate(() => ({
        providers: coachFixture.providers,
        keys: coachFixture.keys,
        game: coachFixture.game,
        external: coachFixture.external,
      })),
      { providers: 0, keys: 0, game: 0, external: 0 },
    );
    await fs.writeFile(
      path.join(captures, "manifest.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          synthetic: true,
          sourceVersion: "0.12.3",
          inClient: false,
          files,
          checks: [
            "policy main-owned DTO",
            "both factions",
            "mode node focus",
            "late mode/navigation/profile/source",
            "984x635 first action",
            "200% reduced motion",
            "no broken assets/overflow",
            "no providers/keys/game/external actions",
            "folded Director and explicit reveal",
            "blank local objective and valid current marker",
            "fourth meaningful local quest survives three blank candidates",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: synthetic proactive coach Electron, modes, stale responses, both factions, compact/200%, bounded public advice; captures " +
        captures,
    );
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close();
    const cleanup = await fs.realpath(dir);
    assert.equal(
      path.dirname(cleanup).toLowerCase(),
      (await fs.realpath(os.tmpdir())).toLowerCase(),
    );
    assert.ok(path.basename(cleanup).startsWith("forever-coach-"));
    await fs.rm(cleanup, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
