"use strict";
// Local-only dev preview (not a test), for the G12 art review: your own saved state drives the real
// app, and every page is saved as a full screenshot. The window never takes focus (BF_TEST_INACTIVE).
// Usage: node scripts/dev-preview-pages.cjs OUTDIR [WIDTHxHEIGHT] [en|de]
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { navigate, routes } = require("./player-navigation.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-pages-preview-"));
  const out = process.argv[2] || path.join(os.tmpdir(), "bf-pages");
  const [w, h] = (process.argv[3] || "1440x960").split("x").map(Number);
  const lang = process.argv[4] || "en";
  await fs.mkdir(out, { recursive: true });
  let app;
  try {
    const state = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, "Backstage Forever", "state.json"), "utf8"));
    delete state.gameConnection;
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-pages-preview", version: "0.54.0", main: "m.cjs" }));
    await fs.writeFile(path.join(dir, "m.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=function(){return false;};L.LiveBridge.prototype.start=function(){};
      load('./src/main.cjs');`);
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
    await page.evaluate((lang) => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); localStorage.setItem("bf-lang-v1", lang); }, lang);
    await page.reload();
    await page.waitForTimeout(2500);
    const report = [];
    for (const id of Object.keys(routes)) {
      try {
        await navigate(page, id);
        await page.waitForTimeout(1800);
        const facts = await page.evaluate(() => {
          const over = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === "visible"; }).length;
          const tiny = [...document.querySelectorAll("main *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length;
          return { overflowing: over, tinyText: tiny, height: document.querySelector("main")?.scrollHeight || 0 };
        });
        await page.screenshot({ path: path.join(out, `${id}.png`), fullPage: true });
        report.push({ id, ...facts });
      } catch (e) { report.push({ id, error: String(e.message || e).slice(0, 200) }); }
    }
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report));
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
