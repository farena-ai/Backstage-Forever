"use strict";
// Character sheet (0.36): a synthetic saved export with an Alliance and a Horde character, read
// through the real game sync, main IPC, preload and renderer. Characters -> Sheet shows the paper
// doll, stats, an upgrade in the bags and gear sets with where each piece is; Ledger -> Gold &
// prices sets, shows and clears a gold goal.
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-sheet-"));
  let app;
  const watchdog = setTimeout(() => { console.error("Sheet fixture exceeded 150 seconds"); process.exitCode = 1; app?.process().kill(); }, 150000);
  try {
    const data = path.join(dir, "synthetic-user-data");
    await fs.mkdir(data);
    const game = path.join(dir, "synthetic-client"), saved = path.join(game, "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, profiles: [], activeProfileId: null, provider: { ...defaultState().provider, model: "synthetic-model" } }));
    const clock = Math.floor(Date.now() / 1000), day = 86400;
    const eq = (slot, itemId, name, quality, itemLevel) => ({ slot, itemId, name, quality, itemLevel });
    const characters = [
      { id: "Synthetic-Aeralyn", name: "Aeralyn", faction: "Alliance", race: "Human", className: "Mage", level: 30,
        readiness: { equipment: [eq(1, 900001, "Synthetic Circlet", 2, 28), eq(5, 900002, "Synthetic Robe", 3, 31), eq(16, 900003, "Synthetic Staff", 2, 12), eq(4, 900004, "Synthetic Shirt", 1, 1)] },
        stats: { schemaVersion: 1, seenAt: clock, strength: 31, agility: 28, stamina: 60, intellect: 132, spirit: 101, armor: 410, attackPower: 21, health: 1110, power: 1660, powerKind: "mana", resist: { frost: 10 } },
        gearSets: { schemaVersion: 1, sets: [{ name: "Dungeon", savedAt: clock - 600, items: [{ slot: 1, itemId: 900001, name: "Synthetic Circlet" }, { slot: 8, itemId: 900010, name: "Synthetic Boots" }, { slot: 15, itemId: 900011, name: "Synthetic Cloak" }, { slot: 13, itemId: 900012, name: "Synthetic Charm" }] }] },
        ledger: { schemaVersion: 1, money: 600000, moneyAt: clock, moneyLog: [[400000, clock - 4 * day], [600000, clock]],
          bags: { seenAt: clock, complete: true, items: [{ id: 900010, n: 1, q: 2, name: "Synthetic Boots" }] },
          bank: { seenAt: clock - day, complete: true, items: [{ id: 900011, n: 1, q: 2, name: "Synthetic Cloak" }] }, cooldowns: [], prices: [] } },
      { id: "Synthetic-Vaelric", name: "Vaelric", faction: "Horde", race: "Orc", className: "Warrior", level: 40,
        readiness: { equipment: [eq(16, 900020, "Synthetic Greataxe", 3, 38)] },
        stats: { schemaVersion: 1, seenAt: clock, strength: 140, agility: 70, stamina: 120, intellect: 20, spirit: 40, armor: 2100, attackPower: 380, health: 2400, power: 100, powerKind: "rage" },
        gearSets: { schemaVersion: 1, sets: [{ name: "Leveling", savedAt: clock, items: [{ slot: 16, itemId: 900020, name: "Synthetic Greataxe" }] }] },
        ledger: { schemaVersion: 1, money: 200000, moneyAt: clock, moneyLog: [[200000, clock - 4 * day], [200000, clock]],
          bags: { seenAt: clock, complete: true, items: [{ id: 900012, n: 1, q: 3, name: "Synthetic Charm" }] }, cooldowns: [], prices: [] } },
    ].map((c) => ({ realm: "Synthetic Realm", updatedAt: clock, clientBuild: "1.60.1.70862", captureVersion: require("../package.json").version, ...c }));
    await fs.writeFile(saved, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: clock, activeId: characters[0].id, characters })));
    app = await launchElectron(electron, { args: [await syntheticLaunch(data)], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.evaluate((root) => window.backstage.prepareGame(root), game);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#active-character option").length === 2);
    const capture = path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/sheet-smoke");
    await fs.mkdir(capture, { recursive: true });
    const shot = (name) => page.screenshot({ path: path.join(capture, `${name}.png`), fullPage: true });

    // Sheet for the Alliance mage: slots, average item level, stats, empty slots, sets.
    await navigate(page, "sheet");
    await page.locator('[data-sheet-slot="1"][data-card-item="900001"]').waitFor();
    const sheet = () => page.locator("[data-sheet]").innerText();
    let text = await sheet();
    assert.match(text, /Aeralyn/);
    assert.match(text, /Synthetic Robe/);
    assert.match(text, /23\.7\s*average item level/i, "(28 + 31 + 12) / 3, shirt not counted");
    assert.match(text, /Intellect\s*132/);
    assert.match(text, /Frost resistance\s*10/);
    assert.match(text, /Time to replace/, "a level 12 staff at level 30");
    assert.match(text, /Empty:.*Neck/);
    assert.equal(await page.locator(".sht-missing").count() > 0, true);
    const set = page.locator('[data-sheet-set="Dungeon"]');
    const setText = await set.innerText();
    assert.match(setText, /Synthetic Circlet[\s\S]*Worn/);
    assert.match(setText, /Synthetic Boots[\s\S]*In your bags/);
    assert.match(setText, /Synthetic Cloak[\s\S]*In the bank/);
    assert.match(setText, /Synthetic Charm[\s\S]*On Vaelric \(bags\)/);
    assert.match(setText, /\/bf set wear Dungeon/);
    await shot("sheet-alliance");

    // The Horde warrior through the character picker.
    await page.getByLabel("Active character", { exact: true }).selectOption({ label: "Vaelric · Level 40" });
    await page.waitForFunction(() => /Vaelric/.test(document.querySelector("[data-sheet]")?.innerText || "") && document.querySelector('[data-sheet-set="Leveling"]'));
    text = await sheet();
    assert.match(text, /Synthetic Greataxe/); assert.match(text, /Rage\s*100/); assert.match(text, /Horde/);
    assert.doesNotMatch(text, /Synthetic Robe/);
    await shot("sheet-horde");

    // Gold goal on Gold & prices: set, progress across both characters, pace, clear.
    await navigate(page, "ledger-gold");
    await page.locator("[data-ledger-goal-card]").waitFor();
    assert.match(await page.locator("[data-ledger-goal-card]").innerText(), /no trainer or mount prices/);
    await page.getByLabel("Gold goal in gold", { exact: true }).fill("100");
    await page.getByLabel("What the gold goal is for", { exact: true }).fill("Riding and first mount");
    await page.locator("[data-ledger-goal-save]").click();
    await page.locator("[data-ledger-goal-status]").waitFor();
    const goal = await page.locator("[data-ledger-goal-card]").innerText();
    assert.match(goal, /Riding and first mount/);
    assert.match(goal, /80g[\s\S]*of[\s\S]*100g/, "gold of both characters");
    assert.match(goal, /20g\s*to go, about 4 days/, "20g gained over 4 days is 5g a day");
    await shot("gold-goal");
    await page.locator("[data-ledger-goal-clear]").click();
    await page.waitForFunction(() => !document.querySelector("[data-ledger-goal-status]") && document.querySelector("[data-ledger-goal-save]")?.textContent === "Set goal");
    console.log("Sheet smoke passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
