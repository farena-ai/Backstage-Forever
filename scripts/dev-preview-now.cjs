"use strict";
// Local-only dev preview (not a test): your own saved state drives Now at the app's default window size.
// Usage: [BF_PREVIEW_ROOT=".../_forever_"] node scripts/dev-preview-now.cjs OUT.png [PROFILE_NAME] [WIDTHxHEIGHT]
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { testWindow } = require("./test-window.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-now-preview-"));
  const out = process.argv[2] || path.join(os.tmpdir(), "now-preview.png");
  const [w, h] = (process.argv[4] || "1440x960").split("x").map(Number);
  let app;
  try {
    const state = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, "Backstage Forever", "state.json"), "utf8"));
    const want = process.argv[3] && state.profiles.find((p) => p.name === process.argv[3]);
    if (want) state.activeProfileId = want.id;
    delete state.gameConnection;
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-now-preview", version: "0.25.0", main: "m.cjs" }));
    await fs.writeFile(path.join(dir, "m.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=function(){return false;};L.LiveBridge.prototype.start=function(){};
      if (process.env.BF_PREVIEW_ROOT) { const G=load('./src/core/game-data.cjs'); const Base=G.GameData; G.GameData=class extends Base{constructor(o){super({...o,getRoot:()=>process.env.BF_PREVIEW_ROOT});}}; }
      load('./src/main.cjs');`);
    app = await electron.launch({ args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete")); await page.reload();
    await page.locator("[data-now-body] .now-card").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const nav = await page.evaluate(() => { const els = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== "visible" && e.getBoundingClientRect().left < 260 && e.getBoundingClientRect().width < 400); return els.map((e) => ({ cls: e.className, sh: e.scrollHeight, ch: e.clientHeight })); });
    console.log("scrolling left panes", JSON.stringify(nav));
    console.log("cards", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".now-grid > *")].map((e) => { const r = e.getBoundingClientRect(); return [e.querySelector("h2")?.textContent, Math.round(r.left), Math.round(r.top), Math.round(r.bottom)]; }))));
    await page.screenshot({ path: out });
    await page.evaluate(() => document.querySelector(".now-grid")?.scrollIntoView());
    await page.screenshot({ path: out.replace(/\.png$/, "-grid.png") });
    if (process.env.BF_PREVIEW_SELECTOR) { await page.waitForTimeout(1500); await page.locator(process.env.BF_PREVIEW_SELECTOR).first().screenshot({ path: out.replace(/\.png$/, "-part.png") }); }
    console.log("wrote", out);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
