"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createCompanionTools, MAX_CALLS } = require("../src/core/companion-tools.cjs");
const { anthropicLoop, responsesLoop, chatLoop, MAX_ROUNDS } = require("../src/core/tool-loop.cjs");
const providers = require("../src/core/providers.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { createClaude } = require("../src/core/claude.cjs");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const index = new KnowledgeIndex(read("data/forever/pack.json"));
const npcReference = read("data/forever-npc-locations/pack.json");
const travelReference = loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json")));
const profile = { id: "A", name: "PRIVATE_NAME_CANARY", className: "Warrior", level: 12, faction: "Horde", race: "Orc", notes: "PRIVATE_NOTE_CANARY", location: { zone: "Orgrimmar", mapId: 1454, x: 0.5, y: 0.6 } };
const kit = (extra = {}) => createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index, npcReference, travelReference, ...extra });

test("find_npc resolves Cairne Bloodhoof to Thunder Bluff, not the asked-about city", async () => {
  const r = JSON.parse(await kit().call("find_npc", { name: "cairne" }));
  assert.equal(r.status, "found");
  const [m] = r.matches;
  assert.equal(m.name, "Cairne Bloodhoof");
  assert.equal(m.locations[0].zone, "Thunder Bluff");
  assert.equal(m.locations[0].mapId, 1456);
  assert.match(m.source, /Efficient Games, CC BY 4\.0/);
  assert.ok(m.locations[0].lastSeen);
});

test("find_npc on the player's own map adds direction and distance", async () => {
  const r = JSON.parse(await kit().call("find_npc", { name: "Thrall" }));
  const loc = r.matches[0].locations[0];
  assert.equal(loc.zone, "Orgrimmar");
  assert.equal(loc.sameMapAsPlayer, true);
  assert.equal(loc.direction, "northwest");
});

test("unknown NPCs are reported as not found rather than guessed", async () => {
  const r = JSON.parse(await kit().call("find_npc", { name: "Zzyzx Nonexistent" }));
  assert.equal(r.status, "not-found");
  assert.match(r.message, /do not guess/);
});

test("get_quest resolves talk-to objectives to NPC locations", async () => {
  const r = JSON.parse(await kit().call("get_quest", { quest_id: 93739 }));
  assert.equal(r.title, "Exploring the Horde");
  const cairne = r.objectives.find((o) => o.objectId === 3057);
  assert.equal(cairne.npc.locations[0].zone, "Thunder Bluff");
  assert.match(r.source, /Build 1\.60\.1/);
});

test("get_quest includes compact reward reputation, XP, quality and links", async () => {
  const r = JSON.parse(await kit().call("get_quest", { quest_id: 792 }));
  assert.deepEqual(r.rewards.choices[0], { id: 4924, name: "Primitive Club", count: 1, quality: 1 });
  assert.deepEqual(r.rewards.reputation[0], { faction: "Orgrimmar", tier: 6 });
  assert.equal(r.rewards.xp.atOrBelowQuestLevel, 450);
  assert.deepEqual(r.links.next, [{ id: 794, title: "Burning Blade Medallion" }]);
});

test("search_quests and plan_travel use bundled references", async () => {
  const t = kit();
  const q = JSON.parse(await t.call("search_quests", { query: "Exploring the Horde" }));
  assert.equal(q.quests[0].id, 93739);
  const trip = JSON.parse(await t.call("plan_travel", { from: "Orgrimmar", to: "Thunder Bluff" }));
  assert.equal(trip.status, "route");
  assert.match(trip.summary, /Thunder Bluff/);
  assert.deepEqual(t.trace.map((x) => x.name), ["search_quests", "plan_travel"]);
});

test("character context is withheld when sharing is off and never includes private notes", async () => {
  const off = createCompanionTools({ profile, shareProfile: false, knowledgeIndex: index, npcReference });
  const r = JSON.parse(await off.call("get_character", {}));
  assert.equal(r.status, "not-shared");
  const n = await off.call("find_npc", { name: "Thrall" });
  assert.doesNotMatch(n, /PRIVATE|sameMapAsPlayer/);
  const on = await kit().call("get_character", {});
  assert.doesNotMatch(on, /PRIVATE_NOTE_CANARY/);
  assert.match(on, /Orgrimmar/);
});

test("malformed arguments, unknown tools and the per-question call limit are bounded", async () => {
  const t = kit();
  assert.equal(JSON.parse(await t.call("find_npc", "{not json")).status, "invalid");
  assert.equal(JSON.parse(await t.call("rm_rf", {})).status, "invalid");
  assert.equal(JSON.parse(await t.call("find_npc", { name: "x".repeat(500) })).status, "invalid");
  for (let i = t.trace.length; i < MAX_CALLS; i++) await t.call("find_npc", { name: "Thrall" });
  assert.equal(JSON.parse(await t.call("find_npc", { name: "Thrall" })).status, "limit");
});

