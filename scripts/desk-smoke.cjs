"use strict";
// Backstage Desk in a real window: Help → Report a problem, Help → My reports and Settings →
// Privacy & sharing against the in-test fake service (tests/desk-fake-server.cjs) on 127.0.0.1.
// Run under the Electron lock with BF_TEST_INACTIVE=1. Screenshots go to work/desk-ui (git-ignored):
// 1440x900 and 984x635, in English and German.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs"), { testWindow, launch } = require("./test-window.cjs");
const { fakeDesk } = require("../tests/desk-fake-server.cjs");
const SIZES = [[1440, 900, "full"], [984, 635, "compact"]];
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-desk-")), shots = path.resolve("work/desk-ui");
  const fake = fakeDesk(), server = await fake.listen();
  let app, checks = 0;
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  const watchdog = setTimeout(() => { console.error("Desk fixture exceeded 240 seconds"); app?.process().kill(); process.exitCode = 1; }, 240000);
  try {
    await fs.mkdir(shots, { recursive: true });
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "p1",
      profiles: [{ id: "p1", name: "Thrallson", className: "Shaman", realm: "Draenor", faction: "Horde", race: "Orc", level: 23, notes: "", goals: [] }] }));
    fake.setAnnouncements([{ id: 7, title: "1.25.0 can lose the talent plan on restart", text: "Version 1.25.1 fixes it. The app updates itself; on a Mac, download it from the release page.", level: "warning", from: null, until: null, link: "https://github.com/farena-ai/Backstage-Forever/releases" }]);
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, BF_COMMUNITY_URL: server.url, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(8000);
    await app.evaluate(({ app, dialog, shell }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", launchAvailable: false });
      load("./src/core/providers.cjs").models = async () => [];
      globalThis.deskFixture = { opened: [] };
      dialog.showMessageBox = async () => ({ response: 1 });
      shell.openExternal = async (url) => { globalThis.deskFixture.opened.push(url); };
    });
    const size = (w, h) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0].setContentSize(...v), [w, h]);
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shot = async (name) => { await settle(); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const shotsOf = async (name) => { for (const [w, h, label] of SIZES) { await size(w, h); await page.evaluate(() => { document.querySelector(".main")?.scrollTo(0, 0); }); await shot(`${name}-${label}`); } await size(1440, 900); };
    const start = async (lang) => {
      await page.evaluate((lang) => { localStorage.setItem("bf-setup-v4", "manual"); localStorage.setItem("bf-lang-v1", lang); for (const k of Object.keys(localStorage)) if (/tour|onboard|welcome/i.test(k)) localStorage.setItem(k, "done"); }, lang);
      await page.reload(); await page.locator(".shell").waitFor();
      await page.evaluate(() => { document.querySelector(".bf-onboarding [data-tour-skip], .bf-onboarding button")?.click(); document.querySelector("dialog[open]")?.close(); });
    };
    await size(1440, 900);
    await start("en");
    const fitsOneLine = async (label) => {
      const tops = await page.locator(".player-subtabs button").evaluateAll((list) => list.map((b) => Math.round(b.getBoundingClientRect().top)));
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `${label}: the tab row stays on one line (${tops.join(",")})`); // the active tab sits a pixel higher
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${label}: no sideways scrolling`);
    };

    await check("a message from the team shows once as a slim card, with only an allowed link", async () => {
      await page.evaluate(() => DeskView.checkNotices());
      const card = page.locator("#desk-dock .desk-notice");
      await card.waitFor();
      assert.match(await card.innerText(), /1\.25\.0 can lose the talent plan on restart/);
      await shot("announcement-full");
      await card.getByRole("button", { name: "Read more ↗", exact: true }).click();
      assert.deepEqual(await app.evaluate(() => globalThis.deskFixture.opened), ["https://github.com/farena-ai/Backstage-Forever/releases"]);
      await card.getByRole("button", { name: "Got it", exact: true }).click();
      await card.waitFor({ state: "detached" });
      await page.evaluate(() => DeskView.checkNotices());
      await page.waitForTimeout(600);
      assert.equal(await page.locator("#desk-dock .desk-notice").count(), 0, "not shown a second time");
    });

    await check("Help → Report a problem: validation in plain words, a live “What will be sent”, the scrubber's count", async () => {
      await navigate(page, "report");
      await page.getByRole("heading", { name: "Tell us what went wrong", exact: true }).waitFor();
      assert.equal(await page.locator("nav[aria-label='Main navigation'] button").count(), 8, "no new top-level section");
      await page.getByRole("button", { name: "Send report", exact: true }).click();
      await page.locator("[data-desk-form-note]").getByText("Write a short summary first, at least 5 characters.", { exact: true }).waitFor();
      assert.equal(fake.requests("/v1/tickets").length, 0);
      await page.getByLabel("What kind of report is this?").selectOption("bug");
      await page.getByLabel("Where did it happen?").selectOption("talents");
      await page.getByLabel("Summary").fill("The talent planner shows the wrong tree");
      await page.getByLabel("What happened?").fill("I opened Talents on Thrallson-Draenor and the Frost tree showed Fire talents.\nThe log is at C:\\Users\\johnsmith\\AppData\\Roaming\\Backstage Forever\\state.json");
      await page.getByLabel(/^What did you expect instead\?/).fill("The Frost tree.");
      await page.getByLabel("How often does it happen?").selectOption("always");
      const preview = page.locator("[data-desk-preview]");
      await preview.locator(".desk-removed").filter({ hasText: "We removed 3 things that looked private." }).waitFor();
      const text = await preview.innerText();
      assert.match(text, /\[name\]-\[name\] and the Frost tree/); assert.match(text, /The log is at \[path\]/);
      assert.doesNotMatch(text, /Thrallson|Draenor|johnsmith|AppData/);
      for (const label of ["Kind", "Where", "How often", "Summary", "What happened", "What you expected", "App version", "System", "Language", "Install number", "Game folder connected", "Addon installed"]) assert.ok(text.includes(label), `preview lists ${label}`);
      assert.doesNotMatch(text, /[{}]|installId|"schema"/, "a readable list, not JSON");
      await shotsOf("report-en");
      await size(984, 635); await fitsOneLine("Help at 984x635"); await size(1440, 900);
      // Leaving the diagnostics out is one tick.
      await page.getByLabel("Include the diagnostics shown under “What will be sent”").uncheck();
      await preview.getByText("Left out. Only your text and the six lines above are sent.", { exact: true }).waitFor();
      await page.getByLabel("Include the diagnostics shown under “What will be sent”").check();
      await preview.getByText("Page you were on", { exact: true }).waitFor();
    });

    await check("sending gives a report number, and exactly the previewed fields left the computer", async () => {
      await page.getByRole("button", { name: "Send report", exact: true }).click();
      await page.getByRole("heading", { name: "Thank you. Your report was sent.", exact: true }).waitFor();
      assert.match(await page.locator(".desk-done").innerText(), /BF-1042/);
      const sent = fake.requests("/v1/tickets");
      assert.equal(sent.length, 1);
      assert.deepEqual(Object.keys(sent[0].body), ["schema", "installId", "appVersion", "addonVersion", "os", "osMajor", "lang", "build", "kind", "area", "frequency", "summary", "details", "expected", "diagnostics"]);
      assert.doesNotMatch(sent[0].raw, /Thrallson|Draenor|johnsmith|AppData|Users/);
      assert.deepEqual(Object.keys(sent[0].body.diagnostics), ["screen", "lastError", "gameConnected", "addonInstalled"]);
      await shot("report-sent-en-full");
    });

    await check("Help → My reports: a reply puts a dot on Help, the conversation opens, a reply goes out", async () => {
      fake.teamReply("BF-1042", "Thank you. Which class were you on, and did it happen after a /reload?", "question");
      await page.getByRole("button", { name: "Open My reports", exact: true }).click();
      await page.getByRole("heading", { name: "Your reports and our replies", exact: true }).waitFor();
      await page.getByRole("button", { name: "Check for replies", exact: true }).click();
      await page.locator('[data-shell-control="nav:guide"] .desk-dot').waitFor();
      await page.locator('[data-desk-open="BF-1042"] .desk-dot').waitFor();
      assert.match(await page.locator('[data-desk-open="BF-1042"]').innerText(), /Question for you/);
      await shot("inbox-unread-en-full");
      await page.locator('[data-desk-open="BF-1042"]').click();
      await page.locator(".desk-from-team").getByText("Thank you. Which class were you on, and did it happen after a /reload?", { exact: true }).waitFor();
      await page.locator('[data-shell-control="nav:guide"] .desk-dot').waitFor({ state: "detached" });
      await page.getByLabel("Your reply").fill("A mage. Yes, right after a /reload.");
      await shotsOf("inbox-en");
      await page.getByRole("button", { name: "Send reply", exact: true }).click();
      await page.getByText("Your reply was sent.", { exact: true }).waitFor();
      assert.equal(fake.tickets.get("BF-1042").messages.at(-1).text, "A mage. Yes, right after a /reload.");
      const key = fake.tickets.get("BF-1042").key;
      assert.equal((await page.content()).includes(key), false, "the ticket key is never on the page");
      // Fixed in a newer version, then in the one that is running.
      fake.setStatus("BF-1042", "fixed", "99.0.0");
      await page.getByRole("button", { name: "Check for replies", exact: true }).click();
      await page.locator(".desk-fixed").getByText("Fixed in version", { exact: true }).waitFor();
      await shot("inbox-fixed-later-en-full");
      fake.setStatus("BF-1042", "fixed", "1.0.0");
      await page.getByRole("button", { name: "Check for replies", exact: true }).click();
      await page.getByText("This is fixed in the version you are running.", { exact: true }).waitFor();
      await shot("inbox-fixed-here-en-full");
    });

    await check("an error message offers “Report this”, which opens the form filled in", async () => {
      await navigate(page, "characters");
      await page.evaluate(() => toast("The talent plan could not be saved.", true));
      await page.locator("#toast.error").getByText("The talent plan could not be saved.", { exact: true }).waitFor();
      await shot("toast-report-this-en-full");
      await page.locator("#toast").getByRole("button", { name: "Report this", exact: true }).click();
      await page.getByRole("heading", { name: "Tell us what went wrong", exact: true }).waitFor();
      assert.match(await page.getByLabel("What happened?").inputValue(), /I saw this message: “The talent plan could not be saved\.”/);
      assert.equal(await page.getByLabel("Where did it happen?").inputValue(), "journey");
    });

    await check("Settings → Privacy & sharing: three switches, the exact next message, and nothing sent while off", async () => {
      await navigate(page, "privacy");
      await page.getByRole("heading", { name: "What this app shares", exact: true }).waitFor();
      const share = page.getByLabel("Share map discoveries"), stats = page.getByLabel("Send anonymous usage statistics"), errors = page.getByLabel("Send automatic error reports");
      assert.deepEqual([await share.isChecked(), await stats.isChecked(), await errors.isChecked()], [true, true, false]);
      await page.getByText("See exactly what is sent", { exact: true }).click();
      const list = page.locator(".desk-see .desk-sent");
      for (const label of ["Install number", "App version", "System", "Language", "Game build", "First week", "Pages opened today", "Sharing map discoveries"]) await list.getByText(label, { exact: true }).waitFor();
      await shotsOf("privacy-en");
      await size(984, 635); await fitsOneLine("Settings at 984x635"); await size(1440, 900);
      await stats.uncheck();
      await page.getByText("Statistics are off, so nothing is sent. This is what would be sent if you switched them on.", { exact: true }).waitFor();
      assert.equal(fake.requests("/v1/heartbeat").length, 0, "no heartbeat so far (the first one waits five minutes after start)");
      await stats.check();
      await page.getByLabel("Show a desktop notification when a reply to one of my reports arrives").check();
    });

    await check("deleting a report takes a second click and removes it from the service", async () => {
      await navigate(page, "reports");
      await page.locator('[data-desk-open="BF-1042"]').click();
      const del = page.locator("[data-desk-delete]");
      await del.click();
      await page.getByRole("button", { name: "Click again to delete", exact: true }).waitFor();
      assert.equal(fake.tickets.has("BF-1042"), true, "one click deletes nothing");
      await page.getByRole("button", { name: "Click again to delete", exact: true }).click();
      await page.getByText("You have not sent a report yet.", { exact: true }).waitFor();
      assert.equal(fake.tickets.has("BF-1042"), false);
      await shot("inbox-empty-en-full");
    });

    await check("German: the three screens read in German and still fit", async () => {
      await start("de");
      // In German the buttons have German names, so this part goes by route.
      const go = async (group, tab) => { await page.locator(`[data-shell-control="nav:${group}"]`).click(); await page.locator(`[data-shell-control="subtab:${tab}"]`).click(); };
      await go("guide", "report");
      await page.locator('[data-desk="report"]').waitFor();
      await page.locator("#desk-summary").fill("Der Talentplaner zeigt den falschen Baum");
      await page.locator("#desk-details").fill("Ich habe Talente geöffnet und der Frostbaum zeigte Feuertalente.\nDas Protokoll liegt unter C:\\Users\\johnsmith\\AppData\\Roaming\\x.json");
      await page.locator("[data-desk-preview] .desk-removed").waitFor();
      await shotsOf("report-de");
      await size(984, 635); await fitsOneLine("Hilfe bei 984x635"); await size(1440, 900);
      await page.locator("[data-desk-send]").click();
      await page.locator(".desk-done").waitFor();
      fake.teamReply("BF-1043", "Danke. Welche Klasse war es?", "question");
      await go("guide", "reports");
      await page.locator("[data-desk-check]").click();
      await page.locator('[data-desk-open="BF-1043"]').click();
      await page.locator(".desk-from-team").waitFor();
      await shotsOf("inbox-de");
      await go("game", "privacy");
      await page.locator(".desk-see summary").click();
      await shotsOf("privacy-de");
      await size(984, 635); await fitsOneLine("Einstellungen bei 984x635"); await size(1440, 900);
      const body = await page.locator('[data-desk="privacy"]').innerText();
      assert.doesNotMatch(body, /Send anonymous usage statistics|See exactly what is sent|Forget me\b/, "the privacy screen is translated");
    });

    await check("nothing private reached the service in the whole run", async () => {
      for (const call of fake.log) assert.doesNotMatch(call.raw + call.query, /Thrallson|Draenor|johnsmith|AppData/, `${call.method} ${call.route}`);
      const routes = [...new Set(fake.log.map((c) => `${c.method} ${c.route.replace(/BF-\d+/, "BF-N")}`))].sort();
      console.log("Requests seen by the fake service:", routes.join(", "));
    });
    console.log(`Desk window checks passed (${checks}). Screenshots: ${shots}`);
  } catch (error) {
    console.error(error); process.exitCode = 1;
    try { const page = app?.windows()[0]; await page?.screenshot({ path: path.join(shots, "failure.png") }); } catch {}
  } finally {
    clearTimeout(watchdog);
    await app?.close().catch(() => {});
    await server.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})();
