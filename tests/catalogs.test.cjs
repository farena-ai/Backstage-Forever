const test = require("node:test");
const a = require("node:assert/strict");
const v = require("../src/core/validation.cjs");
const { listModels } = require("../src/core/model-catalog.cjs");
const { ask } = require("../src/core/providers.cjs");
test("cloud Ollama has fixed endpoint, separate authorization and native response", async () => {
  a.equal(v.endpoint("ollama-cloud"), "https://ollama.com");
  a.throws(() => v.endpoint("ollama-cloud", "http://localhost:11434"));
  let req;
  a.equal(
    await ask(
      {
        provider: "ollama-cloud",
        model: "cloud-id",
        apiKey: "CLOUD",
        prompt: "Help plan my WoW adventure",
      },
      async (url, opts) => {
        req = { url, opts };
        return Response.json({ message: { content: "ok" } });
      },
    ),
    "ok",
  );
  a.equal(req.url, "https://ollama.com/api/chat");
  a.equal(req.opts.headers.Authorization, "Bearer CLOUD");
  a.equal(JSON.parse(req.opts.body).stream, false);
});
test("catalog uses native tags and never sends a key to local Ollama", async () => {
  for (const provider of ["ollama", "ollama-cloud"]) {
    let req;
    const result = await listModels(
      { provider, apiKey: "SECRET" },
      async (url, opts) => {
        req = { url, opts };
        return Response.json({
          models: [
            { name: "chat" },
            { name: "embed", capabilities: ["embedding"] },
          ],
        });
      },
    );
    a.deepEqual(result.models, [{ id: "chat", label: "chat" }]);
    a.equal(req.opts.method, "GET");
    a.equal(
      req.opts.headers.Authorization,
      provider === "ollama" ? undefined : "Bearer SECRET",
    );
    a.match(req.url, /\/api\/tags$/);
  }
});
test("API catalogs paginate safely, filter known nontext IDs and preserve order", async () => {
  let calls = [];
  const result = await listModels(
    { provider: "anthropic", apiKey: "SECRET" },
    async (url, opts) => {
      calls.push({ url, opts });
      return Response.json(
        calls.length === 1
          ? {
              data: [{ id: "claude-a", display_name: "A" }],
              has_more: true,
              last_id: "claude-a",
            }
          : { data: [{ id: "claude-b", display_name: "B" }], has_more: false },
      );
    },
  );
  a.deepEqual(result.models, [
    { id: "claude-a", label: "A" },
    { id: "claude-b", label: "B" },
  ]);
  a.match(calls[1].url, /after_id=claude-a/);
  a.equal(calls[0].opts.headers["x-api-key"], "SECRET");
  const api = await listModels(
    { provider: "openai", apiKey: "KEY" },
    async () =>
      Response.json({
        data: [
          { id: "text-embedding-3" },
          { id: "gpt-chat" },
          { id: "dall-e-3" },
          { id: "whisper-1" },
        ],
      }),
  );
  a.deepEqual(api.models, [{ id: "gpt-chat", label: "gpt-chat" }]);
});
test("catalog errors are bounded and sanitized; subscription never falls into API mode", async () => {
  for (const fake of [
    async () => {
      throw Error("SECRET");
    },
    async () => new Response("SECRET", { status: 401 }),
    async () => new Response("x".repeat(1100000)),
    async () => Response.json({ data: "bad" }),
  ]) {
    const r = await listModels({ provider: "openai", apiKey: "SECRET" }, fake);
    a.deepEqual(r.models, []);
    a.doesNotMatch(JSON.stringify(r), /SECRET/);
    a.ok(r.message);
  }
  let used = false;
  const result = await listModels(
    {
      provider: "openai",
      authMode: "subscription",
      apiKey: "SECRET",
      chatgpt: {
        listModels: async () => ({
          models: [{ id: "account", label: "Account" }],
          source: "chatgpt-account",
          checkedAt: 1,
          message: "ok",
        }),
      },
    },
    async () => {
      used = true;
    },
  );
  a.equal(used, false);
  a.equal(result.models[0].id, "account");
});
test("snapshot metadata is optional, validated and backup compatible", () => {
  const s = v.defaultState();
  s.profiles = [
    {
      id: "p",
      name: "Hero",
      realm: "Realm",
      className: "Mage",
      level: 2,
      notes: "",
      goals: [],
      race: "Human",
      faction: "Alliance",
      source: {
        kind: "wow-addon",
        id: "opaque",
        updatedAt: "2026-11-08T12:00:00.000Z",
      },
      location: { zone: "Forest", subZone: "Grove", mapId: 1, x: 0.5, y: 0.2 },
    },
  ];
  a.deepEqual(v.validateState(s), { ...s, activeProfileId: "p" });
  s.profiles[0].location.x = 2;
  a.throws(() => v.validateState(s));
});
test("Claude SDK catalog initialization sends no user messages and disables tools", async () => {
  const { createClaude } = require("../src/core/claude.cjs");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  let closed = false,
    options,
    prompt;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sdk-"));
  const c = createClaude({
    dataDir: dir,
    findExecutable: async () => "C:/trusted/claude.exe",
    sdkQuery: ({ options: o, prompt: p }) => {
      options = o;
      prompt = p;
      return {
        supportedModels: async () => [
          { value: "claude-a", displayName: "Claude A" },
        ],
        close() {
          closed = true;
        },
      };
    },
  });
  try {
    const r = await c.listModels();
    a.deepEqual(r.models, [{ id: "claude-a", label: "Claude A" }]);
    a.equal(closed, true);
    a.equal(options.pathToClaudeCodeExecutable, "C:/trusted/claude.exe");
    a.deepEqual(options.tools, []);
    a.equal(options.env.ANTHROPIC_API_KEY, undefined);
    a.equal(options.strictMcpConfig, true);
    a.deepEqual(options.mcpServers, {});
    a.equal((await prompt[Symbol.asyncIterator]().next()).done, true);
    a.match(r.message, /catalog|entitlement/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Claude reset cancels catalog initialization and discards late models", async () => {
  const { createClaude } = require("../src/core/claude.cjs");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sdk-race-"));
  let ready,
    release,
    closed = false;
  const started = new Promise((r) => {
    ready = r;
  });
  const c = createClaude({
    dataDir: dir,
    findExecutable: async () => "C:/trusted/claude.exe",
    sdkQuery: () => {
      ready();
      return {
        supportedModels: () =>
          new Promise((r) => {
            release = r;
          }),
        close() {
          closed = true;
        },
      };
    },
  });
  try {
    const pending = c.listModels();
    await started;
    await c.clearCredentials();
    release([{ value: "late", displayName: "Late" }]);
    a.deepEqual((await pending).models, []);
    a.equal(closed, true);
    a.equal(fs.existsSync(path.join(dir, "claude-subscription")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("catalog excludes pure audio IDs and caps endless pagination", async () => {
  const r = await listModels({ provider: "openai", apiKey: "key" }, async () =>
    Response.json({ data: [{ id: "gpt-audio" }, { id: "gpt-text" }] }),
  );
  a.deepEqual(r.models, [{ id: "gpt-text", label: "gpt-text" }]);
  let calls = 0;
  const many = await listModels(
    { provider: "anthropic", apiKey: "key" },
    async () => {
      calls++;
      return Response.json({
        data: [{ id: "claude" }],
        has_more: true,
        last_id: "claude",
      });
    },
  );
  a.deepEqual(many.models, []);
  a.equal(calls, 5);
});
