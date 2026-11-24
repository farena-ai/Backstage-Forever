"use strict";
// The realtime stream (L1/L2) through a real local HTTP client: the hello event, pings on a clock
// the test controls, order of delivery, who receives what, one-time tokens, the caps, clean-up
// and the 55-minute lifetime. Plus the hub's own rules with a stand-in response.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { hashInstall } = require("../lib/store");
const { Hub, topic } = require("../lib/hub");
const { SALT, T0, uuid, ticket, boot, post, form, admin, REALM, MANY_LIVE, who, call, answer, makeGuild, joinGuild, eventBody, signupBody, listingBody, liveSession, openStream, settle } = require("./helpers");

const api = async (s, method, p, body, headers) => answer(await call(s.base, method, p, body, headers));
const guildSub = (g, m) => ({ t: "guild", guildId: g.guildId, member: m.token });
const names = (st) => st.events.map(e => e.event);

test("stream: hello first, the documented headers, ids that count up, events in the order they happened", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  // Nothing is replayed: what happened before the stream opened is not sent.
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/before`, eventBody("before", "Abel"), g.H);
  const session = await answer(await post(s.base, "/v1/live/session", { schema: 1, installId: cy.installId, subs: [guildSub(g, cy)] }));
  assert.deepEqual(Object.keys(session.body).sort(), ["expiresIn", "ok", "stream"]);
  assert.match(session.body.stream, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(session.body.expiresIn, 60);
  const st = await openStream(s.base, session.body.stream);
  t.after(() => st.close());
  assert.equal(st.status, 200);
  assert.equal(st.headers["content-type"], "text/event-stream");
  assert.equal(st.headers["cache-control"], "no-store");
  assert.equal(st.headers["x-accel-buffering"], "no");
  assert.equal(st.headers["x-content-type-options"], "nosniff");
  await st.until(x => x.events.length >= 1);
  assert.deepEqual(st.events[0], { id: 1, event: "hello", data: { serverTime: "2026-11-24T12:00:00Z" } });

  for (const n of [1, 2, 3]) await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid${n}`, eventBody(`raid${n}`, "Abel", { title: `Raid ${n}` }), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "healer", 1, "game"), cy.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2`, eventBody("raid2", "Abel", { version: 1, title: "Stale" }), g.H); // refused: nothing is published
  const dan = await joinGuild(s, g, "Dan", 5);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid3`, eventBody("raid3", "Abel", { version: 2, cancelled: true }), g.H);
  await st.until(x => x.events.length >= 7);
  await settle();
  assert.deepEqual(st.events.map(e => [e.id, e.event]), [[1, "hello"], [2, "guild.event"], [3, "guild.event"], [4, "guild.event"], [5, "guild.signup"], [6, "guild.member"], [7, "guild.event"]]);
  assert.deepEqual(st.events.slice(1, 4).map(e => e.data.event.title), ["Raid 1", "Raid 2", "Raid 3"]);
  assert.deepEqual(st.events[1].data, { guildId: g.guildId, event: eventBody("raid1", "Abel", { title: "Raid 1" }) });
  assert.deepEqual(st.events[4].data, { guildId: g.guildId, eventId: "raid1", signup: { who: who("Cy"), answer: "healer", version: 1, via: "game" } });
  assert.deepEqual(st.events[5].data, { guildId: g.guildId, members: 3 });
  assert.equal(st.events[6].data.event.cancelled, true);
  assert.ok(!st.text.includes("before"), "no replay of older events");
  assert.ok(!st.text.includes(dan.token) && !st.text.includes(cy.token), "no token ever travels on the stream");
});

