"use strict";
// IPC for Backstage Desk: Help → Report a problem and My reports, Settings → Privacy & sharing,
// and messages from the team. Arguments are checked here; the service validates them again.
// A ticket key never crosses this bridge.
const { KINDS, AREAS, FREQUENCIES, LANGS } = require("./desk.cjs");
const BAD = "Invalid report request.";
const arity = (args, n) => { if (args.length !== n) throw Error(BAD); };
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const only = (o, keys) => plain(o) && Object.keys(o).every((k) => keys.includes(k));
const ticketId = (v) => typeof v === "string" && /^BF-\d{1,9}$/.test(v);
const text = (v, max) => typeof v === "string" && v.length <= max;

/** The report form, normalised to one fixed shape so a preview and the send that follows compare equal. */
function reportInput(input) {
  if (!only(input, ["kind", "area", "frequency", "summary", "details", "expected", "diagnostics", "scrub"])) throw Error(BAD);
  if (!KINDS.includes(input.kind) || !AREAS.includes(input.area)) throw Error(BAD);
  if (!(input.frequency === null || input.frequency === undefined || FREQUENCIES.includes(input.frequency))) throw Error(BAD);
  if (!text(input.summary, 1000) || !text(input.details, 20000) || !(input.expected === undefined || text(input.expected, 5000))) throw Error(BAD);
  for (const k of ["diagnostics", "scrub"]) if (!(input[k] === undefined || typeof input[k] === "boolean")) throw Error(BAD);
  return { kind: input.kind, area: input.area, frequency: input.frequency ?? null, summary: input.summary, details: input.details, expected: input.expected ?? "", diagnostics: input.diagnostics !== false, scrub: input.scrub !== false };
}

function registerDeskHandlers({ handle, desk, confirmForget = async () => true, forget = async () => ({}), openExternal = async () => {} }) {
  handle("deskStatus", (...args) => { arity(args, 0); return desk.status(); });
  handle("deskSetSettings", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!only(input, ["statistics", "errors", "notify"]) || !Object.keys(input).length || Object.values(input).some((v) => typeof v !== "boolean")) throw Error("Invalid privacy settings.");
    return desk.setSettings(input);
  });
  handle("deskVisit", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!only(input, ["route", "lang"]) || typeof input.route !== "string" || !/^[a-z][a-z-]{0,31}$/.test(input.route) || !LANGS.includes(input.lang)) throw Error(BAD);
    desk.visit(input);
    return true;
  });
  handle("deskReportPreview", (...args) => { arity(args, 1); return desk.reportPreview(reportInput(args[0])); });
  handle("deskReportSend", (...args) => { arity(args, 1); return desk.sendReport(reportInput(args[0])); });
  handle("deskTickets", (...args) => { arity(args, 0); return desk.tickets(); });
  handle("deskTicket", (...args) => { arity(args, 1); if (!ticketId(args[0])) throw Error(BAD); return desk.conversation(args[0]); });
  handle("deskReply", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!only(input, ["ticket", "text", "scrub"]) || !ticketId(input.ticket) || !text(input.text, 20000) || !(input.scrub === undefined || typeof input.scrub === "boolean")) throw Error(BAD);
    return desk.reply(input);
  });
  handle("deskDelete", (...args) => { arity(args, 1); if (!ticketId(args[0])) throw Error(BAD); return desk.remove(args[0]); });
  handle("deskCancelWaiting", (...args) => { arity(args, 1); if (typeof args[0] !== "string" || !/^[a-f0-9]{16}$/.test(args[0])) throw Error(BAD); return desk.cancelWaiting(args[0]); });
  handle("deskSync", async (...args) => {
    arity(args, 0);
    await desk.flushOutbox({ force: true });
    await desk.sync({ force: true });
    return desk.tickets();
  });
  handle("deskForget", async (...args) => {
    arity(args, 0);
    if (!(await confirmForget())) return { cancelled: true, status: desk.status() };
    const result = await forget();
    return { removed: result?.removed || null, status: desk.status() };
  });
  // Asking also fetches, at most once an hour and only while "Use community data" is on.
  handle("deskAnnouncements", async (...args) => { arity(args, 0); await desk.refreshAnnouncements(); return desk.announcements(); });
  handle("deskAnnouncementSeen", (...args) => { arity(args, 1); if (!Number.isSafeInteger(args[0]) || args[0] < 1) throw Error(BAD); return desk.announcementSeen(args[0]); });
  handle("deskAnnouncementOpen", async (...args) => {
    arity(args, 1);
    if (!Number.isSafeInteger(args[0]) || args[0] < 1) throw Error(BAD);
    const link = desk.announcementLink(args[0]);
    if (!link) throw Error(BAD);
    await openExternal(link);
    return true;
  });
  // The window reports an unexpected error of its own, or the plain message of an error it showed.
  handle("deskRendererError", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!only(input, ["name", "message", "stack", "shown"]) || !text(input.message, 4000) || !(input.name === undefined || text(input.name, 100)) || !(input.stack === undefined || text(input.stack, 20000)) || !(input.shown === undefined || typeof input.shown === "boolean")) throw Error(BAD);
    if (input.shown === true) { desk.noteError(input.message); return { status: "noted" }; }
    return { status: desk.captureError("renderer", { name: input.name, message: input.message, stack: input.stack }).status };
  });
}
module.exports = { registerDeskHandlers, reportInput };
