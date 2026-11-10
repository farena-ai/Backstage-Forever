const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os");
const crypto = require("node:crypto");
const { testWindow } = require("./test-window.cjs");
async function sourceFiles(folder, prefix = "src") {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(
        ...(await sourceFiles(path.join(folder, entry.name), relative)),
      );
    else if (entry.isFile() && /\.(?:cjs|js|css|html|ps1|cs)$/.test(entry.name))
      result.push(relative);
  }
  return result;
}
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
    const reference = await page.evaluate(() =>
      window.backstage.knowledgeStatus(),
    );
    const bundled = JSON.parse(
      await fs.readFile(
        path.join(__dirname, "../data/forever/pack.json"),
        "utf8",
      ),
    );
    assert.equal(reference.packBuild, bundled.build);
    assert.equal(reference.sourceCommit, bundled.sourceCommit);
    assert.equal(reference.counts.quests, bundled.counts.quests);
    assert.equal(
      reference.counts.observedQuests,
      bundled.counts.observedQuests,
    );
    const details = await page.evaluate(() =>
      window.backstage.questDetails(null, 1061),
    );
    assert.equal(details.status, "reference");
    assert.equal(details.record.nextQuestId, 1062);
    assert.equal(details.turnIns[0].name, "Seereth Stonebreak");
    assert.equal(
      details.waypoint.canCopy,
      false,
      "Reference browsing without a character must not enable game commands",
    );
    const ownFiles = await sourceFiles(path.join(__dirname, "../src"));
    ownFiles.push(
      "data/forever/pack.json",
      "data/forever/source-lock.json",
      "data/forever/NOTICE",
      "data/forever/LICENSE",
      "data/forever-vendors/pack.json",
      "data/forever-vendors/source-lock.json",
      "data/forever-vendors/NOTICE",
      "data/forever-vendors/LICENSE",
      "data/forever-insights/pack.json",
      "data/forever-insights/source-lock.json",
      "data/forever-insights/NOTICE",
      "data/forever-insights/LICENSE",
      "assets/update-public-key.pem",
    );
    const expected = await Promise.all(
      ownFiles.map(async (relative) => ({
        relative,
        sha256: crypto
          .createHash("sha256")
          .update(await fs.readFile(path.join(__dirname, "..", relative)))
          .digest("hex"),
      })),
    );
    const sourceMatch = await app.evaluate(({ app }, rows) => {
      const fs = process.getBuiltinModule("node:fs");
      const path = process.getBuiltinModule("node:path");
      const crypto = process.getBuiltinModule("node:crypto");
      const mismatches = [];
      for (const row of rows) {
        try {
          const actual = crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(app.getAppPath(), row.relative)))
            .digest("hex");
          if (actual !== row.sha256) mismatches.push(row.relative);
        } catch {
          mismatches.push(row.relative);
        }
      }
      return { checked: rows.length, mismatches };
    }, expected);
    assert.equal(sourceMatch.checked, expected.length);
    assert.deepEqual(
      sourceMatch.mismatches,
      [],
      "Packaged source, reference data, notices and pinned update key must match reviewed source bytes",
    );
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
      "BackstageForeverReference.lua",
      "BackstageForeverPlan.lua",
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
    await fs.unlink(path.join(addonFolder, "BackstageForeverReference.lua"));
    await fs.writeFile(path.join(addonFolder, "BackstageForeverPlan.lua"), "synthetic obsolete planner");
    app = await electron.launch({
      executablePath: path.join(
        __dirname,
        "../dist/win-unpacked/Backstage Forever.exe",
      ),
      args: ["--user-data-dir=" + data],
    });
    const reopened = await testWindow(app);
    let restored;
    for (let attempt = 0; attempt < 100; attempt++) {
      restored = await reopened.evaluate(() => window.backstage.gameStatus());
      if (restored.addonCurrent) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      restored.addonCurrent,
      true,
      "Startup must finish verifying the repaired addon",
    );
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
      `PASS: isolated packaged Windows startup, ${sourceMatch.checked} reviewed source/data/key byte matches, offline quest reference, SDK loading, automatic ${owned.length}-file addon install/readback and startup repair preserving unrelated files. No player data or credentials changed.`,
    );
  } finally {
    if (app) await app.close();
    const resolved = await fs.realpath(data);
    const relative = path.relative(await fs.realpath(os.tmpdir()), resolved);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
    assert.ok(path.basename(resolved).startsWith("backstage-packaged-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