test("stream: a ping comment every 20 seconds, and the server closes after 55 minutes", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const st = await openStream(s.base, await liveSession(s, uuid(), []));
  await st.until(x => x.events.length === 1);
  s.clock.t += 19_000; s.live.tick();
  await settle();
  assert.deepEqual(st.comments, [], "not yet");
  s.clock.t += 1_000; s.live.tick();
  await st.until(x => x.comments.length === 1);
  assert.match(st.text, /\n: ping\n\n$/);
  s.clock.t += 5_000; s.live.tick();
  s.clock.t += 15_000; s.live.tick();
  await st.until(x => x.comments.length === 2);
  for (let i = 0; i < 3; i++) { s.clock.t += 20_000; s.live.tick(); }
  await st.until(x => x.comments.length === 5);
  assert.deepEqual(st.comments, ["ping", "ping", "ping", "ping", "ping"]);
  assert.equal(st.events.length, 1, "pings are comments, not events");
  assert.equal(st.closed, false);
  // 55 minutes after it opened, the server ends the stream; the client is expected to start over.
  s.clock.t = T0 + 55 * 60_000 - 1000; s.live.tick();
  await settle();
  assert.equal(st.closed, false);
  s.clock.t = T0 + 55 * 60_000; s.live.tick();
  await st.until(x => x.closed);
  assert.equal(s.live.hub.stats().streams, 0);
});

test("stream tokens: one use, sixty seconds, never guessable", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const install = uuid();
  const token = await liveSession(s, install, []);
  const st = await openStream(s.base, token);
  t.after(() => st.close());
  assert.equal(st.status, 200);
  // The same token again: refused, and it tells nothing.
  const again = await api(s, "GET", `/v1/live/stream?s=${token}`);
  assert.deepEqual([again.status, again.body], [404, { ok: false, error: "not_found" }]);
  assert.deepEqual((await api(s, "GET", `/v1/live/stream?s=${"x".repeat(43)}`)).status, 404);
  assert.equal((await api(s, "GET", "/v1/live/stream?s=short")).status, 400);
  assert.equal((await api(s, "GET", "/v1/live/stream")).status, 400);
  assert.equal((await api(s, "GET", `/v1/live/stream?s=${token}&debug=1`)).status, 400);
  assert.equal((await api(s, "POST", "/v1/live/stream", {})).status, 405);
  assert.equal((await call(s.base, "HEAD", `/v1/live/stream?s=${token}`)).status, 405);
  // A token that was never used runs out after 60 seconds.
  const late = await liveSession(s, install, []);
  s.clock.t += 60_000;
  assert.equal((await api(s, "GET", `/v1/live/stream?s=${late}`)).status, 404);
  const fresh = await liveSession(s, install, []);
  s.clock.t += 59_000;
  const ok = await openStream(s.base, fresh);
  assert.equal(ok.status, 200);
  ok.close();
  // The token is not in the log, and neither is the install id.
  assert.ok(s.logs.some(l => / GET \/v1\/live\/stream 200 /.test(l)));
  assert.ok(!s.logs.join("\n").includes(token) && !s.logs.join("\n").includes(install));
  // A blocked install gets no session.
  s.store.blockInstall(hashInstall(SALT, install));
  assert.equal((await post(s.base, "/v1/live/session", { schema: 1, installId: install, subs: [] })).status, 403);
  assert.equal((await post(s.base, "/v1/live/session", { schema: 1, installId: uuid(), subs: [], extra: 1 })).status, 400);
  assert.equal((await post(s.base, "/v1/live/session", JSON.stringify({ schema: 1, installId: uuid(), subs: [], pad: "x".repeat(5000) }))).status, 413);
});

