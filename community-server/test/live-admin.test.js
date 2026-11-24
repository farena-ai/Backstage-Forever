"use strict";
// The admin area for Backstage Live: the Guilds and Party board pages with hostile text in every
// field, the actions (each needs the CSRF token and is written to the audit log without player
// text), and the "Backstage Live" block of the dashboard.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hashInstall } = require("../lib/store");
const { SALT, T0, uuid, boot, post, form, get, admin, REALM, MANY_LIVE, who, call, answer, makeGuild, joinGuild, eventBody, signupBody, listingBody, liveSession, openStream } = require("./helpers");

const cp = String.fromCodePoint;
const RLO = cp(0x202e), LRI = cp(0x2066), ZWSP = cp(0x200b);
const HOSTILE = `<script>alert(1)</script>"'><img src=x onerror=alert(2)></td></table><svg onload=alert(3)>${RLO}txt.exe${LRI}${ZWSP}\`\${7*7}`;
const RAW_MARKERS = ["<script>alert", "<img src=x", "<svg onload", "</td></table><svg", RLO, LRI, ZWSP];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const api = async (s, method, p, body, headers) => answer(await call(s.base, method, p, body, headers));

function checkPage(res, body, label) {
  assert.equal(res.status, 200, label);
  assert.equal(res.headers.get("content-security-policy"), CSP, `${label}: CSP`);
  assert.equal(res.headers.get("x-frame-options"), "DENY", label);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", label);
  for (const m of RAW_MARKERS) assert.ok(!body.includes(m), `${label}: raw hostile text ${JSON.stringify(m)} reached the page`);
  assert.deepEqual(body.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi), ['<script src="/admin/static/admin.js" defer></script>'], `${label}: one external script`);
  assert.ok(!/<style\b/i.test(body) && !/<(?:iframe|object|embed|base)\b/i.test(body), `${label}: no style or embedding elements`);
  for (const tag of body.match(/<[a-zA-Z][^>]*>/g) || []) {
    const rest = tag.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, ""), names = [];
    const left = rest.replace(/\s+([^\s"'=<>/]+)(?:="([^"]*)")?/g, (m, name, value) => { names.push([name.toLowerCase(), value]); return ""; });
    assert.equal(left.trim(), "", `${label}: malformed tag ${tag.slice(0, 120)}`);
    for (const [name, value] of names) {
      assert.ok(!name.startsWith("on") && name !== "style" && name !== "srcdoc", `${label}: ${name} in ${tag.slice(0, 120)}`);
      if (["href", "src", "action", "formaction"].includes(name)) assert.match(value, /^\/admin\//, `${label}: ${name}="${String(value).slice(0, 80)}"`);
    }
  }
}
async function page(s, a, p, label = p) { const res = await get(s.base, p, { cookie: a.cookie }); const body = await res.text(); checkPage(res, body, label); return body; }
const audit = (s) => s.store.db.prepare("SELECT action, target, detail, admin_name FROM audit ORDER BY id").all().map(r => ({ ...r }));

test("admin: the Guilds and Party board pages show names, escape everything, and need a session", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5);
  await joinGuild(s, g, "Bea", 1);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy"), cy.H);
  await api(s, "PUT", `/v1/lfg/${"L".repeat(16)}`, listingBody(uuid(), "L".repeat(16), {}, { who: who("Lia"), kind: "lfm", need: { tank: 1, healer: 0, damage: 2 } }));
  // Signed out: nothing is shown and nothing can be done.
  for (const p of ["/admin/guilds", `/admin/guilds/${g.guildId}`, "/admin/party"]) {
    const res = await get(s.base, p);
    assert.deepEqual([res.status, res.headers.get("location")], [303, "/admin/login"], p);
  }
  assert.equal((await form(s.base, `/admin/guilds/${g.guildId}/delete`, { confirm: "yes" })).status, 303);
  assert.equal(s.store.guilds.guildCount(), 1);

  const a = await admin(s);
  let list = await page(s, a, "/admin/guilds");
  assert.match(list, /<h1>Guilds<\/h1><span class="dim">1 linked, 0 with Discord, 0 with a Discord problem<\/span>/);
  assert.ok(list.includes(`<a href="/admin/guilds/${g.guildId}" dir="auto">Night Watch</a>`));
  assert.match(list, /<td class="n">3<\/td><td class="n">1<\/td><td><span class="dim">not connected<\/span><\/td>/);
  assert.match(list, /<a href="\/admin\/guilds" class="on" aria-current="page">Guilds<\/a><a href="\/admin\/party">Party board<\/a>/, "both are in the navigation");
  let detail = await page(s, a, `/admin/guilds/${g.guildId}`);
  for (const name of ["Abel", "Bea", "Cy"]) assert.ok(detail.includes(`<th scope="row" dir="auto">${name}</th>`), `the member ${name} is listed by name`);
  assert.ok(detail.includes("3 (1 leader, 1 officer, 1 member)"));
  assert.match(detail, /<dt>Events stored<\/dt><dd>1<\/dd>/);
  assert.match(detail, /<dt>Sign-ups stored<\/dt><dd>1<\/dd>/);
  assert.ok(!detail.includes(g.token) && !detail.includes(g.linkCode) && !detail.includes(hashInstall(SALT, g.installId)), "no token, no link code and no install hash on the page");
  assert.equal((await get(s.base, `/admin/guilds/g_${"z".repeat(16)}`, { cookie: a.cookie })).status, 404);
  assert.equal((await get(s.base, "/admin/guilds/not-an-id", { cookie: a.cookie })).status, 404);
  let party = await page(s, a, "/admin/party");
  assert.match(party, /<span class="dim">1 live listings<\/span>/);
  assert.ok(party.includes('<th scope="row" class="nowrap" dir="auto">Lia</th>') && party.includes("Looking for more") && party.includes("1 tank, 0 healer, 2 damage") && party.includes("Any wing"));

  // Hostile text in every stored field (planted in the database: the API refuses most of it, a
  // Discord name or a Discord server name is whatever somebody typed there).
  const db = s.store.db;
  db.prepare("UPDATE guilds SET name = ?, realm = ?, discord_state = 'problem', discord_guild = '100000000000000001', discord_guild_name = ?, discord_channel = '200000000000000001', discord_channel_name = ?, discord_problem = ? WHERE id = ?")
    .run(HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE, g.guildId);
  db.prepare("UPDATE guild_members SET name = ?, realm = ?, discord_user = '400000000000000001', discord_name = ? WHERE name_key = 'cy'").run(HOSTILE, HOSTILE, HOSTILE);
  db.prepare("UPDATE lfg SET name = ?, realm = ?, note = ?, class = ?, place = ?, roles = ?, need = ?").run(HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE);
  list = await page(s, a, "/admin/guilds", "guild list, hostile");
  detail = await page(s, a, `/admin/guilds/${g.guildId}`, "guild detail, hostile");
  party = await page(s, a, "/admin/party", "party board, hostile");
  for (const [label, body] of [["list", list], ["detail", detail], ["party", party]]) {
    assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), `${label}: the text is shown, escaped`);
    assert.ok(body.includes('<span class="ctl" title="Hidden character, shown as its code">U+202E</span>'), `${label}: a hidden character is shown as its code`);
  }
  assert.match(list, /<span class="chip sev-high">problem<\/span>/);
  await page(s, a, `/admin/guilds?q=${encodeURIComponent('"><script>alert(9)</script>')}`, "search with markup");
  assert.match(await page(s, a, "/admin/guilds?q=nothing+like+this"), /No guild matches\./);
  assert.match(await page(s, a, `/admin/guilds?q=${g.guildId}`), new RegExp(`/admin/guilds/${g.guildId}"`), "a guild can be found by its id");
  // The dashboard and the Data page still hold with that data in place.
  await page(s, a, "/admin/", "dashboard");
  const data = await page(s, a, "/admin/data", "data");
  assert.match(data, /Guild members \(character names of members who agreed\)<\/th><td class="n">3<\/td>/);
  assert.match(data, /Party board listings<\/th><td class="n">1<\/td>/);
});

