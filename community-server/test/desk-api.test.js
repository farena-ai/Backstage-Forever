"use strict";
// The public Backstage Desk API (CLIENT-CONTRACT.md D1 to D9) against the real HTTP server.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { hashInstall } = require("../lib/store");
const { SALT, DAY, uuid, heartbeat, ticket, errorReport, boot, post, submit } = require("./helpers");

const KEY = "X-BF-Ticket-Key";
const read = (s, id, key, q = "") => fetch(`${s.base}/v1/tickets/${id}${q}`, { headers: key === undefined ? {} : { [KEY]: key } });
const reply = (s, id, key, text) => post(s.base, `/v1/tickets/${id}/messages`, { schema: 1, text }, key === undefined ? {} : { [KEY]: key });
const del = (s, id, key) => fetch(`${s.base}/v1/tickets/${id}`, { method: "DELETE", headers: key === undefined ? {} : { [KEY]: key } });
const sync = async (s, tickets) => (await post(s.base, "/v1/tickets/sync", { schema: 1, tickets })).json();
async function open(s, installId = uuid(), extra = {}) {
  const res = await post(s.base, "/v1/tickets", ticket(installId, extra));
  assert.equal(res.status, 201);
  return { installId, ...(await res.json()) };
}
const NOT_FOUND = { ok: false, error: "not_found" };

test("D9: health says desk is there", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const h = await (await fetch(`${s.base}/v1/health`)).json();
  assert.equal(h.desk, true);
  assert.equal(h.service, "bf-community");
  assert.equal(h.packFormat, 1);
});

test("D1: one heartbeat row per install per UTC day; last values win", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = uuid(), hash = hashInstall(SALT, a);
  const rows = () => s.store.db.prepare("SELECT * FROM heartbeats WHERE install = ? ORDER BY day").all(hash);

  const first = await post(s.base, "/v1/heartbeat", heartbeat(a));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(first.headers.get("set-cookie"), null);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].day, "2026-11-24");
  assert.equal(rows()[0].flags, 1 | 2 | 8);
  assert.equal(rows()[0].areas, 1 | 2 | 4);

  // Same day again, with other values: still one row, and it holds the new values.
  s.clock.t += 3 * 3600_000;
  assert.equal((await post(s.base, "/v1/heartbeat", heartbeat(a, { appVersion: "1.26.1", lang: "de", areas: ["talents"], flags: { gameConnected: true, addonInstalled: true, liveLink: true, sharing: false } }))).status, 200);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].app_version, "1.26.1");
  assert.equal(rows()[0].lang, "de");
  assert.equal(rows()[0].flags, 1 | 2 | 4);
  assert.equal(rows()[0].areas, 1 << 6);

  // The next UTC day makes a second row; the first-seen day does not move.
  s.clock.t += DAY;
  assert.equal((await post(s.base, "/v1/heartbeat", heartbeat(a))).status, 200);
  assert.deepEqual(rows().map(r => r.day), ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(s.store.db.prepare("SELECT day FROM first_seen WHERE install = ?").all(hash).map(r => r.day), ["2026-11-24"]);

  // Only the hash is stored.
  const dump = JSON.stringify(s.store.db.prepare("SELECT * FROM heartbeats").all()) + JSON.stringify(s.store.db.prepare("SELECT * FROM first_seen").all());
  assert.ok(!dump.includes(a));
});

