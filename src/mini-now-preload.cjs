"use strict";
// Narrow bridge for the mini Now window only.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("miniNow", Object.freeze({
  state: () => ipcRenderer.invoke("miniNow:state"),
  close: () => ipcRenderer.invoke("miniNow:close"),
  onState: (listener) => {
    if (typeof listener !== "function") throw new Error("Invalid mini Now listener.");
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("miniNow:state", handler);
    return () => ipcRenderer.removeListener("miniNow:state", handler);
  },
}));
