"use strict";
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { spawn: spawnProcess } = require("node:child_process");
const { prepareVoiceRuntime } = require("./voice-runtime.cjs");
const LIMITS = Object.freeze({ line: 32768, stdout: 131072, stderr: 16384, text: 4000, enumeration: 32, startup: 8000, listen: 15000, silence: 4000, speak: 60000, kill: 1000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNAVAILABLE = "Local Windows speech is unavailable. You can keep typing.";
const FAILURE = "Local speech stopped safely. You can keep typing or try again.";
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw Error("Invalid voice request.");
}
function string(value, max, blank = false) {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (!blank && !value.trim())) throw Error("Invalid voice request.");
}
function strictJSON(raw) {
  const objects = []; let quoted = false, escaped = false, start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') { quoted = false; let next = i + 1; while (/\s/.test(raw[next] || "x")) next++; if (raw[next] === ":") { const key = JSON.parse(raw.slice(start, i + 1)), keys = objects.at(-1); if (!keys || keys.has(key)) throw Error(); keys.add(key); } }
    } else if (c === '"') { quoted = true; start = i; }
    else if (c === "{") objects.push(new Set());
    else if (c === "[") objects.push(null);
    else if (c === "}" || c === "]") objects.pop();
  }
  return JSON.parse(raw);
}
function eventSchema(event, id, command) {
  if (event?.v !== 1 || event.id !== id) throw Error("Invalid voice event.");
  const base = ["v", "id", "event"];
  switch (event.event) {
    case "started": exact(event, base); if (command === "capabilities") throw Error(); break;
    case "hypothesis": exact(event, [...base, "text"]); string(event.text, LIMITS.text, true); if (command !== "listen") throw Error(); break;
    case "completed": exact(event, command === "listen" ? [...base, "text"] : base); if (command === "listen") string(event.text, LIMITS.text, true); if (command === "capabilities") throw Error(); break;
    case "unavailable": exact(event, [...base, "code"]); if (!["engine", "audio", "blocked", "protocol", "timeout"].includes(event.code)) throw Error(); break;
    case "capabilities":
      exact(event, [...base, "recognizers", "voices"]); if (command !== "capabilities") throw Error();
      for (const rows of [event.recognizers, event.voices]) {
        if (!Array.isArray(rows) || rows.length > LIMITS.enumeration) throw Error();
        const ids = new Set();
        for (const row of rows) { exact(row, ["id", "culture", "name"]); string(row.id, 256); string(row.culture, 64); string(row.name, 256); if (ids.has(row.id)) throw Error(); ids.add(row.id); }
      }
      if (event.recognizers.some(r => !/^MS-\d+-\d+-DESK$/.test(r.id) || !/^Microsoft /i.test(r.name)) || event.voices.some(v => !v.id.startsWith("Microsoft ") || v.id !== v.name)) throw Error();
      break;
    default: throw Error("Invalid voice event.");
  }
}

