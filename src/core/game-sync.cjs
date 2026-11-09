"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const MAX = 1024 * 1024,
  SAVED_MAX = MAX * 4 + 4096,
  OWN = [
    "BackstageForever.toc",
    "BackstageForeverReference.lua",
    "BackstageForeverPlan.lua",
    "BackstageForever.lua",
    "BackstageForeverHUD.lua",
  ];
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
  // Lua's quoted/decimal-byte transport can expand a bounded JSON payload.
  if (typeof raw !== "string" || Buffer.byteLength(raw) > SAVED_MAX) invalid();
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
  if (Buffer.byteLength(json) > MAX) invalid();
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
      ...require("./quest-data.cjs").validateCapture(c),
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
    if (c.quests !== undefined)
      out.quests = require("./quest-data.cjs").validateQuestData(c.quests);
    if (c.progress !== undefined)
      out.progress = require("./quest-data.cjs").validateProgress(c.progress);
    if (c.history !== undefined)
      out.history = require("./quest-data.cjs").validateHistory(c.history);
    if (c.readiness !== undefined)
      out.readiness = require("./readiness.cjs").validateReadiness(c.readiness);
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
async function boundedRead(file, limit = MAX) {
  const st = await safe(file, "file");
  if (st.size > limit) invalid();
  const h = await fs.open(file, "r");
  try {
    const now = await h.stat();
    if (now.size > limit || now.ino !== st.ino) invalid();
    const b = Buffer.alloc(limit + 1);
    const { bytesRead } = await h.read(b, 0, b.length, 0);
    if (bytesRead > limit) invalid();
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
      addonCurrent: false,
      addonVersion: null,
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
    const state = structuredClone(this.state);
    state.checks = [
      {
        id: "folder",
        state: state.connected ? "done" : "action",
        label: "Find your Forever folder",
        detail: state.connected
          ? "Forever folder connected."
          : "Choose the game folder to begin.",
      },
      {
        id: "addon",
        state: state.addonCurrent
          ? "done"
          : state.connected
            ? "action"
            : "blocked",
        label: "Prepare companion addon",
        detail: state.addonCurrent
          ? "All five companion files match this app."
          : "Companion files need preparation or repair.",
      },
      {
        id: "snapshot",
        state:
          state.phase === "synced"
            ? "done"
            : state.addonCurrent
              ? "action"
              : "blocked",
        label: "Receive character snapshot",
        detail: state.message,
      },
    ];
    const actions = {
      disconnected: ["choose-folder", "Choose game folder"],
      "folder-unavailable": ["choose-folder", "Reconnect game folder"],
      "needs-addon": ["prepare", "Repair companion addon"],
      error: ["prepare", "Retry companion setup"],
      "needs-reload": ["reload", "Load the companion in game"],
      "invalid-export": ["reload", "Create a new snapshot"],
      stale: ["reload", "Refresh your character snapshot"],
      synced: ["play", "Your companion is ready"],
    };
    const action = actions[state.phase] || actions.error;
    state.nextAction = {
      id: action[0],
      label: action[1],
      detail: state.message,
    };
    return state;
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
    return require("./game-discovery.cjs").discoverGame({
      validateRoot: (root) => this.validateRoot(root),
    });
  }
  async validateRoot(root) {
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      root.length > 1000
    )
      throw Error("Invalid folder");
    await safe(root, "dir");
    try {
      await safe(path.join(root, "_forever_"), "dir");
      return await this.validateRoot(path.join(root, "_forever_"));
    } catch {}
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
        lastSync: null,
        characterCount: 0,
        addonInstalled: false,
        addonCurrent: false,
        addonVersion: null,
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
      await this._installAddon(gen, root);
      await this.refresh();
    } catch {
      if (gen === this.generation)
        this.state = {
          ...this.state,
          connected: false,
          addonInstalled: false,
          addonCurrent: false,
          addonVersion: null,
          phase: "folder-unavailable",
          message: "Choose a valid World of Warcraft: Forever client folder.",
        };
    }
    return this.status();
  }
  async prepare(root) {
    await this.ready;
    if (root !== undefined) return this._connect(root, true);
    if (!this.root) return this.status();
    const gen = ++this.generation;
    await this._installAddon(gen, this.root);
    return this.refresh();
  }
  async installAddon() {
    await this.ready;
    return this._installAddon(++this.generation, this.root);
  }
  async _installAddon(gen, root) {
    if (!root) return this.status();
    try {
      await this.validateRoot(root);
      if (gen !== this.generation) return this.status();
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
            if (gen !== this.generation) return this.status();
            await fs.mkdir(folder);
          }
        }
      }
      const sources = await Promise.all(
        OWN.map(async (file) => [
          file,
          await boundedRead(path.join(this.addonDir, file)),
        ]),
      );
      // Stage and verify every module before committing the loader last.
      const staged = [];
      try {
        for (const [file, content] of [...sources.slice(1), sources[0]]) {
          const dest = path.join(folder, file);
          try {
            await safe(dest, "file");
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          if (gen !== this.generation) return this.status();
          let previous = null;
          try {
            previous = await boundedRead(dest);
            if (previous === content) continue;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (gen !== this.generation) return this.status();
          const temporary = path.join(
            folder,
            ".backstage-" + crypto.randomUUID() + ".tmp",
          );
          staged.push({ temporary, dest, content, previous });
          await fs.writeFile(temporary, content, { flag: "wx" });
          if ((await boundedRead(temporary)) !== content) throw Error("Verification failed");
        }
        await safe(folder, "dir");
        if (gen !== this.generation) return this.status();
        const committed = [];
        try {
          // No await: disconnect/reset cannot interleave the commit and rollback.
          for (const entry of staged) {
            fsSync.renameSync(entry.temporary, entry.dest);
            committed.push(entry);
            if (fsSync.readFileSync(entry.dest, "utf8") !== entry.content)
              throw Error("Verification failed");
          }
        } catch (error) {
          for (const entry of committed.reverse()) {
            if (entry.previous === null) fsSync.unlinkSync(entry.dest);
            else {
              fsSync.writeFileSync(entry.temporary, entry.previous, { flag: "wx" });
              fsSync.renameSync(entry.temporary, entry.dest);
            }
          }
          throw error;
        }
      } finally {
        await Promise.all(staged.map(({ temporary }) => fs.unlink(temporary).catch(() => {})));
      }
      if (gen === this.generation)
        this.state = {
          ...this.state,
          addonInstalled: true,
          addonCurrent: true,
          addonVersion:
            sources[0][1].match(/^## Version:\s*(.+)$/m)?.[1]?.trim() || null,
          phase: "needs-reload",
          message:
            "Addon installed. If the game is running, load it on your next restart or UI reload. Saved snapshots update on logout/reload.",
        };
    } catch {
      if (gen === this.generation)
        this.state = {
          ...this.state,
          addonInstalled: false,
          addonCurrent: false,
          addonVersion: null,
          phase: "needs-addon",
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
      try {
        await this.validateRoot(root);
      } catch {
        if (gen === this.generation)
          this.state = {
            ...this.state,
            phase: "folder-unavailable",
            message:
              "The game folder is unavailable. Reconnect it; previous characters are preserved.",
          };
        return this.status();
      }
      const account = path.join(root, "WTF", "Account");
      try {
        await safe(account, "dir");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return this._noExport(gen, false);
      }
      const entries = [];
      for await (const entry of await fs.opendir(account)) {
        entries.push(entry);
        if (entries.length > 256) throw Error("Too many entries");
      }
      if (entries.length > 256) throw Error("Too many entries");
      let best = null,
        malformed = false;
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        const file = path.join(
          account,
          e.name,
          "SavedVariables",
          "BackstageForever.lua",
        );
        try {
          const s = parseSavedVariables(await boundedRead(file, SAVED_MAX));
          if (!best || s.observedAt > best.observedAt) best = s;
        } catch (error) {
          if (error.code !== "ENOENT") malformed = true;
        }
      }
      if (gen !== this.generation) return this.status();
      if (!best) return this._noExport(gen, malformed);
      const digest = crypto
        .createHash("sha256")
        .update(JSON.stringify(best))
        .digest("hex");
      this.state = {
        ...this.state,
        phase: !this.state.addonCurrent
          ? "needs-addon"
          : Date.now() - Date.parse(best.observedAt) > 86400000
            ? "stale"
            : "synced",
        message: !this.state.addonCurrent
          ? "Previous snapshot imported. Repair the companion files before loading the addon."
          : Date.now() - Date.parse(best.observedAt) > 86400000
            ? "The saved snapshot is over a day old. Use /reload or log out to save current progress."
            : "Saved snapshot imported. Updates reach disk on logout or UI reload.",
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
          phase: "error",
          message:
            "The snapshot could not be read or imported. Retry; previous characters are preserved.",
        };
    }
    return this.status();
  }
  _noExport(gen, malformed) {
    if (gen === this.generation)
      this.state = {
        ...this.state,
        phase: this.state.addonCurrent
          ? malformed
            ? "invalid-export"
            : "needs-reload"
          : "needs-addon",
        message: malformed
          ? "The saved snapshot is unreadable. Load the addon and use /reload to save a fresh snapshot; previous characters are preserved."
          : this.state.addonCurrent
            ? "Companion files are ready. Launch Forever, enable BackstageForever if needed, then use /reload or log out to save your first snapshot."
            : "Prepare or repair the companion addon before loading it in game.",
      };
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
      addonCurrent: false,
      addonVersion: null,
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
    this.state = {
      ...this.state,
      connected: false,
      addonInstalled: false,
      addonCurrent: false,
      addonVersion: null,
      phase: "disconnected",
    };
  }
}
module.exports = { GameSync, parseSavedVariables };
