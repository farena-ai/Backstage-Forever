const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");

(async () => {
  const data = await fs.mkdtemp(
    path.join(os.tmpdir(), "backstage-integration-"),
  );
  let app, waitingResponse, resolveRequest;
  const received = new Promise((resolve) => (resolveRequest = resolve));
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "fixture" }] }));
      return;
    }
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      waitingResponse = response;
      resolveRequest(JSON.parse(text));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    app = await launchElectron(electron, {
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const encryptedFixture = await app.evaluate(({ safeStorage }) => {
      const fixture = {
        clientId: "oaiapp_test",
        subject: "fixture-account",
        email: "fixture@example.invalid",
        tokens: {
          access_token: "fixture-not-a-real-token",
          refresh_token: "fixture-not-a-real-refresh-token",
          expiresAt: Date.now() + 3600000,
          scopes: ["chatgpt.tokens.use.direct"],
        },
      };
      return safeStorage
        .encryptString(JSON.stringify(fixture))
        .toString("base64");
    });
    await fs.writeFile(
      path.join(data, "chatgpt-credentials.json"),
      JSON.stringify({ encrypted: encryptedFixture }),
    );
    await app.close();
    app = null;
    app = await launchElectron(electron, {
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await testWindow(app);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "manual"));
    await page.reload();
    const initial = await page.evaluate(() => window.backstage.bootstrap());
    assert.equal(initial.subscriptionStatus.openai.connected, true);
    const state = {
      ...initial.state,
      onboarded: true,
      activeProfileId: "fixture",
      profiles: [
        {
          id: "fixture",
          name: "Integration Hero",
          realm: "Test Realm",
          className: "Hunter",
          level: 12,
          notes: "PRIVATE JOURNAL",
          goals: [{ id: "goal", text: "PRIVATE GOAL", done: false }],
        },
      ],
    };
    await page.evaluate((next) => window.backstage.saveState(next), state);
    await page.evaluate(() =>
      window.backstage.saveProvider({
        provider: "openai",
        model: "fixture-model",
        authMode: "api",
        apiKey: "test-backstage-private-key",
      }),
    );
    const bootstrap = await page.evaluate(() => window.backstage.bootstrap());
    assert.equal(bootstrap.secretStatus.openai, true);
    assert.doesNotMatch(
      JSON.stringify(bootstrap),
      /test-backstage-private-key/,
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(data, "credentials.json"), "utf8"),
      /test-backstage-private-key/,
    );
    const backup = path.join(data, "backup.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backup);
    await page.evaluate(() => window.backstage.exportData());
    const exported = await fs.readFile(backup, "utf8");
    assert.match(exported, /PRIVATE JOURNAL/);
    assert.doesNotMatch(
      exported,
      /test-backstage-private-key|access_token|refresh_token/,
    );
    const invalid = path.join(data, "invalid.json");
    await fs.writeFile(invalid, "{invalid");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, invalid);
    await assert.rejects(page.evaluate(() => window.backstage.importData()));
    assert.equal(
      (await page.evaluate(() => window.backstage.bootstrap())).state
        .profiles[0].name,
      "Integration Hero",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await page.evaluate(() => window.backstage.importData());
    assert.equal(
      (await page.evaluate(() => window.backstage.bootstrap())).secretStatus
        .openai,
      true,
    );
    await page.evaluate(
      (endpoint) =>
        window.backstage.saveProvider({
          provider: "ollama",
          model: "fixture",
          authMode: "api",
          endpoint,
        }),
      `http://127.0.0.1:${server.address().port}`,
    );
    await page.reload();
    const refusal = await page.evaluate(() =>
      window.backstage.ask({
        provider: "ollama",
        prompt: "Build a React app",
        shareProfile: false,
      }),
    );
    assert.match(refusal, /World of Warcraft/);
    assert.equal(waitingResponse, undefined);
    const catalog = await page.evaluate(
      (endpoint) =>
        window.backstage.listModels({
          provider: "ollama",
          endpoint,
          refresh: true,
        }),
      `http://127.0.0.1:${server.address().port}`,
    );
    assert.equal(catalog.models[0].id, "fixture");
    await navigate(page, "assistant");
    await page
      .getByLabel("Your question")
      .fill("Which dungeon should I try next? A delayed fixture question");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    const request = await received;
    assert.doesNotMatch(
      JSON.stringify(request),
      /PRIVATE JOURNAL|PRIVATE GOAL/,
    );
    assert.match(JSON.stringify(request), /Integration Hero/);
    assert.match(JSON.stringify(request), /World of Warcraft: Forever/);
    await navigate(page, "guide");
    const gameRoot = path.join(data, "synthetic-client");
    const snapshotFile = path.join(
      gameRoot,
      "WTF",
      "Account",
      "Synthetic",
      "SavedVariables",
      "BackstageForever.lua",
    );
    await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
    await fs.writeFile(path.join(gameRoot, ".flavor.info"), "wowf");
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () =>
        new Promise((resolve) => {
          globalThis.fixtureConnectDialog = resolve;
        });
    });
    await page.evaluate(() => {
      window.pendingConnect = window.backstage.connectGame();
    });
    for (let i = 0; i < 50; i++) {
      if (await app.evaluate(() => Boolean(globalThis.fixtureConnectDialog)))
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await page
      .getByRole("button", { name: "Delete all local data", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use a manual character", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    await app.evaluate(
      (_electron, root) =>
        globalThis.fixtureConnectDialog({ canceled: false, filePaths: [root] }),
      gameRoot,
    );
    await page.evaluate(() => window.pendingConnect);
    assert.equal(
      (await page.evaluate(() => window.backstage.gameStatus())).connected,
      false,
    );
    await assert.rejects(
      fs.stat(path.join(data, "game-connection.private.json")),
      { code: "ENOENT" },
    );
    waitingResponse.writeHead(200, { "Content-Type": "application/json" });
    waitingResponse.end(
      JSON.stringify({ message: { content: "STALE PRIVATE REPLY" } }),
    );
    await page.getByLabel("Character name").fill("Fresh Hero");
    await page.getByLabel("Realm").fill("New Realm");
    await page.getByRole("button", { name: "Begin my adventure" }).click();
    await navigate(page, "assistant");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .waitFor();
    assert.doesNotMatch(
      await page.getByRole("log").innerText(),
      /STALE PRIVATE REPLY|delayed fixture/,
    );
    const cleared = await page.evaluate(() => window.backstage.bootstrap());
    assert.equal(cleared.secretStatus.openai, false);
    assert.equal(cleared.state.profiles[0].name, "Fresh Hero");
    await navigate(page, "connections");
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByText("Not signed in", { exact: true }).waitFor();
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /fixture@example.invalid/,
    );
    await page.evaluate((root) => window.backstage.connectGame(root), gameRoot);
    const installed = await page.evaluate(() =>
      window.backstage.installGameAddon(),
    );
    assert.equal(installed.gameStatus.addonInstalled, true);
    const shot = {
      schema: 1,
      activeId: "Player-Fixture",
      observedAt: Date.now() / 1000,
      characters: [
        {
          id: "Player-Fixture",
          name: "Snapshot Hero",
          realm: "Example Realm",
          className: "Mage",
          level: 15,
          faction: "Horde",
          location: { zone: "Test Forest", subZone: "" },
          updatedAt: Date.now() / 1000,
        },
      ],
    };
    const writeShot = () =>
      fs.writeFile(
        snapshotFile,
        "BackstageForeverExport = " + JSON.stringify(JSON.stringify(shot)),
      );
    await writeShot();
    const synced = await page.evaluate(() => window.backstage.refreshGame());
    assert.equal(synced.state.profiles.length, 2);
    assert.equal(
      synced.state.profiles.find((p) => p.id === synced.state.activeProfileId)
        .name,
      "Snapshot Hero",
    );
    shot.characters.push({
      ...shot.characters[0],
      id: "Player-Second",
      name: "Second Snapshot",
      level: 20,
    });
    shot.activeId = "Player-Second";
    shot.observedAt += 1;
    const staleJournal = structuredClone(synced.state);
    staleJournal.profiles.find((p) => p.name === "Snapshot Hero").notes =
      "Journal during a newer import";
    await writeShot();
    const concurrent = await page.evaluate(() =>
      window.backstage.refreshGame(),
    );
    const preserved = await page.evaluate(
      ({ edit, base }) => window.backstage.saveState(edit, base),
      { edit: staleJournal, base: synced.state },
    );
    assert.equal(preserved.profiles.length, 3);
    assert.equal(preserved.activeProfileId, concurrent.state.activeProfileId);
    assert.equal(preserved.followGameCharacter, undefined);
    const freshId = synced.state.profiles.find(
      (p) => p.name === "Fresh Hero",
    ).id;
    await page.evaluate((next) => window.backstage.saveState(next), {
      ...preserved,
      activeProfileId: freshId,
    });
    shot.characters[0].level = 16;
    shot.characters[0].updatedAt += 2;
    shot.observedAt += 2;
    await writeShot();
    const newer = await page.evaluate(() => window.backstage.refreshGame());
    assert.equal(newer.state.activeProfileId, freshId);
    assert.equal(
      newer.state.profiles.find((p) => p.name === "Snapshot Hero").level,
      16,
    );
    assert.equal(newer.state.followGameCharacter, false);
    await page.evaluate(() => window.backstage.disconnectGame());
    console.log(
      "PASS: OS-encrypted key, no secret readback/export, native backup/import handlers, invalid import recovery, preserved keys, local protocol fixture, privacy payload, reset clears keys and suppresses late replies.",
    );
  } finally {
    if (waitingResponse && !waitingResponse.writableEnded)
      waitingResponse.end();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
