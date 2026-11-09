const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  validateQuestData,
  validateHistory,
} = require("../src/core/quest-data.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const index = new KnowledgeIndex(require("../data/forever/pack.json"));
const p = {
  id: "p",
  name: "Example",
  realm: "Realm",
  className: "Mage",
  level: 20,
  notes: "PRIVATE_NOTE",
  goals: [],
  clientBuild: index.pack.build,
  locale: "enUS",
  captureVersion: "0.6.0",
  faction: "Horde",
  source: {
    kind: "wow-addon",
    id: "PRIVATE_GUID",
    updatedAt: "2026-11-09T00:00:00.000Z",
  },
  quests: [
    {
      id: 1061,
      title: "The Spirits of Stonetalon",
      complete: true,
      objectives: [],
    },
  ],
  history: { recent: [], completedIdsKnown: true, completedIds: [5729] },
  readiness: { equipment: [] },
};
test("optional capture fields validate, round-trip and clear with newer unavailable observations", () => {
  const native = {
    schema: 1,
    characters: [
      {
        id: "Synthetic",
        name: p.name,
        realm: p.realm,
        className: p.className,
        level: p.level,
        clientBuild: p.clientBuild,
        locale: p.locale,
        captureVersion: p.captureVersion,
        history: p.history,
        quests: p.quests,
        updatedAt: p.source.updatedAt,
      },
    ],
    activeId: "Synthetic",
    observedAt: p.source.updatedAt,
  };
  const parsed = require("../src/core/game-sync.cjs").parseSavedVariables(
    "BackstageForeverExport = [==[" + JSON.stringify(native) + "]==]",
  );
  assert.equal(parsed.characters[0].clientBuild, p.clientBuild);
  assert.deepEqual(parsed.characters[0].history.completedIds, [5729]);
  const state = validateState({
    ...defaultState(),
    profiles: [p],
    activeProfileId: "p",
  });
  assert.equal(state.profiles[0].clientBuild, index.pack.build);
  const c = { ...p, id: "PRIVATE_GUID", updatedAt: "2026-11-09T01:00:00.000Z" };
  for (const k of [
    "source",
    "notes",
    "goals",
    "clientBuild",
    "locale",
    "captureVersion",
    "history",
    "readiness",
  ])
    delete c[k];
  const merged = mergeSnapshot(state, {
    characters: [c],
    activeId: c.id,
    observedAt: c.updatedAt,
  });
  assert.equal(merged.profiles[0].id, "p");
  assert.equal(merged.profiles[0].notes, "PRIVATE_NOTE");
  assert.equal(merged.profiles[0].clientBuild, undefined);
  assert.equal(merged.profiles[0].history, undefined);
  assert.deepEqual(
    validateHistory({
      recent: [],
      completedIdsKnown: true,
      completedIds: [1, 2],
    }).completedIds,
    [1, 2],
  );
  for (const h of [
    { recent: [], completedIdsKnown: true },
    { recent: [], completedIdsKnown: true, completedIds: [2, 1] },
    { recent: [], completedIdsKnown: true, completedIds: [1, 1] },
    { recent: [], completedIds: Array(20001).fill(1) },
  ])
    assert.throws(() => validateHistory(h));
  assert.equal(
    validateQuestData([
      {
        id: 1,
        title: "q",
        complete: false,
        objectives: [
          {
            text: "o",
            done: false,
            type: "monster",
            required: 4,
            fulfilled: 1,
          },
        ],
      },
    ])[0].objectives[0].required,
    4,
  );
});
test("guidance and brief enrich exact IDs while preserving actual destination priority and step kinds", () => {
  const { buildGuidance } = require("../src/core/guidance.cjs"),
    { buildBrief } = require("../src/core/adventure.cjs");
  const plan = buildGuidance(p, { knowledge: index });
  assert.equal(plan.steps[0].referenceDestination.x, 0.3528);
  assert.equal(plan.steps[0].knowledge.status, "match");
  assert.equal(plan.steps[0].kind, "turn-in");
  assert.equal(plan.followUps[0].questId, 5730);
  const real = { mapId: 999, x: 0.1, y: 0.2 };
  const other = buildGuidance(
    { ...p, quests: [{ ...p.quests[0], destination: real }] },
    { knowledge: index },
  );
  assert.deepEqual(other.steps[0].destination, real);
  assert.equal(other.steps[0].referenceDestination.x, 0.3528);
  const brief = buildBrief(p, { knowledge: index });
  assert.equal(brief.guidance.steps[0].knowledge.record.id, 1061);
  assert.equal(brief.quests.items[0].knowledge.record.id, 1061);
  assert.equal(
    buildGuidance({ ...p, clientBuild: "1.60.1.9" }, { knowledge: index })
      .steps[0].referenceDestination,
    undefined,
  );
});
test("shared context helper grounds facts and excludes private data and full history in every provider", () => {
  const ai = require("../src/core/providers.cjs");
  const state = { profiles: [p] };
  const options = { knowledge: index, prompt: "Help with quest 1061" };
  const context = ai.approvedProfile(p, options);
  assert.equal(context.knowledge[0].questId, 1061);
  assert.equal(context.knowledge[0].turnIns[0].name, "Seereth Stonebreak");
  const monster = {
    ...p,
    quests: [
      {
        id: 1062,
        title: "Goblin Invaders",
        complete: false,
        objectives: [{ text: "Kill loggers", done: false }],
      },
    ],
  };
  const monsterContext = ai.approvedProfile(monster, {
    knowledge: index,
    prompt: "Who gives quest 1062?",
  });
  assert.equal(
    monsterContext.knowledge[0].givers[0].name,
    "Seereth Stonebreak",
  );
  assert.equal(monsterContext.knowledge[0].referenceDestination, undefined);
  const nextContext = ai.approvedProfile(p, {
    knowledge: index,
    prompt: "Who gives quest 5730?",
  });
  assert.equal(nextContext.knowledge[0].questId, 5730);
  assert.equal(nextContext.knowledge[0].givers[0].name, "Neeru Fireblade");
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(
    serialized,
    /PRIVATE|completedIds|readiness|goals|notes|source\.id/,
  );
  assert.match(serialized, /156f29c9/);
  assert.deepEqual(ai.approvedProfile(context), context);
  assert.equal(ai.profileContext(state, "p", false, options), "");
  assert.equal(
    ai.profileContext(state, "p", true, options),
    "Optional character context: " + serialized,
  );
  assert.deepEqual(
    ai.approvedProfile({ ...p, clientBuild: "1.60.1.9" }, options).knowledge,
    undefined,
  );
});
test("all API request payloads and Claude subscription receive only whitelisted reference facts", async (t) => {
  const ai = require("../src/core/providers.cjs");
  const approved = ai.approvedProfile(p, { knowledge: index, prompt: "1061" });
  for (const provider of [
    "ollama",
    "ollama-cloud",
    "openai",
    "anthropic",
    "xai",
  ]) {
    let sent;
    await ai.ask(
      {
        provider,
        model: "fixture",
        apiKey: "fixture",
        prompt: "1061",
        context: ai.profileContext({ profiles: [p] }, "p", true, {
          knowledge: index,
          prompt: "1061",
        }),
      },
      async (_url, o) => {
        sent = o.body;
        return new Response(
          JSON.stringify(
            provider.startsWith("ollama")
              ? { message: { content: "ok" } }
              : provider === "openai"
                ? {
                    output: [
                      {
                        type: "message",
                        content: [{ type: "output_text", text: "ok" }],
                      },
                    ],
                  }
                : provider === "anthropic"
                  ? { content: [{ type: "text", text: "ok" }] }
                  : { choices: [{ message: { content: "ok" } }] },
          ),
        );
      },
    );
    assert.doesNotMatch(
      sent,
      /completedIds|PRIVATE_NOTE|PRIVATE_GUID|readiness/,
    );
    assert.ok(sent.includes("Seereth Stonebreak"));
    assert.ok(sent.includes("156f29c9"));
  }
  const fs = require("node:fs"),
    path = require("node:path");
  const dir = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "bf-context-"),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let input;
  const api = require("../src/core/claude.cjs").createClaude({
    dataDir: dir,
    findExecutable: async () => "C:/synthetic/claude.exe",
    runner: async (_exe, args, options) =>
      args.includes("--print")
        ? ((input = options.input),
          {
            code: 0,
            stdout: JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              result: "ok",
            }),
          })
        : {
            code: 0,
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: "claude.ai",
              apiProvider: "firstParty",
              subscriptionType: "max",
            }),
          },
  });
  await api.ask({ model: "fixture", prompt: "1061", context: approved });
  assert.doesNotMatch(
    input,
    /completedIds|PRIVATE_NOTE|PRIVATE_GUID|readiness/,
  );
  assert.ok(input.includes("Seereth Stonebreak"));
});
