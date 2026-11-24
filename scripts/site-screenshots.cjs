"use strict";
// Website feature-tour screenshots (roadmap R5). Not a test: it opens the real app with the fixture
// characters from scripts/site-fixture.cjs and saves one clean picture per pillar.
//
//   mkdir /c/Users/faren/Projects/.bf-electron-lock      (one Electron window at a time)
//   BF_TEST_INACTIVE=1 node scripts/site-screenshots.cjs [OUTDIR] [--webp DIR] [--game "<…>/_forever_"] [--only name,name]
//                                                        [--size 984x635] [--lang de] [--shots FILE] [--og FILE]
//   rmdir /c/Users/faren/Projects/.bf-electron-lock
//
// OUTDIR defaults to work/site-shots (git-ignored) and receives the PNGs. --webp DIR also writes
// each picture as WebP (as taken, at most 1600 px wide, and an 800 px wide "-800" copy) for the
// website, e.g. --webp ../bf-site-next/backstage-forever/tour. --og FILE also writes the 1200x630
// link-preview picture (the Now screen beside the crest) as a JPEG. scripts/build-site.cjs writes the pages around them. --game points at a WoW Forever folder that is only READ
// (item names, talents and icons come from the player's own files; nothing is installed there,
// because the app is connected to a throwaway synthetic client folder instead).
// A picture is cut to the page content (no side rail, no top bar) unless its row says `frame: true`
// (the whole window) or `clip` (one element). Scrollbars are hidden in every picture.
// --size, --lang and --shots are for layout reviews: another window size, another language, and
// another list of pictures (same shape as scripts/site-shots.cjs).
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { buildCharacters } = require("./site-fixture.cjs");

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const SIZE = (flag("--size") || "1600x1000").split("x").map(Number);
if (SIZE.length !== 2 || !SIZE.every((n) => Number.isInteger(n) && n >= 600 && n <= 4000)) throw new Error("--size wants WIDTHxHEIGHT, for example 984x635");
const LANG = flag("--lang") || "en";
if (!/^[a-z]{2}$/.test(LANG)) throw new Error("--lang wants a two-letter language, for example de");
const webpDir = flag("--webp"), ogFile = flag("--og");
const gameDir = flag("--game"), only = (flag("--only") || "").split(",").filter(Boolean);
const explore = args.includes("--explore") && args.splice(args.indexOf("--explore"), 1);
const out = path.resolve(args[0] || "work/site-shots");

const click = (page, name, role = "button") => page.getByRole(role, { name, exact: true }).first().click();
// name, character, route, then optional steps inside the screen.
const shotsFile = flag("--shots");
const SHOTS = require(shotsFile ? path.resolve(shotsFile) : "./site-shots.cjs");

// What the fixture takes from the player's own game files (read only): the mage talent trees and
// the recipe list, so the level 60 fixture knows believable talents and recipes. Null without --game.
function gameFacts(gameDir, cacheDir) {
  if (!gameDir) return null;
  try {
    const gd = new (require("../src/core/game-data.cjs").GameData)({ getRoot: () => path.resolve(gameDir), cacheDir });
    return { talents: gd.talents("Mage"), recipes: gd.recipes() };
  } catch (error) { console.error(`Game files not read for the fixture: ${error.message}`); return null; }
}