test("stream caps: two per install (the oldest gives way), a global limit answered with 503 busy, clean-up on disconnect", async (t) => {
  const s = await boot({ ...MANY_LIVE, live: { maxStreams: 3 } }); t.after(() => s.close());
  const a = uuid(), open = async (install) => openStream(s.base, await liveSession(s, install, []));
  const one = await open(a), two = await open(a);
  await two.until(x => x.events.length === 1);
  assert.equal(s.live.hub.stats().streams, 2);
  const three = await open(a);
  await one.until(x => x.closed);
  assert.equal(three.status, 200);
  assert.equal(two.closed, false);
  assert.equal(s.live.hub.stats().streams, 2, "never more than two for one install");
  // The global cap.
  const other = await open(uuid());
  assert.equal(s.live.hub.stats().streams, 3);
  const refusedToken = await liveSession(s, uuid(), []);
  const refused = await call(s.base, "GET", `/v1/live/stream?s=${refusedToken}`);
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), { ok: false, error: "busy" });
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.equal(s.live.hub.stats().refused, 1);
  // A client that goes away is forgotten at once: its place is free again and no topic keeps pointing at it.
  other.close(); three.close();
  for (let i = 0; i < 50 && s.live.hub.stats().streams !== 1; i++) await settle(10);
  assert.equal(s.live.hub.stats().streams, 1);
  const again = await open(uuid());
  assert.equal(again.status, 200);
  again.close(); two.close();
  for (let i = 0; i < 50 && s.live.hub.stats().streams !== 0; i++) await settle(10);
  assert.deepEqual((({ streams, topics }) => ({ streams, topics }))(s.live.hub.stats()), { streams: 0, topics: 0 });
  assert.equal(s.live.hub.stats().opened, 5);
});

test("stream isolation: guild events reach only that guild's members; a wrong or foreign token subscribes to nothing", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = await makeGuild(s, { guildName: "Alpha" }), b = await makeGuild(s, { guildName: "Beta", leader: "Bert" });
  const am = await joinGuild(s, a, "Amy", 5), bm = await joinGuild(s, b, "Bea", 5);
  const sa = await openStream(s.base, await liveSession(s, am.installId, [guildSub(a, am)]));
  const sb = await openStream(s.base, await liveSession(s, bm.installId, [guildSub(b, bm)]));
  // Attempts to listen to guild B without being in it: A's token with B's id, a made-up token, and no guild at all.
  const spy1 = await openStream(s.base, await liveSession(s, am.installId, [{ t: "guild", guildId: b.guildId, member: am.token }]));
  const spy2 = await openStream(s.base, await liveSession(s, uuid(), [{ t: "guild", guildId: b.guildId, member: "x".repeat(43) }]));
  const spy3 = await openStream(s.base, await liveSession(s, uuid(), []));
  const all = [sa, sb, spy1, spy2, spy3];
  t.after(() => all.forEach(x => x.close()));
  await Promise.all(all.map(x => x.until(y => y.events.length >= 1)));

  await api(s, "PUT", `/v1/guilds/${b.guildId}/events/secret`, eventBody("secret", "Bert", { title: "Beta only" }), b.H);
  await api(s, "PUT", `/v1/guilds/${b.guildId}/events/secret/signups/Bea`, signupBody("Bea"), bm.H);
  await api(s, "PUT", `/v1/guilds/${a.guildId}/events/open`, eventBody("open", "Abel", { title: "Alpha only" }), a.H);
  await sb.until(x => x.events.length === 3);
  await sa.until(x => x.events.length === 2);
  await settle(60);
  assert.deepEqual(names(sb), ["hello", "guild.event", "guild.signup"]);
  assert.deepEqual(names(sa), ["hello", "guild.event"]);
  assert.equal(sa.events[1].data.event.title, "Alpha only");
  for (const [i, spy] of [spy1, spy2, spy3].entries()) {
    assert.deepEqual(names(spy), ["hello"], `spy ${i + 1} received nothing`);
    assert.ok(!spy.text.includes("Beta"));
  }
  assert.ok(!sa.text.includes("Beta") && !sb.text.includes("Alpha"));

  // A removed member stops receiving at once, on the stream that is already open.
  assert.equal((await api(s, "DELETE", `/v1/guilds/${b.guildId}/members/Bea`, undefined, b.H)).status, 200);
  await api(s, "PUT", `/v1/guilds/${b.guildId}/events/after`, eventBody("after", "Bert", { title: "After Bea left" }), b.H);
  await settle(60);
  assert.ok(!sb.text.includes("After Bea left"));
  assert.deepEqual(names(sb), ["hello", "guild.event", "guild.signup"]);
  // A token handed out before the removal is worth nothing for that guild either.
  const cm = await joinGuild(s, b, "Cal", 5);
  const pending = await liveSession(s, cm.installId, [guildSub(b, cm)]);
  await api(s, "POST", `/v1/guilds/${b.guildId}/leave`, { schema: 1 }, cm.H);
  const late = await openStream(s.base, pending);
  t.after(() => late.close());
  await late.until(x => x.events.length >= 1);
  await api(s, "PUT", `/v1/guilds/${b.guildId}/events/after2`, eventBody("after2", "Bert", { title: "After Cal left" }), b.H);
  await settle(60);
  assert.deepEqual(names(late), ["hello"]);

  // Forget closes that install's streams; deleting the guild tells its members once (members: 0) and ends the subscription.
  const lead = await openStream(s.base, await liveSession(s, b.installId, [guildSub(b, b)]));
  t.after(() => lead.close());
  await lead.until(x => x.events.length >= 1);
  await post(s.base, "/v1/forget", { schema: 1, installId: am.installId });
  await sa.until(x => x.closed);
  await spy1.until(x => x.closed);
  await api(s, "DELETE", `/v1/guilds/${b.guildId}`, undefined, b.H);
  await lead.until(x => x.events.length === 2);
  assert.deepEqual(lead.events[1], { id: 2, event: "guild.member", data: { guildId: b.guildId, members: 0 } });
  assert.equal(s.live.hub.stats().topics, 0);
});

