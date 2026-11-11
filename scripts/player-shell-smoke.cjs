"use strict";
// Real main/preload/renderer; only synthetic journals and fake inference.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const {
  navigate,
  ensureCompanionTools,
  routes,
} = require("./player-navigation.cjs");
const { assertSelectContrast } = require("./select-contrast.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const root = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(root, "forever-player-shell-"));
  let app;
  const capture = process.env.BF_SMOKE_CAPTURE_ROOT || path.join(
    __dirname,
    "..",
    ".superpowers",
    "sdd",
    "player-shell-captures",
  );
  await fs.mkdir(capture, { recursive: true });
  const watchdog = setTimeout(() => {
    console.error("Conversation fixture exceeded 120 seconds");
    app?.process().kill();
    process.exitCode = 1;
  }, 120000);
  try {
    const initial = {
      ...defaultState(),
      onboarded: true,
      activeProfileId: "Alpha",
      profiles: ["Alpha", "Beta"].map((id) => ({
        id,
        name: id,
        className: id === "Alpha" ? "Hunter" : "Skyborne Custom",
        realm: "Synthetic",
        level: 12,
        goals: [{ id: "g", text: "PRIVATE_GOAL_CANARY", done: false }],
        notes: "PRIVATE_NOTE_CANARY",
        faction: id === "Alpha" ? "Alliance" : "Horde",
        clientBuild: "1.60.1.70862",
        location: { zone: "Orgrimmar" },
        source: {
          kind: "wow-addon",
          id: "SYNTHETIC_" + id,
          updatedAt: "2026-11-10T00:00:00.000Z",
        },
      })),
      provider: { id: "ollama", model: "", endpoint: "http://127.0.0.1:11434" },
    };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    await fs.mkdir(path.join(dir, "updates"));
    await fs.writeFile(
      path.join(dir, "updates", "preferences.json"),
      JSON.stringify({ automatic: false, installOnQuit: false }),
    );
    await fs.mkdir(path.join(dir, "knowledge-v1"));
    await fs.writeFile(
      path.join(dir, "knowledge-v1", "preferences.json"),
      JSON.stringify({ automatic: false, checked: {} }),
    );
    const repo = path.resolve(__dirname, "..");
    // Install fake external surfaces before bootstrap can enumerate providers or speech.
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "backstage-forever-player-shell-fixture",
        version: "0.12.3",
        main: "fixture-main.cjs",
      }),
    );
    await fs.writeFile(
      path.join(dir, "fixture-main.cjs"),
      `
    const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
    load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
    load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
    globalThis.travelFixture={calls:[],opens:[],copies:[],keys:0};
    const storeProto=load('./src/core/store.cjs').Store.prototype;storeProto.getKey=function(){travelFixture.keys++;return '';};
    load('electron').clipboard.writeText=text=>travelFixture.copies.push(text);
    load('electron').shell.openExternal=async url=>{travelFixture.opens.push(url);};
    load('./src/core/providers.cjs').ask=async input=>{travelFixture.calls.push(input);return ${JSON.stringify("**Synthetic advice**\n\n- Review your quest\n- Check your bags\n\n<img src=x onerror=alert(1)> [bad](javascript:alert(1))")};};
    const proto=load('./src/core/companion-context.cjs').CompanionContext.prototype,original=proto.invalidate;proto.invalidate=function(reason){travelFixture.context=this;return original.call(this,reason);};
    load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
    load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
    load('./src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});
    load('./src/core/game-runtime.cjs').GameRuntime.prototype.launch=async()=>{throw Error('Synthetic gate blocks launch');};
    load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
    load('./src/core/updater.cjs').Updater.prototype.start=function(){};
    load('./src/main.cjs');
  `,
    );
    app = await electron.launch({
      args: [dir],
      env: { ...process.env, BF_USER_DATA: dir },
      timeout: 20000,
    });
    const page = await testWindow(app);
    page.setDefaultTimeout(6000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();

    const primary = page.getByRole("navigation", { name: "Main navigation" });
    const names = ["Adventure", "Quests", "Companion", "Characters", "Plans"];
    assert.equal(await primary.getByRole("button").count(), names.length);
    for (let i = 0; i < names.length; i++) {
      const button = primary.getByRole("button", {
        name: names[i],
        exact: true,
      });
      assert.equal(await button.count(), 1);
      assert.equal(
        await button.evaluate((n) =>
          [...n.closest("nav").querySelectorAll("button")].indexOf(n),
        ),
        i,
      );
    }

    assert.equal(
      await page
        .getByRole("navigation", { name: "Settings and help", exact: true })
        .getByRole("button")
        .count(),
      2,
    );
    for (const id of Object.keys(routes)) {
      await navigate(page, id);
      assert.equal(
        await page.getByLabel("Active character", { exact: true }).inputValue(),
        "Alpha",
      );
      const group = ["preparation","adventure-map"].includes(id) ? "adventure" : id === "party"
        ? "company"
        : ["game", "connections", "updates"].includes(id)
          ? "game"
          : id;
      assert.equal(
        await page
          .locator('.rail [aria-current="page"]')
          .getAttribute("data-nav"),
        group,
      );
    }
    await navigate(page, "quest-guide");
    assert.equal(
      await page.locator("[data-player-tool=quest-details]").count(),
      1,
      "Advanced quest reference controls have a visible disclosure",
    );
    await navigate(page, "assistant");
    assert.equal(
      await page.locator('[data-player-tool="voice"]').count(),
      1,
      "Voice has a discoverable optional disclosure",
    );
    assert.equal(
      await page.locator('[data-player-tool="memory"]').count(),
      1,
      "Memory has a discoverable optional disclosure",
    );
    assert.equal(
      await page.locator('[data-player-tool="voice"]').evaluate((n) => n.open),
      false,
    );
    assert.match(
      await page.locator('[data-player-tool="memory"] > summary').innerText(),
      /0 selected/,
    );
    assert.match(
      await page.locator("[data-companion-cost]").innerText(),
      /local Ollama/,
    );
    await ensureCompanionTools(page, "voice");
    await ensureCompanionTools(page, "memory");
    await page.evaluate(() => render());
    for (const tool of ["voice", "memory"])
      assert.equal(
        await page
          .locator(`[data-player-tool="${tool}"]`)
          .evaluate((n) => n.open),
        true,
      );
    await navigate(page, "guide");
    await navigate(page, "assistant");
    for (const tool of ["voice", "memory"])
      assert.equal(
        await page
          .locator(`[data-player-tool="${tool}"]`)
          .evaluate((n) => n.open),
        true,
      );
    await navigate(page, "characters");
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption("Beta");
    await page.waitForFunction(
      () =>
        document.querySelector("#character-form [name=className]").value ===
        "Skyborne Custom",
    );
    assert.equal(
      await page.locator('#character-form [name="className"]').inputValue(),
      "Skyborne Custom",
    );
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    assert.deepEqual(
      await page
        .locator('#character-form [name="className"] option')
        .allTextContents(),
      [
        "Hunter",
        "Warrior",
        "Paladin",
        "Rogue",
        "Priest",
        "Shaman",
        "Mage",
        "Warlock",
        "Druid",
        "Other",
      ],
    );
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption("Alpha");

    await navigate(page, "assistant");
    for (const tool of ["voice", "memory"]) {
      const panel = page.locator(`[data-player-tool="${tool}"]`);
      if (await panel.evaluate((n) => n.open))
        await panel.locator(":scope > summary").click();
    }
    const manifest = [];
    const captureShot = async (name) => {
      await page.evaluate(async () => {
        document.activeElement?.blur();
        scrollTo(0, 0);
        document.querySelector(".main")?.scrollTo(0, 0);
        await Promise.all(
          [...document.images].map((i) => i.decode().catch(() => {})),
        );
      });
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        brokenImages: [...document.images].filter(
          (i) => !i.complete || !i.naturalWidth,
        ).length,
      }));
      assert.ok(
        metrics.scrollWidth <= metrics.width,
        `${name} horizontal overflow`,
      );
      assert.equal(metrics.brokenImages, 0);
      if (name.includes("assistant-compact")) {
        assert.equal(
          await page.locator(".ai-setup-hint").count(),
          1,
          "Unconfigured local travel stays usable",
        );
        const send = await page
          .locator('#chat-form button[type="submit"]')
          .evaluate((n) => ({
            bottom: n.getBoundingClientRect().bottom,
            height: innerHeight,
          }));
        if (send.bottom > send.height)
          await page.screenshot({
            path: path.join(capture, "unconfigured-send-red.png"),
            fullPage: true,
          });
        assert.ok(
          send.bottom <= send.height,
          `${name}: unconfigured Send bottom ${send.bottom} must fit ${send.height}`,
        );
      }
      await assertSelectContrast(page, name);
      if (name.includes("zoom200")) {
        const png = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
            .toPNG()
            .toString("base64"),
        );
        await fs.writeFile(
          path.join(capture, name + ".png"),
          Buffer.from(png, "base64"),
        );
      } else
        await page.screenshot({
          path: path.join(capture, name + ".png"),
          fullPage: true,
        });
      for (const label of ["Settings", "Help"])
        assert.equal(
          await page
            .getByRole("button", { name: label, exact: true })
            .locator("span")
            .last()
            .evaluate((n) => {
              const r = document.createRange();
              r.selectNodeContents(n);
              return r.getClientRects().length;
            }),
          1,
          `${name}: ${label} must not wrap into fragments`,
        );
      manifest.push({ name, ...metrics });
    };
    for (const [id, faction] of [
      ["Alpha", "alliance"],
      ["Beta", "horde"],
    ]) {
      await page
        .getByLabel("Active character", { exact: true })
        .selectOption(id);
      await page.waitForFunction((id) => state.activeProfileId === id, id);
      for (const [width, height, size] of [
        [1440, 960, "full"],
        [984, 635, "compact"],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, v) =>
            BrowserWindow.getAllWindows()[0].setContentSize(...v),
          [width, height],
        );
        for (const route of [
          "adventure",
          "quest-guide",
          "assistant",
          "characters",
          "company",
        ]) {
          await navigate(page, route);
          await captureShot(`${faction}-${route}-${size}`);
        }
      }
    }
    for (const route of ["game", "connections", "updates", "guide"]) {
      await navigate(page, route);
      await captureShot("secondary-" + route);
    }
    await navigate(page, "assistant");
    await ensureCompanionTools(page, "memory");
    await ensureCompanionTools(page, "voice");
    await captureShot("optional-tools");
    const url = page.url();
    await page.locator("[data-action=skip-content]").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "main-content",
    );
    assert.equal(page.url(), url);
    for (const name of names) {
      const control = primary.getByRole("button", { name, exact: true });
      await control.focus();
      await page.keyboard.press("Enter");
      await control.focus();
      await page.keyboard.press("Space");
      assert.equal(await control.getAttribute("aria-current"), "page");
    }
    await navigate(page, "company");
    for (const tab of ["My plans", "Party"]) {
      const button = page
        .getByRole("navigation", { name: "Plans navigation", exact: true })
        .getByRole("button", { name: tab, exact: true });
      await button.focus();
      await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-current"), "page");
    }
    for (const [section, tabs] of [
      ["Adventure", ["Next step", "Professions"]],
      ["Settings", ["Game connection", "AI connection", "Updates"]],
      ["Help", ["Field guide"]],
    ]) {
      const secondary = page
        .getByRole("navigation", { name: section==="Adventure"?"Main navigation":"Settings and help", exact: true })
        .getByRole("button", { name: section, exact: true });
      await secondary.focus();
      await page.keyboard.press("Enter");
      for (const label of tabs) {
        const tab = page
          .getByRole("navigation", {
            name: `${section} navigation`,
            exact: true,
          })
          .getByRole("button", { name: label, exact: true });
        await tab.focus();
        await page.keyboard.press("Space");
        assert.equal(await tab.getAttribute("aria-current"), "page");
      }
    }
    await navigate(page, "updates");
    await page.evaluate(() => refreshUpdateWidgets());
    assert.equal(
      await page.getByRole("button", { name: "Settings", exact: true }).count(),
      1,
    );
    assert.equal(await page.locator(".settings-update-status").count(), 1);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1440, 960);
      w.webContents.setZoomFactor(2);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await navigate(page, "quest-guide");
    await captureShot("quest-zoom200-reduced");
    await fs.writeFile(
      path.join(capture, "manifest.json"),
      JSON.stringify(
        {
          routes: Object.keys(routes),
          captures: manifest,
          external:
            "All surfaces fake before bootstrap; original art; no game/audio/auth/inference",
        },
        null,
        2,
      ),
    );
    console.log(
      "Player shell actual Electron PASS: 5 primary + 2 secondary, 12 visible destinations (all 11 legacy routes plus Map), preserved custom class, disclosures, keyboard, 26 faction/full/compact/secondary/tool/zoom captures.",
    );
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close();
    const resolved = await fs.realpath(dir);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith("forever-player-shell-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
