"use strict";
// The "Guild & Party" panel: a compact always-on-top window beside or over the game (second
// monitor, or a windowed or borderless game) with three tabs: Events, Party, Board. Modelled on the
// mini Now window: its own preload and IPC channels, accepted only from that window. It never sends
// input to the game and never takes the keyboard by itself (it is shown without activating it).
// It remembers where you put it, how big and how see-through it is. Mouse clicks always land on it
// (click-through stays off), so a button can never be pressed by accident through the game.
const fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT = Object.freeze({ width: 380, height: 520 });
const MIN = Object.freeze({ width: 320, height: 300 }), MAX = Object.freeze({ width: 640, height: 900 });
const TABS = Object.freeze(["events", "party", "board"]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v) => Number.isFinite(v) ? Math.round(v) : null;

/** Stored settings -> the checked shape. opacity 40..100 (%). */
function panelSettings(raw) {
  const b = raw?.bounds;
  const bounds = b && [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) ? { x: int(b.x), y: int(b.y), width: clamp(int(b.width), MIN.width, MAX.width), height: clamp(int(b.height), MIN.height, MAX.height) } : null;
  return { bounds, opacity: Number.isFinite(raw?.opacity) ? clamp(Math.round(raw.opacity / 5) * 5, 40, 100) : 100, hideInCombat: raw?.hideInCombat === true, openAtStart: raw?.openAtStart === true,
    tab: TABS.includes(raw?.tab) ? raw.tab : "events", introSeen: raw?.introSeen === true };
}
/** Where the window opens: the remembered place when it is still on a screen, else the top right of the main screen. */
function placeOn(displays, bounds) {
  const size = { width: clamp(bounds?.width || DEFAULT.width, MIN.width, MAX.width), height: clamp(bounds?.height || DEFAULT.height, MIN.height, MAX.height) };
  const areas = (Array.isArray(displays) ? displays : []).map((d) => d?.workArea).filter((a) => a && [a.x, a.y, a.width, a.height].every(Number.isFinite));
  if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    // At least a hand's width of the title bar must be on some screen, or it could never be dragged back.
    const visible = areas.some((a) => bounds.x + size.width - 80 >= a.x && bounds.x + 80 <= a.x + a.width && bounds.y >= a.y - 4 && bounds.y + 40 <= a.y + a.height);
    if (visible) return { x: bounds.x, y: bounds.y, ...size };
  }
  const a = areas[0];
  if (!a) return { ...size };
  return { x: Math.round(a.x + a.width - Math.min(size.width, a.width) - 24), y: Math.round(a.y + 64), width: Math.min(size.width, a.width), height: Math.min(size.height, a.height - 88) };
}

