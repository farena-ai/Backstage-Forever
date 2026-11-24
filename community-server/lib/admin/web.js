"use strict";
// The admin area: /admin/*, server-rendered HTML, cookie session.
//
// Rules this file keeps:
//  - Every response carries a strict Content-Security-Policy (no inline script
//    or style), X-Frame-Options: DENY, Referrer-Policy: no-referrer and
//    Cache-Control: no-store.
//  - Every page except sign-in needs a session; without one the answer is a
//    redirect to the sign-in page.
//  - Every POST needs the session's CSRF token, and is refused when the
//    browser says it came from another site.
//  - Every action is written to the audit log (who, what, when, target) and
//    the audit log never contains player text.
//  - Player text reaches a page only through html.text()/esc().
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const H = require("./html");
const { esc, val, text, block, clip, select, field, csrfInput, when, num, statusChip, chip, page, pager } = H;
const { renderDashboard } = require("./dashboard");
const { lineChart, barList } = require("./charts");
const V = require("../validate-desk");
const { ValidationError } = require("../validate");
const stats = require("../stats");
const { hashInstall, day } = require("../store");

const COOKIE = "__Host-bfadmin";
const FORM_LIMIT = 64 * 1024;
const LOGIN_FORM_MS = 3600_000;
const HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "interest-cohort=(), camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_ISSUE = /^https:\/\/github\.com\/farena-ai\/Backstage-Forever\/(?:issues|pull)\/\d{1,7}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const FLASH = Object.freeze({
  replied: "Reply sent. The player's app will show it the next time it checks.",
  noted: "Internal note added.",
  saved: "Saved.",
  deleted: "Deleted.",
  blocked: "That install is blocked. Its existing tickets were kept.",
  closed: "The selected tickets were closed.",
  expired: "The announcement was ended.",
  disabled: "That admin was disabled and signed out everywhere.",
  purged: "Everything from that install was removed.",
  retention: "The retention job ran.",
  ticket: "Ticket made from the error group.",
  nothing: "Nothing was selected.",
});
const OS_LABEL = { windows: "Windows", macos: "macOS", linux: "Linux" };
const LANG_LABEL = { en: "English", de: "German", fr: "French", es: "Spanish" };

class Refuse extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createAdmin({ store, config, auth, now = () => Date.now(), log = () => {}, loginLimiter, clientKey }) {
  const desk = store.desk;
  const processKey = crypto.randomBytes(32);
  const dir = path.join(__dirname, "static");
  const STATIC = {
    "admin.css": { type: "text/css; charset=utf-8", body: fs.readFileSync(path.join(dir, "admin.css")) },
    "admin.js": { type: "text/javascript; charset=utf-8", body: fs.readFileSync(path.join(dir, "admin.js")) },
  };
  const dashCache = new Map();

