const { test } = require("node:test");
const a = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v = require("../src/core/validation.cjs");
const { Store } = require("../src/core/store.cjs");
const p = require("../src/core/providers.cjs");
test("state rejects malformed, extra credential fields and dangling active profile", () => {
  a.throws(() => v.validateState({}));
  const s = v.defaultState();
  s.apiKey = "secret";
  a.throws(() => v.validateState(s));
  a.throws(() =>
    v.validateState({ ...v.defaultState(), activeProfileId: "missing" }),
  );
});
test("validated state preserves profile and limits", () => {
  const s = v.defaultState();
  s.profiles = [
    {
      id: "a",
      name: "Hero",
      realm: "Realm",
      className: "Mage",
      level: 10,
      notes: "PRIVATE",
      goals: [{ id: "g", text: "PRIVATE GOAL", done: false }],
    },
  ];
  s.activeProfileId = "a";
  a.deepEqual(v.validateState(s), s);
  s.profiles[0].level = Infinity;
  a.throws(() => v.validateState(s));
});
test("context only shares permitted character fields intentionally", () => {
  const s = v.defaultState();
  s.profiles = [
    {
      id: "a",
      name: "Hero",
      realm: "Realm",
      className: "Mage",
      level: 10,
      notes: "PRIVATE",
      goals: [{ id: "g", text: "HIDDEN", done: false }],
    },
  ];
  a.equal(p.profileContext(s, "a", false), "");
  const c = p.profileContext(s, "a", true);
  a.match(c, /Hero/);
  a.doesNotMatch(c, /PRIVATE|HIDDEN/);
});
test("fixed cloud endpoints and loopback-only Ollama", () => {
  for (const x of [
    "http://example.com",
    "http://127.0.0.1.evil",
    "https://localhost",
    "http://user:pass@localhost",
    "http://localhost/path",
    "http://0.0.0.0",
  ])
    a.throws(() => v.endpoint("ollama", x));
  a.equal(
    v.endpoint("ollama", "http://127.0.0.1:11434"),
    "http://127.0.0.1:11434",
  );
  a.throws(() => v.endpoint("openai", "https://evil.com"));
});
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("encrypted:" + s),
  decryptString: (b) => b.toString().slice(10),
};
test("atomic import preserves state and credentials on invalid input; exports no secrets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const st = new Store(dir, safe);
  st.saveKey("openai", "private-key");
  st.saveState({ ...v.defaultState(), onboarded: true });
  a.throws(() => st.importData("{bad"));
  a.equal(st.state.onboarded, true);
  a.equal(st.getKey("openai"), "private-key");
  a.doesNotMatch(st.exportData(), /private-key|encrypted/);
  const valid = v.defaultState();
  st.importData(JSON.stringify(valid));
  a.equal(st.getKey("openai"), "private-key");
  a.equal(new Store(dir, safe).getKey("openai"), "private-key");
  fs.rmSync(dir, { recursive: true });
});
test("encryption unavailable refuses key writes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  a.throws(() =>
    new Store(dir, { isEncryptionAvailable: () => false }).saveKey(
      "xai",
      "secret",
    ),
  );
  fs.rmSync(dir, { recursive: true });
});
test("protocol fixtures verify four provider payloads and extraction", async () => {
  for (const id of ["ollama", "openai", "anthropic", "xai"]) {
    let req;
    const fake = async (url, opts) => {
      req = { url, opts };
      return new Response(
        JSON.stringify(
          id === "ollama"
            ? { message: { content: "yes" } }
            : id === "openai"
              ? {
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "yes" }],
                    },
                  ],
                }
              : id === "anthropic"
                ? { content: [{ type: "text", text: "yes" }] }
                : { choices: [{ message: { content: "yes" } }] },
        ),
      );
    };
    a.equal(
      await p.ask(
        {
          provider: id,
          model: "user-model",
          endpoint: v.endpoint(id),
          apiKey: "key",
          prompt: "hello",
          context: "",
        },
        fake,
      ),
      "yes",
    );
    a.equal(req.opts.redirect, "error");
    const body = JSON.parse(req.opts.body);
    a.equal(body.model, "user-model");
    if (id === "openai") a.equal(body.store, false);
    if (id === "ollama") a.equal(body.stream, false);
    if (id === "anthropic")
      a.equal(req.opts.headers["anthropic-version"], "2023-06-01");
  }
});
test("remote failures never expose keys or upstream error details", async () => {
  await a.rejects(
    p.ask(
      { provider: "openai", model: "m", apiKey: "secret", prompt: "x" },
      async () => new Response("secret remote stack", { status: 401 }),
    ),
    (e) => !e.message.includes("secret") && /authentication/i.test(e.message),
  );
  await a.rejects(
    p.ask(
      { provider: "ollama", model: "m", prompt: "x" },
      async () => new Response("x".repeat(1100000)),
    ),
    /too large/,
  );
});
test("state requires explicit provider endpoint", () => {
  const s = v.defaultState();
  delete s.provider.endpoint;
  a.throws(() => v.validateState(s));
});

