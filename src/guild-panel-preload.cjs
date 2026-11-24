"use strict";
// Narrow bridge for the Guild & Party panel window only.
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, ...args) => ipcRenderer.invoke("guildPanel:" + name, ...args).catch((error) => {
  throw new Error(String(error.message || "That did not work.").replace(/^Error invoking remote method '[^']+': Error: /, ""));
});
contextBridge.exposeInMainWorld("guildPanel", Object.freeze({
  state: () => invoke("state"),
  close: () => invoke("close"),
  settings: (input) => invoke("settings", input),
  answer: (input) => invoke("answer", input),
  board: (action) => invoke("board", action),
  plan: (input) => invoke("plan", input),
  app: (route) => invoke("app", route),
  onState: (listener) => {
    if (typeof listener !== "function") throw new Error("Invalid guild panel listener.");
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("guildPanel:state", handler);
    return () => ipcRenderer.removeListener("guildPanel:state", handler);
  },
}));
