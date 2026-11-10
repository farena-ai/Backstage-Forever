"use strict";
const { UUID, RecoveryError, ERRORS } = require("./recovery-checkpoints.cjs");
const EXPIRED = "Preview the recovery point again before restoring.";
const RECOVERY_MESSAGES = [...Object.values(ERRORS), EXPIRED];
function registerRecoveryHandlers({ handle, store, context, getEpoch, getWindow, dialog, transaction }) {
  let generation = 0, preview = null;
  const clear = () => { generation++; preview = null; };
  const arity = (args, length) => { if (args.length !== length) throw new RecoveryError("invalid"); };
  const metadata = point => ({ id: point.id, createdAt: point.createdAt, reason: point.reason, bytes: point.bytes, profileCount: point.profileCount, journeyCount: point.journeyCount, sha256: point.sha256 });
  const listing = () => ({ status: store.recoveryStatus(), points: store.recovery.list().map(metadata) });
  const snapshot = () => ({ generation, state: store.state, context: context.snapshot(), epoch: getEpoch() });
  const current = token => token.generation === generation && token.state === store.state && token.epoch === getEpoch() && context.isCurrent(token.context);
  handle("recoveryList", (...args) => { arity(args, 0); return listing(); });
  handle("setRecoveryAutomatic", (...args) => { arity(args, 1); if (typeof args[0] !== "boolean") throw new RecoveryError("invalid"); clear(); store.recovery.setAutomatic(args[0]); return listing(); });
  handle("checkpointNow", (...args) => { arity(args, 0); clear(); store.recovery.create(store.state, "manual"); return listing(); });
  handle("previewCheckpoint", (...args) => {
    arity(args, 1); if (typeof args[0] !== "string" || !UUID.test(args[0])) throw new RecoveryError("invalid");
    clear(); const point = store.recovery.read(args[0]); preview = { ...snapshot(), point }; return metadata(point);
  });
  handle("restoreCheckpoint", async (...args) => {
    arity(args, 1); const input = args[0];
    if (!input || Array.isArray(input) || Object.keys(input).sort().join() !== "id,sha256" || typeof input.id !== "string" || !UUID.test(input.id) || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new RecoveryError("invalid");
    const token = preview;
    if (!token || !current(token) || token.point.id !== input.id || token.point.sha256 !== input.sha256) throw Error(EXPIRED);
    const result = await dialog.showMessageBox(getWindow(), { type: "warning", title: "Restore this recovery point?", message: "Restore replaces your journal and preferences, clears saved conversation memory, keeps API keys, and disconnects game observation until you reconnect. A deliberate safety point protects your current journal even when automatic protection is off. Local points are readable private data.", buttons: ["Cancel", "Restore point"], defaultId: 0, cancelId: 0, noLink: true });
    if (!current(token)) throw Error(EXPIRED);
    if (result?.response !== 1) return null;
    const selected = store.recovery.read(input.id, input.sha256);
    if (selected.fileHash !== token.point.fileHash) throw new RecoveryError("changed");
    clear(); return transaction(() => store.restoreCheckpoint(input.id, input.sha256));
  });
  handle("clearCheckpoints", async (...args) => {
    arity(args, 0); clear(); const token = snapshot();
    const result = await dialog.showMessageBox(getWindow(), { type: "warning", title: "Clear local recovery history?", message: "This permanently removes all managed recovery points and any preserved damaged original, which may contain memory and private text. Your journal and automatic protection choice stay unchanged; future saves can create new points.", buttons: ["Cancel", "Clear history"], defaultId: 0, cancelId: 0, noLink: true });
    if (!current(token)) throw Error(EXPIRED);
    if (result?.response !== 1) return null;
    store.recovery.clear(); return listing();
  });
  return { clear };
}
module.exports = { registerRecoveryHandlers, RECOVERY_MESSAGES };
