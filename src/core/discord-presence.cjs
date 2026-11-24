"use strict";
// Discord presence (roadmap S6): "Level 34 Hunter in Stranglethorn Vale" on the player's own
// Discord. Optional and off by default. It talks only to the Discord program running on this
// computer, through Discord's local pipe (discord-ipc-0 .. 9): no network call is made by the
// app and no library is used. The small framing protocol is written out below.
//
// A frame is: opcode (32-bit little endian), length (32-bit little endian), then that many bytes
// of JSON. Opcodes: 0 handshake, 1 frame, 2 close, 3 ping, 4 pong. The app sends a handshake
// { v: 1, client_id }, waits for READY, then sends SET_ACTIVITY with two short lines.
//
// Discord needs an application id to show a status. This project has none yet (creating one is
// the owner's step), so the feature is complete but stays off until an id is typed in: with an
// empty or malformed id the pipe is never opened. The character's name is never sent; level,
// class and zone each have their own tick.
const fs = require("node:fs");
const OP = Object.freeze({ HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 });
const MAX_FRAME = 64 * 1024, MIN_GAP_MS = 15000, RETRY_MS = 30000, PIPES = 10, LINE = 100;
const validAppId = (v) => typeof v === "string" && /^\d{17,20}$/.test(v);
const clean = (v, max) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** One frame as bytes. */
function encode(op, payload) {
  if (!Number.isInteger(op) || op < 0 || op > 4) throw Error("Unknown opcode.");
  const body = Buffer.from(JSON.stringify(payload ?? {}), "utf8");
  if (body.length > MAX_FRAME) throw Error("Frame too large.");
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
/** Bytes in, whole frames out; partial frames wait for the rest. Throws on a frame it will not accept. */
class Decoder {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const frames = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0), length = this.buffer.readUInt32LE(4);
      if (op > 4 || length > MAX_FRAME) { this.buffer = Buffer.alloc(0); throw Error("Unreadable frame."); }
      if (this.buffer.length < 8 + length) break;
      let data;
      try { data = length ? JSON.parse(this.buffer.subarray(8, 8 + length).toString("utf8")) : null; }
      catch { this.buffer = Buffer.alloc(0); throw Error("Unreadable frame."); }
      frames.push({ op, data });
      this.buffer = this.buffer.subarray(8 + length);
    }
    return frames;
  }
}
const defaults = () => ({ enabled: false, appId: "", level: true, className: true, zone: true });
function cleanSettings(raw) {
  const out = defaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  out.enabled = raw.enabled === true;
  out.appId = validAppId(raw.appId) ? raw.appId : "";
  for (const k of ["level", "className", "zone"]) if (typeof raw[k] === "boolean") out[k] = raw[k];
  return out;
}
/**
 * The two lines Discord shows, or null for nothing to show. facts: { level, className, zone }.
 * Only what is ticked is used; a name is never part of it.
 */
function activityText(facts, settings) {
  const s = cleanSettings(settings);
  const level = s.level && Number.isInteger(facts?.level) && facts.level >= 1 && facts.level <= 100 ? `Level ${facts.level}` : "";
  const klass = s.className ? clean(facts?.className, 20) : "";
  const zone = s.zone ? clean(facts?.zone, 60) : "";
  const who = [level, klass].filter(Boolean).join(" ");
  if (!who && !zone) return null;
  return { details: (who || `In ${zone}`).slice(0, LINE), state: who && zone ? `In ${zone}`.slice(0, LINE) : "", line: [who, zone && (who ? `in ${zone}` : `In ${zone}`)].filter(Boolean).join(" ") };
}
const pipePath = (n, platform = process.platform, env = process.env) =>
  (platform === "win32" ? `\\\\.\\pipe\\discord-ipc-${n}` : `${(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp").replace(/\/$/, "")}/discord-ipc-${n}`);

/**
 * The connection. connect(path) must return a socket-like object (on "connect" | "data" |
 * "error" | "close", write, destroy); tests pass a fake pipe. Nothing here uses timers: the
 * owner calls update() when facts change and on a slow tick.
 */
