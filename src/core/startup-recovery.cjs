"use strict";
const { StoreStartupError } = require("./store.cjs");
const { RecoveryCheckpoints } = require("./recovery-checkpoints.cjs");

async function showStartupFailure({ dialog, shell, dataDir, error, recovery, restart }) {
  let manager, selected;
  if (error instanceof StoreStartupError && error.kind === "journal") {
    try {
      manager = recovery || new RecoveryCheckpoints(dataDir);
      const newest = manager.list()[0];
      if (newest) selected = manager.prepareStartupRestore(newest.id);
    } catch { selected = null; }
  }
  const detail = (selected ? "A valid local recovery point is available. Restore replaces the journal, clears saved conversation memory, and keeps API credentials. The exact damaged original may contain memory and private text; it is retained locally until Clear history, character deletion or Delete all local data. Restore does not reconnect your game.\n\n" : "") +
    "Quit and Open data folder do not change your saved files. Close the app and copy the entire data folder somewhere safe before making any manual changes. " +
    "See Getting started: If the app cannot start, linked from the README.\n\nData folder:\n" + dataDir;
  try {
    const result = await dialog.showMessageBox({
      type: "error",
      title: "Backstage Forever",
      message: "Backstage Forever could not finish startup.",
      detail,
      buttons: ["Quit", "Open data folder", ...(selected ? ["Restore and restart"] : [])],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (selected && result?.response === 2) {
      let restored = false;
      try { manager.restoreDamaged(selected); restored = true; await restart(); }
      catch {
        await dialog.showMessageBox({ type: "error", title: "Backstage Forever", message: restored ? "Journal restored. Restart the app manually." : "The journal could not be restored safely.", detail: "Your original journal remains recoverable. Game observation may already be disconnected. Copy the entire data folder before making manual changes.\n\nData folder:\n" + dataDir, buttons: ["Quit"], defaultId: 0, cancelId: 0, noLink: true });
      }
      return;
    }
    if (result?.response !== 1) return;
    let failed = false;
    try {
      failed = Boolean(await shell.openPath(dataDir));
    } catch {
      failed = true;
    }
    if (failed) {
      await dialog.showMessageBox({
        type: "error",
        title: "Backstage Forever",
        message: "Windows could not open the data folder.",
        detail: "After the app closes, open File Explorer and use this exact folder path. Copy the entire folder before making manual changes.\n\nData folder:\n" + dataDir,
        buttons: ["Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    }
  } catch {
    // Native dialog failures must not prevent shutdown or expose private errors.
  }
}

module.exports = { showStartupFailure };
