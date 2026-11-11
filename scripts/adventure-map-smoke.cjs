"use strict";
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs"),
  { testWindow } = require("./test-window.cjs"),
  { navigate, routes } = require("./player-navigation.cjs"),
  { assertSelectContrast } = require("./select-contrast.cjs");
const { _electron: electron } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bf-map-ui-")),
    captureRoot =
      process.env.BF_SMOKE_CAPTURE_ROOT ||
      path.resolve(
        ".superpowers/sdd/adventure-map-captures/" +
          new Date().toISOString().replace(/[:.]/g, "-"),
      );
  await fs.mkdir(captureRoot, { recursive: true });
  let app, page;
  const errors = [],
    checks = [];
  const watchdog = setTimeout(() => {
    console.error("Map gate exceeded 180 seconds");
    app?.process().kill();
    process.exitCode = 1;
  }, 180000);
  try {
    const state = require("../tests/adventure-map-fixture.cjs").seed();
    state.followGameCharacter = false;
    const elsewhere = structuredClone(state.profiles[0].gathering.records[0]);
    elsewhere.mapId = 1456;
    elsewhere.id = "wowf:mining:1731:1456:5027:4874:1.60.1.70862";
    elsewhere.name = "Recorded interaction in another area";
    state.profiles[0].gathering.records.push(elsewhere);
    state.profiles[0].gathering.totalRecords = 2;
    const other = structuredClone(state.profiles[0]);
    other.id = "q";
    other.name = "Vaelric";
    other.faction = "Horde";
    other.className = "Mage";
    other.source.id = "OTHER_SYNTHETIC";
    state.profiles.push(other);
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    const launch = await syntheticLaunch(dir),
      entry = path.join(launch, "main.cjs");
    let boot = await fs.readFile(entry, "utf8");
    boot = boot.replace(
      "load('./src/main.cjs');",
      `const mapModule=load('./src/core/adventure-map-ipc.cjs'),register=mapModule.registerAdventureMapHandlers;globalThis.mapGate={delay:false,pending:[],reads:0};load('./src/core/claude.cjs').clearCredentials=async()=>{};load('electron').dialog.showMessageBox=async()=>({response:1});load('electron').dialog.showOpenDialog=async()=>mapGate.importFile?({canceled:false,filePaths:[mapGate.importFile]}):({canceled:true,filePaths:[]});mapModule.registerAdventureMapHandlers=options=>{mapGate.state=options.getState;register({...options,handle:(name,fn)=>options.handle(name,(...args)=>{mapGate.reads++;const result=fn(...args);if(mapGate.delay)return new Promise(resolve=>mapGate.pending.push(()=>resolve(result)));return result;})});};load('./src/main.cjs');`,
    );
    await fs.writeFile(entry, boot);
    app = await electron.launch({
      args: [launch],
      env: { ...process.env, BF_USER_DATA: dir },
    });
    page = await testWindow(app);
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.locator("[data-command=setup-defer]").click();
    await navigate(page, "adventure-map");
    await page.locator(".map-mark.find").waitFor();
    const change = async (fn) => {
      await app.evaluate(fn);
      await page.evaluate(async () => {
        const b = await api.bootstrap();
        state = b.state;
        gameStatus = b.gameStatus;
        AdventureMap.refresh();
      });
    };
    const waitReady = () =>
      page.waitForFunction(
        () => document.querySelectorAll(".map-mark").length > 0,
      );
    const capture = async (name) => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.screenshot();
      const data = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
          .toPNG()
          .toString("base64"),
      );
      await fs.writeFile(
        path.join(captureRoot, name + ".png"),
        Buffer.from(data, "base64"),
      );
    };
    const size = async (w, h) => {
      await app.evaluate(
        ({ BrowserWindow }, { w, h }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(w, h),
        { w, h },
      );
      await page.waitForFunction(
        ({ w, h }) => innerWidth === w && innerHeight === h,
        { w, h },
      );
    };
    assert.equal(
      await page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("button")
        .count(),
      5,
    );
    assert.equal(
      await page
        .getByRole("navigation", { name: "Adventure navigation", exact: true })
        .getByRole("button")
        .count(),
      3,
    );
    assert.equal(
      await page.locator(".map-mark.find circle").getAttribute("cx"),
      "502.7",
    );
    assert.equal(
      await page.locator(".map-mark.find circle").getAttribute("cy"),
      "487.4",
    );
    assert.equal(
      await page.locator(".map-player circle").first().getAttribute("cx"),
      "0",
    );
    const m = await page.evaluate(() =>
      api.adventureMap(state.activeProfileId, {
        goal: Preparation.options(state.activeProfileId),
      }),
    );
    assert.equal(await page.locator(".map-mark").count(), m.counts.total);
    assert.doesNotMatch(
      JSON.stringify(m),
      /PRIVATE_|command|sourceKey|https?:/,
    );
    checks.push(
      "actual main model / SVG counts, nonzero exact geometry and zero player coordinate",
    );
    await page.locator(".map-point-list button").last().click();
    assert.match(
      await page.locator(".map-dossier").innerText(),
      /Historical reference|Your recorded find/i,
    );
    await page.locator(".map-mark.find").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".map-dossier")
        .textContent.includes("Recorded copper"),
    );
    assert.match(
      await page.locator(".map-dossier").innerText(),
      /standing interaction/,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("map-mark"),
      ),
      true,
    );
    checks.push(
      "SVG keyboard and mouse list selection / concise dossier / legend",
    );
    await page.locator("[data-map-area]").selectOption("1456");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-map-area]").value === "1456" &&
        document.querySelectorAll(".map-mark").length === 1,
    );
    assert.equal(await page.locator(".map-player").count(), 0);
    await change(() => {
      mapGate.state().profiles[0].source.updatedAt = "2026-11-11T12:00:01.000Z";
    });
    await page.waitForFunction(
      () => document.querySelector("[data-map-area]").value === "1456",
    );
    assert.equal(
      await page.evaluate(() => AdventureMap.options("p").mapId),
      1456,
    );
    await page.locator("[data-map-area]").selectOption("1411");
    await page.locator(".map-mark.quest").waitFor();
    checks.push(
      "user-selected reference area autosaves and remains selected across source refresh",
    );
    await page.locator("[data-map-control=layers]").click();
    await page.locator("[data-map-layer=ore]").uncheck();
    await page.waitForFunction(
      () => !document.querySelector(".map-mark.material"),
    );
    assert.equal(
      await page.evaluate(() => AdventureMap.options("p").layers.ore),
      false,
    );
    await navigate(page, "adventure");
    await navigate(page, "adventure-map");
    await waitReady();
    assert.equal(await page.locator(".map-mark.material").count(), 0);
    await page.locator("[data-map-control=layers]").click();
    await page.locator("[data-map-defaults]").click();
    await page.locator(".map-mark.material").first().waitFor();
    checks.push("per-character layer autosave and useful defaults");
    await page.evaluate(() => Preparation.save("p", { crafts: 3 }));
    await page.evaluate(() => AdventureMap.refresh());
    await page.waitForFunction(
      async () =>
        (await api.adventureMap("p", { goal: Preparation.options("p") })).goal
          .crafts === 3,
    );
    assert.equal(await page.evaluate(() => Preparation.options("p").crafts), 3);
    checks.push("existing bounded profession goal getter reused");
    // A held native select and held button survive both local and whole-root refresh.
    const menu = page.locator("[data-map-area]");
    await menu.click();
    await page.evaluate(
      () => (window.heldMapSelect = document.querySelector("[data-map-area]")),
    );
    await page.evaluate(() => render());
    assert.equal(
      await page.evaluate(
        () => heldMapSelect === document.querySelector("[data-map-area]"),
      ),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator(".map-title").click();
    await page.locator("[data-map-area]").selectOption("1411");
    await page.locator(".map-mark.quest").waitFor();
    const btn = page.locator(".map-point-list button").first();
    await btn.focus();
    await page.keyboard.down("Enter");
    await page.evaluate(() => {
      window.heldMapButton = document.querySelector(".map-point-list button");
      render();
    });
    assert.equal(
      await page.evaluate(
        () =>
          heldMapButton === document.querySelector(".map-point-list button"),
      ),
      true,
    );
    await page.keyboard.up("Enter");
    checks.push("actual native select / held Enter / whole-root ownership");
    // Hold a physical marker while its source is replaced. Old press cannot open new evidence.
    await page.locator(".map-title").click();
    const target = page.locator(".map-point-list button").first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.evaluate(
      () =>
        (window.heldPointer = document.querySelector(".map-point-list button")),
    );
    await change(() => {
      mapGate.state().profiles[0].quests[0].title = "New saved errand";
    });
    assert.equal(
      await page.evaluate(
        () => heldPointer === document.querySelector(".map-point-list button"),
      ),
      true,
    );
    await page.mouse.up();
    await page.waitForFunction(() =>
      document
        .querySelector(".map-point-list")
        .textContent.includes("New saved errand"),
    );
    assert.match(
      await page.locator(".map-dossier").innerText(),
      /Choose a marker/,
    );
    checks.push("held pointer source replacement retires old selection");
    // Main produces the old result before a delay; route/profile invalidation must discard it.
    await app.evaluate(() => (mapGate.delay = true));
    await change(() => {
      mapGate.state().profiles[0].quests[0].title = "Late obsolete errand";
    });
    await page.waitForFunction(
      () => !AdventureMap.page().includes("data-map-point="),
    );
    await navigate(page, "characters");
    await app.evaluate(() => {
      mapGate.delay = false;
      mapGate.pending.splice(0).forEach((f) => f());
    });
    assert.equal(await page.locator("[data-adventure-map]").count(), 0);
    await navigate(page, "adventure-map");
    await waitReady();
    await app.evaluate(() => (mapGate.delay = true));
    await change(() => {
      mapGate.state().profiles[0].quests[0].title = "Late other character";
    });
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption("q");
    await app.evaluate(() => {
      mapGate.delay = false;
      mapGate.pending.splice(0).forEach((f) => f());
    });
    await page.waitForFunction(() =>
      document
        .querySelector(".map-hero-emblem")
        .textContent.includes("Vaelric"),
    );
    assert.doesNotMatch(
      await page.locator("[data-adventure-map]").innerText(),
      /Late other character/,
    );
    checks.push(
      "late main replies retired on real navigation and profile selection",
    );
    // Compact first action and faction artwork, real zoom pixels, system native select contrast.
    for (const id of ["p", "q"]) {
      await page
        .getByLabel("Active character", { exact: true })
        .selectOption(id);
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(".map-hero-emblem")
            .textContent.includes(id === "p" ? "Aeralyn" : "Vaelric"),
        id,
      );
      await waitReady();
      for (const [w, h, label] of [
        [1440, 960, "full"],
        [984, 635, "compact"],
      ]) {
        await size(w, h);
        await page.evaluate(
          () => (document.querySelector(".main").scrollTop = 0),
        );
        await assertSelectContrast(page, "Map " + id + " " + label);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const action = await page.locator("[data-map-area]").boundingBox();
        assert.ok(
          action.y + action.height <= 635,
          "First useful map action must fit the compact first viewport",
        );
        const marker = await page
          .locator(".map-mark.quest")
          .first()
          .boundingBox();
        assert.ok(
          marker.y >= 0 && marker.y + marker.height <= h,
          "An actual saved quest marker must fit the initial viewport",
        );
        const chart = await page.locator(".map-chart").boundingBox();
        assert.ok(
          chart.y < h - 160,
          "Meaningful map geometry must be visible initially",
        );
        await capture((id === "p" ? "alliance" : "horde") + "-" + label);
      }
    }
    await size(1440, 960);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2),
    );
    await page.waitForFunction(() => innerWidth === 720);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await capture("horde-native-200-percent-reduced-motion");
    await page.locator(".map-frame").scrollIntoViewIfNeeded();
    await capture("horde-native-200-percent-map-detail");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
    );
    checks.push(
      "both factions full/compact, native 200% capture, reduced motion, native select contrast, no overflow",
    );
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption("p");
    await waitReady();
    await change(() => {
      mapGate.state().profiles[0].clientBuild = "1.60.1.70888";
    });
    await page.waitForFunction(
      () => !document.querySelector(".map-mark.material"),
    );
    await page.locator("[data-map-control=layers]").click();
    await page.locator("[data-map-layer=olderReferences]").check();
    await page.locator(".map-mark.old").first().waitFor();
    await page
      .locator(".map-point-list button")
      .filter({ hasText: "Copper Vein" })
      .first()
      .click();
    assert.match(
      await page.locator(".map-dossier").innerText(),
      /Older \/ uncertain reference|build mismatch/i,
    );
    await capture("older-build-browse");
    await change(() => {
      delete mapGate.state().profiles[0].location.x;
    });
    await page.waitForFunction(() => !document.querySelector(".map-player"));
    assert.match(
      await page.locator(".map-location-note").innerText(),
      /Position not recorded/,
    );
    await capture("missing-coordinate");
    await change(() => {
      delete mapGate.state().profiles[0].gathering;
    });
    await page.waitForFunction(() => !document.querySelector(".map-mark.find"));
    await page.locator("[data-map-control=notes]").click();
    assert.match(
      await page.locator(".map-notes").innerText(),
      /history: missing/,
    );
    await capture("missing-format");
    await change(() => {
      delete mapGate.state().profiles[0].location;
      mapGate.state().profiles[0].quests = [];
      mapGate.state().profiles[0].readiness = undefined;
    });
    await page.waitForFunction(() => document.querySelector(".map-no-points"));
    assert.equal(await page.locator(".map-player").count(), 0);
    await capture("no-location-empty");
    checks.push(
      "old-build browse, no coordinate, missing format, empty unknown area",
    );
    for (const route of Object.keys(routes)) {
      await navigate(page, route);
      assert.equal(
        await page
          .getByRole("navigation", { name: "Main navigation", exact: true })
          .getByRole("button")
          .count(),
        5,
      );
    }
    await navigate(page, "company");
    await page.locator("[data-professions-shortcut]").click();
    await page.waitForFunction(() => page === "preparation");
    checks.push(
      "five primary / three Adventure tabs / all eleven legacy routes / Plans shortcut",
    );
    // Genuine import, preview/restore and reset on the isolated fictional journal only.
    const imported = require("../tests/adventure-map-fixture.cjs").seed();
    imported.profiles[0].quests[0].title = "Imported remembered errand";
    const backup = path.join(dir, "fictional-import.json");
    await fs.writeFile(backup, JSON.stringify(imported));
    await app.evaluate((_e, file) => (mapGate.importFile = file), backup);
    await navigate(page, "guide");
    await page.locator("[data-command=import]").click();
    await page.waitForFunction(
      () =>
        state.profiles[0]?.quests?.[0]?.title === "Imported remembered errand",
    );
    assert.deepEqual(await page.evaluate(() => AdventureMap.options("p")), {
      layers: {},
    });
    await navigate(page, "adventure-map");
    await waitReady();
    assert.match(
      await page.locator(".map-point-list").innerText(),
      /Imported remembered errand/,
    );
    assert.equal(
      (await page.evaluate(() => api.adventureMap("p", {}))).gathering
        .formatReceived,
      false,
    );
    const checkpoint = await page.evaluate(async () => {
      const result = await api.checkpointNow();
      return result.points[0].id;
    });
    await page.evaluate(() =>
      AdventureMap.save("p", { mapId: 999999, layers: { finds: false } }),
    );
    await app.evaluate(() => (mapGate.delay = true));
    await change(() => {
      mapGate.state().profiles[0].name = "Obsolete replacement";
    });
    await navigate(page, "guide");
    await page.locator("[data-recovery-select]").selectOption(checkpoint);
    await page.locator("[data-recovery-preview]").click();
    await page.locator("[data-recovery-restore]:not([disabled])").waitFor();
    await page.locator("[data-recovery-restore]").click();
    await page.waitForFunction(() => state.profiles[0]?.name === "Aeralyn");
    await app.evaluate(() => {
      mapGate.delay = false;
      mapGate.pending.splice(0).forEach((f) => f());
    });
    assert.deepEqual(await page.evaluate(() => AdventureMap.options("p")), {
      layers: {},
    });
    await navigate(page, "adventure-map");
    await waitReady();
    assert.doesNotMatch(
      await page.locator("[data-adventure-map]").innerText(),
      /Obsolete replacement/,
    );
    await capture("restored-private-journal");
    await navigate(page, "guide");
    await page.locator("[data-command=reset]").click();
    await page.waitForFunction(() => state.profiles.length === 0);
    assert.equal(await page.locator("[data-map-point]").count(), 0);
    assert.deepEqual(await page.evaluate(() => AdventureMap.options("p")), {
      layers: {},
    });
    checks.push(
      "actual isolated import / preview-confirmed recovery / reset retire preferences and late geometry",
    );
    await app.close();
    app = null;
    // Damaged optional authorities are injected before the actual main starts.
    const badDir = path.join(dir, "bad-reference-profile");
    await fs.mkdir(badDir);
    await fs.writeFile(
      path.join(badDir, "state.json"),
      JSON.stringify(require("../tests/adventure-map-fixture.cjs").seed()),
    );
    const badLaunch = await syntheticLaunch(badDir),
      badEntry = path.join(badLaunch, "main.cjs");
    let badBoot = await fs.readFile(badEntry, "utf8");
    badBoot = badBoot.replace(
      "load('./src/main.cjs');",
      "load('./src/core/acquisition-data.cjs').loadAcquisitionPack=()=>{throw Error('Synthetic damaged optional reference')};load('./src/core/vendor-facts.cjs').loadVendorPack=()=>{throw Error('Synthetic damaged optional reference')};load('./src/main.cjs');",
    );
    await fs.writeFile(badEntry, badBoot);
    app = await electron.launch({
      args: [badLaunch],
      env: { ...process.env, BF_USER_DATA: badDir },
    });
    page = await testWindow(app);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator("[data-command=setup-defer]").click();
    await navigate(page, "adventure-map");
    await page.locator(".map-mark.find").waitFor();
    const damaged = await page.evaluate(() => api.adventureMap("p", {}));
    assert.equal(damaged.references.acquisition.status, "unavailable");
    assert.equal(damaged.references.sellers.status, "unavailable");
    assert.equal(await page.locator(".map-mark.quest").count(), 1);
    assert.equal(await page.locator(".map-mark.material").count(), 0);
    await capture("damaged-reference-keeps-observations");
    checks.push(
      "prebootstrap damaged references preserve actual saved quest and personal geometry",
    );
    const broken = await page
      .locator("img")
      .evaluateAll((ns) =>
        ns.filter((n) => !n.complete || n.naturalWidth === 0).map((n) => n.src),
      );
    assert.deepEqual(broken, []);
    assert.deepEqual(errors, []);
    const captures = [];
    for (const file of (await fs.readdir(captureRoot)).filter((n) =>
      n.endsWith(".png"),
    )) {
      const bytes = await fs.readFile(path.join(captureRoot, file));
      captures.push({
        file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await fs.writeFile(
      path.join(captureRoot, "manifest.json"),
      JSON.stringify(
        {
          synthetic: true,
          externalSurfaces:
            "prebootstrap fakes; automatic app/reference starts off",
          realGame: false,
          checks,
          errors,
          captures,
        },
        null,
        2,
      ),
    );
    console.log(
      "Adventure Map actual Electron PASS: " +
        checks.length +
        " gates; " +
        captures.length +
        " native captures; " +
        captureRoot,
    );
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: path.join(captureRoot, "FAILED.png") })
        .catch(() => {});
    throw e;
  } finally {
    clearTimeout(watchdog);
    await app?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