  // ------------------------------------------------------------ responses
  function send(res, status, body, headers = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(status, { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Length": buf.length, ...headers });
    res.end(res.req.method === "HEAD" ? undefined : buf);
  }
  function redirect(res, to, headers = {}) {
    res.writeHead(303, { ...HEADERS, Location: to, "Content-Length": 0, ...headers });
    res.end();
  }
  function cookie(value, maxAge) { return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`; }
  function readCookie(req) {
    for (const part of String(req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
    }
    return null;
  }
  function message(res, status, title, detail, session = null, back = "") {
    send(res, status, page({
      title, session, counts: session ? desk.ticketCounts() : null,
      body: `<section class="card narrow"><h1>${esc(title)}</h1><p>${esc(detail)}</p>${back ? `<p><a class="btn" href="${esc(back)}">Go back</a></p>` : ""}</section>`,
    }));
  }

  function readForm(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/x-www-form-urlencoded\s*(;.*)?$/i.test(String(req.headers["content-type"] || ""))) return reject(new Refuse(415, "This form was sent in a way the server does not accept."));
      const chunks = []; let size = 0, done = false;
      req.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > FORM_LIMIT) { done = true; reject(new Refuse(413, "That is too much text for one form.")); return; }
        chunks.push(c);
      });
      req.on("end", () => { if (!done) { done = true; resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))); } });
      req.on("error", () => { if (!done) { done = true; reject(new Refuse(400, "The form could not be read.")); } });
    });
  }

  // A browser states where a form came from. Anything but this site is refused.
  function sameSite(req) {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "" && origin !== config.publicOrigin) return false;
    const site = req.headers["sec-fetch-site"];
    if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
    return true;
  }

  function loginToken() {
    const ts = String(now());
    return `${ts}.${crypto.createHmac("sha256", processKey).update(`login.${ts}`).digest("base64url")}`;
  }
  function loginTokenOk(value) {
    const m = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(String(value ?? ""));
    if (!m) return false;
    const want = Buffer.from(crypto.createHmac("sha256", processKey).update(`login.${m[1]}`).digest("base64url"));
    const age = now() - Number(m[1]);
    return crypto.timingSafeEqual(want, Buffer.from(m[2])) && age >= 0 && age < LOGIN_FORM_MS;
  }

  // ------------------------------------------------------------ form values
  const one = (form, name) => (form.get(name) ?? "").trim();
  function need(cond, msg) { if (!cond) throw new Refuse(400, msg); }
  function formText(form, name, min, max, opts) {
    try { return V.deskText(form.get(name) ?? "", name, min, max, opts).trim(); }
    catch (e) { if (e instanceof ValidationError) throw new Refuse(400, `The ${name} field ${e.message.replace(/^[^:]*: /, "")}.`); throw e; }
  }
  function ticketId(segment) { const n = V.ticketNumber(segment); if (n === null) throw new Refuse(404, "There is no such ticket."); return n; }
  function intId(segment) { const n = Number(segment); if (!Number.isSafeInteger(n) || n < 1) throw new Refuse(404, "Not found."); return n; }
  function installLabel(hash) { return hash ? hash.slice(0, 8) : "none"; }

  // --------------------------------------------------------------- sign-in
  function loginPage(res, status, error = "") {
    send(res, status, page({
      title: "Sign in",
      body: `<section class="card login"><h1>Sign in</h1>
<p class="lede">Backstage Desk admin area. Accounts are made on the server with the command-line tool.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/admin/login" autocomplete="off">
<input type="hidden" name="lt" value="${val(loginToken())}">
${field("Name", '<input name="name" type="text" required maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>')}
${field("Password", '<input name="password" type="password" required maxlength="256" autocomplete="current-password">')}
${field("Authenticator code", '<input name="code" type="text" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code">', "The six digits from your authenticator app.")}
<button class="btn primary" type="submit">Sign in</button>
</form></section>`,
    }));
  }

  async function login(req, res) {
    if (loginLimiter && !loginLimiter.hit(clientKey(req), now()).ok) return loginPage(res, 429, "Too many sign-in attempts from this network. Wait 15 minutes and try again.");
    if (!sameSite(req)) return loginPage(res, 403, "That form was not sent from this site.");
    const form = await readForm(req);
    if (!loginTokenOk(form.get("lt"))) return loginPage(res, 400, "The sign-in form expired. Try again.");
    const r = await auth.login({ name: form.get("name"), password: form.get("password"), code: one(form, "code") });
    if (!r.ok) {
      return r.reason === "locked"
        ? loginPage(res, 429, "Too many failed attempts. Sign-in is locked for 15 minutes.")
        : loginPage(res, 401, "Sign-in failed. Check the name, the password and the code.");
    }
    const old = readCookie(req);
    if (old) auth.logout(old); // the session id is always new at sign-in
    redirect(res, "/admin/", { "Set-Cookie": cookie(r.token, Math.floor(auth.o.sessionAbsoluteMs / 1000)) });
  }

  // ------------------------------------------------------------ dashboard
  function dashboard(ctx) {
    const days = stats.RANGES.includes(Number(ctx.url.searchParams.get("days"))) ? Number(ctx.url.searchParams.get("days")) : 30;
    const key = `${days}|${store.revision()}|${Math.floor(now() / 60_000)}`;
    let data = dashCache.get(key);
    if (!data) {
      data = stats.dashboard(store, { now: now(), days });
      dashCache.clear();
      dashCache.set(key, data);
    }
    ctx.html({ title: "Dashboard", active: "dashboard", wide: true, body: renderDashboard(data) });
  }

  // -------------------------------------------------------------- tickets
  const FILTERS = [["open", "All open"], ["new", "New"], ["us", "Waiting on us"], ["player", "Waiting on player"], ["fixed", "Fixed"], ["closed", "Closed"], ["all", "Everything"]];
  const COUNT_KEY = { open: "open", new: "new", us: "looking", player: "question", fixed: "fixed", closed: "closed", all: "all" };

  function ticketList(ctx) {
    const q = ctx.url.searchParams;
    const pick = (name, list) => (list.includes(q.get(name)) ? q.get(name) : "");
    const facets = desk.ticketFacets(), admins = auth.listAdmins();
    const f = {
      filter: FILTERS.some(x => x[0] === q.get("filter")) ? q.get("filter") : "open",
      q: clip((q.get("q") || "").trim(), 100),
      kind: pick("kind", V.TICKET_KINDS), area: pick("area", V.TICKET_AREAS), version: pick("version", facets.version),
      os: pick("os", V.OS_FAMILIES), lang: pick("lang", V.LANGS), severity: pick("severity", [...V.SEVERITIES, "none"]),
      tag: pick("tag", facets.tag), assignee: pick("assignee", ["none", ...admins.map(a => String(a.id))]),
      page: Math.max(1, Number(q.get("page")) || 1),
    };
    const list = desk.listTickets(f), counts = ctx.counts;
    const params = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "page" && !(k === "filter" && v === "open")));
    const tab = (key, label) => {
      const p = new URLSearchParams({ ...params, filter: key });
      return `<a href="/admin/tickets?${esc(p)}"${f.filter === key ? ' class="on" aria-current="true"' : ""}>${esc(label)} <span class="count">${num(counts[COUNT_KEY[key]])}</span></a>`;
    };
    const any = (label) => [["", label]];
    const rows = list.rows.map(t => `<tr>
<td class="check"><input type="checkbox" name="id" value="${t.id}" form="bulk" aria-label="Select ${esc(V.ticketLabel(t.id))}"></td>
<th scope="row" class="tid"><a href="/admin/tickets/${esc(V.ticketLabel(t.id))}">${esc(V.ticketLabel(t.id))}</a></th>
<td class="sum"><a class="sum-link" href="/admin/tickets/${esc(V.ticketLabel(t.id))}" dir="auto">${text(clip(t.summary, 140))}</a>${t.tags ? `<span class="tags">${t.tags.split(" ").map(x => chip(x, "tag")).join("")}</span>` : ""}</td>
<td>${statusChip(t.status)}</td>
<td>${text(t.kind)}</td><td>${text(t.area)}</td>
<td class="n">${text(t.app_version || "–")}</td><td>${text(OS_LABEL[t.os] || (t.internal ? "internal" : t.os || "–"))}</td>
<td>${t.severity ? chip(t.severity, `sev-${t.severity}`) : '<span class="dim">–</span>'}</td>
<td>${t.assignee_name ? esc(t.assignee_name) : '<span class="dim">–</span>'}</td>
<td class="n">${num(t.messages)}</td>
<td class="nowrap">${when(t.updated_at)}</td></tr>`).join("");
    ctx.html({
      title: "Tickets", active: "tickets", wide: true,
      body: `<div class="head"><h1>Tickets</h1><span class="dim">${num(list.total)} shown by this filter</span></div>
<nav class="tabs" aria-label="Ticket filters">${FILTERS.map(([k, l]) => tab(k, l)).join("")}</nav>
<form class="filters card" method="get" action="/admin/tickets">
<input type="hidden" name="filter" value="${val(f.filter)}">
<label class="field grow"><span class="field-label">Search summaries and messages</span><input type="search" name="q" value="${val(f.q)}" maxlength="100" placeholder="Words, or a ticket number"></label>
${field("Kind", select("kind", [...any("Any"), ...V.TICKET_KINDS], f.kind))}
${field("Area", select("area", [...any("Any"), ...V.TICKET_AREAS], f.area))}
${field("Version", select("version", [...any("Any"), ...facets.version], f.version))}
${field("System", select("os", [...any("Any"), ...V.OS_FAMILIES.map(o => [o, OS_LABEL[o]])], f.os))}
${field("Language", select("lang", [...any("Any"), ...V.LANGS.map(l => [l, LANG_LABEL[l]])], f.lang))}
${field("Severity", select("severity", [...any("Any"), ...V.SEVERITIES, ["none", "Not set"]], f.severity))}
${field("Tag", select("tag", [...any("Any"), ...facets.tag], f.tag))}
${field("Assigned to", select("assignee", [...any("Anyone"), ["none", "Nobody"], ...admins.map(a => [String(a.id), a.name])], f.assignee))}
<div class="filter-go"><button class="btn primary" type="submit">Apply</button><a class="btn quiet" href="/admin/tickets?filter=${esc(f.filter)}">Clear</a></div>
</form>
${list.rows.length ? `<div class="card flush"><div class="scroll"><table class="grid-table tickets">
<thead><tr><th scope="col" class="check"><span class="vh">Select</span></th><th scope="col">Ticket</th><th scope="col">Summary</th><th scope="col">Status</th><th scope="col">Kind</th><th scope="col">Area</th><th scope="col" class="n">Version</th><th scope="col">System</th><th scope="col">Severity</th><th scope="col">Assigned</th><th scope="col" class="n">Msgs</th><th scope="col">Updated</th></tr></thead>
<tbody>${rows}</tbody></table></div></div>
<form id="bulk" class="bulk" method="post" action="/admin/tickets/bulk">${csrfInput(ctx.session)}<span class="dim">With the ticked tickets:</span><button class="btn" type="submit" name="action" value="close">Close them</button></form>
${pager("/admin/tickets", params, list.page, list.pages)}` : '<p class="card empty">No tickets match. Try another filter.</p>'}`,
    });
  }

  function ticketBulk(ctx) {
    const ids = [...new Set(ctx.form.getAll("id").map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 100);
    need(ctx.form.get("action") === "close", "Unknown action.");
    if (!ids.length) return ctx.redirect("/admin/tickets?done=nothing");
    let n = 0;
    for (const id of ids) { const r = desk.updateTicket(id, { status: "closed" }, now()); if (r && r.changed.length) n += 1; }
    desk.audit(ctx.session.admin, "ticket_bulk_close", ids.map(V.ticketLabel).join(" "), `closed=${n}`, now());
    ctx.redirect("/admin/tickets?done=closed");
  }

  function ticketView(ctx, segment) {
    const id = ticketId(segment), t = desk.getTicket(id);
    if (!t) throw new Refuse(404, "There is no such ticket. It may have been deleted.");
    const label = V.ticketLabel(id), base = `/admin/tickets/${label}`, s = ctx.session;
    const msgs = desk.ticketMessages(id), others = desk.otherTickets(t.install, id), saved = desk.listSavedReplies(), admins = auth.listAdmins();
    let diag = null;
    try { diag = t.diagnostics ? JSON.parse(t.diagnostics) : null; } catch { diag = null; }
    const yes = (b) => (b ? "Yes" : "No");
    const who = { player: "Player", team: "Team", note: "Internal note" };
    const thread = msgs.map(m => `<article class="msg ${esc(m.sender)}"><header><span class="msg-who">${esc(who[m.sender] || m.sender)}${m.admin_name ? ` · ${esc(m.admin_name)}` : ""}</span>${m.sender === "note" ? '<span class="msg-hint">the player never sees this</span>' : ""}<span class="msg-at">${when(m.at)}</span></header>${block(m.text)}</article>`).join("");
    const dl = (pairs) => `<dl class="facts">${pairs.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
    const statusOptions = V.TICKET_STATUSES.map(st => [st, `${H.STATUS_LABEL[st]} (player sees: ${H.PLAYER_SEES[st]})`]);
    const dup = t.duplicate_of ? V.ticketLabel(t.duplicate_of) : "";
    ctx.html({
      title: label, active: "tickets", wide: true,
      body: `<p class="crumb"><a href="/admin/tickets">Tickets</a> › ${esc(label)}</p>
<div class="head ticket-head"><h1><span class="tid">${esc(label)}</span> <span dir="auto">${text(t.summary)}</span></h1><div class="head-chips">${statusChip(t.status)}${t.fixed_in ? chip(`fixed in ${t.fixed_in}`, "st-fixed") : ""}${t.severity ? chip(t.severity, `sev-${t.severity}`) : ""}${t.install ? "" : chip("internal", "tag")}</div></div>
<div class="ticket">
<div class="ticket-main">
<section class="card"><h2>Conversation</h2>
${thread || '<p class="empty">No messages.</p>'}
${t.expected ? `<article class="msg player expected"><header><span class="msg-who">Player · what they expected</span></header>${block(t.expected)}</article>` : ""}
</section>
${t.install ? `<section class="card"><h2>Reply to the player</h2>
<form method="post" action="${base}/reply">${csrfInput(s)}
${saved.length ? `<label class="field"><span class="field-label">Saved reply</span><select data-saved-for="reply-text"><option value="">Pick one to insert…</option>${saved.map(r => `<option value="${val(r.body)}">${esc(r.title)}</option>`).join("")}</select></label>` : ""}
<label class="field"><span class="field-label">Reply (plain text, up to 4,000 characters)</span><textarea id="reply-text" name="text" rows="6" maxlength="4000" required></textarea></label>
<div class="row">${field("Then set status to", select("status", [["", "Leave as it is (New becomes Waiting on us)"], ...statusOptions], t.status === "new" || t.status === "looking" ? "question" : ""))}
<button class="btn primary" type="submit">Send reply</button></div>
</form></section>` : '<section class="card"><p class="dim">This ticket was made by the team from an error group. There is no player to reply to.</p></section>'}
<section class="card"><h2>Internal note</h2>
<form method="post" action="${base}/note">${csrfInput(s)}
<label class="field"><span class="field-label">Note for the team (never shown to the player)</span><textarea name="text" rows="3" maxlength="4000" required></textarea></label>
<button class="btn" type="submit">Add note</button></form></section>
</div>
<aside class="ticket-side">
<section class="card"><h2>Handling</h2>
<form method="post" action="${base}/update" class="stack">${csrfInput(s)}
${field("Status", select("status", statusOptions, t.status))}
${field("Fixed in version", `<input name="fixedIn" value="${val(t.fixed_in || "")}" maxlength="11" pattern="[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}" placeholder="1.26.0">`, "The app shows it once that version is installed.")}
${field("Severity", select("severity", [["", "Not set"], ...V.SEVERITIES], t.severity || ""))}
${field("Tags", `<input name="tags" value="${val(t.tags)}" maxlength="200" placeholder="talents needs-repro">`, "Up to 8, separated by spaces: letters, digits and dashes.")}
${field("Assigned to", select("assignee", [["", "Nobody"], ...admins.filter(a => !a.disabled || a.id === t.assignee).map(a => [String(a.id), a.name])], t.assignee || ""))}
${field("GitHub issue", `<input name="github" type="url" value="${val(t.github || "")}" maxlength="120" placeholder="https://github.com/farena-ai/Backstage-Forever/issues/123">`)}
${field("Duplicate of", `<input name="duplicateOf" value="${val(dup)}" maxlength="12" pattern="BF-[0-9]{4,9}" placeholder="BF-1001">`, "Setting this also closes the ticket.")}
<button class="btn primary" type="submit">Save</button></form>
${t.github && GITHUB_ISSUE.test(t.github) ? `<p class="side-link"><a href="${esc(t.github)}" rel="noreferrer noopener" target="_blank">Open the GitHub issue</a></p>` : ""}
${t.duplicate_of ? `<p class="side-link">Duplicate of <a href="/admin/tickets/${esc(dup)}">${esc(dup)}</a></p>` : ""}
</section>
<section class="card"><h2>Report details</h2>
${dl([["Kind", esc(t.kind)], ["Area", esc(t.area)], ["How often", esc(t.frequency || "not said")],
    ["App version", esc(t.app_version || "–")], ["Addon version", esc(t.addon_version || "–")],
    ["System", esc(`${OS_LABEL[t.os] || "–"}${t.os_major ? ` ${t.os_major}` : ""}`)], ["Language", esc(LANG_LABEL[t.lang] || t.lang || "–")],
    ["Game build", esc(t.build || "–")], ["Install", `<code>${esc(installLabel(t.install))}</code>`],
    ["Opened", when(t.created_at)], ["Updated", when(t.updated_at)], t.first_reply_at ? ["First reply", when(t.first_reply_at)] : null, t.closed_at ? ["Closed", when(t.closed_at)] : null])}
</section>
<section class="card"><h2>Diagnostics</h2>
${diag ? `${dl([["Screen", text(diag.screen)], ["Game connected", yes(diag.gameConnected)], ["Addon installed", yes(diag.addonInstalled)]])}
${diag.lastError ? `<h3>Last error</h3>${block(diag.lastError, "mono")}` : '<p class="dim">No last error was attached.</p>'}` : '<p class="dim">The player left diagnostics out.</p>'}
</section>
${t.install ? `<section class="card"><h2>Same install</h2>
${others.length ? `<ul class="plain">${others.map(o => `<li><a href="/admin/tickets/${esc(V.ticketLabel(o.id))}">${esc(V.ticketLabel(o.id))}</a> ${statusChip(o.status)} <span class="clip1" dir="auto">${text(clip(o.summary, 60))}</span></li>`).join("")}</ul>` : '<p class="dim">No other tickets from this install.</p>'}
</section>` : ""}
<section class="card danger"><h2>Remove</h2>
<form method="post" action="${base}/delete" class="stack">${csrfInput(s)}
<label class="tick"><input type="checkbox" name="confirm" value="yes" required> Delete this ticket and its messages for good</label>
<button class="btn danger" type="submit">Delete ticket</button></form>
${t.install ? `<form method="post" action="${base}/block" class="stack">${csrfInput(s)}
<label class="tick"><input type="checkbox" name="confirm" value="yes" required> Refuse everything this install sends from now on</label>
<button class="btn danger" type="submit">Block this install</button></form>` : ""}
</section>
</aside></div>`,
    });
  }

  function ticketReply(ctx, segment) {
    const id = ticketId(segment), t = desk.getTicket(id);
    if (!t || !t.install) throw new Refuse(404, "There is no player on this ticket to reply to.");
    const body = formText(ctx.form, "text", 1, V.DESK_LIMITS.message);
    const status = one(ctx.form, "status");
    need(status === "" || V.TICKET_STATUSES.includes(status), "Unknown status.");
    const r = desk.adminReply(id, ctx.session.admin.id, body, status || null, now());
    desk.audit(ctx.session.admin, "ticket_reply", V.ticketLabel(id), `status=${r.status}`, now());
    ctx.redirect(`/admin/tickets/${V.ticketLabel(id)}?done=replied`);
  }

  function ticketNote(ctx, segment) {
    const id = ticketId(segment);
    const body = formText(ctx.form, "text", 1, V.DESK_LIMITS.message);
    if (!desk.addNote(id, ctx.session.admin.id, body, now())) throw new Refuse(404, "There is no such ticket.");
    desk.audit(ctx.session.admin, "ticket_note", V.ticketLabel(id), "", now());
    ctx.redirect(`/admin/tickets/${V.ticketLabel(id)}?done=noted`);
  }

  function ticketUpdate(ctx, segment) {
    const id = ticketId(segment), form = ctx.form, t = desk.getTicket(id);
    if (!t) throw new Refuse(404, "There is no such ticket.");
    const f = {};
    const status = one(form, "status"); need(V.TICKET_STATUSES.includes(status), "Unknown status.");
    f.status = status;
    const fixedIn = one(form, "fixedIn"); need(fixedIn === "" || V.SEMVER.test(fixedIn), "Fixed in version must look like 1.26.0.");
    f.fixedIn = fixedIn || null;
    const severity = one(form, "severity"); need(severity === "" || V.SEVERITIES.includes(severity), "Unknown severity.");
    f.severity = severity || null;
    const tags = [...new Set(one(form, "tags").toLowerCase().split(/[\s,]+/).filter(Boolean))];
    need(tags.length <= 8 && tags.every(x => TAG.test(x)), "Tags: up to 8, each 1 to 24 letters, digits or dashes.");
    f.tags = tags.join(" ");
    const assignee = one(form, "assignee");
    need(assignee === "" || auth.listAdmins().some(a => String(a.id) === assignee), "Unknown admin.");
    f.assignee = assignee ? Number(assignee) : null;
    const github = one(form, "github"); need(github === "" || GITHUB_ISSUE.test(github), "The GitHub link must be an issue or pull request of farena-ai/Backstage-Forever.");
    f.github = github || null;
    const dup = one(form, "duplicateOf");
    if (dup) {
      const other = V.ticketNumber(dup);
      need(other !== null && other !== id && !!desk.getTicket(other), "Duplicate of: there is no such other ticket.");
      f.duplicateOf = other;
      if (t.duplicate_of !== other && status === t.status) f.status = "closed";
    } else f.duplicateOf = null;
    const r = desk.updateTicket(id, f, now());
    if (r.changed.length) {
      const detail = r.changed.map(k => ({ status: `status=${f.status}`, fixed_in: `fixedIn=${f.fixedIn || "none"}`, severity: `severity=${f.severity || "none"}`, tags: "tags",
        assignee: `assignee=${f.assignee || "none"}`, github: `github=${f.github ? "set" : "none"}`, duplicate_of: `duplicateOf=${f.duplicateOf ? V.ticketLabel(f.duplicateOf) : "none"}` })[k]).join(" ");
      desk.audit(ctx.session.admin, "ticket_update", V.ticketLabel(id), detail, now());
    }
    ctx.redirect(`/admin/tickets/${V.ticketLabel(id)}?done=saved`);
  }

  function ticketDelete(ctx, segment) {
    const id = ticketId(segment);
    need(ctx.form.get("confirm") === "yes", "Tick the box to confirm.");
    if (!desk.deleteTicket(id)) throw new Refuse(404, "There is no such ticket.");
    desk.audit(ctx.session.admin, "ticket_delete", V.ticketLabel(id), "", now());
    ctx.redirect("/admin/tickets?done=deleted");
  }

  function ticketBlock(ctx, segment) {
    const id = ticketId(segment), t = desk.getTicket(id);
    need(ctx.form.get("confirm") === "yes", "Tick the box to confirm.");
    if (!t || !t.install) throw new Refuse(404, "There is no install on this ticket.");
    store.blockInstall(t.install, now());
    desk.audit(ctx.session.admin, "install_block", `install ${installLabel(t.install)}`, `from=${V.ticketLabel(id)}`, now());
    ctx.redirect(`/admin/tickets/${V.ticketLabel(id)}?done=blocked`);
  }

  // --------------------------------------------------------------- errors
  function errorList(ctx) {
    const since = stats.addDays(day(now()), -29);
    const groups = desk.listErrorGroups({ sinceDay: since, limit: 200 });
    ctx.html({
      title: "Errors", active: "errors", wide: true,
      body: `<div class="head"><h1>Error groups</h1><span class="dim">Automatic error reports, grouped by error name and the first three stack lines</span></div>
${groups.length ? `<div class="card flush"><div class="scroll"><table class="grid-table">
<thead><tr><th scope="col">Error</th><th scope="col">Where</th><th scope="col" class="n">Last 30 days</th><th scope="col" class="n">All time</th><th scope="col" class="n">Versions</th><th scope="col">First seen</th><th scope="col">Last seen</th><th scope="col">Ticket</th></tr></thead><tbody>
${groups.map(g => `<tr><th scope="row" class="sum"><a href="/admin/errors/${g.id}">${text(g.name)}</a> <span class="dim clip1" dir="auto">${text(clip(g.message, 90))}</span></th><td>${esc(g.origin)}</td><td class="n">${num(g.recent)}</td><td class="n">${num(g.total)}</td><td class="n">${num(g.versions)}</td><td>${esc(g.first_day)}</td><td>${esc(g.last_day)}</td><td>${g.ticket ? `<a href="/admin/tickets/${esc(V.ticketLabel(g.ticket))}">${esc(V.ticketLabel(g.ticket))}</a>` : '<span class="dim">–</span>'}</td></tr>`).join("")}
</tbody></table></div></div>` : '<p class="card empty">No automatic error reports yet. Players have to switch them on.</p>'}
<p class="footnote">Only installs that switched on automatic error reports send these. No install id is stored with an error report.</p>`,
    });
  }

  function errorView(ctx, segment) {
    const g = desk.getErrorGroup(intId(segment));
    if (!g) throw new Refuse(404, "There is no such error group.");
    const total = g.byVersion.reduce((a, r) => a + r.n, 0) || 1;
    const first = g.byDay.length ? g.byDay[0].day : g.first_day, last = day(now());
    const days = [];
    for (let d = first > stats.addDays(last, -89) ? first : stats.addDays(last, -89); d <= last; d = stats.addDays(d, 1)) days.push(d);
    const perDay = new Map(g.byDay.map(r => [r.day, r.n]));
    ctx.html({
      title: `Error #${g.id}`, active: "errors", wide: true,
      body: `<p class="crumb"><a href="/admin/errors">Errors</a> › #${g.id}</p>
<div class="head"><h1>Error group #${g.id}: <span dir="auto">${text(g.name)}</span></h1><div class="head-chips">${chip(`${g.origin} process`, "tag")}${chip(`${num(g.total)} reports`, "tag")}</div></div>
<div class="ticket"><div class="ticket-main">
<section class="card"><h2>Message</h2>${block(g.message, "mono")}<h2>Stack</h2>${g.stack.length ? block(g.stack.join("\n"), "mono") : '<p class="dim">No stack was sent.</p>'}
<p class="note">This is the first report of the group. File names only: the app and the server both remove folders.</p></section>
${lineChart({ title: "Reports per day", summary: `${num(g.total)} reports since ${g.first_day}; last seen ${g.last_day}. Up to the last 90 days are drawn.`, days, series: [{ name: "Reports", values: days.map(d => perDay.get(d) || 0), cls: "s1" }], yLabel: "Reports" })}
</div><aside class="ticket-side">
<section class="card"><h2>Ticket</h2>
${g.ticket ? `<p>Tracked in <a href="/admin/tickets/${esc(V.ticketLabel(g.ticket))}">${esc(V.ticketLabel(g.ticket))}</a>.</p>` : `<p class="dim">Makes an internal ticket with no player, assigned to you.</p>
<form method="post" action="/admin/errors/${g.id}/ticket">${csrfInput(ctx.session)}<button class="btn primary" type="submit">Make a ticket from this</button></form>`}
</section>
${barList({ title: "Version", summary: "Reports per app version, newest version first.", rows: g.byVersion.map(r => ({ label: r.app_version, n: r.n, pct: Math.round((r.n / total) * 1000) / 10 })), countLabel: "Reports", limit: 12 })}
${barList({ title: "System", summary: "Reports per operating system.", rows: g.byOs.map(r => ({ label: OS_LABEL[r.os] || r.os, n: r.n, pct: Math.round((r.n / total) * 1000) / 10 })), countLabel: "Reports" })}
</aside></div>`,
    });
  }

  function errorTicket(ctx, segment) {
    const gid = intId(segment);
    const tid = desk.ticketFromErrorGroup(gid, ctx.session.admin.id, now());
    if (!tid) throw new Refuse(404, "There is no such error group.");
    desk.audit(ctx.session.admin, "error_ticket", `error #${gid}`, `ticket=${V.ticketLabel(tid)}`, now());
    ctx.redirect(`/admin/tickets/${V.ticketLabel(tid)}?done=ticket`);
  }

  // -------------------------------------------------------- announcements
  function annState(a, at) { return a.until_at <= at ? "expired" : a.from_at > at ? "scheduled" : "live"; }
  function audience(a) {
    const parts = [];
    if (a.min_version && a.max_version) parts.push(a.min_version === a.max_version ? `version ${a.min_version}` : `versions ${a.min_version} to ${a.max_version}`);
    else if (a.min_version) parts.push(`version ${a.min_version} and newer`);
    else if (a.max_version) parts.push(`version ${a.max_version} and older`);
    if (a.os) parts.push(a.os.split(",").map(o => OS_LABEL[o] || o).join(" or "));
    if (a.lang) parts.push(`app language ${a.lang.split(",").map(l => LANG_LABEL[l] || l).join(" or ")}`);
    return parts.length ? `Only apps on ${parts.join(", ")}.` : "Every app.";
  }
  function previewCard(a) {
    return `<div class="preview ${a.level === "warning" ? "warn" : "info"}" id="ann-preview"><div class="preview-kind" data-preview="level">${a.level === "warning" ? "Warning" : "From the team"}</div>
<div class="preview-title" data-preview="title" dir="auto">${text(a.title || "Title")}</div><div class="preview-text pre" data-preview="text" dir="auto">${text(a.text || "Text")}</div>
<div class="preview-link" data-preview="link">${a.link ? esc(a.link) : ""}</div></div>`;
  }

  function announcementList(ctx) {
    const at = new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    const list = desk.listAnnouncements();
    ctx.html({
      title: "Announcements", active: "announcements",
      body: `<div class="head"><h1>Announcements</h1><a class="btn primary" href="/admin/announcements/new">New announcement</a></div>
<p class="lede">A short message from the team, shown once in each app's What's New area. Apps ask about once an hour.</p>
${list.length ? `<div class="card flush"><div class="scroll"><table class="grid-table"><thead><tr><th scope="col">Title</th><th scope="col">State</th><th scope="col">Who gets it</th><th scope="col">From</th><th scope="col">Until</th></tr></thead><tbody>
${list.map(a => `<tr><th scope="row"><a href="/admin/announcements/${a.id}" dir="auto">${text(a.title)}</a></th><td>${chip(annState(a, at), `ann-${annState(a, at)}`)}${a.level === "warning" ? chip("warning", "sev-high") : ""}</td><td>${esc(audience(a))}</td><td class="nowrap">${when(a.from_at)}</td><td class="nowrap">${when(a.until_at)}</td></tr>`).join("")}
</tbody></table></div></div>` : '<p class="card empty">No announcements yet.</p>'}`,
    });
  }

  function announcementForm(ctx, segment) {
    const at = new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    let a;
    if (segment === "new") {
      a = { id: 0, title: "", text: "", level: "info", link: "", from_at: at, until_at: new Date(now() + 14 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), min_version: "", max_version: "", os: "", lang: "" };
    } else {
      a = desk.getAnnouncement(intId(segment));
      if (!a) throw new Refuse(404, "There is no such announcement.");
    }
    const local = (v) => String(v).slice(0, 16);
    const ticks = (name, all, labels, chosen) => all.map(v => `<label class="tick"><input type="checkbox" name="${name}" value="${v}"${chosen.split(",").includes(v) ? " checked" : ""}> ${esc(labels[v])}</label>`).join("");
    const state = a.id ? annState(a, at) : "";
    ctx.html({
      title: a.id ? "Edit announcement" : "New announcement", active: "announcements",
      body: `<p class="crumb"><a href="/admin/announcements">Announcements</a> › ${a.id ? `#${a.id}` : "New"}</p>
<div class="head"><h1>${a.id ? "Edit announcement" : "New announcement"}</h1>${state ? `<div class="head-chips">${chip(state, `ann-${state}`)}</div>` : ""}</div>
<div class="two">
<section class="card"><form method="post" action="/admin/announcements/save" class="stack" data-preview-form>${csrfInput(ctx.session)}<input type="hidden" name="id" value="${a.id}">
${field("Title (up to 80 characters)", `<input name="title" value="${val(a.title)}" maxlength="80" required>`)}
<label class="field"><span class="field-label">Text (up to 600 characters, plain text)</span><textarea name="text" rows="5" maxlength="600" required>${val(a.text)}</textarea></label>
<div class="row top">${field("Level", select("level", [["info", "Information"], ["warning", "Warning"]], a.level))}
${field("Link (optional)", `<input name="link" type="url" value="${val(a.link || "")}" maxlength="300" placeholder="https://github.com/farena-ai/Backstage-Forever/releases">`, "Only the project on github.com or backstagecoding.com.")}</div>
<div class="row">${field("Show from (UTC)", `<input name="from" type="datetime-local" value="${val(local(a.from_at))}" required>`)}
${field("Show until (UTC)", `<input name="until" type="datetime-local" value="${val(local(a.until_at))}" required>`)}</div>
<div class="row">${field("Lowest app version", `<input name="minVersion" value="${val(a.min_version || "")}" maxlength="11" pattern="[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}" placeholder="any">`)}
${field("Highest app version", `<input name="maxVersion" value="${val(a.max_version || "")}" maxlength="11" pattern="[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}" placeholder="any">`)}</div>
<fieldset class="ticks"><legend>Systems (none ticked means all)</legend>${ticks("os", V.OS_FAMILIES, OS_LABEL, a.os)}</fieldset>
<fieldset class="ticks"><legend>App languages (none ticked means all)</legend>${ticks("lang", V.LANGS, LANG_LABEL, a.lang)}</fieldset>
<button class="btn primary" type="submit">${a.id ? "Save changes" : "Create"}</button></form></section>
<aside><section class="card"><h2>Preview</h2><p class="dim">Roughly how the app shows it.</p>${previewCard(a)}
${a.id ? `<h3>Who gets it</h3><p>${esc(audience(a))}</p><p class="dim">Showing ${when(a.from_at)} to ${when(a.until_at)} (UTC).</p>` : '<p class="dim">Who gets it is listed here once it is saved.</p>'}</section>
${a.id && state !== "expired" ? `<section class="card danger"><h2>End it now</h2><form method="post" action="/admin/announcements/${a.id}/expire" class="stack">${csrfInput(ctx.session)}<p class="dim">Apps stop receiving it within the hour. Apps that already showed it keep it.</p><button class="btn danger" type="submit">End this announcement</button></form></section>` : ""}
</aside></div>`,
    });
  }

  function announcementSave(ctx) {
    const form = ctx.form, id = Number(one(form, "id")) || 0;
    const stamp = (name) => {
      const v = one(form, name);
      need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v) && !Number.isNaN(Date.parse(`${v.slice(0, 16)}:00Z`)), `The ${name} time is not valid.`);
      return `${v.slice(0, 16)}:00Z`;
    };
    const version = (name) => { const v = one(form, name); need(v === "" || V.SEMVER.test(v), "Versions must look like 1.26.0."); return v || null; };
    const subset = (name, all) => { const got = [...new Set(form.getAll(name))]; need(got.every(x => all.includes(x)), "Unknown choice."); return got.length === all.length ? [] : all.filter(x => got.includes(x)); };
    let link;
    try { link = V.announcementLink(one(form, "link")); } catch { throw new Refuse(400, "The link must be an https link to github.com/farena-ai/Backstage-Forever or backstagecoding.com."); }
    const a = {
      id, title: formText(form, "title", 1, V.DESK_LIMITS.announcementTitle, { singleLine: true }), text: formText(form, "text", 1, V.DESK_LIMITS.announcementText),
      level: one(form, "level"), link, from: stamp("from"), until: stamp("until"),
      minVersion: version("minVersion"), maxVersion: version("maxVersion"), os: subset("os", V.OS_FAMILIES), lang: subset("lang", V.LANGS),
    };
    need(V.ANNOUNCEMENT_LEVELS.includes(a.level), "Unknown level.");
    need(a.until > a.from, "The end time must be after the start time.");
    need(!a.minVersion || !a.maxVersion || V.compareVersions(a.minVersion, a.maxVersion) <= 0, "The lowest version is above the highest version.");
    const saved = desk.saveAnnouncement(a, ctx.session.admin.id, now());
    if (!saved) throw new Refuse(404, "There is no such announcement.");
    desk.audit(ctx.session.admin, id ? "announcement_edit" : "announcement_create", `announcement #${saved}`, `level=${a.level} from=${a.from} until=${a.until}`, now());
    ctx.redirect(`/admin/announcements/${saved}?done=saved`);
  }

  function announcementExpire(ctx, segment) {
    const id = intId(segment);
    desk.expireAnnouncement(id, now());
    desk.audit(ctx.session.admin, "announcement_expire", `announcement #${id}`, "", now());
    ctx.redirect(`/admin/announcements/${id}?done=expired`);
  }

  // -------------------------------------------------------- saved replies
  function replyList(ctx) {
    const list = desk.listSavedReplies();
    const form = (r) => `<form method="post" action="/admin/replies/save" class="stack">${csrfInput(ctx.session)}<input type="hidden" name="id" value="${r.id || 0}">
${field("Title", `<input name="title" value="${val(r.title || "")}" maxlength="60" required>`)}
<label class="field"><span class="field-label">Text</span><textarea name="body" rows="5" maxlength="4000" required>${val(r.body || "")}</textarea></label>
<button class="btn${r.id ? "" : " primary"}" type="submit">${r.id ? "Save" : "Add saved reply"}</button></form>`;
    ctx.html({
      title: "Saved replies", active: "replies",
      body: `<div class="head"><h1>Saved replies</h1></div><p class="lede">Text you send often. Pick one on a ticket to put it in the reply box, then edit it before sending.</p>
<div class="two"><div>${list.length ? list.map(r => `<details class="card fold"><summary><span class="fold-title">${esc(r.title)}</span><span class="dim">${when(r.updated_at)}</span></summary>${form(r)}
<form method="post" action="/admin/replies/${r.id}/delete" class="inline-form">${csrfInput(ctx.session)}<button class="btn danger quiet" type="submit" data-confirm="Delete this saved reply?">Delete</button></form></details>`).join("") : '<p class="card empty">No saved replies yet.</p>'}</div>
<aside><section class="card"><h2>New saved reply</h2>${form({})}</section></aside></div>`,
    });
  }

  function replySave(ctx) {
    const id = Number(one(ctx.form, "id")) || 0;
    const saved = desk.saveSavedReply({ id, title: formText(ctx.form, "title", 1, 60, { singleLine: true }), body: formText(ctx.form, "body", 1, V.DESK_LIMITS.message) }, now());
    if (!saved) throw new Refuse(404, "There is no such saved reply.");
    desk.audit(ctx.session.admin, id ? "saved_reply_edit" : "saved_reply_create", `saved reply #${saved}`, "", now());
    ctx.redirect("/admin/replies?done=saved");
  }

  function replyDelete(ctx, segment) {
    const id = intId(segment);
    desk.deleteSavedReply(id);
    desk.audit(ctx.session.admin, "saved_reply_delete", `saved reply #${id}`, "", now());
    ctx.redirect("/admin/replies?done=deleted");
  }

  // --------------------------------------------------------------- admins
  function adminList(ctx) {
    const list = auth.listAdmins();
    ctx.html({
      title: "Admins", active: "admins",
      body: `<div class="head"><h1>Admins</h1></div>
<p class="lede">Accounts are made, re-enabled and given new authenticator secrets only with the command-line tool on the server (<code>admin.js admin-add</code>). There is no sign-up.</p>
<div class="card flush"><div class="scroll"><table class="grid-table"><thead><tr><th scope="col">Name</th><th scope="col">State</th><th scope="col">Created</th><th scope="col">Last sign-in</th><th scope="col" class="n">Sessions</th><th scope="col"><span class="vh">Action</span></th></tr></thead><tbody>
${list.map(a => `<tr><th scope="row">${esc(a.name)}${a.id === ctx.session.admin.id ? ' <span class="dim">(you)</span>' : ""}</th><td>${a.disabled ? chip("disabled", "st-closed") : chip("active", "st-fixed")}</td><td class="nowrap">${when(a.created_at)}</td><td class="nowrap">${a.last_login_at ? when(a.last_login_at) : '<span class="dim">never</span>'}</td><td class="n">${num(a.sessions)}</td>
<td>${a.disabled || a.id === ctx.session.admin.id ? "" : `<form method="post" action="/admin/admins/${a.id}/disable" class="inline-form">${csrfInput(ctx.session)}<button class="btn danger quiet" type="submit" data-confirm="Disable ${esc(a.name)} and sign them out?">Disable</button></form>`}</td></tr>`).join("")}
</tbody></table></div></div>`,
    });
  }

  function adminDisable(ctx, segment) {
    const id = intId(segment);
    need(id !== ctx.session.admin.id, "You cannot disable your own account.");
    const name = auth.setDisabled(id, true);
    if (!name) throw new Refuse(404, "There is no such admin.");
    desk.audit(ctx.session.admin, "admin_disable", name, "", now());
    ctx.redirect("/admin/admins?done=disabled");
  }

  // ---------------------------------------------------------------- audit
  function auditList(ctx) {
    const list = desk.listAudit(Math.max(1, Number(ctx.url.searchParams.get("page")) || 1));
    ctx.html({
      title: "Audit log", active: "audit", wide: true,
      body: `<div class="head"><h1>Audit log</h1><span class="dim">${num(list.total)} entries</span></div>
<p class="lede">Every sign-in and every admin action: who, what, when and on what. It never holds what a player wrote.</p>
${list.rows.length ? `<div class="card flush"><div class="scroll"><table class="grid-table"><thead><tr><th scope="col">When (UTC)</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Detail</th></tr></thead><tbody>
${list.rows.map(r => `<tr><td class="nowrap">${when(r.at)}</td><th scope="row">${esc(r.admin_name)}</th><td><code>${esc(r.action)}</code></td><td>${esc(r.target)}</td><td class="dim">${esc(r.detail)}</td></tr>`).join("")}
</tbody></table></div></div>${pager("/admin/audit", {}, list.page, list.pages)}` : '<p class="card empty">Nothing yet.</p>'}`,
    });
  }

  // ----------------------------------------------------------------- data
  function dataPage(ctx) {
    const st = stats.retentionStatus(store, now());
    const mb = st.dbBytes === null ? "–" : `${(st.dbBytes / 1048576).toFixed(st.dbBytes < 10485760 ? 2 : 1)} MB`;
    const ROWS = [["heartbeats", "Heartbeat rows (one per install per day)"], ["first_seen", "Installs ever seen (first-seen days)"], ["monthly_rollups", "Monthly totals"],
      ["tickets", "Tickets"], ["messages", "Ticket messages and notes"], ["error_groups", "Error groups"], ["error_occurrences", "Error counts per version and day"],
      ["announcements", "Announcements"], ["obs", "Community observations"], ["reports", "Old one-way reports"], ["blocked", "Blocked installs"], ["sessions", "Admin sessions"], ["audit", "Audit log entries"]];
    ctx.html({
      title: "Data", active: "data",
      body: `<div class="head"><h1>Data</h1></div>
<div class="two">
<div>
<section class="card"><h2>Retention</h2>
<dl class="facts wide-dt"><div><dt>Heartbeat rows kept from</dt><dd>${esc(st.cutoff)}</dd></div><div><dt>Oldest heartbeat row</dt><dd>${esc(st.oldestHeartbeat || "none yet")}</dd></div>
<div><dt>Retention job last ran</dt><dd>${st.lastRun ? when(st.lastRun) : "not yet"}</dd></div><div><dt>Last nightly backup</dt><dd>${st.lastBackup ? when(st.lastBackup) : "not yet"}</dd></div><div><dt>Database size</dt><dd>${esc(mb)}</dd></div></dl>
<p class="note">Heartbeat rows older than 13 months are rolled into monthly totals and deleted, a whole month at a time. Closed tickets stay until an admin or the player deletes them. The job runs every hour inside the service.</p>
<form method="post" action="/admin/data/retention">${csrfInput(ctx.session)}<button class="btn" type="submit">Run the retention job now</button></form></section>
<section class="card flush"><table class="grid-table"><thead><tr><th scope="col">What is stored</th><th scope="col" class="n">Rows</th></tr></thead><tbody>
${ROWS.map(([k, l]) => `<tr><th scope="row">${esc(l)}</th><td class="n">${num(st.rows[k])}</td></tr>`).join("")}</tbody></table></section>
</div>
<aside>
<section class="card"><h2>Export tickets</h2><p class="dim">All tickets with their messages and internal notes as one JSON file. Install hashes are cut to the short label; ticket keys are not included.</p>
<form method="post" action="/admin/data/export">${csrfInput(ctx.session)}<button class="btn" type="submit">Download JSON</button></form></section>
<section class="card danger"><h2>Purge an install</h2><p class="dim">For a deletion request. Removes that install's observations, old reports, tickets, heartbeats and first-seen day. This cannot be undone.</p>
<form method="post" action="/admin/data/purge" class="stack">${csrfInput(ctx.session)}
${field("Install id or install hash", '<input name="install" required maxlength="64" spellcheck="false" autocomplete="off" placeholder="3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f">', "The id from the app's Settings, or the 64-character hash.")}
<label class="tick"><input type="checkbox" name="block" value="yes"> Also block this install</label>
<label class="tick"><input type="checkbox" name="confirm" value="yes" required> Yes, remove everything from this install</label>
<button class="btn danger" type="submit">Purge</button></form></section>
</aside></div>`,
    });
  }

  function dataExport(ctx) {
    const body = Buffer.from(JSON.stringify({ exportedAt: new Date(now()).toISOString(), tickets: desk.exportTickets() }, null, 1));
    desk.audit(ctx.session.admin, "tickets_export", "", `bytes=${body.length}`, now());
    send(ctx.res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="bf-tickets-${day(now())}.json"` });
  }

  function dataPurge(ctx) {
    const target = one(ctx.form, "install");
    need(ctx.form.get("confirm") === "yes", "Tick the box to confirm.");
    let hash;
    if (/^[0-9a-f]{64}$/.test(target)) hash = target;
    else if (UUID.test(target)) hash = hashInstall(config.salt, target);
    else throw new Refuse(400, "That is neither an install id nor an install hash.");
    const r = store.purgeInstall(hash, { block: ctx.form.get("block") === "yes", now: now() });
    desk.audit(ctx.session.admin, "install_purge", `install ${installLabel(hash)}`, `observations=${r.observations} reports=${r.reports} tickets=${r.tickets} heartbeats=${r.heartbeats} blocked=${r.blocked}`, now());
    ctx.redirect("/admin/data?done=purged");
  }

  function dataRetention(ctx) {
    const r = stats.runRetention(store, now());
    const p = auth.prune(now());
    desk.audit(ctx.session.admin, "retention_run", "", `months=${r.months.length} heartbeats=${r.heartbeatsDeleted} sessions=${p.sessions}`, now());
    ctx.redirect("/admin/data?done=retention");
  }

  // --------------------------------------------------------------- router
  const ROUTES = [
    ["GET", /^\/admin\/?$/, "/admin/", dashboard],
    ["GET", /^\/admin\/tickets\/?$/, "/admin/tickets", ticketList],
    ["POST", /^\/admin\/tickets\/bulk$/, "/admin/tickets/bulk", ticketBulk],
    ["GET", /^\/admin\/tickets\/([^/]{1,20})$/, "/admin/tickets/:id", ticketView],
    ["POST", /^\/admin\/tickets\/([^/]{1,20})\/reply$/, "/admin/tickets/:id/reply", ticketReply],
    ["POST", /^\/admin\/tickets\/([^/]{1,20})\/note$/, "/admin/tickets/:id/note", ticketNote],
    ["POST", /^\/admin\/tickets\/([^/]{1,20})\/update$/, "/admin/tickets/:id/update", ticketUpdate],
    ["POST", /^\/admin\/tickets\/([^/]{1,20})\/delete$/, "/admin/tickets/:id/delete", ticketDelete],
    ["POST", /^\/admin\/tickets\/([^/]{1,20})\/block$/, "/admin/tickets/:id/block", ticketBlock],
    ["GET", /^\/admin\/errors\/?$/, "/admin/errors", errorList],
    ["GET", /^\/admin\/errors\/(\d{1,9})$/, "/admin/errors/:id", errorView],
    ["POST", /^\/admin\/errors\/(\d{1,9})\/ticket$/, "/admin/errors/:id/ticket", errorTicket],
    ["GET", /^\/admin\/announcements\/?$/, "/admin/announcements", announcementList],
    ["POST", /^\/admin\/announcements\/save$/, "/admin/announcements/save", announcementSave],
    ["GET", /^\/admin\/announcements\/(new|\d{1,9})$/, "/admin/announcements/:id", announcementForm],
    ["POST", /^\/admin\/announcements\/(\d{1,9})\/expire$/, "/admin/announcements/:id/expire", announcementExpire],
    ["GET", /^\/admin\/replies\/?$/, "/admin/replies", replyList],
    ["POST", /^\/admin\/replies\/save$/, "/admin/replies/save", replySave],
    ["POST", /^\/admin\/replies\/(\d{1,9})\/delete$/, "/admin/replies/:id/delete", replyDelete],
    ["GET", /^\/admin\/admins\/?$/, "/admin/admins", adminList],
    ["POST", /^\/admin\/admins\/(\d{1,9})\/disable$/, "/admin/admins/:id/disable", adminDisable],
    ["GET", /^\/admin\/audit\/?$/, "/admin/audit", auditList],
    ["GET", /^\/admin\/data\/?$/, "/admin/data", dataPage],
    ["POST", /^\/admin\/data\/export$/, "/admin/data/export", dataExport],
    ["POST", /^\/admin\/data\/purge$/, "/admin/data/purge", dataPurge],
    ["POST", /^\/admin\/data\/retention$/, "/admin/data/retention", dataRetention],
  ];

  // Returns a label for the service log (a route pattern: never an id, a query or a name).
  async function handle(req, res, url) {
    const pathname = url.pathname, method = req.method === "HEAD" ? "GET" : req.method;
    let session = null;
    try {
      const st = /^\/admin\/static\/([a-z.]{1,20})$/.exec(pathname);
      if (st) {
        const f = STATIC[st[1]];
        if (!f || method !== "GET") { message(res, 404, "Not found", "There is no such file."); return "/admin/static"; }
        send(res, 200, f.body, { "Content-Type": f.type });
        return "/admin/static";
      }
      if (pathname === "/admin") { redirect(res, "/admin/"); return "/admin/"; }
      session = auth.session(readCookie(req));
      if (pathname === "/admin/login") {
        if (method === "GET") { if (session) redirect(res, "/admin/"); else loginPage(res, 200); return "/admin/login"; }
        if (method === "POST") { await login(req, res); return "/admin/login"; }
        message(res, 405, "Not allowed", "That method is not allowed here.");
        return "/admin/login";
      }
      if (!session) {
        // No page, form or file is reachable without a session.
        redirect(res, "/admin/login", readCookie(req) ? { "Set-Cookie": cookie("", 0) } : {});
        return "/admin/(signed out)";
      }
      if (pathname === "/admin/logout") {
        if (method !== "POST") { message(res, 405, "Not allowed", "Use the Sign out button.", session, "/admin/"); return "/admin/logout"; }
        const form = await readForm(req);
        if (!sameSite(req) || !auth.csrfOk(session, form.get("csrf"))) throw new Refuse(403, "This form has expired or was not sent from this site. Go back, reload the page and try again.");
        desk.audit(session.admin, "logout", "", "", now());
        auth.logout(readCookie(req));
        redirect(res, "/admin/login", { "Set-Cookie": cookie("", 0) });
        return "/admin/logout";
      }
      for (const [m, re, label, fn] of ROUTES) {
        const hit = re.exec(pathname);
        if (!hit) continue;
        if (m !== method) continue;
        const ctx = {
          req, res, url, session, form: null, counts: desk.ticketCounts(),
          html: (o) => send(res, 200, page({ ...o, session, counts: ctx.counts, flash: FLASH[url.searchParams.get("done")] || "" })),
          redirect: (to) => redirect(res, to),
        };
        if (m === "POST") {
          ctx.form = await readForm(req);
          if (!sameSite(req) || !auth.csrfOk(session, ctx.form.get("csrf"))) throw new Refuse(403, "This form has expired or was not sent from this site. Go back, reload the page and try again.");
        }
        await fn(ctx, hit[1]);
        return label;
      }
      if (ROUTES.some(([, re]) => re.test(pathname))) { message(res, 405, "Not allowed", "That method is not allowed here.", session, "/admin/"); return "/admin/(other)"; }
      message(res, 404, "Not found", "There is no such page.", session, "/admin/");
      return "/admin/(other)";
    } catch (e) {
      if (res.headersSent) { res.destroy(); return "/admin/(error)"; }
      if (e instanceof Refuse) {
        message(res, e.status, e.status === 404 ? "Not found" : e.status === 403 ? "Refused" : "That did not work", e.message, session, e.status === 404 ? "/admin/" : (typeof req.headers.referer === "string" && req.headers.referer.startsWith(`${config.publicOrigin}/admin/`) ? req.headers.referer.slice(config.publicOrigin.length) : "/admin/"));
        return "/admin/(refused)";
      }
      log(`${new Date().toISOString()} admin error ${e && e.message ? e.message : String(e)}`);
      message(res, 500, "Something went wrong", "The server could not finish that. Nothing was changed. Try again.", session, "/admin/");
      return "/admin/(error)";
    }
  }

  return { handle, HEADERS, COOKIE };
}

module.exports = { createAdmin, HEADERS, COOKIE };