// A disposable worker accepts one operation and at most one cancellation.
// Terminal results are committed only after process exit, proving disposal.
class VoiceWorker {
  constructor({ spawn, executable, helper, request, limits, onEvent }) {
    this.request = request; this.limits = limits; this.onEvent = onEvent; this.done = false; this.cancelled = false; this.buffer = Buffer.alloc(0); this.output = 0; this.errors = 0; this.terminal = null; this.started = false; this.bindings = [];
    this.result = new Promise(resolve => this.resolve = resolve);
    try {
      this.child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.bind(this.child, "error", () => this.fail());
      this.bind(this.child, "close", code => this.finish(this.cancelled ? { cancelled: true } : !this.failed && code === 0 && this.terminal && !this.buffer.length ? { event: this.terminal } : { error: true }));
      this.bind(this.child.stdout, "data", chunk => this.read(chunk));
      this.bind(this.child.stdout, "end", () => { if (!this.cancelled && !this.terminal) this.fail(); });
      this.bind(this.child.stdout, "error", () => this.fail());
      this.bind(this.child.stderr, "data", chunk => { this.errors += Buffer.byteLength(chunk); if (this.errors > limits.stderr) this.fail(); });
      this.bind(this.child.stderr, "error", () => this.fail());
      this.bind(this.child.stdin, "error", () => this.fail());
      this.deadline = setTimeout(() => this.fail(), limits.startup);
      this.write(request);
    } catch { this.fail(); }
  }
  bind(emitter, name, fn) { emitter.on(name, fn); this.bindings.push([emitter, name, fn]); }
  write(request) {
    const line = JSON.stringify(request) + "\n";
    if (Buffer.byteLength(line) > this.limits.line || !this.child?.stdin?.writable) return this.fail();
    // No unbounded queued writes: this worker has only operation + cancel.
    try { this.child.stdin.write(line); } catch { this.fail(); }
  }
  read(chunk) {
    if (this.done || this.cancelled || this.failed) return;
    try {
      this.output += chunk.length; if (this.output > this.limits.stdout) throw Error();
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      let newline;
      while ((newline = this.buffer.indexOf(10)) !== -1) {
        if (newline > this.limits.line) throw Error();
        const raw = this.buffer.subarray(0, newline); this.buffer = this.buffer.subarray(newline + 1);
        const event = strictJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw));
        eventSchema(event, this.request.id, this.request.command);
        if (this.terminal) throw Error();
        if (event.event === "started") {
          if (this.started) throw Error(); this.started = true; clearTimeout(this.deadline);
          this.deadline = setTimeout(() => this.fail(), this.request.command === "listen" ? this.limits.listen : this.limits.speak);
        } else if (event.event === "hypothesis") { if (!this.started) throw Error(); }
        else {
          if (event.event === "completed" && !this.started) throw Error();
          this.terminal = event; clearTimeout(this.deadline); this.deadline = setTimeout(() => this.fail(), this.limits.kill);
        }
        this.onEvent?.(event);
      }
      if (this.buffer.length > this.limits.line) throw Error();
    } catch { this.fail(); }
  }
  fail() {
    if (this.done || this.failed) return;
    this.failed = true; clearTimeout(this.deadline);
    if (!this.child) { this.finish({ error: true }); return; }
    // Keep pipe error handlers while termination drains outstanding writes.
    // Removing them before close can turn a late EPIPE into a main-process crash.
    this.deadline = setTimeout(() => { try { this.child.kill(); } catch {} this.finish({ error: true }); }, this.limits.kill);
    try { this.child.kill(); } catch {}
  }
  cancel(force = false) {
    if (this.done) return this.result;
    if (this.cancelled && !force) return this.result;
    this.cancelled = true; clearTimeout(this.deadline);
    if (force) { try { this.child?.kill(); } catch {} this.finish({ cancelled: true }); }
    else { this.deadline = setTimeout(() => { try { this.child?.kill(); } catch {} this.finish({ cancelled: true }); }, this.limits.kill); this.write({ v: 1, id: this.request.id, command: "cancel" }); }
    return this.result;
  }
  finish(result) {
    if (this.done) return; this.done = true; clearTimeout(this.deadline);
    for (const [emitter, name, fn] of this.bindings) emitter.removeListener(name, fn);
    this.bindings = []; this.buffer = Buffer.alloc(0); this.resolve(result);
  }
}
const idle = () => ({ sessionId: null, phase: "idle", draft: "", incomplete: false, message: "" });
const unavailable = () => ({ status: "unavailable", recognition: { available: false, cultures: [] }, synthesis: { available: false, voices: [] }, message: UNAVAILABLE });
class VoiceService {
  constructor({ context, getState, inputAllowed, dataDir, prepare = () => prepareVoiceRuntime(dataDir), spawn = spawnProcess, platform = process.platform, windir = process.env.WINDIR, limits = {} }) {
    this.context = context; this.getState = getState; this.inputAllowed = inputAllowed; this.prepare = prepare; this.spawn = spawn; this.platform = platform; this.executable = windir && path.win32.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"); this.limits = { ...LIMITS, ...limits }; this.workers = new Set(); this.session = null; this.generation = 0; this.inputGeneration = 0; this.closed = false;
    this.preparations = new Set(); this.capabilityPending = null;
    this.unsubscribe = context.subscribe(() => this.invalidate());
  }
  valid(session) { return !this.closed && this.session === session && session.generation === this.generation && this.context.isCurrent(session.context) && (session.kind !== "listen" || session.inputGeneration === this.inputGeneration && this.inputAllowed()); }
  status(id) { if (!UUID.test(id)) throw Error("Invalid voice session."); const session = this.session; if (!session || session.status.sessionId !== id || !this.context.isCurrent(session.context)) return idle(); return structuredClone(session.status); }
  request(input, kind) {
    exact(input, kind === "listen" ? ["profileId", "culture"] : ["profileId", "text", "voiceId"]);
    if (input.profileId !== this.getState().activeProfileId) throw Error("Choose the current character before using voice.");
    if (input.profileId !== null) string(input.profileId, 100);
    const context = this.context.snapshot();
    if (this.closed || kind === "listen" && (context.view !== "ai" || !this.inputAllowed())) throw Error("Voice input requires the visible, focused companion.");
    if (kind === "listen") string(input.culture, 64); else { string(input.text, LIMITS.text); string(input.voiceId, 256); }
    const previous = [...this.workers].map(worker => worker.cancel());
    this.cancelPreparations();
    this.generation++;
    const session = { kind, context, generation: this.generation, inputGeneration: this.inputGeneration, status: { sessionId: randomUUID(), phase: "starting", draft: "", incomplete: false, message: "Preparing local speech…" } };
    this.session = session;
    void this.run(session, input, previous);
    return structuredClone(session.status);
  }
  start(input) { return this.request(input, "listen"); }
  speak(input) { return this.request(input, "speak"); }
  worker(helper, request, onEvent) {
    const worker = new VoiceWorker({ spawn: this.spawn, executable: this.executable, helper, request, limits: this.limits, onEvent });
    this.workers.add(worker); void worker.result.then(() => this.workers.delete(worker)); return worker;
  }
  async prepareBounded() {
    let timer, cancel;
    try { return await Promise.race([this.prepare(), new Promise((_, reject) => { cancel = () => reject(Error()); this.preparations.add(cancel); timer = setTimeout(cancel, this.limits.startup); })]); }
    finally { clearTimeout(timer); this.preparations.delete(cancel); }
  }
  cancelPreparations() { for (const cancel of this.preparations) cancel(); this.preparations.clear(); }
  supported() { return this.platform === "win32" && typeof this.executable === "string" && path.win32.isAbsolute(this.executable); }
  async discover(helper) {
    const worker = this.worker(helper, { v: 1, id: randomUUID(), command: "capabilities" });
    return (await worker.result).event;
  }
  async capabilities() {
    if (!this.capabilityPending) {
      const pending = this.readCapabilities(); this.capabilityPending = pending;
      void pending.finally(() => { if (this.capabilityPending === pending) this.capabilityPending = null; });
    }
    return structuredClone(await this.capabilityPending);
  }
  async readCapabilities() {
    const generation = this.generation;
    try {
      if (this.closed || !this.supported()) return unavailable();
      const helper = await this.prepareBounded(); if (this.closed || generation !== this.generation) return unavailable();
      const event = await this.discover(helper); if (this.closed || generation !== this.generation || event?.event !== "capabilities") return unavailable();
      return { status: event.recognizers.length || event.voices.length ? "available" : "unavailable", recognition: { available: !!event.recognizers.length, cultures: [...new Set(event.recognizers.map(r => r.culture))] }, synthesis: { available: !!event.voices.length, voices: structuredClone(event.voices) }, message: "Installed local engines only; microphone access and playback have not been tested." };
    } catch { return unavailable(); }
  }
  async run(session, input, previous) {
    try {
      await Promise.all(previous); if (!this.valid(session)) return;
      if (!this.supported()) throw Error();
      const helper = await this.prepareBounded(); if (!this.valid(session)) return;
      const capability = await this.discover(helper); if (!this.valid(session)) return;
      if (capability?.event !== "capabilities" || (session.kind === "listen" ? !capability.recognizers.some(r => r.culture === input.culture) : !capability.voices.some(v => v.id === input.voiceId))) throw Error();
      const request = { v: 1, id: session.status.sessionId, command: session.kind, ...(session.kind === "listen" ? { culture: input.culture } : { text: input.text, voiceId: input.voiceId }) };
      if (!this.valid(session)) return;
      session.worker = this.worker(helper, request, event => {
        if (!this.valid(session)) return;
        if (event.event === "started") { session.status.phase = session.kind === "listen" ? "listening" : "speaking"; session.status.message = session.kind === "listen" ? "Listening locally. Release to stop; review before sending." : "Reading locally. Stop is available."; }
        if (event.event === "hypothesis") session.status.draft = event.text;
      });
      const result = await session.worker.result; if (!this.valid(session)) return;
      if (result.event?.event === "completed") { session.status.phase = "stopped"; session.status.draft = result.event.text || ""; session.status.incomplete = false; session.status.message = session.kind === "listen" ? "Review the draft before sending." : "Reading finished."; }
      else { session.status.phase = result.event?.event === "unavailable" ? "unavailable" : "error"; session.status.draft = ""; session.status.message = FAILURE; }
    } catch { if (this.valid(session)) { session.status.phase = "unavailable"; session.status.message = UNAVAILABLE; } }
  }
  stop(id) {
    if (!UUID.test(id)) throw Error("Invalid voice session.");
    const session = this.session; if (!session || session.status.sessionId !== id || !this.context.isCurrent(session.context)) return idle();
    this.generation++;
    this.cancelPreparations();
    for (const worker of this.workers) void worker.cancel();
    if (["starting", "listening", "speaking"].includes(session.status.phase)) { session.status.phase = "stopped"; session.status.incomplete = session.kind === "listen"; session.status.message = session.kind === "listen" ? "Capture stopped. This draft may be incomplete; review before sending." : "Reading stopped."; }
    return structuredClone(session.status);
  }
  blur() { this.inputGeneration++; if (this.session?.kind === "listen") this.stop(this.session.status.sessionId); }
  cancel() {
    // Explicit release may arrive before the renderer receives its start ID.
    // Return the same bounded incomplete draft; context invalidation discards it.
    if (this.session && this.context.isCurrent(this.session.context)) return this.stop(this.session.status.sessionId);
    return this.invalidate();
  }
  invalidate() { this.generation++; this.inputGeneration++; this.session = null; this.cancelPreparations(); for (const worker of this.workers) void worker.cancel(); return idle(); }
  close() { this.closed = true; this.invalidate(); this.unsubscribe?.(); for (const worker of this.workers) void worker.cancel(true); }
}
module.exports = { VoiceService, LIMITS };
