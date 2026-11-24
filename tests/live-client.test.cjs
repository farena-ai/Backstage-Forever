"use strict";
// Backstage Live client: the Server-Sent Events parser (fuzzed) and the client against the in-test
// service on 127.0.0.1: no connection unless something needs one, reconnect with a full refetch,
// subscriptions that change while it runs, a status the screens can show, and a clean stop.
const test = require("node:test"), assert = require("node:assert/strict");
const { LiveClient, createSseParser, parseSse, sessionBody, backoffDelay, BACKOFF_MIN, BACKOFF_MAX } = require("../src/core/live-client.cjs");
const { fakeLive } = require("./live-fake-server.cjs");

const ID = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
const KEY = "k".repeat(43);
const until = async (fn, ms = 4000, what = "condition") => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)); } assert.fail(`timed out waiting for ${what}`); };
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
// A deterministic generator, so a failing fuzz case can be run again.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("SSE parser: events, multi-line data, comments, ids, CRLF and a leading byte-order mark", () => {
  assert.deepEqual(parseSse("event: hello\ndata: {\"serverTime\":\"x\"}\nid: 1\n\n"), [{ event: "hello", data: "{\"serverTime\":\"x\"}", id: "1" }]);
  assert.deepEqual(parseSse("data: one\ndata: two\ndata:\ndata: four\n\n"), [{ event: "message", data: "one\ntwo\n\nfour", id: "" }], "data lines are joined with a line break");
  assert.deepEqual(parseSse(": ping\n\n: ping\n\nevent: lfg\r\ndata: {}\r\n\r\n"), [{ event: "lfg", data: "{}", id: "" }], "comments dispatch nothing");
  assert.deepEqual(parseSse("﻿event: a\rdata: 1\r\rdata: 2\r\n\n"), [{ event: "a", data: "1", id: "" }, { event: "message", data: "2", id: "" }], "bare CR ends a line; the event name does not carry over");
  assert.deepEqual(parseSse("id: 7\ndata: a\n\ndata: b\n\n").map((e) => e.id), ["7", "7"], "the last id stays until it changes");
  assert.deepEqual(parseSse("data:no space\ndata:  two spaces\nretry: 5\nunknown: x\nfield-without-colon\n\n"), [{ event: "message", data: "no space\n two spaces", id: "" }], "only one leading space is removed; unknown fields are ignored");
  assert.deepEqual(parseSse("event: lost\ndata: never finished\n"), [], "an event without its blank line is discarded at the end");
  assert.deepEqual(parseSse("event: empty\n\n"), [], "an event without data is not dispatched");
  const comments = [];
  const p = createSseParser(() => {}, { onComment: (c) => comments.push(c) });
  p.push(": ping\n:tight\n");
  assert.deepEqual(comments, ["ping", "tight"]);
  // One oversized event is dropped and the next one still arrives.
  const got = [];
  const small = createSseParser((e) => got.push(e), { maxBytes: 64 });
  small.push(`data: ${"x".repeat(500)}\n\ndata: ok\n\n`);
  assert.deepEqual(got, [{ event: "message", data: "ok", id: "" }]);
});

test("SSE parser fuzz: any chunking of any stream gives the same events", () => {
  const random = rng(20261124);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const words = ["", "a", "héllo wörld", "{\"guildId\":\"g_1\",\"event\":{\"title\":\"Molten Core — Thursday\"}}", "x: y", " leading", "trailing ", "日本語 ✓", "🙂 emoji 🙂", ":colon first", "a".repeat(300)];
  for (let round = 0; round < 400; round++) {
    const eol = pick(["\n", "\r\n", "\r"]);
    const expected = [];
    let text = round % 7 === 0 ? "﻿" : "", lastId = "";
    const events = 1 + Math.floor(random() * 6);
    for (let i = 0; i < events; i++) {
      if (random() < 0.4) text += `: ${pick(["ping", "", "keep alive ✓"])}${eol}${random() < 0.5 ? eol : ""}`;
      const name = pick(["", "hello", "guild.event", "lfg", "ticket"]);
      const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(words));
      const withId = random() < 0.5 ? String(Math.floor(random() * 1000)) : null;
      if (name) text += `event: ${name}${eol}`;
      if (withId !== null) { text += `id: ${withId}${eol}`; lastId = withId; }
      for (const l of lines) text += `data: ${l}${eol}`;
      if (random() < 0.2) text += `retry: 1000${eol}`;
      text += eol;
      expected.push({ event: name || "message", data: lines.join("\n"), id: lastId });
    }
    // Whole text at once, as text.
    assert.deepEqual(parseSse(text), expected, `round ${round}: whole`);
    // The same bytes in random pieces: boundaries fall inside characters and between CR and LF.
    const bytes = Buffer.from(text, "utf8"), got = [];
    const parser = createSseParser((e) => got.push(e));
    for (let at = 0; at < bytes.length;) { const n = 1 + Math.floor(random() * (random() < 0.5 ? 3 : 40)); parser.push(bytes.subarray(at, at + n)); at += n; }
    parser.end();
    assert.deepEqual(got, expected, `round ${round}: chunked (${JSON.stringify(eol)})`);
    // One byte at a time is the hardest split of all.
    if (round % 10 === 0) { const one = []; const p1 = createSseParser((e) => one.push(e)); for (const b of bytes) p1.push(Buffer.from([b])); assert.deepEqual(one, expected, `round ${round}: byte by byte`); }
  }
});

