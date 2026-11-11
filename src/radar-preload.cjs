"use strict";
// Narrow bridge for the pop-out radar window only.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("radar", Object.freeze({
  state: () => ipcRenderer.invoke("radar:state"),
  close: () => ipcRenderer.invoke("radar:close"),
  onState: (listener) => {
    if (typeof listener !== "function") throw new Error("Invalid radar listener.");
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("radar:state", handler);
    return () => ipcRenderer.removeListener("radar:state", handler);
  },
}));