test("ticket events: an admin reply or a status change reaches only the stream that showed the ticket's key", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = await admin(s), install = uuid();
  const mine = await (await post(s.base, "/v1/tickets", ticket(install))).json(), theirs = await (await post(s.base, "/v1/tickets", ticket(uuid()))).json();
  const sub = (list) => [{ t: "tickets", tickets: list }];
  const owner = await openStream(s.base, await liveSession(s, install, sub([{ ticket: mine.ticket, key: mine.key }])));
  const wrongKey = await openStream(s.base, await liveSession(s, uuid(), sub([{ ticket: mine.ticket, key: theirs.key }, { ticket: "BF-9999", key: mine.key }])));
  const none = await openStream(s.base, await liveSession(s, uuid(), []));
  const all = [owner, wrongKey, none];
  t.after(() => all.forEach(x => x.close()));
  await Promise.all(all.map(x => x.until(y => y.events.length >= 1)));

  const act = (p, fields) => form(s.base, `/admin/tickets/${mine.ticket}/${p}`, { csrf: a.csrf, ...fields }, { cookie: a.cookie });
  assert.equal((await act("note", { text: "Internal: looks like a data problem" })).status, 303);
  assert.equal((await act("reply", { text: "Which tree did you pick?", status: "question" })).status, 303);
  await owner.until(x => x.events.length === 2);
  assert.deepEqual(owner.events[1], { id: 2, event: "ticket", data: { ticket: mine.ticket, status: "question", fixedIn: null, unread: 1, lastId: 2 } });
  assert.equal((await act("update", { status: "fixed", fixedIn: "1.27.0", severity: "", tags: "", assignee: "", github: "", duplicateOf: "" })).status, 303);
  await owner.until(x => x.events.length === 3);
  assert.deepEqual(owner.events[2].data, { ticket: mine.ticket, status: "fixed", fixedIn: "1.27.0", unread: 1, lastId: 2 });
  // Handling fields the player cannot see publish nothing.
  assert.equal((await act("update", { status: "fixed", fixedIn: "1.27.0", severity: "high", tags: "talents", assignee: "", github: "", duplicateOf: "" })).status, 303);
  // The player's own reply (from another window, say) also shows up; it clears the unread count.
  assert.equal((await post(s.base, `/v1/tickets/${mine.ticket}/messages`, { schema: 1, text: "The fire tree." }, { "X-BF-Ticket-Key": mine.key })).status, 201);
  await owner.until(x => x.events.length === 4);
  assert.deepEqual(owner.events[3].data, { ticket: mine.ticket, status: "looking", fixedIn: "1.27.0", unread: 0, lastId: 3 });
  assert.equal((await form(s.base, "/admin/tickets/bulk", new URLSearchParams([["csrf", a.csrf], ["action", "close"], ["id", String(Number(mine.ticket.slice(3)))]]), { cookie: a.cookie })).status, 303);
  await owner.until(x => x.events.length === 5);
  assert.equal(owner.events[4].data.status, "closed");
  await settle(60);
  assert.deepEqual(names(wrongKey), ["hello"], "the right ticket number with another ticket's key hears nothing");
  assert.deepEqual(names(none), ["hello"]);
  for (const st of all) assert.ok(!st.text.includes("Internal") && !st.text.includes("Which tree"), "no message text and no note on the stream");
});

