"use strict";

async function showStartupFailure({ dialog, shell, dataDir }) {
  const detail =
    "Recovery does not change your saved files. Close the app and copy the entire data folder somewhere safe before making any manual changes. " +
    "See Getting started: If the app cannot start, linked from the README.\n\nData folder:\n" + dataDir;
  try {
    const result = await dialog.showMessageBox({
      type: "error",
      title: "Backstage Forever",
      message: "Backstage Forever could not finish startup.",
      detail,
      buttons: ["Quit", "Open data folder"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
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
