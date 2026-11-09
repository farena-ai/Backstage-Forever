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
    gameStatus: () => invoke("gameStatus"),
    gameSnapshot: () => invoke("gameSnapshot"),
    discoverGame: () => invoke("discoverGame"),
    connectGame: (root) => invoke("connectGame", root),
    installGameAddon: () => invoke("installGameAddon"),
    refreshGame: () => invoke("refreshGame"),
    disconnectGame: () => invoke("disconnectGame"),
    listModels: (options) => invoke("listModels", options),
    updateStatus: () => invoke("updateStatus"),
    checkForUpdates: () => invoke("checkForUpdates"),
    setUpdatePreferences: (preferences) =>
      invoke("setUpdatePreferences", preferences),
    installUpdate: () => invoke("installUpdate"),
    subscriptionStatus: () => invoke("subscriptionStatus"),
    connectSubscription: (provider) => invoke("connectSubscription", provider),
    disconnectSubscription: (provider) =>
      invoke("disconnectSubscription", provider),
    saveState: (state, base) => invoke("saveState", state, base),
    saveProvider: (settings) => invoke("saveProvider", settings),
    deleteKey: (provider) => invoke("deleteKey", provider),
    ask: (request) => invoke("ask", request),
    exportData: () => invoke("exportData"),
    importData: () => invoke("importData"),
    resetData: () => invoke("resetData"),
    openLink: (id) => invoke("openLink", id),
  }),
);
