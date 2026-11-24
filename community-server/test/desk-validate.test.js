"use strict";
// Accept/reject tables for every Backstage Desk request body.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ValidationError } = require("../lib/validate");
const V = require("../lib/validate-desk");
const { heartbeat, ticket, errorReport } = require("./helpers");

const ID = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
const KEY = "A".repeat(43);
const bad = (fn, re) => assert.throws(fn, (e) => e instanceof ValidationError && (!re || re.test(e.message)), `expected a ValidationError ${re || ""}`);
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };

// Runs one validator over a table of [label, body, expected error] rows.
function rejects(fn, base, rows) {
  for (const [label, change, re] of rows) {
    const body = typeof change === "function" ? change(structuredClone(base)) : { ...base, ...change };
    assert.throws(() => fn(body), (e) => e instanceof ValidationError && re.test(e.message), `${label}: expected ${re}`);
  }
}

test("heartbeat: a full body is accepted and normalized", () => {
  const out = V.validateHeartbeat(heartbeat(ID.toUpperCase(), { areas: ["map", "now"] }));
  assert.equal(out.installId, ID);
  assert.deepEqual(out.areas, ["now", "map"]); // canonical order
  assert.deepEqual(out.flags, { gameConnected: true, addonInstalled: true, liveLink: false, sharing: true });
  // Nullable fields.
  const nulls = V.validateHeartbeat(heartbeat(ID, { addonVersion: null, osMajor: null, build: null, areas: [] }));
  assert.equal(nulls.addonVersion, null); assert.equal(nulls.osMajor, null); assert.equal(nulls.build, null);
  assert.deepEqual(nulls.areas, []);
  // Every area and every allowed value of the fixed lists.
  V.validateHeartbeat(heartbeat(ID, { areas: [...V.HEARTBEAT_AREAS] }));
  for (const os of V.OS_FAMILIES) for (const lang of V.LANGS) for (const channel of V.CHANNELS) V.validateHeartbeat(heartbeat(ID, { os, lang, channel }));
});

test("heartbeat: reject table", () => {
  const base = heartbeat(ID);
  rejects(V.validateHeartbeat, base, [
    ["unknown top-level field", { country: "DE" }, /country: unknown field/],
    ["character name smuggled in", { character: "Thrall" }, /unknown field/],
    ["schema 2", { schema: 2 }, /schema/],
    ["install id not a uuid", { installId: "abc" }, /installId/],
    ["install id v1 uuid", { installId: "3f2b8c1e-9d4a-1b7e-8f21-0a1b2c3d4e5f" }, /installId/],
    ["app version with suffix", { appVersion: "1.26.0-beta" }, /appVersion/],
    ["app version two parts", { appVersion: "1.26" }, /appVersion/],
    ["app version null", { appVersion: null }, /appVersion/],
    ["addon version number", { addonVersion: 1.26 }, /addonVersion/],
    ["channel", { channel: "nightly" }, /channel/],
    ["os", { os: "android" }, /os/],
    ["os major not a string", { osMajor: 11 }, /osMajor/],
    ["os major with dots", { osMajor: "10.0.26300" }, /osMajor/],
    ["lang", { lang: "it" }, /lang/],
    ["build three parts", { build: "1.60.1" }, /build/],
    ["week format", { firstSeenWeek: "2026-48" }, /firstSeenWeek/],
    ["week number 60", { firstSeenWeek: "2026-W60" }, /firstSeenWeek/],
    ["flags missing one", (b) => { delete b.flags.sharing; return b; }, /flags\.sharing: is required/],
    ["flags extra one", (b) => { b.flags.vip = true; return b; }, /flags\.vip: unknown field/],
    ["flag not boolean", (b) => { b.flags.liveLink = 1; return b; }, /flags\.liveLink/],
    ["flags as array", { flags: [true, true, false, true] }, /flags/],
    ["unknown area", { areas: ["now", "gear"] }, /areas\[1\]/],
    ["duplicate area", { areas: ["now", "now"] }, /duplicate/],
    ["too many areas", { areas: [...V.HEARTBEAT_AREAS, "now"] }, /areas/],
    ["areas not an array", { areas: "now" }, /areas/],
  ]);
  for (const k of Object.keys(base)) bad(() => V.validateHeartbeat(without(base, k)), new RegExp(`${k}: is required`));
  bad(() => V.validateHeartbeat(null)); bad(() => V.validateHeartbeat([])); bad(() => V.validateHeartbeat("x"));
});

