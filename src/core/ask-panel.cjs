"use strict";
// In-game answer panel (0.38, roadmap A15 / 3.4): a small frameless always-on-top window that
// shows the answer to a question typed in game, over the top-right corner of the game window.
// It never takes focus from the game (focusable: false, shown inactive), never sends input to the
// game and only displays. Its own preload and IPC channels, accepted only from that window.
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const SIZE = Object.freeze({ width: 420, height: 260 });
// Gap to the game's right edge, and how far down: WoW keeps its minimap (with our Ask button) in
// the top-right corner, about a quarter of the screen height tall at any UI scale (the UI is 768
// units high), so the panel sits just under it and the button stays clickable.
const EDGE = 16, BELOW_MINIMAP = 0.25;
const HIDE_CHOICES = Object.freeze([0, 20, 45, 90, 180]); // seconds; 0 = stay until closed
const DEFAULTS = Object.freeze({ enabled: true, hideAfterS: 45, position: null });

const inside = (p, a) => p.x >= a.x && p.y >= a.y && p.x < a.x + a.width && p.y < a.y + a.height;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rectOk = (r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
/**
 * Pure placement. game: the game window's client area in DIP (or null); areas: work areas of all
 * displays; fallback: the work area to use without a game rectangle (the display under the
 * cursor, where the player just typed); saved: a position the player dragged the panel to.
 * -> { x, y, width, height, anchor: "saved" | "game" | "display" }
 */
function placePanel({ game = null, areas = [], fallback = null, saved = null, size = SIZE } = {}) {
  const { width, height } = size;
  const fits = (p) => areas.find((a) => inside(p, a) && inside({ x: p.x + width - 1, y: p.y + height - 1 }, a));
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && fits(saved)) return { x: Math.round(saved.x), y: Math.round(saved.y), width, height, anchor: "saved" };
  let anchor = "display", box = rectOk(fallback) ? fallback : areas.find(rectOk) || { x: 0, y: 0, width: 1280, height: 720 };
  if (rectOk(game)) { anchor = "game"; box = game; }
  // The work area the panel must stay in: the one holding the anchor box's top-right corner.
  const corner = { x: box.x + box.width - 1, y: box.y };
  const overlap = (a) => Math.max(0, Math.min(a.x + a.width, box.x + box.width) - Math.max(a.x, box.x)) * Math.max(0, Math.min(a.y + a.height, box.y + box.height) - Math.max(a.y, box.y));
  const most = areas.filter(rectOk).sort((a, b) => overlap(b) - overlap(a))[0];
  const area = areas.find((a) => inside(corner, a)) || (most && overlap(most) > 0 ? most : null) || (rectOk(fallback) ? fallback : box);
  const x = box.x + box.width - width - EDGE, y = box.y + Math.round(box.height * BELOW_MINIMAP) + 8;
  return { x: Math.round(clamp(x, area.x, area.x + area.width - width)), y: Math.round(clamp(y, area.y, area.y + area.height - height)), width, height, anchor };
}
function cleanSettings(input, base = DEFAULTS) {
  const out = { ...base };
  if (input && typeof input === "object") {
    if (typeof input.enabled === "boolean") out.enabled = input.enabled;
    if (HIDE_CHOICES.includes(input.hideAfterS)) out.hideAfterS = input.hideAfterS;
    if (input.position === null) out.position = null;
    else if (input.position && Number.isInteger(input.position.x) && Number.isInteger(input.position.y) && Math.abs(input.position.x) < 100000 && Math.abs(input.position.y) < 100000) out.position = { x: input.position.x, y: input.position.y };
  }
  return out;
}
// Text the panel shows: bounded plain strings only (the renderer formats the answer itself).
const text = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").slice(0, max) : "");
function panelState(input) {
  const status = ["thinking", "answer", "error"].includes(input?.status) ? input.status : "error";
  const out = { status, question: text(input?.question, 400), at: Number.isFinite(input?.at) ? input.at : Date.now() };
  if (status === "answer") out.answer = { text: text(input?.answer?.text, 20000), kind: text(input?.answer?.kind, 20) || "ai" };
  if (status === "error") out.message = text(input?.message, 400) || "The companion could not answer. Open the app to try again.";
  if (input?.note) out.note = text(input.note, 200);
  return out;
}

