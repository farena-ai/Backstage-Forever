"use strict";
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
// Actual Electron/main/preload/renderer with isolated synthetic state only.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs");
const { testWindow } = require("./test-window.cjs");
const { assertSelectContrast } = require("./select-contrast.cjs");
(async () => {
  const data = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-product-polish-"));
  const evidence = path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/product-polish-ui");
  const failures = [], metrics = [], captures = [];
  let app;
  const check = async (name, run) => { try { await run(); console.log(`PASS ${name}`); } catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); } };
  const watchdog = setTimeout(() => { console.error("Product polish fixture exceeded 150 seconds"); app?.process().kill(); process.exitCode = 1; }, 150000);
  try {
    await fs.mkdir(evidence, { recursive: true });
    await fs.mkdir(path.join(data, "knowledge-v1"));
    await fs.writeFile(path.join(data, "knowledge-v1/preferences.json"), JSON.stringify({ automatic: false, checked: {} }));
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "manual", profiles: [{ id: "manual", name: "Aeralyn", className: "Hunter", faction: "Alliance", level: 24, realm: "Fictional Realm", notes: "PRIVATE SYNTHETIC NOTE", goals: [] }] }));
    app = await electron.launch({ args: [await syntheticLaunch(data)], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(4000);
    await app.evaluate(({ app, ipcMain }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      globalThis.polishStatus = null;
      const snapshot = ipcMain._invokeHandlers.get("backstage:gameSnapshot");
      ipcMain.removeHandler("backstage:gameSnapshot");
      ipcMain.handle("backstage:gameSnapshot", async (...args) => { const result = await snapshot(...args); return polishStatus ? { ...result, gameStatus: polishStatus } : result; });
      load("./src/core/providers.cjs").models = async () => [];
      load("./src/core/claude.cjs").status = async () => ({ available: false, connected: false });
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", launchAvailable: false });
      load("./src/core/voice.cjs").VoiceService.prototype.capabilities = async () => ({ available: false, recognizers: [], voices: [], message: "Synthetic unavailable engines" });
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "manual"));
    await page.reload();
    await page.getByRole("button", { name: "Companion", exact: true }).waitFor();
    const go = name => navigate(page, name);
    const capture = async name => {
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); document.querySelector(".main")?.scrollTo(0, 0); });
      if (name.endsWith("zoom200")) {
        // Playwright's fullPage crop uses CSS units incorrectly at Electron zoom.
        const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
        await fs.writeFile(path.join(evidence, `${name}.png`), Buffer.from(png, "base64"));
      } else await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
      captures.push(`${name}.png`);
      if (name.includes("baseline-compact")) {
        await page.screenshot({ path: path.join(evidence, `${name}-viewport.png`) }); captures.push(`${name}-viewport.png`);
      }
      const measured = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, brokenImages: [...document.images].filter(n => !n.complete || !n.naturalWidth).length }));
      metrics.push({ name, ...measured });
      assert.ok(measured.scrollWidth <= measured.width, `${name}: horizontal overflow ${measured.scrollWidth}/${measured.width}`);
      assert.equal(measured.brokenImages, 0, `${name}: broken images`);
    };
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 960); w.focus(); });
    await check("first Tab/Enter skips navigation without changing trusted URL", async () => {
      const url = page.url();
      await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "skip-content");
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).position), "fixed", "Skip must not consume an empty row above the shell");
      await page.waitForFunction(() => { const n = document.activeElement, box = n?.getBoundingClientRect(); return n?.dataset.action === "skip-content" && n.matches(":focus-visible") && box.top >= 0 && box.bottom <= innerHeight; });
      await page.screenshot({ path: path.join(evidence, "skip-keyboard-focus.png") }); captures.push("skip-keyboard-focus.png");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
      assert.equal(page.url(), url);
      assert.ok(await page.locator("#main-content").getAttribute("aria-labelledby"));
      assert.ok(await page.locator("#page-heading").innerText());
    });
    await go("adventure");
    await check("manual roster source is said once", async () => assert.doesNotMatch(await page.locator(".roster-strip").innerText(), /Manual journal\s*·\s*Manual journal/));
    await check("disconnected chip is distinct from healthy local journal", async () => {
      const chip = page.locator(".game-status-chip");
      assert.equal(await chip.getAttribute("data-connection-state"), "disconnected");
      assert.notEqual(await chip.locator(".dot").evaluate(n => getComputedStyle(n).backgroundColor), await page.locator(".rail-bottom .dot").evaluate(n => getComputedStyle(n).backgroundColor));
      // Exercise current header status painting without replacing its held control.
      await chip.evaluate(n => { gameStatus = { connected: true }; render(); });
      assert.equal(await page.locator(".game-status-chip").getAttribute("data-connection-state"), "connected");
      await page.locator(".game-status-chip").evaluate(n => window.originalChip = n);
      await page.evaluate(() => { document.querySelector("#goal-form input").focus(); });
      await app.evaluate(() => polishStatus = { connected: false });
      await page.waitForFunction(() => document.querySelector(".game-status-chip")?.dataset.connectionState === "disconnected", null, { timeout: 7000 });
      assert.equal(await page.locator(".game-status-chip").evaluate(n => n === window.originalChip), true, "poll paints the current chip without replacing it during editing");
      await app.evaluate(() => polishStatus = { connected: true, phase: "folder-unavailable" });
      await page.waitForFunction(() => document.querySelector(".game-status-chip")?.dataset.connectionState === "unavailable", null, { timeout: 7000 });
      assert.equal(await page.locator("[data-game-connection-label]").innerText(), "Game folder unavailable");
      assert.equal(await page.locator(".game-status-chip").evaluate(n => n === window.originalChip), true);
      await app.evaluate(() => polishStatus = null);
    });
    await check("skip works on all eleven shell pages without background autofocus", async () => {
      for (const name of ["Company", "Party", "Preparation", "Quest Guide", "Characters", "AI Companion", "Game Connection", "Connections", "Field Guide", "Updates", "Adventure"]) {
        await go(name);
        const url = page.url();
        await page.locator("[data-action=skip-content]").focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.activeElement.id), "main-content", name);
        assert.ok(await page.locator("#page-heading").innerText(), name);
        assert.equal(page.url(), url);
      }
      await page.locator("#active-character").focus();
      await page.evaluate(() => refreshGameStatusWidget());
      assert.equal(await page.locator("#active-character").evaluate(n => n === document.activeElement), true);
    });
    await go("AI Companion");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
    await check("compact no-model setup action is visible and keeps the typed draft", async () => {
      await page.getByRole("textbox", { name: "Your question", exact: true }).fill("Keep my fictional draft");
      const configure = page.getByRole("button", { name: "Configure AI connection", exact: true });
      assert.equal(await configure.isVisible(), true);
      const box = await configure.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= await page.evaluate(() => innerHeight));
      metrics.push({ name: "compact-configure", box, viewportHeight: await page.evaluate(() => innerHeight) });
      await capture("ai-no-model-compact");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
      await capture("ai-no-model-baseline-compact");
      const originalBox = await configure.boundingBox();
      assert.ok(originalBox.y >= 0 && originalBox.y + originalBox.height <= 635, "Configure fits original compact boundary");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
      await configure.click(); await page.locator("#provider-form").waitFor();
      await go("AI Companion");
      assert.equal(await page.getByRole("textbox", { name: "Your question", exact: true }).inputValue(), "Keep my fictional draft");
    });
    await check("core composer/context/Send precede optional voice", async () => {
      const order = await page.evaluate(() => {
        const form = document.querySelector("#chat-form"), voice = document.querySelector("[data-voice]"), send = form.querySelector("button[type=submit]"), context = form.querySelector("#share-profile");
        return { sendBeforeVoice: Boolean(send.compareDocumentPosition(voice) & Node.DOCUMENT_POSITION_FOLLOWING), contextBeforeSend: Boolean(context.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING) };
      }); assert.deepEqual(order, { sendBeforeVoice: true, contextBeforeSend: true });
      await page.evaluate(() => { state.provider.model = "synthetic-model"; render(); });
      const question = page.getByRole("textbox", { name: "Your question", exact: true });
      await question.focus();
      let found = false;
      for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Send question")) { found = true; break; } }
      assert.ok(found, "Send is reachable before optional voice controls");
      const q = await question.boundingBox(), send = await page.getByRole("button", { name: "Send question", exact: true }).boundingBox();
      metrics.push({ name: "compact-send-distance", pixelsAfterQuestion: send.y - (q.y + q.height) });
      assert.ok(send.y - (q.y + q.height) < 260, "Send stays near its composer");
    });
    await capture("ai-compact");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
    await capture("ai-baseline-compact");
    const originalQuestion = await page.getByRole("textbox", { name: "Your question", exact: true }).boundingBox();
    const originalSend = await page.getByRole("button", { name: "Send question", exact: true }).boundingBox();
    assert.ok(originalSend.y - (originalQuestion.y + originalQuestion.height) < 260);
    assert.ok(originalSend.y + originalSend.height <= 635, "Configured Send fully fits original compact height");
    metrics.push({ name: "baseline-compact-send", questionBottom: originalQuestion.y + originalQuestion.height, send: originalSend });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960)); await capture("ai-full");
    await go("Field Guide");
    await check("Field Guide offers current tasks and exact privacy boundaries", async () => {
      for (const destination of ["company", "party", "preparation", "quest-guide", "game", "assistant", "connections"]) {
        const action = page.locator(`.guide-grid [data-nav="${destination}"]`); assert.ok(await action.count(), `${destination} task link`);
        await action.first().click(); await page.waitForFunction(destination => page === destination, destination); await go("Field Guide");
      }
      assert.equal(await page.getByRole("button", { name: "Delete all local data", exact: true }).isVisible(), true);
      const text = await page.locator(".guide-grid").innerText();
      for (const boundary of [/session-only/i, /memory.*off by default/i, /no audio files/i, /clears.*memory/i, /disconnects.*observation/i, /credentials and.*memory/i, /portable party/i, /no.*reload.*native Compass/i, /reference.*update.*separate.*AI/is, /offline/i]) assert.match(text, boundary);
    });
    await capture("guide-full"); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); await capture("guide-compact");
    await go("Updates");
    await check("updates heading identifies the app", async () => assert.equal(await page.getByRole("heading", { name: "Backstage Forever updates", exact: true }).count(), 1));
    await go("Quest Guide");
    await check("compact functional Quest Guide text is at least 12px", async () => {
      const sizes = await page.locator(".atlas-owner,.knowledge-status p,.knowledge-status small,.knowledge-actions button,.knowledge-actions .check-label,.reference-toggle,.quest-search-label span,.ledger-footnote").evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({ text: n.textContent.trim().slice(0, 70), size: parseFloat(getComputedStyle(n).fontSize) })));
      assert.ok(sizes.length); assert.deepEqual(sizes.filter(n => n.size < 12), []); metrics.push({ questFunctionalSizes: sizes });
    });
    await assertSelectContrast(page, "compact Quest Guide"); await capture("quest-compact");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(984, 635));
    await capture("quest-baseline-compact");
    assert.ok(await page.locator(".atlas-owner,.knowledge-status small,.reference-toggle,.ledger-footnote").evaluateAll(nodes => nodes.every(n => parseFloat(getComputedStyle(n).fontSize) >= 12)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960)); await capture("quest-full");
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 960); w.webContents.setZoomFactor(2); });
    await check("actual Electron 200% zoom retains layout", async () => { assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 2); await capture("quest-zoom200");
      const url = page.url(); await page.locator("[data-action=skip-content]").focus(); await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content"); assert.equal(page.url(), url);
    });
    await fs.writeFile(path.join(evidence, "manifest.json"), JSON.stringify({ failures, metrics, captures }, null, 2));
    assert.deepEqual(failures, [], "Product-polish regression failures");
    console.log("Product polish actual Electron PASS");
  } finally {
    clearTimeout(watchdog); if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
