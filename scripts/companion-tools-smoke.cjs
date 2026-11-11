"use strict";
// Real main/preload/renderer with fake inference that exercises the local lookup tools.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, "forever-tools-"));
  let app;
  const capture = path.join(__dirname, "..", ".superpowers", "sdd", "companion-tools-captures");
  await fs.mkdir(capture, { recursive: true });
  const watchdog = setTimeout(() => { console.error("Companion tools fixture exceeded 120 seconds"); app?.process().kill(); process.exitCode = 1; }, 120000);
  try {
    const initial = { ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [{ id: "Alpha", name: "Alpha", className: "Warrior", realm: "Synthetic", level: 12, race: "Orc", faction: "Horde", goals: [], notes: "PRIVATE_NOTE_CANARY", location: { zone: "Orgrimmar", mapId: 1454, x: 0.5, y: 0.6 } }], provider: { id: "ollama", model: "fixture", endpoint: "http://127.0.0.1:11434" } };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "backstage-forever-tools-fixture", version: "0.13.6", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/providers.cjs').ask=async()=>{throw Error('Fixture inference is not installed');};
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      load('./src/main.cjs');
    `);
    app = await electron.launch({ args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(8000);
    await app.evaluate((_electron, repo) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(repo, "package.json"));
      globalThis.toolsFixture = { requests: [] };
      load("./src/core/providers.cjs").ask = async (input) => {
        const npc = JSON.parse(await input.tools.call("find_npc", { name: "Cairne" }));
        const quest = JSON.parse(await input.tools.call("get_quest", { quest_id: 93739 }));
        toolsFixture.requests.push({ definitions: input.tools.definitions.map((d) => d.name), npc, quest, prompt: input.prompt });
        const loc = npc.matches[0].locations[0];
        return `Cairne Bloodhoof is in ${loc.zone}, around ${loc.x}, ${loc.y} — not Orgrimmar. Quest ${quest.title} needs him.`;
      };
    }, repo);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "assistant");
    await page.getByRole("textbox", { name: "Your question", exact: true }).fill("Which step of Exploring the Horde should I do next?");
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    const reply = page.locator("#chatlog .message.assistant").last();
    await reply.getByText(/Thunder Bluff, around 59\.9, 51\.7/).waitFor();
    const r = await app.evaluate(() => toolsFixture.requests.at(-1));
    assert.deepEqual(r.definitions, ["find_npc", "search_quests", "get_quest", "find_item", "plan_travel", "get_character", "get_live_state", "quest_waypoint"]);
    assert.equal(r.npc.matches[0].locations[0].zone, "Thunder Bluff");
    assert.equal(r.quest.title, "Exploring the Horde");
    assert.match(await reply.locator(".eyebrow").innerText(), /AI with local reference lookups/i);
    const trail = await reply.locator("[data-lookup-trail]").innerText();
    assert.match(trail, /Looked up NPC Cairne — found/);
    assert.match(trail, /Read quest 93739/);
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE_NOTE_CANARY/);
    await page.screenshot({ path: path.join(capture, "companion-tools-answer.png"), fullPage: false });
    console.log("Companion tools smoke passed");
  } finally {
    clearTimeout(watchdog);
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