class DiscordPresence {
  constructor({ file = null, connect = (p) => require("node:net").createConnection(p), write = (f, t) => require("./store.cjs").atomic(f, t), pid = process.pid, now = () => Date.now(), platform = process.platform, env = process.env } = {}) {
    Object.assign(this, { file, connect, write, pid, now, platform, env, settings: defaults(), socket: null, ready: false, pipe: 0, sentKey: "", sentAt: 0, failedAt: 0, facts: null, state: "off", nonce: 0 });
    try { this.settings = cleanSettings(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { /* No file yet: off. */ }
    this.state = this.#idle();
  }
  #idle() { return !this.settings.enabled ? "off" : validAppId(this.settings.appId) ? "waiting" : "needs-id"; }
  /** Change the switch, the id or a tick. Throws a plain sentence for a malformed id. */
  configure(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("Invalid Discord setting.");
    const next = { ...this.settings };
    if ("appId" in patch) {
      const id = typeof patch.appId === "string" ? patch.appId.trim() : null;
      if (id === null || (id !== "" && !validAppId(id))) throw Error("A Discord application id is 17 to 20 digits and nothing else.");
      next.appId = id;
    }
    for (const k of ["enabled", "level", "className", "zone"]) if (k in patch) { if (typeof patch[k] !== "boolean") throw Error("Invalid Discord setting."); next[k] = patch[k]; }
    const idChanged = next.appId !== this.settings.appId;
    this.settings = cleanSettings(next);
    if (this.file) try { this.write(this.file, JSON.stringify(this.settings)); } catch { /* Kept for this session. */ }
    if (!this.settings.enabled || !validAppId(this.settings.appId) || idChanged) this.stop();
    this.failedAt = 0;
    this.update(this.facts);
    return this.status();
  }
  /** Give it the newest facts (or null when nothing should show). Connects only when allowed. */
  update(facts) {
    this.facts = facts || null;
    if (!this.settings.enabled || !validAppId(this.settings.appId)) { if (this.socket) this.stop(); this.state = this.#idle(); return this.state; }
    const activity = this.facts ? activityText(this.facts, this.settings) : null;
    if (!this.socket) {
      if (!activity) { this.state = "waiting"; return this.state; }
      if (this.failedAt && this.now() - this.failedAt < RETRY_MS) return this.state;
      this.#open(0);
      return this.state;
    }
    if (this.ready) this.#send(activity);
    return this.state;
  }
  #open(n) {
    this.pipe = n; this.ready = false; this.state = "connecting";
    const decoder = new Decoder();
    let socket;
    try { socket = this.connect(pipePath(n, this.platform, this.env)); } catch { return this.#failed(n, null); }
    this.socket = socket;
    const mine = () => this.socket === socket;
    socket.on("connect", () => { if (mine()) try { socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.settings.appId })); } catch { this.#failed(n, socket); } });
    socket.on("data", (chunk) => {
      if (!mine()) return;
      let frames;
      try { frames = decoder.push(chunk); } catch { return this.#failed(PIPES, socket); }
      for (const f of frames) {
        if (f.op === OP.PING) { try { socket.write(encode(OP.PONG, f.data)); } catch { /* Closing. */ } }
        else if (f.op === OP.CLOSE) return this.#failed(PIPES, socket, "refused");
        else if (f.op === OP.FRAME && f.data?.evt === "READY") { this.ready = true; this.state = "on"; this.sentKey = ""; this.sentAt = 0; this.#send(this.facts ? activityText(this.facts, this.settings) : null); }
        else if (f.op === OP.FRAME && f.data?.evt === "ERROR") this.state = "refused";
      }
    });
    socket.on("error", () => { if (mine()) this.#failed(n, socket); });
    socket.on("close", () => { if (mine()) this.#failed(this.ready ? PIPES : n, socket); });
  }
  // A pipe that will not open means "try the next one"; after the last, Discord is not running.
  #failed(n, socket, state = "no-discord") {
    if (socket) { try { socket.destroy(); } catch { /* Already gone. */ } }
    if (this.socket === socket) this.socket = null;
    const wasReady = this.ready;
    this.ready = false;
    if (!wasReady && state === "no-discord" && n + 1 < PIPES && this.settings.enabled && validAppId(this.settings.appId)) return this.#open(n + 1);
    this.failedAt = this.now(); this.state = state; this.sentKey = "";
  }
  #send(activity) {
    const key = activity ? `${activity.details}\n${activity.state}` : "";
    if (key === this.sentKey || !this.socket) return false;
    // Discord allows only a few updates per 20 seconds; a newer line waits for the next tick.
    if (this.sentAt && this.now() - this.sentAt < MIN_GAP_MS) return false;
    const args = { pid: this.pid, ...(activity ? { activity: { details: activity.details, ...(activity.state ? { state: activity.state } : {}), instance: false } } : {}) };
    try { this.socket.write(encode(OP.FRAME, { cmd: "SET_ACTIVITY", args, nonce: `bf-${++this.nonce}` })); } catch { return false; }
    this.sentKey = key; this.sentAt = this.now();
    return true;
  }
  /** Close the pipe; Discord drops the status with it. */
  stop() {
    const socket = this.socket;
    this.socket = null; this.ready = false; this.sentKey = ""; this.sentAt = 0;
    if (socket) { try { socket.destroy(); } catch { /* Already gone. */ } }
    this.state = this.#idle();
  }
  status() {
    const shown = this.facts ? activityText(this.facts, this.settings) : null;
    return { ...this.settings, appIdValid: validAppId(this.settings.appId), state: this.state, connected: this.ready, preview: shown ? shown.line : "" };
  }
  clear() { this.stop(); this.settings = defaults(); this.state = "off"; if (this.file) try { this.write(this.file, JSON.stringify(this.settings)); } catch { /* Nothing to keep. */ } }
}
module.exports = { OP, MAX_FRAME, MIN_GAP_MS, RETRY_MS, PIPES, validAppId, encode, Decoder, cleanSettings, activityText, pipePath, DiscordPresence };
