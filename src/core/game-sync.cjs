"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os");
const MAX = 1024 * 1024,
  OWN = ["BackstageForever.toc", "BackstageForever.lua"];
const { atomic } = require("./store.cjs");
const fsSync = require("node:fs");
function invalid() {
  throw new Error("Invalid addon snapshot");
}
function text(v, max = 100, required = false) {
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\x00-\x1f\x7f]/.test(v) ||
    (required && !v.trim())
  )
    invalid();
  return v;
}
function stamp(v) {
  const n = typeof v === "number" ? v * 1000 : Date.parse(v);
  if (!Number.isFinite(n) || n < 946684800000 || n > Date.now() + 86400000)
    invalid();
  return new Date(n).toISOString();
}
function id(v) {
  return crypto
    .createHash("sha256")
    .update("BackstageForever:" + text(v, 200, true))
    .digest("hex");
}
function parseSavedVariables(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX) invalid();
  const m = /^\s*BackstageForeverExport\s*=\s*/.exec(raw);
  if (!m) invalid();
  let rest = raw.slice(m[0].length),
    json = "",
    end = 0;
  if (rest[0] === '"' || rest[0] === "'") {
    const quote = rest[0];
    let i = 1;
    for (; i < rest.length; i++) {
      let c = rest[i];
      if (c === quote) {
        end = i + 1;
        break;
      }
      if (c === "\\") {
        c = rest[++i];
        if (/[0-9]/.test(c || "")) {
          let digits = c;
          while (digits.length < 3 && /[0-9]/.test(rest[i + 1] || ""))
            digits += rest[++i];
          const num = Number(digits);
          if (num > 255) invalid();
          json += String.fromCharCode(num);
        } else {
          const escapes = {
            n: "\n",
            r: "\r",
            t: "\t",
            "\\": "\\",
            '"': '"',
            "'": "'",
          };
          if (!(c in escapes)) invalid();
          json += escapes[c];
        }
      } else {
        if (c === "\n" || c === "\r") invalid();
        json += c;
      }
    }
    if (!end) invalid();
  } else {
    const open = /^\[(=*)\[/.exec(rest);
    if (!open) invalid();
    const close = "]" + open[1] + "]",
      idx = rest.indexOf(close, open[0].length);
    if (idx < 0) invalid();
    json = rest.slice(open[0].length, idx).replace(/^\r?\n/, "");
    end = idx + close.length;
  }
  if (rest.slice(end).trim()) invalid();
  const s = JSON.parse(json);
  if (
    !s ||
    s.schema !== 1 ||
    !Array.isArray(s.characters) ||
    s.characters.length > 100
  )
    invalid();
  const seen = new Set();
  const characters = s.characters.map((c) => {
    if (!c || typeof c !== "object") invalid();
    const key = id(c.id);
    if (
      seen.has(key) ||
      !Number.isInteger(c.level) ||
      c.level < 1 ||
      c.level > 1000
    )
      invalid();
    seen.add(key);
    const out = {
      id: key,
      name: text(c.name, 100, true),
      realm: text(c.realm),
      className: text(c.className, 100, true),
      level: c.level,
      updatedAt: stamp(c.updatedAt),
    };
    for (const k of ["race", "faction"])
      if (c[k] !== undefined) out[k] = text(c[k]);
    if (c.location) {
      const l = c.location;
      out.location = { zone: text(l.zone), subZone: text(l.subZone) };
      if (l.mapId !== undefined) {
        if (!Number.isInteger(l.mapId) || l.mapId < 0 || l.mapId > 1000000)
          invalid();
        out.location.mapId = l.mapId;
      }
      for (const k of ["x", "y"])
        if (l[k] !== undefined) {
          if (
            typeof l[k] !== "number" ||
            !Number.isFinite(l[k]) ||
            l[k] < 0 ||
            l[k] > 1
          )
            invalid();
          out.location[k] = l[k];
        }
    }
    return out;
  });
  const activeId = s.activeId === null ? null : id(s.activeId);
  if (activeId && !seen.has(activeId)) invalid();
  return { characters, activeId, observedAt: stamp(s.observedAt) };
}
async function safe(target, kind) {
  const absolute = path.resolve(target),
    parts = absolute.slice(path.parse(absolute).root.length).split(path.sep);
  let p = path.parse(absolute).root;
  for (const part of parts) {
    p = path.join(p, part);
    const st = await fs.lstat(p);
    if (st.isSymbolicLink()) throw Error("Unsafe path");
  }
  const st = await fs.lstat(absolute);
  if (
    (kind === "dir" && !st.isDirectory()) ||
    (kind === "file" && !st.isFile())
  )
    throw Error("Invalid path");
  return st;
}
async function boundedRead(file) {
  const st = await safe(file, "file");
  if (st.size > MAX) invalid();
  const h = await fs.open(file, "r");
  try {
    const now = await h.stat();
    if (now.size > MAX || now.ino !== st.ino) invalid();
    const b = Buffer.alloc(MAX + 1);
    const { bytesRead } = await h.read(b, 0, b.length, 0);
    if (bytesRead > MAX) invalid();
    return b.subarray(0, bytesRead).toString("utf8");
  } finally {
    await h.close();
  }
}
class GameSync {
  constructor({ dataDir, addonDir, onSnapshot = () => {} }) {
    this.dataDir = dataDir;
    this.addonDir = addonDir;
    this.onSnapshot = onSnapshot;
    this.generation = 0;
    this.root = null;
    this.lastDigest = null;
    this.state = {
      connected: false,
      addonInstalled: false,
      phase: "disconnected",
      message: "Connect your game folder to import saved snapshots.",
      lastSync: null,
      characterCount: 0,
      clientVersion: null,
      interfaceVersion: null,
    };
    this.ready = this.restore();
  }
  status() {
    return { ...this.state };
  }
  async restore() {
    const gen = this.generation;
    try {
      const cfg = JSON.parse(
        await boundedRead(
          path.join(this.dataDir, "game-connection.private.json"),
        ),
      );
      if (gen === this.generation && typeof cfg.root === "string")
        await this._connect(cfg.root, false);
    } catch {}
    return this.status();
  }
  async discover() {
    await this.ready;
    const roots = [];
    for (const base of [
      process.env["ProgramFiles(x86)"],
      process.env.ProgramFiles,
      process.env.ProgramW6432,
    ].filter(Boolean))
      for (const suffix of [
        "World of Warcraft/_forever_",
        "World of Warcraft",
      ]) {
        const p = path.join(base, suffix);
        try {
          await this.validateRoot(p);
          roots.push({
            id: crypto.createHash("sha256").update(p).digest("hex"),
            label: "World of Warcraft: Forever",
            path: p,
          });
        } catch {}
      }
    return roots.filter(
      (x, i, a) => a.findIndex((y) => y.path === x.path) === i,
    );
  }
  async validateRoot(root) {
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      root.length > 1000
    )
      throw Error("Invalid folder");
    await safe(root, "dir");
    const flavor = await boundedRead(path.join(root, ".flavor.info"));
    if (!/\bwowf\b/i.test(flavor)) throw Error("Not Forever");
    await safe(path.join(root, "WTF"), "dir");
    return path.resolve(root);
  }
  async connect(root) {
    await this.ready;
    return this._connect(root, true);
  }
  async _connect(root, persist) {
    const gen = ++this.generation;
    clearInterval(this.timer);
    this.root = null;
    try {
      root = await this.validateRoot(root);
      let version = null;
      try {
        version =
          (await boundedRead(path.join(root, ".build.info"))).match(
            /\b1\.60\.\d+\.\d+\b/,
          )?.[0] || null;
      } catch {}
      if (gen !== this.generation) return this.status();
      this.root = root;
      this.lastDigest = null;
      this.state = {
        ...this.state,
        connected: true,
        addonInstalled: false,
        phase: "waiting",
        message:
          "Snapshots reach disk when you log out or reload the UI. No live feed.",
        clientVersion: version,
        interfaceVersion: 16001,
      };
      try {
        for (const file of OWN)
          await safe(
            path.join(root, "Interface", "AddOns", "BackstageForever", file),
            "file",
          );
        if (gen === this.generation) this.state.addonInstalled = true;
      } catch {}
      if (persist) {
        await fs.mkdir(this.dataDir, { recursive: true });
        if (gen !== this.generation) return this.status();
        // No await between the generation check and the atomic settings write.
        atomic(
          path.join(this.dataDir, "game-connection.private.json"),
          JSON.stringify({ root }),
        );
      }
      if (gen !== this.generation) return this.status();
      this.timer = setInterval(() => this.refresh().catch(() => {}), 5000);
      this.timer.unref?.();
      await this.refresh();
    } catch {
      if (gen === this.generation)
        this.state = {
          ...this.state,
          connected: false,
          phase: "error",
          message: "Choose a valid World of Warcraft: Forever client folder.",
        };
    }
    return this.status();
  }
  async installAddon() {
    await this.ready;
    const gen = this.generation,
      root = this.root;
    if (!root) return this.status();
    try {
      await this.validateRoot(root);
      let folder = root;
      for (const part of ["Interface", "AddOns", "BackstageForever"]) {
        folder = path.join(folder, part);
        try {
          await safe(folder, "dir");
        } catch (e) {
          try {
            await fs.lstat(folder);
            throw e;
          } catch (check) {
            if (check.code !== "ENOENT") throw check;
            await fs.mkdir(folder);
          }
        }
      }
      for (const file of OWN) {
        const dest = path.join(folder, file);
        try {
          await safe(dest, "file");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        const content = await boundedRead(path.join(this.addonDir, file));
        if (gen !== this.generation) return this.status();
        const temporary = path.join(
          folder,
          ".backstage-" + crypto.randomUUID() + ".tmp",
        );
        try {
          await fs.writeFile(temporary, content, { flag: "wx" });
          await safe(folder, "dir");
          if (gen !== this.generation) return this.status();
          await fs.rename(temporary, dest);
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
      }
      if (gen === this.generation)
        this.state = {
          ...this.state,
          addonInstalled: true,
          message:
            "Addon installed. If the game is running, load it on your next restart or UI reload. Saved snapshots update on logout/reload.",
        };
    } catch {
      if (gen === this.generation)
        this.state = {
          ...this.state,
          phase: "error",
          message:
            "Addon installation failed. Check the selected folder and permissions.",
        };
    }
    return this.status();
  }
  async refresh() {
    const gen = this.generation,
      root = this.root;
    if (!root) return this.status();
    try {
      await this.validateRoot(root);
      const account = path.join(root, "WTF", "Account");
      await safe(account, "dir");
      const entries = [];
      for await (const entry of await fs.opendir(account)) {
        entries.push(entry);
        if (entries.length > 256) throw Error("Too many entries");
      }
      if (entries.length > 256) throw Error("Too many entries");
      let best = null;
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        const file = path.join(
          account,
          e.name,
          "SavedVariables",
          "BackstageForever.lua",
        );
        try {
          const s = parseSavedVariables(await boundedRead(file));
          if (!best || s.observedAt > best.observedAt) best = s;
        } catch {}
      }
      if (gen !== this.generation) return this.status();
      if (!best) {
        this.state = {
          ...this.state,
          phase: "waiting",
          message:
            "Waiting for a valid saved snapshot. Updates reach disk on logout or UI reload; previous characters are preserved.",
        };
        return this.status();
      }
      const digest = crypto
        .createHash("sha256")
        .update(JSON.stringify(best))
        .digest("hex");
      this.state = {
        ...this.state,
        phase: "synced",
        message:
          "Saved snapshot imported. Updates reach disk on logout or UI reload.",
        lastSync: best.observedAt,
        characterCount: best.characters.length,
      };
      if (digest !== this.lastDigest) {
        this.onSnapshot(best);
        this.lastDigest = digest;
      }
    } catch {
      if (gen === this.generation)
        this.state = {
          ...this.state,
          phase: "waiting",
          message:
            "Waiting for a valid saved snapshot. Your last imported characters are preserved.",
        };
    }
    return this.status();
  }
  async disconnect() {
    ++this.generation;
    clearInterval(this.timer);
    this.root = null;
    this.lastDigest = null;
    this.state = {
      ...this.state,
      connected: false,
      addonInstalled: false,
      phase: "disconnected",
      message: "Game disconnected.",
    };
    try {
      fsSync.unlinkSync(
        path.join(this.dataDir, "game-connection.private.json"),
      );
    } catch {}
    return this.status();
  }
  async reset() {
    await this.disconnect();
    this.state = {
      ...this.state,
      lastSync: null,
      characterCount: 0,
      clientVersion: null,
      interfaceVersion: null,
    };
    return this.status();
  }
  close() {
    ++this.generation;
    clearInterval(this.timer);
    this.root = null;
    this.state = { ...this.state, connected: false, phase: "disconnected" };
  }
}
module.exports = { GameSync, parseSavedVariables };
