"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { atomic } = require("./store.cjs");
const { buildDiagnostics } = require("./diagnostics.cjs");
const EXPIRED = "Prepare a new report and review it before copying or saving.";
const SAVE_FAILED = "The report could not be saved. Choose a text file outside the app data folder.";
function registerDiagnosticsHandlers({ handle, collect, dialog, clipboard, getWindow, dataDir, now = Date.now, writeFile = atomic, realpath = fs.realpathSync.native, exists = fs.existsSync }) {
  let snapshot = null, generation = 0;
  const clear = () => { snapshot = null; generation++; };
  const arity = (args, length) => { if (args.length !== length) throw Error("Report request is invalid."); };
  const current = id => {
    if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) throw Error("Report request is invalid.");
    if (!snapshot || snapshot.id !== id || now() < snapshot.created || now() - snapshot.created >= 300000) throw Error(EXPIRED);
    return snapshot;
  };
  handle("diagnosticsPreview", async (...args) => {
    arity(args, 0); clear(); const token = generation;
    try {
      const input = await collect();
      if (token !== generation) throw Error("obsolete");
      const { text } = buildDiagnostics(input, { now });
      snapshot = Object.freeze({ id: crypto.randomBytes(16).toString("hex"), text, created: now() });
      return { id: snapshot.id, text: snapshot.text };
    } catch { throw Error("The report could not be prepared. Try again."); }
  });
  handle("copyDiagnostics", (...args) => {
    arity(args, 1); const prepared = current(args[0]);
    try { clipboard.writeText(prepared.text); } catch { throw Error("The report could not be copied. Try again."); }
    return { status: "copied" };
  });
  handle("exportDiagnostics", async (...args) => {
    arity(args, 1); const prepared = current(args[0]); let result;
    try { result = await dialog.showSaveDialog(getWindow(), { title: "Save reviewed support report", defaultPath: "Backstage-Forever-support.txt", filters: [{ name: "Support report text", extensions: ["txt"] }] }); }
    catch { throw Error(SAVE_FAILED); }
    current(prepared.id);
    if (result?.canceled) return { status: "cancelled" };
    try {
      const destination = result?.filePath;
      if (typeof destination !== "string" || !path.isAbsolute(destination) || path.extname(destination).toLowerCase() !== ".txt") throw Error("invalid");
      const owned = realpath(dataDir), parent = realpath(path.dirname(destination));
      const inside = candidate => { const relative = path.relative(owned, candidate); return !relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)); };
      if (inside(parent) || (exists(destination) && inside(realpath(destination)))) throw Error("owned");
      // No asynchronous gap between canonical validation, ownership check and atomic write.
      current(prepared.id); writeFile(path.join(parent, path.basename(destination)), prepared.text);
    } catch { throw Error(SAVE_FAILED); }
    return { status: "saved" };
  });
  return { clear };
}
module.exports = { registerDiagnosticsHandlers };