// The 1200x630 picture shown when a link to the site is shared: the Now screen beside the crest.
// Runs in the app's page, so it draws with the app's own fonts and crest.
async function ogPicture([png]) {
  const W = 1200, H = 630, canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const shot = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
  const crest = new Image();
  crest.src = "../../assets/crest.svg";
  await crest.decode();
  await document.fonts.load("700 64px Cinzel");
  const back = ctx.createLinearGradient(0, 0, W, H);
  back.addColorStop(0, "#191421"); back.addColorStop(1, "#0f151d");
  ctx.fillStyle = back; ctx.fillRect(0, 0, W, H);
  // The screenshot, leaning out of the right edge.
  const sw = 860, sh = Math.round(shot.height * sw / shot.width), sx = 470, sy = 118;
  ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
  ctx.fillStyle = "#000"; ctx.fillRect(sx, sy, sw, sh);
  ctx.shadowColor = "transparent";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(shot, sx, sy, sw, sh);
  ctx.strokeStyle = "#705b46"; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, sw, sh);
  const fade = ctx.createLinearGradient(380, 0, 760, 0);
  fade.addColorStop(0, "#151520"); fade.addColorStop(1, "rgba(21,21,32,0)");
  ctx.fillStyle = fade; ctx.fillRect(380, 0, 380, H);
  ctx.fillStyle = "#151520"; ctx.fillRect(0, 0, 380, H);
  ctx.drawImage(crest, 60, 70, 104, 104);
  ctx.fillStyle = "#fff6e4"; ctx.font = "700 60px Cinzel, Georgia, serif"; ctx.textBaseline = "alphabetic";
  ctx.fillText("Backstage", 60, 262);
  ctx.fillStyle = "#f2ca94"; ctx.fillText("Forever", 60, 330);
  ctx.fillStyle = "#ede2d0"; ctx.font = "600 27px 'Source Sans 3', 'Segoe UI', sans-serif";
  ["Free companion app", "and addon for WoW Forever"].forEach((line, i) => ctx.fillText(line, 60, 392 + i * 36));
  ctx.fillStyle = "#c9bca8"; ctx.font = "400 21px 'Source Sans 3', 'Segoe UI', sans-serif";
  ["Leveling guide · talents · dungeons", "map · professions · gold"].forEach((line, i) => ctx.fillText(line, 60, 486 + i * 30));
  ctx.fillStyle = "#f2d4a6"; ctx.fillRect(60, 560, 150, 4);
  return canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
}

