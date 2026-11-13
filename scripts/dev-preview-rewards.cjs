"use strict";
// Local-only dev preview (not a test): real game data from your install drives reward cards on a quest page.
// Usage: BF_PREVIEW_ROOT="F:\...\_forever_" node scripts/dev-preview-rewards.cjs OUT.png QUESTID CLASS LEVEL
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-preview-"));
  const out = process.argv[2] || path.join(os.tmpdir(), "reward-preview.png");
  const questId = Number(process.argv[3] || 792), cls = process.argv[4] || "Warrior", level = Number(process.argv[5] || 6);
  let app;
  try {
    const profile = { id: "Alpha", name: "Preview", className: cls, realm: "Synthetic", level, race: "Orc", faction: "Horde", goals: [], notes: "", location: { zone: "Durotar", mapId: 1411, x: 0.5, y: 0.5 }, quests: [] };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [profile] }));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-preview", version: "0.23.0", main: "m.cjs" }));
    await fs.writeFile(path.join(dir, "m.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=function(){return false;};L.LiveBridge.prototype.start=function(){};
      const G=load('./src/core/game-data.cjs'); const Base=G.GameData;
      G.GameData=class extends Base{constructor(o){super({...o,getRoot:()=>process.env.BF_PREVIEW_ROOT});}};
      load('./src/main.cjs');`);
    app = await electron.launch({ args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1100));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete")); await page.reload();

    console.log('status', JSON.stringify(await page.evaluate(() => window.backstage.gameDataStatus())), JSON.stringify(await page.evaluate(() => window.backstage.gameItems([4924]))).slice(0, 200));
    if (process.env.BF_PREVIEW_PAGE === "talents") {
      await page.locator('[data-nav="characters"]').first().click();
      await page.locator('[data-nav="talents"]').first().click();
      await page.locator(".tal-tree").first().waitFor({ timeout: 20000 }); await page.waitForTimeout(2500);
      await page.screenshot({ path: out, fullPage: true }); console.log("preview", out); return;
    }
    await page.locator('[data-nav="quest-guide"]').first().click();
    await page.evaluate((id) => QuestGuide.open(id), questId);
    await page.locator(`[data-quest-control="detail:${questId}"]`).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.locator(".quest-rewards-section").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const sel = process.env.BF_PREVIEW_SECTION || ".quest-rewards-section"; await page.locator(sel).scrollIntoViewIfNeeded(); const box = await page.locator(sel).boundingBox();
    await page.screenshot({ path: out, fullPage: false, clip: box ? { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(1100, box.width + 20), height: Math.min(900, box.height + 20) } : undefined });
    console.log("preview", out);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