test("D1: more than six a day are accepted and ignored; blocked installs get 403; strict body", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = uuid(), hash = hashInstall(SALT, a);
  for (let i = 0; i < 6; i++) assert.equal((await post(s.base, "/v1/heartbeat", heartbeat(a, { osMajor: String(i) }))).status, 200);
  const seventh = await post(s.base, "/v1/heartbeat", heartbeat(a, { osMajor: "99" }));
  assert.equal(seventh.status, 200);
  assert.deepEqual(await seventh.json(), { ok: true });
  assert.equal(s.store.db.prepare("SELECT os_major FROM heartbeats WHERE install = ?").get(hash).os_major, "5");

  const b = uuid();
  s.store.blockInstall(hashInstall(SALT, b));
  const blocked = await post(s.base, "/v1/heartbeat", heartbeat(b));
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { ok: false, error: "blocked" });

  const invalid = await post(s.base, "/v1/heartbeat", heartbeat(uuid(), { hostname: "my-pc" }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).detail, /hostname: unknown field/);
  const big = await post(s.base, "/v1/heartbeat", JSON.stringify({ ...heartbeat(uuid()), pad: "x".repeat(2100) }));
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${s.base}/v1/heartbeat`)).status, 405);
});

test("D2/D3: a ticket is created, the key is shown once and only its hash is stored", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const res = await post(s.base, "/v1/tickets", ticket(uuid()));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const made = await res.json();
  assert.deepEqual(Object.keys(made).sort(), ["createdAt", "key", "ok", "status", "ticket"]);
  assert.equal(made.ticket, "BF-1001");
  assert.match(made.key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(made.key, "base64url").length, 32);
  assert.equal(made.status, "new");
  assert.equal(made.createdAt, "2026-11-24T12:00:00Z");

  const row = s.store.db.prepare("SELECT * FROM tickets WHERE id = 1001").get();
  assert.equal(row.key_hash, crypto.createHash("sha256").update(made.key).digest("hex"));
  assert.ok(!JSON.stringify(row).includes(made.key));
  assert.match(row.install, /^[0-9a-f]{64}$/);

  const got = await read(s, made.ticket, made.key);
  assert.equal(got.status, 200);
  assert.deepEqual(await got.json(), {
    ok: true, ticket: "BF-1001", status: "new", fixedIn: null, kind: "bug", area: "talents", summary: "Planner shows the wrong tree",
    createdAt: "2026-11-24T12:00:00Z", updatedAt: "2026-11-24T12:00:00Z",
    messages: [{ id: 1, from: "player", text: "Steps: open the planner, pick a tree.", at: "2026-11-24T12:00:00Z" }],
  });
  assert.equal((await post(s.base, "/v1/tickets", ticket(uuid()))).status, 201);
  assert.equal((await (await read(s, "BF-1002", "A".repeat(43))).json()).error, "not_found");
});

test("D3: internal notes and admin names never reach the player; since returns only newer messages", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s), id = 1001;
  const adminId = Number(s.store.db.prepare("INSERT INTO admins(name, pw_hash, totp_secret, created_at) VALUES ('secretname', 'x', 'x', 'x')").run().lastInsertRowid);
  s.store.desk.addNote(id, adminId, "INTERNAL-ONLY note text", s.clock.t);
  s.clock.t += 60_000;
  s.store.desk.adminReply(id, adminId, "Which class was this on?", "question", s.clock.t);
  s.store.desk.addNote(id, adminId, "second INTERNAL-ONLY", s.clock.t);
  s.store.desk.updateTicket(id, { tags: "private-tag", severity: "high", github: "https://github.com/farena-ai/Backstage-Forever/issues/1" }, s.clock.t);

  const body = await (await read(s, a.ticket, a.key)).text();
  assert.ok(!body.includes("INTERNAL-ONLY"));
  assert.ok(!body.includes("secretname"));
  assert.ok(!body.includes("private-tag") && !body.includes("severity") && !body.includes("github"));
  const j = JSON.parse(body);
  assert.equal(j.status, "question");
  assert.deepEqual(j.messages.map(m => [m.id, m.from]), [[1, "player"], [2, "team"]]); // ids have no gaps where notes are
  assert.deepEqual(Object.keys(j.messages[1]).sort(), ["at", "from", "id", "text"]);
  assert.equal(j.updatedAt, "2026-11-24T12:01:00Z");

  const newer = await (await read(s, a.ticket, a.key, "?since=1")).json();
  assert.deepEqual(newer.messages.map(m => m.id), [2]);
  assert.deepEqual((await (await read(s, a.ticket, a.key, "?since=2")).json()).messages, []);
  assert.equal((await read(s, a.ticket, a.key, "?since=x")).status, 400);
  assert.equal((await read(s, a.ticket, a.key, "?other=1")).status, 400);
});

test("isolation: install A cannot read, reply to, sync or delete install B's ticket", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s), b = await open(s);
  assert.notEqual(a.key, b.key);

  // Every wrong-key answer is byte-for-byte the answer for a ticket that does not exist.
  for (const res of [
    await read(s, b.ticket, a.key), await read(s, "BF-9999", a.key), await read(s, b.ticket), await read(s, b.ticket, ""), await read(s, b.ticket, "short"),
    await read(s, b.ticket, b.key.slice(0, 42) + (b.key.endsWith("A") ? "B" : "A")), await read(s, b.ticket, b.key.toUpperCase() === b.key ? b.key.toLowerCase() : b.key.toUpperCase()),
    await read(s, "bf-1002", b.key), await read(s, "BF-1002%20", b.key), await read(s, "1002", b.key),
    await reply(s, b.ticket, a.key, "let me in"), await reply(s, "BF-9999", a.key, "let me in"), await reply(s, b.ticket, undefined, "let me in"),
    await del(s, b.ticket, a.key), await del(s, "BF-9999", a.key), await del(s, b.ticket),
  ]) {
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), NOT_FOUND);
  }
  // The install id is not a credential either.
  assert.equal((await read(s, b.ticket, b.installId)).status, 404);
  assert.equal((await fetch(`${s.base}/v1/tickets/${b.ticket}?key=${b.key}`)).status, 404); // a key in the URL is not a key

  // Nothing was changed on B's ticket.
  const still = await (await read(s, b.ticket, b.key)).json();
  assert.equal(still.messages.length, 1);
  assert.equal(still.status, "new");

  // Sync: B's ticket with A's key is "gone", exactly like a ticket that never existed.
  const out = await sync(s, [{ ticket: a.ticket, key: a.key, since: 0 }, { ticket: b.ticket, key: a.key, since: 0 }, { ticket: "BF-9999", key: a.key }]);
  assert.deepEqual(out.tickets.map(x => x.ticket), [a.ticket]);
  assert.deepEqual(out.gone, [b.ticket, "BF-9999"]);
});

test("the ticket key is compared in constant time, also when the ticket does not exist", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s);
  const real = crypto.timingSafeEqual;
  const calls = [];
  crypto.timingSafeEqual = (x, y) => { calls.push([x.length, y.length]); return real(x, y); };
  t.after(() => { crypto.timingSafeEqual = real; });

  assert.equal((await read(s, a.ticket, a.key)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await read(s, a.ticket, "B".repeat(43))).status, 404);
  assert.equal(calls.length, 2);
  assert.equal((await read(s, "BF-9999", a.key)).status, 404); // no such ticket: still one full comparison
  assert.equal(calls.length, 3);
  await sync(s, [{ ticket: a.ticket, key: a.key }, { ticket: "BF-9998", key: a.key }]);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(([x, y]) => x === 32 && y === 32), "always two SHA-256 digests");

  // An internal ticket (no player, no key) can never be reached, whatever is sent.
  const g = s.store.db.prepare("INSERT INTO tickets(key_hash, install, status, kind, area, summary, created_at, updated_at) VALUES (NULL, NULL, 'looking', 'bug', 'other', 'internal', 'x', 'x')").run();
  assert.equal((await read(s, `BF-${g.lastInsertRowid}`, a.key)).status, 404);
  assert.equal((await read(s, `BF-${g.lastInsertRowid}`, "")).status, 404);
});

test("D4: a player reply is stored and re-opens a fixed or closed ticket", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s), id = 1001;
  s.clock.t += 60_000;
  const r1 = await reply(s, a.ticket, a.key, "More detail:\nit happens on my druid.");
  assert.equal(r1.status, 201);
  assert.deepEqual(await r1.json(), { ok: true, id: 2, at: "2026-11-24T12:01:00Z", status: "new" });

  for (const closedAs of ["fixed", "closed"]) {
    s.store.desk.updateTicket(id, { status: closedAs, fixedIn: "1.26.1" }, s.clock.t);
    assert.equal((await (await read(s, a.ticket, a.key)).json()).status, closedAs);
    s.clock.t += 60_000;
    const r = await (await reply(s, a.ticket, a.key, "It is back.")).json();
    assert.equal(r.status, "looking");
    assert.equal(s.store.db.prepare("SELECT closed_at FROM tickets WHERE id = ?").get(id).closed_at, null);
  }
  const final = await (await read(s, a.ticket, a.key)).json();
  assert.equal(final.fixedIn, "1.26.1");
  assert.deepEqual(final.messages.map(m => m.id), [1, 2, 3, 4]);
  assert.equal(final.messages[1].text, "More detail:\nit happens on my druid.");

  assert.equal((await reply(s, a.ticket, a.key, "")).status, 400);
  assert.equal((await reply(s, a.ticket, a.key, "x".repeat(4001))).status, 400);
  assert.equal((await post(s.base, `/v1/tickets/${a.ticket}/messages`, { schema: 1, text: "ok", installId: a.installId }, { [KEY]: a.key })).status, 400);
  assert.equal((await post(s.base, `/v1/tickets/${a.ticket}/messages`, JSON.stringify({ schema: 1, text: "x".repeat(13000) }), { [KEY]: a.key })).status, 413);
  assert.equal((await fetch(`${s.base}/v1/tickets/${a.ticket}/messages`, { headers: { [KEY]: a.key } })).status, 405);

  // A blocked install cannot keep writing through an old ticket.
  s.store.blockInstall(hashInstall(SALT, a.installId));
  assert.equal((await reply(s, a.ticket, a.key, "still here")).status, 403);
  assert.equal((await read(s, a.ticket, a.key)).status, 200);
});

test("D5: sync reports status, unread team messages and the last message id", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s), b = await open(s);
  s.store.desk.adminReply(1001, null, "one", "question", s.clock.t + 1000);
  s.store.desk.addNote(1001, null, "note", s.clock.t + 1500);
  s.store.desk.adminReply(1001, null, "two", null, s.clock.t + 2000);
  s.store.desk.updateTicket(1002, { status: "fixed", fixedIn: "1.27.0" }, s.clock.t + 3000);

  const res = await post(s.base, "/v1/tickets/sync", { schema: 1, tickets: [{ ticket: a.ticket, key: a.key, since: 1 }, { ticket: b.ticket, key: b.key, since: 1 }] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    tickets: [
      { ticket: "BF-1001", status: "question", fixedIn: null, updatedAt: "2026-11-24T12:00:02Z", unread: 2, lastId: 3 },
      { ticket: "BF-1002", status: "fixed", fixedIn: "1.27.0", updatedAt: "2026-11-24T12:00:03Z", unread: 0, lastId: 1 },
    ],
    gone: [],
  });
  assert.equal((await sync(s, [{ ticket: a.ticket, key: a.key, since: 2 }])).tickets[0].unread, 1);
  assert.equal((await sync(s, [{ ticket: a.ticket, key: a.key, since: 3 }])).tickets[0].unread, 0);
  // The player's own messages are never "unread".
  await reply(s, a.ticket, a.key, "mine");
  const mine = (await sync(s, [{ ticket: a.ticket, key: a.key, since: 3 }])).tickets[0];
  assert.equal(mine.unread, 0); assert.equal(mine.lastId, 4); assert.equal(mine.status, "looking");
  assert.deepEqual(await sync(s, []), { ok: true, tickets: [], gone: [] });
  assert.equal((await post(s.base, "/v1/tickets/sync", { schema: 1, tickets: [{ ticket: a.ticket, key: a.key, extra: 1 }] })).status, 400);
});

test("D6: the player deletes a report; then it is gone for everyone", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s), b = await open(s);
  await reply(s, a.ticket, a.key, "one more");
  const res = await del(s, a.ticket, a.key);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE id = 1001").get().c, 0);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE ticket = 1001").get().c, 0);
  assert.equal((await read(s, a.ticket, a.key)).status, 404);
  assert.equal((await del(s, a.ticket, a.key)).status, 404);
  assert.deepEqual((await sync(s, [{ ticket: a.ticket, key: a.key }])).gone, [a.ticket]);
  assert.equal((await read(s, b.ticket, b.key)).status, 200);
  // A deleted number is never handed out again.
  assert.equal((await open(s)).ticket, "BF-1003");
});

test("forget deletes every ticket, message, heartbeat and first-seen row of that install, and nothing else", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = uuid(), b = uuid(), ha = hashInstall(SALT, a), hb = hashInstall(SALT, b);
  const count = (table, col, v) => s.store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(v).c;
  for (const id of [a, b]) {
    await post(s.base, "/v1/heartbeat", heartbeat(id));
    await post(s.base, "/v1/submit", submit(id, { npcs: [{ npcId: 1, mapId: 1, x: 0.5, y: 0.5 }] }));
    await post(s.base, "/v1/errors", errorReport(id));
  }
  s.clock.t += DAY;
  await post(s.base, "/v1/heartbeat", heartbeat(a));
  const a1 = await open(s, a), a2 = await open(s, a), b1 = await open(s, b);
  await reply(s, a1.ticket, a1.key, "more");
  s.store.desk.adminReply(1002, null, "team", null, s.clock.t);
  s.store.desk.addNote(1002, null, "note", s.clock.t);
  assert.equal(count("heartbeats", "install", ha), 2);
  assert.equal(count("tickets", "install", ha), 2);

  const res = await post(s.base, "/v1/forget", { schema: 1, installId: a });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, removed: { observations: 1, reports: 0 } });
  for (const table of ["heartbeats", "first_seen", "tickets", "obs"]) assert.equal(count(table, "install", ha), 0, table);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE ticket IN (1001, 1002)").get().c, 0);
  // No table anywhere still holds A's hash.
  for (const { name } of s.store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())
    assert.ok(!JSON.stringify(s.store.db.prepare(`SELECT * FROM ${name}`).all()).includes(ha), `${name} still holds the forgotten install`);
  assert.equal((await read(s, a1.ticket, a1.key)).status, 404);
  assert.deepEqual((await sync(s, [{ ticket: a1.ticket, key: a1.key }, { ticket: a2.ticket, key: a2.key }])).gone, [a1.ticket, a2.ticket]);

  // B is untouched.
  assert.equal(count("heartbeats", "install", hb), 1);
  assert.equal(count("first_seen", "install", hb), 1);
  assert.equal(count("obs", "install", hb), 1);
  assert.equal((await read(s, b1.ticket, b1.key)).status, 200);
  // Error reports are never linked to an install, so there was nothing of A's to find there.
  assert.equal(s.store.db.prepare("SELECT total FROM error_groups").get().total, 2);
});

test("rate limits and caps on the Desk endpoints", async (t) => {
  const s = await boot({ maxOpenTickets: 7, limits: { ticketGlobal: { limit: 8, windowMs: DAY } } }); t.after(() => s.close());
  const a = uuid();
  let last;
  for (let i = 0; i < 5; i++) last = await open(s, a);
  const sixth = await post(s.base, "/v1/tickets", ticket(a));
  assert.equal(sixth.status, 429);
  assert.ok(Number(sixth.headers.get("retry-after")) > 0);
  assert.deepEqual(await sixth.json(), { ok: false, error: "rate_limited" });

  // 20 replies per ticket per day.
  for (let i = 0; i < 20; i++) assert.equal((await reply(s, last.ticket, last.key, `reply ${i}`)).status, 201);
  assert.equal((await reply(s, last.ticket, last.key, "one too many")).status, 429);
  s.clock.t += DAY + 1;
  assert.equal((await reply(s, last.ticket, last.key, "next day")).status, 201);

  // Inbox full: 7 open tickets is the cap in this test.
  await open(s); await open(s);
  const full = await post(s.base, "/v1/tickets", ticket(uuid()));
  assert.equal(full.status, 503);
  assert.deepEqual(await full.json(), { ok: false, error: "report_inbox_full" });
  s.store.desk.updateTicket(1001, { status: "closed" }, s.clock.t);
  assert.equal((await post(s.base, "/v1/tickets", ticket(uuid()))).status, 201); // closing one makes room
  // Global daily cap (8 here, counted from the first ticket of the new window).
  s.store.db.exec("UPDATE tickets SET status = 'closed'");
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await post(s.base, "/v1/tickets", ticket(uuid()))).status);
  assert.ok(codes.includes(429) && codes.filter(c => c === 201).length <= 8, codes.join(","));

  // 10 automatic error reports per install per day.
  const e = uuid();
  for (let i = 0; i < 10; i++) assert.equal((await post(s.base, "/v1/errors", errorReport(e))).status, 200);
  assert.equal((await post(s.base, "/v1/errors", errorReport(e))).status, 429);

  assert.equal((await post(s.base, "/v1/tickets", JSON.stringify({ ...ticket(uuid()), pad: "x".repeat(25000) }))).status, 413);
  assert.equal((await post(s.base, "/v1/tickets", ticket(uuid()), { "Content-Type": "text/plain" })).status, 415);
  const m = await fetch(`${s.base}/v1/tickets/BF-1001`, { method: "PUT" });
  assert.equal(m.status, 405);
  assert.equal(m.headers.get("allow"), "GET, HEAD, DELETE");
});

test("D3: reads are limited per ticket key, not per ticket", async (t) => {
  const s = await boot({ limits: { ticketReadPerKey: { limit: 3, windowMs: 3600_000 } } }); t.after(() => s.close());
  const a = await open(s), b = await open(s);
  for (let i = 0; i < 3; i++) assert.equal((await read(s, a.ticket, a.key)).status, 200);
  assert.equal((await read(s, a.ticket, a.key)).status, 429);
  assert.equal((await read(s, b.ticket, b.key)).status, 200);
  // Someone hammering with a wrong key cannot lock the owner out.
  for (let i = 0; i < 5; i++) await read(s, b.ticket, "C".repeat(43));
  assert.equal((await read(s, b.ticket, b.key)).status, 200);
});

test("D7: errors are grouped by name and the first three stack lines", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const groups = () => s.store.db.prepare("SELECT * FROM error_groups ORDER BY id").all();
  const send = async (extra, id = uuid()) => { const r = await post(s.base, "/v1/errors", errorReport(id, extra)); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true }); };

  await send({});
  await send({ message: "y is not a function", stack: ["at f (app.js:10:3)", "at g (app.js:20:5)", "at h (main.cjs:30:7)", "at other (z.js:1:1)"] }); // 4th line and message differ
  await send({ appVersion: "1.26.1", stack: ["at f (app.js:11:9)", "at g (app.js:27:5)", "at h (main.cjs:33:7)"] }); // only line numbers moved
  await send({ os: "macos", where: "renderer" });
  assert.equal(groups().length, 1);
  assert.equal(groups()[0].total, 4);
  assert.equal(groups()[0].message, "x is not a function"); // the first report is the sample

  await send({ name: "RangeError" });
  await send({ stack: ["at f (app.js:10:3)", "at g (app.js:20:5)", "at DIFFERENT (main.cjs:30:7)"] });
  await send({ stack: ["at f (app.js:10:3)"] });
  await send({ stack: [] });
  assert.equal(groups().length, 5);

  s.clock.t += DAY;
  await send({});
  const occ = s.store.db.prepare("SELECT app_version, os, day, n FROM error_occurrences WHERE grp = 1 ORDER BY day, app_version, os").all();
  assert.deepEqual(occ.map(o => ({ ...o })), [
    { app_version: "1.26.0", os: "macos", day: "2026-11-24", n: 1 },
    { app_version: "1.26.0", os: "windows", day: "2026-11-24", n: 2 },
    { app_version: "1.26.1", os: "windows", day: "2026-11-24", n: 1 },
    { app_version: "1.26.0", os: "windows", day: "2026-11-25", n: 1 },
  ]);
  assert.equal(groups()[0].first_day, "2026-11-24");
  assert.equal(groups()[0].last_day, "2026-11-25");

  // No install id or hash is kept with an error, and folders are removed before storing.
  const who = uuid();
  await send({ name: "PathError", message: "ENOENT C:\\Users\\realname\\file.txt", stack: ["at f (C:\\Users\\realname\\app\\x.js:1:1)"] }, who);
  const dump = JSON.stringify(groups()) + JSON.stringify(s.store.db.prepare("SELECT * FROM error_occurrences").all());
  assert.ok(!dump.includes("realname"));
  assert.ok(!dump.includes(who) && !dump.includes(hashInstall(SALT, who)));

  const blocked = uuid();
  s.store.blockInstall(hashInstall(SALT, blocked));
  assert.equal((await post(s.base, "/v1/errors", errorReport(blocked))).status, 403);
  assert.equal((await post(s.base, "/v1/errors", errorReport(uuid(), { extra: 1 }))).status, 400);
});

test("D7: the number of error groups is capped", async (t) => {
  const s = await boot({ maxErrorGroups: 2 }); t.after(() => s.close());
  for (const name of ["A", "B", "C"]) assert.equal((await post(s.base, "/v1/errors", errorReport(uuid(), { name }))).status, 200);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM error_groups").get().c, 2);
  assert.equal((await post(s.base, "/v1/errors", errorReport(uuid(), { name: "A" }))).status, 200);
  assert.equal(s.store.db.prepare("SELECT total FROM error_groups WHERE name = 'A'").get().total, 2);
});

test("D8: announcements are targeted on the server and support ETag / 304", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const add = (a) => s.store.desk.saveAnnouncement({ title: "T", text: "Text", level: "info", link: null, from: "2026-11-24T00:00:00Z", until: "2026-12-01T00:00:00Z", minVersion: null, maxVersion: null, os: [], lang: [], ...a }, null, s.clock.t);
  const everyone = add({ title: "Everyone", link: "https://github.com/farena-ai/Backstage-Forever/releases" });
  const old = add({ title: "Old versions", maxVersion: "1.25.1", level: "warning" });
  const range = add({ title: "Exactly 1.25.x", minVersion: "1.25.0", maxVersion: "1.25.9" });
  const mac = add({ title: "macOS only", os: ["macos"] });
  const de = add({ title: "German or French", lang: ["de", "fr"] });
  add({ title: "Not yet", from: "2026-11-25T00:00:00Z" });
  add({ title: "Over", from: "2026-11-01T00:00:00Z", until: "2026-11-24T12:00:00Z" }); // until is exclusive
  const ids = async (q) => (await (await fetch(`${s.base}/v1/announcements${q}`)).json()).announcements.map(a => a.id);

  assert.deepEqual(await ids("?appVersion=1.26.0&os=windows&lang=en"), [everyone]);
  assert.deepEqual(await ids("?appVersion=1.25.1&os=windows&lang=en"), [everyone, old, range]);
  assert.deepEqual(await ids("?appVersion=1.10.0&os=windows&lang=en"), [everyone, old]); // 1.10 is newer than 1.9, older than 1.25
  assert.deepEqual(await ids("?appVersion=1.24.9&os=macos&lang=de"), [everyone, old, mac, de]);
  assert.deepEqual(await ids("?appVersion=1.26.0&os=linux&lang=fr"), [everyone, de]);
  assert.deepEqual(await ids(""), [everyone]); // no details given: only what is for everyone

  const res = await fetch(`${s.base}/v1/announcements?appVersion=1.26.0&os=windows&lang=en`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(res.headers.get("set-cookie"), null);
  const etag = res.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{20}"$/);
  assert.deepEqual(await res.json(), { ok: true, announcements: [{ id: everyone, title: "Everyone", text: "Text", level: "info", from: "2026-11-24T00:00:00Z", until: "2026-12-01T00:00:00Z", link: "https://github.com/farena-ai/Backstage-Forever/releases" }] });

  const again = await fetch(`${s.base}/v1/announcements?appVersion=1.26.0&os=windows&lang=en`, { headers: { "If-None-Match": etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal(again.headers.get("etag"), etag);
  assert.equal((await fetch(`${s.base}/v1/announcements?appVersion=1.26.0&os=windows&lang=en`, { headers: { "If-None-Match": `W/${etag}` } })).status, 304);
  assert.equal((await fetch(`${s.base}/v1/announcements?appVersion=1.25.0&os=windows&lang=en`, { headers: { "If-None-Match": etag } })).status, 200); // other audience, other content

  // Ending one changes the content and the ETag.
  s.store.desk.expireAnnouncement(everyone, s.clock.t);
  const after = await fetch(`${s.base}/v1/announcements?appVersion=1.26.0&os=windows&lang=en`, { headers: { "If-None-Match": etag } });
  assert.equal(after.status, 200);
  assert.deepEqual((await after.json()).announcements, []);
  assert.notEqual(after.headers.get("etag"), etag);

  assert.equal((await fetch(`${s.base}/v1/announcements?appVersion=latest`)).status, 400);
  assert.equal((await fetch(`${s.base}/v1/announcements?installId=${uuid()}`)).status, 400);
  assert.equal((await fetch(`${s.base}/v1/announcements`, { method: "HEAD" })).status, 200);
  assert.equal((await post(s.base, "/v1/announcements", {})).status, 405);
});

test("the service log never holds a ticket number, a key or an install id", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await open(s);
  await read(s, a.ticket, a.key);
  await reply(s, a.ticket, a.key, "hello");
  await sync(s, [{ ticket: a.ticket, key: a.key }]);
  await post(s.base, "/v1/heartbeat", heartbeat(a.installId));
  await del(s, a.ticket, a.key);
  await fetch(`${s.base}/admin/tickets/${a.ticket}`, { redirect: "manual" });
  const log = s.logs.join("\n");
  assert.match(log, /GET \/v1\/tickets\/:ticket 200/);
  assert.match(log, /POST \/v1\/tickets\/:ticket\/messages 201/);
  assert.match(log, /DELETE \/v1\/tickets\/:ticket 200/);
  for (const secret of [a.ticket, a.key, a.installId, hashInstall(SALT, a.installId), "127.0.0.1"]) assert.ok(!log.includes(secret), `log contains ${secret}`);
});
