"use strict";
const fs = require("node:fs/promises");
const { atomic } = require("./store.cjs");
const { buildCompany } = require("./company.cjs");
const party = require("./party.cjs");
/** Read at most the limit plus one byte, including files growing after stat. */
async function readPartyFile(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const info = await handle.stat();
    if (!info.isFile() || info.size > party.MAX_PARTY_BYTES) throw Error("Invalid file.");
    const buffer = Buffer.alloc(party.MAX_PARTY_BYTES + 1); let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    if (offset > party.MAX_PARTY_BYTES) throw Error("Invalid file.");
    return buffer.subarray(0, offset);
  } finally { await handle?.close(); }
}
function registerPartyHandlers({ handle, getState, saveState, context, getEpoch = () => 0, isBlocked = () => false, dialog, getWindow, readFile = readPartyFile, writeFile = atomic }) {
  let dialogEpoch = 0;
  const count = (args, n) => { if (args.length !== n) throw Error("Party plan request is invalid."); };
  const token = () => ({ local: ++dialogEpoch, epoch: getEpoch(), context: context.snapshot() });
  const current = t => !isBlocked() && t.local === dialogEpoch && t.epoch === getEpoch() && context.isCurrent(t.context);
  const saved = result => { saveState(result.state); const state = structuredClone(getState()); return { state, company: buildCompany(state), journeyId: result.journeyId }; };
  handle("partyBrief", (...args) => {
    count(args, 1); const input = args[0];
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, "profileId") || !Object.hasOwn(input, "role")) throw Error("Party plan request is invalid.");
    return party.buildPartyBrief(getState(), input.profileId, { role: input.role });
  });
  handle("partyPreview", (...args) => { count(args, 1); return party.previewPartyPlan(getState(), args[0]); });
  handle("createPartyJourney", (...args) => { count(args, 1); return saved(party.createPartyJourney(getState(), args[0])); });
  handle("commitPartyPlan", (...args) => { count(args, 1); return saved(party.commitPartyPlan(getState(), args[0])); });
  handle("exportPartyPlan", async (...args) => {
    count(args, 1); const serialized = party.serializePartyPlan(args[0]), t = token();
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save reviewed shared adventure plan", defaultPath: "Backstage-Forever-party.json", filters: [{ name: "Shared plan JSON", extensions: ["json"] }] });
    if (!current(t) || result.canceled) return null;
    if (typeof result.filePath !== "string" || !result.filePath) throw Error("Party plan could not be saved.");
    try { writeFile(result.filePath, serialized); } catch { throw Error("Party plan could not be saved."); }
    return true;
  });
  handle("importPartyPlan", async (...args) => {
    count(args, 0); const t = token();
    const result = await dialog.showOpenDialog(getWindow(), { title: "Preview a shared adventure plan", properties: ["openFile"], filters: [{ name: "Shared plan JSON", extensions: ["json"] }] });
    if (!current(t) || result.canceled) return null;
    if (!Array.isArray(result.filePaths) || result.filePaths.length !== 1 || typeof result.filePaths[0] !== "string" || !result.filePaths[0]) throw Error("Party plan could not be read.");
    let raw;
    try { raw = await readFile(result.filePaths[0]); } catch { if (!current(t)) return null; throw Error("Party plan could not be read. Choose a JSON plan up to 64 KiB."); }
    if (!current(t)) return null;
    return party.parsePartyPlan(raw);
  });
}
module.exports = { registerPartyHandlers, readPartyFile };
