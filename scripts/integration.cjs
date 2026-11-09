const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");

(async () => {
  const data = await fs.mkdtemp(
    path.join(os.tmpdir(), "backstage-integration-"),
  );
  let app, waitingResponse, resolveRequest;
  const received = new Promise((resolve) => (resolveRequest = resolve));
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      waitingResponse = response;
      resolveRequest(JSON.parse(text));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    app = await electron.launch({
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
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await testWindow(app);
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
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
    await page.getByLabel("Your question").fill("A delayed fixture question");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    const request = await received;
    assert.doesNotMatch(
      JSON.stringify(request),
      /PRIVATE JOURNAL|PRIVATE GOAL|Integration Hero/,
    );
    await page
      .getByRole("button", { name: "Field Guide", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete all local data", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    waitingResponse.writeHead(200, { "Content-Type": "application/json" });
    waitingResponse.end(
      JSON.stringify({ message: { content: "STALE PRIVATE REPLY" } }),
    );
    await page.getByLabel("Character name").fill("Fresh Hero");
    await page.getByLabel("Realm").fill("New Realm");
    await page.getByRole("button", { name: "Begin my adventure" }).click();
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
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
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByText("Not signed in", { exact: true }).waitFor();
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /fixture@example.invalid/,
    );
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
