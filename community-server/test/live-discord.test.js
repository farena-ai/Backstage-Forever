"use strict";
// Discord for guilds against a stand-in for discord.com, with real Ed25519 keys made here:
// everything off without the four settings, the signature check, the connect flow, the event
// message edited in place, buttons, the member link, text that cannot ping or format, rate
// limits, permission problems, reminders and the command registration.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const D = require("../lib/discord");
const { loadConfig } = require("../lib/config");
const { SALT, T0, uuid, tempDb, boot, MANY_LIVE, who, call, answer, makeGuild, joinGuild, eventBody, signupBody, liveSession, openStream, settle } = require("./helpers");

const cp = String.fromCodePoint, ZWSP = cp(0x200b);
const APP = "123456789012345678", TOKEN = `${"T".repeat(24)}.${"a".repeat(6)}.${"b".repeat(38)}`, SECRET = "s".repeat(32);
const DGUILD = "100000000000000001", CHANNEL = "200000000000000001", CHANNEL2 = "200000000000000002";
const api = async (s, method, p, body, headers) => answer(await call(s.base, method, p, body, headers));
const HOUR = 3_600_000;

function keys() {
  const k = crypto.generateKeyPairSync("ed25519");
  return { ...k, hex: k.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") };
}
function discordConfig(k) {
  return D.parseDiscordConfig({ BF_DISCORD_APP_ID: APP, BF_DISCORD_PUBLIC_KEY: k.hex, BF_DISCORD_BOT_TOKEN: TOKEN, BF_DISCORD_CLIENT_SECRET: SECRET }).discord;
}

// A stand-in for discord.com/api/v10. `fake.answer(call)` may return { status, headers, body } to override one answer.
async function fakeDiscord() {
  const fake = { calls: [], asked: [], next: 900000000000000000n, inFlight: 0, maxInFlight: 0, answer: () => null, guild: { id: DGUILD, name: "Night Watch HQ", system_channel_id: CHANNEL }, channelNames: { [CHANNEL]: "raids", [CHANNEL2]: "events" } };
  const id = () => String(fake.next++);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      fake.inFlight += 1; fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
      const raw = Buffer.concat(chunks).toString("utf8"), route = req.url.replace(/^\/api\/v10/, "");
      let body = null;
      try { body = /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw ? Object.fromEntries(new URLSearchParams(raw)) : null; } catch { body = raw; }
      const c = { method: req.method, path: route, url: req.url, headers: req.headers, body };
      fake.calls.push(c);
      await new Promise((r) => setTimeout(r, 3)); // long enough for a second call to overlap, if the client let it
      let a = fake.answer(c);
      if (!a) {
        if (route === "/oauth2/token") a = { status: 200, body: { access_token: "user-token", token_type: "Bearer", guild: fake.guild } };
        else if (req.method === "GET" && /^\/channels\/\d+$/.test(route)) a = { status: 200, body: { id: route.split("/")[2], type: 0, name: fake.channelNames[route.split("/")[2]] || "general" } };
        else if (req.method === "POST" && /\/messages$/.test(route)) a = { status: 200, body: { id: id() } };
        else if (req.method === "PATCH" && /\/messages\/\d+$/.test(route)) a = { status: 200, body: { id: route.split("/").pop() } };
        else if (req.method === "POST" && /\/scheduled-events$/.test(route)) a = { status: 200, body: { id: id() } };
        else if (req.method === "PATCH" && /\/scheduled-events\/\d+$/.test(route)) a = { status: 200, body: { id: route.split("/").pop() } };
        else if (req.method === "DELETE") a = { status: 204 };
        else if (req.method === "PUT" && /\/commands$/.test(route)) a = { status: 200, body: body.map((x, i) => ({ ...x, id: String(700000000000000000n + BigInt(i)) })) };
        else a = { status: 404, body: { code: 0, message: "404: Not Found" } };
      }
      fake.inFlight -= 1;
      res.writeHead(a.status, { "Content-Type": "application/json", ...(a.headers || {}) });
      res.end(a.body === undefined ? "" : JSON.stringify(a.body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // What production does, except that the socket goes to the stand-in. The options the client asked for are kept.
  fake.request = (options, cb) => { fake.asked.push({ ...options }); return http.request({ ...options, protocol: "http:", hostname: "127.0.0.1", port: server.address().port }, cb); };
  fake.close = () => new Promise((r) => { server.close(r); server.closeAllConnections(); });
  fake.of = (method, re) => fake.calls.filter(c => c.method === method && re.test(c.path));
  fake.messages = () => fake.of("POST", /\/messages$/);
  fake.edits = () => fake.of("PATCH", /\/messages\/\d+$/);
  return fake;
}

async function setup(t, overrides = {}) {
  const k = keys(), fake = await fakeDiscord(), sleeps = [];
  const s = await boot({ ...MANY_LIVE, discord: discordConfig(k), ...overrides }, { discordRequest: fake.request, discordSleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
  t.after(async () => { await s.close(); await fake.close(); });
  const idle = () => s.live.client.idle();
  return { s, k, fake, sleeps, idle };
}

// Runs the whole connect flow for one guild, as a leader's browser would.
async function connect(x, g, { expect = 200 } = {}) {
  const start = await api(x.s, "POST", `/v1/guilds/${g.guildId}/discord/start`, { schema: 1 }, g.H);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.url).searchParams.get("state");
  const back = await call(x.s.base, "GET", `/discord/callback?code=abcdef1234567890&state=${encodeURIComponent(state)}&guild_id=999&permissions=8`);
  assert.equal(back.status, expect);
  await x.idle();
  return { start, state, page: await back.text(), headers: back.headers };
}

function interact(x, payload, { ts = Math.floor(x.s.clock.t / 1000), key = x.k.privateKey, send, headers } = {}) {
  const body = JSON.stringify(payload);
  const sig = crypto.sign(null, Buffer.from(String(ts) + body), key).toString("hex");
  return fetch(`${x.s.base}/discord/interactions`, { method: "POST", headers: headers || { "Content-Type": "application/json", "X-Signature-Ed25519": sig, "X-Signature-Timestamp": String(ts) }, body: send ?? body });
}
let serial = 300000000000000000n;
const member = (id, name, permissions = "0") => ({ user: { id, username: name.toLowerCase().replace(/\W/g, ""), global_name: name }, nick: null, permissions });
const button = (user, eventId, answerValue, extra = {}) => ({ id: String(serial++), application_id: APP, type: 3, guild_id: DGUILD, channel_id: CHANNEL, member: user, data: { component_type: 2, custom_id: `bf:s:${eventId}:${answerValue}` }, message: { id: "555000000000000001" }, ...extra });
const command = (user, sub, options, extra = {}) => ({ id: String(serial++), application_id: APP, type: 2, guild_id: DGUILD, channel_id: CHANNEL, member: user, data: { name: "backstage", type: 1, options: [{ type: 1, name: sub, ...(options ? { options } : {}) }] }, ...extra });
const said = async (res) => { assert.equal(res.status, 200); return res.json(); };
const codeIn = (text) => /BFL-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}/.exec(text)[0];

test("off: without the four settings every Discord route answers 503 discord_off and nothing is called", async (t) => {
  const fake = await fakeDiscord();
  const s = await boot(MANY_LIVE, { discordRequest: fake.request });
  t.after(async () => { await s.close(); await fake.close(); });
  const g = await makeGuild(s), base = `/v1/guilds/${g.guildId}/discord`;
  const routes = [["POST", `${base}/start`, { schema: 1 }], ["POST", `${base}/test`, { schema: 1 }], ["DELETE", base], ["POST", `${base}/link`, { schema: 1, code: "BFL-2222-2222" }], ["DELETE", `${base}/link`],
    ["GET", "/discord/callback?code=x&state=y"], ["GET", "/discord/link?code=BFL-2222-2222"], ["POST", "/discord/interactions", { type: 1 }]];
  for (const [method, p, body] of routes) {
    for (const headers of [g.H, {}]) { // with a member token and without: off comes first
      const r = await api(s, method, p, body, headers);
      assert.deepEqual([r.status, r.body], [503, { ok: false, error: "discord_off" }], `${method} ${p}`);
    }
  }
  assert.deepEqual((await api(s, "GET", "/v1/health")).body.discord, false);
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord, { state: "none", guildName: null, channel: null, problem: null });
  // Events and summaries work without Discord; nothing goes out.
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H)).body.accepted, true);
  s.live.tick(Date.parse("2026-11-27T18:50:00Z"));
  await settle();
  assert.equal(fake.calls.length, 0);
  assert.equal(s.live.client, null);

  // The settings: all four or nothing; a malformed one is an error at start, never a half-working bot.
  const k = keys(), full = { BF_DISCORD_APP_ID: APP, BF_DISCORD_PUBLIC_KEY: k.hex, BF_DISCORD_BOT_TOKEN: TOKEN, BF_DISCORD_CLIENT_SECRET: SECRET };
  assert.equal(loadConfig({}, { salt: SALT }).discord, null);
  assert.equal(loadConfig(full, { salt: SALT }).discord.appId, APP);
  for (const missing of Object.keys(full)) {
    const c = loadConfig({ ...full, [missing]: "" }, { salt: SALT });
    assert.deepEqual([c.discord, c.discordPartial], [null, true], `without ${missing}`);
  }
  for (const [name, bad] of [["BF_DISCORD_APP_ID", "my-app"], ["BF_DISCORD_PUBLIC_KEY", "abc"], ["BF_DISCORD_BOT_TOKEN", "has spaces in it"], ["BF_DISCORD_CLIENT_SECRET", "short"]])
    assert.throws(() => loadConfig({ ...full, [name]: bad }, { salt: SALT }), new RegExp(name));
  // The command-line tool says plainly that Discord is off, and contacts nobody.
  const db = tempDb(); t.after(() => db.cleanup());
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "admin.js"), "discord-register-commands"], { encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BF_COMMUNITY_SALT: SALT, BF_COMMUNITY_DB: db.file, BF_COMMUNITY_ENV_FILE: path.join(db.dir, "none.env"), BF_DESK_BACKUP_DIR: "off" } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Discord is off: set BF_DISCORD_APP_ID, BF_DISCORD_PUBLIC_KEY, BF_DISCORD_BOT_TOKEN and BF_DISCORD_CLIENT_SECRET/);
});