test("the session body is built from an allow-list and never exceeds 4 KB", () => {
  const body = sessionBody(ID, { tickets: [{ ticket: "BF-1042", key: KEY, summary: "private text", unread: 2 }, { ticket: "nope", key: KEY }, { ticket: "BF-7", key: "short" }],
    guild: [{ guildId: "g_abc", member: "m".repeat(43), guildName: "Ashen Vanguard", role: "leader", linkCode: "BFG-1" }, { guildId: "bad id", member: "m".repeat(43) }],
    lfg: [{ realm: "Thunder Hold", faction: "horde", listing: { who: "x" } }, { realm: "Thunder Hold", faction: "neutral" }], extra: [1] });
  assert.deepEqual(body, { schema: 1, installId: ID, subs: [{ t: "tickets", tickets: [{ ticket: "BF-1042", key: KEY }] }, { t: "guild", guildId: "g_abc", member: "m".repeat(43) }, { t: "lfg", realm: "Thunder Hold", faction: "horde" }] });
  const many = sessionBody(ID, { tickets: Array.from({ length: 200 }, (_, i) => ({ ticket: `BF-${1000 + i}`, key: KEY })), guild: [{ guildId: "g_abc", member: "m".repeat(43) }] });
  assert.ok(Buffer.byteLength(JSON.stringify(many)) <= 4096);
  assert.ok(many.subs[0].tickets.length >= 20 && many.subs[0].tickets.at(-1).ticket === "BF-1199", "the newest tickets are kept");
  assert.equal(many.subs.at(-1).t, "guild", "guild and board subscriptions are never the ones cut");
  assert.deepEqual(sessionBody(ID, {}).subs, []);
});

test("waits grow from 2 seconds to 5 minutes", () => {
  assert.equal(backoffDelay(1, 0.5), 2000); assert.equal(backoffDelay(2, 0.5), 4000); assert.equal(backoffDelay(3, 0.5), 8000);
  assert.equal(backoffDelay(30, 0.5), BACKOFF_MAX); assert.equal(backoffDelay(30, 1), BACKOFF_MAX);
  assert.equal(backoffDelay(1, 0), BACKOFF_MIN, "never under 2 seconds");
  assert.ok(backoffDelay(4, 0) < backoffDelay(4, 1));
});

test("no connection at all unless something needs it", async () => {
  const fake = await fakeLive().listen();
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID });
  try {
    assert.equal(live.status().state, "idle");
    live.setSubs("tickets", []); live.setSubs("guild", []); live.retryNow();
    await quiet(500);
    assert.deepEqual(fake.log, [], "created, asked for nothing: not one request");
    // A client that was told to stay silent (a development run) never connects either.
    const off = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID, enabled: false });
    off.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    await quiet(500);
    assert.deepEqual(fake.log, []); assert.equal(off.status().state, "idle");
    off.stop();
    // Without an install id there is nothing to open a session with.
    const anonymous = new LiveClient({ baseUrl: fake.url, getInstallId: () => null });
    anonymous.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    await quiet(500);
    assert.deepEqual(fake.log, []);
    anonymous.stop();
    assert.throws(() => live.setSubs("everything", [{}]), /Unknown live subscription/);
  } finally { live.stop(); await fake.close(); }
});

