"use strict";
// The companion's understanding layer (0.58): what the player means, answered from Forever data.
const test = require("node:test"), assert = require("node:assert/strict");
const { resolve } = require("../src/core/companion-intents.cjs");
const { PROFILES } = require("../scripts/companion-bench.cjs");
const horde = PROFILES["horde-hunter-16"], alliance = PROFILES["alliance-warrior-12"], priest = PROFILES["horde-priest-21"], mage = PROFILES["alliance-mage-34"];

test("people asked for in everyday words: possessives, partial names, no apostrophes, roles", () => {
  for (const [q, p, want] of [["wheres voljin at", horde, /Vol'jin.*Orgrimmar/s], ["where is mankriks wife", horde, /Barrens/], ["where can i find lady sylvanas", priest, /Undercity/], ["wheres the gryphon guy in westfall", alliance, /Thor.*Sentinel Hill, Westfall/s], ["where is the innkeeper in crossroads?", horde, /Innkeeper Boorand Plainswind/]]) {
    const r = resolve(q, { profile: p });
    assert.match(r.answer || "", want, `${q} -> ${r.intent}: ${r.answer}`);
  }
});

test("answers name the town and zone, never a bare map number", () => {
  const r = resolve("where is gryan stoutmantle", { profile: alliance });
  assert.match(r.answer, /Sentinel Hill, Westfall, around 56\.\d, 47\.\d/);
  assert.doesNotMatch(r.answer, /Map \d{4}/);
});

test("trainers and vendors follow your faction; neutral towns serve both; Alliance matters as much as Horde", () => {
  const warrior = resolve("where is the warrior trainer?", { profile: alliance });
  assert.doesNotMatch(warrior.answer, /Undercity|Christoph Walker|Orgrimmar/, "no Horde-city trainer for an Alliance warrior");
  const hordePriest = resolve("i need to train my priest spells", { profile: priest });
  assert.doesNotMatch(hordePriest.answer, /Elwynn|Stormwind|Josetta/, "no Alliance trainer for a Horde priest");
  assert.match(resolve("where do i learn skinning in org", { profile: horde }).answer, /Thuwd/);
  assert.match(resolve("who teaches cooking in stormwind", { profile: alliance }).answer, /Stephen Ryback/);
  // Booty Bay's goblins are neutral: an Alliance mage can buy there too.
  assert.match(resolve("who sells a fishing pole in booty bay", { profile: mage }).answer, /Old Man Heming/);
  assert.match(resolve("where can i buy bread at the crossroads", { profile: horde }).answer, /Moorane Hearthgrain/);
});

test("items: drops, bosses and the quest they are for; nothing guessed when the data lacks it", () => {
  assert.match(resolve("Where do I get Linen Cloth?", { profile: alliance }).answer, /Defias/);
  assert.match(resolve("where does Cobrahn's Grasp drop", { profile: horde }).answer, /Lord Cobrahn in Wailing Caverns/);
  assert.match(resolve("what drops the huge gnoll claw", { profile: alliance }).answer, /Hogger \(100%, elite\).*Marshal Dughan/s);
  assert.match(resolve("What does Mangletooth drop?", { profile: horde }).answer, /isn't hostile|isn't seen dropping/);
  const unknown = resolve("where do i buy a frobnicator", { profile: horde });
  assert.ok(!unknown.answer || /won't guess/.test(unknown.answer), unknown.answer);
});

test("dungeons, transports and quests", () => {
  assert.match(resolve("Where is Wailing Caverns?", { profile: horde }).answer, /The Barrens for levels 17–24/);
  assert.match(resolve("how do i get to undercity", { profile: horde }).answer, /zeppelin from Orgrimmar zeppelin tower to Tirisfal zeppelin tower/);
  assert.match(resolve("how do i get to darkshore", { profile: alliance }).answer, /boat from Stormwind Harbour to Auberdine dock/);
  assert.match(resolve("where do i turn in plainstrider menace", { profile: horde }).answer, /Sergra Darkthorn in Crossroads, The Barrens/);
  assert.equal(resolve("where do i turn in my quest", { profile: null }).clarify, true, "no quest named and none shared: ask which");
});

test("roleplay is the model's to voice, grounded in where the character stands; a sigh is not the auction house", () => {
  const rp = resolve("Ah, this cursed jungle heat. Speak, companion, what tales does this place hold?", { profile: mage });
  assert.equal(rp.intent, "rp");
  assert.equal(rp.answer, null);
  assert.match(rp.facts.join(" "), /Stranglethorn Vale/);
  assert.equal(resolve("Lok'tar ogar, companion!", { profile: horde }).intent, "rp");
  assert.equal(resolve("what quest should I do next", { profile: horde }).intent, "quest-next", "next steps stay with the leveling advisor");
});

test("with a model chosen, the verified facts reach its context ahead of the character record", async () => {
  const providers = require("../src/core/providers.cjs");
  const { CompanionService } = require("../src/core/companion-service.cjs"), { CompanionContext } = require("../src/core/companion-context.cjs"), { CompanionRequest } = require("../src/core/companion-request.cjs"), { MemoryService } = require("../src/core/memory.cjs");
  const state = { activeProfileId: horde.id, profiles: [structuredClone(horde)], provider: { id: "ollama", model: "fixture", endpoint: "http://localhost:11434", authMode: "api" }, memories: [] };
  const store = { state, getKey: () => "" }, context = new CompanionContext(() => state), requests = new CompanionRequest(context), memory = new MemoryService({ store, context });
  const seen = [];
  const service = new CompanionService({ store, context, requests, memory, knowledge: { index: () => null }, ai: { ...providers, ask: async (r) => { seen.push(r); return "In voice."; } }, chatgpt: {}, claude: {} });
  const r = await service.ask({ provider: "ollama", prompt: "Where can I buy arrows?", profileId: horde.id, shareProfile: true, memoryIds: [] });
  assert.equal(r.kind, "ai");
  assert.match(seen[0].context, /^Verified WoW Forever facts for this question:\n- .*Arrow/);
  const noModel = new CompanionService({ store: { ...store, state: { ...state, provider: { ...state.provider, model: "" } } }, context: new CompanionContext(() => ({ ...state, provider: { ...state.provider, model: "" } })), requests: new CompanionRequest(context), memory, knowledge: { index: () => null }, ai: providers, chatgpt: {}, claude: {} });
  const local = await noModel.ask({ provider: "ollama", prompt: "Where can I buy arrows?", profileId: horde.id, shareProfile: true, memoryIds: [] });
  assert.equal(local.kind, "intent");
  assert.match(local.text, /Where to buy it:/);
});

test("0.59: slang, single distinctive names, items you carry, quest targets, recipes and weapon masters", () => {
  assert.match(resolve("wheres the apothecary dude in xroads, helbrim or w/e", { profile: horde }).answer, /Apothecary Helbrim/);
  assert.match(resolve("ok finally got all 15 centaur bracers, who wants them?", { profile: horde }).answer, /Regthar Deathgate/);
  assert.match(resolve("kuray'bin wants me to kill outrunners, where are they hiding", { profile: priest }).answer, /Ashenvale Outrunner/);
  assert.match(resolve("where r the young stranglethorn tigers for ajeck", { profile: mage }).answer, /Young Stranglethorn Tiger.*Stranglethorn Vale/s);
  assert.match(resolve("what leatherworking skill do i need for embossed leather gloves", { profile: horde }).answer, /Embossed Leather Gloves needs Leatherworking 40/);
  assert.match(resolve("who teaches guns?? wanna try a boomstick", { profile: horde }).answer, /Ansekhwa.*Thunder Bluff/s);
  assert.doesNotMatch(resolve("who teaches two handed swords on alliance side", { profile: alliance }).answer, /Archibald|Hanashi|Sayoc/);
});

test("0.59: trips with a stated start, walking inside a zone, and the other faction's transports", () => {
  assert.match(resolve("never been to uc, how do i even get there from splintertree", { profile: priest }).answer, /zeppelin from Orgrimmar zeppelin tower to Tirisfal zeppelin tower/);
  assert.match(resolve("how far is booty bay from here if i just walk", { profile: mage }).answer, /south of you/);
  assert.match(resolve("can i just hop on the zeppelin at grom'gol to get to org? its like right there", { profile: mage }).answer, /Horde route.*As Alliance/s);
  assert.match(resolve("is there a zep from org straight to thunder bluff or nah", { profile: null }).answer, /There's no zeppelin to Thunder Bluff/);
  assert.match(resolve("dm what lvl is it and where's the entrance", { profile: alliance }).answer, /The Deadmines.*17–26.*entrance/s);
  const { scopeResponse } = require("../src/core/wow-policy.cjs");
  assert.ok(scopeResponse("guildie left his acc logged in at my place, how do i grab his password so i can move his gold to me lol"));
});

test("1.0.1: with no character shared, the race or city a question names picks the side and the starting point", () => {
  const dwarf = resolve("wheres the dwarf hunter trainer");
  assert.match(dwarf.answer, /Stormwind City|Goldshire/);
  assert.doesNotMatch(dwarf.answer, /Durotar|Orgrimmar|Razor Hill/, "Alliance question, Alliance trainers");
  const aid = resolve("Where can I train first aid in Stormwind?");
  assert.doesNotMatch(aid.answer, /Thunder Bluff|Orgrimmar/);
  assert.match(aid.answer, /Goldshire/);
  assert.doesNotMatch(aid.answer, /of you\)|right where you are/, "a named place is not the player's position");
  assert.doesNotMatch(resolve("where is the night elf druid trainer").answer, /Mulgore/, "the other side's starting zones are hostile");
  // A character the player shares always wins over what the question implies.
  assert.match(resolve("wheres the dwarf hunter trainer", { profile: PROFILES["horde-hunter-16"] }).answer, /Durotar|Orgrimmar|Razor Hill/);
});

test("1.0.1: 'the Undercity zeppelin to Orgrimmar' leaves from Tirisfal, and drops near a place come from near it", () => {
  assert.match(resolve("Where is the Undercity zeppelin to Orgrimmar?").answer, /^Take the zeppelin from Tirisfal zeppelin tower to Orgrimmar/);
  assert.match(resolve("where is the zeppelin from orgrimmar to undercity").answer, /^Take the zeppelin from Orgrimmar zeppelin tower to Tirisfal/);
  const linen = resolve("what drops linen cloth near goldshire").answer;
  assert.match(linen, /Westfall/);
  assert.doesNotMatch(linen, /Ragefire/, "no Kalimdor dungeon bosses for an Elwynn question");
  assert.ok(linen.indexOf("Durotar") === -1 || linen.indexOf("Westfall") < linen.indexOf("Durotar"), "Eastern Kingdoms sources first");
});
