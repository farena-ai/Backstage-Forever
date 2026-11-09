"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "bf-setup-"));
  let app;
  try {
    const game = path.join(data, "synthetic-client"),
      exportFile = path.join(
        game,
        "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua",
      );
    await fs.mkdir(path.dirname(exportFile), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
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
    await app.evaluate(({ app, dialog }, root) => {
      const p = process.getBuiltinModule("node:path"),
        r = process
          .getBuiltinModule("node:module")
          .createRequire(p.join(app.getAppPath(), "package.json"));
      r("./src/core/game-sync.cjs").GameSync.prototype.discover =
        async () => [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, game);
    await page
      .getByRole("heading", { name: "Set up your companion", exact: true })
      .waitFor({ timeout: 10000 });
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
    await page.waitForFunction(()=>innerWidth<=1000);
    const actionBounds = await page
      .getByRole("button", { name: "Set up my companion", exact: true })
      .boundingBox();
    assert.ok(
      actionBounds.y + actionBounds.height <=
        (await page.evaluate(() => innerHeight)),
      "Primary setup action is visible without scrolling",
    );
    await page
      .getByRole("button", { name: "Set up my companion", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Load your character in WoW", exact: true })
      .waitFor();
    for (const name of [
      "BackstageForever.toc",
      "BackstageForever.lua",
      "BackstageForeverHUD.lua",
    ])
      assert.ok(
        (
          await fs.readFile(
            path.join(game, "Interface/AddOns/BackstageForever", name),
            "utf8",
          )
        ).length > 0,
      );
    const now = Date.now() / 1000;
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
      .getByRole("heading", { name: "Your companion is ready", exact: true })
      .waitFor({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Enter my adventure", exact: true })
      .click();
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
    await page
      .getByRole("button", { name: "Game Connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Set up my companion", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your companion is ready", exact: true })
      .waitFor();
    const otherGame = path.join(data, "another-client");
    await fs.mkdir(path.join(otherGame, "WTF", "Account"), { recursive: true });
    await fs.writeFile(path.join(otherGame, ".flavor.info"), "wowf");
    await page.evaluate(
      (root) => window.backstage.connectGame(root),
      otherGame,
    );
    await page
      .getByRole("heading", { name: "Load your character in WoW", exact: true })
      .waitFor({ timeout: 10000 });
    assert.equal(
      (await page.evaluate(() => window.backstage.bootstrap())).state.profiles
        .length,
      1,
    );
    assert.deepEqual(cspErrors, []);
    console.log(
      "PASS: first-run companion journey, automatic three-file addon preparation, actionable reload step, auto-import, quest/XP briefing, explicit AI action without inference, reduced motion and reopenable setup.",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