(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-site-shots-"));
  let app;
  const watchdog = setTimeout(() => { console.error("Site screenshots exceeded 10 minutes"); process.exitCode = 1; app?.process().kill(); }, 600000);
  try {
    await fs.mkdir(out, { recursive: true });
    if (webpDir) await fs.mkdir(webpDir, { recursive: true });
    const data = path.join(dir, "user-data"), game = path.join(dir, "synthetic-client");
    const saved = path.join(game, "WTF/Account/Fixture/SavedVariables/BackstageForever.lua");
    await fs.mkdir(data);
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, profiles: [], activeProfileId: null }));
    const clock = Math.floor(Date.now() / 1000);
    const characters = buildCharacters({ clock, version: require("../package.json").version, game: gameFacts(gameDir, path.join(dir, "fixture-game-cache")) });
    const write = (activeId) => fs.writeFile(saved, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: clock, activeId, characters })));
    await write(characters[0].id);
    // The shared isolation (no updates, no AI, no network lookups), plus read-only game data when asked.
    const boot = await syntheticLaunch(data);
    await fs.writeFile(path.join(boot, "site-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(path.resolve(__dirname, ".."), "package.json"))});
      const dir=${JSON.stringify(gameDir ? path.resolve(gameDir) : null)};
      // Only the game-data reader looks at the real folder (it never writes there); everything else keeps the synthetic client.
      if(dir)for(const C of [load('./src/core/game-data.cjs').GameData,load('./src/core/map-art.cjs').MapArt])Object.defineProperty(C.prototype,'getRoot',{get(){return()=>dir;},set(){}});
      const L=load('./src/core/live-bridge.cjs').LiveBridge;L.prototype.readPreference=function(){return false;};L.prototype.start=function(){};
      require('./main.cjs');`);
    await fs.writeFile(path.join(boot, "package.json"), JSON.stringify({ name: "site-screenshots", version: require("../package.json").version, main: "site-main.cjs" }));
    app = await launchElectron(electron, { args: [boot], env: { ...process.env, BF_USER_DATA: data, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), SIZE);
    await page.evaluate((lang) => { localStorage.setItem("bf-setup-v4", "complete"); localStorage.setItem("bf-tour-v1", "done"); localStorage.setItem("bf-lang-v1", lang); }, LANG);
    await page.evaluate((root) => window.backstage.prepareGame(root), game);
    await page.reload();
    // No scrollbars in the pictures. Added from the main process: the page's own rules allow no injected styles.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.insertCSS("::-webkit-scrollbar{width:0!important;height:0!important}"));
    await page.waitForFunction((n) => document.querySelectorAll("#active-character option").length === n, characters.length);
    await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, SIZE);
    const choose = async (name) => {
      const select = page.locator("#active-character");
      const value = await select.locator("option", { hasText: name }).first().getAttribute("value");
      if ((await select.inputValue()) !== value) { await select.selectOption(value); await page.waitForTimeout(1200); }
    };
    const settle = async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1200);
      // Nothing half-loaded and no hover or focus ring in the picture.
      await page.evaluate(() => {
        document.activeElement?.blur?.();
        // The pictures outlive a release: leave the version number out of them.
        const walker = document.createTreeWalker(document.querySelector(".rail"), NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) if (/^v\d+\.\d+\.\d+/.test(node.nodeValue.trim())) node.nodeValue = "";
      });
      await page.mouse.move(2, 2);
    };
    // Destinations the shared navigation table does not list: click the menu buttons by their labels.
    const go = async (labels) => {
      for (const label of labels) {
        const ok = await page.evaluate((label) => {
          const b = [...document.querySelectorAll("nav button")].find((x) => x.getBoundingClientRect().width > 0 && (x.textContent || "").replace(/\s+/g, " ").trim().endsWith(label));
          if (b) b.click();
          return Boolean(b);
        }, label);
        if (!ok) throw new Error(`no menu button for ${label}`);
        await page.waitForTimeout(600);
      }
    };
    const failed = [];
    const extra = { talents: ["Characters", "Talents"], badges: ["Characters", "Badges"], commands: ["Help", "Commands"], coverage: ["Help", "Data coverage"] };
    const list = explore ? [...Object.keys(require("./player-navigation.cjs").routes).map((id) => [id, id]), ...Object.entries(extra)].flatMap(([id, route]) => ["Aelora", "Thessaly"].map((who) => ({ name: `explore-${who}-${id}`, who, route, frame: true }))) : SHOTS;
    for (const shot of list) {
      if (only.length && !only.some((o) => shot.name.includes(o))) continue;
      try {
        await choose(shot.who);
        // `nav` lists menu buttons by their route ids, which works in every language.
        if (shot.nav) for (const id of shot.nav) { await page.locator(`button[data-nav="${id}"]`).first().click(); await page.waitForTimeout(500); }
        else if (Array.isArray(shot.route)) await go(shot.route); else await navigate(page, shot.route);
        await settle();
        if (shot.steps) { await shot.steps({ page, app, click: (name, role) => click(page, name, role) }); await settle(); }
        if (shot.top) {
          await page.locator(shot.top).first().evaluate((el) => {
            let box = el.parentElement;
            while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
            box = box || document.scrollingElement;
            const floor = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
            box.scrollTop += el.getBoundingClientRect().top - floor - 14;
          });
          await settle();
        }
        // A list that scrolls inside the page ends on a whole row, not half-way through one.
        await page.evaluate(() => {
          for (const box of document.querySelectorAll(".content *")) {
            const cs = getComputedStyle(box);
            if (!/auto|scroll/.test(cs.overflowY) || box.scrollHeight <= box.clientHeight + 4 || box.clientHeight < 80) continue;
            const rows = box.querySelector("tbody") ? [...box.querySelectorAll("tbody > tr")] : [...(box.children.length === 1 ? box.children[0].children : box.children)];
            const rect = box.getBoundingClientRect(), edge = rect.top + box.clientTop + box.clientHeight;
            const whole = rows.filter((r) => r.getBoundingClientRect().bottom <= edge + 0.5).at(-1);
            if (!whole || !rows.some((r) => r.getBoundingClientRect().top < edge - 1 && r.getBoundingClientRect().bottom > edge + 0.5)) continue;
            const trim = edge - whole.getBoundingClientRect().bottom - 1;
            const height = Math.floor((cs.boxSizing === "border-box" ? rect.height : box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) - trim);
            box.style.height = `${height}px`; box.style.maxHeight = `${height}px`;
          }
        });
        if (shot.dump && process.env.BF_SITE_DUMP) await fs.writeFile(path.join(out, `${shot.name}.html`), await page.locator(shot.dump).first().evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll("img,svg,style,script").forEach((x) => x.remove()); return c.outerHTML.replace(/ (style|src|title|aria-[a-z]+)="[^"]*"/g, "").slice(0, 60000); }));
        const file = path.join(out, `${shot.name}.png`);
        if (shot.clip) await page.locator(shot.clip).first().screenshot({ path: file });
        else if (shot.frame || shot.fullPage) await page.screenshot({ path: file, ...(shot.fullPage ? { fullPage: true } : {}) });
        else {
          // The page content only: from `top` (or the first thing on the page) down to `bottom` (or the window's edge).
          const clip = await page.evaluate(({ top, bottom }) => {
            const box = document.querySelector(".content"), c = box.getBoundingClientRect(), cs = getComputedStyle(box), pad = 14;
            const first = top ? document.querySelector(top) : null, last = bottom ? [...document.querySelectorAll(bottom)].at(-1) : null;
            const x0 = c.left + parseFloat(cs.paddingLeft) - pad, x1 = c.right - parseFloat(cs.paddingRight) + pad;
            const y0 = Math.max(0, (first ? first.getBoundingClientRect().top : c.top + parseFloat(cs.paddingTop)) - pad);
            let y1 = Math.min(innerHeight, last ? last.getBoundingClientRect().bottom + pad : innerHeight);
            if (!last) {
              // Cut through a gap, never through a line of text, a button or a picture: look upwards
              // from the window's edge for the first row of pixels nothing readable crosses.
              const boxes = [];
              const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
              const range = document.createRange();
              for (let node; (node = walker.nextNode());) { if (!node.nodeValue.trim()) continue; range.selectNodeContents(node); for (const r of range.getClientRects()) boxes.push(r); }
              for (const el of box.querySelectorAll("button, input, select, img, canvas, svg, [role=button]")) boxes.push(el.getBoundingClientRect());
              const near = boxes.filter((r) => r.width > 0 && r.height > 0 && r.bottom > innerHeight - 260 && r.top < innerHeight && r.right > x0 && r.left < x1);
              const clear = (y) => near.every((r) => r.bottom <= y - 6 || r.top >= y + 1);
              for (let y = innerHeight; y > innerHeight - 250; y--) if (clear(y)) { y1 = y; break; }
            }
            return { x: Math.round(Math.max(0, x0)), y: Math.round(y0), width: Math.round(Math.min(innerWidth, x1) - Math.max(0, x0)), height: Math.round(y1 - y0) };
          }, { top: shot.top || null, bottom: shot.bottom || null });
          if (clip.height < 200) throw new Error(`the content cut is only ${clip.height}px high`);
          await page.screenshot({ path: file, clip });
        }
        if (webpDir) for (const [suffix, width, quality] of [["", 1600, 0.82], ["-800", 800, 0.82]]) {
          const png = (await fs.readFile(file)).toString("base64");
          const webp = await page.evaluate(async ([png, width, quality]) => {
            const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
            width = Math.min(width, bitmap.width); // never blown up
            const canvas = new OffscreenCanvas(width, Math.round(bitmap.height * width / bitmap.width));
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/webp", quality })).arrayBuffer());
            let text = "";
            for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
            return btoa(text);
          }, [png, width, quality]);
          await fs.writeFile(path.join(webpDir, `${shot.name}${suffix}.webp`), Buffer.from(webp, "base64"));
        }
        console.log(`saved ${shot.name}`);
        if (shot.after) await shot.after({ page });
      } catch (error) {
        failed.push(shot.name);
        console.error(`FAILED ${shot.name}: ${String(error.message || error).split("\n")[0]}`);
        await page.screenshot({ path: path.join(out, `${shot.name}.failed.png`) }).catch(() => {});
      }
    }
    if (ogFile) await fs.writeFile(path.resolve(ogFile), Buffer.from(await page.evaluate(ogPicture, [(await fs.readFile(path.join(out, "now.png"))).toString("base64")]), "base64")).then(() => console.log("saved the link-preview picture"), (e) => { failed.push("og"); console.error(`FAILED og: ${e.message}`); });
    if (errors.length) console.error(`Page errors:\n${[...new Set(errors)].join("\n")}`);
    if (failed.length || errors.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
