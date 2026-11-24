"use strict";
// Backstage Live over the real HTTP server: guilds (G1-G5), events and sign-ups (E1-E3), who may
// do what, isolation between guilds, what leave / forget / delete remove, expiry, the party board
// (P1) and the upgrade of a schema 3 database that already holds data.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Store, hashInstall, SCHEMA_VERSION } = require("../lib/store");
const G = require("../lib/guilds");
const { runMaintenance } = require("../lib/maintenance");
const { SALT, T0, DAY, uuid, tempDb, asSchema3, LIVE_TABLES, ticket, heartbeat, boot, post, REALM, MANY_LIVE, who, call, answer,
  makeGuild, joinGuild, eventBody, signupBody, listingBody } = require("./helpers");

const HOUR = 3_600_000;
const count = (s, table, where = "") => s.store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c;
const api = async (s, method, p, body, headers) => answer(await call(s.base, method, p, body, headers));
const putEvent = (s, g, m, e) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/${e.id}`, e, m.H);
const putSignup = (s, g, m, eventId, body) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/${eventId}/signups/${encodeURIComponent(body.who.name)}`, body, m.H);

test("G1-G5: link a guild, join with the code, roles, thresholds, a new code, leaving", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s);
  assert.match(g.guildId, /^g_[A-Za-z0-9_-]{16}$/);
  assert.match(g.linkCode, /^BFG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, "a code people can read out: no 0, O, 1, I or L");
  assert.match(g.token, /^[A-Za-z0-9_-]{43}$/);
  // Only hashes of the code and the token are stored, and the install id only as its salted hash.
  const dump = JSON.stringify([s.store.db.prepare("SELECT * FROM guilds").all(), s.store.db.prepare("SELECT * FROM guild_members").all()]);
  for (const secret of [g.linkCode, g.linkCode.replace(/-/g, ""), g.token, g.installId]) assert.ok(!dump.includes(secret), "a secret is stored in clear");
  assert.equal(s.store.db.prepare("SELECT install FROM guild_members").get().install, hashInstall(SALT, g.installId));

  // The same guild cannot be linked twice (whatever the letter case); the answer says nothing more.
  const again = await api(s, "POST", "/v1/guilds", { schema: 1, installId: uuid(), realm: "thunder hold", faction: "horde", guildName: "NIGHT WATCH", character: who("Eve"), rankIndex: 0 });
  assert.deepEqual([again.status, again.body], [409, { ok: false, error: "exists" }]);
  assert.equal((await api(s, "POST", "/v1/guilds", { schema: 1, installId: uuid(), realm: REALM, faction: "alliance", guildName: "Night Watch", character: who("Eve"), rankIndex: 0 })).status, 201, "the other faction has its own guild of that name");

  // Joining: consent is required, a wrong code is a plain 404, the rank decides the role.
  const joinBody = (over = {}) => ({ schema: 1, installId: uuid(), linkCode: g.linkCode, character: who("Bea"), rankIndex: 1, consent: true, ...over });
  assert.equal((await api(s, "POST", "/v1/guilds/join", joinBody({ consent: false }))).status, 400);
  const noConsent = joinBody(); delete noConsent.consent;
  assert.equal((await api(s, "POST", "/v1/guilds/join", noConsent)).status, 400);
  assert.equal(count(s, "guild_members"), 2, "nothing is stored without consent");
  const wrong = await api(s, "POST", "/v1/guilds/join", joinBody({ linkCode: "BFG-2222-2222" }));
  assert.deepEqual([wrong.status, wrong.body], [404, { ok: false, error: "not_found" }]);
  const bea = await api(s, "POST", "/v1/guilds/join", joinBody());
  assert.equal(bea.status, 201);
  assert.deepEqual(Object.keys(bea.body).sort(), ["guildId", "guildName", "member", "ok", "role"]);
  assert.deepEqual([bea.body.guildId, bea.body.guildName, bea.body.role], [g.guildId, "Night Watch", "officer"]);
  const cy = await joinGuild(s, g, "Cy", 4), dan = await joinGuild(s, g, "Dan", 2);
  assert.deepEqual([cy.role, dan.role], ["member", "member"]);
  assert.equal((await joinGuild(s, g, "Gil", 0)).role, "leader", "rank 0 in the game is the guild leader");

  // A name that is already a member can be joined again only from the same install (that renews the token).
  const taken = await api(s, "POST", "/v1/guilds/join", joinBody({ character: who("cy"), rankIndex: 0 }));
  assert.deepEqual([taken.status, taken.body.error], [409, "exists"]);
  const cy2 = await joinGuild(s, g, "Cy", 4, cy.installId);
  assert.notEqual(cy2.token, cy.token);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy.H)).status, 404, "the old token stopped working");
  assert.equal(count(s, "guild_members", `WHERE guild = '${g.guildId}'`), 5);

  // G3: exactly the documented shape.
  const view = await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy2.H);
  assert.equal(view.status, 200);
  assert.deepEqual(Object.keys(view.body).sort(), ["discord", "faction", "guildId", "guildName", "members", "ok", "realm", "role", "thresholds"]);
  assert.deepEqual(view.body.thresholds, { officerRank: 1, proposeRank: 9, editRank: 1 });
  assert.deepEqual(view.body.discord, { state: "none", guildName: null, channel: null, problem: null });
  assert.equal(view.body.role, "member");
  assert.deepEqual(view.body.members.map(m => [m.name, m.role, m.discord]), [["Abel", "leader", null], ["Gil", "leader", null], ["Bea", "officer", null], ["Dan", "member", null], ["Cy", "member", null]]);
  assert.match(view.body.members[0].lastSeen, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(!JSON.stringify(view.body).includes("install"), "no install hash in the answer");

  // G4: thresholds move the officer line; the member who linked the guild stays leader.
  const patched = await api(s, "PATCH", `/v1/guilds/${g.guildId}`, { schema: 1, thresholds: { officerRank: 2, editRank: 0 } }, g.H);
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.thresholds, { officerRank: 2, proposeRank: 9, editRank: 0 });
  assert.equal(patched.body.linkCode, undefined);
  assert.deepEqual(patched.body.members.map(m => [m.name, m.role]), [["Abel", "leader"], ["Gil", "leader"], ["Bea", "officer"], ["Dan", "officer"], ["Cy", "member"]]);
  const rotated = await api(s, "PATCH", `/v1/guilds/${g.guildId}`, { schema: 1, rotateCode: true }, g.H);
  assert.match(rotated.body.linkCode, /^BFG-/);
  assert.notEqual(rotated.body.linkCode, g.linkCode);
  assert.equal((await api(s, "POST", "/v1/guilds/join", joinBody({ character: who("Fay") }))).status, 404, "the old code is dead");
  assert.equal((await api(s, "POST", "/v1/guilds/join", joinBody({ character: who("Fay"), linkCode: rotated.body.linkCode }))).status, 201);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy2.H)).status, 200, "members who already joined stay");

  // G5: leaving removes the member; when the last leader goes, the highest rank takes over; the last member takes the guild along.
  assert.deepEqual((await api(s, "POST", `/v1/guilds/${g.guildId}/leave`, { schema: 1 }, cy2.H)).body, { ok: true });
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy2.H)).status, 404);
  const gil = s.store.db.prepare("SELECT token_hash FROM guild_members WHERE name = 'Gil'").get();
  assert.ok(gil);
  s.store.guilds.removeMember(g.guildId, "gil");
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/leave`, undefined, g.H)).status, 200, "a leave with no body at all");
  assert.deepEqual(s.store.db.prepare("SELECT name, role FROM guild_members WHERE guild = ? ORDER BY rank, name_key").all(g.guildId).map(r => `${r.name}:${r.role}`), ["Bea:leader", "Fay:officer", "Dan:officer"]);
  for (const name of ["bea", "fay"]) s.store.guilds.removeMember(g.guildId, name);
  assert.equal(count(s, "guilds", `WHERE id = '${g.guildId}'`), 1);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/leave`, undefined, dan.H)).status, 200);
  assert.equal(count(s, "guilds", `WHERE id = '${g.guildId}'`), 0, "an empty guild is deleted");
});

