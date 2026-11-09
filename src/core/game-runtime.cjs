"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const childProcess = require("node:child_process");
const CACHE_MS = 15000;
// Query only the path of Wow.exe; inaccessible paths remain unknown. No privilege changes.
const SCRIPT = "$ErrorActionPreference='Stop'; $paths=@(Get-CimInstance -ClassName Win32_Process -Filter \"Name = 'Wow.exe'\" -Property ExecutablePath | Select-Object -First 65 | ForEach-Object { $_.ExecutablePath }); ConvertTo-Json -InputObject $paths -Compress";
async function safe(target, kind) {
  if (typeof target !== "string" || !path.isAbsolute(target) || target.length > 1000 || /[\x00-\x1f]/.test(target)) throw Error("Invalid path");
  const absolute = path.resolve(target), base = path.parse(absolute).root;
  let current = base;
  for (const part of absolute.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Unsafe path");
  }
  const stat = await fs.lstat(absolute);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) throw Error("Invalid path");
  return fs.realpath(absolute);
}
async function executable(root) {
  root = await safe(root, "dir");
  await safe(path.join(root, "WTF"), "dir");
  const flavor = path.join(root, ".flavor.info");
  await safe(flavor, "file");
  if ((await fs.stat(flavor)).size > 4096 || !/\bwowf\b/i.test(await fs.readFile(flavor, "utf8"))) throw Error("Not Forever");
  return safe(path.join(root, "Wow.exe"), "file");
}
const result = (state, message) => ({ state, message });
class GameRuntime {
  constructor({ platform = process.platform, execFile = childProcess.execFile, spawn = childProcess.spawn, now = Date.now } = {}) {
    Object.assign(this, { platform, execFile, spawn, now });
    this.cache = new Map();
    this.launches = new Map();
    this.requests = new Map();
  }
  async probe(root) {
    if (this.platform !== "win32" || !root) return { state: "unknown", checkedAt: null, launchAvailable: false };
    const key = String(root).toLowerCase(), cached = this.cache.get(key);
    if (cached && this.now() - cached.time < CACHE_MS) return structuredClone(await cached.pending);
    const entry = { time: Infinity, pending: null };
    entry.pending = this._probe(root).finally(() => { entry.time = this.now(); });
    this.cache.set(key, entry);
    // Keep only a small local cache. Failures use the same minimum interval.
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    return structuredClone(await entry.pending);
  }
  async _probe(root) {
    let target;
    const answer = { state: "unknown", checkedAt: new Date(this.now()).toISOString(), launchAvailable: false };
    try { target = await executable(root); answer.launchAvailable = true; } catch { return answer; }
    try {
      const stdout = await new Promise((resolve, reject) => this.execFile(
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
        { windowsHide: true, timeout: 3000, maxBuffer: 16384, encoding: "utf8" },
        (error, output) => error ? reject(error) : resolve(output),
      ));
      if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 16384) return answer;
      const paths = JSON.parse(stdout);
      if (!Array.isArray(paths) || paths.length > 64) return answer;
      let unknown = false;
      for (const candidate of paths) {
        if (typeof candidate !== "string" || candidate.length > 1000 || !path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== "wow.exe") { unknown = true; continue; }
        try {
          const canonical = await fs.realpath(candidate);
          if (canonical.toLowerCase() === target.toLowerCase()) return { ...answer, state: "running" };
        } catch { unknown = true; }
      }
      return { ...answer, state: unknown ? "unknown" : "not-running" };
    } catch { return answer; }
  }
  async launch(root, cancelled = () => false) {
    if (cancelled()) return result("cancelled", "Opening Forever was cancelled.");
    const key = String(root).toLowerCase();
    if (this.launches.has(key)) return this.launches.get(key);
    if (this.requests.has(key) && this.now() - this.requests.get(key) < CACHE_MS) return result("requested", "Forever launch requested. Use the normal game sign-in.");
    const pending = this._launch(root, cancelled).finally(() => this.launches.delete(key));
    this.launches.set(key, pending);
    return pending;
  }
  async _launch(root, cancelled) {
    if (this.platform !== "win32" || !root) return result("unavailable", "Open Forever with your usual launcher.");
    try {
      await executable(root);
      const status = await this.probe(root);
      if (cancelled()) return result("cancelled", "Opening Forever was cancelled.");
      if (status.state === "running") return result("already-running", "Forever is already running.");
      // Recheck all ancestors after the metadata await. The guard is immediately before spawn.
      const target = await executable(root);
      if (cancelled()) return result("cancelled", "Opening Forever was cancelled.");
      const child = this.spawn(target, [], { cwd: path.dirname(target), shell: false, detached: true, stdio: "ignore", windowsHide: false });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
      this.requests.set(String(root).toLowerCase(), this.now());
      return result("requested", "Forever launch requested. Use the normal game sign-in.");
    } catch { return result("unavailable", "Forever could not be opened here. Use your usual launcher."); }
  }
}
module.exports = { GameRuntime };