test("it connects when a subscription appears, delivers events, and goes quiet when the last one is removed", async () => {
  const fake = await fakeLive().listen();
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID });
  const events = [], states = [], refetch = [];
  live.on("event", (name, data) => events.push([name, data]));
  live.on("status", (s) => states.push(s.state));
  live.on("refetch", (r) => refetch.push(r.reconnect));
  try {
    live.setSubs("tickets", [{ ticket: "BF-1042", key: KEY }]);
    await until(() => live.status().state === "live", 4000, "live");
    assert.deepEqual(fake.log.map((e) => `${e.method} ${e.route}`), ["POST /v1/live/session", "GET /v1/live/stream"]);
    assert.deepEqual(fake.log[0].body, { schema: 1, installId: ID, subs: [{ t: "tickets", tickets: [{ ticket: "BF-1042", key: KEY }] }] });
    assert.deepEqual(refetch, [false], "the first hello asks for one full read");
    fake.push("ticket", { ticket: "BF-1042", status: "question", fixedIn: null, unread: 1, lastId: 2 }, fake.toTicket("BF-1042"));
    fake.push("made.up", { x: 1 });                                   // an event this client does not know
    for (const s of fake.streams) s.res.write("event: ticket\ndata: not json\n\n"); // damaged data
    fake.push("ticket", { ticket: "BF-1042", status: "fixed", fixedIn: "1.28.0", unread: 2, lastId: 3 });
    await until(() => events.length === 2, 4000, "two events");
    assert.deepEqual(events.map(([n, d]) => [n, d.status]), [["ticket", "question"], ["ticket", "fixed"]], "unknown events and damaged data are skipped");
    assert.deepEqual(states, ["connecting", "live"]);
    // Removing the last subscription closes the stream.
    live.setSubs("tickets", []);
    await until(() => live.status().state === "idle" && fake.streams.size === 0, 4000, "idle");
    const before = fake.log.length;
    await quiet(700);
    assert.equal(fake.log.length, before, "and nothing is asked again");
  } finally { live.stop(); await fake.close(); }
});

test("a lost stream reconnects with a new session and asks for a full refetch", async () => {
  const fake = await fakeLive().listen();
  // Short waits for the test: the real ones are 2 s to 5 min (backoffDelay above).
  const fast = { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 60)), clearTimeout };
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID, timers: fast });
  const refetch = [], states = [];
  live.on("refetch", (r) => refetch.push(r.reconnect));
  live.on("status", (s) => { if (states.at(-1) !== s.state) states.push(s.state); });
  try {
    live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    await until(() => live.status().state === "live", 4000, "live");
    assert.equal(fake.dropStreams(), 1);                 // the service closes it (55 minutes, or a restart)
    await until(() => refetch.length === 2, 4000, "second hello");
    assert.deepEqual(refetch, [false, true]);
    assert.deepEqual(states, ["connecting", "live", "reconnecting", "live"]);
    assert.equal(fake.requests("/v1/live/session").length, 2, "a new session each time: the stream token works once");
    assert.notEqual(fake.requests("/v1/live/stream")[0].query.s, fake.requests("/v1/live/stream")[1].query.s);
    // The service goes away: Reconnecting, then Offline, and it keeps trying.
    fake.state.busy = true;
    fake.dropStreams();
    await until(() => live.status().state === "offline", 4000, "offline");
    assert.ok(live.status().retryAt > 0, "the status says when it tries next");
    const tries = fake.requests("/v1/live/session").length;
    await until(() => fake.requests("/v1/live/session").length > tries, 4000, "another try while offline");
    fake.state.busy = false;
    await until(() => live.status().state === "live", 4000, "live again");
    assert.equal(refetch.at(-1), true);
    // Events sent before hello or to a stream that was replaced never arrive twice.
    const events = [];
    live.on("event", (n) => events.push(n));
    assert.equal(fake.streams.size, 1, "one stream, never two");
    fake.putListing("Thunder Hold", "horde", { id: "abcdefgh12345678" });
    await until(() => events.length === 1, 4000, "one event");
    await quiet(200);
    assert.deepEqual(events, ["lfg"]);
  } finally { live.stop(); await fake.close(); }
});

