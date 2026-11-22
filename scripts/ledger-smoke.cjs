"use strict";
// Ledger (0.35): a synthetic roster across factions and builds, read through the
// real game sync, main IPC, preload and renderer. Each Ledger page shows its data; search narrows.
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const tempRoot = await fs.realpath(process.env.TMPDIR || os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-ledger-"));
  const compact = process.argv.includes("--compact"), size = compact ? "compact" : "standard";
  const bounds = compact ? [1000, 700] : [1440, 900];
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
    const reference = require("../data/forever/pack.json");
    const stormwindQuest = Object.values(reference.quests).find(q => q.id > 100 && q.observedInPlay &&
      q.rewards?.reputation?.some(r => r.factionId === 72 && (r.amount ?? r.tier) > 0));
    assert.ok(stormwindQuest);
    const characters = [
      { id: "Synthetic-Aeralyn", name: "Aeralyn", faction: "Alliance", race: "Human", className: "Mage",
        quests: [{ id: stormwindQuest.id, title: stormwindQuest.title, complete: true, objectives: [] },
          { id: 11, title: "Riverpaw Gnoll Bounty", complete: false, objectives: [] }], ledger: {
        schemaVersion: 1, money: 1523045, moneyAt: clock,
        bags: { seenAt: clock, complete: true, items: [item(2589, 25, "Linen Cloth"), item(118, 3, "Minor Healing Potion"), item(782, 3, "Painted Gnoll Armband"),
          ...Array.from({ length: 24 }, (_, i) => item(90000 + i, i + 1, `Supply sample ${i + 1}`))] },
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
      { id: "Synthetic-Outlander", name: "Outlander", faction: "Horde", race: "Orc", className: "Warrior", clientBuild: "1.60.2.99999", level: 1, ledger: {
        schemaVersion: 1, reputations: { seenAt: clock, factions: [{ id: 72, name: "Stormwind", standing: 4, min: 0, max: 3000, value: 0 }] } } },
    ].map((c) => ({ realm: "Synthetic Realm", level: 40, updatedAt: clock, clientBuild: reference.build, captureVersion: require("../package.json").version, ...c }));
    await fs.writeFile(saved, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: clock, activeId: characters[0].id, characters })));
    app = await launchElectron(electron, { args: [await syntheticLaunch(data)], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), bounds);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.evaluate((root) => window.backstage.prepareGame(root), game);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#active-character option").length === 3);
    await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, bounds);
    const capture = path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/ledger-smoke");
    await fs.mkdir(capture, { recursive: true });
    const shot = async (name) => {
      const geometry = await page.locator("[data-ledger]").evaluate((root) => {
        for (const el of [document.scrollingElement, root.closest(".main"), root.parentElement]) el.scrollTop = 0;
        const tabs = [...root.parentElement.querySelectorAll(".player-subtabs button")];
        return { banner: root.querySelector(".page-hero").offsetHeight,
          tabs: tabs.map((b) => ({ top: b.getBoundingClientRect().top, font: parseFloat(getComputedStyle(b).fontSize) })),
          overflow: root.scrollWidth - root.clientWidth, tableTop: root.querySelector("table").getBoundingClientRect().top };
      });
      assert.ok(geometry.banner <= 120, `${size} ${name}: compact banner`);
      assert.equal(geometry.tabs.length, 4);
      const tops = geometry.tabs.map(({ top }) => top);
      assert.ok(Math.max(...tops) - Math.min(...tops) < 3, `subtabs stay together: ${tops}`);
      assert.ok(geometry.tabs.every(({ font }) => font >= 14), "subtabs stay readable");
      assert.ok(geometry.overflow <= 1 && geometry.tableTop < bounds[1] - 120, `${size} ${name}: table fits without lateral spill and starts above the fold`);
      await page.screenshot({ path: path.join(capture, `${size}-${name}.png`) });
    };

    // Bags & bank: both characters, bank and mail with last seen, a bank never opened, search.
    await navigate(page, "ledger");
    await page.locator('[data-ledger-item="2589"]').waitFor();
    assert.equal(await page.getByRole("table", { name: "Inventory", exact: true }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: "Quantity" }).count(), 1);
    assert.equal(await page.getByRole("rowheader", { name: "Linen Cloth" }).count(), 1);
    const linen = await page.locator('[data-ledger-item="2589"]').innerText();
    assert.match(linen, /\b42\b/); assert.match(linen, /Aeralyn/); assert.match(linen, /bags 25 · bank 10/); assert.match(linen, /Vaelric/);
    const lastSeen = page.locator(".ldg-source");
    await lastSeen.locator("summary").click();
    assert.match(await lastSeen.innerText(), /bank never opened/);
    await lastSeen.locator("summary").click();
    assert.match(await page.locator('[data-ledger-item="2770"]').innerText(), /mail 8/);
    await shot("bags");
    const itemSearch = page.getByLabel("Search items", { exact: true });
    const inventoryScroll = page.getByRole("region", { name: "Inventory", exact: true });
    await itemSearch.focus();
    await page.keyboard.press("Tab");
    assert.ok(await inventoryScroll.evaluate((n) => n === document.activeElement));
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.activeElement.scrollTop > 30);
    const stickyOffset = await inventoryScroll.evaluate((n) => n.querySelector("thead th").getBoundingClientRect().top - n.getBoundingClientRect().top);
    assert.ok(Math.abs(stickyOffset) <= 2, `${size}: inventory header stays in view during keyboard scroll`);
    await itemSearch.fill("thorium");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-item]").length === 1);
    assert.match(await page.locator("[data-ledger-item]").innerText(), /Thorium Bar[\s\S]*Vaelric/);
    assert.equal(await inventoryScroll.count(), 0, "short search results don't add a scroll stop");
    await itemSearch.fill("no such item");
    await page.getByText("Nothing your characters carry matches that.").waitFor();
    assert.equal(await page.getByRole("table", { name: "Inventory", exact: true }).count(), 0);
    await itemSearch.fill("cloth");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-item]").length === 2);

    // Gold & prices: gold per character and total, remembered prices, search.
    await navigate(page, "ledger-gold");
    await page.locator('[data-ledger-gold]').first().waitFor();
    assert.equal(await page.getByRole("table", { name: "Price memory", exact: true }).count(), 1);
    assert.equal(await page.getByRole("table", { name: "Gold per character", exact: true }).count(), 1);
    assert.ok(await page.locator("[data-ledger-list=prices]").evaluate((n) => n.compareDocumentPosition(document.querySelector("[data-ledger-goal-card]")) & Node.DOCUMENT_POSITION_FOLLOWING));
    const gold = await page.locator("[data-ledger]").innerText();
    assert.match(gold, /239g\s*30s\s*45c/, "total gold of both characters");
    assert.equal(await page.locator("[data-ledger-gold]").count(), 2);
    assert.equal(await page.locator("[data-ledger-price]").count(), 2);
    assert.equal(await page.getByRole("progressbar").count(), 0, "no goal means no progress chart");
    assert.equal(await page.getByRole("region", { name: "Price memory", exact: true }).count(), 0);
    const priceAlignment = await page.getByRole("columnheader", { name: "Last seen, each" }).evaluate((th) => [th, th.closest("table").tBodies[0].rows[0].cells[1]].map((cell) => getComputedStyle(cell).textAlign));
    assert.deepEqual(priceAlignment, ["right", "right"]);
    await shot("gold");
    await page.getByLabel("Search prices", { exact: true }).fill("silk");
    await page.waitForFunction(() => document.querySelectorAll("[data-ledger-price]").length === 1);
    assert.match(await page.locator("[data-ledger-price]").innerText(), /Silk Cloth[\s\S]*4s/);

    // Reputation: Alliance character first, then the Horde one through the picker.
    await navigate(page, "ledger-reputation");
    await page.locator('[data-ledger-faction="72"]').waitFor();
    assert.equal(await page.getByRole("table", { name: "Faction standings" }).count(), 1);
    assert.match(await page.locator('[data-ledger-faction="72"]').innerText(), /Stormwind[\s\S]*Honored/);
    await shot("reputation-alliance");
    await page.getByLabel("Reputation of", { exact: true }).selectOption({ label: "Vaelric · Horde" });
    await page.locator('[data-ledger-faction="76"]').waitFor();
    assert.match(await page.locator('[data-ledger-faction="76"]').innerText(), /Orgrimmar[\s\S]*Revered/);
    assert.match(await page.locator("[data-ledger]").innerText(), /Horde/);
    await shot("reputation-horde");
    assert.equal(await page.getByRole("button", { name: "Pin reputation target" }).count(), 0);
    const plan = page.locator("[data-ledger-rep-plan]");
    assert.equal(await plan.locator("[data-quest-open]").count(), 0, "alt links must not open as the active character");
    assert.match(await plan.innerText(), /Switch the active character to Vaelric to open quests/);
    const activeCharacter = page.getByLabel("Active character", { exact: true });
    await activeCharacter.selectOption({ label: "Vaelric · Level 40" });
    await plan.locator("[data-quest-open]").first().waitFor();
    await activeCharacter.selectOption({ label: "Aeralyn · Level 40" });
    await plan.getByText(/Switch the active character to Vaelric to open quests/).waitFor();
    await page.getByLabel("Reputation of", { exact: true }).selectOption({ label: "Outlander · Horde" });
    assert.match(await plan.innerText(), /Browse only.*1\.60\.2\.99999/s);
    assert.match(await plan.innerText(), /Minimum level/);
    assert.doesNotMatch(await plan.innerText(), /Saved log:|Reference lead: check availability/);
    assert.equal(await plan.locator("[data-quest-open]").count(), 0);
    assert.equal(await plan.locator("[data-ledger-turn-in]").count(), 0);
    await page.getByLabel("Reputation of", { exact: true }).selectOption({ label: "Aeralyn · Alliance" });
    await page.getByLabel("Plan for faction").selectOption("72");
    const pin = page.getByRole("button", { name: "Pin reputation target" });
    await pin.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Stormwind · Revered", { exact: true }).waitFor();
    const resume = page.getByRole("button", { name: "Resume reputation" });
    await resume.focus();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { name: "Stormwind reputation plan" });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches("[data-ledger-rep-heading]"));
    const questAction = plan.locator(`[data-quest-open="${stormwindQuest.id}"]`);
    await questAction.waitFor();
    assert.equal(await plan.locator("[data-quest-open]").first().getAttribute("data-quest-open"), String(stormwindQuest.id));
    assert.ok(await questAction.evaluate(n => { const b = n.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }));
    assert.match(await plan.innerText(), /Saved log: ready to turn in/);
    assert.match(await plan.innerText(), /server reward amount.*unknown/i);
    const materials = plan.locator('[data-ledger-turn-in="11"]');
    await materials.waitFor({ timeout: 2500 });
    assert.match(await materials.innerText(), /Aeralyn[\s\S]*Painted Gnoll Armband[\s\S]*8 required.*3 carried.*5 short/i);
    assert.match(await plan.innerText(), /resume or clear.*Now/i);
    assert.ok(await plan.evaluate(n => n.scrollWidth - n.clientWidth <= 1));
    await page.screenshot({ path: path.join(capture, `${size}-reputation-plan.png`) });
    await questAction.click();
    await page.locator(`[data-quest-control="detail:${stormwindQuest.id}"]`).waitFor();
    assert.match(await page.locator(".reward-chip.rep").first().innerText(), /server amount unknown/);
    await navigate(page, "now");
    await page.locator("[data-now-objective]").getByRole("button", { name: "Clear objective" }).press("Enter");
    await page.locator("[data-now-objective]").getByText(/No objective pinned/).waitFor();

    // Cooldowns: one waiting, one ready.
    await navigate(page, "ledger-cooldowns");
    await page.locator('[data-ledger-cd]').first().waitFor();
    assert.equal(await page.locator("[data-ledger-cd]").count(), 2);
    assert.match(await page.locator("[data-ledger-cd]").first().innerText(), /Mooncloth/);
    const grouping = page.getByLabel("Group cooldowns by");
    await grouping.focus(); // selectOption dispatches change without focusing the control.
    await grouping.selectOption("character");
    await page.getByRole("rowheader", { name: "Aeralyn", exact: true }).waitFor();
    assert.match(await page.locator("[data-ledger-cd]").first().innerText(), /Transmute/);
    assert.ok(await grouping.evaluate((n) => n === document.activeElement));
    await grouping.selectOption("readiness");
    await page.getByRole("rowheader", { name: "Waiting", exact: true }).waitFor();
    assert.match(await page.locator("[data-ledger]").innerText(), /Transmute[\s\S]*Ready in [45]h/);
    assert.doesNotMatch(await page.locator("[data-ledger-cd]").last().innerText(), /\b60m\b/);
    assert.match(await page.locator("[data-ledger]").innerText(), /Mooncloth[\s\S]*Ready/);
    await shot("cooldowns");
    console.log(`Ledger smoke passed (${size}: ${bounds.join("×")} content)`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
