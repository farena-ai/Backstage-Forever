"use strict";
// Every admin page: security headers, no inline script or style, hostile
// player text always escaped; plus the admin actions end to end.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hashInstall } = require("../lib/store");
const html = require("../lib/admin/html");
const { SALT, DAY, uuid, heartbeat, ticket, errorReport, boot, post, form, get, admin } = require("./helpers");

const MANY = { limits: { perIp: { limit: 100000, windowMs: 60_000 }, ticketPerInstall: { limit: 1000, windowMs: DAY }, errorPerInstall: { limit: 1000, windowMs: DAY } } };
const RLO = "\u202e", LRI = "\u2066", ZWSP = "\u200b";
// Markup, attribute breakers, a direction override, and 4,000 characters of it.
const SEED = `<script>alert(1)</script>"'><img src=x onerror=alert(2)></textarea></title><svg onload=alert(3)>&lt;${RLO}txt.exe${LRI}${ZWSP}\`\${7*7}{{7*7}} javascript:alert(4) `;
const hostile = (n) => SEED.repeat(Math.ceil(n / SEED.length)).slice(0, n);
const RAW_MARKERS = ["<script>alert", "<img src=x", "<svg onload", "</textarea></title>", RLO, LRI, ZWSP];

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// Checks one rendered admin page. Tags can only be real tags, because every "<" in text is escaped.
function checkPage(res, body, label) {
  assert.equal(res.headers.get("content-security-policy"), CSP, `${label}: CSP`);
  assert.equal(res.headers.get("x-frame-options"), "DENY", `${label}: X-Frame-Options`);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", `${label}: Referrer-Policy`);
  assert.equal(res.headers.get("cache-control"), "no-store", `${label}: Cache-Control`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${label}: nosniff`);
  assert.match(res.headers.get("content-type"), /^text\/html; charset=utf-8$/, `${label}: content type`);
  for (const m of RAW_MARKERS) assert.ok(!body.includes(m), `${label}: raw hostile text ${JSON.stringify(m)} reached the page`);
  // Hidden characters may only survive (as numeric references) inside form controls, where the text must round-trip.
  const outside = body.replace(/<textarea\b[^>]*>[^<]*<\/textarea>/g, "").replace(/ value="[^"]*"/g, "");
  assert.ok(!/&#x(?:202[a-e]|206[6-9]|200[bef]);/i.test(outside), `${label}: a hidden character is live outside a form control`);

  const scripts = body.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  assert.deepEqual(scripts, ['<script src="/admin/static/admin.js" defer></script>'], `${label}: exactly one script, external and empty`);
  assert.ok(!/<style\b/i.test(body), `${label}: no <style> element`);
  assert.ok(!/<(?:iframe|object|embed|base|meta\s+http-equiv)\b/i.test(body), `${label}: no embedding elements`);

  const tags = body.match(/<[a-zA-Z][^>]*>/g) || [];
  assert.ok(tags.length > 10, `${label}: looks like a page`);
  for (const tag of tags) {
    const rest = tag.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
    const names = [];
    const left = rest.replace(/\s+([^\s"'=<>\/]+)(?:="([^"]*)")?/g, (m, name, value) => { names.push([name.toLowerCase(), value]); return ""; });
    assert.equal(left.trim(), "", `${label}: malformed tag ${tag.slice(0, 120)}`);
    for (const [name, value] of names) {
      assert.ok(!name.startsWith("on"), `${label}: event handler attribute in ${tag.slice(0, 120)}`);
      assert.notEqual(name, "style", `${label}: inline style in ${tag.slice(0, 120)}`);
      assert.notEqual(name, "srcdoc", `${label}: srcdoc`);
      if (["href", "src", "action", "formaction"].includes(name)) assert.match(value, /^(?:\/admin\/|https:\/\/github\.com\/farena-ai\/Backstage-Forever\/)/, `${label}: ${name}="${String(value).slice(0, 80)}"`);
    }
  }
}

async function seedHostile(s) {
  const text4000 = hostile(4000), install = uuid(), hash = hashInstall(SALT, install);
  // Through the public API, exactly as an attacker's client could send it.
  const made = await (await post(s.base, "/v1/tickets", ticket(install, { summary: hostile(140), details: text4000, expected: hostile(1000), diagnostics: { screen: "talents", lastError: hostile(2000), gameConnected: true, addonInstalled: false } }))).json();
  assert.equal(made.ok, true, "the hostile ticket is accepted and stored as given");
  assert.equal((await post(s.base, `/v1/tickets/${made.ticket}/messages`, { schema: 1, text: text4000 }, { "X-BF-Ticket-Key": made.key })).status, 201);
  assert.equal((await post(s.base, "/v1/tickets", ticket(install, { summary: hostile(60) }))).status, 201); // a second ticket of the same install
  assert.equal((await post(s.base, "/v1/errors", errorReport(uuid(), { name: hostile(60), message: hostile(300), stack: [hostile(200), hostile(200), hostile(200)] }))).status, 200);
  assert.equal((await post(s.base, "/v1/heartbeat", heartbeat(install))).status, 200);
  // And straight into the database, for fields the validators would refuse today (old rows, future bugs).
  const db = s.store.db, id = Number(made.ticket.slice(3));
  db.prepare("UPDATE tickets SET kind = ?, area = ?, frequency = ?, app_version = ?, addon_version = ?, os = ?, os_major = ?, lang = ?, build = ?, tags = ?, severity = ?, fixed_in = ?, github = ?, diagnostics = ? WHERE id = ?")
    .run(hostile(30), hostile(30), hostile(30), hostile(30), hostile(30), hostile(30), hostile(30), hostile(30), hostile(30), hostile(40), hostile(20), hostile(20), `javascript:alert(1)//${hostile(40)}`,
      JSON.stringify({ screen: hostile(50), lastError: hostile(2000), gameConnected: true, addonInstalled: true }), id);
  db.prepare("UPDATE heartbeats SET app_version = ?, os = ?, os_major = ?, lang = ?, build = ?, channel = ?").run(hostile(30), hostile(20), hostile(20), hostile(20), hostile(30), "stable");
  db.prepare("UPDATE error_groups SET origin = ?").run(hostile(20));
  db.prepare("UPDATE error_occurrences SET app_version = ?, os = ?").run(hostile(30), hostile(20));
  db.prepare("INSERT INTO obs(kind, key, install, n, first_day, last_day) VALUES ('node', ?, ?, 1, '2026-11-24', '2026-11-24')").run(`herb|n${hostile(40)}|1429|10|10`, hash);
  s.store.desk.saveAnnouncement({ title: hostile(80), text: hostile(600), level: "info", link: null, from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z", minVersion: null, maxVersion: null, os: [], lang: [] }, null, s.clock.t);
  db.prepare("UPDATE announcements SET link = ?, level = ?, min_version = ?, os = ?, lang = ?").run(`javascript:alert(1)//${hostile(30)}`, hostile(10), hostile(20), hostile(20), hostile(20));
  s.store.desk.saveSavedReply({ title: hostile(60), body: text4000 }, s.clock.t);
  s.store.desk.addNote(id, null, text4000, s.clock.t);
  s.store.desk.audit({ id: null, name: hostile(30) }, hostile(30), hostile(80), hostile(200), s.clock.t);
  return { id, ticket: made.ticket, install, hash };
}

test("html helpers escape everything and show hidden characters as codes", () => {
  assert.equal(html.esc(`<a href="x" onclick='y'>&\``), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
  assert.equal(html.esc(null), ""); assert.equal(html.esc(undefined), ""); assert.equal(html.esc(0), "0");
  const out = html.text(`a${RLO}b<i>`);
  assert.ok(!out.includes(RLO));
  assert.match(out, /^a<span class="ctl" title="[^"<>]+">U\+202E<\/span>b&lt;i&gt;$/);
  assert.match(html.text("x\u0007y\u200fz"), /U\+0007.*U\+200F/);
  assert.equal(html.text("plain text, with\nnewline"), "plain text, with\nnewline");
  assert.equal(html.clip("abcdef", 4), "abc…");
  assert.equal(html.select("x", ['"><script>'], '"><script>').includes("<script>"), false);
  assert.equal(html.field('<b>', "", "<i>").includes("<b>"), false);
});

test("hostile player text is escaped on every admin page; CSP and friends on every response; no inline script", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  const seeded = await seedHostile(s);
  const q = encodeURIComponent(hostile(90));
  const pages = [
    "/admin/", "/admin/?days=7", "/admin/?days=90", "/admin/?days=365", `/admin/?days=${q}`,
    "/admin/tickets", "/admin/tickets?filter=all", `/admin/tickets?filter=all&q=${q}`, `/admin/tickets?filter=${q}&kind=${q}&area=${q}&version=${q}&os=${q}&lang=${q}&severity=${q}&tag=${q}&assignee=${q}&page=${q}`,
    `/admin/tickets/${seeded.ticket}`, `/admin/tickets/${seeded.ticket}?done=${q}`, `/admin/tickets/BF-${seeded.id + 1}`,
    "/admin/errors", "/admin/errors/1", "/admin/announcements", "/admin/announcements/1", "/admin/announcements/new",
    "/admin/replies", "/admin/admins", "/admin/audit", `/admin/audit?page=${q}`, "/admin/data",
  ];
  let checked = 0;
  for (const p of pages) {
    const res = await get(s.base, p, { cookie: a.cookie });
    assert.equal(res.status, 200, p);
    const body = await res.text();
    checkPage(res, body, p);
    checked += 1;
  }
  assert.equal(checked, pages.length);

  // The text is really there, escaped (so the checks above were not passing on empty pages).
  const page = await (await get(s.base, `/admin/tickets/${seeded.ticket}`, { cookie: a.cookie })).text();
  assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&gt;&lt;img src=x onerror=alert(2)&gt;"));
  assert.ok(page.includes('<span class="ctl" title="Hidden character, shown as its code">U+202E</span>txt.exe'));
  assert.ok((page.match(/&lt;script&gt;alert\(1\)/g) || []).length > 100, "summary, details, expected, last error, reply and note are all shown");
  assert.ok(!page.includes("javascript:alert(1)//") || !/href="javascript/i.test(page));
  assert.ok(!page.includes(seeded.hash), "the full install hash is never shown");
  assert.ok(page.includes(`<code>${seeded.hash.slice(0, 8)}</code>`));
  const list = await (await get(s.base, "/admin/tickets?filter=all", { cookie: a.cookie })).text();
  assert.ok(list.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok((await (await get(s.base, "/admin/errors", { cookie: a.cookie })).text()).includes("&lt;script&gt;alert(1)"));
  assert.ok((await (await get(s.base, "/admin/audit", { cookie: a.cookie })).text()).includes("&lt;script&gt;alert(1)"));

  // Pages without a session, error pages and refusals carry the same headers and are just as clean.
  for (const [p, status, opts] of [["/admin/login", 200, {}], ["/admin/nope", 404, { cookie: a.cookie }], [`/admin/tickets/${q}`, 404, { cookie: a.cookie }], ["/admin/errors/999", 404, { cookie: a.cookie }], ["/admin/logout", 405, { cookie: a.cookie }]]) {
    const res = await get(s.base, p, opts);
    assert.equal(res.status, status, p);
    checkPage(res, await res.text(), p);
  }
  for (const [p, fields, status] of [
    [`/admin/tickets/${seeded.ticket}/reply`, { csrf: "wrong", text: hostile(100) }, 403],
    [`/admin/tickets/${seeded.ticket}/reply`, { csrf: a.csrf, text: "" }, 400],
    [`/admin/tickets/${seeded.ticket}/update`, { csrf: a.csrf, status: hostile(50) }, 400],
    [`/admin/tickets/${seeded.ticket}/update`, { csrf: a.csrf, status: "new", tags: hostile(60) }, 400],
    ["/admin/announcements/save", { csrf: a.csrf, title: hostile(80), text: "x", level: "info", from: hostile(30), until: "x" }, 400],
    ["/admin/data/purge", { csrf: a.csrf, confirm: "yes", install: hostile(64) }, 400],
  ]) {
    const res = await form(s.base, p, fields, { cookie: a.cookie });
    assert.equal(res.status, status, `${p} ${status}`);
    checkPage(res, await res.text(), `${p} ${status}`);
  }
  const failed = await form(s.base, "/admin/login", { lt: "x", name: hostile(64), password: hostile(64), code: hostile(6) });
  assert.equal(failed.status, 400);
  checkPage(failed, await failed.text(), "login failure");
  const redirect = await get(s.base, "/admin/tickets");
  assert.equal(redirect.headers.get("content-security-policy"), CSP);
  assert.equal(redirect.headers.get("cache-control"), "no-store");

  // Static files: served with the same policy, and the script builds no HTML from text.
  for (const [p, type] of [["/admin/static/admin.css", "text/css; charset=utf-8"], ["/admin/static/admin.js", "text/javascript; charset=utf-8"]]) {
    const res = await get(s.base, p);
    assert.equal(res.headers.get("content-type"), type);
    assert.equal(res.headers.get("content-security-policy"), CSP);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const src = await res.text();
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|https?:\/\//.test(src), `${p}: no HTML sinks, no outside addresses`);
    assert.ok(!/@import|url\(/.test(src), `${p}: nothing is loaded from elsewhere`);
  }

  // The export is JSON for download, never rendered as a page.
  const exp = await form(s.base, "/admin/data/export", { csrf: a.csrf }, { cookie: a.cookie });
  assert.equal(exp.status, 200);
  assert.equal(exp.headers.get("content-type"), "application/json; charset=utf-8");
  assert.match(exp.headers.get("content-disposition"), /^attachment; filename="bf-tickets-2026-11-24\.json"$/);
  assert.equal(exp.headers.get("x-content-type-options"), "nosniff");
  const data = JSON.parse(await exp.text());
  assert.equal(data.tickets.length, 2);
  assert.equal(data.tickets[0].summary, hostile(140)); // stored exactly as sent
  assert.equal(data.tickets[0].install, seeded.hash.slice(0, 8));
  assert.ok(!JSON.stringify(data).includes(seeded.hash) && !JSON.stringify(data).includes("key_hash"));
});

test("missing quest locations are prioritized by reporting installs with an exact ticket filter", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  const i1 = uuid(), i2 = uuid();
  for (const [install, suffix, extra] of [[i1, "12"], [i1, "12"], [i2, "12"], [i2, "121"], [i2, "12 extra"], [i2, "99", { kind: "bug" }], [i1, "77", { area: "map" }]]) {
    const made = await post(s.base, "/v1/tickets", ticket(install, { summary: `Missing location for quest #${suffix}`, kind: "data", area: "quests", ...extra }));
    assert.equal(made.status, 201);
  }
  for (const [install, summary, details, kind] of [[i1, "Missing class trainer", "The location is absent.", "data"], [i2, "Missing recipe source", "I can learn the recipe.", "data"], [i2, "Another missing reference", "The trainer location is absent.", "data"], [i1, "How to open the trainer page", "The button needs a tooltip.", "idea"]]) {
    const made = await post(s.base, "/v1/tickets", ticket(install, { summary, details, kind, area: "professions" }));
    assert.equal(made.status, 201);
  }
  assert.deepEqual(s.store.desk.missingQuestLocations().map(({ questId, installs, reports }) => [questId, installs, reports]), [[12, 2, 3], [121, 1, 1]]);
  assert.deepEqual(s.store.desk.referenceDataReports().map(({ term, installs, reports }) => [term, installs, reports]), [["trainer", 2, 2], ["recipe", 1, 1]]);
  const page = await (await get(s.base, "/admin/tickets", { cookie: a.cookie })).text();
  assert.match(page, /Missing quest locations/);
  assert.match(page, /missingQuest=12"/);
  const filtered = await (await get(s.base, "/admin/tickets?missingQuest=12", { cookie: a.cookie })).text();
  assert.match(filtered, /3 shown by this filter/);
  assert.doesNotMatch(filtered, /Missing location for quest #121|Missing location for quest #12 extra/);
  assert.match(page, /kind=data&amp;q=trainer/);
  const trainers = await (await get(s.base, "/admin/tickets?kind=data&q=trainer", { cookie: a.cookie })).text();
  assert.match(trainers, /2 shown by this filter/);
  assert.doesNotMatch(trainers, /Missing recipe source|How to open the trainer page/);
});

test("tickets: reply, note, handling fields, duplicate, bulk close, delete and block", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  const installs = [uuid(), uuid(), uuid()], made = [];
  for (const [i, inst] of installs.entries()) made.push(await (await post(s.base, "/v1/tickets", ticket(inst, { summary: `Ticket number ${i} about maps`, kind: i === 0 ? "bug" : "idea", os: i === 2 ? "macos" : "windows" }))).json());
  const [t1, t2, t3] = made;
  const go = (p, fields) => form(s.base, p, fields instanceof URLSearchParams ? fields : { csrf: a.csrf, ...fields }, { cookie: a.cookie });
  const row = (id) => s.store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  const player = async (tk) => (await fetch(`${s.base}/v1/tickets/${tk.ticket}`, { headers: { "X-BF-Ticket-Key": tk.key } })).json();

  // Reply: the player sees the text from "team", never the admin's name; New becomes Waiting on us unless a status is picked.
  s.clock.t += 50 * 60_000;
  let r = await go(`/admin/tickets/${t1.ticket}/reply`, { text: "Thanks.\nWhich class?", status: "" });
  assert.equal(r.headers.get("location"), `/admin/tickets/${t1.ticket}?done=replied`);
  assert.equal(row(1001).status, "looking");
  assert.equal(row(1001).first_reply_at, "2026-11-24T12:50:30Z");
  r = await go(`/admin/tickets/${t1.ticket}/reply`, { text: "And which build?", status: "question" });
  let seen = await player(t1);
  assert.equal(seen.status, "question");
  assert.deepEqual(seen.messages.map(m => [m.id, m.from, m.text]), [[1, "player", "Steps: open the planner, pick a tree."], [2, "team", "Thanks.\nWhich class?"], [3, "team", "And which build?"]]);
  assert.ok(!JSON.stringify(seen).includes("alice"));

  // Internal note: never visible to the player and does not move updatedAt.
  const before = seen.updatedAt;
  s.clock.t += 60_000;
  await go(`/admin/tickets/${t1.ticket}/note`, { text: "NOTE-FOR-TEAM" });
  seen = await player(t1);
  assert.ok(!JSON.stringify(seen).includes("NOTE-FOR-TEAM"));
  assert.equal(seen.updatedAt, before);
  assert.equal(seen.messages.length, 3);

  // Handling: status, fixed-in, severity, tags, assignee, GitHub link.
  r = await go(`/admin/tickets/${t1.ticket}/update`, { status: "fixed", fixedIn: "1.26.1", severity: "high", tags: "Maps, needs-repro maps", assignee: String(a.id), github: "https://github.com/farena-ai/Backstage-Forever/issues/42", duplicateOf: "" });
  assert.equal(r.status, 303);
  const u = row(1001);
  assert.deepEqual([u.status, u.fixed_in, u.severity, u.tags, u.assignee, u.github], ["fixed", "1.26.1", "high", "maps needs-repro", a.id, "https://github.com/farena-ai/Backstage-Forever/issues/42"]);
  assert.ok(u.closed_at);
  seen = await player(t1);
  assert.deepEqual([seen.status, seen.fixedIn], ["fixed", "1.26.1"]);
  for (const [k, v] of Object.entries({ severity: "high", tags: "needs-repro", github: "issues/42", assignee: "alice" })) assert.ok(!JSON.stringify(seen).includes(v), `${k} is not for the player`);
  for (const badFields of [{ status: "fixed", fixedIn: "next" }, { status: "fixed", github: "https://evil.example/issues/1" }, { status: "fixed", github: "https://github.com/farena-ai/Backstage-Forever/issues/1/../../../x" },
    { status: "fixed", tags: "one two three four five six seven eight nine" }, { status: "fixed", assignee: "999" }, { status: "fixed", severity: "urgent" }, { status: "fixed", duplicateOf: t1.ticket }, { status: "fixed", duplicateOf: "BF-9999" }])
    assert.equal((await go(`/admin/tickets/${t1.ticket}/update`, badFields)).status, 400, JSON.stringify(badFields));

  // Duplicate: links and closes.
  await go(`/admin/tickets/${t2.ticket}/update`, { status: "new", duplicateOf: t1.ticket });
  assert.deepEqual([row(1002).status, row(1002).duplicate_of], ["closed", 1001]);
  assert.equal((await player(t2)).status, "closed");

  // List: filters, search over summary and messages, facets.
  const list = async (q) => { const body = await (await get(s.base, `/admin/tickets?${q}`, { cookie: a.cookie })).text(); return (body.match(/class="tid"><a href="\/admin\/tickets\/(BF-\d+)"/g) || []).map(x => x.match(/BF-\d+/)[0]); };
  assert.deepEqual(await list("filter=all"), ["BF-1002", "BF-1001", "BF-1003"]); // most recently updated first
  assert.deepEqual(await list("filter=new"), ["BF-1003"]);
  assert.deepEqual(await list("filter=fixed"), ["BF-1001"]);
  assert.deepEqual(await list("filter=closed"), ["BF-1002"]);
  assert.deepEqual(await list(""), ["BF-1003"]); // the default shows open tickets
  assert.deepEqual(await list("filter=all&q=number+2"), ["BF-1003"]);
  assert.deepEqual(await list("filter=all&q=Which+class"), ["BF-1001"]); // found in a message
  assert.deepEqual(await list("filter=all&q=NOTE-FOR-TEAM"), ["BF-1001"]); // and in a note
  assert.deepEqual(await list("filter=all&q=BF-1002"), ["BF-1002"]);
  assert.deepEqual(await list("filter=all&q=100%25"), []); // % is a literal, not a wildcard
  assert.deepEqual(await list("filter=all&kind=bug"), ["BF-1001"]);
  assert.deepEqual(await list("filter=all&os=macos"), ["BF-1003"]);
  assert.deepEqual(await list("filter=all&tag=maps"), ["BF-1001"]);
  assert.deepEqual(await list("filter=all&severity=high"), ["BF-1001"]);
  assert.deepEqual(await list("filter=all&severity=none"), ["BF-1002", "BF-1003"]);
  assert.deepEqual(await list(`filter=all&assignee=${a.id}`), ["BF-1001"]);
  assert.deepEqual(await list("filter=all&assignee=none"), ["BF-1002", "BF-1003"]);
  assert.deepEqual(await list("filter=all&version=1.26.0&lang=en&area=talents"), ["BF-1002", "BF-1001", "BF-1003"]);

  // The ticket page shows the same install's other tickets.
  const again = await (await post(s.base, "/v1/tickets", ticket(installs[2], { summary: "Second from the same install" }))).json();
  const page3 = await (await get(s.base, `/admin/tickets/${t3.ticket}`, { cookie: a.cookie })).text();
  assert.match(page3, /<h2>Same install<\/h2>\s*<ul class="plain"><li><a href="\/admin\/tickets\/BF-1004">BF-1004<\/a>/);
  assert.ok(!page3.includes("BF-1001</a> <span class=\"chip"));

  // Bulk close.
  r = await go("/admin/tickets/bulk", new URLSearchParams([["csrf", a.csrf], ["action", "close"], ["id", "1003"], ["id", "1004"], ["id", "9999"], ["id", "x"]]));
  assert.equal(r.headers.get("location"), "/admin/tickets?done=closed");
  assert.deepEqual([row(1003).status, row(1004).status], ["closed", "closed"]);
  assert.equal((await go("/admin/tickets/bulk", { action: "close" })).headers.get("location"), "/admin/tickets?done=nothing");
  assert.equal((await go("/admin/tickets/bulk", { action: "delete", id: "1003" })).status, 400);

  // Block the install: its tickets stay, new ones are refused.
  assert.equal((await go(`/admin/tickets/${t3.ticket}/block`, {})).status, 400); // needs the tick
  await go(`/admin/tickets/${t3.ticket}/block`, { confirm: "yes" });
  assert.equal(s.store.isBlocked(hashInstall(SALT, installs[2])), true);
  assert.equal((await post(s.base, "/v1/tickets", ticket(installs[2]))).status, 403);
  assert.equal((await post(s.base, "/v1/heartbeat", heartbeat(installs[2]))).status, 403);
  assert.equal((await player(t3)).status, "closed");

  // Delete: gone for the admin and for the player.
  assert.equal((await go(`/admin/tickets/${t2.ticket}/delete`, {})).status, 400);
  r = await go(`/admin/tickets/${t2.ticket}/delete`, { confirm: "yes" });
  assert.equal(r.headers.get("location"), "/admin/tickets?done=deleted");
  assert.equal(row(1002), undefined);
  assert.equal((await fetch(`${s.base}/v1/tickets/${t2.ticket}`, { headers: { "X-BF-Ticket-Key": t2.key } })).status, 404);
  assert.equal((await get(s.base, `/admin/tickets/${t2.ticket}`, { cookie: a.cookie })).status, 404);

  // Every action is in the audit log: who, what, target. Never the text.
  const audit = s.store.db.prepare("SELECT admin_name, action, target, detail FROM audit WHERE action NOT LIKE 'login%' ORDER BY id").all();
  assert.deepEqual(audit.map(x => `${x.action} ${x.target}`), [
    "ticket_reply BF-1001", "ticket_reply BF-1001", "ticket_note BF-1001", "ticket_update BF-1001", "ticket_update BF-1002",
    "ticket_bulk_close BF-1003 BF-1004 BF-9999", `install_block install ${hashInstall(SALT, installs[2]).slice(0, 8)}`, "ticket_delete BF-1002",
  ]);
  assert.ok(audit.every(x => x.admin_name === "alice"));
  assert.equal(audit[3].detail, `status=fixed fixedIn=1.26.1 severity=high tags assignee=${a.id} github=set`);
  const dump = JSON.stringify(s.store.db.prepare("SELECT * FROM audit").all());
  for (const secret of ["Which class", "NOTE-FOR-TEAM", "Ticket number", "issues/42", installs[2], hashInstall(SALT, installs[2])]) assert.ok(!dump.includes(secret), `audit holds ${secret}`);
  const auditPage = await (await get(s.base, "/admin/audit", { cookie: a.cookie })).text();
  assert.ok(auditPage.includes("<code>ticket_bulk_close</code>"));
  // The nav badge counts tickets that need the team.
  await post(s.base, "/v1/tickets", ticket(uuid()));
  assert.match(await (await get(s.base, "/admin/audit", { cookie: a.cookie })).text(), /Tickets <span class="badge" title="1 new, 0 waiting on us">1<\/span>/);
});

test("error groups: list, detail and an internal ticket with no player", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  for (let i = 0; i < 3; i++) await post(s.base, "/v1/errors", errorReport(uuid(), { appVersion: i ? "1.26.0" : "1.25.1" }));
  const listPage = await (await get(s.base, "/admin/errors", { cookie: a.cookie })).text();
  assert.match(listPage, /<a href="\/admin\/errors\/1">TypeError<\/a>/);
  const detail = await (await get(s.base, "/admin/errors/1", { cookie: a.cookie })).text();
  assert.ok(detail.includes("at f (app.js:10:3)\nat g (app.js:20:5)"));
  assert.match(detail, /<th scope="row">1\.26\.0<\/th>.*?<td class="n">2<\/td>/s);

  const r = await form(s.base, "/admin/errors/1/ticket", { csrf: a.csrf }, { cookie: a.cookie });
  assert.equal(r.headers.get("location"), "/admin/tickets/BF-1001?done=ticket");
  const row = s.store.db.prepare("SELECT * FROM tickets WHERE id = 1001").get();
  assert.deepEqual([row.install, row.key_hash, row.status, row.kind, row.summary, row.assignee, row.tags], [null, null, "looking", "bug", "TypeError: x is not a function", a.id, "auto-error"]);
  const again = await form(s.base, "/admin/errors/1/ticket", { csrf: a.csrf }, { cookie: a.cookie }); // not made twice
  assert.equal(again.headers.get("location"), "/admin/tickets/BF-1001?done=ticket");
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM tickets").get().c, 1);
  const page = await (await get(s.base, "/admin/tickets/BF-1001", { cookie: a.cookie })).text();
  assert.match(page, /There is no player to reply to/);
  assert.ok(!page.includes('action="/admin/tickets/BF-1001/reply"') && !page.includes("Block this install"));
  assert.equal((await form(s.base, "/admin/tickets/BF-1001/reply", { csrf: a.csrf, text: "hello" }, { cookie: a.cookie })).status, 404);
  assert.equal((await form(s.base, "/admin/errors/77/ticket", { csrf: a.csrf }, { cookie: a.cookie })).status, 404);
  // The public API cannot see it, and deleting it frees the group for a new ticket.
  assert.equal((await fetch(`${s.base}/v1/tickets/BF-1001`, { headers: { "X-BF-Ticket-Key": "A".repeat(43) } })).status, 404);
  await form(s.base, "/admin/tickets/BF-1001/delete", { csrf: a.csrf, confirm: "yes" }, { cookie: a.cookie });
  assert.equal(s.store.db.prepare("SELECT ticket FROM error_groups WHERE id = 1").get().ticket, null);
});

test("announcements, saved replies and the data page", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  const go = (p, fields) => form(s.base, p, fields instanceof URLSearchParams ? fields : { csrf: a.csrf, ...fields }, { cookie: a.cookie });
  const ann = (extra = {}) => ({ id: "0", title: "1.26.1 is out", text: "It fixes the planner.", level: "warning", link: "https://github.com/farena-ai/Backstage-Forever/releases", from: "2026-11-24T00:00", until: "2026-12-01T00:00", minVersion: "1.25.0", maxVersion: "1.26.0", ...extra });

  // Create with targeting; apps in the audience get it, others do not.
  const p = new URLSearchParams({ csrf: a.csrf, ...ann() }); p.append("os", "windows"); p.append("os", "macos"); p.append("lang", "de");
  let r = await go("/admin/announcements/save", p);
  assert.equal(r.headers.get("location"), "/admin/announcements/1?done=saved");
  const api = async (q) => (await (await fetch(`${s.base}/v1/announcements?${q}`)).json()).announcements;
  assert.deepEqual(await api("appVersion=1.25.3&os=windows&lang=de"), [{ id: 1, title: "1.26.1 is out", text: "It fixes the planner.", level: "warning", from: "2026-11-24T00:00:00Z", until: "2026-12-01T00:00:00Z", link: "https://github.com/farena-ai/Backstage-Forever/releases" }]);
  assert.deepEqual(await api("appVersion=1.25.3&os=linux&lang=de"), []);
  assert.deepEqual(await api("appVersion=1.25.3&os=windows&lang=en"), []);
  assert.deepEqual(await api("appVersion=1.26.1&os=windows&lang=de"), []);
  const edit = await (await get(s.base, "/admin/announcements/1", { cookie: a.cookie })).text();
  assert.match(edit, /Only apps on versions 1\.25\.0 to 1\.26\.0, Windows or macOS, app language German\./);
  assert.match(edit, /<div class="preview warn" id="ann-preview">/);
  assert.match(edit, /<div class="preview-title" data-preview="title" dir="auto">1\.26\.1 is out<\/div>/);
  // Edit: all systems ticked means everyone; expire ends it now.
  const p2 = new URLSearchParams({ csrf: a.csrf, ...ann({ id: "1", level: "info", minVersion: "", maxVersion: "", link: "" }) });
  for (const os of ["windows", "macos", "linux"]) p2.append("os", os);
  await go("/admin/announcements/save", p2);
  assert.equal((await api("appVersion=1.30.0&os=linux&lang=es")).length, 1);
  assert.equal((await api("appVersion=1.30.0&os=linux&lang=es"))[0].link, null);
  for (const badFields of [{ title: "" }, { title: "x".repeat(81) }, { text: "x".repeat(601) }, { level: "urgent" }, { link: "https://evil.example/" }, { link: "javascript:alert(1)" }, { until: "2026-11-23T00:00" }, { from: "yesterday" },
    { minVersion: "1.27.0", maxVersion: "1.26.0" }, { minVersion: "latest" }, { id: "999" }])
    assert.ok([400, 404].includes((await go("/admin/announcements/save", ann(badFields))).status), JSON.stringify(badFields));
  assert.equal((await go("/admin/announcements/save", new URLSearchParams([["csrf", a.csrf], ...Object.entries(ann()), ["os", "amiga"]]))).status, 400);
  await go("/admin/announcements/1/expire", {});
  assert.deepEqual(await api("appVersion=1.30.0&os=linux&lang=es"), []);
  assert.match(await (await get(s.base, "/admin/announcements", { cookie: a.cookie })).text(), /<span class="chip ann-expired">expired<\/span>/);

  // Saved replies appear in the picker on a ticket.
  await go("/admin/replies/save", { id: "0", title: "Ask for the build", body: "Which build is shown under Settings?\nThanks." });
  await go("/admin/replies/save", { id: "1", title: "Ask for the game build", body: "Which game build is shown under Settings?" });
  assert.equal((await go("/admin/replies/save", { id: "0", title: "", body: "x" })).status, 400);
  const made = await (await post(s.base, "/v1/tickets", ticket(uuid()))).json();
  const tp = await (await get(s.base, `/admin/tickets/${made.ticket}`, { cookie: a.cookie })).text();
  assert.match(tp, /<select data-saved-for="reply-text"><option value="">Pick one to insert…<\/option><option value="Which game build is shown under Settings\?">Ask for the game build<\/option><\/select>/);
  assert.match(tp, /<textarea id="reply-text" name="text"/);
  await go("/admin/replies/1/delete", {});
  assert.equal(s.store.desk.listSavedReplies().length, 0);

  // Data page: retention status, database size, purge by id or by hash.
  const inst = uuid(), hash = hashInstall(SALT, inst), other = uuid();
  for (const id of [inst, other]) { await post(s.base, "/v1/heartbeat", heartbeat(id)); await post(s.base, "/v1/tickets", ticket(id)); }
  const dataPage = await (await get(s.base, "/admin/data", { cookie: a.cookie })).text();
  assert.match(dataPage, /<dt>Heartbeat rows kept from<\/dt><dd>2025-11-01<\/dd>/);
  assert.match(dataPage, /<dt>Database size<\/dt><dd>\d+\.\d+ MB<\/dd>/);
  assert.match(dataPage, /<th scope="row">Tickets<\/th><td class="n">3<\/td>/);
  assert.equal((await go("/admin/data/purge", { install: inst })).status, 400); // needs the tick
  assert.equal((await go("/admin/data/purge", { install: "not-an-id", confirm: "yes" })).status, 400);
  r = await go("/admin/data/purge", { install: inst, confirm: "yes" });
  assert.equal(r.headers.get("location"), "/admin/data?done=purged");
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE install = ?").get(hash).c, 0);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM heartbeats WHERE install = ?").get(hash).c, 0);
  assert.equal(s.store.isBlocked(hash), false);
  await go("/admin/data/purge", { install: hashInstall(SALT, other), confirm: "yes", block: "yes" });
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM heartbeats").get().c, 0);
  assert.equal(s.store.isBlocked(hashInstall(SALT, other)), true);
  r = await go("/admin/data/retention", {});
  assert.equal(r.headers.get("location"), "/admin/data?done=retention");
  assert.match(await (await get(s.base, "/admin/data?done=retention", { cookie: a.cookie })).text(), /<p class="flash" role="status">The retention job ran\.<\/p>/);

  const audit = s.store.db.prepare("SELECT action, target, detail FROM audit WHERE action NOT LIKE 'login%' ORDER BY id").all();
  assert.deepEqual(audit.map(x => x.action), ["announcement_create", "announcement_edit", "announcement_expire", "saved_reply_create", "saved_reply_edit", "saved_reply_delete", "install_purge", "install_purge", "retention_run"]);
  assert.equal(audit[6].target, `install ${hash.slice(0, 8)}`);
  assert.ok(!JSON.stringify(audit).includes(inst) && !JSON.stringify(audit).includes(hash) && !JSON.stringify(audit).includes("planner"));
});

test("dashboard: every chart has a title, a plain summary, labelled axes and a table; the honest footnote is there", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  for (let d = 20; d >= 0; d--) {
    for (let n = 0; n < 6; n++) if ((n + d) % 3 !== 0) s.store.desk.recordHeartbeat(hashInstall(SALT, `0000000${n}-0000-4000-8000-000000000000`), heartbeat("x", { appVersion: d > 8 ? "1.25.0" : "1.26.0", os: n % 2 ? "macos" : "windows", lang: n % 3 ? "en" : "de" }), s.clock.t - d * DAY);
  }
  await post(s.base, "/v1/tickets", ticket(uuid()));
  await post(s.base, "/v1/errors", errorReport(uuid()));
  for (const days of [7, 30, 90, 365]) {
    const body = await (await get(s.base, `/admin/?days=${days}`, { cookie: a.cookie })).text();
    assert.match(body, /Counts are installs that send statistics\./, `footnote, ${days} days`);
    assert.match(body, new RegExp(`<a href="/admin/\\?days=${days}" class="on" aria-current="true">`));
    const figures = body.match(/<figure class="card chart">[\s\S]*?<\/figure>/g);
    assert.ok(figures.length >= 16, `${figures.length} charts at ${days} days`);
    for (const f of figures) {
      const title = /<figcaption><h3>([^<]+)<\/h3><p class="summary">([^<]+)<\/p><\/figcaption>/.exec(f);
      assert.ok(title, `title and summary: ${f.slice(0, 120)}`);
      assert.ok(title[2].length > 30 && /[.]$/.test(title[2].trim()), `summary is a sentence: ${title[2]}`);
      if (f.includes("<svg")) {
        assert.match(f, /<svg class="plot" viewBox="0 0 640 262" role="img" aria-labelledby="c\d+t c\d+d"><title id="c\d+t">[^<]+<\/title><desc id="c\d+d">[^<]+<\/desc>/, title[1]);
        assert.equal((f.match(/<text class="axis"/g) || []).length, 2, `${title[1]}: both axes are labelled`);
        assert.match(f, /<details class="tableview"><summary>Show as a table<\/summary>/, `${title[1]}: table view`);
        if ((f.match(/class="line /g) || []).length > 1 || /class="col s2"/.test(f)) assert.match(f, /<ul class="legend">/, `${title[1]}: legend for more than one series`);
      }
    }
    const titles = figures.map(f => /<h3>([^<]+)<\/h3>/.exec(f)[1]);
    for (const want of ["New installs per day", "Active installs", "Stickiness", "Weekly retention", "Version share over time", "Adoption of 1.26.0", "Versions in use", "Operating systems", "Languages",
      "Game builds", "Setup funnel", "Feature reach this week", "New contributors per day", "Tickets opened and closed per week", "Open tickets by age", "Tickets per 1,000 weekly actives, by version", "Top error groups"])
      assert.ok(titles.includes(want), `${want} at ${days} days`);
    assert.ok(titles.some(x => x.startsWith("Community data: new facts per")));
  }
  // An empty database still renders, and says there is nothing yet.
  const e = await boot(); t.after(() => e.close());
  const b = await admin(e);
  const empty = await (await get(e.base, "/admin/", { cookie: b.cookie })).text();
  assert.match(empty, /No data in this period yet\./);
  assert.match(empty, /Counts are installs that send statistics\./);
});
