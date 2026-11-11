"use strict";
const { navigate, ensureCompanionTools } = require("./player-navigation.cjs");
// Real main/preload/renderer, isolated synthetic journals and validated reference fixtures.
const { _electron: electron } = require("playwright"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs"),
  { testWindow } = require("./test-window.cjs"),
  {
    selectCurrentText,
    currentControlState,
  } = require("./selection-fixture.cjs");
const repo = path.resolve(__dirname, ".."),
  { fixture, commit, build } = require("../tests/fixtures/insights.cjs"),
  { normalizeInsights } = require("../src/core/insights-data.cjs");
(async () => {
  const dir = await fs.mkdtemp(
      path.join(await fs.realpath(os.tmpdir()), "bf-insights-ui-"),
    ),
    evidence = path.join(repo, "work/insights-ui");
  let app,
    page,
    checks = 0;
  const check = async (name, fn) => {
    if (
      process.argv.includes("--primary-reference-gate") &&
      !name.startsWith("primary reference")
    )
      return;
    await fn();
    checks++;
    console.log("PASS " + name);
  };
  const watchdog = setTimeout(() => {
    console.error("Insights fixture exceeded 150 seconds");
    app?.process().kill();
    process.exitCode = 1;
  }, 150000);
  try {
    await fs.mkdir(evidence, { recursive: true });
    await fs.mkdir(path.join(dir, "knowledge-v1"));
    await fs.writeFile(
      path.join(dir, "knowledge-v1/preferences.json"),
      JSON.stringify({ automatic: false, checked: {} }),
    );
    const reference = require("../data/forever/pack.json"),
      pack = normalizeInsights(fixture(), { commit, build });
    pack.quests[0].id = 138;
    pack.quests[0].title = reference.quests[138].title;
    pack.quests[1].id = 1;
    pack.quests[1].title = reference.quests[1].title;
    const profile = {
      id: "p",
      name: "Synthetic Explorer",
      realm: "Fictional",
      className: "Mage",
      race: "Sunborn",
      faction: "Horde",
      level: 20,
      clientBuild: build,
      locale: "enUS",
      captureVersion: "0.6.0",
      source: {
        kind: "wow-addon",
        id: "SYNTHETIC",
        updatedAt: "2026-11-09T12:00:00.000Z",
      },
      notes: "PRIVATE_INSIGHTS_CANARY",
      goals: [],
      quests: [
        {
          id: 138,
          title: reference.quests[138].title,
          complete: false,
          objectives: [],
          destination: { mapId: 1, x: 0.3, y: 0.4 },
        },
        {
          id: 1,
          title: reference.quests[1].title,
          complete: false,
          objectives: [],
        },
      ],
    };
    const profiles = [
      profile,
      { ...profile, id: "build", name: "Wrong Build", clientBuild: "1.60.1.0" },
      {
        ...profile,
        id: "title",
        name: "Wrong Title",
        quests: [{ ...profile.quests[0], title: "Synthetic changed title" }],
      },
      { ...profile, id: "locale", name: "Wrong Locale", locale: "deDE" },
      {
        id: "manual",
        name: "Manual Explorer",
        realm: "",
        className: "Mage",
        level: 20,
        notes: "",
        goals: [],
      },
    ];
    await fs.writeFile(
      path.join(dir, "state.json"),
      JSON.stringify(
        require("../src/core/validation.cjs").validateState({
          ...defaultState(),
          onboarded: true,
          activeProfileId: "p",
          profiles,
        }),
      ),
    );
    const launcher = path.join(dir, "launch.cjs");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "backstage-forever-insights-fixture",
        version: require("../package.json").version,
        main: "launch.cjs",
      }),
    );
    await fs.writeFile(
      launcher,
      `const {app}=require("electron"); app.setAppPath(${JSON.stringify(repo)}); const insights=require(${JSON.stringify(path.join(repo, "src/core/insights-data.cjs"))}); insights.loadBundledInsights=()=>insights.validateInsights(${JSON.stringify(pack)}); require(${JSON.stringify(path.join(repo, "src/main.cjs"))});`,
    );
    app = await electron.launch({
      args: [dir],
      env: { ...process.env, BF_USER_DATA: dir },
      timeout: 20000,
    });
    page = await testWindow(app);
    page.setDefaultTimeout(6500);
    await app.evaluate(({ app, ipcMain }) => {
      const load = process
        .getBuiltinModule("node:module")
        .createRequire(
          process
            .getBuiltinModule("node:path")
            .join(app.getAppPath(), "package.json"),
        );
      globalThis.insightsFixture = {
        requests: [],
        asks: 0,
        hold: false,
        finished: 0,
      };
      load("./src/core/voice.cjs").VoiceService.prototype.readCapabilities =
        async () => ({
          status: "unavailable",
          recognition: { available: false, cultures: [] },
          synthesis: { available: false, voices: [] },
          message: "Fixture voice unavailable.",
        });
      load(
        "./src/core/knowledge-cache.cjs",
      ).KnowledgeService.prototype.readResponse = async function (url) {
        insightsFixture.requests.push(url);
        throw Error("Fixture offline");
      };
      const Knowledge = load("./src/core/knowledge-cache.cjs").KnowledgeService
          .prototype,
        originalIndex = Knowledge.index;
      Knowledge.index = function (...args) {
        insightsFixture.knowledge = this;
        return originalIndex.apply(this, args);
      };
      const Store = load("./src/core/store.cjs").Store.prototype,
        save = Store.saveState;
      Store.saveState = function (...args) {
        insightsFixture.store = this;
        return save.apply(this, args);
      };
      const original = ipcMain._invokeHandlers.get("backstage:questDetails");
      ipcMain.removeHandler("backstage:questDetails");
      ipcMain.handle("backstage:questDetails", async (...args) => {
        const result = await original(...args);
        if (insightsFixture.hold)
          await new Promise((r) => (insightsFixture.release = r));
        insightsFixture.finished++;
        return result;
      });
      ipcMain.removeHandler("backstage:ask");
      ipcMain.handle("backstage:ask", () => {
        insightsFixture.asks++;
        throw Error("No inference in fixture");
      });
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "manual"));
    await page.reload();
    await navigate(page, "quest-guide");
    const open = (id) =>
      page.locator(`.quest-ledger-row[data-quest-id="${id}"]`).click();
    const facts = () =>
      page.getByRole("region", {
        name: "Supplementary reference facts",
        exact: true,
      });
    await check(
      "primary reference conflicts or missing rows suppress supplementary facts while preserving saved game waypoints",
      async () => {
        await page.evaluate(() => window.backstage.knowledgeStatus());
        await app.evaluate(() => {
          insightsFixture.originalQuest = structuredClone(
            insightsFixture.knowledge.bundled.pack.quests[138],
          );
        });
        try {
          for (const scenario of ["conflict", "missing"]) {
            await app.evaluate((_, scenario) => {
              const quests = insightsFixture.knowledge.bundled.pack.quests;
              quests[138] = structuredClone(insightsFixture.originalQuest);
              if (scenario === "conflict")
                quests[138].title = "Conflicting primary reference title";
              else delete quests[138];
            }, scenario);
            await open(138);
            await facts().waitFor();
            const detail = await page.evaluate(() =>
              window.backstage.questDetails("p", 138),
            );
            assert.equal(detail.status, scenario);
            assert.equal(detail.insights.status, "unavailable");
            assert.doesNotMatch(
              await facts().innerText(),
              /Synthetic Starter|Sharing was reported mixed/,
            );
            assert.match(
              await facts().innerText(),
              /primary.*reference|selected.*reference/i,
            );
            assert.equal(detail.waypoint.source, "game");
            assert.equal(detail.waypoint.canCopy, true);
            await page
              .getByRole("button", { name: "Copy game waypoint", exact: true })
              .waitFor();
          if(process.argv.includes("--primary-reference-gate")) {
            await facts().scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(evidence,`primary-${scenario}.png`)});
          }
          }
        } finally {
          await app.evaluate(() => {
            insightsFixture.knowledge.bundled.pack.quests[138] =
              insightsFixture.originalQuest;
          });
        }
        await open(138);
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
      },
    );
    await check(
      "compatible selected quest shows qualified secondary facts after its primary action",
      async () => {
        await open(138);
        await facts().waitFor();
        const text = await facts().innerText();
        assert.match(text, /Sharing was reported mixed/);
        assert.match(text, /2 supported.*1 not supported/);
        assert.match(text, /recorded answers.*distinct people/i);
        assert.match(text, /60 seconds.*static/i);
        assert.match(text, /ownership.*unknown/i);
        assert.match(text, /drop rate.*unknown/i);
        assert.equal(
          (text.match(/Item #21/g) || []).length,
          1,
          "Unknown drop item ID is shown once, rather than repeated as a redundant name suffix",
        );
        assert.match(text, /1\.60\.1\.70862/);
        assert.match(text, /English.*observation names.*unspecified/i);
        assert.equal(
          await page.evaluate(() =>
            Boolean(
              document
                .querySelector(".quest-waypoint")
                .compareDocumentPosition(
                  document.querySelector(".quest-insights"),
                ) & Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          ),
          true,
        );
      },
    );
    await check(
      "unknown sharing stays unknown and current selection replaces previous facts",
      async () => {
        await open(1);
        await facts()
          .getByText("Sharing observations unknown.", { exact: true })
          .waitFor();
        assert.doesNotMatch(await facts().innerText(), /Synthetic Starter/);
        await open(138);
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
      },
    );
    await check(
      "held current control survives a response; original node and caret remain owned",
      async () => {
        await app.evaluate(() => {
          insightsFixture.hold = true;
          insightsFixture.release = null;
        });
        const row = page.locator('.quest-ledger-row[data-quest-id="1"]');
        await row.focus();
        await page.evaluate(
          () => (window.originalInsightsRow = document.activeElement),
        );
        await page.keyboard.down("Enter");
        await app.evaluate(async () => {
          const end = Date.now() + 4000;
          while (!insightsFixture.release) {
            if (Date.now() > end) throw Error("Details not held");
            await new Promise((r) => setTimeout(r, 10));
          }
          insightsFixture.hold = false;
          insightsFixture.release();
        });
        await page.waitForTimeout(80);
        assert.equal(
          await page.evaluate(
            () =>
              originalInsightsRow.isConnected &&
              document.activeElement === originalInsightsRow &&
              document.querySelector('.quest-ledger-row[data-quest-id="1"]') ===
                originalInsightsRow,
          ),
          true,
        );
        await page.keyboard.up("Enter");
        await facts()
          .getByText("Sharing observations unknown.", { exact: true })
          .waitFor();
        await page.locator("#quest-search").fill("Synthetic draft");
        await selectCurrentText(page, {
          selector: "#quest-search",
          value: "Synthetic draft",
          start: 2,
          end: 8,
          focus: true,
          capture: "originalInsightsSearch",
        });
        await page.waitForTimeout(200);
        assert.deepEqual(
          await currentControlState(page, "#quest-search", { selection: true }),
          { focused: true, value: "Synthetic draft", start: 2, end: 8 },
        );
        assert.equal(
          await page.evaluate(
            () =>
              originalInsightsSearch ===
              document.querySelector("#quest-search"),
          ),
          true,
        );
        await page.locator("#quest-search").fill("");
        await open(138);
      },
    );
    await check(
      "old selection response cannot paint into a newly selected character",
      async () => {
        await app.evaluate(() => {
          insightsFixture.hold = true;
          insightsFixture.release = null;
        });
        await open(1);
        await page.waitForTimeout(50);
        await page.locator("#active-character").selectOption("title");
        await app.evaluate(() => {
          insightsFixture.hold = false;
          insightsFixture.release?.();
        });
        await page.locator('.quest-ledger-row[data-quest-id="138"]').waitFor();
        await open(138);
        await facts()
          .getByText(/Quest title differs/)
          .waitFor();
        assert.doesNotMatch(await facts().innerText(), /Synthetic Starter/);
      },
    );
    await check(
      "wrong build and locale remain unavailable; manual reference browsing stays qualified",
      async () => {
        for (const id of ["build", "locale"]) {
          await page.locator("#active-character").selectOption(id);
          await open(138);
          await facts()
            .getByText(/differs|missing|incompatible/)
            .waitFor();
          assert.doesNotMatch(await facts().innerText(), /Synthetic Starter/);
        }
        await page.locator("#active-character").selectOption("manual");
        await ensureCompanionTools(page,"quest-filters");await page.locator("#reference-quests").check();
        await page.locator("#quest-search").fill("138");
        await open(138);
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
        assert.match(await facts().innerText(), /availability.*unknown/i);
      },
    );
    await check(
      "source replacement suppresses extras and explicit public context never includes insights or private notes",
      async () => {
        await page.locator("#active-character").selectOption("p");
        await open(138);
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
        await app.evaluate(() => {
          insightsFixture.hold = true;
          insightsFixture.release = null;
        });
        await open(138);
        await app.evaluate(async () => {
          const end = Date.now() + 4000;
          while (!insightsFixture.release) {
            if (Date.now() > end)
              throw Error("Source race did not hold a result");
            await new Promise((r) => setTimeout(r, 10));
          }
          insightsFixture.knowledge.bundled.pack.sourceCommit = "a".repeat(40);
        });
        await page.evaluate(async () => {
          knowledgeStatus = await window.backstage.knowledgeStatus();
          QuestGuide.sync(profile(), knowledgeStatus);
          render();
        });
        await app.evaluate(() => {
          insightsFixture.hold = false;
          insightsFixture.release();
        });
        await page.waitForTimeout(80);
        assert.equal(
          await facts().count(),
          0,
          "The previous source result cannot repaint after a source change",
        );
        await open(138);
        await facts()
          .getByText(/reference source differs/)
          .waitFor();
        const context = await page.evaluate(() =>
          window.backstage.contextPreview("p", true, "138"),
        );
        assert.doesNotMatch(
          JSON.stringify(context),
          /PRIVATE_INSIGHTS_CANARY|Synthetic Starter|supportedCount|timeLimitSeconds|sharing|insights/,
        );
        await app.evaluate((_, commit) => {
          insightsFixture.knowledge.bundled.pack.sourceCommit = commit;
        }, commit);
        await page.evaluate(async () => {
          knowledgeStatus = await window.backstage.knowledgeStatus();
          QuestGuide.sync(profile(), knowledgeStatus);
          render();
        });
        await open(138);
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
      },
    );
    await check(
      "new same-character capture date/title invalidates a held original result",
      async () => {
        await page.evaluate(async () => {
          const r = await window.backstage.bootstrap();
          await window.backstage.saveState(r.state);
        });
        await app.evaluate(() => {
          insightsFixture.hold = true;
          insightsFixture.release = null;
        });
        await open(138);
        await app.evaluate(async () => {
          const end = Date.now() + 4000;
          while (!insightsFixture.release) {
            if (Date.now() > end)
              throw Error("Capture race did not hold a result");
            await new Promise((r) => setTimeout(r, 10));
          }
          const next = structuredClone(insightsFixture.store.state);
          const p = next.profiles.find((p) => p.id === "p");
          p.source.updatedAt = "2026-11-10T12:00:00.000Z";
          p.quests[0].title = "New synthetic capture title";
          insightsFixture.store.saveState(next);
          insightsFixture.hold = false;
        });
        await page.evaluate(async () => {
          const r = await window.backstage.bootstrap();
          state = r.state;
          render();
        });
        await app.evaluate(() => insightsFixture.release());
        await facts()
          .getByText(/Quest title differs/)
          .waitFor();
        assert.doesNotMatch(await facts().innerText(), /Synthetic Starter/);
        await app.evaluate((_, title) => {
          const next = structuredClone(insightsFixture.store.state);
          next.profiles.find((p) => p.id === "p").quests[0].title = title;
          insightsFixture.store.saveState(next);
        }, profile.quests[0].title);
        await page.evaluate(async () => {
          const r = await window.backstage.bootstrap();
          state = r.state;
          render();
        });
        await facts()
          .getByText(/Synthetic Starter/)
          .waitFor();
      },
    );
    await check(
      "native source disclosure keeps current focus and open state through a real root repaint",
      async () => {
        const summary = page.locator(".quest-source summary");
        await summary.scrollIntoViewIfNeeded();
        await summary.focus();
        await page.evaluate(
          () => (window.originalInsightsSummary = document.activeElement),
        );
        await page.keyboard.down("Space");
        await page.evaluate(() => render());
        assert.equal(
          await page.evaluate(
            () =>
              originalInsightsSummary ===
                document.querySelector(".quest-source summary") &&
              originalInsightsSummary === document.activeElement,
          ),
          true,
        );
        await page.keyboard.up("Space");
        await page.waitForFunction(
          () => document.querySelector(".quest-source")?.open,
        );
        await page.evaluate(() => render());
        assert.deepEqual(
          await currentControlState(page, ".quest-source summary", {
            disclosure: true,
          }),
          { focused: true, open: true },
        );
      },
    );
    await check(
      "normal and 984x635 layouts retain readable facts, source and eleven routes without overflow",
      async () => {
        for (const [name, width, height] of [
          ["full", 1440, 960],
          ["compact", 984, 635],
        ]) {
          await app.evaluate(
            ({ BrowserWindow }, size) => {
              const w = BrowserWindow.getAllWindows()[0];
              w.setMinimumSize(0, 0);
              w.setContentSize(...size);
            },
            [width, height],
          );
          await facts().scrollIntoViewIfNeeded();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            true,
          );
          assert.equal(
            await facts().evaluate((n) =>
              [...n.querySelectorAll("p,small,span,strong,li")].every(
                (e) => parseFloat(getComputedStyle(e).fontSize) >= 12,
              ),
            ),
            true,
          );
          await page.screenshot({ path: path.join(evidence, `${name}.png`) });
        }
        assert.equal(await page.locator('nav[aria-label="Main navigation"] button').count(), 5);assert.equal(await page.getByRole("navigation",{name:"Settings and help",exact:true}).getByRole("button").count(),2);
      },
    );
    const calls = await app.evaluate(() => ({
      requests: insightsFixture.requests,
      asks: insightsFixture.asks,
    }));
    assert.deepEqual(calls, { requests: [], asks: 0 });
    await check(
      "an invalid optional pack leaves real startup, saved quests and primary waypoint usable",
      async () => {
        await app.close();
        app = null;
        const invalidFile = path.join(dir, "invalid-insights.json");
        await fs.writeFile(invalidFile, '{"schemaVersion":999}');
        await fs.writeFile(
          launcher,
          `const {app}=require("electron"); app.setAppPath(${JSON.stringify(repo)}); const insights=require(${JSON.stringify(path.join(repo, "src/core/insights-data.cjs"))}); const load=insights.loadBundledInsights; insights.loadBundledInsights=()=>load(${JSON.stringify(invalidFile)}); require(${JSON.stringify(path.join(repo, "src/core/voice.cjs"))}).VoiceService.prototype.readCapabilities=async()=>({status:"unavailable",recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]},message:"Fixture voice unavailable."}); require(${JSON.stringify(path.join(repo, "src/main.cjs"))});`,
        );
        app = await electron.launch({
          args: [dir],
          env: { ...process.env, BF_USER_DATA: dir },
          timeout: 20000,
        });
        page = await testWindow(app);
        page.setDefaultTimeout(6500);
        await navigate(page, "quest-guide");
        await open(138);
        await page
          .getByRole("button", { name: "Copy game waypoint", exact: true })
          .waitFor();
        assert.equal(await facts().count(), 0);
        const d = await page.evaluate(() =>
          window.backstage.questDetails("p", 138),
        );
        assert.equal(Object.hasOwn(d, "insights"), false);
        assert.equal(d.waypoint.source, "game");
        assert.equal(d.waypoint.canCopy, true);
      },
    );
    console.log(`Insights Electron smoke: ${checks} checks passed.`);
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(evidence, "failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
