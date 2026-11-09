const { _electron: electron } = require("playwright");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "backstage-smoke-"));
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await testWindow(app);
    page.on("pageerror", (error) =>
      console.error("Renderer error:", error.message),
    );
    await page.waitForLoadState("domcontentloaded");
    return page;
  };
  try {
    let page = await launch();
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("backstage:listModels");
      ipcMain.handle("backstage:listModels", async () => ({
        models: [
          { id: "fixture-model-one", label: "Fixture model one" },
          { id: "fixture-model-two", label: "Fixture model two" },
        ],
        source: "Synthetic UI fixture",
        checkedAt: new Date().toISOString(),
        message: "Catalog fixture; no entitlement claim.",
      }));
    });
    await page.getByLabel("Character name").fill("Smoke Ranger");
    await page.getByLabel("Realm").fill("Test Realm");
    await page.locator("select[name=faction]").selectOption("Alliance");
    await page.getByRole("button", { name: "Begin my adventure" }).click();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("body").getAttribute("data-faction"),
      "alliance",
    );
    assert.equal(
      await page.locator("body").getAttribute("data-class"),
      "hunter",
    );
    await page.getByLabel("New goal").fill("Prepare for a dungeon");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByRole("checkbox", { name: "Prepare for a dungeon" }).check();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Prepare for a dungeon" })
        .isChecked(),
      true,
    );
    await page.getByLabel("New goal").fill("   ");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByLabel("New goal").fill("A second valid goal");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByRole("checkbox", { name: "A second valid goal" }).waitFor();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page
      .getByLabel("Private notes")
      .fill("<img src=x onerror=alert(1)> My private journal");
    await page.getByRole("button", { name: "Save character" }).click();
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Use my active character").isChecked(),
      true,
    );
    await page.getByLabel("Use my active character").uncheck();
    await page
      .getByRole("button", { name: "Game Connection", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Bring your adventure home." })
      .waitFor();
    await page
      .getByText(
        "Levelled up or changed areas? Type /reload in WoW to refresh your companion.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Choose game folder", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Choose your intelligence." })
      .waitFor();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByLabel("Access method").selectOption("subscription");
    await page
      .getByRole("button", { name: "Continue with ChatGPT", exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("API key", { exact: true }).count(), 0);
    await page.getByLabel("Access method").selectOption("api");
    await page.getByLabel("API key", { exact: true }).waitFor();
    await page.getByLabel("Available models").waitFor();
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .waitFor();
    await page
      .getByRole("option", { name: "Fixture model one", exact: true })
      .waitFor({ state: "attached" });
    assert.equal(await page.getByLabel("Available models").inputValue(), "");
    await page.getByLabel("Available models").selectOption("fixture-model-two");
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .click();
    await page
      .getByText("Catalog fixture; no entitlement claim.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByLabel("Available models").inputValue(),
      "fixture-model-two",
    );
    await page
      .getByRole("button", { name: "Ollama Cloud", exact: true })
      .click();
    assert.equal(await page.getByLabel("Access method").count(), 0);
    await page.getByLabel("API key", { exact: true }).waitFor();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page
      .getByText("A ChatGPT subscription is not an API key.", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "Field Guide", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "A little guidance. A longer adventure." })
      .waitFor();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await page
      .getByRole("heading", { name: "Keep your companion ready." })
      .waitFor();
    await page
      .getByRole("checkbox", {
        name: "Automatically check and download updates",
      })
      .uncheck();
    await page
      .getByText("Automatic update checks are off.", { exact: false })
      .waitFor();
    await app.close();
    app = null;
    page = await launch();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "Automatically check and download updates",
        })
        .isChecked(),
      false,
    );
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Use my active character").isChecked(),
      false,
    );
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Prepare for a dungeon" })
        .isChecked(),
      true,
    );
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    assert.match(
      await page.getByLabel("Private notes").inputValue(),
      /<img src=x/,
    );
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page
      .getByLabel("Private notes")
      .fill("Unsaved draft must survive a snapshot refresh");
    await page.evaluate(async () => {
      const { state } = await window.backstage.bootstrap();
      const character = state.profiles.find(
        (p) => p.id === state.activeProfileId,
      );
      Object.assign(character, {
        className: "Mage",
        level: 22,
        faction: "Horde",
        race: "Synthetic race",
        location: { zone: "Synthetic Highlands", subZone: "Fixture Camp" },
        source: {
          kind: "wow-addon",
          id: "synthetic-ui-fixture",
          updatedAt: new Date().toISOString(),
        },
      });
      state.profiles.push({
        ...structuredClone(character),
        id: "fixture-alt",
        name: "Snapshot Alt",
        notes: "Alt journal must stay separate",
        goals: [],
        source: { ...character.source, id: "synthetic-ui-alt" },
      });
      state.activeProfileId = "fixture-alt";
      await window.backstage.saveState(state);
    });
    await page.waitForTimeout(5300);
    assert.equal(
      await page.getByLabel("Private notes").inputValue(),
      "Unsaved draft must survive a snapshot refresh",
    );
    assert.equal(
      await page.getByLabel("Character name").inputValue(),
      "Smoke Ranger",
    );
    await page
      .getByRole("button", { name: "Save character", exact: true })
      .click();
    const merged = await page.evaluate(
      async () => (await window.backstage.bootstrap()).state,
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Smoke Ranger").notes,
      "Unsaved draft must survive a snapshot refresh",
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Snapshot Alt").notes,
      "Alt journal must stay separate",
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Smoke Ranger").level,
      22,
    );
    assert.equal(merged.activeProfileId, "fixture-alt");
    assert.equal(merged.followGameCharacter, undefined);
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    assert.equal(await page.locator("body").getAttribute("data-class"), "mage");
    assert.equal(
      await page.locator("body").getAttribute("data-faction"),
      "horde",
    );
    await page.getByRole("button", { name: /Synthetic Highlands/ }).waitFor();
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
    await page
      .getByText("Public character context:", { exact: false })
      .waitFor();
    assert.match(
      await page.locator(".context-preview").innerText(),
      /Synthetic Highlands/,
    );
    assert.doesNotMatch(
      await page.locator(".context-preview").innerText(),
      /private journal|Unsaved draft/,
    );
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    assert.equal(
      await page.getByLabel("Character name").getAttribute("readonly"),
      "",
    );
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await page.screenshot({
      path: path.join(__dirname, "..", "work", "desktop-preview.png"),
    });
    console.log(
      "PASS: onboarding, profile, goal, private notes, character context default/opt-out, catalog choice preservation, faction/class theming, snapshot draft preservation, read-only imported fields, provider navigation, guide, restart persistence, safe text rendering.",
    );
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      console.error(await page.locator("body").innerText());
      await page.screenshot({
        path: path.join(__dirname, "..", "work", "smoke-failure.png"),
      });
    }
    throw error;
  } finally {
    if (app) await app.close();
    await rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
