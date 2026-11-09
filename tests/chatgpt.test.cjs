"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ChatGPTAuth,
  createTransaction,
  authorizationUrl,
  consumeCallback,
  verifyIdentity,
  ENDPOINTS,
} = require("../src/core/chatgpt.cjs");
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("fixture:" + s),
  decryptString: (b) => b.toString().slice(8),
};
const scopes =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
async function fixture(options = {}) {
  const jose = await import("jose");
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  const jwks = jose.createLocalJWKSet({
    keys: [await jose.exportJWK(publicKey)],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-oauth-"));
  let authUrl;
  let calls = [];
  let tokenIndex = 0;
  const identity = async (nonce, extra = {}) =>
    new jose.SignJWT({
      nonce,
      iss: ENDPOINTS.issuer,
      aud: "oaiapp_fixture",
      sub: "fixture-sub",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...extra,
    })
      .setProtectedHeader({ alg: "RS256" })
      .sign(privateKey);
  const fetcher = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === ENDPOINTS.discovery)
      return Response.json({
        ...ENDPOINTS,
        authorization_endpoint: ENDPOINTS.authorize,
        token_endpoint: ENDPOINTS.token,
        jwks_uri: ENDPOINTS.jwks,
        revocation_endpoint: ENDPOINTS.revoke,
      });
    if (url === ENDPOINTS.token) {
      if (
        options.invalidGrantOnce &&
        tokenIndex === 0 &&
        new URLSearchParams(opts.body).get("grant_type") ===
          "authorization_code"
      ) {
        tokenIndex++;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      if (
        options.failRefresh &&
        new URLSearchParams(opts.body).get("grant_type") === "refresh_token"
      )
        return new Response("raw-secret", { status: 400 });
      tokenIndex++;
      return Response.json({
        access_token: "ACCESS-" + tokenIndex,
        refresh_token: "REFRESH-" + tokenIndex,
        id_token: await identity(
          authUrl.searchParams.get("nonce"),
          options.identity || {},
        ),
        scope: options.scope ?? scopes,
        token_type: "Bearer",
        expires_in: options.expiresIn || 3600,
      });
    }
    if (url === ENDPOINTS.revoke) return new Response("", { status: 200 });
    if (url === "https://api.openai.com/v1/responses")
      return new Response(
        options.stream ||
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    throw Error("Unexpected fixture URL");
  };
  const auth = new ChatGPTAuth(dir, safe, {
    fetch: fetcher,
    jwks,
    openExternal: async (url) => {
      authUrl = new URL(url);
      const cb = new URL(authUrl.searchParams.get("redirect_uri"));
      cb.searchParams.set(
        "state",
        options.badState ? "bad" : authUrl.searchParams.get("state"),
      );
      cb.searchParams.set("code", "fixture-code");
      cb.searchParams.set("client_id", "oaiapp_fixture");
      await fetch(cb);
    },
  });
  return {
    auth,
    dir,
    calls,
    get authUrl() {
      return authUrl;
    },
    jwks,
    identity,
    close() {
      auth.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("fresh state nonce PKCE and official registration parameters", () => {
  const t = createTransaction("http://127.0.0.1:1234/auth/callback");
  const other = createTransaction(t.redirectUri);
  assert.notEqual(t.state, other.state);
  assert.notEqual(t.nonce, other.nonce);
  assert.equal(
    t.challenge,
    crypto.createHash("sha256").update(t.verifier).digest("base64url"),
  );
  const u = new URL(authorizationUrl(t, "urn:uuid:fixture"));
  assert.equal(u.origin, "https://auth.openai.com");
  assert.equal(u.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(u.searchParams.get("agent_name_hint"), "Backstage Forever");
  assert.match(u.searchParams.get("scope"), /chatgpt.tokens.use.direct/);
  assert.equal(u.searchParams.get("resource"), "https://api.openai.com/v1");
});
test("callback rejects missing/mismatched/expired/reused state and missing issued registration", () => {
  for (const suffix of [
    "?state=wrong&code=c&client_id=oaiapp_x",
    "?error=access_denied",
    "?code=c",
  ]) {
    const t = createTransaction("http://127.0.0.1:1234/auth/callback");
    assert.throws(() => consumeCallback(t, new URL(t.redirectUri + suffix)));
  }
  const t = createTransaction("http://127.0.0.1:1234/auth/callback");
  t.expiresAt = 0;
  assert.throws(() =>
    consumeCallback(
      t,
      new URL(
        t.redirectUri + "?state=" + t.state + "&code=c&client_id=oaiapp_x",
      ),
    ),
  );
  const t2 = createTransaction("http://127.0.0.1:1234/auth/callback");
  const u = new URL(
    t2.redirectUri + "?state=" + t2.state + "&code=c&client_id=oaiapp_x",
  );
  assert.equal(consumeCallback(t2, u).clientId, "oaiapp_x");
  assert.throws(() => consumeCallback(t2, u));
});
test("OIDC verifies signature issuer audience expiry and nonce", async () => {
  const f = await fixture();
  try {
    const token = await f.identity("nonce");
    assert.equal(
      (await verifyIdentity(token, "oaiapp_fixture", "nonce", f.jwks)).sub,
      "fixture-sub",
    );
    for (const [aud, nonce] of [
      ["wrong", "nonce"],
      ["oaiapp_fixture", "wrong"],
    ])
      await assert.rejects(verifyIdentity(token, aud, nonce, f.jwks));
    const jose = await import("jose");
    const { privateKey } = await jose.generateKeyPair("RS256");
    const invalid = await new jose.SignJWT({ nonce: "nonce" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ENDPOINTS.issuer)
      .setAudience("oaiapp_fixture")
      .setSubject("s")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    await assert.rejects(
      verifyIdentity(invalid, "oaiapp_fixture", "nonce", f.jwks),
    );
    for (const extra of [{ iss: "wrong" }, { exp: 1 }])
      await assert.rejects(
        verifyIdentity(
          await f.identity("nonce", extra),
          "oaiapp_fixture",
          "nonce",
          f.jwks,
        ),
      );
  } finally {
    f.close();
  }
});
test("real loopback fixture registers and persists tokens encrypted; status sanitized and no startup network", async () => {
  const f = await fixture();
  try {
    assert.equal(f.calls.length, 0);
    assert.equal(f.auth.status().connected, false);
    await f.auth.connect();
    assert.equal(f.auth.status().connected, true);
    assert.doesNotMatch(
      JSON.stringify(f.auth.status()),
      /ACCESS-|REFRESH-|id_token/,
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(f.dir, "chatgpt-credentials.json"), "utf8"),
      /ACCESS-|REFRESH-|fixture-sub/,
    );
    const before = f.calls.length;
    const reloaded = new ChatGPTAuth(f.dir, safe, {
      fetch: () => {
        throw Error("startup network");
      },
    });
    assert.equal(reloaded.status().connected, true);
    assert.equal(f.calls.length, before);
    reloaded.close();
    const exchange = f.calls.find((x) => x.url === ENDPOINTS.token);
    const form = new URLSearchParams(exchange.opts.body);
    assert.equal(form.get("client_id"), "oaiapp_fixture");
    assert.equal(
      form.get("redirect_uri"),
      f.authUrl.searchParams.get("redirect_uri"),
    );
    assert.equal(form.get("resource"), "https://api.openai.com/v1");
  } finally {
    f.close();
  }
});
test("denied plan scope and mismatched callback leave credentials disconnected", async () => {
  for (const opts of [
    { scope: "openid profile email" },
    { badState: true },
    { identity: { nonce: "bad" } },
  ]) {
    const f = await fixture(opts);
    try {
      await assert.rejects(f.auth.connect());
      assert.equal(f.auth.status().connected, false);
    } finally {
      f.close();
    }
  }
});
test("subscription inference uses OAuth Responses stream completed without API fields or fallback", async () => {
  const f = await fixture();
  try {
    await f.auth.connect();
    assert.equal(
      await f.auth.ask({
        model: "selected-model",
        prompt: "hi",
        context: "permitted context",
      }),
      "Hello",
    );
    const call = f.calls.find(
      (x) => x.url === "https://api.openai.com/v1/responses",
    );
    assert.equal(call.opts.headers.Authorization, "Bearer ACCESS-1");
    const body = JSON.parse(call.opts.body);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.ok(Array.isArray(body.input));
    assert.equal(body.max_output_tokens, undefined);
    assert.equal(call.opts.redirect, "error");
  } finally {
    f.close();
  }
});
test("subscription receives bounded sourced quest facts without full local history", async () => {
  const f = await fixture();
  try {
    await f.auth.connect();
    const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
    const knowledge = new KnowledgeIndex(require("../data/forever/pack.json"));
    const profile = {
      id: "p",
      name: "Example",
      clientBuild: knowledge.pack.build,
      source: {
        kind: "wow-addon",
        id: "PRIVATE_GUID",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
      notes: "PRIVATE_NOTE",
      history: { recent: [], completedIdsKnown: true, completedIds: [5729] },
      quests: [
        {
          id: 1061,
          title: "The Spirits of Stonetalon",
          complete: true,
          objectives: [],
        },
      ],
    };
    const context = require("../src/core/providers.cjs").profileContext(
      { profiles: [profile] },
      "p",
      true,
      { knowledge, prompt: "1061" },
    );
    await f.auth.ask({ model: "selected-model", prompt: "1061", context });
    const body = f.calls.find(
      (x) => x.url === "https://api.openai.com/v1/responses",
    ).opts.body;
    assert.doesNotMatch(body, /PRIVATE|completedIds/);
    assert.match(body, /Seereth Stonebreak/);
    assert.match(body, /156f29c9/);
  } finally {
    f.close();
  }
});

test("terminal failed or interrupted stream cannot produce success", async () => {
  for (const stream of [
    'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    'data: {"type":"response.failed","response":{"error":{"message":"TOKEN-SECRET"}}}\n\n',
  ]) {
    const f = await fixture({ stream });
    try {
      await f.auth.connect();
      await assert.rejects(
        f.auth.ask({ model: "m", prompt: "x" }),
        (e) => !e.message.includes("TOKEN-SECRET"),
      );
    } finally {
      f.close();
    }
  }
});
test("refresh rotation is serialized and failed refresh never falls back", async () => {
  const f = await fixture({ expiresIn: 1 });
  try {
    await f.auth.connect();
    await Promise.all([
      f.auth.ask({ model: "m", prompt: "x" }),
      f.auth.ask({ model: "m", prompt: "x" }),
    ]);
    const refreshes = f.calls.filter(
      (x) =>
        x.url === ENDPOINTS.token &&
        new URLSearchParams(x.opts.body).get("grant_type") === "refresh_token",
    );
    assert.equal(refreshes.length, 1);
    assert.equal(
      new URLSearchParams(refreshes[0].opts.body).get("refresh_token"),
      "REFRESH-1",
    );
  } finally {
    f.close();
  }
  const bad = await fixture({ expiresIn: 1, failRefresh: true });
  try {
    await bad.auth.connect();
    await assert.rejects(
      bad.auth.ask({ model: "m", prompt: "x" }),
      (e) => !e.message.includes("raw-secret"),
    );
    assert.equal(
      bad.calls.some((x) => x.url.endsWith("/responses")),
      false,
    );
  } finally {
    bad.close();
  }
});
test("disconnect revokes refresh token, clears local tokens and preserves host and registration", async () => {
  const f = await fixture();
  try {
    await f.auth.connect();
    const host = f.authUrl.searchParams.get("ext_agent_host_id");
    await f.auth.disconnect();
    assert.equal(f.auth.status().connected, false);
    const revoke = f.calls.find((x) => x.url === ENDPOINTS.revoke);
    assert.equal(
      new URLSearchParams(revoke.opts.body).get("token"),
      "REFRESH-1",
    );
    await f.auth.connect();
    assert.equal(f.authUrl.searchParams.get("client_id"), "oaiapp_fixture");
    assert.equal(f.authUrl.searchParams.get("ext_agent_host_id"), host);
    assert.equal(f.authUrl.searchParams.has("id_token_hint"), false);
  } finally {
    f.close();
  }
});
test("connected return status has no pending attempt; reset cancels delayed discovery and removes tokens", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.auth.connect()).pending, false);
    f.auth.reset();
    assert.equal(f.auth.status().connected, false);
    assert.equal(
      fs.existsSync(path.join(f.dir, "chatgpt-credentials.json")),
      false,
    );
  } finally {
    f.close();
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-cancel-"));
  let release;
  let opened = false;
  const blocked = new Promise((resolve) => (release = resolve));
  const auth = new ChatGPTAuth(dir, safe, {
    fetch: async () => {
      await blocked;
      return Response.json({
        ...ENDPOINTS,
        authorization_endpoint: ENDPOINTS.authorize,
        token_endpoint: ENDPOINTS.token,
        jwks_uri: ENDPOINTS.jwks,
        revocation_endpoint: ENDPOINTS.revoke,
      });
    },
    openExternal: async () => {
      opened = true;
    },
  });
  const connecting = auth.connect();
  auth.reset();
  release();
  await assert.rejects(connecting);
  assert.equal(opened, false);
  assert.equal(auth.status().connected, false);
  auth.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("unavailable encryption refuses subscription login before any network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-no-crypto-"));
  let network = false;
  const auth = new ChatGPTAuth(
    dir,
    { isEncryptionAvailable: () => false },
    {
      fetch: async () => {
        network = true;
      },
    },
  );
  await assert.rejects(auth.connect(), /Secure credential/);
  assert.equal(network, false);
  auth.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("invalid_grant retains issued registration for a fresh authorization", async () => {
  const f = await fixture({ invalidGrantOnce: true });
  try {
    await assert.rejects(f.auth.connect());
    assert.equal(f.auth.status().connected, false);
    await f.auth.connect();
    assert.equal(f.authUrl.searchParams.get("client_id"), "oaiapp_fixture");
    assert.equal(f.authUrl.searchParams.has("agent_name_hint"), false);
  } finally {
    f.close();
  }
});
test("disconnect blocks new inference and login while revoking; reset wins over late revocation", async () => {
  const f = await fixture({ expiresIn: 1 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  try {
    await f.auth.connect();
    const original = f.auth.fetch;
    f.auth.fetch = async (url, opts) => {
      if (url === ENDPOINTS.revoke) {
        await gate;
        return new Response("", { status: 200 });
      }
      return original(url, opts);
    };
    const disconnecting = f.auth.disconnect();
    assert.equal(f.auth.status().connected, false);
    await assert.rejects(f.auth.ask({ model: "m", prompt: "hi" }));
    await assert.rejects(f.auth.connect());
    f.auth.reset();
    release();
    await disconnecting;
    assert.equal(f.auth.status().connected, false);
    assert.equal(f.auth.status().account, null);
    assert.equal(
      fs.existsSync(path.join(f.dir, "chatgpt-credentials.json")),
      false,
    );
  } finally {
    release();
    f.close();
  }
});
test("account catalog GET uses OAuth, visibility, labels and server order without inference", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-catalog-"));
  let request;
  const auth = new ChatGPTAuth(dir, safe, {
    fetch: async (url, opts) => {
      request = { url, opts };
      return Response.json({
        models: [
          { slug: "second", display_name: "Second", visibility: "list" },
          { slug: "hidden", display_name: "Hidden", visibility: "hide" },
          { slug: "first", display_name: "First", visibility: "list" },
        ],
      });
    },
  });
  auth.record = {
    tokens: { access_token: "OAUTH-ONLY", expiresAt: Date.now() + 3600000 },
  };
  try {
    const r = await auth.listModels();
    assert.deepEqual(r.models, [
      { id: "second", label: "Second" },
      { id: "first", label: "First" },
    ]);
    assert.equal(request.url, "https://api.openai.com/v1/models");
    assert.equal(request.opts.method, "GET");
    assert.equal(request.opts.headers.Authorization, "Bearer OAUTH-ONLY");
    assert.equal(request.opts.body, undefined);
    assert.doesNotMatch(JSON.stringify(r), /OAUTH-ONLY/);
  } finally {
    auth.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("account catalog errors and late results after close never leak or restore models", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-catalog-"));
  let release;
  const auth = new ChatGPTAuth(dir, safe, {
    fetch: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  auth.record = {
    tokens: { access_token: "SECRET", expiresAt: Date.now() + 3600000 },
  };
  try {
    const pending = auth.listModels();
    await new Promise((resolve) => setImmediate(resolve));
    auth.close();
    release(
      Response.json({
        models: [{ slug: "late", display_name: "Late", visibility: "list" }],
      }),
    );
    const r = await pending;
    assert.deepEqual(r.models, []);
    assert.doesNotMatch(JSON.stringify(r), /SECRET/);
  } finally {
    auth.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