test("G1/G2 limits: three guilds per install per day, sixty joins per code per hour, wrong codes run out", async (t) => {
  const s = await boot({ limits: { perIp: { limit: 100000, windowMs: 60_000 }, guildJoinPerCode: { limit: 3, windowMs: HOUR }, codeMissPerIp: { limit: 4, windowMs: HOUR } } }); t.after(() => s.close());
  const installId = uuid();
  const make = (n) => api(s, "POST", "/v1/guilds", { schema: 1, installId, realm: REALM, faction: "horde", guildName: `Guild ${n}`, character: who("Abel"), rankIndex: 0 });
  const made = [await make("One"), await make("Two"), await make("Three"), await make("Four")];
  assert.deepEqual(made.map(r => r.status), [201, 201, 201, 429]);
  assert.ok(Number(made[3].headers.get("retry-after")) > 0);
  s.clock.t += DAY;
  assert.equal((await make("Four")).status, 201);
  const code = made[0].body.linkCode;
  const join = (name, linkCode = code) => api(s, "POST", "/v1/guilds/join", { schema: 1, installId: uuid(), linkCode, character: who(name), rankIndex: 5, consent: true });
  assert.deepEqual([(await join("Bea")).status, (await join("Cy")).status, (await join("Dan")).status, (await join("Eve")).status], [201, 201, 201, 429]);
  const misses = [];
  for (let i = 0; i < 6; i++) misses.push((await join("Fay", `BFG-222${"23456789"[i]}-2222`)).status);
  assert.deepEqual(misses, [404, 404, 404, 404, 429, 429], "guessing codes is cut off");
  // A blocked install is refused everywhere.
  const blocked = uuid();
  s.store.blockInstall(hashInstall(SALT, blocked));
  assert.equal((await api(s, "POST", "/v1/guilds", { schema: 1, installId: blocked, realm: REALM, faction: "horde", guildName: "Blocked", character: who("Abel"), rankIndex: 0 })).status, 403);
});