test("party board events: put and gone, to the same realm and faction only", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const lfg = (realm, faction) => [{ t: "lfg", realm, faction }];
  const here = await openStream(s.base, await liveSession(s, uuid(), lfg("thunder hold", "horde")));
  const otherFaction = await openStream(s.base, await liveSession(s, uuid(), lfg(REALM, "alliance")));
  const otherRealm = await openStream(s.base, await liveSession(s, uuid(), lfg("Other Realm", "horde")));
  const all = [here, otherFaction, otherRealm];
  t.after(() => all.forEach(x => x.close()));
  await Promise.all(all.map(x => x.until(y => y.events.length >= 1)));
  const a = uuid(), id = (c) => c.repeat(16);
  await api(s, "PUT", `/v1/lfg/${id("A")}`, listingBody(a, id("A")));
  await api(s, "PUT", `/v1/lfg/${id("B")}`, listingBody(a, id("B"), {}, { note: "Second try" })); // replaces A
  await api(s, "DELETE", `/v1/lfg/${id("B")}`, { schema: 1, installId: a });
  await api(s, "PUT", `/v1/lfg/${id("C")}`, listingBody(uuid(), id("C")));
  s.clock.t += 31 * 60_000; s.live.tick();
  await here.until(x => x.events.length === 7);
  await settle(60);
  assert.deepEqual(here.events.slice(1).map(e => [e.event, e.data.op, e.data.listing.id]), [["lfg", "put", id("A")], ["lfg", "gone", id("A")], ["lfg", "put", id("B")], ["lfg", "gone", id("B")], ["lfg", "put", id("C")], ["lfg", "gone", id("C")]]);
  assert.deepEqual(Object.keys(here.events[1].data.listing).sort(), ["at", "class", "id", "kind", "level", "need", "note", "place", "roles", "who"]);
  assert.deepEqual(names(otherFaction), ["hello"]);
  assert.deepEqual(names(otherRealm), ["hello"]);
});

// A stand-in for an HTTP response: enough for the hub, with a buffer the test can fill.
function fakeResponse() {
  const res = new EventEmitter();
  Object.assign(res, { written: [], writableLength: 0, destroyed: false, writableEnded: false, headers: null,
    writeHead(status, headers) { res.headers = headers; }, flushHeaders() {},
    write(chunk) { res.written.push(chunk); return res.writableLength < 1000; },
    end(chunk) { if (chunk) res.written.push(chunk); res.writableEnded = true; res.emit("close"); },
    destroy() { res.destroyed = true; res.emit("close"); } });
  return res;
}

