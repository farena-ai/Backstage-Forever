"use strict";
// Mini Now is a small always-on-top window beside the game with your next step.
// Like the radar, its own preload and IPC channels are accepted only
// from that window. It never sends input to the game and never takes the keyboard by itself.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { nextStep } = require("./next-step.cjs");

/** Pure view of the current recommendation and optional session details. */
function miniNowView(advice, session, step = nextStep(advice)) {
  if (!advice || (advice.status && advice.status !== "ok")) return { ready: false, message: advice?.status === "no-character" ? "Log in with the addon to see your next step." : "Log in on this character and type /reload once." };
  const c = advice.character || {};
  const xp = c.xp ? Math.floor((c.xp.current / c.xp.max) * 100) : null;
  const pct = Number.isFinite(c.xpPercent) ? Math.floor(c.xpPercent) : xp;
  const rested = c.xp && c.xp.rested > 0 ? Math.round((c.xp.rested / c.xp.max) * 100) : 0;
  const pace = session?.active ? { levelsPerHour: session.levelsPerHour ?? null, minutesToLevel: session.minutesToLevel ?? null, minutes: session.activeMinutes ?? 0, deaths: session.deaths ?? 0 } : null;
  const questStep = step?.kind === "turnin" || step?.kind === "objective";
  const evidence = ["live", "saved", "reference"].includes(step?.source)
    ? step.source
    : questStep
      ? advice.log?.live ? "live" : "saved"
      : c.live ? "live" : c.savedAt ? "saved" : "reference";
  return { ready: true, name: c.name || null, level: c.level ?? null, zone: c.zone || null, live: Boolean(c.live), evidence, xpPercent: pct, restedPercent: rested, step, pace };
}

function createMiniNow({ BrowserWindow, ipcMain, advise, session, live, rendererDir, getStep = nextStep, onOpenNow }) {
  const page = pathToFileURL(path.join(rendererDir, "mini-now.html")).toString();
  let win = null, timer = null;
  const valid = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === page;
  function state() {
    let advice = null, s = null, step;
    try { advice = advise(); } catch {}
    try { s = session?.(); } catch {}
    try { step = getStep(advice); } catch {}
    return miniNowView(advice, s, step);
  }
  let last = "";
  function push(force) {
    if (!win || win.isDestroyed()) return;
    const v = state(), key = JSON.stringify(v);
    if (!force && key === last) return;
    last = key; win.webContents.send("miniNow:state", v);
  }
  ipcMain.handle("miniNow:state", (event) => { if (!valid(event)) throw Error("Untrusted mini Now request."); return state(); });
  ipcMain.handle("miniNow:close", (event) => { if (!valid(event)) throw Error("Untrusted mini Now request."); win?.close(); return true; });
  ipcMain.handle("miniNow:openNow", (event, ...args) => {
    if (!valid(event)) throw Error("Untrusted mini Now request.");
    if (args.length) throw Error("Invalid mini Now request.");
    if (!onOpenNow) return false;
    onOpenNow();
    return true;
  });
  // Live frames arrive several times a second; the window only needs a fresh look every 2s.
  let queued = false;
  const unsubscribe = live?.subscribe?.(() => { if (queued || !win) return; queued = true; setTimeout(() => { queued = false; push(false); }, 2000); });
  function open() {
    if (win && !win.isDestroyed()) { win.showInactive(); return { open: true }; }
    win = new BrowserWindow({
      width: 320, height: 210, minWidth: 260, minHeight: 170, frame: false, transparent: true, resizable: true,
      alwaysOnTop: true, skipTaskbar: false, title: "Backstage Forever mini Now", backgroundColor: "#00000000", show: false,
      webPreferences: { preload: path.join(__dirname, "..", "mini-now-preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.once("ready-to-show", () => win?.showInactive());
    win.on("closed", () => { win = null; clearInterval(timer); timer = null; last = ""; });
    win.loadURL(page);
    // Saves and quest changes arrive without a live frame too.
    timer = setInterval(() => push(false), 5000);
    return { open: true };
  }
  return { open, state, push, close: () => { unsubscribe?.(); clearInterval(timer); win?.close(); }, isOpen: () => Boolean(win && !win.isDestroyed()) };
}
module.exports = { createMiniNow, miniNowView };