test("authorisation matrix: no token, another guild's token, member, officer and leader for every action", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const other = await makeGuild(s, { guildName: "Other Guild", leader: "Zed" });
  const bodyless = (m) => ({ ...m.H });
  // [label, run(guild, who is asking as { H, name }, role name) -> response, expected status for member / officer / leader]
  const actions = [
    ["read the guild", (g, m) => api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, m.H), [200, 200, 200]],
    ["change thresholds", (g, m) => api(s, "PATCH", `/v1/guilds/${g.guildId}`, { schema: 1, thresholds: { proposeRank: 8 } }, m.H), [403, 403, 200]],
    ["rotate the code", (g, m) => api(s, "PATCH", `/v1/guilds/${g.guildId}`, { schema: 1, rotateCode: true }, m.H), [403, 403, 200]],
    ["read the events", (g, m) => api(s, "GET", `/v1/guilds/${g.guildId}/events`, undefined, m.H), [200, 200, 200]],
    ["propose an event", (g, m, role) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/own_${role}`, eventBody(`own_${role}`, m.name || "Nobody"), m.H), [200, 200, 200]],
    ["edit somebody else's event", (g, m) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/tias`, eventBody("tias", "Tia", { version: 2, editor: who(m.name || "Nobody"), title: "Changed" }), m.H), [403, 200, 200]],
    ["pass on somebody else's event", (g, m, role) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/heard_${role}`, eventBody(`heard_${role}`, "Quin"), m.H), [200, 200, 200]],
    ["sign up yourself", (g, m) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/tias/signups/${m.name || "Nobody"}`, signupBody(m.name || "Nobody"), m.H), [200, 200, 200]],
    ["sign somebody else up", (g, m) => api(s, "PUT", `/v1/guilds/${g.guildId}/events/tias/signups/Quin`, signupBody("Quin", "healer", 1, "game"), m.H), [403, 200, 200]],
    ["post the summary", (g, m) => api(s, "POST", `/v1/guilds/${g.guildId}/events/tias/summary`, { schema: 1, attended: ["Tia"], bosses: 1, durationSec: 60 }, m.H), [403, 200, 200]],
    ["remove a member", (g, m, role) => api(s, "DELETE", `/v1/guilds/${g.guildId}/members/${role === "leader" ? "Tom" : "Tia"}`, undefined, bodyless(m)), [403, 200, 200]],
    ["remove an officer", (g, m) => api(s, "DELETE", `/v1/guilds/${g.guildId}/members/Otto`, undefined, bodyless(m)), [403, 403, 200]],
    ["remove yourself with the remove call", (g, m) => api(s, "DELETE", `/v1/guilds/${g.guildId}/members/${m.name || "Nobody"}`, undefined, bodyless(m)), [403, 403, 403]],
    ["delete the guild", (g, m) => api(s, "DELETE", `/v1/guilds/${g.guildId}`, undefined, bodyless(m)), [403, 403, 200]],
    ["leave", (g, m) => api(s, "POST", `/v1/guilds/${g.guildId}/leave`, { schema: 1 }, m.H), [200, 200, 200]],
  ];
  let n = 0;
  for (const [label, run, want] of actions) {
    n += 1;
    const g = await makeGuild(s, { guildName: `Matrix ${"abcdefghijklmnopqrstuvwxyz"[n]}` });
    const officer = await joinGuild(s, g, "Olaf", 1), member = await joinGuild(s, g, "Mia", 5);
    await joinGuild(s, g, "Otto", 1); await joinGuild(s, g, "Tom", 5);
    const tia = await joinGuild(s, g, "Tia", 5);
    assert.equal((await putEvent(s, g, tia, eventBody("tias", "Tia"))).status, 200);
    // Nobody: no header, a malformed one, a well-formed token nobody holds, and the leader of another guild.
    for (const [whoLabel, H] of [["no token", {}], ["a malformed token", { "X-BF-Member": "nope" }], ["an unknown token", { "X-BF-Member": "x".repeat(43) }], ["another guild's leader", other.H]]) {
      const r = await run(g, { H, name: other.name }, "none");
      assert.deepEqual([r.status, r.body], [404, { ok: false, error: "not_found" }], `${label}: ${whoLabel}`);
    }
    assert.equal(count(s, "guild_members", `WHERE guild = '${g.guildId}'`), 6, `${label}: outsiders changed nothing`);
    const asked = [[member, "member"], [officer, "officer"], [g, "leader"]];
    for (const [i, [m, role]] of asked.entries()) {
      const r = await run(g, m, role);
      assert.equal(r.status, want[i], `${label} as ${role}: ${JSON.stringify(r.body)}`);
      if (want[i] === 403) assert.deepEqual(r.body, { ok: false, error: "forbidden" }, `${label} as ${role}`);
    }
  }
  assert.equal(count(s, "guilds", `WHERE id = '${other.guildId}'`), 1);
});

