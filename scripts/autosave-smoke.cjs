"use strict";
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { testWindow, launch } = require("./test-window.cjs");
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "bf-autosave-"));
  let app, page;
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET")
        res.end(
          JSON.stringify({
            models: [{ name: "fixture-one" }, { name: "fixture-two" }],
          }),
        );
      else {
        requests.push(JSON.parse(body));
        res.end(
          JSON.stringify({
            message: { content: "Synthetic character-aware reply" },
          }),
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    app = await launch(electron, {
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    page = await testWindow(app);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("backstage:listModels");
      ipcMain.handle("backstage:listModels", async () => ({
        models: [
          { id: "fixture-one", label: "Fixture one" },
          { id: "fixture-two", label: "Fixture two" },
        ],
        source: "Synthetic UI fixture",
        checkedAt: Date.now(),
        message: "Synthetic catalog; no cloud account used.",
      }));
    });
    await page
      .getByRole("button", { name: "Use a manual character", exact: true })
      .click();
    await page.getByLabel("Character name").fill("Autosave Hero");
    await page.getByLabel("Realm", { exact: true }).fill("Synthetic Realm");
    await page
      .getByRole("button", { name: "Begin my adventure", exact: true })
      .click();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByLabel("Race", { exact: true }).fill("Sunborn");
    await page.getByLabel("Race", { exact: true }).blur();
    await page.locator('select[name="faction"]').selectOption("Horde");
    await page.getByLabel("Private notes").fill("PRIVATE AUTOSAVE JOURNAL");
    await navigate(page, "connections");
    const savedCharacter = (
      await page.evaluate(() => window.backstage.bootstrap())
    ).state.profiles[0];
    assert.equal(savedCharacter.race, "Sunborn");
    assert.equal(savedCharacter.faction, "Horde");
    assert.equal(savedCharacter.notes, "PRIVATE AUTOSAVE JOURNAL");
    await page.locator('input[name="endpoint"]').fill(endpoint);
    await page.locator('input[name="endpoint"]').blur();
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .click();
    await page.getByLabel("Available models").selectOption("fixture-two");
    // Deliberately navigate immediately: no Save connection click and no artificial wait.
    await navigate(page, "assistant");
    const selected = (await page.evaluate(() => window.backstage.bootstrap()))
      .state.provider;
    assert.equal(selected.model, "fixture-two");
    assert.equal(selected.endpoint, endpoint);
    assert.match(await page.locator(".context-preview").innerText(), /Sunborn/);
    assert.match(await page.locator(".context-preview").innerText(), /Horde/);
    const prompt = page.getByLabel("Your question");
    await prompt.fill("Where should I quest next?");
    await prompt.press("Shift+Enter");
    await prompt.type("Use my actual character.");
    assert.match(await prompt.inputValue(), /\n/);
    assert.equal(requests.length, 0);
    await prompt.press("Enter");
    await page
      .getByRole("log", { name: "Conversation", exact: true })
      .getByText("Synthetic character-aware reply", { exact: true })
      .waitFor();
    assert.equal(requests.length, 1);
    const text = JSON.stringify(requests[0]);
    assert.match(text, /Sunborn/);
    assert.match(text, /Horde/);
    assert.doesNotMatch(text, /PRIVATE AUTOSAVE JOURNAL/);
    await navigate(page, "connections");
    await page
      .getByRole("button", { name: "Ollama Cloud", exact: true })
      .click();
    await page.getByRole("heading",{name:"Ollama Cloud connection",exact:true}).waitFor();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("backstage:listModels");
      ipcMain.handle(
        "backstage:listModels",
        () =>
          new Promise((resolve) => {
            globalThis.fixtureSlowCatalog = resolve;
          }),
      );
    });
    await page
      .locator('input[name="apiKey"]')
      .fill("synthetic-key-for-encryption-only");
    await page.locator('input[name="apiKey"]').blur();
    await navigate(page, "assistant");
    await page
      .getByRole("heading", {
        name: "Ask about WoW Forever",
        exact: true,
      })
      .waitFor({ timeout: 2000 });
    const cloud = await page.evaluate(() => window.backstage.bootstrap());
    assert.equal(cloud.secretStatus["ollama-cloud"], true);
    assert.doesNotMatch(
      JSON.stringify(cloud),
      /synthetic-key-for-encryption-only/,
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(data, "credentials.json"), "utf8"),
      /synthetic-key-for-encryption-only/,
    );
    console.log(
      "PASS: character text/select autosave, notes survive immediate navigation, model auto-saves without Save connection, Enter/Shift+Enter, arbitrary race/faction in actual request, private notes excluded, cloud key encrypted on blur.",
    );
    await app.evaluate(() =>
      globalThis.fixtureSlowCatalog?.({
        models: [],
        source: "Synthetic delayed catalog",
        checkedAt: Date.now(),
        message: "No inference sent.",
      }),
    );
  } catch (error) {
    if (page) {
      console.error(await page.locator("body").innerText());
      console.error("Synthetic request count:", requests.length);
      await page.screenshot({
        path: path.join(__dirname, "../work/autosave-failure.png"),
      });
    }
    throw error;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