test("admin actions on guilds and listings: CSRF, what they change, and an audit trail without player text", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = await admin(s);
  const g = await makeGuild(s, { guildName: "Secret Name" }), cy = await joinGuild(s, g, "Cyrano", 5);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1`, eventBody("raid1", "Abel"), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cyrano`, signupBody("Cyrano"), cy.H);
  const base = `/admin/guilds/${g.guildId}`, act = (p, fields = {}, csrf = a.csrf) => form(s.base, p, { ...(csrf ? { csrf } : {}), ...fields }, { cookie: a.cookie });
  const before = audit(s).length;

  // Without the CSRF token, with a wrong one, or sent from another site: refused, nothing changes, nothing is audited.
  for (const [label, res] of [["no token", await act(`${base}/delete`, { confirm: "yes" }, null)], ["wrong token", await act(`${base}/delete`, { confirm: "yes" }, "x".repeat(43))],
    ["another site", await form(s.base, `${base}/delete`, { csrf: a.csrf, confirm: "yes" }, { cookie: a.cookie, headers: { Origin: "https://evil.example" } })],
    ["rotate without token", await act(`${base}/rotate`, {}, null)], ["remove without token", await act(`${base}/remove`, { name: "Cyrano" }, null)]]) assert.equal(res.status, 403, label);
  assert.equal((await get(s.base, `${base}/delete`, { cookie: a.cookie })).status, 405, "a link cannot delete");
  assert.equal(s.store.guilds.memberCount(g.guildId), 2);
  assert.equal(audit(s).length, before);

  // Rotate: the old code dies, the new one is shown once on that answer and is nowhere in the database or the log.
  const rotated = await act(`${base}/rotate`);
  const body = await rotated.text();
  checkPage(rotated, body, "rotate answer");
  const code = /The new link code is <b>(BFG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4})<\/b>/.exec(body)[1];
  assert.notEqual(code, g.linkCode);
  const join = (linkCode, name) => api(s, "POST", "/v1/guilds/join", { schema: 1, installId: uuid(), linkCode, character: who(name), rankIndex: 5, consent: true });
  assert.equal((await join(g.linkCode, "Dan")).status, 404);
  assert.equal((await join(code, "Dan")).status, 201);
  assert.ok(!(await (await get(s.base, base, { cookie: a.cookie })).text()).includes(code), "a later view does not show it again");
  assert.ok(!JSON.stringify([s.store.db.prepare("SELECT * FROM guilds").all(), s.store.db.prepare("SELECT * FROM audit").all()]).includes(code) && !s.logs.join("\n").includes(code));

  // Remove a member (for abuse): their token stops, their sign-up goes, the open stream of the guild hears the new count.
  const stream = await openStream(s.base, await liveSession(s, g.installId, [{ t: "guild", guildId: g.guildId, member: g.token }]));
  t.after(() => stream.close());
  await stream.until(st => st.events.length === 1);
  const removed = await act(`${base}/remove`, { name: "Cyrano" });
  assert.deepEqual([removed.status, removed.headers.get("location")], [303, `${base}?done=gmember`]);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, cy.H)).status, 404);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM guild_signups").get().c, 0);
  await stream.until(st => st.events.length === 2);
  assert.deepEqual(stream.events[1].data, { guildId: g.guildId, members: 2 });
  assert.equal((await act(`${base}/remove`, { name: "Nobody" })).status, 404);

  // Disconnect Discord.
  s.store.db.prepare("UPDATE guilds SET discord_state = 'connected', discord_guild = '100000000000000001', discord_guild_name = 'HQ', discord_channel = '200000000000000001', discord_channel_name = 'raids' WHERE id = ?").run(g.guildId);
  s.store.db.prepare("UPDATE guild_members SET discord_user = '400000000000000001', discord_name = 'Dora' WHERE name = 'Dan'").run();
  assert.match(await page(s, a, base), /Disconnect Discord<\/button>/);
  const off = await act(`${base}/disconnect`);
  assert.deepEqual([off.status, off.headers.get("location")], [303, `${base}?done=gdisconnected`]);
  assert.deepEqual({ ...s.store.db.prepare("SELECT discord_state, discord_guild, discord_channel FROM guilds").get() }, { discord_state: "none", discord_guild: null, discord_channel: null });
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM guild_members WHERE discord_user IS NOT NULL").get().c, 0);
  await stream.until(st => st.events.some(e => e.event === "guild.discord"));
  assert.match(await page(s, a, `${base}?done=gdisconnected`), /Discord was disconnected for that guild\./);

  // Delete: the box must be ticked; then every row goes and the members' apps are told.
  assert.equal((await act(`${base}/delete`)).status, 400);
  assert.equal(s.store.guilds.guildCount(), 1);
  const del = await act(`${base}/delete`, { confirm: "yes" });
  assert.deepEqual([del.status, del.headers.get("location")], [303, "/admin/guilds?done=gdeleted"]);
  for (const tb of ["guilds", "guild_members", "guild_events", "guild_signups"]) assert.equal(s.store.db.prepare(`SELECT COUNT(*) AS c FROM ${tb}`).get().c, 0, tb);
  assert.equal((await api(s, "GET", `/v1/guilds/${g.guildId}`, undefined, g.H)).status, 404);
  await stream.until(st => st.events.some(e => e.event === "guild.member" && e.data.members === 0));
  assert.equal((await act(`${base}/delete`, { confirm: "yes" })).status, 404);

  // Party board: remove one listing; block an install (its listing goes and it cannot list again).
  const one = uuid(), two = uuid(), id = (c) => c.repeat(16);
  await api(s, "PUT", `/v1/lfg/${id("A")}`, listingBody(one, id("A"), {}, { who: who("Spammer"), note: "Selling runs" }));
  await api(s, "PUT", `/v1/lfg/${id("B")}`, listingBody(two, id("B"), {}, { who: who("Worse") }));
  const board = await openStream(s.base, await liveSession(s, uuid(), [{ t: "lfg", realm: REALM, faction: "horde" }]));
  t.after(() => board.close());
  await board.until(st => st.events.length === 1);
  assert.equal((await act(`/admin/party/${id("A")}/remove`, {}, null)).status, 403);
  assert.deepEqual([(await act(`/admin/party/${id("A")}/remove`)).headers.get("location"), (await act(`/admin/party/${id("A")}/remove`)).status], ["/admin/party?done=lremoved", 404]);
  assert.equal((await api(s, "PUT", `/v1/lfg/${id("A")}`, listingBody(one, id("A")))).status, 200, "a removed listing can be put up again: removing is not blocking");
  assert.equal((await act(`/admin/party/${id("B")}/block`)).headers.get("location"), "/admin/party?done=lblocked");
  assert.equal(s.store.isBlocked(hashInstall(SALT, two)), true);
  assert.equal((await api(s, "PUT", `/v1/lfg/${id("B")}`, listingBody(two, id("B")))).status, 403);
  assert.deepEqual((await api(s, "GET", `/v1/lfg?realm=${encodeURIComponent(REALM)}&faction=horde`)).body.listings.map(l => l.id), [id("A")]);
  await board.until(st => st.events.filter(e => e.data.op === "gone").length === 2);
  assert.equal((await act("/admin/party/short/remove")).status, 404);

  // The audit log: who, what, on which id. Never a guild name, a character name, a note or a code.
  const rows = audit(s).slice(before);
  assert.deepEqual(rows.map(r => [r.action, r.target, r.detail]), [
    ["guild_rotate_code", `guild ${g.guildId}`, ""],
    ["guild_member_remove", `guild ${g.guildId}`, "members_left=2"],
    ["guild_discord_disconnect", `guild ${g.guildId}`, "was=connected"],
    ["guild_delete", `guild ${g.guildId}`, "members=2 events=1 signups=0"],
    ["listing_remove", `listing ${id("A")}`, ""],
    ["install_block", `install ${hashInstall(SALT, two).slice(0, 8)}`, `from=listing ${id("B")}`],
  ]);
  assert.ok(rows.every(r => r.admin_name === "alice"));
  const text = JSON.stringify(rows);
  for (const secret of ["Secret Name", "Cyrano", "Abel", "Spammer", "Worse", "Selling runs", "Dora"]) assert.ok(!text.includes(secret), `the audit log holds ${secret}`);
  assert.match(await page(s, a, "/admin/audit"), /<code>guild_delete<\/code>/);
  // Purging an install from the Data page takes it out of its guilds too.
  const g2 = await makeGuild(s, { guildName: "Purge Me" });
  const purge = await act("/admin/data/purge", { install: g2.installId, confirm: "yes" });
  assert.equal(purge.headers.get("location"), "/admin/data?done=purged");
  assert.equal(s.store.guilds.guildCount(), 0);
  assert.match(audit(s).pop().detail, /guilds=1 blocked=false$/);
});