test("anthropic loop runs tool_use rounds and forbids tools on the last round", async () => {
  const t = kit(), bodies = [];
  const post = async (body) => {
    bodies.push(structuredClone(body));
    if (bodies.length === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "find_npc", input: { name: "Cairne" } }] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Cairne is in Thunder Bluff." }] };
  };
  const out = await anthropicLoop({ post, model: "m", system: "S", input: "where is cairne", tools: t });
  assert.equal(out, "Cairne is in Thunder Bluff.");
  assert.equal(bodies[0].tools.length, t.definitions.length);
  const result = bodies[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "tu1");
  assert.match(result.content, /Thunder Bluff/);

  const looping = [];
  const always = async (body) => { looping.push(body); return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x" + looping.length, name: "find_npc", input: { name: "Thrall" } }, { type: "text", text: "partial" }] }; };
  assert.equal(await anthropicLoop({ post: always, model: "m", system: "S", input: "q", tools: kit() }), "partial");
  assert.equal(looping.length, MAX_ROUNDS);
  assert.deepEqual(looping.at(-1).tool_choice, { type: "none" });
});

test("responses loop replays function calls statelessly without server item ids", async () => {
  const t = kit(), bodies = [];
  const post = async (body) => {
    bodies.push(structuredClone(body));
    if (bodies.length === 1) return { output: [{ type: "reasoning", id: "rs_1" }, { type: "function_call", id: "fc_1", call_id: "c1", name: "find_npc", arguments: '{"name":"Cairne"}' }] };
    return { output: [{ type: "message", content: [{ type: "output_text", text: "Thunder Bluff, around 59.9, 51.7." }] }] };
  };
  assert.match(await responsesLoop({ post, model: "m", instructions: "S", input: "q", tools: t }), /Thunder Bluff/);
  const items = bodies[1].input;
  assert.equal(items[1].type, "function_call");
  assert.equal(items[1].id, undefined);
  assert.ok(!items.some((x) => x.type === "reasoning"));
  assert.equal(items[2].type, "function_call_output");
  assert.equal(items[2].call_id, "c1");
  assert.equal(bodies[0].store, false);
});

test("chat loop handles xAI string arguments and Ollama object arguments", async () => {
  for (const ollama of [false, true]) {
    const bodies = [];
    const call = ollama ? { function: { name: "find_npc", arguments: { name: "Cairne" } } } : { id: "call9", type: "function", function: { name: "find_npc", arguments: '{"name":"Cairne"}' } };
    const post = async (body) => {
      bodies.push(structuredClone(body));
      const message = bodies.length === 1 ? { role: "assistant", content: "", tool_calls: [call] } : { role: "assistant", content: "Thunder Bluff." };
      return ollama ? { message } : { choices: [{ message }] };
    };
    assert.equal(await chatLoop({ post, model: "m", system: "S", input: "q", tools: kit(), ollama }), "Thunder Bluff.");
    const reply = bodies[1].messages.at(-1);
    assert.equal(reply.role, "tool");
    assert.match(reply.content, /Thunder Bluff/);
    if (ollama) assert.equal(reply.tool_name, "find_npc"); else assert.equal(reply.tool_call_id, "call9");
  }
});

function fakeFetch(responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = responses.shift();
    if (r.status && r.status !== 200) return { ok: false, status: r.status };
    const bytes = Buffer.from(JSON.stringify(r));
    return { ok: true, status: 200, body: (async function* () { yield bytes; })() };
  };
  return { calls, fetcher };
}

test("providers.ask sends tool definitions plus the lookup instruction and returns the final text", async () => {
  const { calls, fetcher } = fakeFetch([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "find_npc", input: { name: "Cairne" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Head to Thunder Bluff." }] },
  ]);
  const t = kit();
  const out = await providers.ask({ provider: "anthropic", model: "claude-x", apiKey: "k", prompt: "where in org is cairne", tools: t }, fetcher);
  assert.equal(out, "Head to Thunder Bluff.");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.tools.some((x) => x.name === "find_npc"));
  assert.match(calls[0].body.system, /Local lookup tools are available/);
  assert.equal(t.trace[0].summary, "Looked up NPC Cairne — found");
});

