"use strict";
// Isolated hidden DOM host. No product bootstrap, profiles, provider or updater.
const { app, BrowserWindow, session } = require("electron");
app.setPath("userData", process.argv[2]);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: !details.url.startsWith("file:") }),
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(process.argv[3]);
});
app.on("window-all-closed", () => app.quit());