test("hub: a reader that does not keep up is cut off instead of buffered; errors are counted; publish never throws", () => {
  const clock = { t: T0 };
  const hub = new Hub({ now: () => clock.t, options: { maxBufferBytes: 1000, perInstall: 2 } });
  const open = (install, topics) => { const res = fakeResponse(); return { res, stream: hub.open(hub.redeem(hub.issue(install, topics).token), { socket: null }, res, {}) }; };
  const fast = open("a", ["g:1"]), slow = open("b", ["g:1"]), other = open("c", ["g:2"]);
  assert.equal(hub.publish("g:1", "guild.event", { n: 1 }), 2);
  assert.equal(hub.publish("g:nobody", "guild.event", { n: 1 }), 0);
  slow.res.writableLength = 5000; // the client stopped reading
  assert.equal(hub.publish("g:1", "guild.event", { n: 2 }), 1);
  assert.equal(slow.res.destroyed, true);
  assert.deepEqual((({ streams, errors, slow: s2 }) => ({ streams, errors, slow: s2 }))(hub.stats()), { streams: 2, errors: 1, slow: 1 });
  assert.equal(hub.publish("g:1", "guild.event", { n: 3 }), 1, "the others carry on");
  assert.deepEqual(fast.res.written.map(c => /^id: (\d+)\nevent: ([a-z.]+)\n/.exec(c).slice(1).join(" ")), ["1 hello", "2 guild.event", "3 guild.event", "4 guild.event"]);
  assert.equal(other.res.written.length, 1);
  // A write that throws, and a socket error, are counted and the stream is dropped.
  fast.res.write = () => { throw new Error("EPIPE"); };
  assert.equal(hub.publish("g:1", "guild.event", { n: 4 }), 0);
  other.res.emit("error", new Error("ECONNRESET"));
  assert.deepEqual((({ streams, errors, topics }) => ({ streams, errors, topics }))(hub.stats()), { streams: 0, errors: 3, topics: 0 });
  assert.equal(hub.stats().lastErrorAt, T0);
  // Each data line is one JSON object on one line, whatever the text in it.
  const odd = open("d", ["g:3"]);
  hub.publish("g:3", "guild.event", { title: "line one\nline two\r\n\ndata: fake\nevent: ticket" });
  const frame = odd.res.written[1];
  assert.equal(frame.split("\n").length, 5, "id, event, data and the two line ends: nothing a title can add");
  assert.deepEqual(JSON.parse(frame.split("\n")[2].slice(6)), { title: "line one\nline two\r\n\ndata: fake\nevent: ticket" });
  // Tokens: one use, they run out, and a flood of unused ones is bounded.
  const tk = hub.issue("e", ["g:9"]);
  assert.ok(hub.redeem(tk.token));
  assert.equal(hub.redeem(tk.token), null);
  const old = hub.issue("e", []);
  clock.t += 60_000;
  assert.equal(hub.redeem(old.token), null);
  const small = new Hub({ now: () => clock.t, options: { maxPendingTokens: 2 } });
  assert.ok(small.issue("a", [])); assert.ok(small.issue("a", []));
  assert.equal(small.issue("a", []), null);
  clock.t += 60_000;
  assert.ok(small.issue("a", []), "expired tokens make room");
  assert.equal(topic.lfg("thunder hold", "horde"), "l:horde|thunder hold");
});

