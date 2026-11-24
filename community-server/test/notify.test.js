"use strict";
// Admin alerts: off unless configured, only the allowed facts, never blocking a request.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");
const { loadConfig } = require("../lib/config");
const N = require("../lib/notify");
const { SALT, uuid, ticket, boot, post, testConfig } = require("./helpers");

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
const SECRET_BITS = ["Steps: open the planner", "The tree I picked", "TypeError: x (paths removed)", "1.60.1.71037", "windows"];

// A stand-in for the sendmail binary: records how it was started and what it was fed.
function fakeSendmail({ exit = 0, fail = null, hang = false } = {}) {
  const calls = [];
  const spawn = (file, args, options) => {
    if (fail === "throw") { const e = new Error("spawn failed"); e.code = "ENOENT"; throw e; }
    const child = new EventEmitter();
    const call = { file, args, options, input: "" };
    calls.push(call);
    child.stdin = new Writable({ write(chunk, enc, cb) { call.input += chunk.toString(); cb(); }, final(cb) { cb(); if (!hang) setImmediate(() => child.emit("close", exit)); } });
    child.kill = () => { call.killed = true; };
    if (fail === "error") setImmediate(() => child.emit("error", Object.assign(new Error("no such file"), { code: "ENOENT" })));
    return child;
  };
  return { spawn, calls };
}