test("E1: events merge by version like the addon; permissions follow the thresholds; caps and time window", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s);
  const bea = await joinGuild(s, g, "Bea", 1), cy = await joinGuild(s, g, "Cy", 5), dan = await joinGuild(s, g, "Dan", 7);
  const e1 = eventBody("abc123", "Cy");
  const made = await putEvent(s, g, cy, e1);
  assert.deepEqual([made.status, made.body.accepted, made.body.reason], [200, true, "new"]);
  assert.deepEqual(made.body.event, e1, "the stored event is the E1 shape that was sent");
  // The bare shape, the bare shape with schema, and the wrapped shape are all taken.
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/abc123`, { schema: 1, event: { ...e1, version: 2, title: "Molten Core II" } }, cy.H)).body.accepted, true);
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/abc123`, { schema: 1, ...e1, version: 3, title: "Molten Core III" }, cy.H)).body.accepted, true);
  // An older or equal version is not an error: the answer carries what is stored.
  const stale = await putEvent(s, g, cy, { ...e1, version: 2, title: "Old news" });
  assert.deepEqual([stale.status, stale.body.accepted, stale.body.reason, stale.body.event.title, stale.body.event.version], [200, false, "older", "Molten Core III", 3]);
  assert.equal((await putEvent(s, g, cy, { ...e1, version: 3, title: "Same version" })).body.accepted, false);
  // A tie between two editors: the later name wins, whoever comes first.
  assert.equal((await putEvent(s, g, bea, { ...e1, version: 4, editor: who("Bea"), title: "Bea's edit" })).body.accepted, true);
  const lost = await putEvent(s, g, g, { ...e1, version: 4, editor: who("Abel"), title: "Abel's edit" });
  assert.deepEqual([lost.body.accepted, lost.body.event.title], [false, "Bea's edit"], "Abel is before Bea");
  const won = await putEvent(s, g, cy, { ...e1, version: 4, title: "Cy's own" });
  assert.deepEqual([won.body.accepted, won.body.reason, won.body.event.editor], [true, "tie", who("Cy")], "Cy is after Bea");
  // Hearsay: an event passed on by somebody else is taken only while unknown; the author's own word replaces it.
  const heard = await putEvent(s, g, dan, eventBody("heard1", "Quin", { version: 5 }));
  assert.deepEqual([heard.body.accepted, heard.body.reason], [true, "new"]);
  assert.equal((await putEvent(s, g, cy, eventBody("heard1", "Quin", { version: 6, title: "Passed on again" }))).body.accepted, true, "a newer passed-on copy replaces a passed-on copy");
  assert.equal((await putEvent(s, g, dan, eventBody("abc123", "Cy", { version: 9, title: "Hijack" }))).body.reason, "hearsay", "a passed-on copy never replaces the author's");
  assert.equal((await putEvent(s, g, dan, eventBody("abc123", "Dan", { version: 9, title: "Mine now" }))).body.reason, "creator", "an id belongs to its creator");
  const quin = await joinGuild(s, g, "Quin", 5);
  const own = await putEvent(s, g, quin, eventBody("heard1", "Quin", { version: 1, title: "What Quin really said" }));
  assert.deepEqual([own.body.accepted, own.body.reason, own.body.event.version], [true, "author", 1]);
  assert.equal((await putEvent(s, g, dan, eventBody("heard1", "Quin", { version: 7 }))).body.reason, "hearsay");

  // Thresholds: who may propose, who may edit somebody else's event.
  assert.equal((await api(s, "PATCH", `/v1/guilds/${g.guildId}`, { schema: 1, thresholds: { proposeRank: 5, editRank: 5 } }, g.H)).status, 200);
  assert.equal((await putEvent(s, g, dan, eventBody("dans", "Dan"))).status, 403, "rank 7 may not propose any more");
  assert.equal((await putEvent(s, g, cy, eventBody("cys", "Cy"))).status, 200, "rank 5 may");
  assert.equal((await putEvent(s, g, cy, eventBody("abc123", "Cy", { version: 5, title: "Still mine" }))).body.accepted, true, "the creator may always change their own event");
  assert.equal((await putEvent(s, g, cy, eventBody("heard1", "Quin", { version: 2, editor: who("Cy") }))).body.accepted, true, "rank 5 may now edit");
  assert.equal((await putEvent(s, g, dan, eventBody("heard1", "Quin", { version: 3, editor: who("Dan") }))).status, 403);
  // The address and the body must agree; nonsense is refused before anything is stored.
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/zzz`, e1, cy.H)).status, 400);
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/abc123`, { ...e1, extra: true }, cy.H)).status, 400);
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/bad id`, e1, cy.H)).status, 404);
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/events/abc123`, e1, cy.H)).status, 405);
  // The time window of the addon: not over for more than four hours, not more than half a year ahead.
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  assert.deepEqual((({ accepted, reason, event }) => [accepted, reason, event])((await putEvent(s, g, g, eventBody("past1", "Abel", { at: iso(T0 - 5 * HOUR) }))).body), [false, "past", null]);
  assert.equal((await putEvent(s, g, g, eventBody("past2", "Abel", { at: iso(T0 - 3 * HOUR) }))).body.accepted, true);
  assert.equal((await putEvent(s, g, g, eventBody("far1", "Abel", { at: iso(T0 + 181 * DAY) }))).body.reason, "ahead");
  // At most 60 live events per guild.
  const before = count(s, "guild_events", `WHERE guild = '${g.guildId}'`);
  for (let i = before; i < 60; i++) assert.equal((await putEvent(s, g, g, eventBody(`fill${i}`, "Abel"))).body.accepted, true);
  const full = await putEvent(s, g, g, eventBody("onemore", "Abel"));
  assert.deepEqual([full.status, full.body], [409, { ok: false, error: "full" }]);
  assert.equal((await putEvent(s, g, cy, eventBody("abc123", "Cy", { version: 6, cancelled: true }))).body.event.cancelled, true, "a known event can still change");

  // The full refetch, and "since".
  const list = await api(s, "GET", `/v1/guilds/${g.guildId}/events`, undefined, dan.H);
  assert.equal(list.body.events.length, 60);
  assert.deepEqual(Object.keys(list.body.signups).length, 60);
  s.clock.t += 60_000;
  await putEvent(s, g, cy, eventBody("cys", "Cy", { version: 2, note: "" }));
  const since = await api(s, "GET", `/v1/guilds/${g.guildId}/events?since=${encodeURIComponent(iso(s.clock.t))}`, undefined, dan.H);
  assert.deepEqual(since.body.events.map(e => [e.id, e.version, e.note]), [["cys", 2, ""]]);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}/events?since=never`, undefined, dan.H)).status, 400);
});

test("E2/E3: sign-ups (your own, an officer for anybody), versions, closing, the cap, the summary", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s);
  const bea = await joinGuild(s, g, "Bea", 1), cy = await joinGuild(s, g, "Cy", 5);
  await putEvent(s, g, g, eventBody("raid1", "Abel"));
  const first = await putSignup(s, g, cy, "raid1", signupBody("Cy", "damage", 1, "game"));
  assert.deepEqual([first.status, first.body], [200, { ok: true, accepted: true, reason: "new", signup: { who: who("Cy"), answer: "damage", version: 1, via: "game" } }]);
  assert.equal((await putSignup(s, g, cy, "raid1", signupBody("Cy", "no", 1))).body.accepted, false, "the same version changes nothing");
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, { schema: 1, signup: signupBody("Cy", "maybe", 2) }, cy.H)).body.signup.answer, "maybe");
  // A member answers only for their own character.
  assert.equal((await putSignup(s, g, cy, "raid1", signupBody("Bea", "tank", 1))).status, 403);
  assert.equal((await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Bea`, signupBody("Cy", "tank", 3), cy.H)).status, 400, "the name in the address and in the body must agree");
  // An officer may pass on anybody's answer, also of a guildmate without the app; it never beats a newer one.
  assert.equal((await putSignup(s, g, bea, "raid1", signupBody("Quin", "healer", 4, "game"))).body.accepted, true);
  assert.equal((await putSignup(s, g, bea, "raid1", signupBody("Cy", "no", 2, "game"))).body.accepted, false);
  assert.equal((await putSignup(s, g, bea, "raid1", signupBody("Cy", "tank", 3, "game"))).body.accepted, true);
  // ...and what the member says themselves replaces what was passed on, whatever the version.
  assert.equal((await putSignup(s, g, cy, "raid1", signupBody("Cy", "healer", 1))).body.accepted, true);
  assert.equal((await putSignup(s, g, cy, "raid1", signupBody("Cy", "healer", 1, "discord"))).status, 400, "only the server marks an answer as given on Discord");
  assert.equal((await putSignup(s, g, cy, "nosuch", signupBody("Cy"))).status, 404);
  const listed = await api(s, "GET", `/v1/guilds/${g.guildId}/events`, undefined, cy.H);
  assert.deepEqual(listed.body.signups.raid1.map(x => `${x.who.name}:${x.answer}:${x.version}:${x.via}`).sort(), ["Cy:healer:1:desktop", "Quin:healer:4:game"]);

  // At most 40 sign-ups per event.
  const names = Array.from({ length: 40 }, (_, i) => `N${"abcdefghij"[Math.floor(i / 10)]}${"klmnopqrst"[i % 10]}`);
  let taken = 2;
  for (const n of names) { const r = await putSignup(s, g, bea, "raid1", signupBody(n, "damage", 1, "game")); if (r.body.accepted) taken += 1; else assert.equal(r.body.reason, "full"); }
  assert.equal(taken, 40);
  assert.equal(count(s, "guild_signups"), 40);
  assert.equal((await putSignup(s, g, cy, "raid1", signupBody("Cy", "tank", 2))).body.accepted, true, "an answer that is already there can still change");

  // The summary: officers only; numbers are kept, the names are not.
  const sum = await api(s, "POST", `/v1/guilds/${g.guildId}/events/raid1/summary`, { schema: 1, attended: ["Abel", "Bea", "Cy"], bosses: 8, durationSec: 9660 }, bea.H);
  assert.deepEqual([sum.status, sum.body], [200, { ok: true, posted: false }]);
  assert.deepEqual({ ...s.store.db.prepare("SELECT attended, bosses, duration_sec, title FROM guild_summaries").get() }, { attended: 3, bosses: 8, duration_sec: 9660, title: "Molten Core" });
  assert.equal((await api(s, "POST", `/v1/guilds/${g.guildId}/events/nosuch/summary`, { schema: 1, attended: [], bosses: 0, durationSec: 0 }, bea.H)).status, 404);

  // A cancelled event, and one that began more than four hours ago, take no more answers.
  await putEvent(s, g, g, eventBody("raid1", "Abel", { version: 2, cancelled: true }));
  const closed = await putSignup(s, g, cy, "raid1", signupBody("Cy", "no", 9));
  assert.deepEqual([closed.body.accepted, closed.body.reason, closed.body.signup.answer], [false, "closed", "tank"]);
  await putEvent(s, g, g, eventBody("raid2", "Abel"));
  s.clock.t = Date.parse("2026-11-27T23:00:01Z");
  assert.equal((await putSignup(s, g, cy, "raid2", signupBody("Cy", "tank", 1))).body.reason, "closed");
});

