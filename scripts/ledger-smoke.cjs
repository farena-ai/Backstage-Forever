"use strict";
// Ledger (0.35): a synthetic saved export with an Alliance and a Horde character, read through the
// real game sync, main IPC, preload and renderer. Each Ledger page shows its data; search narrows.
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-ledger-"));
  let app;
  const watchdog = setTimeout(() => { console.error("Ledger fixture exceeded 150 seconds"); process.exitCode = 1; app?.process().kill(); }, 150000);
  try {
    const data = path.join(dir, "synthetic-user-data");
    await fs.mkdir(data);
    const game = path.join(dir, "synthetic-client"), saved = path.join(game, "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, profiles: [], activeProfileId: null, provider: { ...defaultState().provider, model: "synthetic-model" } }));
    const clock = Math.floor(Date.now() / 1000);
    const item = (id, n, name, q = 1) => ({ id, n, q, name });
    const characters = [
      { id: "Synthetic-Aeralyn", name: "Aeralyn", faction: "Alliance", race: "Human", className: "Mage", ledger: {
        schemaVersion: 1, money: 1523045, moneyAt: clock,
        bags: { seenAt: clock, complete: true, items: [item(2589, 25, "Linen Cloth"), item(118, 3, "Minor Healing Potion")] },
        bank: { seenAt: clock - 86400 * 2, complete: true, items: [item(2589, 10, "Linen Cloth"), item(4306, 40, "Silk Cloth")] },
        mail: { seenAt: clock - 3600, complete: true, letters: 1, money: 2500, expiresAt: clock + 86400 * 20, items: [item(2770, 8, "Copper Ore")] },
        reputations: { seenAt: clock, factions: [{ id: 72, name: "Stormwind", standing: 6, min: 9000, max: 21000, value: 15000 }, { id: 47, name: "Ironforge", standing: 5, min: 3000, max: 9000, value: 4000 }, { id: 576, name: "Timbermaw Hold", standing: 2, min: -6000, max: -3000, value: -5000 }] },
        cooldowns: [{ key: "transmute", spellId: 17187, readyAt: clock + 5 * 3600 }],
        prices: [{ id: 2589, name: "Linen Cloth", q: 1, hist: [[90, clock - 600], [70, clock - 86400 * 3]] }, { id: 4306, name: "Silk Cloth", q: 1, hist: [[400, clock - 900]] }], pricesOn: true } },
      { id: "Synthetic-Vaelric", name: "Vaelric", faction: "Horde", race: "Orc", className: "Warrior", ledger: {
        schemaVersion: 1, money: 870000, moneyAt: clock,
        bags: { seenAt: clock, complete: true, items: [item(2589, 7, "Linen Cloth"), item(12359, 12, "Thorium Bar")] },
        reputations: { seenAt: clock, factions: [{ id: 76, name: "Orgrimmar", standing: 7, min: 21000, max: 42000, value: 30000 }, { id: 530, name: "Darkspear Trolls", standing: 4, min: 0, max: 3000, value: 1200 }] },
        cooldowns: [{ key: "mooncloth", spellId: 18560, readyAt: clock - 60 }], prices: [], pricesOn: true } },
    ].map((c) => ({ realm: "Synthetic Realm", level: 40, updatedAt: clock, clientBuild: "1.60.1.70862", captureVersion: require("../package.json").version, ...c }));
    await fs.writeFile(saved, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: clock, activeId: characters[0].id, characters })));
    app = await launchElectron(electron, { args: [await syntheticLaunch(data)], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.evaluate((root) => window.backstage.prepareGame(root), game);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#active-character option").length === 2);
    const capture = path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/ledger-smoke");
    await fs.mkdir(capture, { recursive: true });
    const shot = (name) => page.screenshot({ path: path.join(capture, `${name}.png`), fullPage: true });

    // Bags & bank: both characters, bank and mail with last seen, a bank never opened, search.
    await navigate(page, "ledger");
    await page.locator('[data-ledger-item="2589"]').waitFor();
    const linen = await page.locator('[data-ledger-item="2589"]').innerText();
    assert.match(linen, /×42/); assert.match(linen, /Aeralyn/); assert.match(linen, /bags 25 · bank 10/); assert.match(linen, /Vaelric/);
    assert.match(await page.locator("[data-ledger]").innerText(), /bank never opened/);
    assert.match(await page.locator('[data-ledger-item="2770"]').innerText(), /mail 8/);
    await shot("bags");
    await page.getByLabel("Search items", { exact: true }).fill("thorium");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-item]").length === 1);
    assert.match(await page.locator("[data-ledger-item]").innerText(), /Thorium Bar[\s\S]*Vaelric/);
    await page.getByLabel("Search items", { exact: true }).fill("cloth");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-item]").length === 2);

    // Gold & prices: gold per character and total, remembered prices, search.
    await navigate(page, "ledger-gold");
    await page.locator('[data-ledger-gold]').first().waitFor();
    const gold = await page.locator("[data-ledger]").innerText();
    assert.match(gold, /239g\s*30s\s*45c/, "total gold of both characters");
    assert.equal(await page.locator("[data-ledger-gold]").count(), 2);
    assert.equal(await page.locator("[data-ledger-price]").count(), 2);
    await page.getByLabel("Search prices", { exact: true }).fill("silk");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-price]").length === 1);
    assert.match(await page.locator("[data-ledger-price]").innerText(), /Silk Cloth[\s\S]*4s/);
    await shot("gold");

    // Reputation: Alliance character first, then the Horde one through the picker.
    await navigate(page, "ledger-reputation");
    await page.locator('[data-ledger-faction="72"]').waitFor();
    assert.match(await page.locator('[data-ledger-faction="72"]').innerText(), /Stormwind[\s\S]*Honored/);
    await shot("reputation-alliance");
    await page.getByLabel("Reputation of", { exact: true }).selectOption({ label: "Vaelric · Horde" });
    await page.locator('[data-ledger-faction="76"]').waitFor();
    assert.match(await page.locator('[data-ledger-faction="76"]').innerText(), /Orgrimmar[\s\S]*Revered/);
    assert.match(await page.locator("[data-ledger]").innerText(), /Horde/);
    await shot("reputation-horde");

    // Cooldowns: one waiting, one ready.
    await navigate(page, "ledger-cooldowns");
    await page.locator('[data-ledger-cd]').first().waitFor();
    assert.equal(await page.locator("[data-ledger-cd]").count(), 2);
    assert.match(await page.locator("[data-ledger]").innerText(), /Transmute[\s\S]*Ready in [45]h/);
    assert.match(await page.locator("[data-ledger]").innerText(), /Mooncloth[\s\S]*Ready/);
    await shot("cooldowns");
    console.log("Ledger smoke passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