test("interactions: only what Discord signed, with a fresh timestamp, is ever looked at", async (t) => {
  const x = await setup(t);
  const ping = { id: String(serial++), type: 1 };
  assert.deepEqual(await said(await interact(x, ping)), { type: 1 });
  const refused = async (res, label) => { assert.equal(res.status, 401, label); assert.deepEqual(await res.json(), { ok: false, error: "invalid_signature" }, label); };
  const ts = String(Math.floor(x.s.clock.t / 1000)), body = JSON.stringify(ping);
  const goodSig = crypto.sign(null, Buffer.from(ts + body), x.k.privateKey).toString("hex");
  const h = (sig, stamp = ts) => ({ "Content-Type": "application/json", ...(sig === null ? {} : { "X-Signature-Ed25519": sig }), ...(stamp === null ? {} : { "X-Signature-Timestamp": stamp }) });
  await refused(await interact(x, ping, { key: keys().privateKey }), "signed with another key");
  await refused(await interact(x, ping, { send: JSON.stringify({ ...ping, type: 2 }) }), "the body was changed after signing");
  await refused(await interact(x, ping, { headers: h(null) }), "no signature");
  await refused(await interact(x, ping, { headers: h(goodSig, null) }), "no timestamp");
  await refused(await interact(x, ping, { headers: h("zz".repeat(64)) }), "a signature that is not hex");
  await refused(await interact(x, ping, { headers: h(goodSig.slice(2)) }), "a short signature");
  await refused(await interact(x, ping, { headers: h(goodSig, String(Number(ts) + 1)) }), "the timestamp was changed after signing");
  await refused(await interact(x, ping, { headers: h(goodSig, "soon") }), "a timestamp that is not a number");
  // A correctly signed request that is replayed later, or dated ahead, is refused: the window is five minutes.
  await refused(await interact(x, ping, { ts: Math.floor(x.s.clock.t / 1000) - 301 }), "an old request replayed");
  await refused(await interact(x, ping, { ts: Math.floor(x.s.clock.t / 1000) + 301 }), "a request from the future");
  assert.equal((await interact(x, ping, { ts: Math.floor(x.s.clock.t / 1000) - 299 })).status, 200);
  const captured = { ts: Math.floor(x.s.clock.t / 1000), payload: ping };
  x.s.clock.t += 6 * 60_000;
  await refused(await interact(x, captured.payload, { ts: captured.ts }), "the very same signed bytes, six minutes later");
  // Nothing is parsed before the signature holds: garbage with a bad signature is a 401, not a parse error.
  await refused(await interact(x, ping, { send: "{not json", headers: h(goodSig) }), "garbage");
  const signedGarbage = crypto.sign(null, Buffer.from(`${Math.floor(x.s.clock.t / 1000)}{not json`), x.k.privateKey).toString("hex");
  assert.equal((await interact(x, ping, { send: "{not json", headers: h(signedGarbage, String(Math.floor(x.s.clock.t / 1000))) })).status, 400, "signed garbage is plain invalid JSON");
  assert.equal((await interact(x, { id: String(serial++), type: 9 })).status, 400);
  assert.equal((await interact(x, [1])).status, 400);
  assert.equal((await fetch(`${x.s.base}/discord/interactions`, { method: "POST", headers: h(goodSig), body: "x".repeat(70_000) })).status, 413);
  assert.equal((await call(x.s.base, "GET", "/discord/interactions")).status, 405);
  // A command inside the window that is delivered twice is acted on once.
  const g = await makeGuild(x.s);
  await connect(x, g);
  const twice = command(member("400000000000000001", "Dora"), "link");
  const first = await said(await interact(x, twice)), second = await said(await interact(x, twice));
  assert.match(first.data.content, /BFL-/);
  assert.equal(second.data.content, "That was already handled.");
  assert.equal(x.s.store.db.prepare("SELECT COUNT(*) AS c FROM discord_codes").get().c, 1);
  // The webhook is not held to the per-address limit (Discord sends everybody's presses from a few addresses).
  assert.ok(!x.s.logs.join("\n").includes(goodSig));
  assert.ok(x.s.logs.some(l => / POST \/discord\/interactions 401 /.test(l)));
});

