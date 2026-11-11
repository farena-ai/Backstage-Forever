"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { atomic } = require("./store.cjs");
const { str } = require("./validation.cjs");
const ENDPOINTS = Object.freeze({
  issuer: "https://auth.openai.com",
  discovery: "https://auth.openai.com/.well-known/openid-configuration",
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  jwks: "https://auth.openai.com/.well-known/jwks.json",
  revoke: "https://auth.openai.com/api/accounts/oauth/revoke",
});
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const SAFE_ERROR =
  "ChatGPT sign-in could not be completed. Try Continue with ChatGPT again.";
const { INSTRUCTION } = require("./wow-policy.cjs");
const random = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
function createTransaction(redirectUri, clientId = "dynamic_agent_client") {
  const verifier = random(64);
  return {
    redirectUri,
    clientId,
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    state: random(),
    nonce: random(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    consumed: false,
  };
}
function authorizationUrl(transaction, hostId, saved = {}) {
  const params = new URLSearchParams({
    client_id: transaction.clientId,
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: transaction.redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge_method: "S256",
    code_challenge: transaction.challenge,
  });
  if (transaction.clientId === "dynamic_agent_client")
    params.set("agent_name_hint", "Backstage Forever");
  if (saved.tokens?.id_token)
    params.set("id_token_hint", saved.tokens.id_token);
  if (saved.email) params.set("login_hint", saved.email);
  return ENDPOINTS.authorize + "?" + params;
}
function consumeCallback(transaction, url) {
  if (transaction.consumed) throw new Error(SAFE_ERROR);
  transaction.consumed = true;
  if (
    transaction.expiresAt <= Date.now() ||
    url.origin + url.pathname !== transaction.redirectUri ||
    url.searchParams.get("state") !== transaction.state ||
    url.searchParams.has("error")
  )
    throw new Error(SAFE_ERROR);
  const code = url.searchParams.get("code");
  const issued = url.searchParams.get("client_id");
  const clientId =
    transaction.clientId === "dynamic_agent_client"
      ? issued
      : transaction.clientId;
  if (
    !code ||
    !clientId ||
    clientId === "dynamic_agent_client" ||
    !/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId) ||
    (issued && issued !== clientId)
  )
    throw new Error(SAFE_ERROR);
  return { code, clientId };
}
async function verifyIdentity(token, clientId, nonce, jwks) {
  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ENDPOINTS.issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    (payload.sid !== undefined &&
      (typeof payload.sid !== "string" || !payload.sid.trim()))
  )
    throw new Error(SAFE_ERROR);
  return payload;
}
async function boundedText(response, limit = 1000000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit)
      throw new Error("ChatGPT reply exceeded the allowed size.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function tokenSet(data, now, previous) {
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    data.access_token.length > 20000 ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    data.refresh_token.length > 20000 ||
    data.token_type?.toLowerCase() !== "bearer" ||
    !Number.isInteger(data.expires_in) ||
    data.expires_in < 1 ||
    data.expires_in > 86400
  )
    throw new Error(SAFE_ERROR);
  const scopes =
    typeof data.scope === "string"
      ? data.scope.split(/\s+/).filter(Boolean)
      : previous?.scopes;
  if (
    !scopes?.includes("chatgpt.tokens.use.direct") ||
    !scopes.includes("resource.invoke")
  )
    throw new Error(
      "ChatGPT plan use was not authorized. Continue with ChatGPT and approve plan usage.",
    );
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token || previous?.id_token,
    expiresAt: now + data.expires_in * 1000,
    scopes,
  };
}
class ChatGPTAuth {
  constructor(dir, safe, options = {}) {
    this.dir = dir;
    this.safe = safe;
    this.fetch = options.fetch || fetch;
    this.openExternal = options.openExternal;
    this.jwks = options.jwks;
    this.now = options.now || Date.now;
    this.pending = null;
    this.refreshing = null;
    this.generation = 0;
    this.message = "Continue with ChatGPT to authorize plan usage.";
    this.file = path.join(dir, "chatgpt-credentials.json");
    this.hostFile = path.join(dir, "chatgpt-host.json");
    this.record = {};
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      if (!safe.isEncryptionAvailable())
        this.message = "Secure credential storage is unavailable.";
      else {
        const saved = fs.readFileSync(this.file, "utf8");
        if (saved.length > 200000) throw new Error(SAFE_ERROR);
        this.record = JSON.parse(
          safe.decryptString(
            Buffer.from(JSON.parse(saved).encrypted, "base64"),
          ),
        );
      }
    }
    if (fs.existsSync(this.hostFile))
      this.hostId = JSON.parse(fs.readFileSync(this.hostFile, "utf8")).hostId;
    if (this.hostId && !/^urn:uuid:[a-f0-9-]{36}$/.test(this.hostId))
      throw new Error(SAFE_ERROR);
  }
  status() {
    return {
      supported: true,
      connected: Boolean(this.record.tokens),
      pending: Boolean(this.pending),
      message: this.pending
        ? "Finish Continue with ChatGPT in your browser."
        : this.record.tokens
          ? "Using your ChatGPT plan. Limits and eligible models depend on your account."
          : this.message,
      account: this.record.email || null,
    };
  }
  write(record) {
    if (!this.safe.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable.");
    atomic(
      this.file,
      JSON.stringify({
        encrypted: this.safe
          .encryptString(JSON.stringify(record))
          .toString("base64"),
      }),
    );
    this.record = record;
  }
  async request(url, options = {}, raw = false) {
    const response = await this.fetch(url, {
      ...options,
      redirect: "error",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(raw ? 60000 : 15000)]) : AbortSignal.timeout(raw ? 60000 : 15000),
    });
    if (!response.ok) throw new Error(SAFE_ERROR);
    return raw ? response : JSON.parse(await boundedText(response));
  }
  async discovery() {
    if (!this.configuration) {
      const d = await this.request(ENDPOINTS.discovery);
      for (const [key, value] of Object.entries({
        issuer: ENDPOINTS.issuer,
        authorization_endpoint: ENDPOINTS.authorize,
        token_endpoint: ENDPOINTS.token,
        jwks_uri: ENDPOINTS.jwks,
        revocation_endpoint: ENDPOINTS.revoke,
      }))
        if (d[key] !== value) throw new Error(SAFE_ERROR);
      this.configuration = d;
    }
    return this.configuration;
  }
  async signingKeys() {
    if (!this.jwks) {
      const jose = await import("jose");
      this.jwks = jose.createRemoteJWKSet(
        new URL((await this.discovery()).jwks_uri),
        {
          timeoutDuration: 15000,
          [jose.customFetch]: (url, options) =>
            this.fetch(url, {
              ...options,
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            }),
        },
      );
    }
    return this.jwks;
  }
  async tokenRequest(form) {
    const response = await this.fetch(ENDPOINTS.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const data = JSON.parse(await boundedText(response));
    if (!response.ok) {
      const error = new Error(SAFE_ERROR);
      error.invalidGrant = data.error === "invalid_grant";
      throw error;
    }
    return data;
  }
  async connect() {
    if (this.disconnecting)
      throw new Error(
        "ChatGPT is disconnecting. Wait before signing in again.",
      );
    if (this.pending)
      throw new Error("ChatGPT sign-in is already in progress.");
    if (!this.safe.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable.");
    const generation = ++this.generation;
    // Reserve the attempt before discovery so double clicks cannot race listeners.
    this.pending = {
      cancel: () => {
        this.generation++;
      },
    };
    try {
      await this.discovery();
      if (generation !== this.generation) throw new Error(SAFE_ERROR);
      if (!this.hostId) {
        this.hostId = "urn:uuid:" + crypto.randomUUID();
        atomic(this.hostFile, JSON.stringify({ hostId: this.hostId }));
      }
      const server = http.createServer();
      let transaction;
      let rejectAttempt;
      let timer;
      const result = new Promise((resolve, reject) => {
        rejectAttempt = reject;
        server.on("request", async (req, res) => {
          // Do not consume a transaction for unrelated browser requests.
          if (
            req.method !== "GET" ||
            !req.url?.startsWith("/auth/callback?") ||
            req.headers.host !== new URL(transaction.redirectUri).host
          ) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          if (transaction.consumed) {
            res.writeHead(409);
            res.end("This callback was already processed.");
            return;
          }
          try {
            const { code, clientId } = consumeCallback(
              transaction,
              new URL(req.url, transaction.redirectUri),
            );
            let data;
            try {
              data = await this.tokenRequest({
                grant_type: "authorization_code",
                client_id: clientId,
                code,
                code_verifier: transaction.verifier,
                redirect_uri: transaction.redirectUri,
                resource: RESOURCE,
              });
            } catch (error) {
              // Retain registration metadata only; identity remains untrusted until verification.
              if (
                error.invalidGrant &&
                transaction.clientId === "dynamic_agent_client" &&
                generation === this.generation
              )
                this.write({ ...this.record, clientId });
              throw new Error(SAFE_ERROR);
            }
            const identity = await verifyIdentity(
              data.id_token,
              clientId,
              transaction.nonce,
              await this.signingKeys(),
            );
            if (
              this.record.subject &&
              (this.record.subject !== identity.sub ||
                this.record.clientId !== clientId)
            )
              throw new Error(SAFE_ERROR);
            const tokens = tokenSet(data, this.now());
            if (generation !== this.generation) throw new Error(SAFE_ERROR);
            this.write({
              clientId,
              subject: identity.sub,
              email: typeof identity.email === "string" ? identity.email : null,
              tokens,
            });
            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "Content-Security-Policy": "default-src 'none'",
            });
            res.end("Connected. You can return to Backstage Forever.");
            resolve(this.status());
          } catch {
            res.writeHead(400, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(
              "Sign-in was not completed. Return to Backstage Forever and try again.",
            );
            reject(new Error(SAFE_ERROR));
          }
        });
      });
      // Install a rejection handler before the browser can deliver a callback.
      result.catch(() => {});
      this.pending = {
        server,
        cancel: () => {
          this.generation++;
          rejectAttempt(new Error(SAFE_ERROR));
          server.close();
        },
      };
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      transaction = createTransaction(
        `http://127.0.0.1:${server.address().port}/auth/callback`,
        this.record.clientId || "dynamic_agent_client",
      );
      timer = setTimeout(
        () => {
          rejectAttempt(new Error(SAFE_ERROR));
          server.close();
        },
        10 * 60 * 1000,
      );
      timer.unref();
      try {
        await this.openExternal(
          authorizationUrl(transaction, this.hostId, this.record),
        );
        await result;
      } finally {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
      }
      this.pending = null;
      return this.status();
    } catch {
      throw new Error(SAFE_ERROR);
    } finally {
      this.pending = null;
    }
  }
  async accessToken() {
    if (this.disconnecting)
      throw new Error("ChatGPT is disconnecting. No new requests can be sent.");
    if (!this.record.tokens)
      throw new Error(
        "ChatGPT is disconnected. Continue with ChatGPT before sending.",
      );
    if (this.record.tokens.expiresAt - this.now() > 60000)
      return this.record.tokens.access_token;
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = (async () => {
        try {
          const current = this.record;
          const data = await this.tokenRequest({
            grant_type: "refresh_token",
            client_id: current.clientId,
            refresh_token: current.tokens.refresh_token,
            resource: RESOURCE,
          });
          const tokens = tokenSet(data, this.now(), current.tokens);
          if (data.id_token) {
            const { jwtVerify } = await import("jose");
            const { payload } = await jwtVerify(
              data.id_token,
              await this.signingKeys(),
              {
                issuer: ENDPOINTS.issuer,
                audience: current.clientId,
                algorithms: ["RS256"],
                requiredClaims: ["sub", "exp", "iat"],
                clockTolerance: 5,
              },
            );
            if (payload.sub !== current.subject) throw new Error(SAFE_ERROR);
          }
          if (generation !== this.generation) throw new Error(SAFE_ERROR);
          this.write({ ...current, tokens });
          return tokens.access_token;
        } catch {
          throw new Error(
            "ChatGPT session could not be renewed. Continue with ChatGPT again. API billing was not used.",
          );
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
  async listModels() {
    const { normalize, result } = require("./model-catalog.cjs");
    const generation = this.generation;
    try {
      const token = await this.accessToken();
      const data = await this.request(RESOURCE + "/models", {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      });
      if (generation !== this.generation) throw new Error();
      return result(
        normalize(data.models, "chatgpt"),
        "chatgpt-account",
        "Current ChatGPT account models refreshed in account order.",
      );
    } catch {
      return result(
        [],
        "chatgpt-account",
        "Could not refresh this ChatGPT account�s models. Reconnect or retry; API billing was not used.",
      );
    }
  }
  async ask({ model, prompt, context = "", signal, tools }) {
    str(model, 200, false);
    str(prompt, 12000, false);
    str(context, 20000);
    const generation = this.generation;
    signal?.throwIfAborted();
    const token = await this.accessToken();
    signal?.throwIfAborted();
    const input = [context, prompt].filter(Boolean).join("\n\n");
    // One streamed Responses call; resolves to { output } like the JSON API.
    const post = async (body) => {
      const response = await this.request(
        RESOURCE + "/responses",
        {
          signal,
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...body, store: false, stream: true }),
        },
        true,
      );
      const text = await boundedText(response);
      let output = "";
      let completed = false;
      let items = null;
      for (const frame of text.replace(/\r\n/g, "\n").split("\n\n")) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (
          ["response.failed", "response.incomplete", "error"].includes(
            event.type,
          )
        )
          throw new Error(SAFE_ERROR);
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string") throw new Error(SAFE_ERROR);
          output += event.delta;
        }
        if (event.type === "response.completed") {
          if (event.response?.status && event.response.status !== "completed")
            throw new Error(SAFE_ERROR);
          if (Array.isArray(event.response?.output)) items = event.response.output;
          completed = true;
        }
      }
      if (!completed || generation !== this.generation) throw new Error(SAFE_ERROR);
      const calls = (items || []).filter((x) => x.type === "function_call");
      return { output: [...calls, { type: "message", content: [{ type: "output_text", text: output }] }] };
    };
    try {
      let output;
      if (tools?.definitions?.length) {
        const { responsesLoop } = require("./tool-loop.cjs");
        output = await responsesLoop({ post, model, instructions: INSTRUCTION + "\n\n" + tools.instruction, input, tools });
      } else {
        const { responsesText } = require("./tool-loop.cjs");
        output = responsesText((await post({ model, instructions: INSTRUCTION, input: [{ role: "user", content: input }] })).output);
      }
      if (!output.trim() || generation !== this.generation) throw new Error(SAFE_ERROR);
      return output;
    } catch {
      throw new Error(
        "ChatGPT plan request failed or did not complete. Check your plan limits and model. API billing was not used.",
      );
    }
  }
  close() {
    this.generation++;
    this.pending?.cancel();
    this.pending = null;
  }
  async disconnect() {
    if (this.disconnecting)
      throw new Error("ChatGPT is already disconnecting.");
    this.disconnecting = true;
    this.close();
    const generation = this.generation;
    const current = this.record;
    let revoked = !current.tokens;
    try {
      // Remove usable tokens before the first await; late refreshes cannot revive them.
      this.write({
        clientId: current.clientId,
        subject: current.subject,
        email: current.email,
      });
      for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
        try {
          const d = await this.discovery();
          const response = await this.fetch(d.revocation_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: current.tokens.refresh_token,
              token_type_hint: "refresh_token",
              client_id: current.clientId,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          revoked = response.status === 200;
          if (!revoked && response.status < 500) break;
        } catch {}
        if (!revoked && attempt === 0)
          await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (generation === this.generation)
        this.message = revoked
          ? "Disconnected from ChatGPT."
          : "Disconnected locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.";
      return this.status();
    } finally {
      this.disconnecting = false;
    }
  }
  reset() {
    this.close();
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    this.record = {};
    this.message =
      "Local ChatGPT credentials deleted. You can manage remote access in ChatGPT Settings.";
  }
}
module.exports = {
  ChatGPTAuth,
  createTransaction,
  authorizationUrl,
  consumeCallback,
  verifyIdentity,
  ENDPOINTS,
};
