"use strict";
// Free AI on this PC: one click downloads a pinned llama.cpp server build and a small open model,
// checks both against pinned SHA-256 sums, and runs the server on 127.0.0.1 only. Nothing leaves
// the PC after the download, and Remove deletes everything it added.
const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const crypto = require("node:crypto"), childProcess = require("node:child_process");

const PORT = 41234;
const ENGINE = {
  build: "b11856",
  vulkan: { file: "llama-b11856-bin-win-vulkan-x64.zip", size: 36970834, sha256: "09e9640df272f20dfe5d0dcc97294c44804d6a6a7dd6ef76c0030bd04fb6f4f0", url: "https://github.com/ggml-org/llama.cpp/releases/download/b11856/llama-b11856-bin-win-vulkan-x64.zip" },
  cpu: { file: "llama-b11856-bin-win-cpu-x64.zip", size: 24173159, sha256: "b0be608ec81c811029406430796dfcd16b8d83dc152705a6682f0d47834a2f3b", url: "https://github.com/ggml-org/llama.cpp/releases/download/b11856/llama-b11856-bin-win-cpu-x64.zip" },
};
const MODELS = {
  standard: { name: "Qwen3 4B Instruct", license: "Apache-2.0", file: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", size: 2497281120, sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597", url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf", minRamGB: 8 },
  light: { name: "Qwen2.5 1.5B Instruct", license: "Apache-2.0", file: "qwen2.5-1.5b-instruct-q4_k_m.gguf", size: 1117320736, sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e", url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf", minRamGB: 4 },
};

/** Which model suits this PC: standard with 12 GB+ RAM, light with 6 GB+, otherwise the free cloud option. */
function recommend(ramGB = os.totalmem() / 2 ** 30) {
  return ramGB >= 12 ? "standard" : ramGB >= 6 ? "light" : "cloud";
}

class LocalAi {
  constructor({ dir, platform = process.platform, fetcher = fetch, spawn = childProcess.spawn, onChange = () => {}, engine = ENGINE, models = MODELS, ramGB = os.totalmem() / 2 ** 30, startTimeoutMs = 90000 } = {}) {
    Object.assign(this, { dir, platform, fetcher, spawn, onChange, engine, models, ramGB, startTimeoutMs });
    this.proc = null; this.task = null; this.progress = null; this.error = null; this.ready = false;
  }
  file(...p) { return path.join(this.dir, ...p); }
  settings() { try { return JSON.parse(fs.readFileSync(this.file("local-ai.json"), "utf8")); } catch { return {}; } }
  saveSettings(s) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.file("local-ai.json"), JSON.stringify(s)); }
  enginePath(variant) { return this.file(`engine-${this.engine.build}-${variant}`, "llama-server.exe"); }
  installed() {
    const s = this.settings(), m = this.models[s.tier];
    return Boolean(m && s.variant && fs.existsSync(this.enginePath(s.variant)) && fs.existsSync(this.file("models", m.file)));
  }
  status() {
    const s = this.settings(), m = this.models[s.tier];
    return {
      supported: this.platform === "win32",
      installed: this.installed(), running: Boolean(this.proc) && this.ready, starting: Boolean(this.proc) && !this.ready,
      tier: s.tier || null, model: m ? { name: m.name, license: m.license, sizeGB: +(m.size / 2 ** 30).toFixed(1) } : null,
      engine: s.variant ? `llama.cpp ${this.engine.build} (${s.variant === "vulkan" ? "graphics card" : "processor"})` : null,
      busy: Boolean(this.task), progress: this.progress, error: this.error,
      recommended: recommend(this.ramGB), ramGB: Math.round(this.ramGB),
      choices: Object.fromEntries(Object.entries(this.models).map(([k, v]) => [k, { name: v.name, sizeGB: +(v.size / 2 ** 30).toFixed(1), minRamGB: v.minRamGB }])),
      endpoint: `http://127.0.0.1:${PORT}`,
    };
  }
  emit() { try { this.onChange(this.status()); } catch {} }

  // Download with resume, then verify the pinned SHA-256 before anything is used.
  async download(item, dest, label) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const part = dest + ".part";
    let have = 0;
    try { have = (await fsp.stat(part)).size; } catch {}
    if (have > item.size) { await fsp.rm(part, { force: true }); have = 0; }
    if (have < item.size) {
      const res = await this.fetcher(item.url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: "follow" });
      if (!res.ok && res.status !== 206) throw Error(`Download failed (${res.status}).`);
      if (have && res.status !== 206) { have = 0; await fsp.rm(part, { force: true }); }
      const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
      let got = have, last = 0;
      try {
        for await (const chunk of res.body) {
          if (this.cancelled) throw Error("cancelled");
          if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
          got += chunk.byteLength;
          if (got > item.size) throw Error("The download is larger than expected.");
          if (Date.now() - last > 250) { last = Date.now(); this.progress = { label, received: got, total: item.size }; this.emit(); }
        }
      } finally { await new Promise((r) => out.end(r)); }
    }
    this.progress = { label: `Checking ${label}`, received: item.size, total: item.size }; this.emit();
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(part)) hash.update(chunk);
    if (hash.digest("hex") !== item.sha256) { await fsp.rm(part, { force: true }); throw Error(`${label} didn't match its checksum and was deleted. Try again.`); }
    await fsp.rename(part, dest);
  }
  async installEngine(variant) {
    const item = this.engine[variant], zip = this.file("downloads", item.file), target = path.dirname(this.enginePath(variant));
    if (fs.existsSync(this.enginePath(variant))) return;
    await this.download(item, zip, "the AI engine");
    await fsp.mkdir(target, { recursive: true });
    // Windows 10+ ships tar.exe, which extracts zip archives.
    await new Promise((resolve, reject) => {
      const p = this.spawn("tar.exe", ["-xf", zip, "-C", target], { windowsHide: true });
      p.on("error", reject); p.on("exit", (code) => (code === 0 ? resolve() : reject(Error("Couldn't unpack the AI engine."))));
    });
    await fsp.rm(zip, { force: true });
    if (!fs.existsSync(this.enginePath(variant))) throw Error("The AI engine download was incomplete.");
  }
  /** One click: engine (graphics-card build, processor build as fallback) + model, then start. */
  install(tier = recommend(this.ramGB)) {
    if (this.platform !== "win32") return Promise.reject(Error("The built-in AI is available on Windows."));
    if (!this.models[tier]) tier = "light";
    if (this.task) return this.task;
    this.cancelled = false; this.error = null;
    this.task = (async () => {
      try {
        const m = this.models[tier];
        await this.installEngine("vulkan");
        if (!fs.existsSync(this.file("models", m.file))) await this.download(m, this.file("models", m.file), `the ${m.name} model`);
        this.saveSettings({ ...this.settings(), tier, variant: "vulkan" });
        this.progress = { label: "Starting", received: 1, total: 1 }; this.emit();
        try { await this.start(); }
        catch {
          // No usable graphics driver: the processor build always works.
          await this.stop(); await this.installEngine("cpu");
          this.saveSettings({ ...this.settings(), variant: "cpu" });
          await this.start();
        }
        this.progress = null;
        return this.status();
      } catch (e) { this.error = e.message === "cancelled" ? "Download stopped. Click again to continue where it left off." : e.message; this.progress = null; throw e; }
      finally { this.task = null; this.emit(); }
    })();
    this.emit();
    return this.task;
  }
  cancel() { this.cancelled = true; }
  async start() {
    if (this.proc && this.ready) return this.status().endpoint;
    if (!this.installed()) throw Error("Turn on the free AI first.");
    if (!this.proc) {
      const s = this.settings(), m = this.models[s.tier];
      const args = ["-m", this.file("models", m.file), "--host", "127.0.0.1", "--port", String(PORT), "-c", "8192", "--jinja", "--no-webui"];
      if (s.variant === "vulkan") args.push("-ngl", "99");
      this.ready = false;
      this.proc = this.spawn(this.enginePath(s.variant), args, { windowsHide: true, stdio: "ignore", cwd: path.dirname(this.enginePath(s.variant)) });
      this.proc.on("exit", () => { this.proc = null; this.ready = false; this.emit(); });
      this.proc.on("error", () => { this.proc = null; this.ready = false; });
    }
    const until = Date.now() + this.startTimeoutMs;
    while (Date.now() < until) {
      if (!this.proc) throw Error("The AI engine stopped while starting.");
      try { const r = await this.fetcher(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { this.ready = true; this.emit(); return this.status().endpoint; } } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error("The AI engine didn't start in time.");
  }
  async stop() {
    const p = this.proc; this.proc = null; this.ready = false;
    if (p) { try { p.kill(); } catch {} await new Promise((r) => setTimeout(r, 300)); }
    this.emit();
  }
  /** Removes the engine, models and downloads (frees the disk space). */
  async remove() {
    this.cancel(); await this.stop();
    await fsp.rm(this.dir, { recursive: true, force: true });
    this.error = null; this.progress = null; this.emit();
    return this.status();
  }
}
module.exports = { LocalAi, ENGINE, MODELS, PORT, recommend };
