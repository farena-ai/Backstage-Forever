"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { EventEmitter } = require("node:events"), { PassThrough } = require("node:stream");
const { CompanionContext } = require("../src/core/companion-context.cjs");
const api = (() => { try { return require("../src/core/voice.cjs"); } catch { return {}; } })();
const tick = () => new Promise(r => setImmediate(r));
const caps = { recognizers: [{ id: "MS-1033-80-DESK", culture: "en-US", name: "Microsoft English" }], voices: [{ id: "Microsoft David Desktop", culture: "en-US", name: "Microsoft David Desktop" }] };
function fixture(options = {}) {
  assert.equal(typeof api.VoiceService, "function", "VoiceService must exist");
  let state = { activeProfileId: "Alpha", profiles: [{ id: "Alpha" }], provider: { id: "ollama" } }, focused = true;
  const context = new CompanionContext(() => state); context.notify({ profileId: "Alpha", view: "ai" });
  const children = [], commands = [];
  const spawn = (...args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.args = args; child.killed = false;
    child.on("exit", code => options.delayedClose ? setTimeout(() => child.emit("close", code), 5) : queueMicrotask(() => child.emit("close", code)));
    child.kill = () => { child.killed = true; child.killCalls = (child.killCalls || 0) + 1; if (options.killMode === "false") return false; if (options.killMode === "throw") throw Error("Fixture kill denied"); if (options.killMode === "unclosed") return true; child.emit("exit", null, "SIGTERM"); return true; };
    child.send = obj => child.stdout.write(JSON.stringify({ v: 1, id: child.id, ...obj }) + "\n");
    child.stdin.on("data", raw => { const command = JSON.parse(String(raw)); child.id = command.id; commands.push(command); if (command.command === "capabilities" && !options.holdProbe) queueMicrotask(() => { child.send({ event: "capabilities", ...caps }); child.emit("exit", 0); }); if (["listen", "speak"].includes(command.command) && !options.holdStart) queueMicrotask(() => child.send({ event: "started" })); if (command.command === "cancel" && !options.ignoreCancel) queueMicrotask(() => child.emit("exit", 0)); });
    children.push(child); return child;
  };
  const service = new api.VoiceService({ context, getState: () => state, inputAllowed: () => focused, prepare: options.prepare || (async () => "C:\\owned\\voice-helper.ps1"), spawn, platform: "win32", windir: "C:\\Windows", limits: { startup: 80, listen: 100, speak: 150, kill: 10, ...options.limits } });
  return { service, context, children, commands, blur() { focused = false; service.blur(); }, setState(next) { state = next; context.sync(); } };
}
test("local voice is implemented as a bounded service", () => { const f = fixture(); f.service.close(); });
test("start returns a session before asynchronous preparation and release prevents late listen", async () => {
  let release; const f = fixture({ prepare: () => new Promise(r => release = r) });
  try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); assert.equal(s.phase, "starting"); assert.ok(s.sessionId); await tick(); assert.equal(typeof release, "function"); const stopped = f.service.stop(s.sessionId); assert.equal(stopped.phase, "stopped"); release("C:\\owned\\voice-helper.ps1"); await tick(); assert.equal(f.commands.some(c => c.command === "listen"), false); } finally { f.service.close(); }
});
test("stop keeps only emitted draft, marks incomplete, and cannot reactivate audio", async () => {
  const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); child.send({ event: "hypothesis", text: "Where is Stormwind" }); assert.equal(f.service.status(s.sessionId).draft, "Where is Stormwind"); const stopped = f.service.stop(s.sessionId); assert.equal(stopped.incomplete, true); assert.equal(stopped.draft, "Where is Stormwind"); child.send({ event: "completed", text: "late text" }); assert.equal(f.service.status(s.sessionId).draft, stopped.draft); await tick(); assert.ok(f.commands.some(c => c.command === "cancel")); } finally { f.service.close(); }
});
test("blur cancels pending input but keeps explicit speech and context generation", async () => {
  const f = fixture(); try { const s = f.service.speak({ profileId: "Alpha", text: "Quest facts", voiceId: caps.voices[0].id }); await tick(); await tick(); const generation = f.context.snapshot().generation; f.blur(); assert.equal(f.service.status(s.sessionId).phase, "speaking"); assert.equal(f.context.snapshot().generation, generation); assert.throws(() => f.service.start({ profileId: "Alpha", culture: "en-US" })); } finally { f.service.close(); }
});
test("context invalidation removes old transcript and forces worker termination", async () => {
  const f = fixture({ ignoreCancel: true }); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); child.send({ event: "hypothesis", text: "old character" }); f.context.invalidate("source-root"); assert.equal(f.service.status(s.sessionId).draft, ""); await new Promise(r => setTimeout(r, 25)); assert.equal(child.killed, true); } finally { f.service.close(); }
});
test("strict requests, selected-profile binding and null only without active profile", async () => {
  const f = fixture(); try { for (const input of [{ profileId: null, culture: "en-US" }, { profileId: "Alpha", culture: "en-US", extra: true }]) assert.throws(() => f.service.start(input)); assert.throws(() => f.service.speak({ profileId: "Alpha", text: "x".repeat(4001), voiceId: "v" })); f.setState({ activeProfileId: null, profiles: [], provider: { id: "ollama" } }); f.context.notify({ profileId: null, view: "ai" }); assert.equal(f.service.start({ profileId: null, culture: "en-US" }).phase, "starting"); } finally { f.service.close(); }
});
test("protocol errors, oversized output, EOF and timeout are bounded without raw error disclosure", async () => {
  for (const damage of [c => c.send({ event: "unknown" }), c => c.send({ event: "hypothesis", text: "x".repeat(4001) }), c => c.stdout.write("x".repeat(32769)), c => c.stderr.write("x".repeat(16385)), c => c.send({ id: "foreign", event: "started" }), c => c.emit("exit", 1), c => c.stdout.end(), c => c.send({ event: "hypothesis", text: "private", extra: true })]) {
    const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); damage(f.children.at(-1)); await tick(); assert.equal(f.service.status(s.sessionId).phase, "error"); assert.equal(f.service.status(s.sessionId).draft, ""); assert.doesNotMatch(f.service.status(s.sessionId).message, /private|foreign/); } finally { f.service.close(); }
  }
});
test("capabilities are detached and enumerate without audio, fixed launcher has no input text", async () => {
  const f = fixture(); try { const result = await f.service.capabilities(); assert.equal(result.recognition.available, true); result.recognition.cultures[0] = "changed"; assert.equal((await f.service.capabilities()).recognition.cultures[0], "en-US"); assert.ok(f.commands.every(c => c.command === "capabilities")); const [exe, args, opts] = f.children[0].args; assert.equal(exe, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"); assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true); assert.ok(!args.join(" ").includes("ExecutionPolicy")); } finally { f.service.close(); }
});
test("duplicate terminal, invalid UTF8 and aggregate output fail closed", async () => {
  for (const damage of [c => { c.send({ event: "completed", text: "first" }); c.send({ event: "completed", text: "second" }); }, c => c.stdout.write(Buffer.from([0xff, 10])), c => { for (let i = 0; i < 40; i++) c.send({ event: "hypothesis", text: "x".repeat(4000) }); }]) {
    const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); damage(f.children.at(-1)); await tick(); assert.equal(f.service.status(s.sessionId).phase, "error"); } finally { f.service.close(); }
  }
});
test("input waits for the previous speech worker to exit or be killed", async () => {
  const f = fixture({ ignoreCancel: true }); try { f.service.speak({ profileId: "Alpha", voiceId: caps.voices[0].id, text: "Plain text <speak> is not SSML" }); await tick(); await tick(); const speech = f.children.at(-1); const next = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); assert.equal(f.commands.some(c => c.command === "listen"), false); await new Promise(r => setTimeout(r, 25)); assert.equal(speech.killed, true); assert.equal(f.service.status(next.sessionId).phase, "listening"); } finally { f.service.close(); }
});
test("startup/probe/audio deadlines and quit terminate owned workers", async () => {
  for (const options of [{ holdProbe: true }, { holdStart: true }, { limits: { listen: 20 } }]) {
    const f = fixture(options); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await new Promise(r => setTimeout(r, 105)); assert.ok(["error", "unavailable"].includes(f.service.status(s.sessionId).phase)); assert.equal(f.children.at(-1).killed, true); } finally { f.service.close(); }
  }
  const f = fixture({ ignoreCancel: true }); f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); f.service.close(); assert.equal(child.killed, true); assert.equal(f.service.workers.size, 1); await tick(); assert.equal(f.service.workers.size, 0);
});
test("blur during a held probe prevents late input, while other views permit explicit reading", async () => {
  const f = fixture({ holdProbe: true }); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); f.blur(); f.children[0].send({ event: "capabilities", ...caps }); f.children[0].emit("exit", 0); await tick(); assert.equal(f.service.status(s.sessionId).phase, "stopped"); assert.equal(f.commands.some(c => c.command === "listen"), false); f.context.notify({ profileId: "Alpha", view: "other" }); assert.equal(f.service.speak({ profileId: "Alpha", text: "Reviewed public plan", voiceId: caps.voices[0].id }).phase, "starting"); } finally { f.service.close(); }
});
test("duplicate JSON keys and unapproved engine metadata are rejected", async () => {
  const f = fixture({ holdProbe: true }); try { const pending = f.service.capabilities(); await tick(); const child = f.children[0]; child.stdout.write('{"v":1,"id":"' + child.id + '","event":"unavailable","event":"capabilities","recognizers":[],"voices":[]}\n'); child.emit("exit", 0); assert.equal((await pending).status, "unavailable"); } finally { f.service.close(); }
  const g = fixture({ holdProbe: true }); try { const pending = g.service.capabilities(); await tick(); const child = g.children[0]; child.send({ event: "capabilities", recognizers: [{ id: "CLOUD-ENGINE", culture: "en-US", name: "Unknown vendor" }], voices: [] }); child.emit("exit", 0); assert.equal((await pending).status, "unavailable"); } finally { g.service.close(); }
});
test("completion waits for stream closure and rejects trailing non-protocol data", async () => {
  const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); child.send({ event: "completed", text: "complete" }); child.stdout.write("trailing junk"); child.emit("exit", 0); await tick(); assert.equal(f.service.status(s.sessionId).phase, "error"); } finally { f.service.close(); }
});
test("capability polling shares one probe and cancellation settles held preparation", async () => {
  const f = fixture({ holdProbe: true }); try { const one = f.service.capabilities(), two = f.service.capabilities(); await tick(); assert.equal(f.children.length, 1); f.service.cancel(); assert.equal((await one).status, "unavailable"); assert.equal((await two).status, "unavailable"); } finally { f.service.close(); }
});
test("repeated cancellation cannot flood stdin or postpone the kill deadline", async () => {
  const f = fixture({ ignoreCancel: true }); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); for (let i = 0; i < 20; i++) f.service.stop(s.sessionId); assert.equal(f.commands.filter(c => c.command === "cancel" && c.id === s.sessionId).length, 1); await new Promise(r => setTimeout(r, 25)); assert.equal(child.killed, true); } finally { f.service.close(); }
});
test("errors and completion release every owned worker listener and lifetime timer", async () => {
  const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const child = f.children.at(-1); child.send({ event: "completed", text: "Reviewed text" }); child.emit("exit", 0); await tick(); assert.equal(f.service.status(s.sessionId).phase, "stopped"); assert.equal(f.service.workers.size, 0); for (const stream of [child.stdin, child.stdout, child.stderr]) { assert.equal(stream.listenerCount("error"), 0); assert.equal(stream.listenerCount("data"), stream === child.stdin ? 1 : 0); } assert.equal(child.listenerCount("close"), 0); } finally { f.service.close(); }
});
test("spawn/preparation failures and unsupported hosts remain typed-only", async () => {
  for (const mode of ["spawn", "prepare", "platform"]) { const f = fixture(); try { if (mode === "spawn") f.service.spawn = () => { throw Error("private host path"); }; if (mode === "prepare") f.service.prepare = async () => { throw Error("private runtime path"); }; if (mode === "platform") f.service.platform = "linux"; const result = await f.service.capabilities(); assert.equal(result.status, "unavailable"); assert.doesNotMatch(result.message, /private/); assert.equal(f.service.workers.size, 0); } finally { f.service.close(); } }
});
test("cancel settles pending preparation immediately and stale stop cannot cancel a new session", async () => {
  let release; const f = fixture({ prepare: () => new Promise(resolve => release = resolve) });
  try { const pending = f.service.capabilities(); await tick(); f.service.cancel(); assert.equal((await pending).status, "unavailable"); assert.equal(f.service.preparations.size, 0); release("C:\\owned\\voice-helper.ps1"); await tick(); assert.equal(f.children.length, 0); f.service.prepare = async () => "C:\\owned\\voice-helper.ps1"; const first = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); const second = f.service.speak({ profileId: "Alpha", text: "Current reading", voiceId: caps.voices[0].id }); assert.equal(f.service.stop(first.sessionId).phase, "idle"); await tick(); await tick(); assert.equal(f.service.status(second.sessionId).phase, "speaking"); } finally { f.service.close(); }
});
test("explicit cancel before the renderer receives a start acknowledgement preserves emitted incomplete input", async () => {
  const f = fixture(); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); f.children.at(-1).send({ event: "hypothesis", text: "Keep the partial question" }); const result = f.service.cancel(); assert.equal(result.sessionId, s.sessionId); assert.equal(result.draft, "Keep the partial question"); assert.equal(result.incomplete, true); f.context.invalidate("navigation"); assert.equal(f.service.status(s.sessionId).draft, ""); } finally { f.service.close(); }
});
test("protocol failure retains pipe error protection until the terminated child closes", async () => {
  const f = fixture({ delayedClose: true }); try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await new Promise(r => setTimeout(r, 15)); const child = f.children.at(-1); child.stdout.write("bad json\n"); assert.equal(child.stdin.listenerCount("error"), 1); assert.doesNotThrow(() => child.stdin.emit("error", Error("EPIPE fixture"))); await new Promise(r => setTimeout(r, 20)); assert.equal(f.service.status(s.sessionId).phase, "error"); assert.equal(child.stdin.listenerCount("error"), 0); } finally { f.service.close(); }
});
test("unconfirmed termination retains ownership and rejects replacement audio after the fixed deadline", async () => {
  for (const killMode of ["false", "throw", "unclosed"]) for (const failure of [false, true]) {
    const f = fixture({ ignoreCancel: true, killMode }); let old;
    try {
      const first = f.service.speak({ profileId: "Alpha", text: "Current reading", voiceId: caps.voices[0].id }); await tick(); await tick(); old = f.children.at(-1);
      if (failure) old.stdout.write("bad json\n"); else f.service.stop(first.sessionId);
      await new Promise(r => setTimeout(r, 25));
      assert.equal(f.service.workers.size, 1, "Unclosed process remains owned after the kill deadline");
      assert.equal(old.stdin.listenerCount("error"), 1); assert.doesNotThrow(() => old.stdin.emit("error", Error("Late EPIPE fixture")));
      assert.equal(f.service.status(first.sessionId).phase, "error"); assert.match(f.service.status(first.sessionId).message, /confirm|blocked/i);
      const replacement = f.service.start({ profileId: "Alpha", culture: "en-US" }); await new Promise(r => setTimeout(r, 25));
      assert.equal(f.service.status(replacement.sessionId).phase, "unavailable", "Replacement must settle boundedly without waiting forever");
      assert.equal(f.commands.filter(c => c.command === "listen").length, 0); assert.equal(f.children.length, 2);
      const kills = old.killCalls; f.service.close(); assert.ok(old.killCalls > kills, "Quit retries every unconfirmed owned worker");
      assert.equal(f.service.workers.size, 1); assert.doesNotThrow(() => old.stderr.emit("error", Error("Late pipe failure")));
      old.emit("close", null); await tick(); assert.equal(f.service.workers.size, 0); assert.equal(old.stdin.listenerCount("error"), 0);
    } finally { old?.emit("close", null); f.service.close(); }
  }
});
test("late close after an unconfirmed deadline never resumes rejected input automatically", async () => {
  const f = fixture({ ignoreCancel: true, killMode: "unclosed" }); let old;
  try {
    f.service.speak({ profileId: "Alpha", text: "Current reading", voiceId: caps.voices[0].id }); await tick(); await tick(); old = f.children.at(-1);
    const replacement = f.service.start({ profileId: "Alpha", culture: "en-US" }); await new Promise(r => setTimeout(r, 25));
    assert.equal(f.service.status(replacement.sessionId).phase, "unavailable"); assert.equal(f.commands.some(c => c.command === "listen"), false);
    old.emit("close", null); await tick(); assert.equal(f.service.workers.size, 0); assert.equal(f.service.status(replacement.sessionId).phase, "unavailable");
    f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); assert.equal(f.commands.filter(c => c.command === "listen").length, 1);
  } finally { old?.emit("close", null); for (const child of f.children) child.emit("close", null); f.service.close(); }
});
test("capability diagnostic cannot claim native boot after a bootstrap failure", async () => {
  const { probeCapabilities } = require("../scripts/voice-backend-smoke.cjs"); assert.equal(typeof probeCapabilities, "function", "Diagnostic evidence gate must exist");
  const f = fixture(); try { f.service.spawn = () => { throw Error("Fixture compiler/bootstrap failure"); }; assert.equal((await f.service.capabilities()).status, "unavailable"); await assert.rejects(() => probeCapabilities(f.service), /boot.*unproven/i); } finally { f.service.close(); }
  const g = fixture({ holdProbe: true }); try { const pending = probeCapabilities(g.service); await tick(); g.children[0].stderr.write("fixture compiler failure"); g.children[0].emit("close", 1); await assert.rejects(() => pending, /boot.*unproven/i); } finally { g.service.close(); }
});
test("capability diagnostic accepts only validated native terminal evidence with confirmed disposal", async () => {
  const { probeCapabilities } = require("../scripts/voice-backend-smoke.cjs");
  const f = fixture(); try { const evidence = await probeCapabilities(f.service); assert.equal(evidence.terminal, "capabilities"); assert.equal(evidence.result.status, "available"); } finally { f.service.close(); }
  const g = fixture({ holdProbe: true }); try { const pending = probeCapabilities(g.service); await tick(); g.children[0].send({ event: "unavailable", code: "engine" }); g.children[0].emit("close", 0); const evidence = await pending; assert.equal(evidence.terminal, "unavailable"); assert.equal(evidence.result.status, "unavailable"); } finally { g.service.close(); }
});
test("stop acknowledges cancellation without claiming unconfirmed native input has stopped", async () => {
  const f = fixture({ ignoreCancel: true, killMode: "false" }); let child;
  try { const s = f.service.start({ profileId: "Alpha", culture: "en-US" }); await tick(); await tick(); child = f.children.at(-1); child.send({ event: "hypothesis", text: "Preserve draft" }); const stopped = f.service.stop(s.sessionId); assert.match(stopped.message, /Stopping/); assert.equal(stopped.incomplete, true); await new Promise(r => setTimeout(r, 25)); assert.equal(f.service.status(s.sessionId).phase, "error"); assert.equal(f.service.status(s.sessionId).draft, "Preserve draft"); } finally { child?.emit("close", null); f.service.close(); }
});