// A stand-in for Discord: a local HTTP server; the injected request function records what the notifier asked for and sends it there.
async function fakeDiscord(status = 204) {
  const got = [], asked = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { got.push({ method: req.method, url: req.url, headers: req.headers, body }); res.writeHead(status, status === 302 ? { Location: "https://evil.example/" } : {}); res.end(); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const request = (options, cb) => { asked.push({ ...options }); return http.request({ ...options, protocol: "http:", hostname: "127.0.0.1", port: server.address().port }, cb); };
  return { request, got, asked, close: () => new Promise((r) => server.close(r)) };
}

const FACTS = { ticket: "BF-1042", kind: "bug", area: "talents", appVersion: "1.26.0", summary: "Planner shows the wrong tree" };

test("configuration: both channels are off by default and only strict values switch them on", () => {
  const off = loadConfig({}, { salt: SALT }).notify;
  assert.deepEqual(off.email, []);
  assert.equal(off.discord, null);
  assert.deepEqual(new N.Notifier({ config: { notify: off } }).channels(), { email: false, discord: false });

  const on = loadConfig({ BF_DESK_NOTIFY_EMAIL: " owner@example.com , second@example.org ", BF_DESK_NOTIFY_FROM: "desk@example.com", BF_DESK_NOTIFY_REPLY_TO: "owner@example.com", BF_DESK_NOTIFY_MAX_PER_HOUR: "5", BF_DESK_DISCORD_WEBHOOK: WEBHOOK }, { salt: SALT }).notify;
  assert.deepEqual(on.email, ["owner@example.com", "second@example.org"]);
  assert.deepEqual([on.from, on.replyTo, on.maxPerHour, on.sendmail], ["desk@example.com", "owner@example.com", 5, "/usr/sbin/sendmail"]);
  assert.deepEqual(on.discord, { hostname: "discord.com", path: "/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" });
  assert.deepEqual(N.parseDiscordWebhook(WEBHOOK.replace("discord.com", "discordapp.com")).hostname, "discordapp.com");

  for (const bad of ["not-an-address", "a@b", "-oQ/tmp@example.com", "a b@example.com", "owner@example.com\nBcc: x@example.com", "owner@example.com;rm -rf", "<owner@example.com>", `${"a@example.com,".repeat(11)}b@example.com`])
    assert.throws(() => loadConfig({ BF_DESK_NOTIFY_EMAIL: bad }, { salt: SALT }), /BF_DESK_NOTIFY_EMAIL/, bad);
  // Outbound HTTPS only to Discord's own hosts, and only to a webhook path.
  for (const bad of [WEBHOOK.replace("https:", "http:"), WEBHOOK.replace("discord.com", "evil.example"), WEBHOOK.replace("discord.com", "discord.com.evil.example"), WEBHOOK.replace("discord.com", "evil.discord.com"),
    WEBHOOK.replace("discord.com", "discord.com:8443"), WEBHOOK.replace("https://", "https://user:pw@"), "https://discord.com/api/other/1/2", `${WEBHOOK}/../../x`, "https://127.0.0.1/api/webhooks/123456789/aaaaaaaaaaaaaaaaaaaaaaaa", "discord.com", "file:///etc/passwd"])
    assert.throws(() => loadConfig({ BF_DESK_DISCORD_WEBHOOK: bad }, { salt: SALT }), /BF_DESK_DISCORD_WEBHOOK/, bad);
  assert.throws(() => loadConfig({ BF_DESK_SENDMAIL: "sendmail" }, { salt: SALT }), /absolute/);
  // A bad value never ends up in the error text.
  try { loadConfig({ BF_DESK_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1/SECRET-TOKEN" }, { salt: SALT }); assert.fail("accepted"); } catch (e) { assert.ok(!e.message.includes("SECRET-TOKEN")); }
});

test("a notification holds the ticket number, kind, area, app version and 80 characters of the summary, and nothing else", () => {
  const long = `${"A long summary that goes on. ".repeat(10)}`;
  const facts = N.eventFacts("new", { ...FACTS, summary: long, details: "DETAILS", installId: "INSTALL", key: "KEY", extra: "EXTRA" });
  assert.deepEqual(Object.keys(facts).sort(), ["appVersion", "area", "kind", "summary", "ticket", "type"]);
  assert.equal([...facts.summary].length, 80);
  assert.equal(facts.summary, long.slice(0, 80));
  assert.equal(N.eventFacts("reply", FACTS).type, "reply");
  assert.equal(N.eventFacts("anything", { ...FACTS, appVersion: null }).appVersion, "unknown");
  // Line breaks, tabs and invisible direction characters cannot shape the message.
  assert.equal(N.summaryLine("one\r\ntwo\tthree \u202eevil\u2066 \u200bx"), "one two three evil x");
  assert.equal([...N.summaryLine("\u{1F600}".repeat(100))].length, 80);

  const mail = N.emailMessage(facts, { to: ["owner@example.com", "second@example.org"], from: "desk@example.com", replyTo: "owner@example.com", publicOrigin: "https://desk.test", now: Date.parse("2026-11-24T12:00:00Z") });
  const [head, body] = mail.split("\n\n", 2);
  assert.match(head, /^From: Backstage Desk <desk@example\.com>$/m);
  assert.match(head, /^To: owner@example\.com, second@example\.org$/m);
  assert.match(head, /^Reply-To: owner@example\.com$/m);
  assert.match(head, /^Subject: \[Backstage Desk\] New report BF-1042$/m);
  assert.match(head, /^Date: Tue, 24 Nov 2026 12:00:00 \+0000$/m);
  assert.match(head, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(head, /^Auto-Submitted: auto-generated$/m);
  assert.ok(!head.includes("A long summary"), "player text is never in a header");
  assert.equal(mail.split("\n\n").slice(1).join("\n\n"),
    `New report BF-1042\n\nKind:        bug\nArea:        talents\nApp version: 1.26.0\nSummary:     ${long.slice(0, 80)}\n\nOpen it: https://desk.test/admin/tickets/BF-1042\n\nThe full report can only be read in the admin area.\n`);
  assert.ok(body.startsWith("New report BF-1042"));
  // Header injection through the summary is impossible: it is one line, in the body.
  const inj = N.emailMessage(N.eventFacts("new", { ...FACTS, summary: "x\r\nBcc: victim@example.com\r\n\r\nbody" }), { to: ["owner@example.com"] });
  assert.ok(!/^Bcc:/m.test(inj));
  assert.ok(!/^From:/m.test(inj), "no From header unless one is configured");
  assert.match(N.emailMessage(N.eventFacts("reply", FACTS), { to: ["owner@example.com"] }), /^Subject: \[Backstage Desk\] Player reply on BF-1042$/m);

  const d = N.discordPayload(N.eventFacts("new", { ...FACTS, summary: "@everyone look at **this** <@123> [x](https://evil.example) `code`" }));
  assert.deepEqual(Object.keys(d).sort(), ["allowed_mentions", "content", "flags"]);
  assert.deepEqual(d.allowed_mentions, { parse: [] }); // nobody can be pinged
  assert.equal(d.content, "**New report BF-1042** · bug · talents · app 1.26.0\n\\@everyone look at \\*\\*this\\*\\* \\<\\@123\\> \\[x\\]\\(https\\://evil.example\\) \\`code\\`");
});

test("e-mail goes through the local sendmail, recipients as arguments, with an hourly cap", async () => {
  const mailer = fakeSendmail(), logs = [];
  let now = Date.parse("2026-11-24T12:00:00Z");
  const config = { publicOrigin: "https://desk.test", notify: { email: ["owner@example.com", "second@example.org"], from: "desk@example.com", replyTo: null, maxPerHour: 3, sendmail: "/usr/sbin/sendmail", discord: null } };
  const n = new N.Notifier({ config, spawn: mailer.spawn, log: (l) => logs.push(l), now: () => now, request: () => { throw new Error("discord is off"); } });
  await n.ticketEvent("new", FACTS);
  assert.equal(mailer.calls.length, 1);
  assert.equal(mailer.calls[0].file, "/usr/sbin/sendmail");
  assert.deepEqual(mailer.calls[0].args, ["-i", "--", "owner@example.com", "second@example.org"]);
  assert.equal(mailer.calls[0].options.shell, false);
  assert.match(mailer.calls[0].input, /^Subject: \[Backstage Desk\] New report BF-1042$/m);
  assert.match(mailer.calls[0].input, /Summary:     Planner shows the wrong tree/);

  // One e-mail per event, until the hourly cap; then nothing, and one log line about it.
  await n.ticketEvent("reply", FACTS);
  await n.ticketEvent("new", FACTS);
  for (let i = 0; i < 10; i++) await n.ticketEvent("new", FACTS);
  assert.equal(mailer.calls.length, 3);
  assert.equal(logs.filter(l => /hourly cap of 3 reached/.test(l)).length, 1);
  now += 3600_000;
  await n.ticketEvent("new", FACTS);
  assert.equal(mailer.calls.length, 4);

  // The test command sends a harmless message to the same recipients.
  const r = await n.test();
  assert.deepEqual(r, { email: true });
  assert.match(mailer.calls[4].input, /^Subject: \[Backstage Desk\] Test message$/m);
  assert.match(mailer.calls[4].input, /Nothing is wrong/);
});

test("Discord: the complete payload reaches a fake receiver; only the allow-listed host is ever asked", async (t) => {
  const d = await fakeDiscord(); t.after(() => d.close());
  const config = { notify: { email: [], discord: N.parseDiscordWebhook(WEBHOOK), maxPerHour: 30 } };
  const n = new N.Notifier({ config, request: d.request, spawn: () => { throw new Error("e-mail is off"); } });
  await n.ticketEvent("new", { ...FACTS, summary: "Planner shows the wrong tree", details: "SECRET DETAILS" });
  assert.equal(d.got.length, 1);
  assert.equal(d.got[0].method, "POST");
  assert.equal(d.got[0].url, "/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-");
  assert.equal(d.got[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(d.got[0].body), { content: "**New report BF-1042** · bug · talents · app 1.26.0\nPlanner shows the wrong tree", allowed_mentions: { parse: [] }, flags: 4 });
  assert.deepEqual([d.asked[0].protocol, d.asked[0].hostname, d.asked[0].port], ["https:", "discord.com", 443]);
  assert.deepEqual(await n.test(), { discord: true });

  // A redirect is not followed, and counts as a failure. So does a refusal. Neither throws.
  const logs = [];
  for (const status of [302, 404, 500]) {
    const bad = await fakeDiscord(status); t.after(() => bad.close());
    const nb = new N.Notifier({ config, request: bad.request, log: (l) => logs.push(l) });
    assert.deepEqual(await nb.test(), { discord: false });
    assert.equal(bad.got.length, 1);
  }
  assert.equal(logs.length, 3);
  assert.ok(logs.every(l => /notify discord failed: status \d+$/.test(l)));
  // A notifier whose target is not an allowed host refuses before any request is made.
  let asked = 0;
  const rogue = new N.Notifier({ config: { notify: { email: [], discord: { hostname: "evil.example", path: "/x" } } }, request: () => { asked += 1; throw new Error("must not be called"); } });
  assert.equal(await rogue.sendDiscord({ content: "x" }), false);
  assert.equal(asked, 0);
});

test("failures never throw and are logged without any content", async () => {
  const config = { publicOrigin: "https://desk.test", notify: { email: ["owner@example.com"], maxPerHour: 100, sendmail: "/usr/sbin/sendmail", discord: N.parseDiscordWebhook(WEBHOOK) } };
  const failingRequest = () => { const req = new EventEmitter(); req.end = () => setImmediate(() => req.emit("error", Object.assign(new Error("connect failed to discord.com with SECRET"), { code: "ECONNREFUSED" }))); req.destroy = () => {}; return req; };
  for (const mailer of [fakeSendmail({ exit: 75 }), fakeSendmail({ fail: "throw" }), fakeSendmail({ fail: "error" })]) {
    const logs = [];
    const n = new N.Notifier({ config, spawn: mailer.spawn, request: failingRequest, log: (l) => logs.push(l) });
    await n.ticketEvent("new", { ...FACTS, summary: "PLAYER-SUMMARY-TEXT" });
    assert.equal(logs.length, 2, logs.join(" | "));
    assert.match(logs.join("\n"), /notify email failed: (exit 75|ENOENT)/);
    assert.match(logs.join("\n"), /notify discord failed: ECONNREFUSED/);
    for (const secret of ["PLAYER-SUMMARY-TEXT", "BF-1042", "owner@example.com", "abcdefghijklmnopqrstuvwxyz", "SECRET"]) assert.ok(!logs.join("\n").includes(secret), `log contains ${secret}`);
  }
  // Garbage in: still no throw.
  const n = new N.Notifier({ config, spawn: fakeSendmail().spawn, request: failingRequest });
  await n.ticketEvent("new", null);
  await n.ticketEvent("new", {});
  // A logger that throws cannot break it either.
  const loud = new N.Notifier({ config, spawn: fakeSendmail({ exit: 1 }).spawn, request: failingRequest, log: () => { throw new Error("log is broken"); } });
  await loud.ticketEvent("new", FACTS);
});

test("through the API: nothing is sent by default; when configured, a new ticket and a player reply each send one alert with no player details", async (t) => {
  // Default configuration: a notifier whose channels would explode if touched.
  const { Notifier } = N;
  let touched = 0;
  const quiet = new Notifier({ config: testConfig(), spawn: () => { touched += 1; throw new Error("no"); }, request: () => { touched += 1; throw new Error("no"); } });
  const s0 = await boot({}, { notifier: quiet }); t.after(() => s0.close());
  const made0 = await (await post(s0.base, "/v1/tickets", ticket(uuid()))).json();
  assert.equal((await post(s0.base, `/v1/tickets/${made0.ticket}/messages`, { schema: 1, text: "hello" }, { "X-BF-Ticket-Key": made0.key })).status, 201);
  assert.equal(touched, 0);

  const mailer = fakeSendmail(), d = await fakeDiscord(); t.after(() => d.close());
  const config = testConfig({ notify: { email: ["owner@example.com"], discord: N.parseDiscordWebhook(WEBHOOK) } });
  const s = await boot({ notify: config.notify }, { notifier: new Notifier({ config, spawn: mailer.spawn, request: d.request }) }); t.after(() => s.close());
  const installId = uuid(), summary = `Summary with a very long tail ${"z".repeat(100)}`;
  const made = await (await post(s.base, "/v1/tickets", ticket(installId, { summary }))).json();
  await (await post(s.base, `/v1/tickets/${made.ticket}/messages`, { schema: 1, text: "REPLY-TEXT-FROM-PLAYER" }, { "X-BF-Ticket-Key": made.key })).json();
  await new Promise((r) => setTimeout(r, 150)); // alerts are sent after the response
  assert.equal(mailer.calls.length, 2);
  assert.equal(d.got.length, 2);
  assert.match(mailer.calls[0].input, /^Subject: \[Backstage Desk\] New report BF-1001$/m);
  assert.match(mailer.calls[1].input, /^Subject: \[Backstage Desk\] Player reply on BF-1001$/m);
  const everything = mailer.calls.map(c => c.input).join("\n") + d.got.map(g => g.body).join("\n");
  assert.ok(everything.includes(summary.slice(0, 80)) && !everything.includes(summary.slice(0, 81)), "exactly the first 80 characters of the summary");
  for (const secret of [...SECRET_BITS, "REPLY-TEXT-FROM-PLAYER", installId, made.key, require("../lib/store").hashInstall(SALT, installId), "macos", "always", "talents-screen"])
    assert.ok(!everything.includes(secret), `an alert contains ${secret}`);
  assert.ok(everything.includes("bug") && everything.includes("talents") && everything.includes("1.26.0"));
  // Admin replies and notes do not alert the admins.
  s.store.desk.adminReply(1001, null, "team text", null, s.clock.t);
  assert.equal(mailer.calls.length, 2);

  // A sendmail that is missing, or a notifier that throws, never fails the player's request.
  const broken = fakeSendmail({ fail: "throw" });
  const s2 = await boot({}, { notifier: new Notifier({ config, spawn: broken.spawn, request: () => { throw new Error("down"); } }) }); t.after(() => s2.close());
  assert.equal((await post(s2.base, "/v1/tickets", ticket(uuid()))).status, 201);
  const s3 = await boot({}, { notifier: { ticketEvent() { throw new Error("boom"); }, channels: () => ({}) } }); t.after(() => s3.close());
  assert.equal((await post(s3.base, "/v1/tickets", ticket(uuid()))).status, 201);
  const s4 = await boot({}, { notifier: { ticketEvent: () => Promise.reject(new Error("later boom")), channels: () => ({}) } }); t.after(() => s4.close());
  assert.equal((await post(s4.base, "/v1/tickets", ticket(uuid()))).status, 201);
  await new Promise((r) => setTimeout(r, 20));
});

test("nothing in the repository holds a real recipient or webhook", () => {
  const fs = require("node:fs"), path = require("node:path");
  const root = path.join(__dirname, "..");
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules") continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|md|sh|conf|service|json)$/.test(e.name)) files.push(p); } };
  walk(root);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
      assert.match(m, /@(example\.(com|org)|bf-desk|anthropic\.com|[a-z.]*test)$|^git@|^pw@|noreply@/, `${path.relative(root, f)} has the address ${m}`);
    for (const m of text.match(/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g) || [])
      assert.match(m, /\/(1|123456789|123456789012345678)\//, `${path.relative(root, f)} has a webhook URL`);
  }
});
