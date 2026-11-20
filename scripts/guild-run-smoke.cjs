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
  const json = path.join(root, "share.json"), txt = path.join(root, "share.txt"), welcomeFile = path.join(root, "welcome.txt");
  const backup = path.join(root, "backup.json");
  let app, page;
  const errors = [];
  const run = () => page.locator("[data-guild-run]");
  const button = name => run().getByRole("button", { name, exact: true });
  const viewerTime = () => run().locator("[data-guild-viewer-time]").innerText();
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
      const journeys = name === "Mentor" ? [{ id: "private-journey", title: "PRIVATE_JOURNEY_TITLE", createdAt: "2026-11-09T00:00:00.000Z",
        steps: [{ id: "private-step", text: "PRIVATE_JOURNEY_STEP", done: true, profileId: name }] }] : [];
      const state = validateState({ ...defaultState(), onboarded: true, profiles: [profile], activeProfileId: name, followGameCharacter: false, journeys });
      await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    }
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, TZ: zone }, timeout: 22000 });
    await app.evaluate(({ app, dialog, clipboard }, paths) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch = async () => { throw Error("Fixture blocks game launch"); };
      load("./src/core/providers.cjs").ask = () => { throw Error("Fixture blocks provider calls"); };
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      globalThis.guildFixture = { opened: 0, saved: 0, cancel: false, confirmReset: false, confirmImport: false, holdWelcome: false, copies: [] };
      clipboard.writeText = text => guildFixture.copies.push(text);
      dialog.showSaveDialog = async (_window, options) => {
        guildFixture.saved++;
        const isWelcome = options.defaultPath.endsWith("-welcome.txt");
        const filePath = isWelcome ? paths.welcomeFile : options.defaultPath.endsWith("-backup.json") ? paths.backup : options.defaultPath.endsWith(".txt") ? paths.txt : paths.json;
        const result = { canceled: guildFixture.cancel, filePath };
        if (isWelcome && guildFixture.holdWelcome) return new Promise(resolve => { guildFixture.release = () => resolve(result); });
        return result;
      };
      dialog.showOpenDialog = async (_window, options) => { guildFixture.opened++; return { canceled: guildFixture.cancel, filePaths: [options.title === "Import a Backstage Forever backup" ? paths.backup : paths.json] }; };
      dialog.showMessageBox = async (_window, options) => ({ response: (options.title === "Delete all local data?" && guildFixture.confirmReset || options.title === "Replace saved profiles?" && guildFixture.confirmImport) ? 1 : 0 });
    }, { json, txt, welcomeFile, backup });
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
  async function newcomer() {
    await open("Mentor", "Europe/Paris");
    await buttonPress("Use newcomer/mentor template");
    await wait(() => document.activeElement?.id === "guild-run-panel-title");
    await buttonPress("Close run panel");
    await wait(() => document.activeElement?.dataset.partyControl === "guild-template");
    assert.deepEqual(await ipc("list"), { organized: [], received: [] });
    await navigate(page, "journey");
    await page.getByRole("button", { name: "Use newcomer/mentor template", exact: true }).press("Enter");
    await wait(() => document.activeElement?.id === "guild-run-panel-title");
    assert.match(await run().locator("#guild-run-panel-title").innerText(), /newcomer/i);
    const field = label => run().getByLabel(label, { exact: true });
    assert.equal(await field("Run title").inputValue(), "Newcomer dungeon run");
    assert.equal(await field("Destination").inputValue(), "");
    assert.equal(await field("Meeting point").inputValue(), "");
    assert.equal(await field("Organizer date and time").inputValue(), "");
    assert.match(await field("Everyone duties").inputValue(), /volunteer mentor/);
    const journal = path.join(root, "Mentor", "state.json");
    const before = await fs.readFile(journal);
    assert.match(before.toString(), /PRIVATE_NOTE/);
    assert.match(before.toString(), /PRIVATE_JOURNEY_STEP/);
    for (const [label, value] of Object.entries({ Destination: "Deadmines", "Meeting point": "Entrance",
      "Organizer date and time": "2026-11-01T18:00", "UTC offset at start": "+01:00",
      "Prep actions": "Agree on roles and a meeting point before setting off.\nBring water" })) await field(label).fill(value);
    await buttonPress("Preview run");
    await run().getByRole("heading", { name: "Review the run before sharing" }).waitFor();
    await wait(() => document.activeElement?.id === "guild-run-panel-title");
    assert.ok(await button("Save run locally").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "Compact newcomer preview shows its first action on keyboard arrival");
    const reviewed = await run().locator("pre").textContent();
    assert.match(reviewed, /Newcomer dungeon run/);
    assert.match(reviewed, /volunteer mentor/);
    assert.match(reviewed, /Bring water/);
    assert.doesNotMatch(reviewed, /PRIVATE_|completedPrepIds|Viewer time/);
    assert.deepEqual(await ipc("list"), { organized: [], received: [] });
    assert.deepEqual(await fs.readFile(journal), before);
    assert.equal(await app.evaluate(() => guildFixture.saved), 0);
    if (process.env.BF_GUILD_MENTOR_PNG) await page.screenshot({ path: process.env.BF_GUILD_MENTOR_PNG });
    await buttonPress("Save run locally");
    assert.equal(await app.evaluate(() => guildFixture.saved), 0);
    await buttonPress("Export plain text");
    await run().getByRole("status").filter({ hasText: "Plain-text copy exported" }).waitFor();
    assert.equal(await fs.readFile(txt, "utf8"), reviewed);
    await buttonPress("Export JSON");
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    const bytes = await fs.readFile(json);
    assert.doesNotMatch(bytes.toString(), /PRIVATE_|completedPrepIds|newcomer-mentor/);
    const pack = parseGuildRunPack(bytes);
    assert.equal(pack.title, "Newcomer dungeon run");
    assert.match(pack.duties[0].text, /volunteer mentor/);
    assert.deepEqual(await fs.readFile(journal), before);
  }
  try {
    await newcomer();
    await open("Leader", "Europe/Paris");
    await button("Create run").click();
    for (const [label, value] of Object.entries({ "Run title": "Weekend Deadmines", "Destination": "Deadmines",
      "Meeting point": "Entrance", "Organizer date and time": "2026-11-01T01:30", "Named time zone": "America/New_York",
      "UTC offset at start": "-05:00", "Healer duties": "Bring water", "Prep actions": "Repair gear\nBring water" })) {
      await run().getByLabel(label, { exact: true }).fill(value);
    }
    await buttonPress("Preview run");
    await run().getByText("Review the run before sharing").waitFor();
    assert.match(await viewerTime(), /Viewer time \(only shown here\).*07:30:00.*Europe\/Paris/);
    const reviewedText = await run().locator("pre").textContent();
    assert.match(reviewedText, /America\/New_York.*2026-11-01T06:30:00\.000Z/);
    assert.doesNotMatch(reviewedText, /Europe\/Paris|Viewer time/);
    assert.deepEqual(await ipc("list"), { organized: [], received: [] });
    assert.equal(await app.evaluate(() => guildFixture.saved), 0);
    await wait(() => document.activeElement?.id === "guild-run-panel-title");
    assert.ok(await page.locator("#guild-run-panel-title").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    assert.ok(await button("Save run locally").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "Compact review brings the first action into view without extra scrolling");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    if (process.env.BF_GUILD_PREVIEW_PNG) await page.screenshot({ path: process.env.BF_GUILD_PREVIEW_PNG });
    await buttonPress("Save run locally");
    await wait(() => document.activeElement?.textContent === "Reviewed run · ready to export");
    if (process.env.BF_GUILD_SAVED_PNG) await page.screenshot({ path: process.env.BF_GUILD_SAVED_PNG });
    const visibleOnArrival = locator => locator.evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(await visibleOnArrival(button("Open private officer log")), "Private officer work is visible on compact saved-run arrival");
    assert.ok(await visibleOnArrival(button("Write public welcome copy")), "Public welcome writing is visible on compact saved-run arrival");
    assert.ok(await run().locator("pre").evaluate(pre => [...pre.closest(".guild-run-panel").querySelectorAll('button[data-guild-action="officerLog"],button[data-guild-action="welcomeWrite"]')]
      .every(button => button.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING)), "Wave 7 actions precede the potentially long reviewed text");
    await button("Export JSON").click();
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    const bytes = await fs.readFile(json), pack = parseGuildRunPack(bytes);
    assert.doesNotMatch(bytes.toString(), /PRIVATE_|completedPrepIds|Europe\/Paris/);
    assert.equal(pack.title, "Weekend Deadmines");
    await button("Export plain text").click();
    await run().getByRole("status").filter({ hasText: "Plain-text copy exported" }).waitFor();
    const shareText = await fs.readFile(txt, "utf8");
    assert.equal(shareText, reviewedText);
    assert.equal(shareText, await run().locator("pre").textContent());
    assert.doesNotMatch(shareText, /Europe\/Paris|Viewer time/);

    await buttonPress("Open organizer board");
    await run().getByRole("heading", { name: "Local organizer board" }).waitFor();
    await wait(() => document.activeElement?.textContent === "Local organizer board");
    await run().getByLabel("Tank target", { exact: true }).fill("1");
    await buttonPress("Save coverage targets");
    await run().getByText("Tank: 0 yes, 0 maybe · target 1 · 1 open", { exact: true }).waitFor();
    await buttonPress("Add RSVP entry");
    await run().getByLabel("Name or label", { exact: true }).fill("PRIVATE_BOARD <tank>");
    for (const [label, value] of [["Role", "tank"], ["RSVP", "yes"], ["Placement", "bench"]]) {
      await run().getByLabel(label, { exact: true }).selectOption(value);
    }
    await buttonPress("Save entry");
    await button("Edit PRIVATE_BOARD <tank>").waitFor();
    await buttonPress("Edit PRIVATE_BOARD <tank>");
    await run().getByLabel("Placement", { exact: true }).selectOption("assigned");
    await buttonPress("Save entry");
    await run().getByText("Tank: 1 yes, 0 maybe · target 1 · 0 open", { exact: true }).waitFor();
    await run().getByText(/Bench → .*Assigned/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    await buttonPress("Back to run pack");
    const leaderJournal = path.join(root, "Leader", "state.json");
    const beforeDebrief = await fs.readFile(leaderJournal);
    await buttonPress("Open officer debrief");
    await wait(() => document.activeElement?.textContent === "Local officer debrief");
    assert.equal(await button("Review next-run copy").count(), 0);
    await buttonPress("Edit debrief");
    for (const [label, value] of Object.entries({ "Confirmed attendance": "Present <tank>", Progression: "First wing cleared",
      Assignments: "Tank takes the first pull", "Follow-ups": "Revisit the second pull", "Private officer note": "PRIVATE_DEBRIEF_NOTE" })) {
      await run().getByLabel(label, { exact: true }).fill(value);
    }
    await buttonPress("Save confirmed debrief");
    await run().getByRole("status").filter({ hasText: "Debrief saved locally" }).waitFor();
    await buttonPress("Review next-run copy");
    await wait(() => document.activeElement?.textContent === "Review next-run copy");
    assert.ok(await button("Copy reviewed text").evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    const nextRunText = "Next-run handoff: Weekend Deadmines\n\nConfirmed attendance\n- Present <tank>\n\nProgression\n- First wing cleared\n\nAssignments\n- Tank takes the first pull\n\nFollow-ups\n- Revisit the second pull";
    assert.equal(await run().locator("pre").textContent(), nextRunText);
    assert.deepEqual(await app.evaluate(() => guildFixture.copies), []);
    if (process.env.BF_GUILD_DEBRIEF_PNG) await page.screenshot({ path: process.env.BF_GUILD_DEBRIEF_PNG });
    await page.keyboard.press("Tab");
    await wait(() => document.activeElement?.textContent === "Copy reviewed text");
    await page.keyboard.press("Enter");
    await run().getByRole("status").filter({ hasText: "Reviewed text copied" }).waitFor();
    assert.deepEqual(await app.evaluate(() => guildFixture.copies), [nextRunText]);
    await buttonPress("Back to debrief");
    await buttonPress("Back to run pack");
    assert.deepEqual(await fs.readFile(leaderJournal), beforeDebrief);
    await buttonPress("Export plain text");
    await run().getByRole("status").filter({ hasText: "Plain-text copy exported" }).waitFor();
    assert.equal(await fs.readFile(txt, "utf8"), shareText);
    const journal = path.join(root, "Leader", "state.json");
    const journalBytes = await fs.readFile(journal);
    const exportBackup = () => page.evaluate(() => window.backstage.exportData());
    assert.equal(await exportBackup(), true);
    const backupBefore = await fs.readFile(backup);
    await buttonPress("Open private officer log");
    await wait(() => document.activeElement?.textContent === "Private officer decisions");
    const field = label => run().getByLabel(label, { exact: true });
    await field("Recorded by (local label)").fill("PRIVATE_OFFICER <one>");
    await field("Decision").fill("PRIVATE_DECISION");
    await field("Private reason or trial note").fill("PRIVATE_TRIAL");
    await buttonPress("Record decision");
    await buttonPress("Correct entry 1");
    await field("Recorded by (local label)").fill("PRIVATE_OFFICER_TWO");
    await field("Decision").fill("PRIVATE_CORRECTED");
    await field("Reason for correction").fill("PRIVATE_CORRECTION_REASON");
    await buttonPress("Append correction");
    await run().getByText("PRIVATE_CORRECTED", { exact: true }).waitFor();
    await run().getByText("PRIVATE_DECISION", { exact: true }).waitFor();
    await buttonPress("Back to run pack");
    await buttonPress("Write public welcome copy");
    await field("Guild name").fill("Synthetic Guild");
    await field("Welcome message").fill("New players welcome <all>!");
    await field("Recruiting needs (optional)").fill("Casual dungeon groups");
    assert.equal(await button("Export reviewed welcome text").count(), 0);
    const beforePickers = await app.evaluate(() => guildFixture.saved);
    await buttonPress("Review welcome copy");
    await wait(() => document.activeElement?.textContent === "Review public welcome copy");
    const welcomeText = "Welcome to Synthetic Guild\n\nNew players welcome <all>!\n\nRecruiting: Casual dungeon groups\n";
    assert.equal(await run().locator("pre").textContent(), welcomeText);
    assert.doesNotMatch(await run().innerText(), /PRIVATE_|Weekend Deadmines/);
    assert.equal(await app.evaluate(() => guildFixture.saved), beforePickers);
    await buttonPress("Export reviewed welcome text");
    await run().getByRole("status").filter({ hasText: "Welcome text exported" }).waitFor();
    assert.deepEqual(await fs.readFile(welcomeFile), Buffer.from(welcomeText));
    assert.deepEqual(await fs.readFile(journal), journalBytes);
    await buttonPress("Back to run pack");
    await buttonPress("Export JSON");
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    assert.deepEqual(await fs.readFile(json), bytes);
    await buttonPress("Export plain text");
    await run().getByRole("status").filter({ hasText: "Plain-text copy exported" }).waitFor();
    assert.equal(await fs.readFile(txt, "utf8"), shareText);
    assert.equal(await exportBackup(), true);
    assert.deepEqual(await fs.readFile(backup), backupBefore);

    // Same-profile journal replacement invalidates in-flight welcome export and officer tokens,
    // but does not erase the installation-owned authored event or its private history.
    const local = await ipc("organized", pack.eventId);
    const privateHistory = await ipc("officerLog", local.token);
    const pendingPreview = await ipc("welcomePreview", local.token, { guild: "Another Guild", greeting: "Do not publish", recruiting: "", contact: "" });
    await app.evaluate(() => { guildFixture.holdWelcome = true; guildFixture.confirmImport = true; });
    const pending = ipc("welcomeExport", pendingPreview.token);
    let held = false;
    for (let i = 0; i < 100 && !held; i++) {
      held = await app.evaluate(() => typeof guildFixture.release === "function");
      if (!held) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(held, true);
    assert.equal((await page.evaluate(() => window.backstage.importData())).activeProfileId, "Leader");
    await app.evaluate(() => guildFixture.release());
    assert.equal(await pending, null);
    assert.deepEqual(await fs.readFile(welcomeFile), Buffer.from(welcomeText));
    await assert.rejects(ipc("officerLog", local.token), /no longer current/);
    await assert.rejects(ipc("officerAppend", local.token, privateHistory.revision,
      { corrects: null, by: "Local officer", decision: "Not admitted", reason: "" }), /no longer current/);
    const fresh = await ipc("organized", pack.eventId);
    assert.deepEqual(await ipc("officerLog", fresh.token), privateHistory);

    await open("Member", "America/Los_Angeles");
    await app.evaluate(() => guildFixture.cancel = true);
    await button("Import run pack").click();
    await run().getByRole("status").filter({ hasText: "No file opened" }).waitFor();
    assert.deepEqual((await ipc("list")).received, []);
    await app.evaluate(() => guildFixture.cancel = false);
    await button("Import run pack").click();
    await run().getByText("Review the received run").waitFor();
    assert.match(await viewerTime(), /31\/10\/2026.*23:30:00.*America\/Los_Angeles/);
    assert.doesNotMatch(await run().locator("pre").innerText(), /America\/Los_Angeles/);
    assert.deepEqual((await ipc("list")).received, []);
    await button("Add received run").click();
    await run().getByRole("checkbox", { name: "Repair gear" }).check();
    assert.equal(await button("Open organizer board").count(), 0);
    assert.equal(await button("Open private officer log").count(), 0);
    assert.equal(await button("Write public welcome copy").count(), 0);
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

    await open("Leader", "America/New_York");
    await button("Saved runs").click();
    await button("Weekend Deadmines · revision 2 · Scheduled").click();
    await buttonPress("Open officer debrief");
    await run().getByText("PRIVATE_DEBRIEF_NOTE", { exact: true }).waitFor();
    await buttonPress("Back to run pack");
    await buttonPress("Open private officer log");
    await run().getByText("PRIVATE_CORRECTED", { exact: true }).waitFor();
    await buttonPress("Back to run pack");
    await buttonPress("Open organizer board");
    await run().getByText("Tank: 1 yes, 0 maybe · target 1 · 0 open", { exact: true }).waitFor();
    await buttonPress("Back to run pack");
    await button("Review cancellation").click();
    await button("Save run locally").click();
    await button("Export JSON").click();
    await run().getByRole("status").filter({ hasText: "Run pack exported" }).waitFor();
    const cancellationBytes = await fs.readFile(json);
    const cancellation = parseGuildRunPack(cancellationBytes);
    assert.equal(cancellation.eventId, pack.eventId);
    assert.equal(cancellation.revision, 3);
    assert.equal(cancellation.status, "cancelled");
    assert.deepEqual(cancellation.duties, []);
    assert.deepEqual(cancellation.prep, []);
    await buttonPress("Open organizer board");
    await run().getByText(/Cancelled run: this board is read-only/).waitFor();
    assert.equal(await button("Add RSVP entry").count(), 0);

    const boardFile = path.join(root, "Leader", "guild-organizer.json");
    const boardBytes = await fs.readFile(boardFile);
    const boardOrphan = `${boardFile}.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp`;
    const debriefFile = path.join(root, "Leader", "guild-officer-debrief.json");
    const debriefBytes = await fs.readFile(debriefFile);
    const debriefOrphan = `${debriefFile}.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp`;
    const officerFile = path.join(root, "Leader", "guild-officer-log.json"), officerBytes = await fs.readFile(officerFile);
    const officerOrphan = `${officerFile}.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp`;
    await fs.writeFile(boardOrphan, boardBytes);
    await fs.writeFile(officerOrphan, officerBytes);
    await fs.writeFile(debriefOrphan, debriefBytes);
    assert.equal(await page.evaluate(() => window.backstage.resetData()), null);
    assert.deepEqual(await fs.readFile(debriefFile), debriefBytes);
    assert.deepEqual(await fs.readFile(boardFile), boardBytes);
    assert.deepEqual(await fs.readFile(officerFile), officerBytes);
    await app.evaluate(() => guildFixture.confirmReset = true);
    assert.deepEqual((await page.evaluate(() => window.backstage.resetData())).profiles, []);
    for (const removed of [boardFile, boardOrphan, officerFile, officerOrphan, debriefFile, debriefOrphan]) await assert.rejects(fs.stat(removed), { code: "ENOENT" });

    await open("Member", "America/Los_Angeles");
    const storeFile = path.join(root, "Member", "guild-runs.json");
    const beforeCancellation = await fs.readFile(storeFile);
    await fs.writeFile(json, JSON.stringify({ ...cancellation, prep: revised.prep }));
    await button("Import run pack").click();
    await run().getByRole("alert").waitFor();
    assert.equal(await button("Apply received revision").count(), 0);
    assert.deepEqual(await fs.readFile(storeFile), beforeCancellation);
    await fs.writeFile(json, cancellationBytes);
    await button("Import run pack").click();
    await button("Apply received revision").click();
    await run().getByText("Received run on this installation", { exact: true }).waitFor();
    assert.match(await run().locator("pre").innerText(), /CANCELLED/);
    assert.equal(await run().getByRole("checkbox").count(), 0);
    assert.deepEqual((await ipc("received", pack.eventId)).completedPrepIds, []);

    const orphan = `${storeFile}.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp`, neighbor = `${orphan}.bak`;
    // The interrupted write contains the earlier member record with a private check.
    await fs.writeFile(orphan, beforeCancellation);
    await fs.writeFile(neighbor, "fixture: not an owned atomic temp");
    const reset = () => page.evaluate(() => window.backstage.resetData());
    assert.equal(await reset(), null);
    assert.deepEqual(await fs.readFile(orphan), beforeCancellation);
    await app.evaluate(() => guildFixture.confirmReset = true);
    assert.deepEqual((await reset()).profiles, []);
    assert.deepEqual(await ipc("list"), { organized: [], received: [] });
    for (const removed of [orphan, storeFile]) await assert.rejects(fs.stat(removed), { code: "ENOENT" });
    assert.equal(await fs.readFile(neighbor, "utf8"), "fixture: not an owned atomic temp");
    assert.deepEqual(await fs.readFile(json), cancellationBytes);
    assert.deepEqual(errors, []);
    console.log("Guild Run Pack Electron PASS: newcomer template, officer debrief, reviewed clipboard, officer corrections, exact welcome/Run Pack/backup boundaries, compact keyboard preview, author/member installs, DST, revision, cancellation, journal replacement and reset cleanup.");
  } finally {
    try { await app?.close(); } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