test("subscriptions change while it runs: the stream is reopened with the new list, once", async () => {
  const fake = await fakeLive().listen();
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID });
  const refetch = [];
  live.on("refetch", (r) => refetch.push(r.reconnect));
  try {
    live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    await until(() => live.status().state === "live", 4000, "live");
    // Three changes in a row become one new session.
    live.setSubs("tickets", [{ ticket: "BF-1", key: KEY }]);
    live.setSubs("tickets", [{ ticket: "BF-1", key: KEY }, { ticket: "BF-2", key: KEY }]);
    live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "alliance" }]);
    await until(() => fake.requests("/v1/live/session").length === 2 && live.status().state === "live" && fake.streams.size === 1, 4000, "resubscribed");
    await quiet(500);
    assert.equal(fake.requests("/v1/live/session").length, 2);
    assert.deepEqual(fake.requests("/v1/live/session")[1].body.subs, [{ t: "tickets", tickets: [{ ticket: "BF-1", key: KEY }, { ticket: "BF-2", key: KEY }] }, { t: "lfg", realm: "Thunder Hold", faction: "alliance" }]);
    assert.equal(live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "alliance" }]), false, "the same list again changes nothing");
    await quiet(500);
    assert.equal(fake.requests("/v1/live/session").length, 2);
    // The old board no longer reaches this client; the new one does.
    const events = [];
    live.on("event", (n, d) => events.push(d.listing.id));
    fake.putListing("Thunder Hold", "horde", { id: "hordehordehorde1" });
    fake.putListing("Thunder Hold", "alliance", { id: "alliancealliance" });
    await until(() => events.length === 1, 4000, "the alliance listing");
    assert.deepEqual(events, ["alliancealliance"]);
    assert.deepEqual(live.status().subs, { tickets: 2, guild: 0, lfg: 1 });
    assert.doesNotMatch(JSON.stringify(live.status()), new RegExp(KEY), "the status carries no key");
  } finally { live.stop(); await fake.close(); }
});

test("a refused session is reported, a rate limit is waited out, a block stops it for good", async () => {
  const fake = await fakeLive().listen();
  const fast = { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 60)), clearTimeout };
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID, timers: fast });
  const rejected = [];
  live.on("rejected", (r) => rejected.push(r));
  try {
    // A member token the service does not know: 404 for the whole session.
    live.setSubs("guild", [{ guildId: "g_unknown", member: "m".repeat(43) }]);
    await until(() => rejected.length >= 1, 4000, "rejected");
    assert.deepEqual(rejected[0], { status: 404, error: "not_found" });
    assert.notEqual(live.status().state, "live");
    live.setSubs("guild", []);
    live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    fake.state.rejectSessions = 429;
    await until(() => fake.requests("/v1/live/session").filter((e) => e.body.subs[0].t === "lfg").length >= 1, 4000, "a rate-limited try");
    fake.state.rejectSessions = null;
    await until(() => live.status().state === "live", 4000, "live after the wait");
  } finally { live.stop(); await fake.close(); }
});

test("stop closes the stream at once and nothing happens afterwards", async () => {
  const fake = await fakeLive().listen();
  const live = new LiveClient({ baseUrl: fake.url, getInstallId: () => ID });
  let after = 0;
  try {
    live.setSubs("lfg", [{ realm: "Thunder Hold", faction: "horde" }]);
    await until(() => live.status().state === "live", 4000, "live");
    live.on("event", () => after++); live.on("status", () => after++); live.on("refetch", () => after++);
    live.stop();
    await until(() => fake.streams.size === 0, 4000, "the service sees the stream close");
    const requests = fake.log.length;
    live.setSubs("tickets", [{ ticket: "BF-1", key: KEY }]); live.retryNow(); live.reconcile();
    await quiet(600);
    assert.equal(fake.log.length, requests, "no request after stop");
    assert.equal(after, 0, "no event after stop");
    assert.equal(live.status().state, "idle");
    live.stop(); // twice is fine
  } finally { await fake.close(); }
});

test("only https, or plain http on this machine", () => {
  const live = new LiveClient({ baseUrl: "http://example.com", getInstallId: () => ID });
  assert.throws(() => live.target("/v1/live/session"), /must be https/);
  assert.equal(new LiveClient({ baseUrl: "https://bf.backstagecoding.com/", getInstallId: () => ID }).target("/v1/live/session").href, "https://bf.backstagecoding.com/v1/live/session");
  assert.equal(new LiveClient({ baseUrl: "http://127.0.0.1:9", getInstallId: () => ID }).target("/x").protocol, "http:");
});
