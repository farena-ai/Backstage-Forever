"use strict";
// The companion panel over the game (0.38, roadmap A15 / 3.4; one window since 0.39.1): a small
// frameless always-on-top window over the top-right corner of the game window. The owl button in
// game (or /bf ask) opens it with the keyboard in its question box; you type there, the answer
// appears under your question and follow-ups go in the same place. Answers to questions sent from
// the game's chat line (/bf ask QUESTION) arrive here too, shown without taking the keyboard.
// It never sends input to the game. Its own preload and IPC channels, accepted only from that window.
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const SIZE = Object.freeze({ width: 420, height: 380 });
// Gap to the game's right edge, and how far down: WoW keeps its minimap (with our Ask button) in
// the top-right corner, about a quarter of the screen height tall at any UI scale (the UI is 768
// units high), so the panel sits just under it and the button stays clickable.
const EDGE = 16, BELOW_MINIMAP = 0.25;
const HIDE_CHOICES = Object.freeze([0, 20, 45, 90, 180]); // seconds; 0 = stay until closed
const DEFAULTS = Object.freeze({ enabled: true, hideAfterS: 45, position: null });
const LOG_MAX = 8, QUESTION_MAX = 200;

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
/** One exchange in the panel: { id, status, question, at, answer? | message?, note? }. */
function panelState(input) {
  const status = ["thinking", "answer", "error"].includes(input?.status) ? input.status : "error";
  const out = { status, question: text(input?.question, 400), at: Number.isFinite(input?.at) ? input.at : Date.now() };
  if (Number.isSafeInteger(input?.id) && input.id > 0) out.id = input.id;
  if (status === "answer") out.answer = { text: text(input?.answer?.text, 20000), kind: text(input?.answer?.kind, 20) || "ai" };
  if (status === "error") out.message = text(input?.message, 400) || "The companion could not answer. Open the app to try again.";
  if (input?.note) out.note = text(input.note, 200);
  return out;
}
/** Pure: a question typed in the panel -> the text to ask, or null (empty, too long, not text). */
function cleanQuestion(input) {
  if (typeof input !== "string") return null;
  const q = input.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return q && [...q].length <= QUESTION_MAX ? q : null;
}
/** Pure: the log after an exchange is added or updated (same id replaces it), newest last, bounded. */
function upsert(log, entry) {
  const out = entry.id ? log.filter((e) => e.id !== entry.id) : [...log];
  const at = entry.id ? log.findIndex((e) => e.id === entry.id) : -1;
  if (at >= 0) out.splice(at, 0, entry); else out.push(entry);
  return out.slice(-LOG_MAX);
}