test("dashboard: the Backstage Live block counts connections, stream errors, guilds, sign-ups by source and listings", async (t) => {
  const s = await boot(MANY_LIVE); t.after(() => s.close());
  const a = await admin(s);
  let body = await page(s, a, "/admin/");
  assert.match(body, /<div class="section-head"><h2>Backstage Live<\/h2><span class="dim">guilds, events, sign-ups and the party board; Discord for guilds is off<\/span>/);
  const tile = (html, label) => new RegExp(`<div class="tile-label">${label}</div><div class="tile-value">([^<]*)</div><div class="tile-sub">([^<]*)</div>`).exec(html).slice(1);
  assert.deepEqual(tile(body, "Live connections"), ["0", "apps connected right now"]);
  assert.deepEqual(tile(body, "Guilds linked"), ["0", "0 members in all"]);

  const g = await makeGuild(s), cy = await joinGuild(s, g, "Cy", 5), bea = await joinGuild(s, g, "Bea", 1);
  await makeGuild(s, { guildName: "Quiet Ones", leader: "Quin" });
  s.store.db.prepare("UPDATE guilds SET active_at = '2026-11-01T00:00:00Z' WHERE name = 'Quiet Ones'").run();
  s.store.db.prepare("UPDATE guilds SET discord_state = 'problem', discord_guild = '100000000000000001', discord_problem = 'x' WHERE id = ?").run(g.guildId);
  for (const n of [1, 2]) await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid${n}`, eventBody(`raid${n}`, "Abel"), g.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Cy`, signupBody("Cy", "tank", 1, "game"), cy.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid1/signups/Bea`, signupBody("Bea", "healer", 1, "desktop"), bea.H);
  await api(s, "PUT", `/v1/guilds/${g.guildId}/events/raid2/signups/Bea`, signupBody("Bea", "healer", 1, "desktop"), bea.H);
  s.store.guilds.discordSignup(s.store.guilds.guild(g.guildId), "raid2", s.store.guilds.member(g.guildId, "cy"), "damage", s.clock.t);
  await api(s, "PUT", `/v1/lfg/${"A".repeat(16)}`, listingBody(uuid(), "A".repeat(16)));
  s.clock.t -= 86_400_000;
  await api(s, "PUT", `/v1/lfg/${"B".repeat(16)}`, listingBody(uuid(), "B".repeat(16)));
  s.clock.t += 86_400_000;
  const one = await openStream(s.base, await liveSession(s, uuid(), [])), two = await openStream(s.base, await liveSession(s, uuid(), []));
  t.after(() => { one.close(); two.close(); });
  await two.until(st => st.events.length === 1);
  s.live.hub.counters.errors = 3; s.live.hub.counters.slow = 1;

  body = await page(s, a, "/admin/?days=30");
  assert.deepEqual(tile(body, "Live connections"), ["2", "apps connected right now"]);
  assert.deepEqual(tile(body, "Stream errors"), ["3", "since the service started, 1 too slow"]);
  assert.deepEqual(tile(body, "Guilds linked"), ["2", "4 members in all"]);
  assert.deepEqual(tile(body, "With Discord"), ["1", "1 with a problem"]);
  assert.deepEqual(tile(body, "Active guilds"), ["1", "last 7 days"]);
  assert.deepEqual(tile(body, "Events created"), ["2", "last 30 days"]);
  assert.deepEqual(tile(body, "Party listings"), ["1", "live now, 2 in 30 days"]);
  assert.match(body, /4 sign-ups reached the service in the last 30 days/);
  const bar = (label) => new RegExp(`<th scope="row">${label}</th><td class="bar"><progress max="100" value="[\\d.]+" aria-hidden="true"></progress></td><td class="n">(\\d+)</td><td class="n">([\\d.]+)%</td>`).exec(body).slice(1);
  assert.deepEqual([bar("In the game"), bar("Desktop app"), bar("Discord button")], [["1", "25"], ["2", "50"], ["1", "25"]]);
  assert.match(body, /2 listings were put on the party board in the last 30 days/);
  // The connection count is read fresh on every view, not from the cached dashboard numbers.
  one.close();
  for (let i = 0; i < 50 && s.live.hub.stats().streams !== 1; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(tile(await page(s, a, "/admin/?days=30"), "Live connections"), ["1", "apps connected right now"]);
  assert.equal(T0 > 0, true);
});