test("ticket: accepted bodies", () => {
  const out = V.validateTicket(ticket(ID));
  assert.equal(out.kind, "bug"); assert.equal(out.diagnostics.screen, "talents");
  // diagnostics may be left out or null; expected may be empty; frequency may be null.
  assert.equal(V.validateTicket(without(ticket(ID), "diagnostics")).diagnostics, null);
  assert.equal(V.validateTicket(ticket(ID, { diagnostics: null, expected: "", frequency: null })).diagnostics, null);
  // Limits are inclusive, in characters (an emoji is one character).
  V.validateTicket(ticket(ID, { summary: "x".repeat(140), details: "y".repeat(4000), expected: "z".repeat(1000) }));
  V.validateTicket(ticket(ID, { summary: "\u{1F600}".repeat(140) }));
  V.validateTicket(ticket(ID, { summary: "12345", details: "1234567890" }));
  // Newlines are kept, CRLF is folded, text is NFC.
  const t = V.validateTicket(ticket(ID, { details: "line one\r\nline two e\u0301" }));
  assert.equal(t.details, "line one\nline two \u00e9");
  // Text is stored as given: markup is not rejected (it is escaped on output).
  assert.equal(V.validateTicket(ticket(ID, { summary: "<script>alert(1)</script>" })).summary, "<script>alert(1)</script>");
  for (const kind of V.TICKET_KINDS) for (const area of V.TICKET_AREAS) V.validateTicket(ticket(ID, { kind, area }));
  assert.equal(V.TICKET_AREAS.length, 17);
});

test("ticket: reject table", () => {
  const base = ticket(ID);
  rejects(V.validateTicket, base, [
    ["unknown field", { email: "a@example.com" }, /email: unknown field/],
    ["realm smuggled in", { realm: "X" }, /unknown field/],
    ["kind", { kind: "crash" }, /kind/],
    ["area", { area: "raids" }, /area/],
    ["frequency", { frequency: "often" }, /frequency/],
    ["summary too short", { summary: "abcd" }, /summary: must be at least 5/],
    ["summary only spaces", { summary: "      " }, /summary/],
    ["summary too long", { summary: "x".repeat(141) }, /summary: must be at most 140/],
    ["details too short", { details: "too short" }, /details/],
    ["details too long", { details: "x".repeat(4001) }, /details: must be at most 4000/],
    ["expected too long", { expected: "x".repeat(1001) }, /expected/],
    ["expected null", { expected: null }, /expected/],
    ["control character", { details: "has a \u0007 bell in it" }, /control characters/],
    ["escape sequence", { summary: "\u001b[31mred text" }, /control characters/],
    ["C1 control", { details: "next line \u0085 control" }, /control characters/],
    ["NUL", { details: "nul \u0000 byte here" }, /control characters/],
    ["lone surrogate", { details: "broken \ud800 surrogate" }, /Unicode/],
    ["number as text", { summary: 12345 }, /summary: must be a string/],
    ["app version", { appVersion: "v1" }, /appVersion/],
    ["diagnostics extra field", (b) => { b.diagnostics.path = "C:\\Users\\me"; return b; }, /diagnostics\.path: unknown field/],
    ["diagnostics missing field", (b) => { delete b.diagnostics.screen; return b; }, /diagnostics\.screen: is required/],
    ["diagnostics lastError too long", (b) => { b.diagnostics.lastError = "x".repeat(2001); return b; }, /lastError/],
    ["diagnostics flag not boolean", (b) => { b.diagnostics.gameConnected = "yes"; return b; }, /gameConnected/],
    ["diagnostics as string", { diagnostics: "none" }, /diagnostics/],
    ["diagnostics screen with markup", (b) => { b.diagnostics.screen = "<b>"; return b; }, /screen/],
  ]);
  for (const k of Object.keys(without(base, "diagnostics"))) bad(() => V.validateTicket(without(base, k)), new RegExp(`${k}: is required`));
});

