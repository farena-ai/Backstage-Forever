"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const MAX = 1024 * 1024,
  SAVED_MAX = MAX * 4 + 4096,
  OWN = [
    "BackstageForever.toc",
    "BackstageForeverReference.lua",
    "BackstageForeverAdvisorData.lua",
    "BackstageForeverPlan.lua",
    "BackstageForeverCoach.lua",
    "BackstageForeverAcquisition.lua",
    "BackstageForeverProfession.lua",
    "BackstageForeverGathering.lua",
    "BackstageForeverMapPlan.lua",
    "BackstageForeverMap.lua",
    "BackstageForeverAdvisorMap.lua",
    "BackstageForeverMap.xml",
    "BackstageForever.lua",
    "BackstageForeverHUD.lua",
    "BackstageForeverLive.lua",
    "BackstageForeverFind.lua",
    "BackstageForeverAssist.lua",
    "BackstageForeverGear.lua",
    "BackstageForeverQuestIntel.lua",
  ];
const { atomic } = require("./store.cjs");
const fsSync = require("node:fs");
const { GameRuntime } = require("./game-runtime.cjs");
const { combineSnapshots } = require("./game-roster.cjs");
const unknownRuntime = () => ({ state: "unknown", checkedAt: null, launchAvailable: false });
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
const LIVE_SETTINGS = /(^|\r?\n)[ \t]*BackstageForeverLiveSettings[ \t]*=[ \t]*\{\s*(?:\["enabled"\][ \t]*=[ \t]*(?:true|false),?\s*)?\}[ \t]*(?=\r?\n|$)/;
function parseSavedVariables(raw) {
  // Lua's quoted/decimal-byte transport can expand a bounded JSON payload.
  if (typeof raw !== "string" || Buffer.byteLength(raw) > SAVED_MAX) invalid();
  // 0.14.0 test builds saved the live-link preference beside the export; accept only
  // that exact small boolean table, before or after, and nothing else.
  raw = raw.replace(LIVE_SETTINGS, "\n");
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
    require("./live-bridge.cjs").rememberLiveKey(key, c.id);
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
    if (c.readiness !== undefined) {
      if (!c.readiness || typeof c.readiness !== "object" || Array.isArray(c.readiness)) invalid();
      out.readiness = require("./readiness.cjs").validateReadiness({
        ...c.readiness,
        ...(c.readiness.workshop === undefined ? {} : { workshop: require("./preparation-data.cjs").normalizeWorkshopCapture(c.readiness.workshop, out.updatedAt) }),
      });
    }
    // Optional feature failure must not erase valid core character observations.
    if (c.gathering !== undefined) {
      try { out.gathering = require("./gathering-data.cjs").normalizeGatheringCapture(c.gathering, out.updatedAt); } catch { /* Omit the entire invalid optional block. */ }
    }
    if (c.lootSources !== undefined) {
      try { out.lootSources = require("./quest-intel.cjs").normalizeLootSourcesCapture(c.lootSources); } catch { /* Omit the entire invalid optional block. */ }
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
  constructor({ dataDir, addonDir, onSnapshot = () => {}, onRootChange = () => {}, runtime = new GameRuntime() }) {
    this.dataDir = dataDir;
    this.addonDir = addonDir;
    this.onSnapshot = onSnapshot;
    this.onRootChange = onRootChange;
    this.runtime = runtime;
    this.refreshEpoch = 0;
    this.accountSnapshots = new Map();
    this.lastSnapshot = null;
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
      runtime: unknownRuntime(),
      loadedCaptureVersion: null,
      loadedGatheringSchema: null,
      coverage: { partial: false, unreadableAccountCount: 0, omittedCharacterCount: 0, omittedProfileCount: 0 },
    };
    this.ready = this.restore();
  }
  _setRoot(root) {
    const previousRoot = this.root;
    if (root === previousRoot) return;
    this.root = root;
    // Retire old-source effects before any asynchronous source preparation.
    this.onRootChange({ previousRoot, root, reason: "root" });
  }
  _sourceUnavailable() {
    this.state.loadedGatheringSchema = null;
    if (this.state.phase !== "folder-unavailable")
      this.onRootChange({ previousRoot: this.root, root: this.root, reason: "unavailable" });
  }
  status() {
    const state = structuredClone(this.state);
    if (!state.connected || state.phase === "folder-unavailable") state.runtime = unknownRuntime();
    state.coverage.message = state.coverage.omittedProfileCount
      ? `${state.coverage.omittedProfileCount} saved character(s) could not fit in the 100-profile capacity. Existing profiles and journals were preserved.`
      : state.coverage.omittedCharacterCount
        ? `${state.coverage.omittedCharacterCount} older saved character(s) exceed the 100-character import limit. The latest saved active character is included.`
        : state.coverage.partial
          ? "Some game saves are unavailable. Previous saved characters are preserved."
          : "Available saved characters imported within the profile limit.";
    state.companionState = state.phase === "folder-unavailable" ? "unavailable"
      : !state.addonCurrent ? "not-prepared"
      : state.lastSync && state.loadedCaptureVersion === state.addonVersion ? "saved"
      : state.runtime.state === "running" ? "update-next-launch" : "prepared";
    state.companionMessage = state.companionState === "unavailable" || !state.addonCurrent ? state.message
      : state.runtime.state === "running" ? "Companion files are prepared for your next game login. Live guidance runs inside WoW; desktop shows the last saved progress."
      : "Companion files are prepared. You can play now; live guidance runs inside WoW. Desktop progress arrives with game saves.";
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
          ? "All owned companion files match this app."
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
        label: "Desktop last saved progress (optional)",
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
    if (state.addonCurrent && state.phase !== "folder-unavailable") state.nextAction = { id: "play", label: "Ready to play", detail: state.companionMessage };
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
    return fs.realpath(root);
  }
  async connect(root) {
    await this.ready;
    return this._connect(root, true);
  }
  async _connect(root, persist, cancelled = () => false) {
    const gen = ++this.generation;
    const stale = () => gen !== this.generation || cancelled();
    clearInterval(this.timer);
    this._setRoot(null);
    try {
      root = await this.validateRoot(root);
      let version = null;
      try {
        version =
          (await boundedRead(path.join(root, ".build.info"))).match(
            /\b1\.60\.\d+\.\d+\b/,
          )?.[0] || null;
      } catch {}
      if (stale()) return this.status();
      this._setRoot(root);
      this.lastDigest = null;
      this.lastSnapshot = null;
      this.accountSnapshots.clear();
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
        runtime: unknownRuntime(),
        loadedCaptureVersion: null,
        loadedGatheringSchema: null,
        coverage: { partial: false, unreadableAccountCount: 0, omittedCharacterCount: 0, omittedProfileCount: 0 },
      };
      try {
        for (const file of OWN)
          await safe(
            path.join(root, "Interface", "AddOns", "BackstageForever", file),
            "file",
          );
        if (!stale()) this.state.addonInstalled = true;
      } catch {}
      if (persist) {
        await fs.mkdir(this.dataDir, { recursive: true });
        if (stale()) return this.status();
        // No await between the generation check and the atomic settings write.
        atomic(
          path.join(this.dataDir, "game-connection.private.json"),
          JSON.stringify({ root }),
        );
      }
      if (stale()) return this.status();
      this.timer = setInterval(() => this.refresh().catch(() => {}), 5000);
      this.timer.unref?.();
      await this._installAddon(gen, root, cancelled);
      if (!stale()) await this.refresh();
    } catch {
      if (!stale()) {
        this._sourceUnavailable();
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
    }
    return this.status();
  }
  async prepare(root, cancelled = () => false) {
    await this.ready;
    if (cancelled()) return this.status();
    if (root !== undefined) return this._connect(root, true, cancelled);
    if (!this.root) return this.status();
    const gen = ++this.generation;
    await this._installAddon(gen, this.root, cancelled);
    return cancelled() || gen !== this.generation ? this.status() : this.refresh();
  }
  async launch(cancelled = () => false) {
    const root = this.root, gen = this.generation;
    const stale = () => cancelled() || gen !== this.generation || root !== this.root;
    if (!root || stale()) return { state: root ? "cancelled" : "unavailable", message: "Open Forever with your usual launcher." };
    return this.runtime.launch(root, stale);
  }
  async installAddon() {
    await this.ready;
    return this._installAddon(++this.generation, this.root);
  }
  async _installAddon(gen, root, cancelled = () => false) {
    const stale = () => gen !== this.generation || cancelled();
    if (!root) return this.status();
    try {
      await this.validateRoot(root);
      if (stale()) return this.status();
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
            if (stale()) return this.status();
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
          if (stale()) return this.status();
          let previous = null;
          try {
            previous = await boundedRead(dest);
            if (previous === content) continue;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (stale()) return this.status();
          const temporary = path.join(
            folder,
            ".backstage-" + crypto.randomUUID() + ".tmp",
          );
          staged.push({ temporary, dest, content, previous });
          await fs.writeFile(temporary, content, { flag: "wx" });
          if ((await boundedRead(temporary)) !== content) throw Error("Verification failed");
        }
        await safe(folder, "dir");
        if (stale()) return this.status();
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
      if (!stale())
        this.state = {
          ...this.state,
          addonInstalled: true,
          addonCurrent: true,
          addonVersion:
            sources[0][1].match(/^## Version:\s*(.+)$/m)?.[1]?.trim() || null,
          // When these files landed: a /reload before this moment still runs the old addon.
          addonUpdatedAt: new Date().toISOString(),
          phase: "needs-reload",
          message:
            "Companion prepared. You can play now; the files activate at your next game login. Desktop progress reflects game saves.",
        };
    } catch {
      if (!stale())
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
      root = this.root, refreshEpoch = ++this.refreshEpoch;
    const cancelled = () => gen !== this.generation || refreshEpoch !== this.refreshEpoch;
    if (!root) return this.status();
    try {
      try {
        await this.validateRoot(root);
      } catch {
        if (!cancelled()) {
          this._sourceUnavailable();
          this.state = {
            ...this.state,
            phase: "folder-unavailable",
            message:
              "The game folder is unavailable. Reconnect it; previous characters are preserved.",
          };
        }
        return this.status();
      }
      const runtime = await this.runtime.probe(root);
      if (cancelled()) return this.status();
      this.state.runtime = runtime;
      const account = path.join(root, "WTF", "Account");
      try {
        await safe(account, "dir");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (cancelled()) return this.status();
        const unavailableAccounts = this.accountSnapshots.size;
        if (unavailableAccounts)
          this.state.coverage = {
            ...this.state.coverage,
            partial: true,
            unreadableAccountCount: unavailableAccounts,
          };
        return this._noExport(gen, unavailableAccounts > 0);
      }
      const entries = [];
      for await (const entry of await fs.opendir(account)) {
        entries.push(entry);
        if (entries.length > 256) throw Error("Too many entries");
      }
      if (entries.length > 256) throw Error("Too many entries");
      const snapshots = new Map(this.accountSnapshots), freshlyRead = [];
      let malformed = false, unreadableAccountCount = 0;
      const seenAccounts = new Set();
      for (const e of entries.sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        seenAccounts.add(e.name);
        const file = path.join(
          account,
          e.name,
          "SavedVariables",
          "BackstageForever.lua",
        );
        try {
          const s = parseSavedVariables(await boundedRead(file, SAVED_MAX));
          snapshots.set(e.name, s);
          freshlyRead.push(s);
        } catch (error) {
          if (error.code !== "ENOENT" || snapshots.has(e.name)) { malformed = true; unreadableAccountCount++; }
        }
      }
      // Removed directories cannot accumulate indefinitely. The profile store keeps
      // their already imported observations and private journals independently.
      for (const name of snapshots.keys()) if (!seenAccounts.has(name)) { malformed = true; unreadableAccountCount++; snapshots.delete(name); }
      if (cancelled()) return this.status();
      const composite = combineSnapshots([...snapshots.values()]);
      const best = composite?.snapshot;
      this.state.coverage = { ...this.state.coverage, partial: malformed || Boolean(composite?.coverage.omittedCharacterCount) || this.state.coverage.omittedProfileCount > 0, unreadableAccountCount, omittedCharacterCount: composite?.coverage.omittedCharacterCount || 0 };
      if (!best) { this.accountSnapshots = snapshots; return this._noExport(gen, malformed); }
      const digest = crypto
        .createHash("sha256")
        .update(JSON.stringify(best))
        .digest("hex");
      const activeCharacter = best.characters.find(c => c.id === best.activeId);
      const receivedGathering = activeCharacter?.gathering?.schemaVersion === 1 &&
        freshlyRead.some(s => s.characters.some(c => c.id === best.activeId &&
          c.updatedAt === activeCharacter.updatedAt && c.gathering?.schemaVersion === 1));
      this.state = {
        ...this.state,
        phase: !this.state.addonCurrent
          ? "needs-addon"
          : malformed ? "invalid-export" : Date.now() - Date.parse(best.observedAt) > 86400000
            ? "stale"
            : "synced",
        message: !this.state.addonCurrent
          ? "Previous snapshot imported. Repair the companion files before loading the addon."
          : Date.now() - Date.parse(best.observedAt) > 86400000
            ? "Desktop last saved progress is over a day old. Live guidance continues inside WoW; desktop progress updates when the game saves."
            : "Desktop last saved progress imported. Live guidance runs inside WoW; desktop progress updates when the game saves.",
        lastSync: best.observedAt,
        characterCount: best.characters.length,
        loadedCaptureVersion: activeCharacter?.captureVersion || null,
        loadedGatheringSchema: receivedGathering ? 1 : null,
      };
      if (malformed) this.state.message = "Some game saves are unavailable. Valid last saved progress and previous characters are preserved; live guidance continues inside WoW.";
      if (digest !== this.lastDigest) {
        const imported = this.onSnapshot(best);
        this.state.coverage.omittedProfileCount = imported?.omittedProfileCount || 0;
        this.state.coverage.partial ||= this.state.coverage.omittedProfileCount > 0;
        this.lastDigest = digest;
      }
      this.accountSnapshots = snapshots;
      this.lastSnapshot = structuredClone(best);
    } catch {
      if (!cancelled())
        this.state = {
          ...this.state,
          phase: "error",
          loadedGatheringSchema: null,
          coverage: { ...this.state.coverage, partial: true },
          message:
            "The snapshot could not be read or imported. Retry; previous characters are preserved.",
        };
    }
    return this.status();
  }
  _noExport(gen, malformed) {
    if (gen !== this.generation) return this.status();
    this.state.loadedGatheringSchema = null;
    if (gen === this.generation)
      this.state = {
        ...this.state,
        phase: this.state.addonCurrent
          ? malformed
            ? "invalid-export"
            : "needs-reload"
          : "needs-addon",
        message: malformed
          ? "The last game save is unreadable. You can keep playing; previous desktop characters are preserved until the next valid save."
          : this.state.addonCurrent
            ? "Companion files are prepared. You can play now; enable BackstageForever at your next game login. Desktop progress appears when the game saves."
            : "Prepare or repair the companion addon before loading it in game.",
      };
    return this.status();
  }
  async disconnect() {
    ++this.generation;
    clearInterval(this.timer);
    this._setRoot(null);
    this.lastDigest = null;
    this.lastSnapshot = null;
    this.accountSnapshots.clear();
    this.state = {
      ...this.state,
      connected: false,
      addonInstalled: false,
      addonCurrent: false,
      addonVersion: null,
      runtime: unknownRuntime(),
      loadedCaptureVersion: null,
      loadedGatheringSchema: null,
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
      coverage: { partial: false, unreadableAccountCount: 0, omittedCharacterCount: 0, omittedProfileCount: 0 },
    };
    return this.status();
  }
  close() {
    ++this.generation;
    clearInterval(this.timer);
    this._setRoot(null);
    this.lastSnapshot = null;
    this.accountSnapshots.clear();
    this.state = {
      ...this.state,
      connected: false,
      addonInstalled: false,
      addonCurrent: false,
      addonVersion: null,
      runtime: unknownRuntime(),
      loadedCaptureVersion: null,
      loadedGatheringSchema: null,
      phase: "disconnected",
    };
  }
}
module.exports = { GameSync, parseSavedVariables };
