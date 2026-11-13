"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { LocalAi, ENGINE, MODELS, recommend } = require("../src/core/local-ai.cjs");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function setup({ vulkanWorks = true, corrupt = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-local-ai-"));
  const files = { vulkan: Buffer.from("vulkan-zip"), cpu: Buffer.from("cpu-zip"), model: Buffer.alloc(5000, 7) };
  const engine = { build: "b1", vulkan: { file: "v.zip", size: files.vulkan.length, sha256: sha(files.vulkan), url: "https://x/v.zip" }, cpu: { file: "c.zip", size: files.cpu.length, sha256: sha(files.cpu), url: "https://x/c.zip" } };
  const models = { light: { name: "Tiny", license: "Apache-2.0", file: "m.gguf", size: files.model.length, sha256: corrupt ? "0".repeat(64) : sha(files.model), url: "https://x/m.gguf", minRamGB: 4 } };
  const calls = { fetch: [], spawn: [] };
  let serving = false;
  const fetcher = async (url, opts = {}) => {
    calls.fetch.push({ url, range: opts.headers?.Range || null });
    if (url.endsWith("/health")) { if (serving) return { ok: true }; throw Error("down"); }
    const body = url.endsWith("v.zip") ? files.vulkan : url.endsWith("c.zip") ? files.cpu : files.model;
    const from = opts.headers?.Range ? Number(/bytes=(\d+)-/.exec(opts.headers.Range)[1]) : 0;
    const part = body.subarray(from);
    return { ok: true, status: from ? 206 : 200, body: (async function* () { yield part.subarray(0, Math.ceil(part.length / 2)); yield part.subarray(Math.ceil(part.length / 2)); })() };
  };
  const spawn = (cmd, args, opts) => {
    calls.spawn.push({ cmd, args });
    const p = new EventEmitter(); p.kill = () => { serving = false; p.emit("exit", 0); };
    if (cmd === "tar.exe") {
      // Simulate unpacking: put llama-server.exe in the target folder.
      const target = args[args.indexOf("-C") + 1]; fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "llama-server.exe"), "exe");
      setImmediate(() => p.emit("exit", 0));
    } else if (cmd.includes("-vulkan")) { if (vulkanWorks) serving = true; else setTimeout(() => p.emit("exit", 1), 20); }
    else serving = true;
    return p;
  };
  const ai = new LocalAi({ dir, platform: "win32", fetcher, spawn, engine, models, ramGB: 8, startTimeoutMs: 3000 });
  return { ai, dir, calls, files };
}

test("the pinned catalog is complete: exact versions, sizes and SHA-256 sums, Apache-2.0 models", () => {
  for (const v of ["vulkan", "cpu"]) { assert.match(ENGINE[v].sha256, /^[0-9a-f]{64}$/); assert.ok(ENGINE[v].url.includes(`/download/${ENGINE.build}/`)); }
  for (const m of Object.values(MODELS)) { assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.match(m.url, /\/resolve\/[0-9a-f]{40}\//, "model pinned to a commit"); assert.equal(m.license, "Apache-2.0"); }
  assert.equal(recommend(16), "standard"); assert.equal(recommend(8), "light"); assert.equal(recommend(4), "cloud");
});
test("one click installs the engine and model, verifies both, starts on localhost and reports ready", async () => {
  const { ai, dir, calls } = setup();
  const s = await ai.install("light");
  assert.equal(s.installed, true); assert.equal(s.running, true); assert.equal(s.tier, "light");
  assert.equal(s.endpoint, "http://127.0.0.1:41234");
  const server = calls.spawn.find((c) => c.cmd.endsWith("llama-server.exe"));
  assert.ok(server.args.includes("127.0.0.1") && server.args.includes("--jinja"));
  assert.ok(!fs.existsSync(path.join(dir, "downloads", "v.zip")), "the zip is cleaned up");
  const removed = await ai.remove();
  assert.equal(removed.installed, false); assert.ok(!fs.existsSync(dir), "Remove frees the disk space");
});
test("no usable graphics driver: falls back to the processor build", async () => {
  const { ai, calls } = setup({ vulkanWorks: false });
  const s = await ai.install("light");
  assert.equal(s.running, true); assert.match(s.engine, /processor/);
  assert.ok(calls.fetch.some((f) => f.url.endsWith("c.zip")));
  await ai.stop();
});
test("a download that doesn't match its checksum is deleted and never used", async () => {
  const { ai, dir } = setup({ corrupt: true });
  await assert.rejects(ai.install("light"), /didn't match its checksum/);
  assert.ok(!fs.existsSync(path.join(dir, "models", "m.gguf")) && !fs.existsSync(path.join(dir, "models", "m.gguf.part")));
  assert.match(ai.status().error, /checksum/);
});
test("an interrupted download resumes where it left off", async () => {
  const { ai, dir, calls, files } = setup();
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  fs.writeFileSync(path.join(dir, "models", "m.gguf.part"), files.model.subarray(0, 1200));
  await ai.install("light");
  assert.ok(calls.fetch.some((f) => f.url.endsWith("m.gguf") && f.range === "bytes=1200-"));
  await ai.stop();
});
test("other platforms are told plainly", async () => {
  const ai = new LocalAi({ dir: path.join(os.tmpdir(), "nope"), platform: "darwin" });
  assert.equal(ai.status().supported, false);
  await assert.rejects(ai.install(), /Windows/);
});
