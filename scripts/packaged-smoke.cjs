const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os");
const { testWindow } = require("./test-window.cjs");
(async () => {
  let app;
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "backstage-packaged-"));
  try {
    app = await electron.launch({
      executablePath: path.join(
        __dirname,
        "..",
        "dist",
        "win-unpacked",
        "Backstage Forever.exe",
      ),
      args: ["--user-data-dir=" + data],
    });
    const page = await testWindow(app);
    await page.locator(".brand").first().waitFor();
    const result = await app.evaluate(({ app, safeStorage }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      asar: app.getAppPath().endsWith("app.asar"),
      secureStorage: safeStorage.isEncryptionAvailable(),
      userData: app.getPath("userData"),
    }));
    assert.equal(result.packaged, true);
    assert.equal(result.asar, true);
    assert.equal(result.version, require("../package.json").version);
    assert.equal(result.secureStorage, true);
    assert.equal(path.resolve(result.userData), path.resolve(data));
    assert.ok(await page.evaluate(() => Boolean(window.backstage?.bootstrap)));
    const sdk = await app.evaluate(async ({ app }) => {
      const path = process.getBuiltinModule("node:path");
      const requireFromApp = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
      const core = requireFromApp("@anthropic-ai/claude-agent-sdk/core");
      return typeof core.query;
    });
    assert.equal(sdk, "function");
    console.log(
      "PASS: packaged Windows executable opens the branded interface from ASAR with secure storage and isolated preload. No player data or credentials changed.",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
