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
    await page.getByLabel("Character name").fill("Smoke Ranger");
    await page.getByLabel("Realm").fill("Test Realm");
    await page.getByRole("button", { name: "Begin my adventure" }).click();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
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
      await page.getByLabel("Include character details").isChecked(),
      false,
    );
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
    await page
      .getByText("A ChatGPT subscription is not an API key.", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "Field Guide", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "A little guidance. A longer adventure." })
      .waitFor();
    await page.getByRole('button',{name:'Updates',exact:true}).click();
    await page.getByRole('heading',{name:'Keep your companion ready.'}).waitFor();
    await page.getByRole('checkbox',{name:'Automatically check and download updates'}).uncheck();
    await page.getByText('Automatic update checks are off.',{exact:false}).waitFor();
    await app.close();
    app = null;
    page = await launch();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
    await page.getByRole('button',{name:'Updates',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Automatically check and download updates'}).isChecked(),false);
    await page.getByRole('button',{name:'Adventure',exact:true}).click();
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
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await page.screenshot({
      path: path.join(__dirname, "..", "work", "desktop-preview.png"),
    });
    console.log(
      "PASS: onboarding, profile, goal, private notes, privacy default, provider navigation, guide, restart persistence, safe text rendering.",
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
