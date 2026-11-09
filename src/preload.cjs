"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, ...args) =>
  ipcRenderer.invoke("backstage:" + name, ...args).catch((error) => {
    const message = String(error.message || "Action failed.").replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
    throw new Error(message);
  });
contextBridge.exposeInMainWorld(
  "backstage",
  Object.freeze({
    bootstrap: () => invoke("bootstrap"),
    updateStatus: () => invoke("updateStatus"),
    checkForUpdates: () => invoke("checkForUpdates"),
    setUpdatePreferences: (preferences) =>
      invoke("setUpdatePreferences", preferences),
    installUpdate: () => invoke("installUpdate"),
    subscriptionStatus: () => invoke("subscriptionStatus"),
    connectSubscription: (provider) => invoke("connectSubscription", provider),
    disconnectSubscription: (provider) =>
      invoke("disconnectSubscription", provider),
    saveState: (state) => invoke("saveState", state),
    saveProvider: (settings) => invoke("saveProvider", settings),
    deleteKey: (provider) => invoke("deleteKey", provider),
    ask: (request) => invoke("ask", request),
    exportData: () => invoke("exportData"),
    importData: () => invoke("importData"),
    resetData: () => invoke("resetData"),
    openLink: (id) => invoke("openLink", id),
  }),
);