// A stand-in for the web server's proxy in front of the service. mode: "pass" hands every piece on as it
// comes (what mod_proxy_http does), "buffer" holds the answer back until it is complete, "gzip" compresses.
async function frontProxy(target, mode = "pass") {
  const http = require("node:http"), zlib = require("node:zlib");
  const upstream = new URL(target), seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const up = http.request({ host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: { ...req.headers, host: upstream.host, "x-forwarded-for": "203.0.113.9" } }, (r) => {
      if (mode === "buffer") { const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => { res.writeHead(r.statusCode, r.headers); res.end(Buffer.concat(chunks)); }); return; }
      if (mode === "gzip" && /event-stream/.test(r.headers["content-type"] || "")) { res.writeHead(r.statusCode, { ...r.headers, "content-encoding": "gzip" }); r.pipe(zlib.createGzip()).pipe(res); return; }
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => res.destroy());
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

test("behind a proxy: events arrive one by one through a pass-through proxy; the stream check tells buffering and compression apart", async (t) => {
  const { check } = require("../tools/stream-check");
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const pass = await frontProxy(s.base), buffering = await frontProxy(s.base, "buffer"), zipping = await frontProxy(s.base, "gzip");
  t.after(() => Promise.all([pass.close(), buffering.close(), zipping.close()]));
  const g = await makeGuild(s);
  // Everything the app does works through the proxy, and the stream delivers while it stays open.
  const st = await openStream(pass.base, await liveSession({ base: pass.base }, g.installId, [guildSub(g, g)]));
  t.after(() => st.close());
  await st.until(x => x.events.length === 1);
  assert.equal(st.headers["content-encoding"], undefined, "the service never compresses the stream itself");
  assert.equal(st.headers["content-length"], undefined);
  assert.equal(st.headers["x-accel-buffering"], "no");
  await call(pass.base, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await st.until(x => x.events.length === 2);
  s.clock.t += 20_000; s.live.tick();
  await st.until(x => x.comments.length === 1);
  assert.equal(st.closed, false, "each piece arrived while the connection stayed open");
  assert.deepEqual(await check(pass.base, { pings: 0 }).then(r => [r.ok, r.status, r.encoding]), [true, 200, null]);
  // A proxy that holds the answer back, and one that compresses it, are both reported in plain words.
  const held = await check(buffering.base, { pings: 0, helloMs: 400 });
  assert.deepEqual([held.ok, held.why], [false, "no hello within 0.4 seconds: the stream is being buffered"]);
  const zipped = await check(zipping.base, { pings: 0, helloMs: 400 });
  assert.deepEqual([zipped.ok, zipped.why], [false, "the answer is compressed (gzip): switch compression off for /v1/live/stream"]);
  await assert.rejects(check("ftp://example.invalid"), /give the address of the service/);
  await assert.rejects(check(`${pass.base}/v1/health`), /give the address of the service/);
  assert.ok(pass.seen.every(u => !u.includes(g.token)), "no member token is ever in an address");
});

test("deploy: the web-server block sends /discord/ to the service, HTTPS only, and keeps compression off the stream", () => {
  const fs = require("node:fs"), path = require("node:path");
  const lines = fs.readFileSync(path.join(__dirname, "..", "deploy", "htaccess-snippet.conf"), "utf8").split("\n").filter(l => l && !l.startsWith("#"));
  assert.deepEqual(lines, [
    "RewriteEngine On",
    "RewriteCond %{HTTPS} !=on",
    "RewriteRule ^(v1|admin|discord)(/|$) https://%{HTTP_HOST}%{REQUEST_URI} [R=308,L]",
    'SetEnvIf Request_URI "^/v1/live/stream$" no-gzip=1 dont-vary=1',
    "RewriteRule ^v1/live/stream$ http://127.0.0.1:5081/v1/live/stream [P,L,QSA,E=no-gzip:1,E=dont-vary:1]",
    "RewriteRule ^v1/(.*)$ http://127.0.0.1:5081/v1/$1 [P,L,QSA]",
    "RewriteRule ^discord/(.*)$ http://127.0.0.1:5081/discord/$1 [P,L,QSA]",
    "RewriteRule ^admin$ /admin/ [R=308,L]",
    "RewriteRule ^admin/(.*)$ http://127.0.0.1:5081/admin/$1 [P,L,QSA]",
  ]);
  // The stream's own rule comes before the general /v1/ rule, or it would never be reached.
  assert.ok(lines.findIndex(l => l.includes("^v1/live/stream$ ")) < lines.findIndex(l => l.startsWith("RewriteRule ^v1/(.*)$")));
});
