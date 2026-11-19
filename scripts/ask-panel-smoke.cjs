"use strict";
// Ask the companion from inside the game (0.38, A15). Real main/preload/renderers; the capture
// worker is replaced by synthetic decoded strip pages and the AI provider by a fixed reply.
// A question arrives as question pages -> the answer panel appears with the answer, is not
// focused, sits at the top-right of the (synthetic) game window on the secondary test display,
// escapes HTML, joins the Companion conversation, "Open in app" shows the Companion page, and the
// Settings switch turns the panel off. One window (0.39.1): the owl's open signal brings the panel up
// ready to type, a question typed there is answered under the first one, and Esc closes it.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const REPLY = "A **two-handed axe** suits a level 12 warrior.\n\n- Keep the <b>tag</b> text as text\n- Train at level 14";
(async () => {
  const tmp = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tmp, "forever-ask-panel-"));
  const capture = path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/ask-panel-smoke");
  await fs.mkdir(capture, { recursive: true });
  let app;
  const watchdog = setTimeout(() => { console.error("Ask panel fixture exceeded 120 seconds"); app?.process().kill(); process.exitCode = 1; }, 120000);
  try {
    const initial = { ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [{ id: "Alpha", name: "Alpha", className: "Warrior", realm: "Synthetic", level: 12, race: "Orc", faction: "Horde", goals: [], notes: "", location: { zone: "The Barrens", mapId: 1413, x: 0.6, y: 0.2 } }], provider: { id: "ollama", model: "fixture", endpoint: "http://127.0.0.1:11434", authMode: "api" } };
    const at = "2025-01-01T00:00:00.000Z", col = (items) => ({ items, observedAt: at, complete: true });
    Object.assign(initial.profiles[0], { source: { kind: "wow-addon", id: "fixture-alpha", updatedAt: at }, clientBuild: "1.60.1.70862", readiness: { workshop: {
      professions: col([{ skillLineId: 171, professionId: 4, name: "Alchemy", rank: 20, maxRank: 75 }]),
      recipes: col([{ id: 2330, skillLineId: 171, name: "Fixture Private Potion", reagentsKnown: true, reagents: [{ itemId: 765, name: "Silverleaf", required: 1 }] }]),
      materials: { ...col([{ itemId: 765, count: 7 }]), scope: "bags-0-4" },
    } } });
    validateState(initial);
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-ask-panel-fixture", version: require("../package.json").version, main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      const electron=load('electron');electron.app.getAppPath=()=>${JSON.stringify(repo)};
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
      load('./src/core/updater.cjs').Updater.prototype.start=function(){};
      const providers=load('./src/core/providers.cjs');
      providers.ask=async(req)=>{globalThis.askFixture.requests.push({prompt:req.prompt,context:req.context?'character':'none'});return ${JSON.stringify(REPLY)};};
      globalThis.askFixture={requests:[], companionPrompts:[]};
      const service=load('./src/core/companion-service.cjs').CompanionService.prototype, originalAsk=service.ask;
      service.ask=function(...args){globalThis.askFixture.companionPrompts.push(args[0]?.prompt);return originalAsk.apply(this,args);};
      const L=load('./src/core/live-bridge.cjs');
      L.rememberLiveKey('fixture-alpha','Player-1-00000001');
      L.LiveBridge.prototype.start=function(){globalThis.liveFixture={bridge:this,L};this.signal='no-signal';};
      L.LiveBridge.prototype.stop=function(){this.signal='off';this.frame=null;};
      load('./src/main.cjs');
    `);
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "game");
    // Settings -> Game connection: the panel switch, on by default.
    const toggle = page.locator("#ask-panel-toggle");
    assert.equal(await toggle.isChecked(), true, "panel on by default");
    await page.locator("#ask-panel-hide").waitFor();
    // The synthetic game window: the secondary display when there is one (test windows never use the primary).
    const ask = (id, text, guid = "Player-1-00000001") => app.evaluate(({ screen }, { id, text, guid }) => {
      const { bridge, L } = globalThis.liveFixture, hash = L.identityHash(guid);
      const displays = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
      const target = displays.find((d) => d.id !== primary.id) || primary;
      const r = screen.dipToScreenRect ? screen.dipToScreenRect(null, target.workArea) : target.workArea;
      bridge.gameRect = { x: r.x, y: r.y, width: r.width, height: r.height, at: Date.now() };
      bridge.frame = { version: 4, seq: 1, combat: false, characterHash: hash, receivedAt: Date.now(), changedAt: Date.now() };
      bridge.signal = "live";
      // Pages arrive out of order and twice (two passes); the question is reported once.
      const pages = L.encodeQuestionPages(id, text, hash).map(L.parseQuestionPage);
      for (const p of [...pages.reverse(), ...pages]) bridge.questionPage(p);
      clearTimeout(bridge.slowTimer);
      return { area: target.workArea, secondary: target.id !== primary.id, primary: primary.bounds };
    }, { id, text, guid });
    const panelWindow = () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /ask-panel\.html$/.test(x.webContents.getURL()));
      return w ? { visible: w.isVisible(), focused: w.isFocused(), focusable: typeof w.isFocusable === "function" ? w.isFocusable() : null, top: w.isAlwaysOnTop(), bounds: w.getBounds(), taskbar: null, focusedWindow: BrowserWindow.getFocusedWindow()?.id === w.id } : null;
    });
    const question = "Is a two-handed axe good for a level 12 warrior?";
    const where = await ask(7, question);
    let panel = null;
    for (let i = 0; i < 100 && !(panel?.visible); i++) { panel = await panelWindow(); if (!panel?.visible) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(panel?.visible, "the answer panel appears");
    const view = app.windows().find((w) => /ask-panel\.html$/.test(w.url()));
    assert.ok(view, "panel page");
    await view.waitForFunction(() => document.querySelector("[data-ask-panel]")?.dataset.status === "answer", null, { timeout: 15000 });
    const text = await view.locator("[data-ask-panel]").innerText();
    assert.match(text, /You asked\s+Is a two-handed axe good for a level 12 warrior\?/i);
    assert.match(text, /two-handed axe suits a level 12 warrior/);
    assert.equal(await view.locator(".ap-answer strong").first().innerText(), "two-handed axe", "formatted like the companion chat");
    assert.match(text, /Keep the <b>tag<\/b> text as text/, "HTML in an answer is shown as text");
    assert.equal(await view.locator(".ap-answer b").count(), 0);
    assert.match(text, /Companion · AI suggestion/);
    panel = await panelWindow();
    assert.equal(panel.focused, false, "the panel never takes focus"); assert.equal(panel.focusedWindow, false);
    if (panel.focusable !== null) assert.equal(panel.focusable, true, "focusable on click so real clicks land; it still appears inactive");
    assert.equal(panel.top, true, "always on top");
    const b = panel.bounds, a = where.area;
    assert.deepEqual([b.width, b.height], [420, 380]);
    assert.ok(b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height, `inside the game's display ${JSON.stringify({ b, a })}`);
    assert.ok(Math.abs(b.x - (a.x + a.width - 436)) <= 2 && Math.abs(b.y - (a.y + Math.round(a.height * 0.25) + 8)) <= 2, `top-right of the game, under the minimap ${JSON.stringify({ b, a })}`);
    if (where.secondary) { const p = where.primary; assert.ok(b.x + b.width <= p.x || b.x >= p.x + p.width || b.y + b.height <= p.y || b.y >= p.y + p.height, "never on the primary display"); }
    else console.warn("Single display: the panel was placed on the primary display.");
    const sent = await app.evaluate(() => globalThis.askFixture.requests);
    assert.equal(sent.length, 1, "asked once although every page came twice");
    assert.match(sent[0].prompt, /Is a two-handed axe good for a level 12 warrior\?/);
    await view.screenshot({ path: path.join(capture, "ask-panel.png") });
    // One window (0.39.1). The panel's show/focus are recorded and kept inactive here, so the test
    // never takes the keyboard from whoever is at this PC.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /ask-panel\.html$/.test(x.webContents.getURL()));
      globalThis.panelCalls = [];
      w.focus = () => globalThis.panelCalls.push("focus");
      w.show = () => { globalThis.panelCalls.push("show"); w.showInactive(); };
    });
    await ask(11, "\u0001open");
    await app.evaluate(async () => { for (let i = 0; i < 100 && !globalThis.panelCalls.includes("focus"); i++) await new Promise((r) => setTimeout(r, 50)); });
    assert.deepEqual(await app.evaluate(() => globalThis.panelCalls), ["show", "focus"], "the owl opens the panel with the keyboard");
    await view.waitForFunction(() => document.activeElement?.matches("[data-ap-input]"));
    assert.equal((await app.evaluate(() => globalThis.askFixture.requests)).length, 1, "opening asks nothing");
    await view.locator("[data-ap-input]").fill("And where do I train?");
    await view.locator("[data-ap-input]").press("Enter");
    await view.waitForFunction(() => document.querySelectorAll(".ap-item").length === 2 && document.querySelector("[data-ask-panel]").dataset.status === "answer", null, { timeout: 15000 });
    assert.equal(await view.locator("[data-ap-input]").inputValue(), "", "the box empties after asking");
    const items = await view.locator(".ap-item .ap-question").allInnerTexts();
    assert.match(items[0], /two-handed axe/); assert.match(items[1], /And where do I train\?/);
    const typed = await app.evaluate(() => globalThis.askFixture.requests);
    assert.equal(typed.length, 2); assert.match(typed[1].prompt, /And where do I train\?/);
    await view.screenshot({ path: path.join(capture, "ask-panel-one-window.png") });
    await view.locator("[data-ap-input]").press("Escape");
    for (let i = 0; i < 30 && (await panelWindow()).visible; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await panelWindow()).visible, false, "Esc closes the panel");
    await ask(12, "\u0001open");
    for (let i = 0; i < 50 && !(await panelWindow()).visible; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await panelWindow()).visible, true, "the owl brings it back with the conversation");
    assert.equal(await view.locator(".ap-item").count(), 2);
    // The exchange joined the Companion conversation; "Open in app" brings that page up
    // (the main window's show/focus are made inactive here so the test never takes the keyboard).
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!/ask-panel\.html$/.test(w.webContents.getURL())) { w.focus = () => {}; w.show = () => w.showInactive(); } });
    await view.locator('[data-ap="open"]').click();
    await page.locator("#chatlog").getByText("You · from the game").first().waitFor();
    const chat = await page.locator("#chatlog").innerText();
    assert.match(chat, /Is a two-handed axe good for a level 12 warrior\?/); assert.match(chat, /two-handed axe suits a level 12 warrior/);
    panel = await panelWindow();
    assert.equal(panel.visible, false, "Open in app hides the panel");
    await page.screenshot({ path: path.join(capture, "companion-history.png") });
    // Settings off: questions are still answered in the app, but no panel appears.
    await navigate(page, "game");
    await page.locator("#ask-panel-toggle").uncheck();
    await page.waitForFunction(async () => (await window.backstage.askInGameSettings()).enabled === false);
    await ask(8, "Where is the inn?");
    await new Promise((r) => setTimeout(r, 1500));
    panel = await panelWindow();
    assert.equal(panel.visible, false, "switched off: no panel");
    await page.locator("#ask-panel-toggle").check();
    await page.waitForFunction(async () => (await window.backstage.askInGameSettings()).enabled === true);
    // Use the real share IPC, panel submit and decoded slash questions, with synthetic inventory.
    const workshop = "Can I craft recipe #2330?", dungeon = "How do I prepare for The Deadmines in Retail?";
    const mismatch = "Player-1-00000002", collision = "Player-1-0000265C";
    const hashes = await app.evaluate((_, guids) => {
      const { L } = globalThis.liveFixture;
      return [L.liveKeyFor("fixture-alpha"), ...guids.map(L.identityHash)];
    }, [mismatch, collision]);
    assert.notEqual(hashes[0], hashes[1]);
    assert.equal(hashes[0], hashes[2], "a distinct synthetic GUID actually collides with the active save");
    const counts = () => app.evaluate(() => [globalThis.askFixture.companionPrompts.length, globalThis.askFixture.requests.length]);
    const waitHandoff = async (question, total) => {
      await view.waitForFunction(({ question, total }) => {
        const items = document.querySelectorAll(".ap-item");
        const last = items[items.length - 1];
        return items.length === total && last?.dataset.status === "answer" && last.textContent.includes(question);
      }, { question, total });
      const log = await view.evaluate(async () => (await window.askPanel.state()).log);
      assert.equal(log.at(-1).question, question);
      assert.equal(log.at(-1).answer.kind, "scope");
      assert.match(log.at(-1).answer.text, /desktop Companion.*Open in app/);
      assert.doesNotMatch(JSON.stringify(log), /Fixture Private Potion|saved carried|starred loot|saved quest log/i);
      assert.doesNotMatch(await view.locator("[data-ask-panel]").innerText(), /Fixture Private Potion|saved carried|starred loot|saved quest log/i);
    };
    await page.evaluate(() => window.backstage.setInGameShare(true));
    const beforeSaved = await counts();
    await ask(20, "\u0001open");
    const publicCount = await view.evaluate(async () => (await window.askPanel.state()).log.length);
    await view.locator("[data-ap-input]").fill(workshop);
    await view.locator("[data-ap-input]").press("Enter");
    await waitHandoff(workshop, publicCount + 1);
    await ask(21, dungeon, mismatch);
    await waitHandoff(dungeon, publicCount + 2);
    await ask(22, workshop, collision);
    await waitHandoff(workshop, publicCount + 3);
    await page.evaluate(() => window.backstage.setInGameShare(false));
    await view.locator("[data-ap-input]").press("Escape");
    for (let i = 0; i < 30 && (await panelWindow()).visible; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await panelWindow()).visible, false, "the panel closes after the handoffs");
    await ask(23, "\u0001open", collision);
    for (let i = 0; i < 30 && !(await panelWindow()).visible; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await panelWindow()).visible, true, "a colliding opener can only reopen public history");
    await waitHandoff(workshop, publicCount + 3);
    assert.ok(await view.getByText("And where do I train?", { exact: false }).count(), "public exchanges survive the game switch and reopen");
    assert.deepEqual(await counts(), beforeSaved, "handoffs never enter the Companion service or provider");
    await view.locator('[data-ap="open"]').click();
    await page.locator("#chatlog").waitFor();
    assert.doesNotMatch(await page.locator("#chatlog").innerText(), /#2330|Deadmines in Retail|Fixture Private Potion/);
    await ask(24, "Is a two-handed axe good for a level 13 warrior?");
    await view.getByText("Is a two-handed axe good for a level 13 warrior?", { exact: false }).last().waitFor();
    await view.waitForFunction(() => document.querySelector(".ap-item:last-child")?.dataset.status === "answer");
    const next = await app.evaluate(() => globalThis.askFixture.requests.at(-1));
    assert.deepEqual(await counts(), beforeSaved.map(n => n + 1));
    assert.equal(next.context, "none");
    assert.doesNotMatch(next.prompt, /Fixture Private Potion|saved carried|#2330|Deadmines in Retail/i);
    // BF_REAL_CLICK=1: a genuine Windows mouse click on the panel's close button (not Chrome's
    // synthetic input), which is what a player does. Moves the mouse, so it is local only, never CI.
    if (process.env.BF_REAL_CLICK === "1" && process.platform === "win32") {
      await ask(9, "Where is the flight master?");
      panel = null;
      for (let i = 0; i < 100 && !(panel?.visible); i++) { panel = await panelWindow(); if (!panel?.visible) await new Promise((r) => setTimeout(r, 100)); }
      assert.ok(panel?.visible, "panel back for the real click");
      const view2 = app.windows().find((w) => /ask-panel\.html$/.test(w.url()));
      const r = await view2.locator('[data-ap="close"]').evaluate((n) => { const b = n.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      const scale = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).scaleFactor, panel.bounds);
      const sx = Math.round((panel.bounds.x + r.x) * scale), sy = Math.round((panel.bounds.y + r.y) * scale);
      const ps = `Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,System.UIntPtr e);'; [W.U]::SetCursorPos(${sx},${sy}); Start-Sleep -Milliseconds 150; [W.U]::mouse_event(2,0,0,0,[System.UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W.U]::mouse_event(4,0,0,0,[System.UIntPtr]::Zero)`;
      require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command", ps]);
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) { await new Promise((res) => setTimeout(res, 100)); gone = !(await panelWindow()).visible; }
      assert.ok(gone, "a real mouse click on the close button hides the panel");
      console.log("Real mouse click on the close button closed the panel.");
    }
    console.log("Ask panel smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