function createAskPanel({ BrowserWindow, ipcMain, screen, rendererDir, dataDir = null, gameRect = () => null, onOpenApp = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const page = pathToFileURL(path.join(rendererDir, "ask-panel.html")).toString();
  const file = dataDir ? path.join(dataDir, "ask-panel.json") : null;
  let win = null, state = null, timer = null, hold = false, prefs = DEFAULTS, placing = false;
  try { prefs = cleanSettings(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { prefs = { ...DEFAULTS }; }
  const persist = () => { try { if (file) fs.writeFileSync(file, JSON.stringify(prefs)); } catch {} };
  const valid = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === page;
  const guard = (event) => { if (!valid(event)) throw Error("Untrusted panel request."); };
  ipcMain.handle("askPanel:state", (event) => { guard(event); return state; });
  ipcMain.handle("askPanel:close", (event) => { guard(event); hide(); return true; });
  ipcMain.handle("askPanel:openApp", (event) => { guard(event); hide(); onOpenApp(); return true; });
  ipcMain.handle("askPanel:hold", (event, on) => { guard(event); hold = on === true; schedule(); return true; });

  // Where the panel goes now: the player's dragged spot, else over the game, else the cursor's display.
  function where() {
    let game = null;
    try {
      const r = gameRect();
      if (rectOk(r)) game = process.platform === "win32" && screen.screenToDipRect ? screen.screenToDipRect(null, r) : r;
    } catch { game = null; }
    const displays = screen.getAllDisplays();
    let fallback = null;
    try { fallback = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch { fallback = screen.getPrimaryDisplay().workArea; }
    return placePanel({ game, areas: displays.map((d) => d.workArea), fallback, saved: prefs.position });
  }
  function place() {
    if (!win || win.isDestroyed()) return;
    const p = where();
    placing = true;
    try { win.setBounds({ x: p.x, y: p.y, width: p.width, height: p.height }); } finally { placing = false; }
  }
  function create() {
    win = new BrowserWindow({
      ...SIZE, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, title: "Backstage Forever answer", backgroundColor: "#16110c",
      webPreferences: { preload: path.join(__dirname, "..", "ask-panel-preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false },
    });
    // Above full-screen (borderless) games, like the radar.
    win.setAlwaysOnTop(true, "screen-saver");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    // A drag by the player (not our own placement) becomes the panel's place from now on.
    win.on("moved", () => {
      if (placing || !win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      prefs = cleanSettings({ ...prefs, position: { x, y } }); persist();
    });
    win.on("closed", () => { win = null; clearTimer(timer); timer = null; });
    win.once("ready-to-show", () => { place(); if (state) win.showInactive(); });
    place();
    win.loadURL(page);
  }
  function schedule() {
    clearTimer(timer); timer = null;
    if (hold || !state || state.status === "thinking" || !prefs.hideAfterS) return;
    timer = setTimer(() => { timer = null; if (!hold) hide(); }, prefs.hideAfterS * 1000);
    timer?.unref?.();
  }
  /** Shows (or updates) the panel without taking focus. Returns false when the panel is switched off. */
  function show(input) {
    state = panelState(input);
    if (!prefs.enabled) return false;
    if (!win || win.isDestroyed()) create();
    else {
      win.webContents.send("askPanel:state", state);
      if (!win.isVisible()) { place(); win.showInactive(); }
    }
    schedule();
    return true;
  }
  function hide() { clearTimer(timer); timer = null; if (win && !win.isDestroyed()) win.hide(); }
  return {
    show, hide, where,
    settings: () => ({ enabled: prefs.enabled, hideAfterS: prefs.hideAfterS, moved: Boolean(prefs.position), choices: [...HIDE_CHOICES] }),
    setSettings(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid panel settings.");
      const next = cleanSettings({ ...prefs, ...input, ...(input.resetPosition === true ? { position: null } : {}) });
      if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw Error("Invalid panel settings.");
      if (input.hideAfterS !== undefined && !HIDE_CHOICES.includes(input.hideAfterS)) throw Error("Invalid panel settings.");
      prefs = next; persist();
      if (!prefs.enabled) hide();
      else if (input.resetPosition === true) place();
      schedule();
      return this.settings();
    },
    window: () => (win && !win.isDestroyed() ? win : null),
    destroyWindow() { clearTimer(timer); timer = null; if (win && !win.isDestroyed()) win.destroy(); win = null; },
    state: () => state,
    close() { clearTimer(timer); timer = null; for (const c of ["askPanel:state", "askPanel:close", "askPanel:openApp", "askPanel:hold"]) ipcMain.removeHandler(c); if (win && !win.isDestroyed()) win.destroy(); win = null; },
  };
}
module.exports = { createAskPanel, placePanel, panelState, cleanSettings, SIZE, EDGE, BELOW_MINIMAP, HIDE_CHOICES };