test("isolation: a member of guild A can neither read nor change anything of guild B", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = await makeGuild(s, { guildName: "Alpha" }), b = await makeGuild(s, { guildName: "Beta", leader: "Bert" });
  const bm = await joinGuild(s, b, "Bea", 5);
  await putEvent(s, b, b, eventBody("secret", "Bert", { title: "Beta only" }));
  await putSignup(s, b, bm, "secret", signupBody("Bea"));
  const snapshot = () => JSON.stringify(["guilds", "guild_members", "guild_events", "guild_signups"].map(tb => s.store.db.prepare(`SELECT * FROM ${tb} WHERE ${tb === "guilds" ? "id" : "guild"} = ?`).all(b.guildId)));
  const before = snapshot();
  const attempts = [
    ["GET", `/v1/guilds/${b.guildId}`], ["GET", `/v1/guilds/${b.guildId}/events`], ["PATCH", `/v1/guilds/${b.guildId}`, { schema: 1, rotateCode: true }],
    ["PUT", `/v1/guilds/${b.guildId}/events/secret`, eventBody("secret", "Bert", { version: 9 })], ["PUT", `/v1/guilds/${b.guildId}/events/mine`, eventBody("mine", "Abel")],
    ["PUT", `/v1/guilds/${b.guildId}/events/secret/signups/Abel`, signupBody("Abel")], ["POST", `/v1/guilds/${b.guildId}/events/secret/summary`, { schema: 1, attended: [], bosses: 0, durationSec: 0 }],
    ["DELETE", `/v1/guilds/${b.guildId}/members/Bea`], ["POST", `/v1/guilds/${b.guildId}/leave`, { schema: 1 }], ["DELETE", `/v1/guilds/${b.guildId}`],
  ];
  for (const [method, p, body] of attempts) {
    const r = await api(s, method, p, body, a.H);
    assert.deepEqual([r.status, r.body], [404, { ok: false, error: "not_found" }], `${method} ${p}`);
    assert.ok(!JSON.stringify(r.body).includes("Beta"));
  }
  assert.equal(snapshot(), before, "nothing of guild B changed");
  // A guild that does not exist answers exactly like one the caller is not in.
  const ghost = await api(s, "GET", `/v1/guilds/g_${"z".repeat(16)}`, undefined, a.H);
  assert.deepEqual([ghost.status, ghost.body], [404, { ok: false, error: "not_found" }]);
  // Guild A's own list holds only its own events.
  await putEvent(s, a, a, eventBody("ours", "Abel"));
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${a.guildId}/events`, undefined, a.H)).body.events.map(e => e.id), ["ours"]);
  // A blocked install's token stops working.
  s.store.blockInstall(hashInstall(SALT, bm.installId));
  assert.deepEqual((await api(s, "GET", `/v1/guilds/${b.guildId}`, undefined, bm.H)).body, { ok: false, error: "blocked" });
});

test("leave, forget and delete remove every row they should; an officer removes a member", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s), g2 = await makeGuild(s, { guildName: "Second", leader: "Sol" });
  const cy = await joinGuild(s, g, "Cy", 5), dan = await joinGuild(s, g, "Dan", 5);
  const cyToo = await joinGuild(s, g2, "Cy", 5, cy.installId); // the same install in two guilds
  for (const [guild, lead] of [[g, g], [g2, g2]]) await putEvent(s, guild, lead, eventBody("raid1", lead.name));
  await putSignup(s, g, cy, "raid1", signupBody("Cy"));
  await putSignup(s, g2, cyToo, "raid1", signupBody("Cy"));
  await putSignup(s, g, dan, "raid1", signupBody("Dan"));
  await api(s, "PUT", `/v1/lfg/${"L".repeat(16)}`, listingBody(cy.installId, "L".repeat(16), {}, { who: who("Cy") }));
  assert.equal((await post(s.base, "/v1/tickets", ticket(cy.installId))).status, 201);
  const cyHash = hashInstall(SALT, cy.installId);
  const mine = () => ({ members: count(s, "guild_members", `WHERE install = '${cyHash}'`), signups: count(s, "guild_signups", "WHERE name_key = 'cy'"), lfg: count(s, "lfg", `WHERE install = '${cyHash}'`) });
  assert.deepEqual(mine(), { members: 2, signups: 2, lfg: 1 });

  // Forget: out of every guild, sign-ups gone, listing gone, tickets gone; the documented answer shape stays.
  const forgot = await api(s, "POST", "/v1/forget", { schema: 1, installId: cy.installId });
  assert.deepEqual(forgot.body, { ok: true, removed: { observations: 0, reports: 0 } });
  assert.deepEqual(mine(), { members: 0, signups: 0, lfg: 0 });
  assert.equal(count(s, "tickets"), 0);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy.H)).status, 404);
  assert.ok(!JSON.stringify(LIVE_TABLES.map(tb => s.store.db.prepare(`SELECT * FROM ${tb}`).all())).includes(cyHash), "no row anywhere still holds that install");
  assert.equal(count(s, "guild_members"), 3, "everybody else is still there");
  assert.equal(count(s, "guild_signups"), 1);

  // An officer removes a member: the member row and their own sign-ups go.
  assert.equal((await api(s, "DELETE", `/v1/guilds/${g.guildId}/members/dan`, undefined, g.H)).status, 200, "the name in the address is not case sensitive");
  assert.equal(count(s, "guild_members", `WHERE guild = '${g.guildId}'`), 1);
  assert.equal(count(s, "guild_signups", `WHERE guild = '${g.guildId}'`), 0);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, dan.H)).status, 404);
  assert.equal((await api(s, "DELETE", `/v1/guilds/${g.guildId}/members/Nobody`, undefined, g.H)).status, 404);

  // Delete: every row of the guild, in every table.
  await joinGuild(s, g, "Eve", 5);
  await api(s, "POST", `/v1/guilds/${g.guildId}/events/raid1/summary`, { schema: 1, attended: ["Abel"], bosses: 1, durationSec: 60 }, g.H);
  assert.deepEqual((await api(s, "DELETE", `/v1/guilds/${g.guildId}`, { schema: 1 }, g.H)).body, { ok: true });
  for (const tb of ["guild_members", "guild_events", "guild_signups", "guild_summaries"]) assert.equal(count(s, tb, `WHERE guild = '${g.guildId}'`), 0, tb);
  assert.equal(count(s, "guilds", `WHERE id = '${g.guildId}'`), 0);
  assert.equal(count(s, "guild_events", `WHERE guild = '${g2.guildId}'`), 1, "the other guild is untouched");
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).status, 404);
  // The guild can be linked again afterwards, with a new id and a new code.
  const relinked = await makeGuild(s);
  assert.notEqual(relinked.guildId, g.guildId);

  // Forget of the last member takes the guild along.
  assert.equal((await api(s, "POST", "/v1/forget", { schema: 1, installId: g2.installId })).status, 200);
  assert.equal(count(s, "guilds", `WHERE id = '${g2.guildId}'`), 0);
  assert.equal(count(s, "guild_events", `WHERE guild = '${g2.guildId}'`), 0);
});

test("expiry: past events go after 14 days, a numbers-only summary stays 180 days", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await putEvent(s, g, g, eventBody("raid1", "Abel")); // 2026-11-27 19:00
  await putEvent(s, g, g, eventBody("raid2", "Abel", { at: "2026-12-20T19:00:00Z" }));
  await putEvent(s, g, g, eventBody("off1", "Abel", { cancelled: true }));
  await putSignup(s, g, cy, "raid1", signupBody("Cy", "tank"));
  await putSignup(s, g, g, "raid1", signupBody("Abel", "no"));
  const at = Date.parse("2026-11-27T19:00:00Z");
  s.live.tick(at + 14 * DAY - 1000);
  assert.equal(count(s, "guild_events"), 3, "not yet");
  s.live.tick(at + 14 * DAY + HOUR + 1000);
  assert.deepEqual(s.store.db.prepare("SELECT id FROM guild_events").all().map(r => r.id), ["raid2"]);
  assert.equal(count(s, "guild_signups"), 0);
  assert.deepEqual(s.store.db.prepare("SELECT event, attended, bosses, title FROM guild_summaries").all().map(r => ({ ...r })), [{ event: "raid1", attended: 1, bosses: null, title: "Molten Core" }], "a cancelled event leaves no summary");
  assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM guild_summaries").all()).includes("Cy"), "the summary holds no names");
  // The hourly maintenance job does the same thing; the summary leaves after 180 days.
  const r = runMaintenance({ store: s.store, auth: s.auth, config: { backupDir: null }, now: at + 180 * DAY + 2 * HOUR });
  assert.equal(r.live.summaries, 1);
  assert.deepEqual(s.store.db.prepare("SELECT id FROM guild_events").all().map(x => x.id), [], "the December event went 14 days after its own date");
  assert.deepEqual(s.store.db.prepare("SELECT event, attended FROM guild_summaries").all().map(x => ({ ...x })), [{ event: "raid2", attended: 0 }], "the old summary is gone; the December event left its own");
});

test("P1 party board: one listing per install, 30 minutes, realm and faction scoping, owner-only delete", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = uuid(), b = uuid(), id = (c) => c.repeat(16);
  const board = async (realm = REALM, faction = "horde") => (await api(s, "GET", `/v1/lfg?realm=${encodeURIComponent(realm)}&faction=${faction}`)).body.listings;
  const put = (install, lid, over, listing) => api(s, "PUT", `/v1/lfg/${lid}`, listingBody(install, lid, over, listing));
  const first = await put(a, id("A"));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true, expiresIn: 1800, listing: { id: id("A"), kind: "lfg", who: who("Abel"), level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "Any wing", need: null, at: "2026-11-24T12:00:00Z" } });
  assert.equal((await put(a, id("A"), { consent: false })).status, 400);
  s.clock.t += 60_000;
  assert.equal((await put(b, id("B"), {}, { who: who("Bea"), kind: "lfm", need: { tank: 1, healer: 0, damage: 2 } })).status, 200);
  assert.deepEqual((await board()).map(l => l.id), [id("B"), id("A")], "newest first");
  // Scoping: the other faction and another realm see nothing; the realm name is not case sensitive.
  assert.deepEqual(await board(REALM, "alliance"), []);
  assert.deepEqual(await board("Other Realm"), []);
  assert.equal((await board("thunder hold")).length, 2);
  assert.equal((await api(s, "GET", "/v1/lfg?realm=Thunder+Hold")).status, 400);
  assert.ok(!JSON.stringify(await board()).includes("install"), "no install hash in a listing");
  // Another install cannot take over or delete somebody's listing.
  assert.deepEqual((await put(b, id("A"))).body, { ok: false, error: "exists" });
  assert.equal((await api(s, "DELETE", `/v1/lfg/${id("A")}`, { schema: 1, installId: b })).status, 404);
  assert.equal((await board()).length, 2);
  // One listing per install: a new id replaces the old one.
  s.clock.t += 60_000;
  assert.equal((await put(a, id("C"), {}, { note: "Changed my mind" })).status, 200);
  assert.deepEqual((await board()).map(l => l.id), [id("C"), id("B")]);
  assert.equal(count(s, "lfg"), 2);
  // A refresh keeps it alive for another 30 minutes; without one it is gone.
  s.clock.t += 29 * 60_000;
  assert.equal((await put(a, id("C"))).status, 200);
  s.clock.t += 2 * 60_000;
  assert.deepEqual((await board()).map(l => l.id), [id("C")], "B was last refreshed 32 minutes ago");
  s.live.tick(s.clock.t);
  assert.equal(count(s, "lfg"), 1, "the expired row is deleted, not only hidden");
  s.clock.t += 31 * 60_000;
  assert.deepEqual(await board(), []);
  // The owner deletes their own.
  await put(a, id("D"));
  assert.deepEqual((await api(s, "DELETE", `/v1/lfg/${id("D")}`, { schema: 1, installId: a })).body, { ok: true });
  assert.deepEqual(await board(), []);
  assert.equal((await api(s, "DELETE", `/v1/lfg/${id("D")}`, { schema: 1, installId: a })).status, 404);
  // Hostile text is refused at the door; a blocked install cannot list.
  assert.equal((await put(a, id("E"), {}, { note: "cheap gold www.gold.example" })).status, 400);
  assert.equal((await put(a, id("E"), {}, { note: "|cffff0000RED|r" })).status, 400);
  s.store.blockInstall(hashInstall(SALT, a));
  assert.equal((await put(a, id("E"))).status, 403);
  // Listings per day are counted once per listing, not once per refresh.
  assert.equal(s.store.db.prepare("SELECT SUM(n) AS n FROM live_daily WHERE metric = 'listing'").get().n, 4);
  // At most 200 come back.
  const many = s.store.db.prepare("INSERT INTO lfg(id, install, realm, realm_key, faction, kind, name, who_realm, level, class, roles, place, note, need, at, expires_ms) VALUES (?, ?, ?, ?, 'horde', 'lfg', 'Abel', ?, 10, NULL, '', 'other', '', NULL, ?, ?)");
  for (let i = 0; i < 230; i++) many.run(`X${String(i).padStart(15, "0")}`, `fake${i}`, REALM, "thunder hold", REALM, new Date(s.clock.t - i * 1000).toISOString(), s.clock.t + 600_000);
  assert.equal((await board()).length, 200);
});

test("migration: a schema 3 database with data in every table gains the Live tables and loses nothing", (t) => {
  const tmp = tempDb(); t.after(() => tmp.cleanup());
  let store = new Store(tmp.file);
  const h = (n) => String(n).repeat(64).slice(0, 64);
  for (const n of [1, 2, 3]) store.recordSubmission(h(n), { nodes: [{ kind: "herb", objectId: 1617, name: null, mapId: 1429, x: 90, y: 120, itemIds: [765] }], npcs: [{ npcId: 197, mapId: 1429, x: 97, y: 84, name: "Marshal McBride" }], vendors: [], drops: [], recipes: [] }, T0 - n * DAY);
  store.addReport(h(1), { category: "bug", text: "An old report", log: null }, T0);
  const made = store.desk.createTicket(h(1), ticket("x"), T0);
  store.desk.adminReply(made.id, null, "Thanks", "question", T0 + 1000);
  store.desk.recordHeartbeat(h(1), heartbeat("x"), T0);
  store.desk.recordError({ name: "TypeError", message: "x", stack: ["at f (a.js:1:1)"], where: "main", appVersion: "1.26.0", os: "windows" }, T0);
  store.desk.saveAnnouncement({ title: "Hello", text: "Text", level: "info", link: null, from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z", minVersion: null, maxVersion: null, os: [], lang: [] }, null, T0);
  store.desk.audit(null, "test", "target", "detail", T0);
  store.blockInstall(h(9), T0);
  store.db.prepare("INSERT INTO gh_releases(tag, published_at, prerelease, first_day) VALUES ('v1.26.0', NULL, 0, '2026-11-24')").run();
  store.db.prepare("INSERT INTO gh_downloads(tag, asset, day, count) VALUES ('v1.26.0', 'Setup.exe', '2026-11-24', 5)").run();
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name).filter(n => !LIVE_TABLES.includes(n));
  const snapshot = (db) => tables.map(tb => `${tb}=${JSON.stringify(db.prepare(`SELECT * FROM ${tb} ORDER BY 1, 2`).all())}`).join("\n");
  const before = snapshot(store.db);
  assert.ok(tables.length >= 20 && before.includes("An old report") && before.includes("Thanks"));
  store.close();
  asSchema3(tmp.file); // what the 1.0.0 server left on disk

  const { DatabaseSync } = require("node:sqlite");
  let raw = new DatabaseSync(tmp.file);
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 3);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'guilds'").get().c, 0);
  raw.close();

  for (let pass = 0; pass < 2; pass++) { // twice: the upgrade is idempotent
    store = new Store(tmp.file);
    assert.equal(SCHEMA_VERSION, 4);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(snapshot(store.db), before, "every row of every older table is exactly as it was");
    for (const tb of LIVE_TABLES) assert.equal(store.db.prepare(`SELECT COUNT(*) AS c FROM ${tb}`).get().c, pass === 0 || tb !== "guilds" && tb !== "guild_members" && tb !== "live_daily" ? 0 : 1, tb);
    if (pass === 0) assert.equal(store.guilds.createGuild(h(1), { realm: REALM, faction: "horde", guildName: "Night Watch", character: who("Abel"), rankIndex: 0 }, G.codeHash(SALT, "BFG-2222-2222"), T0).role, "leader");
    // Old features still work next to the new tables: the ticket counter carries on.
    assert.equal(store.desk.ticketByKey(made.id, made.key).status, "question");
    store.close();
  }
  // A half-applied upgrade (some tables made, version not yet set) is finished on the next start and keeps the rows.
  raw = new DatabaseSync(tmp.file);
  raw.exec("DROP TABLE lfg; DROP TABLE live_daily; PRAGMA user_version = 3;");
  raw.close();
  store = new Store(tmp.file);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(store.db.prepare("SELECT name FROM guilds").get().name, "Night Watch");
  assert.equal(store.guilds.listListings(REALM, "horde", T0).length, 0);
  assert.equal(snapshot(store.db), before);
  // The purge answer keeps its counted shape and now also empties the guild side.
  assert.deepEqual(store.purgeInstall(h(1)), { observations: 4, reports: 1, tickets: 1, heartbeats: 1, blocked: false });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM guilds").get().c, 0);
  store.close();
});
