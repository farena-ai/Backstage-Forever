const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "backstage-art-"));
  let app;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await testWindow(app);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("heading", { name: "Set up your companion", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "companion-setup-preview.png"),
    });
    await page
      .getByRole("button", { name: "Use a manual character", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "onboarding-preview.png"),
    });
    const initial = await page.evaluate(() => window.backstage.bootstrap());
    const demo = {
      ...initial.state,
      onboarded: true,
      activeProfileId: "demo",
      profiles: [
        {
          id: "demo",
          name: "Aeralyn",
          realm: "Demo realm · synthetic snapshot",
          faction: "Alliance",
          race: "Synthetic race",
          location: { zone: "Silverwood Highlands", subZone: "The old road" },
          source: {
            kind: "wow-addon",
            id: "synthetic-art-fixture",
            updatedAt: new Date().toISOString(),
          },
          className: "Hunter",
          level: 18,
          progress: { current: 13520, max: 21000, rested: 4000 },
          quests: [
            {
              id: 1001,
              title: "Demo: Supplies for the outpost",
              level: 18,
              zone: "Silverwood Highlands",
              complete: true,
              objectives: [
                { text: "Collect the supply crates: 6/6", done: true },
              ],
              destination: {
                mapId: 1,
                x: 0.48,
                y: 0.64,
                text: "Demo: Return to the outpost",
              },
            },
            {
              id: 1002,
              title: "Demo: Along the old road",
              level: 18,
              zone: "Silverwood Highlands",
              complete: false,
              objectives: [
                { text: "Find the missing scout: 0/1", done: false },
              ],
            },
          ],
          history: {
            completedCount: 42,
            recent: [
              {
                id: 999,
                title: "Demo: A welcome in the highlands",
                completedAt: Math.floor(Date.now() / 1000) - 300,
              },
            ],
          },
          notes:
            "Sample journal for a product screenshot. No real player data.",
          goals: [
            {
              id: "one",
              text: "Pack supplies for the next dungeon",
              done: true,
            },
            {
              id: "two",
              text: "Spend an evening exploring with friends",
              done: false,
            },
            { id: "three", text: "Choose a profession to learn", done: false },
          ],
        },
      ],
    };
    demo.profiles.push({
      ...structuredClone(demo.profiles[0]),
      id: "horde-demo",
      name: "Vaelric",
      faction: "Horde",
      className: "Mage",
      source: { ...demo.profiles[0].source, id: "synthetic-horde-art-fixture" },
    });
    const { createHash } = require("node:crypto");
    const rawIds = ["Synthetic-Alliance", "Synthetic-Horde"];
    demo.profiles.forEach((p, i) => {
      p.source.id = createHash("sha256")
        .update("BackstageForever:" + rawIds[i])
        .digest("hex");
    });
    await page.evaluate((state) => window.backstage.saveState(state), demo);
    const gameRoot = path.join(data, "synthetic-client"),
      snapshotFile = path.join(
        gameRoot,
        "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua",
      );
    await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
    await fs.writeFile(path.join(gameRoot, ".flavor.info"), "wowf");
    const shot = {
      schema: 1,
      activeId: rawIds[0],
      observedAt: Date.now() / 1000,
      characters: demo.profiles.map((p, i) => {
        const { source, notes, goals, ...character } = p;
        return { ...character, id: rawIds[i], updatedAt: Date.now() / 1000 };
      }),
    };
    await fs.writeFile(
      snapshotFile,
      "BackstageForeverExport = " + JSON.stringify(JSON.stringify(shot)),
    );
    await page.evaluate((root) => window.backstage.prepareGame(root), gameRoot);
    await page.reload();
    await page.getByRole("heading", { name: "Aeralyn", exact: true }).waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "desktop-preview.png"),
    });
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByLabel("Access method").selectOption("subscription");
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "connections-preview.png"),
    });
    await page
      .getByRole("button", { name: "Game Connection", exact: true })
      .click();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "game-connection-preview.png"),
    });
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "roster-preview.png"),
    });
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await page
      .getByRole("heading", { name: "Keep your companion ready." })
      .waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "updates-preview.png"),
    });
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 760),
    );
    await page.waitForFunction(() => window.innerWidth <= 1000);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "desktop-compact-preview.png"),
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    await page.getByLabel("Active character").selectOption("horde-demo");
    await page.getByRole("heading", { name: "Vaelric", exact: true }).waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) => image.decode().catch(() => {})),
      );
    });
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "horde-preview.png"),
    });
    console.log(
      "Captured original interface previews using a clearly labeled synthetic demo profile.",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
