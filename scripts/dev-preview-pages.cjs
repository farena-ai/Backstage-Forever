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
    // BF_PREVIEW_STATE: another state file, e.g. an anonymised one for public screenshots.
    const state = JSON.parse(await fs.readFile(process.env.BF_PREVIEW_STATE || path.join(process.env.APPDATA, "Backstage Forever", "state.json"), "utf8"));
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
        if (lang === "en") await navigate(page, id);
        else {
          // Translated menus: find each button by its label in the chosen language (the app's own translator).
          for (const label of routes[id]) {
            const ok = await page.evaluate((label) => {
              const want = (window.I18n?.tr?.(label) || label).trim();
              const b = [...document.querySelectorAll("nav button")].find((x) => x.getBoundingClientRect().width > 0 && (x.textContent || "").replace(/\s+/g, " ").trim().endsWith(want));
              if (b) b.click();
              return Boolean(b);
            }, label);
            if (!ok) throw new Error(`no menu button for ${label}`);
            await page.waitForTimeout(600);
          }
        }
        await page.waitForTimeout(1800);
        const facts = await page.evaluate(() => {
          const name = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : ""} "${(e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50)}"`;
          const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
          const visible = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !e.closest("[hidden], details:not([open]) > :not(summary)"); };
          // Visible spill: an element whose box pokes past its nearest clipping-free container's right edge.
          const spill = [...document.querySelectorAll("main *")].filter((e) => {
            if (!visible(e) || !ownText(e)) return false;
            const box = e.parentElement?.getBoundingClientRect(), r = e.getBoundingClientRect();
            return box && r.right > box.right + 2 && getComputedStyle(e.parentElement).overflowX === "visible";
          });
          // Clipped text: ellipsis or hidden overflow that is actually cutting words off.
          const clipped = [...document.querySelectorAll("main *")].filter((e) => visible(e) && ownText(e) && !e.classList.contains("sr-only") && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== "visible");
          const tiny = [...document.querySelectorAll("main *")].filter((e) => visible(e) && ownText(e) && parseFloat(getComputedStyle(e).fontSize) < 11);
          // Framed buttons draw end caps about 12px wide; text needs at least that much side padding.
          const tight = [...document.querySelectorAll("main button:not(.illustrated-card)")].filter((e) => visible(e) && (e.textContent || "").trim() && (() => { const c = getComputedStyle(e, "::before"); return c.content !== "none" && c.display !== "none" && c.backgroundImage.includes("endcap") && parseFloat(c.width) > 0; })() && parseFloat(getComputedStyle(e).paddingLeft) < 12);
          // Dark text inside a framed (dark) button: a card that lost its own background to the button style.
          const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g)?.map(Number) || [255, 255, 255]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
          const darkOnDark = [...document.querySelectorAll("main button:not(.illustrated-card)")].filter(visible).flatMap((b) => getComputedStyle(b).backgroundImage.includes("rgb(57, 59, 50)") ? [b, ...b.querySelectorAll("*")].filter((e) => ownText(e) && lum(getComputedStyle(e).color) < 0.35) : []);
          // End caps drawn by a button that is not positioned land on some other box (a card, the window edge).
          const stray = [...document.querySelectorAll("button:not(.illustrated-card)")].filter((e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e, "::before"); return r.width > 0 && getComputedStyle(e).position === "static" && c.display !== "none" && c.backgroundImage.includes("endcap"); });
          return { stray: stray.map(name).slice(0, 6), strayCount: stray.length, darkOnDark:darkOnDark.map(name).slice(0, 6), darkOnDarkCount: darkOnDark.length, tight:tight.map((e) => getComputedStyle(e).paddingLeft + " " + name(e)).slice(0, 8), tightCount: tight.length, spill:spill.map(name).slice(0, 8), spillCount: spill.length, clipped: clipped.map(name).slice(0, 8), clippedCount: clipped.length, tiny: tiny.map((e) => getComputedStyle(e).fontSize + " " + name(e)).slice(0, 6), tinyCount: tiny.length, height: document.querySelector("main")?.scrollHeight || 0 };
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