test("providers.ask without tools keeps the original single request body", async () => {
  const { calls, fetcher } = fakeFetch([{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  await providers.ask({ provider: "anthropic", model: "claude-x", apiKey: "k", prompt: "hi" }, fetcher);
  assert.equal(calls[0].body.tools, undefined);
  assert.doesNotMatch(calls[0].body.system, /Local lookup tools/);
});

test("a model that rejects tool definitions is retried once as a plain question", async () => {
  const { calls, fetcher } = fakeFetch([{ status: 400 }, { message: { role: "assistant", content: "plain answer" } }]);
  const t = kit();
  const out = await providers.ask({ provider: "ollama", model: "tiny", endpoint: "http://localhost:11434", prompt: "hi", tools: t }, fetcher);
  assert.equal(out, "plain answer");
  assert.ok(calls[0].body.tools);
  assert.equal(calls[1].body.tools, undefined);
  assert.equal(t.unsupported, true);
  const auth = fakeFetch([{ status: 401 }]);
  await assert.rejects(providers.ask({ provider: "ollama", model: "tiny", endpoint: "http://localhost:11434", prompt: "hi", tools: kit() }, auth.fetcher), /authentication failed/);
  assert.equal(auth.calls.length, 1);
});

test("Claude subscription lookups expose only the read-only in-process server", async () => {
  let seen;
  const sdkMcp = {
    tool: (name, description, shape, handler, extras) => ({ name, description, shape, handler, extras }),
    createSdkMcpServer: (o) => ({ type: "sdk", name: o.name, tools: o.tools }),
  };
  const sdkQuery = ({ prompt, options }) => {
    seen = { prompt, options };
    return (async function* () {
      const tool = options.mcpServers.backstage.tools.find((x) => x.name === "find_npc");
      const r = await tool.handler({ name: "Cairne" });
      yield { type: "assistant" };
      yield { type: "result", subtype: "success", result: "Lookup said: " + JSON.parse(r.content[0].text).matches[0].locations[0].zone };
    })();
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-claude-tools-"));
  const api = createClaude({ dataDir, findExecutable: async () => "C:/trusted/claude.exe", env: { PATH: "safe", ANTHROPIC_API_KEY: "SECRET" }, runner: async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }) }), sdkQuery, sdkMcp });
  assert.equal((await api.status()).connected, true);
  const out = await api.ask({ model: "claude-sonnet-5-5", prompt: "where is cairne", tools: kit() });
  assert.equal(out, "Lookup said: Thunder Bluff");
  assert.deepEqual(seen.options.tools, []);
  assert.deepEqual(Object.keys(seen.options.mcpServers), ["backstage"]);
  assert.ok(seen.options.allowedTools.every((n) => n.startsWith("mcp__backstage__")));
  assert.equal(seen.options.strictMcpConfig, true);
  assert.equal(seen.options.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(seen.options.mcpServers.backstage.tools.every((x) => x.extras.annotations.readOnlyHint));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("companion service hands tools to the provider and returns the lookup trail", async () => {
  const { CompanionContext } = require("../src/core/companion-context.cjs");
  const { CompanionRequest } = require("../src/core/companion-request.cjs");
  const { MemoryService } = require("../src/core/memory.cjs");
  const { CompanionService } = require("../src/core/companion-service.cjs");
  const state = { activeProfileId: "A", profiles: [{ ...profile, source: { kind: "wow-addon", id: "o" } }], provider: { id: "anthropic", model: "m", authMode: "api" }, memories: [] };
  const store = { state, getKey: () => "k" }, context = new CompanionContext(() => state);
  let seen;
  const ai = { ...providers, ask: async (i) => { seen = i; await i.tools.call("find_npc", { name: "Cairne" }); return "Thunder Bluff."; } };
  const service = new CompanionService({ store, context, requests: new CompanionRequest(context), memory: new MemoryService({ store, context }), ai, chatgpt: {}, claude: {}, knowledge: { index: () => index }, npcReference, travelReference });
  const r = await service.ask({ provider: "anthropic", prompt: "Which quest should I do next?", profileId: "A", shareProfile: true, memoryIds: [] });
  assert.equal(r.kind, "ai");
  assert.deepEqual(r.lookups, ["Looked up NPC Cairne — found"]);
  assert.ok(seen.tools.definitions.length >= 7);
  const off = new CompanionService({ store, context, requests: new CompanionRequest(context), memory: new MemoryService({ store, context }), ai: { ...providers, ask: async (i) => { assert.equal(i.tools, undefined); return "ok"; } }, chatgpt: {}, claude: {}, knowledge: { index: () => index }, lookups: false });
  assert.equal((await off.ask({ provider: "anthropic", prompt: "Which quest should I do next?", profileId: "A", shareProfile: true, memoryIds: [] })).lookups, undefined);
});

test("review fixes: reward reverse lookup, per-point provenance and reported-location origin", async () => {
  const reported = createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index, npcReference, travelReference, contextOptions: { reportedLocation: { zone: "Thunder Bluff", source: "user-report" } } });
  const item = JSON.parse(await reported.call("find_item", { id: 287059 }));
  assert.deepEqual(item.items[0].questRewards[0], { questId: 11, title: "Riverpaw Gnoll Bounty", kind: "reward-choice", level: 10 });
  const thrall = JSON.parse(await reported.call("find_npc", { name: "Thrall" }));
  assert.equal(thrall.matches[0].locations[0].sameMapAsPlayer, undefined, "zone-only report must not use stale saved coordinates");
  const trip = JSON.parse(await reported.call("plan_travel", { to: "Undercity" }));
  assert.equal(trip.origin.label, "Thunder Bluff");
  // The historical pack records the newest build that saw each NPC; give Faranell a distinct older point.
  const older = structuredClone(npcReference);
  Object.assign(older.npcs.find((n) => n.id === 2055), { build: "1.60.1.70790", positions: [{ mapId: 1458, x: 0.1, y: 0.1 }] });
  const faranell = JSON.parse(await kit({ npcReference: older }).call("find_npc", { name: "Faranell" }));
  const tiers = faranell.matches[0].locations.map((l) => `${l.evidence}@${l.build}`);
  assert.ok(tiers.includes("historical-reference@1.60.1.70790") && tiers.some((t) => t.startsWith("reference-observation@1.60.1.70888")));
});
