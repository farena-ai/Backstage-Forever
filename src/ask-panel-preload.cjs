"use strict";
// Narrow bridge for the in-game answer panel only (0.38, A15).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("askPanel", Object.freeze({
  state: () => ipcRenderer.invoke("askPanel:state"),
  close: () => ipcRenderer.invoke("askPanel:close"),
  openApp: () => ipcRenderer.invoke("askPanel:openApp"),
  hold: (on) => ipcRenderer.invoke("askPanel:hold", on === true),
  onState: (listener) => {
    if (typeof listener !== "function") throw new Error("Invalid panel listener.");
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("askPanel:state", handler);
    return () => ipcRenderer.removeListener("askPanel:state", handler);
  },
}));