function createGuildPanel({ BrowserWindow, ipcMain, screen = null, rendererDir, dataDir, view, actions = {}, inCombat = () => false, gameLocale = () => null, write = (f, t) => require("./store.cjs").atomic(f, t) }) {
  const page = pathToFileURL(path.join(rendererDir, "guild-panel.html")).toString();
  const file = dataDir ? path.join(dataDir, "live", "panel.json") : null;
  let win = null, timer = null, last = "", saveTimer = null, hiddenForCombat = false;
  let settings = panelSettings(null);
  try { settings = panelSettings(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { /* first run */ }
  const save = () => { if (!file) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); write(file, JSON.stringify(settings)); } catch { /* best effort */ } };
  const valid = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === page;
  const guard = (fn) => async (event, ...args) => { if (!valid(event)) throw Error("Untrusted guild panel request."); try { return await fn(...args); } catch (e) { throw Error(e?.name === "GuildError" ? e.message : "That did not work. Try again."); } };
  function state() {
    let v = null;
    try { v = view(); } catch { v = null; }
    let locale = null;
    try { locale = gameLocale(); } catch {}
    return { ...(v || {}), ready: Boolean(v), settings: { opacity: settings.opacity, hideInCombat: settings.hideInCombat, openAtStart: settings.openAtStart, tab: settings.tab, introSeen: settings.introSeen }, gameLocale: locale };
  }
  function push(force = false) {
    if (!win || win.isDestroyed()) return;
    const v = state(), key = JSON.stringify({ ...v, now: 0 });
    if (!force && key === last) return;
    last = key; win.webContents.send("guildPanel:state", v);
  }
  function combat() {
    if (!win || win.isDestroyed()) return;
    let fighting = false;
    try { fighting = settings.hideInCombat && inCombat() === true; } catch {}
    if (fighting && win.isVisible()) { hiddenForCombat = true; win.hide(); }
    else if (!fighting && hiddenForCombat) { hiddenForCombat = false; win.showInactive(); }
  }
  ipcMain.handle("guildPanel:state", guard(() => state()));
  ipcMain.handle("guildPanel:close", guard(() => { win?.close(); return true; }));
  ipcMain.handle("guildPanel:settings", guard((input) => {
    if (!input || typeof input !== "object" || Object.keys(input).some((k) => !["opacity", "hideInCombat", "openAtStart", "tab", "introSeen"].includes(k))) throw Error("Invalid panel settings.");
    settings = panelSettings({ ...settings, ...input });
    if (win && !win.isDestroyed()) win.setOpacity(settings.opacity / 100);
    save(); push(true);
    if (input.tab) { try { actions.watch?.(settings.tab === "board"); } catch {} }
    return state().settings;
  }));
  ipcMain.handle("guildPanel:answer", guard(async (input) => {
    if (!input || typeof input.guildId !== "string" || typeof input.eventId !== "string" || typeof input.answer !== "string") throw Error("Invalid answer.");
    const r = await actions.answer(input.guildId, input.eventId, input.answer); push(true); return r;
  }));
  ipcMain.handle("guildPanel:board", guard(async (action) => {
    if (!["watch", "renew", "remove", "browse"].includes(action)) throw Error("Invalid board action.");
    const r = await actions.board(action); push(true); return r;
  }));
  ipcMain.handle("guildPanel:plan", guard(async (input) => {
    if (!input || !Number.isSafeInteger(input.slot) || !(input.member === null || (input.member && typeof input.member.name === "string" && typeof input.member.realm === "string"))) throw Error("Invalid plan change.");
    const r = await actions.assign(input.slot, input.member ? { name: input.member.name, realm: input.member.realm } : null); push(true); return r;
  }));
  ipcMain.handle("guildPanel:app", guard((route) => { if (!["guild", "party", "guild-guide"].includes(route)) throw Error("Invalid page."); actions.openApp?.(route); return true; }));
  function open(tab = null) {
    if (TABS.includes(tab) && tab !== settings.tab) { settings.tab = tab; save(); }
    if (win && !win.isDestroyed()) { hiddenForCombat = false; win.showInactive(); push(true); return { open: true }; }
    let displays = [];
    try { displays = screen?.getAllDisplays?.() || []; } catch { displays = []; }
    const at = placeOn(displays, settings.bounds);
    win = new BrowserWindow({
      ...at, minWidth: MIN.width, minHeight: MIN.height, maxWidth: MAX.width, maxHeight: MAX.height, frame: false, transparent: true, resizable: true, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: false, title: "Backstage Forever Guild & Party", backgroundColor: "#00000000", show: false,
      webPreferences: { preload: path.join(__dirname, "..", "guild-panel-preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    win.setAlwaysOnTop(true, "screen-saver"); // above a borderless or windowed game
    win.setIgnoreMouseEvents(false);          // click-through stays off
    win.setOpacity(settings.opacity / 100);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.once("ready-to-show", () => win?.showInactive()); // shown without taking the keyboard from the game
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { if (!win || win.isDestroyed()) return; const b = win.getBounds(); settings.bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; save(); }, 400);
    };
    win.on("move", remember); win.on("resize", remember);
    win.on("closed", () => { win = null; clearInterval(timer); timer = null; clearTimeout(saveTimer); last = ""; hiddenForCombat = false; try { actions.watch?.(false); } catch {} });
    win.loadURL(page);
    // Countdowns and the combat setting need a look now and then even when nothing changed.
    timer = setInterval(() => { combat(); push(false); if (settings.tab === "board") { try { actions.watch?.(true); } catch {} } }, 5000);
    timer.unref?.();
    try { actions.watch?.(settings.tab === "board"); } catch {}
    return { open: true };
  }
  return { open, push, state, settings: () => ({ ...state().settings }), close: () => { clearInterval(timer); win?.close(); }, isOpen: () => Boolean(win && !win.isDestroyed()), window: () => win,
    openAtStart: () => settings.openAtStart };
}
module.exports = { createGuildPanel, panelSettings, placeOn, DEFAULT, MIN, MAX, TABS };