test("connect: the add-bot address, the signed state, the callback page, and what G3 then shows", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5), bea = await joinGuild(s, g, "Bea", 1);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H); // made before Discord was connected
  assert.equal(fake.calls.length, 0);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/start`, { schema: 1 }, cy.H)).status, 403, "a member cannot connect Discord");
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/test`, { schema: 1 }, g.H)).body.error, "not_connected");

  const start = await api(s, "POST", `/v1/guilds/${g.guildId}/discord/start`, undefined, bea.H);
  const url = new URL(start.body.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), APP);
  assert.equal(url.searchParams.get("scope"), "bot applications.commands");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://desk.test/discord/callback");
  const perms = BigInt(url.searchParams.get("permissions"));
  for (const bit of [10n, 11n, 14n, 33n]) assert.ok(perms & (1n << bit), `permission bit ${bit}`);
  assert.equal(perms & (1n << 3n), 0n, "never Administrator");
  assert.equal(perms & (1n << 17n), 0n, "never Mention Everyone");
  const state = url.searchParams.get("state");
  assert.ok(!start.body.url.includes(SECRET) && !start.body.url.includes(TOKEN) && !start.body.url.includes(g.token));
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord.state, "pending");

  // A state that was not signed here, was changed, or belongs to nobody: a plain page, nothing connected.
  const page = async (q) => { const r = await call(s.base, "GET", `/discord/callback?${q}`); return { status: r.status, text: await r.text(), csp: r.headers.get("content-security-policy"), type: r.headers.get("content-type") }; };
  const forged = `${Buffer.from(JSON.stringify({ g: g.guildId, n: "x", t: s.clock.t })).toString("base64url")}.${"A".repeat(43)}`;
  for (const bad of ["code=abcdef1234567890", `code=abcdef1234567890&state=${forged}`, `code=abcdef1234567890&state=${state.slice(0, -2)}xx`, "code=abcdef1234567890&state=<script>"]) {
    const p = await page(bad);
    assert.equal(p.status, 400, bad);
    assert.match(p.text, /This link does not work any more/);
    assert.ok(!p.text.includes("<script>alert") && !/<script/i.test(p.text));
  }
  assert.equal(fake.calls.length, 0, "Discord is not asked about a state that is not ours");

  const ok = await page(`code=abcdef1234567890&state=${encodeURIComponent(state)}&guild_id=31337&permissions=8`);
  await x.idle();
  assert.equal(ok.status, 200);
  assert.match(ok.text, /<h1>Discord is connected<\/h1><p>You can close this tab and go back to Backstage Forever\.<\/p>/);
  assert.match(ok.type, /^text\/html; charset=utf-8$/);
  assert.match(ok.csp, /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
  const exchange = fake.calls[0];
  assert.deepEqual([exchange.method, exchange.url], ["POST", "/api/v10/oauth2/token"]);
  assert.deepEqual(exchange.body, { client_id: APP, client_secret: SECRET, grant_type: "authorization_code", code: "abcdef1234567890", redirect_uri: "https://desk.test/discord/callback" });
  assert.equal(exchange.headers.authorization, undefined, "the bot token is not sent with the code exchange");
  const view = await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy.H);
  assert.deepEqual(view.body.discord, { state: "connected", guildName: "Night Watch HQ", channel: "#raids", problem: null });
  const row = s.store.db.prepare("SELECT discord_guild, discord_channel FROM guilds WHERE id = ?").get(g.guildId);
  assert.deepEqual({ ...row }, { discord_guild: DGUILD, discord_channel: CHANNEL }, "the server comes from Discord's answer, never from the address");
  assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM guilds").all()).includes("user-token"), "the user's access token is not kept");
  // The event that already existed is posted now, with its Discord scheduled event.
  assert.equal(fake.messages().length, 1);
  assert.equal(fake.of("POST", /scheduled-events$/).length, 1);
  // The state works once.
  assert.equal((await page(`code=abcdef1234567890&state=${encodeURIComponent(state)}`)).status, 400);
  // Every outbound call went to discord.com over HTTPS, and bot calls carry the bot token.
  for (const o of fake.asked) assert.deepEqual([o.protocol, o.hostname, o.port, o.path.startsWith("/api/v10/")], ["https:", "discord.com", 443, true]);
  assert.ok(fake.calls.slice(1).every(c => c.headers.authorization === `Bot ${TOKEN}`));
  assert.ok(!s.logs.join("\n").includes(TOKEN) && !s.logs.join("\n").includes(SECRET) && !s.logs.join("\n").includes(state));

  // The same Discord server cannot serve a second guild.
  const g2 = await makeGuild(s, { guildName: "Second" });
  const second = await connect(x, g2, { expect: 409 });
  assert.match(second.page, /already connected/);
  assert.equal((await api(s, "GET", `/v1/guilds/${g2.guildId}`, undefined, g2.H)).body.discord.state, "none");
  // Saying no on Discord's page, and a refused code, leave nothing half-connected.
  const s3 = await api(s, "POST", `/v1/guilds/${g2.guildId}/discord/start`, { schema: 1 }, g2.H);
  const denied = await page(`error=access_denied&state=${encodeURIComponent(new URL(s3.body.url).searchParams.get("state"))}`);
  assert.match(denied.text, /Nothing was connected/);
  assert.equal((await api(s, "GET", `/v1/guilds/${g2.guildId}`, undefined, g2.H)).body.discord.state, "none");
  fake.guild = { id: "100000000000000002", name: "Other", system_channel_id: null };
  fake.answer = (c) => (c.path === "/oauth2/token" ? { status: 400, body: { error: "invalid_grant" } } : null);
  assert.match((await connect(x, g2, { expect: 502 })).page, /Discord did not confirm the connection/);
  // A Discord server without a system channel: connected, with a plain note about what to do.
  fake.answer = () => null;
  await connect(x, g2);
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${g2.guildId}`, undefined, g2.H)).body.discord, { state: "problem", guildName: "Other", channel: null, problem: "No channel is chosen yet. Run /backstage channel in the Discord channel you want." });
  // An unfinished connection does not stay "pending" for ever.
  const g3 = await makeGuild(s, { guildName: "Third" });
  await api(s, "POST", `/v1/guilds/${g3.guildId}/discord/start`, { schema: 1 }, g3.H);
  s.live.tick(s.clock.t + 16 * 60_000 + HOUR);
  assert.equal(s.store.db.prepare("SELECT discord_state FROM guilds WHERE id = ?").get(g3.guildId).discord_state, "none");
});

test("events on Discord: one message per event, edited in place and in order; a scheduled event that follows it", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await connect(x, g);
  fake.calls.length = 0;
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await x.idle();
  const post = fake.messages()[0];
  assert.equal(post.path, `/channels/${CHANNEL}/messages`);
  assert.deepEqual(post.body.allowed_mentions, { parse: [] });
  const unix = Date.parse("2026-11-27T19:00:00Z") / 1000;
  assert.equal(post.body.content.split("\n")[0], "**Molten Core**");
  assert.ok(post.body.content.includes(`<t:${unix}:F>`) && post.body.content.includes("**Tank** (0/2): nobody yet") && post.body.content.includes("**Damage** (0/30)"));
  assert.deepEqual(post.body.components[0].components.map(b => [b.label, b.custom_id]), [["Tank", "bf:s:raid1:tank"], ["Healer", "bf:s:raid1:healer"], ["Damage", "bf:s:raid1:damage"], ["Maybe", "bf:s:raid1:maybe"], ["No", "bf:s:raid1:no"]]);
  assert.equal(post.body.embeds, undefined);
  const made = fake.of("POST", /scheduled-events$/)[0];
  assert.equal(made.path, `/guilds/${DGUILD}/scheduled-events`);
  assert.deepEqual([made.body.name, made.body.entity_type, made.body.privacy_level, made.body.scheduled_start_time, made.body.scheduled_end_time], ["Molten Core", 3, 2, "2026-11-27T19:00:00Z", "2026-11-27T22:00:00Z"]);

  // Sign-ups edit the same message; many quick changes arrive one at a time and the last edit is the last state.
  const answers = ["tank", "healer", "damage", "maybe", "no", "tank"];
  await Promise.all(answers.map((a, i) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", a, i + 1), cy.H)));
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Abel`, signupBody("Abel", "healer", 1), g.H);
  await x.idle();
  assert.equal(fake.messages().length, 1, "never a second message for the same event");
  const edits = fake.edits();
  assert.ok(edits.length >= 1 && edits.length <= 7);
  assert.ok(edits.every(e => e.path === `/channels/${CHANNEL}/messages/${s.store.db.prepare("SELECT discord_message FROM guild_events").get().discord_message}`));
  assert.equal(fake.maxInFlight, 1, "calls for one Discord server never overlap");
  const last = edits[edits.length - 1].body.content;
  assert.ok(last.includes("**Tank** (1/2): Cy") && last.includes("**Healer** (1/8): Abel"), last);
  assert.equal(fake.of("PATCH", /scheduled-events/).length, 0, "a sign-up does not touch the scheduled event");

  // An edit of the event changes the message and the scheduled event; cancelling strikes it out, removes the buttons and deletes the scheduled event.
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: 2, title: "Molten Core late", at: "2026-11-27T20:00:00Z" }), g.H);
  await x.idle();
  assert.equal(fake.of("PATCH", /scheduled-events\/\d+$/).length, 1);
  assert.equal(fake.edits().pop().body.content.split("\n")[0], "**Molten Core late**");
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: 3, title: "Molten Core late", at: "2026-11-27T20:00:00Z", cancelled: true }), g.H);
  await x.idle();
  const off = fake.edits().pop().body;
  assert.equal(off.content.split("\n")[0], "~~**Molten Core late**~~ (called off)");
  assert.deepEqual(off.components, []);
  assert.equal(fake.of("DELETE", /scheduled-events\/\d+$/).length, 1);
  assert.equal(fake.messages().length, 1);

  // Somebody deleted the message in Discord: the next change posts it again.
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2`, eventBody("raid2", "Abel", { title: "Onyxia" }), g.H);
  await x.idle();
  fake.answer = (c) => (c.method === "PATCH" && /\/messages\//.test(c.path) ? { status: 404, body: { code: 10008, message: "Unknown Message" } } : null);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2/signups/Cy`, signupBody("Cy", "tank"), cy.H);
  await x.idle();
  assert.equal(fake.messages().length, 3);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord.state, "connected");
});

