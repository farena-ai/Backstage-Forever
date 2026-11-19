"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict");
const os = require("node:os");
const { launch, testWindow } = require("./test-window.cjs");
const { navigate } = require("./player-navigation.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { parseGuildRunPack } = require("../src/core/guild-run-pack.cjs");

(async () => {
  const scratch = process.env.BF_SMOKE_TMPDIR || process.env.TMPDIR || os.tmpdir();
  const root = await fs.mkdtemp(path.join(scratch, "bf-guild-smoke-"));
  const json = path.join(root, "share.json"), txt = path.join(root, "share.txt");
  let app, page;
  const errors = [];
  const run = () => page.locator("[data-guild-run]");
  const button = name => run().getByRole("button", { name, exact: true });
  const ipc = (...args) => page.evaluate(args => window.backstage.guildRun(...args), args);
  const wait = predicate => page.waitForFunction(predicate);
  const buttonPress = async name => { await button(name).focus(); await page.keyboard.press("Enter"); };
  async function open(name, zone) {
    await app?.close();
    const dir = path.join(root, name);
    if (!(await fs.stat(dir).catch(() => null))) {
      await fs.mkdir(dir);
      const profile = { id: name, name: `PRIVATE_${name}`, realm: "PRIVATE_REALM", className: "Mage",
        faction: "Alliance", level: 14, notes: "PRIVATE_NOTE", goals: [] };
      const state = validateState({ ...defaultState(), onboarded: true, profiles: [profile], activeProfileId: name, followGameCharacter: false });
      await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    }
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, TZ: zone }, timeout: 22000 });
    await app.evaluate(({ app, dialog }, paths) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch = async () => { throw Error("Fixture blocks game launch"); };
      load("./src/core/providers.cjs").ask = () => { throw Error("Fixture blocks provider calls"); };
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      globalThis.guildFixture = { opened: 0, saved: 0, cancel: false };
      dialog.showSaveDialog = async (_window, options) => { guildFixture.saved++; return { canceled: guildFixture.cancel, filePath: options.defaultPath.endsWith(".txt") ? paths.txt : paths.json }; };
      dialog.showOpenDialog = async () => { guildFixture.opened++; return { canceled: guildFixture.cancel, filePaths: [paths.json] }; };
      dialog.showMessageBox = async () => ({ response: 0 });
    }, { json, txt });
    page = await testWindow(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "party");
    await run().waitFor();
    await wait(() => innerWidth === 984 && innerHeight === 635);
  }
  try {
    await open("Leader", "America/New_York");
    await button("Create run").click();
    for (const [label, value] of Object.entries({ "Run title": "Weekend Deadmines", "Destination": "Deadmines",
      "Meeting point": "Entrance", "Organizer date and time": "2026-11-01T01:30", "Named time zone": "America/New_York",
      "UTC offset at start": "-05:00", "Healer duties": "Bring water", "Prep actions": "Repair gear\nBring water" })) {
      await run().getByLabel(label, { exact: true }).fill(value);
    }
    await buttonPress("Preview run");
    await run().getByText("Review the run before sharing").waitFor();
    assert.match(await run().locator("pre").innerText(), /2026-11-01T06:30:00\.000Z/);
    assert.deepEqual(await ipc("list"), { organized: [], received: [] });
    assert.equal(await app.evaluate(() => guildFixture.saved), 0);
    await wait(() => document.activeElement?.id === "guild-run-panel-title");
    assert.ok(await page.locator("#guild-run-panel-title").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    assert.ok(await button("Save run locally").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "Compact review brings the first action into view without extra scrolling");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    if (process.env.BF_GUILD_PREVIEW_PNG) await page.screenshot({ path: process.env.BF_GUILD_PREVIEW_PNG });
    await button("Save run locally").click();
    await button("Export JSON").click();
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    const bytes = await fs.readFile(json), pack = parseGuildRunPack(bytes);
    assert.doesNotMatch(bytes.toString(), /PRIVATE_|completedPrepIds/);
    assert.equal(pack.title, "Weekend Deadmines");
    await button("Export plain text").click();
    await run().getByRole("status").filter({ hasText: "Plain-text copy exported" }).waitFor();
    assert.equal(await fs.readFile(txt, "utf8"), await run().locator("pre").textContent());

    await open("Member", "America/Los_Angeles");
    await app.evaluate(() => guildFixture.cancel = true);
    await button("Import run pack").click();
    await run().getByRole("status").filter({ hasText: "No file opened" }).waitFor();
    assert.deepEqual((await ipc("list")).received, []);
    await app.evaluate(() => guildFixture.cancel = false);
    await button("Import run pack").click();
    await run().getByText("Review the received run").waitFor();
    assert.match(await run().locator("pre").innerText(), /31\/10\/2026.*23:30:00.*America\/Los_Angeles/);
    assert.deepEqual((await ipc("list")).received, []);
    await button("Add received run").click();
    await run().getByRole("checkbox", { name: "Repair gear" }).check();
    await wait(() => document.querySelector('[data-guild-check]')?.checked && !document.querySelector('[data-guild-check]')?.disabled);
    assert.deepEqual((await ipc("received", pack.eventId)).completedPrepIds, [pack.prep[0].id]);
    await button("Import run pack").click();
    await run().getByText("This revision is already saved.", { exact: true }).waitFor();
    assert.equal(await button("Add received run").count(), 0);

    await open("Leader", "America/New_York");
    await button("Saved runs").click();
    await button("Weekend Deadmines · revision 1 · Scheduled").click();
    await button("Edit next revision").click();
    await run().getByLabel("Prep actions", { exact: true }).fill("Bring a potion\nRepair gear");
    await button("Preview run").click();
    await button("Save run locally").click();
    await button("Export JSON").click();
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    const revised = parseGuildRunPack(await fs.readFile(json));
    assert.equal(revised.eventId, pack.eventId); assert.equal(revised.revision, 2);

    await open("Member", "America/Los_Angeles");
    await button("Import run pack").click();
    await button("Apply received revision").click();
    await run().getByRole("checkbox", { name: "Bring a potion" }).waitFor();
    assert.equal(await run().getByRole("checkbox", { name: "Repair gear" }).isChecked(), true);
    assert.equal(await run().getByRole("checkbox", { name: "Bring a potion" }).isChecked(), false);
    assert.deepEqual(errors, []);
    console.log("Guild Run Pack Electron PASS: compact keyboard preview, JSON/text parity, two isolated installations, DST local time, cancelled file dialog, review-only import, duplicate, restart, and private checks across revision.");
  } finally {
    try { await app?.close(); } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