function createAskPanel({ BrowserWindow, ipcMain, screen, rendererDir, dataDir = null, gameRect = () => null, onOpenApp = () => {}, onAsk = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const page = pathToFileURL(path.join(rendererDir, "ask-panel.html")).toString();
  const file = dataDir ? path.join(dataDir, "ask-panel.json") : null;
  let win = null, log = [], typing = 0, timer = null, hold = false, focused = false, prefs = DEFAULTS, placing = false, wantFocus = false;
  let revision = 0;
  try { prefs = cleanSettings(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { prefs = { ...DEFAULTS }; }
  const persist = () => { try { if (file) fs.writeFileSync(file, JSON.stringify(prefs)); } catch {} };
  // What the page shows: the exchanges, and a counter that tells it to put the cursor in the box.
  const view = () => ({ log: [...log], typing, revision });
  const latest = () => log.at(-1) || null;
  // The panel window only ever shows our own page (navigation and new windows are blocked), so the
  // sender being its main frame is the check; comparing file URLs broke in the installed app.
  const valid = (event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
  const guard = (event) => { if (!valid(event)) throw Error("Untrusted panel request."); };
  ipcMain.handle("askPanel:state", (event) => { guard(event); return view(); });
  ipcMain.handle("askPanel:close", (event) => { guard(event); hide(); return true; });
  ipcMain.handle("askPanel:openApp", (event) => { guard(event); hide(); onOpenApp(); return true; });
  ipcMain.handle("askPanel:hold", (event, on) => { guard(event); hold = on === true; schedule(); return true; });
  ipcMain.handle("askPanel:ask", (event, question) => {
    guard(event);
    const q = cleanQuestion(question);
    if (!q) throw Error("Type a question (up to 200 characters).");
    onAsk(q);
    return true;
  });

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
  // Shows the window: with the keyboard when the player opened it (owl, /bf ask), else inactive.
  function present() {
    if (!win || win.isDestroyed()) return;
    if (wantFocus) { wantFocus = false; if (!win.isVisible()) place(); win.show(); win.focus(); }
    else if (!win.isVisible()) { place(); win.showInactive(); }
  }
  function create() {
    win = new BrowserWindow({
      ...SIZE, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: true, title: "Backstage Forever companion", backgroundColor: "#16110c",
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
    // While the player is typing in it, it never hides by itself.
    win.on("focus", () => { focused = true; schedule(); });
    win.on("blur", () => { focused = false; schedule(); });
    win.on("closed", () => { win = null; focused = false; clearTimer(timer); timer = null; });
    win.once("ready-to-show", () => { place(); present(); });
    place();
    win.loadURL(page);
  }
  // The page says when the mouse is over it, but a full-screen game can take the mouse back without
  // the page ever hearing that it left, which held the panel open for good. While held, look where
  // the mouse really is each second and let go once it is off the panel.
  let holdCheck = null;
  function overPanel() {
    try {
      const c = screen.getCursorScreenPoint(), b = win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null;
      return Boolean(b && c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height);
    } catch { return false; }
  }
  function watchHold() {
    clearTimer(holdCheck); holdCheck = null;
    if (!hold) return;
    holdCheck = setTimer(() => { holdCheck = null; if (hold && !overPanel()) { hold = false; schedule(); } else watchHold(); }, 1000);
    holdCheck?.unref?.();
  }
  function schedule() {
    clearTimer(timer); timer = null;
    watchHold();
    const last = latest();
    if (hold || focused || !last || last.status === "thinking" || !prefs.hideAfterS) return;
    timer = setTimer(() => { timer = null; if (!hold && !focused) hide(); }, prefs.hideAfterS * 1000);
    timer?.unref?.();
  }
  function send() { if (win && !win.isDestroyed()) win.webContents.send("askPanel:state", view()); }
  /** Adds or updates an exchange (same id) and shows the panel without taking focus. False when switched off. */
  function show(input) {
    log = upsert(log, panelState(input));
    revision++;
    if (!prefs.enabled) return false;
    if (!win || win.isDestroyed()) create();
    else { send(); present(); }
    schedule();
    return true;
  }
  /** Opens the panel with the keyboard in its question box (the owl button, /bf ask). False when switched off. */
  function open() {
    if (!prefs.enabled) return false;
    typing++; revision++; wantFocus = true;
    if (!win || win.isDestroyed()) create();
    else { send(); present(); }
    schedule();
    return true;
  }
  function hide() { clearTimer(timer); timer = null; hold = false; clearTimer(holdCheck); holdCheck = null; if (win && !win.isDestroyed()) win.hide(); }
  return {
    show, open, hide, where,
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
    state: () => view().log.at(-1) || null,
    log: () => view().log,
    close() { clearTimer(timer); timer = null; for (const c of ["askPanel:state", "askPanel:close", "askPanel:openApp", "askPanel:hold", "askPanel:ask"]) ipcMain.removeHandler(c); if (win && !win.isDestroyed()) win.destroy(); win = null; },
  };
}
module.exports = { createAskPanel, placePanel, panelState, cleanSettings, cleanQuestion, upsert, SIZE, EDGE, BELOW_MINIMAP, HIDE_CHOICES, LOG_MAX, QUESTION_MAX };