test("all adapters include companion safety instructions", async () => {
  for (const provider of ["ollama", "openai", "anthropic", "xai"]) {
    let body;
    await p.ask(
      { provider, model: "m", apiKey: "k", prompt: "hi" },
      async (_url, o) => {
        body = JSON.parse(o.body);
        return new Response(
          JSON.stringify(
            provider === "ollama"
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
    const instruction =
      body.instructions ||
      body.system ||
      body.messages.find((m) => m.role === "system")?.content;
    a.equal(instruction, require("../src/core/wow-policy.cjs").INSTRUCTION);
    a.match(instruction, /automat/i);
    a.match(instruction, /combat/i);
    a.match(instruction, /uncertain/i);
  }
});
test("credential fixtures persist encrypted, isolate providers, delete and reset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  let st = new Store(dir, safe);
  st.saveKey("openai", "KEY-A");
  st.saveKey("xai", "KEY-B");
  a.doesNotMatch(
    fs.readFileSync(path.join(dir, "credentials.json"), "utf8"),
    /KEY-A|KEY-B/,
  );
  st = new Store(dir, safe);
  a.equal(st.getKey("openai"), "KEY-A");
  st.deleteKey("openai");
  st = new Store(dir, safe);
  a.equal(st.getKey("openai"), "");
  a.equal(st.getKey("xai"), "KEY-B");
  st.reset();
  st = new Store(dir, safe);
  a.equal(st.getKey("xai"), "");
  a.deepEqual(st.state, v.defaultState());
  fs.rmSync(dir, { recursive: true });
});
test("invalid replies, redirect failures and network timeout details stay safe", async () => {
  for (const fake of [
    async () => new Response("not json"),
    async () => new Response("{}"),
    async () => {
      throw new Error("redirect secret-key");
    },
    async () => {
      throw new Error("timeout secret-key");
    },
  ])
    await a.rejects(
      p.ask(
        { provider: "openai", model: "m", apiKey: "secret-key", prompt: "hi" },
        fake,
      ),
      (e) => !e.message.includes("secret-key"),
    );
});
test("desktop acquires single-instance lock before initializing data", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  a.match(main, /requestSingleInstanceLock/);
  a.match(main, /second-instance/);
  a.ok(main.indexOf("requestSingleInstanceLock") < main.indexOf("new Store("));
});
test("auth mode is optional for old backups and validated explicitly", () => {
  const s = v.defaultState();
  a.equal(v.validateState(s).provider.authMode, undefined);
  s.provider.authMode = "subscription";
  a.equal(v.validateState(s).provider.authMode, "subscription");
  s.provider.authMode = "automatic";
  a.throws(() => v.validateState(s));
});
// Main/service integration is structural; transport behavior is covered by companion-service tests.
test("main wires companion dispatch to the service and retains app credential reset boundaries", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  const service = fs.readFileSync(
    path.join(__dirname, "../src/core/companion-service.cjs"),
    "utf8",
  );
  a.match(service, /authMode.*subscription/s);
  a.match(service, /chatgpt\.ask/);
  a.match(service, /claude\.ask/);
  a.match(main, /const \{ CompanionService \} = require\("\.\/core\/companion-service\.cjs"\)/);
  a.match(main, /companionService = new CompanionService\(/);
  a.match(main, /handle\("ask", \(\.\.\.args\) => companionService\.legacy\(\.\.\.args\)\)/);
  a.match(main, /handle\("askCompanion", \(\.\.\.args\) => companionService\.ask\(\.\.\.args\)\)/);
  a.match(main, /chatgpt\.reset/);
  a.match(main, /claude\.clearCredentials/);
  a.match(main, /subscriptionStatus/);
  const preload = fs.readFileSync(
    path.join(__dirname, "../src/preload.cjs"),
    "utf8",
  );
  for (const method of [
    "subscriptionStatus",
    "connectSubscription",
    "disconnectSubscription",
  ])
    a.match(preload, new RegExp(method));
});
test("main rejects overlapping mutations throughout asynchronous reset", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  a.match(main, /if \(resetting\)/);
  a.match(main, /resetting = true/);
  a.match(main, /finally\s*\{\s*resetting = false/s);
});
