"use strict";
// Pop-out radar: a small always-on-top window centred on the live position with nearby
// pins and an arrow to the chosen target. Its own preload and IPC channels, accepted only
// from that window. It never sends input to the game; it only displays.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RADAR_KINDS = new Set(["quest-turnin", "quest-objective", "quest-giver", "flight", "trainer", "vendor", "herb", "ore", "find", "town"]);

function createRadar({ BrowserWindow, ipcMain, worldMap, live, rendererDir }) {
  const page = pathToFileURL(path.join(rendererDir, "radar.html")).toString();
  let win = null, target = null, cache = { mapId: null, pins: [] };
  const valid = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === page;
  function pinsFor(mapId) {
    if (cache.mapId !== mapId) {
      try { cache = { mapId, pins: worldMap.build({ mapId }).pins.filter((p) => RADAR_KINDS.has(p.kind)).map((p) => ({ id: p.id, kind: p.kind, gather: p.gather, label: p.label, sub: p.sub, x: p.x, y: p.y })) }; }
      catch { cache = { mapId, pins: [] }; }
    }
    return cache.pins;
  }
  function state() {
    const frame = live?.status?.()?.frame || null;
    const mapId = frame?.position?.mapId ?? null;
    return {
      live: frame?.position ? { mapId, x: frame.position.x, y: frame.position.y, facing: frame.position.facing, combat: Boolean(frame.combat), mounted: Boolean(frame.mounted), zone: require("./world-map.cjs").mapName(mapId) } : null,
      combat: Boolean(frame?.combat),
      pins: mapId ? pinsFor(mapId) : [],
      target,
    };
  }
  function push() { if (win && !win.isDestroyed()) win.webContents.send("radar:state", state()); }
  ipcMain.handle("radar:state", (event) => { if (!valid(event)) throw Error("Untrusted radar request."); return state(); });
  ipcMain.handle("radar:close", (event) => { if (!valid(event)) throw Error("Untrusted radar request."); win?.close(); return true; });
  const unsubscribe = live?.subscribe?.(() => push());
  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return { open: true }; }
    win = new BrowserWindow({
      width: 300, height: 360, minWidth: 220, minHeight: 270, frame: false, transparent: true, resizable: true,
      alwaysOnTop: true, skipTaskbar: false, title: "Backstage Forever radar", backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "..", "radar-preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.on("closed", () => { win = null; });
    win.loadURL(page);
    return { open: true };
  }
  function setTarget(pin) {
    if (pin === null) { target = null; push(); return { target }; }
    if (!pin || typeof pin !== "object" || !Number.isSafeInteger(pin.mapId) || ![pin.x, pin.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw Error("Invalid radar target.");
    const text = (v) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80) : null);
    target = { mapId: pin.mapId, x: pin.x, y: pin.y, label: text(pin.label) || "Target", sub: text(pin.sub), kind: RADAR_KINDS.has(pin.kind) || pin.kind === "instance" ? pin.kind : "target" };
    push();
    return { target };
  }
  return { open, setTarget, state, close: () => { unsubscribe?.(); win?.close(); }, isOpen: () => Boolean(win && !win.isDestroyed()) };
}
module.exports = { createRadar };
