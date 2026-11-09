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
    const gameRoot = path.join(data, "synthetic-client");
    await fs.mkdir(path.join(gameRoot, "WTF", "Account"), { recursive: true });
    await fs.writeFile(path.join(gameRoot, ".flavor.info"), "wowf");
    const prepared = await page.evaluate(
      (root) => window.backstage.connectGame(root),
      gameRoot,
    );
    assert.equal(
      prepared.gameStatus.addonInstalled,
      true,
      "Packaged addon preparation must actually install its files",
    );
    const owned = [
      "BackstageForever.toc",
      "BackstageForever.lua",
      "BackstageForeverHUD.lua",
    ];
    for (const name of owned)
      assert.equal(
        await fs.readFile(
          path.join(gameRoot, "Interface", "AddOns", "BackstageForever", name),
          "utf8",
        ),
        await fs.readFile(
          path.join(__dirname, "../addon/BackstageForever", name),
          "utf8",
        ),
      );
    const addonFolder = path.join(
      gameRoot,
      "Interface",
      "AddOns",
      "BackstageForever",
    );
    await fs.writeFile(path.join(addonFolder, "player-extra.txt"), "preserve");
    await app.close();
    app = null;
    await fs.unlink(path.join(addonFolder, "BackstageForeverHUD.lua"));
    app = await electron.launch({
      executablePath: path.join(
        __dirname,
        "../dist/win-unpacked/Backstage Forever.exe",
      ),
      args: ["--user-data-dir=" + data],
    });
    const reopened = await testWindow(app);
    let restored;
    for (let attempt=0;attempt<100;attempt++) {
      restored=await reopened.evaluate(()=>window.backstage.gameStatus());
      if(restored.addonCurrent) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(restored.addonCurrent,true,"Startup must finish verifying the repaired addon");
    for (const name of owned)
      assert.equal(
        await fs.readFile(path.join(addonFolder, name), "utf8"),
        await fs.readFile(
          path.join(__dirname, "../addon/BackstageForever", name),
          "utf8",
        ),
      );
    assert.equal(
      await fs.readFile(path.join(addonFolder, "player-extra.txt"), "utf8"),
      "preserve",
    );
    console.log(
      "PASS: isolated packaged Windows startup, SDK loading, automatic three-file addon install/readback and startup repair preserving unrelated files. No player data or credentials changed.",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