test("buttons and the member link: a linked member signs up from Discord; anybody else is asked to link first", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5), dan = await joinGuild(s, g, "Dan", 5);
  await connect(x, g);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await x.idle();
  const stream = await openStream(s.base, await liveSession(s, g.installId, [{ t: "guild", guildId: g.guildId, member: g.token }]));
  t.after(() => stream.close());
  await stream.until(st => st.events.length === 1);
  const dora = member("400000000000000001", "Dora the Tank"), eve = member("400000000000000002", "Eve");

  // Not linked: an answer only they can see, with a one-time code. Nothing is signed up.
  const ask = await said(await interact(x, button(dora, "raid1", "tank")));
  assert.equal(ask.type, 4);
  assert.equal(ask.data.flags, 64, "ephemeral");
  assert.deepEqual(ask.data.allowed_mentions, { parse: [] });
  assert.match(ask.data.content, /^Link your character first\./);
  const code = codeIn(ask.data.content);
  assert.ok(ask.data.content.includes(`https://desk.test/discord/link?code=${code}`));
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM guild_signups").get().c, 0);
  assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM discord_codes").all()).includes(code), "the code is stored hashed");
  const landing = await call(s.base, "GET", `/discord/link?code=${code.toLowerCase()}`);
  assert.equal(landing.status, 200);
  assert.ok((await landing.text()).includes(`<code>${code}</code>`));
  const junk = await call(s.base, "GET", "/discord/link?code=%3Cscript%3Ealert(1)%3C/script%3E");
  assert.equal(junk.status, 400);
  assert.ok(!(await junk.text()).includes("alert(1)"));

  // D3: the desktop ties the member to that Discord user. The code works once, for that guild only.
  const other = await makeGuild(s, { guildName: "Other", leader: "Zed" });
  assert.equal((await api(s, "POST", `/v1/guilds/${other.guildId}/discord/link`, { schema: 1, code }, other.H)).status, 404, "another guild cannot use it");
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code: "BFL-2222-2222" }, cy.H)).status, 404);
  const linked = await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code }, cy.H);
  assert.deepEqual([linked.status, linked.body], [200, { ok: true, discord: "Dora the Tank" }]);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code }, dan.H)).status, 404, "a code works once");
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code }, {})).status, 404);
  const members = (await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, dan.H)).body.members;
  assert.deepEqual(members.map(m => [m.name, m.discord]), [["Abel", null], ["Cy", "Dora the Tank"], ["Dan", null]]);
  assert.deepEqual({ ...s.store.db.prepare("SELECT discord_user, discord_name FROM guild_members WHERE name = 'Cy'").get() }, { discord_user: "400000000000000001", discord_name: "Dora the Tank" }, "only the id and the display name");

  // Linked: the press is the member's own sign-up, the message is redrawn in the answer, the guild hears it live.
  const pressed = await said(await interact(x, button(dora, "raid1", "tank")));
  assert.equal(pressed.type, 7, "the pressed message is updated in place");
  assert.ok(pressed.data.content.includes("**Tank** (1/2): Cy"));
  assert.deepEqual(pressed.data.allowed_mentions, { parse: [] });
  assert.equal(pressed.data.components[0].components.length, 5);
  await stream.until(st => st.events.some(e => e.event === "guild.signup"));
  assert.deepEqual(stream.events.find(e => e.event === "guild.signup").data, { guildId: g.guildId, eventId: "raid1", signup: { who: who("Cy"), answer: "tank", version: 1, via: "discord" } });
  const again = await said(await interact(x, button(dora, "raid1", "maybe")));
  assert.ok(again.data.content.includes("**Maybe** (1): Cy") && again.data.content.includes("**Tank** (0/2): nobody yet"));
  assert.deepEqual({ ...s.store.db.prepare("SELECT answer, version, via, relayed FROM guild_signups").get() }, { answer: "maybe", version: 2, via: "discord", relayed: 0 });
  // The game side can still overrule it with a newer version, and the Discord message follows.
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "healer", 3, "game"), cy.H)).body.accepted, true);
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "no", 2, "game"), cy.H)).body.accepted, false);

  // Refusals that only the presser sees.
  const reply = async (payload) => { const r = await said(await interact(x, payload)); assert.equal(r.type, 4); assert.equal(r.data.flags, 64); return r.data.content; };
  assert.match(await reply(button(eve, "raid1", "tank")), /^Link your character first\./);
  assert.equal(await reply(button(dora, "nosuch", "tank")), "That event is no longer on the list.");
  assert.equal(await reply(button(dora, "raid1", "bench")), "That button is not known.");
  assert.equal(await reply({ ...button(dora, "raid1", "tank"), data: { custom_id: "bf:s:raid1:tank:extra" } }), "That button is not known.");
  assert.match(await reply(button(dora, "raid1", "tank", { guild_id: "100000000000000099" })), /not connected to a guild/);
  assert.match(await reply({ ...button(dora, "raid1", "tank"), guild_id: undefined, member: undefined, user: dora.user }), /inside your guild's Discord server/);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: 2, cancelled: true }), g.H);
  assert.match(await reply(button(dora, "raid1", "tank")), /That event is closed/);

  // /backstage link gives the same kind of code; asking again replaces the earlier one.
  const c1 = codeIn(await reply(command(eve, "link"))), c2 = codeIn(await reply(command(eve, "link")));
  assert.notEqual(c1, c2);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code: c1 }, dan.H)).status, 404);
  // A code runs out after 15 minutes.
  s.clock.t += 15 * 60_000;
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code: c2 }, dan.H)).status, 404);
  const c3 = codeIn(await reply(command(dora, "link")));
  // One Discord user answers for one character: linking Dan to Dora's account takes it from Cy.
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code: c3 }, dan.H)).status, 200);
  assert.deepEqual(s.store.db.prepare("SELECT name FROM guild_members WHERE discord_user IS NOT NULL").all().map(r => r.name), ["Dan"]);
  // DELETE unties; leaving the guild or disconnecting Discord removes it too.
  assert.deepEqual((await api(s, "DELETE", `/v1/guilds/${g.guildId}/discord/link`, undefined, dan.H)).body, { ok: true });
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM guild_members WHERE discord_user IS NOT NULL OR discord_name IS NOT NULL").get().c, 0);
  await x.idle();
  assert.ok(fake.maxInFlight <= 1);
});

