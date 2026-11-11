"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { _electron: electron } = require("playwright");
const { defaultState } = require("../src/core/validation.cjs");
const { testWindow } = require("../scripts/test-window.cjs");
const { navigate } = require("../scripts/player-navigation.cjs");
const { waitForCompanyTitleFocus } = require("../scripts/company-fixture.cjs");

async function isolated(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bf-ui-timing-"));
  let app;
  try {
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true,
      profiles: [
        { id: "fiction", name: "Fictional timing adventurer", className: "Mage", realm: "Fictional Realm", faction: "Alliance", level: 12, goals: [], notes: "" },
        { id: "fiction2", name: "Fictional second adventurer", className: "Warrior", realm: "Fictional Realm", faction: "Horde", level: 18, goals: [], notes: "" },
      ], activeProfileId: "fiction" }));
    const repo = path.join(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fictional-timing", version: require("../package.json").version, main: "fixture.cjs" }));
    await fs.writeFile(path.join(dir, "fixture.cjs"), `
      const load = require("node:module").createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({state:"not-running",launchAvailable:false});
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch = async () => {throw Error("Fixture blocks launch");};
      load("./src/core/game-sync.cjs").GameSync.prototype.discover = async () => [];
      load("./src/core/providers.cjs").ask = async () => {throw Error("Fixture blocks inference");};
      load("./src/core/claude.cjs").status = async () => ({installed:false,loggedIn:false});
      load("./src/core/store.cjs").Store.prototype.getKey = () => "";
      load("./src/core/voice.cjs").VoiceService.prototype.capabilities = async () => ({available:false,recognizers:[],voices:[]});
      load("./src/core/voice.cjs").VoiceService.prototype.readCapabilities = async () => ({status:"unavailable",recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});
      load("./src/core/knowledge-cache.cjs").KnowledgeService.prototype.maybeRefresh = function(){};
      load("./src/core/updater.cjs").Updater.prototype.start = function(){};
      load("./src/main.cjs");
    `);
    app = await electron.launch({ args: [dir], env: { ...process.env, BF_USER_DATA: dir } });
    const page = await testWindow(app);
    page.setDefaultTimeout(7000);
    await page.getByRole("button", { name: "Use a manual character", exact: true }).click();
    await run(app, page, dir);
  } finally {
    await app?.close();
    const resolved = await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("bf-ui-timing-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test("game navigation acknowledges its own deferred status paint before disclosing Refresh", { timeout: 30000 }, async () => isolated(async (app, page, dir) => {
  const root = path.join(dir, "Fictional client");
  await fs.mkdir(path.join(root, "WTF"), { recursive: true });
  await fs.writeFile(path.join(root, ".flavor.info"), "wowf");
  await page.evaluate(root => window.backstage.prepareGame(root), root);
  await app.evaluate(({ ipcMain }) => {
    globalThis.timingFixture = { requests: 0 };
    const original = ipcMain._invokeHandlers.get("backstage:gameStatus");
    ipcMain.removeHandler("backstage:gameStatus");
    ipcMain.handle("backstage:gameStatus", async (...args) => {
      const result = await original(...args);
      if (++timingFixture.requests === 2) await new Promise(resolve => timingFixture.release = resolve);
      return result;
    });
  });
  let completed = false, clicked, headingRead;
  const headingReturned = new Promise(resolve => { headingRead = resolve; });
  const physicalClickReturned = new Promise(resolve => { clicked = resolve; });
  const wrapLocator = locator => new Proxy(locator, { get(target, key) {
    if (key === "getByRole") return (...args) => wrapLocator(target.getByRole(...args));
    if (key === "innerText") return async (...args) => { const text = await target.innerText(...args); setImmediate(headingRead); return text; };
    if (key === "click") return async (...args) => { await target.click(...args); if (await target.getAttribute("data-shell-control") === "subtab:game") clicked(); };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const observedPage = new Proxy(page, { get(target, key) {
    if (key === "getByRole") return (...args) => wrapLocator(target.getByRole(...args));
    if (key === "locator") return (...args) => wrapLocator(target.locator(...args));
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const navigation = navigate(observedPage, "game").then(() => { completed = true; });
  await page.getByText("Connection checks and tools", { exact: true }).waitFor();
  await app.evaluate(async () => {
    const end = Date.now() + 5000;
    while (!timingFixture.release) { if (Date.now() > end) throw Error("Expected held gameStatus"); await new Promise(r => setTimeout(r, 10)); }
  });
  await physicalClickReturned;
  await headingReturned;
  // Let all unrelated renderer work complete; it cannot acknowledge this navigation.
  await page.evaluate(async () => { await action(async () => {}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const completedBeforeStatus = completed;
  if (completedBeforeStatus) {
    await page.getByText("Connection checks and tools", { exact: true }).click();
    await page.locator('[data-command="game-refresh"]').evaluate(node => { window.retiredRefresh = node; });
  }
  await app.evaluate(() => { timingFixture.release(); });
  await navigation;
  const receipt = await page.evaluate(() => ({ route: page, retired: window.retiredRefresh ? !window.retiredRefresh.isConnected : null, open: document.querySelector('[data-command="game-refresh"]').closest("details").open }));
  console.log("Navigation boundary receipt", JSON.stringify({ completedBeforeStatus, ...receipt }));
  assert.equal(completedBeforeStatus, false, "Route visibility and an unrelated completed action must not acknowledge the held navigation paint");
  await page.getByText("Connection checks and tools", { exact: true }).click();
  await page.getByRole("button", { name: "Refresh saved snapshot", exact: true }).click();
}));

test("renamed plan focus waits for its current guarded paint after autosave", { timeout: 30000 }, async () => isolated(async (_app, page) => {
  await navigate(page, "company");
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page.getByLabel("Plan name").fill("Previous title");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByLabel("Plan title", { exact: true }).waitFor();
  const id = await page.locator("[data-company-journey]").getAttribute("data-company-journey");
  await page.evaluate(async () => { await autosaveQueue; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  // Hold the real guard's release callbacks, not Company.paint or the saved result.
  await page.evaluate(() => {
    const original = window.setTimeout;
    window.heldGuardTimers = [];
    window.setTimeout = (fn, ms, ...args) => ms === 0 ? (window.heldGuardTimers.push(() => fn(...args)), -1) : original(fn, ms, ...args);
    window.releaseGuardTimers = () => { window.setTimeout = original; for (const release of window.heldGuardTimers.splice(0)) release(); };
  });
  await page.getByLabel("Plan title", { exact: true }).fill("Keyboard transfer title");
  await page.getByLabel("Plan title", { exact: true }).press("Tab");
  await page.evaluate(async () => { await autosaveQueue; });
  const receipt = await page.evaluate(async () => ({ saved: (await window.backstage.companyBrief()).journeys[0].title, shown: document.querySelector('[data-company-command="remove"]').getAttribute("aria-label"), focused: document.activeElement?.dataset.companyCommand, queued: window.heldGuardTimers.length }));
  console.log("Company boundary receipt", JSON.stringify(receipt));
  let completed = false;
  const ownership = waitForCompanyTitleFocus(page, id, "Keyboard transfer title").then(value => { completed = true; return value; });
  // Observe rejection without allowing an unhandled rejection while the guard is held.
  const result = ownership.then(value => ({ value }), error => ({ error: error.message }));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(completed, false, "Saved data and old-label keyboard focus do not prove the final card has painted");
  await page.evaluate(() => window.releaseGuardTimers());
  const outcome = await result;
  assert.equal(outcome.error, undefined, "Ownership assertion must wait for the actual renamed card");
  assert.equal(outcome.value.focused, true);
  // A retained hidden old card with the same saved ID is not a current owner.
  await page.evaluate(() => {
    window.hiddenCompanyCard = document.querySelector("[data-company]").cloneNode(true);
    window.hiddenCompanyCard.hidden = true;
    document.getElementById("app").append(window.hiddenCompanyCard);
  });
  let hiddenCompleted = false;
  const hiddenOwnership = waitForCompanyTitleFocus(page, id, "Keyboard transfer title").then(value => { hiddenCompleted = true; return value; });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(hiddenCompleted, false, "A hidden stale same-ID/same-label card cannot acknowledge current ownership");
  await page.evaluate(() => window.hiddenCompanyCard.remove());
  assert.equal((await hiddenOwnership).focused, true);
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page.getByLabel("Plan name").fill("Keyboard transfer title");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.locator("[data-company-journey]").last().getByLabel("Plan title").waitFor();
  const wrongDelete = page.locator("[data-company-journey]").last().getByRole("button", { name: "Delete plan Keyboard transfer title", exact: true });
  await wrongDelete.focus();
  let wrongCompleted = false;
  const scopedOwnership = waitForCompanyTitleFocus(page, id, "Keyboard transfer title").then(value => { wrongCompleted = true; return value; });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(wrongCompleted, false, "A focused same-name Delete in another plan cannot acknowledge this card");
  await page.locator("[data-company-journey]").first().getByRole("button", { name: "Delete plan Keyboard transfer title", exact: true }).focus();
  assert.equal((await scopedOwnership).focused, true);
}));

test("a late same-screen status paint preserves deliberately opened connection disclosures", { timeout: 30000 }, async () => isolated(async (app, page, dir) => {
  await app.evaluate((_electron, repo) => {
    const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(repo, "package.json"));
    load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "running", launchAvailable: true });
  }, path.resolve(__dirname, ".."));
  const root = path.join(dir, "Fictional running client");
  await fs.mkdir(path.join(root, "WTF"), { recursive: true });
  await fs.writeFile(path.join(root, ".flavor.info"), "wowf");
  await page.evaluate(root => window.backstage.prepareGame(root), root);
  await navigate(page, "game");
  await page.evaluate(async () => { gameStatus = await api.gameStatus(); render(); });
  await app.evaluate(({ ipcMain }) => {
    globalThis.disclosureFixture = { hold: true };
    const original = ipcMain._invokeHandlers.get("backstage:gameStatus");
    ipcMain.removeHandler("backstage:gameStatus");
    ipcMain.handle("backstage:gameStatus", async (...args) => {
      const result = await original(...args);
      if (disclosureFixture.hold) { disclosureFixture.hold = false; await new Promise(resolve => disclosureFixture.release = resolve); }
      return result;
    });
  });
  await page.evaluate(() => {
    const original = action;
    action = fn => { action = original; return window.disclosureNavigation = original(fn); };
  });
  await page.getByRole("navigation", { name: "Settings navigation", exact: true }).getByRole("button", { name: "Game connection", exact: true }).click();
  await app.evaluate(async () => { const end = Date.now() + 5000; while (!disclosureFixture.release) { if (Date.now() > end) throw Error("Expected held disclosure status"); await new Promise(r => setTimeout(r, 10)); } });
  await page.getByText("Connection checks and tools", { exact: true }).click();
  await page.getByText("Optional activation during this session", { exact: true }).click();
  const evidence = path.resolve(__dirname, "../work/ui-timing-captures");
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "connection-disclosures-before-status.png"), fullPage: true });
  await app.evaluate(() => disclosureFixture.release());
  await page.evaluate(async () => { await window.disclosureNavigation; });
  const open = await page.locator("details").evaluateAll(nodes => nodes.filter(node => /Connection checks and tools|Optional activation during this session/.test(node.querySelector("summary")?.textContent)).map(node => ({ label: node.querySelector("summary").textContent, open: node.open })));
  console.log("Same-screen disclosure receipt", JSON.stringify(open));
  await page.screenshot({ path: path.join(evidence, "connection-disclosures-after-status.png"), fullPage: true });
  assert.deepEqual(open.map(node => node.open), [true, true], "A status reply must preserve both deliberate native disclosure choices");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Optional activation during this session", "The current disclosure summary retains keyboard focus after its status paint");
  const checks = page.locator('details[data-living-disclosure="connection-checks"]');
  const activation = page.locator('details[data-living-disclosure="optional-activation"]');
  await checks.locator(":scope > summary").press("Space");
  await activation.locator(":scope > summary").press("Space");
  await page.evaluate(() => render());
  assert.equal(await checks.evaluate(node => node.open), false, "User-closed checks stay closed after a paint");
  assert.equal(await activation.evaluate(node => node.open), false, "User-closed optional activation stays closed after a paint");
  await checks.locator(":scope > summary").click();
  await navigate(page, "adventure");
  await navigate(page, "game");
  assert.equal(await checks.evaluate(node => node.open), false, "Route changes retire disclosure choices");
  await checks.locator(":scope > summary").click();
  await page.getByLabel("Active character", { exact: true }).selectOption("fiction2");
  await page.waitForFunction(() => state.activeProfileId === "fiction2" && document.body.dataset.faction === "horde");
  assert.equal(await checks.evaluate(node => node.open), false, "Character changes retire disclosure choices");
  await checks.locator(":scope > summary").click();
  const nextRoot = path.join(dir, "Fictional replacement client");
  await fs.mkdir(path.join(nextRoot, "WTF"), { recursive: true });
  await fs.writeFile(path.join(nextRoot, ".flavor.info"), "wowf");
  await app.evaluate(({ dialog }, nextRoot) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextRoot] }); }, nextRoot);
  const { beginRendererAction, finishRendererAction } = require("../scripts/renderer-action-fixture.cjs");
  const folderAction = await beginRendererAction(page, page.getByRole("button", { name: "Choose game folder", exact: true }), { attribute: "data-command", value: "game-connect" });
  await finishRendererAction(page, folderAction);
  await fs.stat(path.join(nextRoot, "Interface/AddOns/BackstageForever/BackstageForever.toc"));
  assert.equal(await checks.evaluate(node => node.open), false, "An explicit same-route folder replacement retires disclosure choices");
  await checks.locator(":scope > summary").click();
  await page.getByRole("button", { name: "Set up my companion", exact: true }).click();
  await page.getByRole("heading", { name: "Your companion is prepared", exact: true }).waitFor();
  const setupChecks = page.locator('details[data-living-disclosure="setup-checks"]');
  assert.equal(await setupChecks.evaluate(node => node.open), false, "Entering setup has its own disclosure owner");
  await setupChecks.locator(":scope > summary").click();
  await page.evaluate(() => render());
  assert.equal(await setupChecks.evaluate(node => node.open), true, "Setup checks preserve deliberate state within the same setup session");
  await page.getByRole("button", { name: "Enter my adventure", exact: true }).click();
  await navigate(page, "game");
  assert.equal(await checks.evaluate(node => node.open), false, "Leaving setup retires the previous screen's disclosure choices");
  // Replacement generations retire even a same-route/same-profile owner. The
  // full Company smoke separately exercises real backup/reset/cancel lifecycles.
  for (const generation of ["autosaveGeneration", "setupGeneration"]) {
    await checks.locator(":scope > summary").click();
    await page.evaluate(generation => { if (generation === "autosaveGeneration") autosaveGeneration++; else setupGeneration++; render(); }, generation);
    assert.equal(await checks.evaluate(node => node.open), false, `${generation} replacement retires prior disclosure state`);
  }
}));
