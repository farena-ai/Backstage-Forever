"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict");
const { launch, testWindow } = require("./test-window.cjs");
const { navigate } = require("./player-navigation.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const scratch = await fs.mkdtemp(path.join(process.env.BF_SMOKE_TMPDIR || os.tmpdir(), "bf-supply-smoke-"));
  const dir = path.join(scratch, "profile"), journal = path.join(dir, "state.json"), backup = path.join(scratch, "backup.json");
  const errors = [];
  let app, page;
  const box = () => page.locator("[data-supply-desk]");
  const button = name => box().getByRole("button", { name, exact: true });
  const press = async name => button(name).press("Enter");
  const fill = async (name, value) => box().getByLabel(name, { exact: true }).fill(value);
  const ipc = (name, ...args) => page.evaluate(([name, args]) => window.backstage[name](...args), [name, args]);
  async function open() {
    app = await launch(electron, { args: [path.join(__dirname, "..")], timeout: 22000, env: { ...process.env, BF_TEST_INACTIVE: "1", BF_USER_DATA: dir } });
    await app.evaluate(({ app, dialog }, backup) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      globalThis.supplyFixture = { confirmReset: false, calls: 0 };
      load("./src/core/providers.cjs").ask = () => { supplyFixture.calls++; throw Error("Fixture blocks provider calls"); };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
      dialog.showMessageBox = async (_window, options) => ({ response: options.title === "Delete all local data?" && supplyFixture.confirmReset ? 1 : 0 });
    }, backup);
    page = await testWindow(app);
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(7000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
    await page.waitForFunction(() => innerWidth === 984 && innerHeight === 635);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "company");
    await box().locator("summary").press("Enter");
    await button("Add request").waitFor();
  }
  try {
    await fs.mkdir(dir);
    const profile = { id: "private", name: "PRIVATE_CHARACTER", realm: "PRIVATE_REALM", className: "Mage", faction: "Alliance", level: 14, notes: "PRIVATE_NOTE", goals: [] };
    await fs.writeFile(journal, JSON.stringify(validateState({ ...defaultState(), onboarded: true, profiles: [profile], activeProfileId: profile.id, followGameCharacter: false })));
    await open();
    const before = await fs.readFile(journal);
    assert.match(before.toString(), /PRIVATE_NOTE/);
    await ipc("exportData");
    const backupBefore = await fs.readFile(backup);
    const run = await ipc("guildRun", "preview", { base: null, draft: {
      title: "Public run", destination: "Deadmines", meetingPoint: "Entrance", local: "2026-11-22T18:00",
      timeZone: "UTC", offset: "+00:00", duties: [{ role: "all", text: "Be at the entrance" }], prep: ["Bring water"],
    } });
    await ipc("guildRun", "save", run.token);
    async function exportRun() {
      const { token } = await ipc("guildRun", "organized", run.pack.eventId);
      const bytes = [];
      for (const kind of ["json", "text"]) {
        assert.equal(await ipc("guildRun", "export", token, kind), true);
        bytes.push(await fs.readFile(backup));
      }
      return bytes;
    }
    const runBefore = await exportRun();
    await press("Add request");
    assert.equal(await page.evaluate(() => document.activeElement.id), "supply-editor-title");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.name), "item");
    await fill("Requested item", "Runecloth <local>");
    await fill("Quantity", "20");
    await press("Save locally");
    await box().getByRole("heading", { name: "Runecloth <local> · 20 requested" }).waitFor();
    await press("Add commitment");
    await fill("Volunteer label", "LOCAL_VOLUNTEER");
    await fill("Quantity", "5");
    await press("Save locally");
    await box().getByText("LOCAL_VOLUNTEER · 5 Pledged", { exact: false }).waitFor();
    await press("Correct commitment");
    const stateControl = box().getByLabel("Commitment state", { exact: true });
    await stateControl.press("End");
    await stateControl.press("ArrowUp");
    assert.equal(await stateControl.inputValue(), "delivered");
    await fill("Reason for change", "Manual handoff confirmed");
    await press("Save locally");
    await box().getByText("15 still requested after recorded deliveries.", { exact: true }).waitFor();
    await box().getByText(/Change history/).press("Enter");
    await box().getByText(/5 Pledged.*5 Delivered.*Manual handoff confirmed/).waitFor();
    await press("Add capability");
    await fill("Volunteer label", "LOCAL_CRAFTER");
    await fill("Volunteered capability", "Make cloth bandages");
    await press("Save locally");
    await box().getByText(/LOCAL_CRAFTER · Make cloth bandages/).waitFor();
    await press("Open Professions Workshop");
    await box().locator("summary").press("Enter");
    await box().getByText("15 still requested after recorded deliveries.", { exact: true }).waitFor();
    assert.equal(await box().getByRole("button").count(), 1);
    assert.doesNotMatch(await box().innerText(), /LOCAL_VOLUNTEER|LOCAL_CRAFTER|Manual handoff confirmed/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    assert.deepEqual(await fs.readFile(journal), before);
    await ipc("exportData");
    assert.deepEqual(await fs.readFile(backup), backupBefore);
    assert.deepEqual(await exportRun(), runBefore);
    const store = path.join(dir, "supply-desk.json");
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
    const saved = await ipc("supplyDesk", "read");
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_CHARACTER|PRIVATE_REALM|PRIVATE_NOTE/);
    assert.equal(await app.evaluate(() => supplyFixture.calls), 0);
    await page.reload();
    await navigate(page, "company");
    await box().locator("summary").press("Enter");
    await box().getByText(/LOCAL_CRAFTER · Make cloth bandages/).waitFor();
    await box().getByText(/Records are kept for this app session and cleared when you quit/).waitFor();
    assert.deepEqual(await ipc("supplyDesk", "read"), saved);
    assert.equal(await ipc("resetData"), null);
    assert.deepEqual(await ipc("supplyDesk", "read"), saved);
    await app.close(); app = null;
    await open();
    await box().getByText("No requests recorded.", { exact: true }).waitFor();
    await box().getByText("No capabilities volunteered.", { exact: true }).waitFor();
    const stale = await ipc("supplyDesk", "read");
    assert.notEqual(stale.token, saved.token);
    assert.deepEqual(stale.history, []);
    await app.evaluate(() => { supplyFixture.confirmReset = true; });
    await ipc("resetData");
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
    await assert.rejects(ipc("supplyDesk", "change", { token: stale.token, revision: 0, edit: { type: "request", item: "Stale", quantity: 1 } }), /no longer current/);
    assert.deepEqual((await ipc("supplyDesk", "read")).requests, []);
    assert.deepEqual(errors, []);
    console.log("Supply Desk Electron smoke passed (keyboard, correction, read-only Workshop, privacy, reload retention, restart retirement, reset).");
  } finally { await app?.close(); await fs.rm(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