test("ticket message: 1 to 4000 characters, nothing else", () => {
  assert.equal(V.validateTicketMessage({ schema: 1, text: "ok" }).text, "ok");
  V.validateTicketMessage({ schema: 1, text: "x".repeat(4000) });
  bad(() => V.validateTicketMessage({ schema: 1, text: "" }), /text/);
  bad(() => V.validateTicketMessage({ schema: 1, text: "   " }), /text/);
  bad(() => V.validateTicketMessage({ schema: 1, text: "x".repeat(4001) }), /4000/);
  bad(() => V.validateTicketMessage({ schema: 1, text: "ok", installId: ID }), /unknown field/);
  bad(() => V.validateTicketMessage({ schema: 1 }), /required/);
  bad(() => V.validateTicketMessage({ text: "ok" }), /schema/);
  bad(() => V.validateTicketMessage({ schema: 1, text: ["ok"] }), /string/);
});

test("ticket ids and keys", () => {
  assert.equal(V.ticketNumber("BF-1042"), 1042);
  assert.equal(V.ticketNumber("BF-0007"), 7);
  assert.equal(V.ticketLabel(7), "BF-0007");
  assert.equal(V.ticketLabel(123456), "BF-123456");
  for (const no of ["bf-1042", "BF-42", "BF-", "1042", "BF-10422222222", "BF-1042 ", "BF-10a2", "", null, 1042, "../BF-1042"]) assert.equal(V.ticketNumber(no), null, String(no));
  assert.equal(V.ticketKey(KEY), KEY);
  for (const no of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}+`, null, undefined, 5, ["A".repeat(43)]]) assert.equal(V.ticketKey(no), null);
});

test("ticket sync: up to 50 tickets, strict entries", () => {
  const out = V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: KEY, since: 2 }, { ticket: "BF-0007", key: KEY }] });
  assert.deepEqual(out.tickets.map(t => [t.ticket, t.number, t.since]), [["BF-1042", 1042, 2], ["BF-0007", 7, 0]]);
  assert.deepEqual(V.validateTicketSync({ schema: 1, tickets: [] }).tickets, []);
  V.validateTicketSync({ schema: 1, tickets: Array.from({ length: 50 }, (_, i) => ({ ticket: `BF-${2000 + i}`, key: KEY, since: 0 })) });
  bad(() => V.validateTicketSync({ schema: 1, tickets: Array.from({ length: 51 }, (_, i) => ({ ticket: `BF-${2000 + i}`, key: KEY })) }), /at most 50/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: KEY }, { ticket: "BF-1042", key: KEY }] }), /duplicate/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "1042", key: KEY }] }), /ticket/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: "nope" }] }), /key/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042" }] }), /key: is required/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: KEY, since: -1 }] }), /since/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: KEY, since: 1.5 }] }), /since/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [{ ticket: "BF-1042", key: KEY, installId: ID }] }), /unknown field/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: {} }), /array/);
  bad(() => V.validateTicketSync({ schema: 1, tickets: [], installId: ID }), /unknown field/);
});

test("since query: one message id or nothing", () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(V.validateSince(q("")), 0);
  assert.equal(V.validateSince(q("since=12")), 12);
  bad(() => V.validateSince(q("since=-1")), /since/);
  bad(() => V.validateSince(q("since=abc")), /since/);
  bad(() => V.validateSince(q("since=1&since=2")), /more than once/);
  bad(() => V.validateSince(q("since=99999999999")), /since/);
  bad(() => V.validateSince(q("key=abc")), /unknown field/);
});

test("error report: accepted, and directories are removed", () => {
  const out = V.validateError(errorReport(ID, {
    message: "cannot open C:\\Users\\someone\\AppData\\file.json today",
    stack: ["at f (C:\\Users\\someone\\app\\main.js:10:3)", "at g (/home/someone/app/util.js:2:1)", "at node:internal/process/task_queues:95:5", "at async Promise.all (index 0)"],
  }));
  assert.deepEqual(out.stack, ["at f (main.js:10:3)", "at g (util.js:2:1)", "at task_queues:95:5", "at async Promise.all (index 0)"]);
  assert.equal(out.message, "cannot open <path> today");
  assert.ok(!JSON.stringify(out).includes("someone"));
  assert.deepEqual(V.validateError(errorReport(ID, { stack: [], message: "" })).stack, []);
  V.validateError(errorReport(ID, { name: "x".repeat(60), message: "y".repeat(300), stack: Array.from({ length: 12 }, () => "z".repeat(200)), osMajor: null }));
  assert.equal(V.stripDirs("at file:///C:/Users/someone/x/y.js:1:2"), "at y.js:1:2");
  assert.equal(V.stripAbsolutePaths("a and/or b (reading 'x/y')"), "a and/or b (reading 'x/y')");
});

test("error report: reject table", () => {
  const base = errorReport(ID);
  rejects(V.validateError, base, [
    ["unknown field", { user: "me" }, /user: unknown field/],
    ["where", { where: "worker" }, /where/],
    ["name too long", { name: "x".repeat(61) }, /name/],
    ["name empty", { name: "" }, /name/],
    ["name multi-line", { name: "Type\nError" }, /single line/],
    ["message too long", { message: "y".repeat(301) }, /message/],
    ["13 stack lines", { stack: Array.from({ length: 13 }, () => "at f (a.js:1:1)") }, /at most 12/],
    ["stack line too long", { stack: ["z".repeat(201)] }, /stack\[0\]/],
    ["stack line not a string", { stack: [1] }, /stack\[0\]/],
    ["stack not an array", { stack: "at f" }, /stack/],
    ["stack line with newline", { stack: ["at f\nat g"] }, /single line/],
    ["app version", { appVersion: "1.26.0+local" }, /appVersion/],
    ["os", { os: "win" }, /os/],
    ["lang", { lang: "pt" }, /lang/],
  ]);
  for (const k of Object.keys(base)) bad(() => V.validateError(without(base, k)), new RegExp(`${k}: is required`));
});

test("announcement query and links", () => {
  const q = (s) => V.validateAnnouncementQuery(new URLSearchParams(s));
  assert.deepEqual(q("appVersion=1.26.0&os=windows&lang=en"), { appVersion: "1.26.0", os: "windows", lang: "en" });
  assert.deepEqual(q(""), { appVersion: null, os: null, lang: null });
  bad(() => q("appVersion=1.26"), /appVersion/);
  bad(() => q("os=amiga"), /os/);
  bad(() => q("lang=xx"), /lang/);
  bad(() => q("installId=abc"), /unknown field/);
  bad(() => q("os=windows&os=linux"), /more than once/);

  for (const ok of ["https://github.com/farena-ai/Backstage-Forever", "https://github.com/farena-ai/Backstage-Forever/releases/tag/v1.26.0",
    "https://backstagecoding.com/", "https://bf.backstagecoding.com/privacy.html", "https://www.backstagecoding.com/a?b=c#d"]) assert.equal(V.announcementLink(ok), ok);
  assert.equal(V.announcementLink(null), null);
  assert.equal(V.announcementLink(""), null);
  for (const no of ["http://backstagecoding.com/", "https://github.com/someone-else/repo", "https://github.com/farena-ai/Backstage-Forever-evil",
    "https://github.com/farena-ai/Backstage-Forever/../../evil", "https://evil.example/backstagecoding.com", "https://backstagecoding.com.evil.example/",
    "https://user:pw@backstagecoding.com/", "https://backstagecoding.com:8443/", "javascript:alert(1)", "//backstagecoding.com/", "https://backstagecoding.com/\"onclick=", "https://backstagecoding.com/<x>", 5])
    bad(() => V.announcementLink(no), /link/);
});

test("version comparison is numeric", () => {
  assert.equal(V.compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(V.compareVersions("1.26.0", "1.26.0"), 0);
  assert.equal(V.compareVersions("2.0.0", "1.99.99"), 1);
});
