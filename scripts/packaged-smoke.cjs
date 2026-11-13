const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os");
const crypto = require("node:crypto");
const { testWindow } = require("./test-window.cjs");
const { checkedPackagedRoot, closePackagedApp, cleanupPackagedRun } = require("./packaged-cleanup.cjs");
function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}
async function checkSdk(app, appDir) {
  const sdk = await app.evaluate(({ app }) => {
    const path = process.getBuiltinModule("node:path");
    const requireFromApp = process
      .getBuiltinModule("node:module")
      .createRequire(path.join(app.getAppPath(), "package.json"));
    const peers = ["@anthropic-ai/sdk", "@modelcontextprotocol/sdk/client/index.js", "zod"]
      .map((name) => ({ name, resolved: requireFromApp.resolve(name) }));
    const core = requireFromApp("@anthropic-ai/claude-agent-sdk/core");
    return { queryType: typeof core.query, peers };
  });
  assert.equal(sdk.queryType, "function");
  for (const peer of sdk.peers) {
    assert.ok(
      ["app.asar", "app.asar.unpacked"].some((name) =>
        isInside(path.join(appDir, "resources", name), peer.resolved)),
      `${peer.name} must resolve inside the copied application's resources: ${peer.resolved}`,
    );
    console.log(`Bundled peer: ${peer.name} -> ${peer.resolved}`);
  }
  return sdk;
}
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
  let app, successMessage;
  const repo = await fs.realpath(path.join(__dirname, ".."));
  const temp = await fs.realpath(os.tmpdir());
  const runRoot = await fs.mkdtemp(path.join(temp, "backstage-packaged-"));
  const appDir = path.join(runRoot, "app");
  const data = path.join(runRoot, "profile");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (["BF_USER_DATA", "NODE_PATH", "NODE_OPTIONS"].includes(key.toUpperCase()))
      delete env[key];
  const launchOptions = {
    executablePath: path.join(appDir, "Backstage Forever.exe"),
    cwd: appDir,
    args: ["--user-data-dir=" + data],
    env,
  };
  try {
    assert.ok(!isInside(repo, runRoot) && runRoot !== repo,
      "Packaged acceptance must run outside the development checkout");
    await checkedPackagedRoot(temp, runRoot);
    await fs.cp(path.join(repo, "dist", "win-unpacked"), appDir, { recursive: true });
    await fs.mkdir(path.join(data, "updates"), { recursive: true });
    await fs.mkdir(path.join(data, "knowledge-v1"), { recursive: true });
    await fs.writeFile(path.join(data, "updates", "preferences.json"),
      JSON.stringify({ automatic: false, installOnQuit: false }));
    await fs.writeFile(path.join(data, "knowledge-v1", "preferences.json"),
      JSON.stringify({ automatic: false, checked: {} }));
    // Synthetic journal fixtures can be seeded here, before the first launch.
    app = await electron.launch(launchOptions);
    const page = await testWindow(app);
    await page.locator(".brand").first().waitFor();
    const result = await app.evaluate(({ app, safeStorage }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      asar: app.getAppPath().endsWith("app.asar"),
      secureStorage: safeStorage.isEncryptionAvailable(),
      userData: app.getPath("userData"),
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      bfUserData: process.env.BF_USER_DATA,
    }));
    assert.equal(result.packaged, true);
    assert.equal(result.asar, true);
    assert.equal(result.version, require("../package.json").version);
    assert.equal(result.secureStorage, true);
    assert.equal(path.resolve(result.userData), path.resolve(data));
    assert.equal(path.resolve(result.cwd), path.resolve(appDir));
    assert.equal(result.bfUserData, undefined);
    assert.ok(isInside(path.join(appDir, "resources"), result.appPath));
    assert.ok(await page.evaluate(() => Boolean(window.backstage?.bootstrap)));
    const reference = await page.evaluate(() =>
      window.backstage.knowledgeStatus(),
    );
    assert.equal(reference.automatic, false);
    assert.equal((await page.evaluate(() => window.backstage.updateStatus())).automatic, false);
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
      "data/forever-travel/pack.json",
      "data/forever-travel/source-lock.json",
      "data/forever-travel/NOTICE",
      "data/forever-travel/LICENSE-CC-BY-4.0.txt",
      "assets/update-public-key.pem",
      "docs/THIRD-PARTY-NOTICES.md",
      "node_modules/@anthropic-ai/sdk/LICENSE",
      "node_modules/@anthropic-ai/sdk/LICENSE-MIT",
      "node_modules/@modelcontextprotocol/sdk/LICENSE",
      "node_modules/zod/LICENSE",
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
    const sdk = await checkSdk(app, appDir);
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
      "BackstageForeverAdvisorData.lua",
      "BackstageForeverPlan.lua",
    "BackstageForeverCoach.lua",
    "BackstageForeverAcquisition.lua",
    "BackstageForeverProfession.lua",
    "BackstageForeverGathering.lua",
    "BackstageForeverMapPlan.lua",
    "BackstageForeverMap.lua",
    "BackstageForeverAdvisorMap.lua",
    "BackstageForeverMap.xml",
      "BackstageForever.lua",
      "BackstageForeverHUD.lua",
      "BackstageForeverLive.lua",
      "BackstageForeverFind.lua",
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
    await closePackagedApp(app);
    app = null;
    await fs.unlink(path.join(addonFolder, "BackstageForeverHUD.lua"));
    await fs.unlink(path.join(addonFolder, "BackstageForeverCoach.lua"));
    await fs.unlink(path.join(addonFolder, "BackstageForeverAcquisition.lua"));
    await fs.unlink(path.join(addonFolder, "BackstageForeverProfession.lua"));
    for (const name of ["BackstageForeverGathering.lua", "BackstageForeverMapPlan.lua", "BackstageForeverMap.lua", "BackstageForeverMap.xml"]) await fs.unlink(path.join(addonFolder, name));
    await fs.unlink(path.join(addonFolder, "BackstageForeverReference.lua"));
    await fs.writeFile(path.join(addonFolder, "BackstageForeverPlan.lua"), "synthetic obsolete planner");
    app = await electron.launch(launchOptions);
    const reopened = await testWindow(app);
    const restarted = await app.evaluate(({ app }) => ({
      userData: app.getPath("userData"), cwd: process.cwd(),
    }));
    assert.equal(path.resolve(restarted.userData), path.resolve(data));
    assert.equal(path.resolve(restarted.cwd), path.resolve(appDir));
    assert.deepEqual(await checkSdk(app, appDir), sdk);
    let restored;
    for (let attempt = 0; attempt < 300; attempt++) {
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
    successMessage = `PASS: outside-checkout packaged Windows startup/restart with the same isolated profile, ${sourceMatch.checked} reviewed source/data/key byte matches, offline quest reference, real SDK core loading and ${sdk.peers.length} contained runtime peers, automatic ${owned.length}-file addon install/readback and startup repair preserving unrelated files. No player data or credentials changed.`;
  } finally {
    await cleanupPackagedRun({ app, temp, runRoot });
  }
  console.log(successMessage);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
