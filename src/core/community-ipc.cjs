"use strict";
// IPC for Settings → Community: the sharing switch, Forget my contributions and Report a problem.
// Arguments are checked here; the service validates them again.
const arity = (args, n) => { if (args.length !== n) throw Error("Invalid community request."); };
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function registerCommunityHandlers({ handle, community, confirmForget = async () => true }) {
  handle("communityStatus", (...args) => { arity(args, 0); return community.status(); });
  handle("setCommunitySettings", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!plain(input) || Object.keys(input).length < 1 || Object.keys(input).some((k) => !["share", "download"].includes(k)) || Object.values(input).some((v) => typeof v !== "boolean")) throw Error("Invalid community settings.");
    const status = community.setSettings(input);
    // Turning downloads on fetches a pack soon; turning sharing on shares at the next scheduled pass.
    if (input.download === true) void community.refreshPack().catch(() => {});
    return status;
  });
  handle("communityForget", async (...args) => {
    arity(args, 0);
    if (!(await confirmForget())) return { cancelled: true, status: community.status() };
    return community.forget();
  });
  handle("communityReportPreview", (...args) => { arity(args, 0); return community.reportPreview(); });
  handle("communityReport", (...args) => {
    arity(args, 1);
    const [input] = args;
    if (!plain(input) || Object.keys(input).some((k) => !["category", "text", "logId"].includes(k))) throw Error("Invalid problem report.");
    if (typeof input.category !== "string" || typeof input.text !== "string" || input.text.length > 4000) throw Error("Invalid problem report.");
    if (input.logId !== undefined && input.logId !== null && (typeof input.logId !== "string" || !/^[a-f0-9]{32}$/.test(input.logId))) throw Error("Invalid problem report.");
    return community.report(input);
  });
}
module.exports = { registerCommunityHandlers };
