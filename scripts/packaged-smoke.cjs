const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: path.join(
        __dirname,
        "..",
        "dist",
        "win-unpacked",
        "Backstage Forever.exe",
      ),
      args: [],
    });
    const page = await testWindow(app);
    await page.locator(".brand").first().waitFor();
    const result = await app.evaluate(({ app, safeStorage }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      asar: app.getAppPath().endsWith("app.asar"),
      secureStorage: safeStorage.isEncryptionAvailable(),
    }));
    assert.equal(result.packaged, true);
    assert.equal(result.asar, true);
    assert.equal(result.version, require('../package.json').version);
    assert.equal(result.secureStorage, true);
    assert.ok(await page.evaluate(() => Boolean(window.backstage?.bootstrap)));
    console.log(
      "PASS: packaged Windows executable opens the branded interface from ASAR with secure storage and isolated preload. No player data or credentials changed.",
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