test("text sent to Discord cannot ping, mention or format, whatever players type", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await connect(x, g);
  const title = "@everyone @here <@&1234> **b** _i_ `c`", note = "~~s~~ ||spoiler|| > quote [x](y) # h <#42> <@99> :tada: -list".replace(/\|/g, "!");
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { title, note }), g.H)).body.accepted, true);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "tank"), cy.H);
  await x.idle();
  const bodies = [...fake.messages(), ...fake.edits()].map(c => c.body);
  assert.ok(bodies.length >= 2);
  for (const b of bodies) {
    assert.deepEqual(b.allowed_mentions, { parse: [] }, "always");
    const [first, , third] = b.content.split("\n");
    // Take away what the server itself wrote; what is left is the player's text, and none of it is live markup.
    const player = `${first.replace(/^\*\*|\*\*$/g, "")}\n${third}`;
    assert.ok(!/(^|[^\\])@(everyone|here)/.test(player), player);
    assert.ok(player.includes(`\\@${ZWSP}everyone`) && player.includes(`\\@${ZWSP}here`), "the @ is escaped and split from the word");
    assert.ok(!/(^|[^\\])[*_~`<>[\]()#:]/.test(player), `an unescaped formatting character in: ${player}`);
    assert.ok(!/<@&?\d+>|<#\d+>/.test(player), "no mention syntax survives");
  }
  // The scheduled event's description is escaped the same way; its name is plain text in Discord.
  const ev = fake.of("POST", /scheduled-events$/)[0].body;
  assert.ok(!/(^|[^\\])[*_~`<>[\]()#:@]/.test(ev.description));
  // The escaping itself: every character Discord gives a meaning to, hidden characters, and length.
  assert.equal(D.escapeText("a*b_c~d`e|f>g[h](i)#j@k:l<m-n"), `a\\*b\\_c\\~d\\\`e\\|f\\>g\\[h\\]\\(i\\)\\#j\\@${ZWSP}k\\:l\\<m\\-n`);
  assert.equal(D.escapeText(`x${cp(0x202e)}y${cp(0x200b)}z\n\tw`), "xyz w");
  assert.equal([...D.escapeText("a".repeat(500), 40)].length, 40);
  assert.equal(D.escapeText("\\@everyone"), `\\\\\\@${ZWSP}everyone`, "a backslash typed by the player does not un-escape what follows");
  // A hostile Discord display name is only stored (cleaned) and shown in the app; it never goes back out to Discord.
  const evil = member("400000000000000009", `@everyone${cp(0x202e)} <@&1> **x**`);
  const code = codeIn((await said(await interact(x, command(evil, "link")))).data.content);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/link`, { schema: 1, code }, cy.H)).body.discord, "@everyone <@&1> **x**");
  fake.calls.length = 0;
  const pressed = await said(await interact(x, button(evil, "raid1", "healer")));
  assert.ok(!pressed.data.content.includes("@everyone <@&1>"));
  await x.idle();
  // The reminder names linked members who are coming, and only through the explicit user list.
  s.clock.t = Date.parse("2026-11-27T18:50:00Z"); s.live.tick();
  await x.idle();
  const reminder = fake.messages().pop().body;
  assert.deepEqual(reminder.allowed_mentions, { parse: [], users: ["400000000000000009"] });
  assert.ok(reminder.content.includes("<@400000000000000009>") && !/(^|[^\\])@(everyone|here)/.test(reminder.content));
  assert.ok(reminder.content.includes(`\\@${ZWSP}everyone`), "the title in the reminder is escaped too");
});

test("rate limits: Retry-After is waited out and the call is tried again; a global limit holds everything back", async (t) => {
  const x = await setup(t), { s, fake, sleeps } = x;
  const g = await makeGuild(s);
  await connect(x, g);
  fake.calls.length = 0; sleeps.length = 0;
  let limited = 2;
  fake.answer = (c) => (c.method === "POST" && /\/messages$/.test(c.path) && limited-- > 0 ? { status: 429, headers: { "Retry-After": "2" }, body: { message: "You are being rate limited.", retry_after: 1.5, global: false } } : null);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await x.idle();
  assert.equal(fake.messages().length, 3, "two refusals, then it went through");
  assert.deepEqual(sleeps.slice(0, 2), [2000, 2000], "waited as long as Discord said, both times");
  assert.equal(s.store.db.prepare("SELECT discord_message IS NOT NULL AS posted FROM guild_events").get().posted, 1);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord.state, "connected", "a rate limit that passes is not a problem");
  assert.equal(s.live.client.counters.rateLimited, 2);

  // Only the body says how long (no header); a global limit also delays the next call.
  sleeps.length = 0; fake.calls.length = 0;
  let once = true;
  fake.answer = (c) => (c.method === "PATCH" && once ? ((once = false), { status: 429, body: { retry_after: 0.25, global: true } }) : null);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: 2, title: "Changed" }), g.H);
  await x.idle();
  assert.equal(sleeps[0], 250);
  assert.ok(sleeps.length >= 2, "the next call also waits for the global limit (the test's clock does not move)");
  assert.equal(fake.edits().length, 2);

  // The bucket is used up (Remaining: 0): the next call of that server waits for the reset.
  sleeps.length = 0; fake.calls.length = 0; s.live.client.globalUntil = 0;
  fake.answer = (c) => (c.method === "PATCH" && /\/messages\//.test(c.path) ? { status: 200, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "1.2" }, body: { id: "1" } } : null);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: 3, title: "Again" }), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid9`, eventBody("raid9", "Abel", { title: "Another" }), g.H);
  await x.idle();
  assert.ok(sleeps.includes(1200), JSON.stringify(sleeps));

  // Discord keeps saying no: the call gives up after four tries and the guild sees a plain reason.
  sleeps.length = 0; fake.calls.length = 0;
  fake.answer = (c) => (/\/messages/.test(c.path) ? { status: 429, headers: { "Retry-After": "600" }, body: {} } : null);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2`, eventBody("raid2", "Abel", { title: "Onyxia" }), g.H);
  await x.idle();
  assert.equal(fake.messages().length, 4);
  assert.deepEqual(sleeps, [30000, 30000, 30000], "a long Retry-After is capped at 30 seconds per wait");
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord, { state: "problem", guildName: "Night Watch HQ", channel: "#raids", problem: "Discord asked the bot to slow down. It will be tried again." });
});

test("problems: a missing permission, a deleted channel, a kicked bot and a timeout become a plain reason and a guild.discord event", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await connect(x, g);
  const stream = await openStream(s.base, await liveSession(s, cy.installId, [{ t: "guild", guildId: g.guildId, member: cy.token }]));
  t.after(() => stream.close());
  await stream.until(st => st.events.length === 1);
  const discord = async () => (await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy.H)).body.discord;
  const states = () => stream.events.filter(e => e.event === "guild.discord").map(e => e.data.state);
  let n = 0;
  const change = async () => { n += 1; await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: n, title: `Raid ${n}` }), g.H); await x.idle(); };

  fake.answer = (c) => (/\/messages/.test(c.path) ? { status: 403, body: { code: 50013, message: "Missing Permissions" } } : null);
  await change();
  assert.deepEqual(await discord(), { state: "problem", guildName: "Night Watch HQ", channel: "#raids", problem: "The bot cannot post in #raids: missing permission Send Messages" });
  await stream.until(() => states().length === 1);
  assert.deepEqual(stream.events.find(e => e.event === "guild.discord").data, { guildId: g.guildId, state: "problem" });
  await change();
  await settle(40);
  assert.deepEqual(states(), ["problem"], "the same problem is announced once, not on every try");
  // The owner fixes the permission in Discord: the next change goes through and the state clears by itself.
  fake.answer = () => null;
  await change();
  assert.deepEqual(await discord(), { state: "connected", guildName: "Night Watch HQ", channel: "#raids", problem: null });
  await stream.until(() => states().length === 2);
  assert.deepEqual(states(), ["problem", "connected"]);

  const cases = [
    [(c) => (/\/messages/.test(c.path) ? { status: 403, body: { code: 50001, message: "Missing Access" } } : null), "The bot cannot see #raids: missing permission View Channel"],
    [(c) => (/\/messages/.test(c.path) ? { status: 404, body: { code: 10003, message: "Unknown Channel" } } : null), "The channel #raids no longer exists. Run /backstage channel in the channel you want."],
    [(c) => (/scheduled-events/.test(c.path) ? { status: 403, body: { code: 50013, message: "Missing Permissions" } } : null), "The bot cannot make Discord events: missing permission Manage Events"],
    [() => ({ status: 404, body: { code: 10004, message: "Unknown Guild" } }), "The bot is no longer in the Discord server. Connect Discord again from the app."],
    [() => ({ status: 401, body: { code: 0, message: "401: Unauthorized" } }), "Discord refused the bot's sign-in. The service owner has to check the Discord settings."],
    [() => ({ status: 503, body: {} }), "Discord has a problem right now. It will be tried again."],
    [() => ({ status: 200, body: { no: "id" } }), "Something went wrong while talking to Discord. It will be tried again."],
  ];
  for (const [answerFn, text] of cases) {
    s.store.db.prepare("UPDATE guild_events SET discord_message = NULL, discord_event = NULL, discord_sig = NULL").run();
    fake.answer = answerFn;
    await change();
    const d = await discord();
    assert.deepEqual([d.state, d.problem], ["problem", text]);
    fake.answer = () => null;
    await change();
    assert.equal((await discord()).state, "connected");
  }
  // No answer at all: a timeout is a plain reason too, and the request that caused it was answered long before.
  const stuck = { ...s.live.client };
  s.live.client.raw = () => Promise.reject(new D.DiscordError("timeout"));
  const before = Date.now();
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel", { version: ++n, title: "No answer" }), g.H)).body.accepted, true);
  assert.ok(Date.now() - before < 2000, "the app's request never waits for Discord");
  await x.idle();
  assert.equal((await discord()).problem, "Discord did not answer. It will be tried again.");
  delete s.live.client.raw; void stuck;
  // The log names the kind of failure and the code, never a name, a title or the token.
  const log = s.logs.join("\n");
  assert.match(log, /discord job failed: http 403 code 50013/);
  assert.match(log, /discord job failed: timeout/);
  assert.ok(!log.includes("Raid 1") && !log.includes("raids") && !log.includes(TOKEN) && !log.includes("Abel"));
  // The test post reports straight away whether it worked.
  await change();
  assert.deepEqual((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/test`, { schema: 1 }, g.H)).body, { ok: true, posted: true, discord: { state: "connected", guildName: "Night Watch HQ", channel: "#raids", problem: null } });
  assert.equal(fake.messages().pop().body.content, "Backstage Forever is connected. Guild events will be posted in this channel.");
  fake.answer = (c) => (/\/messages/.test(c.path) ? { status: 403, body: { code: 50013 } } : null);
  const failed = await api(s, "POST", `/v1/guilds/${g.guildId}/discord/test`, { schema: 1 }, g.H);
  assert.deepEqual([failed.status, failed.body.posted, failed.body.discord.state], [200, false, "problem"]);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/discord/test`, { schema: 1 }, cy.H)).status, 403);
});

test("commands, the reminder, closing, the summary and disconnecting", async (t) => {
  const x = await setup(t), { s, fake } = x;
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await connect(x, g);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2`, eventBody("raid2", "Abel", { title: "Onyxia", at: "2026-11-28T19:00:00Z" }), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "tank"), cy.H);
  await x.idle();
  const reply = async (payload) => (await said(await interact(x, payload))).data;
  const plain = member("400000000000000001", "Dora"), manager = member("400000000000000002", "Mo", String(1n << 5n));

  // /backstage events: only the presser sees it.
  const list = await reply(command(plain, "events"));
  assert.equal(list.flags, 64);
  assert.deepEqual(list.content.split("\n").map(l => l.split(" <t:")[0]), ["**Molten Core**", "**Onyxia**"]);
  assert.ok(list.content.includes("tank 1/2, healer 0/8, damage 0/30"));

  // /backstage channel: only somebody who may manage the Discord server; events move to the new channel.
  assert.match((await reply(command(plain, "channel"))).content, /Only somebody who may manage this Discord server/);
  assert.equal(s.store.db.prepare("SELECT discord_channel FROM guilds").get().discord_channel, CHANNEL);
  assert.match((await reply(command(manager, "channel", [{ type: 7, name: "channel", value: CHANNEL2 }], { data: undefined }))).content, /not known/);
  const picked = command(manager, "channel", [{ type: 7, name: "channel", value: CHANNEL2 }]);
  picked.data.resolved = { channels: { [CHANNEL2]: { id: CHANNEL2, type: 0, name: "events" } } };
  fake.calls.length = 0;
  assert.equal((await reply(picked)).content, "Guild events will be posted in #events from now on.");
  await x.idle();
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord.channel, "#events");
  assert.deepEqual(fake.messages().map(c => c.path), [`/channels/${CHANNEL2}/messages`, `/channels/${CHANNEL2}/messages`], "both live events are posted in the new channel");
  const voice = command(manager, "channel", [{ type: 7, name: "channel", value: CHANNEL }]);
  voice.data.resolved = { channels: { [CHANNEL]: { id: CHANNEL, type: 2, name: "Raid voice" } } };
  assert.equal((await reply(voice)).content, "Choose a normal text channel.");
  // Without the option: the channel the command was typed in.
  const here = command(manager, "channel", undefined, { channel_id: CHANNEL, channel: { id: CHANNEL, type: 0, name: "raids" } });
  assert.equal((await reply(here)).content, "Guild events will be posted in #raids from now on.");
  await x.idle();

  // The reminder: once, 15 minutes before; never for a cancelled event.
  fake.calls.length = 0;
  const at = Date.parse("2026-11-27T19:00:00Z");
  s.clock.t = at - 16 * 60_000; s.live.tick(); await x.idle();
  assert.equal(fake.messages().length, 0, "too early");
  s.clock.t = at - 14 * 60_000; s.live.tick(); await x.idle();
  assert.equal(fake.messages().length, 1);
  assert.match(fake.messages()[0].body.content, new RegExp(`^\\*\\*Molten Core\\*\\* starts <t:${at / 1000}:R>\\.$`));
  assert.deepEqual(fake.messages()[0].body.allowed_mentions, { parse: [], users: [] }, "nobody linked Discord, so nobody is named");
  for (const more of [30_000, 60_000, 5 * 60_000]) { s.clock.t += more; s.live.tick(); await x.idle(); }
  assert.equal(fake.messages().length, 1, "never a second reminder");

  // Four hours after the start the message loses its buttons, once.
  fake.calls.length = 0;
  s.clock.t = at + 4 * HOUR + 60_000; s.live.tick(); await x.idle();
  assert.equal(fake.edits().length, 1);
  assert.deepEqual(fake.edits()[0].body.components, []);
  s.clock.t += 60_000; s.live.tick(); await x.idle();
  assert.equal(fake.edits().length, 1);

  // E3: the summary is posted with the names it was given, escaped; the server keeps only the numbers.
  fake.calls.length = 0;
  const sum = await api(s, "POST", `/v1/guilds/${g.guildId}/events/raid1/summary`, { schema: 1, attended: ["Abel", "Cy"], bosses: 10, durationSec: 9660 }, g.H);
  assert.deepEqual(sum.body, { ok: true, posted: true });
  await x.idle();
  assert.deepEqual(fake.messages()[0].body, { content: "**Molten Core** is done.\nAttended (2): Abel, Cy\nBosses down: 10\nTime: 2 h 41 min", allowed_mentions: { parse: [] } });

  // Disconnect: the link and every member tie go, the bot is asked to leave, the guild hears it.
  s.store.db.prepare("UPDATE guild_members SET discord_user = '400000000000000001', discord_name = 'Dora' WHERE name = 'Cy'").run();
  assert.equal((await api(s, "DELETE", `/v1/guilds/${g.guildId}/discord`, undefined, cy.H)).status, 403);
  fake.calls.length = 0;
  assert.deepEqual((await api(s, "DELETE", `/v1/guilds/${g.guildId}/discord`, undefined, g.H)).body, { ok: true });
  await x.idle();
  assert.deepEqual(fake.calls.map(c => `${c.method} ${c.path}`), [`DELETE /users/@me/guilds/${DGUILD}`]);
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).body.discord, { state: "none", guildName: null, channel: null, problem: null });
  const left = JSON.stringify([s.store.db.prepare("SELECT * FROM guilds").all(), s.store.db.prepare("SELECT * FROM guild_members").all(), s.store.db.prepare("SELECT discord_message, discord_event FROM guild_events").all()]);
  assert.ok(!left.includes(DGUILD) && !left.includes("400000000000000001") && !left.includes("Dora") && !left.includes(CHANNEL), "no Discord id or name is left");
  fake.calls.length = 0;
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid3`, eventBody("raid3", "Abel", { at: "2026-12-05T19:00:00Z" }), g.H);
  await x.idle();
  assert.equal(fake.calls.length, 0, "nothing is posted any more");
  // Deleting a connected guild also makes the bot leave.
  await connect(x, g);
  fake.calls.length = 0;
  await api(s, "DELETE", `/v1/guilds/${g.guildId}`, undefined, g.H);
  await x.idle();
  assert.ok(fake.calls.some(c => c.method === "DELETE" && c.path === `/users/@me/guilds/${DGUILD}`));
});

test("the bot client: discord.com only, a fixed list of paths, and the command registration", async (t) => {
  const fake = await fakeDiscord(); t.after(() => fake.close());
  const k = keys(), client = new D.DiscordClient({ discord: discordConfig(k), request: fake.request, sleep: () => Promise.resolve() });
  // Paths outside the list are refused before any socket is opened.
  for (const p of ["/users/@me", "/guilds/100000000000000001", "/guilds/100000000000000001/members/1", "/channels/200000000000000001/messages/../../../users/@me", "/webhooks/1/x", "//evil.example/x", "/channels/abc/messages", "/oauth2/token?x=1"])
    await assert.rejects(client.call("GET", p), (e) => e instanceof D.DiscordError && e.kind === "refused", p);
  assert.equal(fake.asked.length, 0);
  assert.equal(D.API_HOST, "discord.com");
  // Registration: one command, three sub-commands, sent with PUT to this application only.
  assert.equal(await D.registerCommands(client), 1);
  const put = fake.calls[0];
  assert.deepEqual([put.method, put.url, put.headers.authorization], ["PUT", `/api/v10/applications/${APP}/commands`, `Bot ${TOKEN}`]);
  assert.deepEqual(put.body.map(c => [c.name, c.dm_permission, c.options.map(o => o.name)]), [["backstage", false, ["link", "channel", "events"]]]);
  assert.deepEqual(put.body[0].options[1].options[0].channel_types, [0, 5]);
  for (const c of put.body) for (const o of [c, ...c.options]) assert.ok(o.description.length >= 1 && o.description.length <= 100, o.name);
  fake.answer = () => ({ status: 401, body: { message: "401: Unauthorized", code: 0 } });
  await assert.rejects(D.registerCommands(client), (e) => e.kind === "http" && e.status === 401 && !e.message.includes(TOKEN));
  // A queue never runs two jobs of one key at once, keeps their order, and does not add a waiting job twice.
  const order = [];
  const job = (name, ms) => client.enqueue("g", name, async () => { order.push(`${name}+`); await new Promise(r => setTimeout(r, ms)); order.push(`${name}-`); });
  await Promise.all([job("a", 15), job("b", 1), job("b", 1), job("c", 1)]);
  assert.deepEqual(order, ["a+", "a-", "b+", "b-", "c+", "c-"]);
  // The signature helper on its own, and the state: wrong key, wrong salt and old states fail.
  const ts = String(Math.floor(T0 / 1000)), body = Buffer.from("{}"), sig = crypto.sign(null, Buffer.concat([Buffer.from(ts), body]), k.privateKey).toString("hex");
  assert.equal(D.verifyInteraction(D.verifyKey(k.hex), sig, ts, body, T0), true);
  assert.equal(D.verifyInteraction(D.verifyKey(keys().hex), sig, ts, body, T0), false);
  assert.equal(D.verifyInteraction(D.verifyKey(k.hex), sig, ts, Buffer.from("{ }"), T0), false);
  assert.equal(D.verifyInteraction(D.verifyKey(k.hex), sig, ts, body, T0 + 5 * 60_000 + 1000), false);
  const state = D.signState(SALT, "g_1", "nonce", T0);
  assert.deepEqual(D.readState(SALT, state, T0 + 60_000), { guildId: "g_1", nonce: "nonce" });
  assert.equal(D.readState(`${SALT}x`, state, T0), null);
  assert.equal(D.readState(SALT, state, T0 + 15 * 60_000 + 1), null);
  assert.equal(D.readState(SALT, `${state}x`, T0), null);
  assert.equal(D.readState(SALT, undefined, T0), null);
  void uuid;
});
