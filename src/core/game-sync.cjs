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
    "BackstageForeverRoute.lua",
    "BackstageForeverSupplies.lua",
    "BackstageForeverJournal.lua",
    "BackstageForeverCombat.lua",
    "BackstageForeverMoments.lua",
    "BackstageForeverLedger.lua",
    "BackstageForeverSheet.lua",
    "BackstageForeverAsk.lua",
    "BackstageForeverEnemy.lua",
    "BackstageForeverQoL.lua",
    "BackstageForeverParty.lua",
    "BackstageForeverGuideData.lua",
    "BackstageForeverLocale.lua",
    "BackstageForeverHelpers.lua",
    "BackstageForeverBossTips.lua",
    "BackstageForeverOptions.lua",
    "Bindings.xml",
    "BackstageForeverMinimap.lua",
    "BackstageForeverSources.lua",
    "BackstageForeverChain.lua",
    "BackstageForeverAtlasData.lua",
    "BackstageForeverAtlas.lua",
    "BackstageForeverDesktop.lua",
  ];
const { atomic } = require("./store.cjs");
const fsSync = require("node:fs");
const { GameRuntime } = require("./game-runtime.cjs");
const { combineSnapshots } = require("./game-roster.cjs");
const unknownRuntime = () => ({ state: "unknown", checkedAt: null, launchAvailable: false });
const INSTALL_FAILURE = "Addon installation failed. Check the selected folder and permissions.";
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
    // UnitSex: the art and the companion's pronouns. Anything else stays unknown.
    if (c.sex === "male" || c.sex === "female") out.sex = c.sex;
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
    if (c.journal !== undefined) {
      try { out.journal = require("./journal-data.cjs").normalizeJournalCapture(c.journal, { ignoreInvalidEncounters: true }); } catch { /* Omit the invalid optional journal. */ }
    }
    if (c.ledger !== undefined) {
      try { out.ledger = require("./ledger.cjs").normalizeLedgerCapture(c.ledger); } catch { /* Omit the entire invalid optional block. */ }
    }
    if (c.stats !== undefined) {
      try { out.stats = require("./sheet.cjs").normalizeStatsCapture(c.stats); } catch { /* Omit the entire invalid optional block. */ }
    }
    if (c.gearSets !== undefined) {
      try { out.gearSets = require("./sheet.cjs").normalizeGearSetsCapture(c.gearSets); } catch { /* Omit the entire invalid optional block. */ }
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
  return (await boundedBytes(file, limit)).toString("utf8");
}
// Painted textures ship as whole folders: every .tga in these addon subfolders is
// installed (zone banners: Art/Zones/<mapId>.tga plus default.tga; the minimap Ask button:
// Art/Buttons/ask.tga; the painted message boxes: Art/Messages/<kind>.tga).
const ART_DIRS = [["Art", "Zones"], ["Art", "Buttons"], ["Art", "Messages"], ["Art", "Frames"], ["Art", "Dungeons"]],
  ART_MAX_FILES = 128,
  ART_NAME = /^[A-Za-z0-9_-]{1,40}\.tga$/i;
async function artFiles(addonDir) {
  const out = [];
  for (const parts of ART_DIRS) {
    const dir = path.join(addonDir, ...parts);
    let names;
    try {
      await safe(dir, "dir");
      names = await fs.readdir(dir);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    for (const name of names.filter((n) => ART_NAME.test(n)).sort())
      out.push([...parts, name]);
    if (out.length > ART_MAX_FILES) invalid();
  }
  return out;
}
async function boundedBytes(file, limit = MAX) {
  const st = await safe(file, "file");
  if (st.size > limit) invalid();
  const h = await fs.open(file, "r");
  try {
    const now = await h.stat();
    if (now.size > limit || now.ino !== st.ino) invalid();
    const b = Buffer.alloc(limit + 1);
    const { bytesRead } = await h.read(b, 0, b.length, 0);
    if (bytesRead > limit) invalid();
    return Buffer.from(b.subarray(0, bytesRead));
  } finally {
    await h.close();
  }
}
// WoW writes the save on /reload, logout or exit, from the addon that was running.
// A save written after the update landed means the game has reloaded since, so the
// new addon is running even though that save still names the old version.
function addonLoaded(state) {
  const written = Date.parse(state.savedAt || ""), landed = Date.parse(state.addonUpdatedAt || "");
  return Number.isFinite(written) && Number.isFinite(landed) && written > landed;
}
const HANDOFF_FILE = require("./desktop-handoff.cjs").FILE;
class GameSync {
  constructor({ dataDir, addonDir, onSnapshot = () => {}, onRootChange = () => {}, runtime = new GameRuntime(), handoff = null }) {
    // Desktop -> game hand-off (desktop-handoff.cjs): supplies the bytes of its one data file.
    this.handoff = handoff;
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
      savedAt: null,
      coverage: { partial: false, unreadableAccountCount: 0, omittedCharacterCount: 0, omittedProfileCount: 0 },
    };
    this.ready = this.restore();
  }
  _setRoot(root) {
    const previousRoot = this.root;
    if (root === previousRoot) return;
    this.root = root;
    // Retire effects from the previous committed source synchronously.
    this.onRootChange({ previousRoot, root, reason: "root" });
  }
  _sourceUnavailable() {
    this.state.loadedGatheringSchema = null;
    if (this.state.phase !== "folder-unavailable")
      this.onRootChange({ previousRoot: this.root, root: this.root, reason: "unavailable" });
  }
  // The hand-off file's bytes: what the desktop wants the game to read, or the shipped empty file.
  async handoffBytes() {
    const shipped = () => boundedBytes(path.join(this.addonDir, HANDOFF_FILE));
    if (typeof this.handoff !== "function") return shipped();
    try {
      const bytes = Buffer.from(String(await this.handoff()), "utf8");
      return bytes.length > 0 && bytes.length <= MAX ? bytes : await shipped();
    } catch { return shipped(); }
  }
  // Rewrites only the hand-off file when the addon is already installed and current, for example
  // after a wish-list change. Same checks as the installer: no symlinked folder, staged, renamed.
  async writeHandoff() {
    if (!this.root || !this.state.addonCurrent || typeof this.handoff !== "function") return false;
    const root = this.root, folder = path.join(root, "Interface", "AddOns", "BackstageForever"), dest = path.join(folder, HANDOFF_FILE);
    let temporary = null;
    try {
      await safe(folder, "dir");
      const content = await this.handoffBytes();
      let previous = null;
      try { previous = await boundedBytes(dest); } catch (e) { if (e.code !== "ENOENT") throw e; }
      if (previous && previous.equals(content)) return false;
      temporary = path.join(folder, ".backstage-" + crypto.randomUUID() + ".tmp");
      await fs.writeFile(temporary, content, { flag: "wx" });
      if (!(await boundedBytes(temporary)).equals(content)) throw Error("Verification failed");
      await safe(folder, "dir");
      if (this.root !== root) return false;
      fsSync.renameSync(temporary, dest);
      temporary = null;
      return true;
    } catch { return false; } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
    }
  }
  status() {
    const state = structuredClone(this.state);
    // Snapshot polling must not hide an unsuccessful install while repair is needed.
    if (state.phase === "needs-addon" && state.setupIssue === "install-failed") state.message = INSTALL_FAILURE;
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
      : state.lastSync && (state.loadedCaptureVersion === state.addonVersion || addonLoaded(state)) ? "saved"
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
    let validated = false;
    try {
      root = await this.validateRoot(root);
      validated = true;
      let version = null;
      try {
        version =
          (await boundedRead(path.join(root, ".build.info"))).match(
            /\b1\.60\.\d+\.\d+\b/,
          )?.[0] || null;
      } catch {}
      if (persist) await fs.mkdir(this.dataDir, { recursive: true });
      if (stale()) return this.status();
      await this._installAddon(gen, root, cancelled, (installed) => {
        // A failed replacement must not take an existing saved source offline.
        if (!installed && this.root && this.root !== root) {
          this.state.setupIssue = "install-failed";
          return false;
        }
        if (persist) atomic(path.join(this.dataDir, "game-connection.private.json"), JSON.stringify({ root }));
        clearInterval(this.timer);
        ++this.refreshEpoch;
        this._setRoot(root);
        this.lastDigest = null;
        this.lastSnapshot = null;
        this.accountSnapshots.clear();
        this.state = {
          ...this.state, connected: true, setupIssue: null, lastSync: null, characterCount: 0,
          addonInstalled: false, addonCurrent: false, addonVersion: null, addonUpdatedAt: null,
          clientVersion: version, interfaceVersion: 16001, runtime: unknownRuntime(),
          loadedCaptureVersion: null, loadedGatheringSchema: null, savedAt: null,
          coverage: { partial: false, unreadableAccountCount: 0, omittedCharacterCount: 0, omittedProfileCount: 0 },
        };
        this.timer = setInterval(() => this.refresh().catch(() => {}), 5000);
        this.timer.unref?.();
        return true;
      });
      if (!stale()) await this.refresh();
    } catch {
      if (!stale()) {
        if (persist) this.state.setupIssue = validated ? "install-failed" : "wrong-client";
        if (!this.root) this.state = {
          ...this.state, phase: "folder-unavailable",
          message: validated ? INSTALL_FAILURE : "Choose a valid World of Warcraft: Forever client folder.",
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
  async _installAddon(gen, root, cancelled = () => false, selectRoot = () => true) {
    const stale = () => gen !== this.generation || cancelled();
    if (!root) return this.status();
    try {
      await this.validateRoot(root);
      if (stale()) return this.status();
      // Creates missing folders one level at a time, refusing links; null when stale.
      const ensure = async (base, parts) => {
        let dir = base;
        for (const part of parts) {
          if (stale()) return null;
          dir = path.join(dir, part);
          try {
            await safe(dir, "dir");
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
            if (stale()) return null;
            try {
              await fs.mkdir(dir);
            } catch (createError) {
              if (createError.code !== "EEXIST") throw createError;
              // A retired attempt may have finished its mkdir. Trust only a checked directory.
              await safe(dir, "dir");
            }
          }
        }
        return stale() ? null : dir;
      };
      const folder = await ensure(root, ["Interface", "AddOns", "BackstageForever"]);
      if (!folder) return this.status();
      const sources = await Promise.all(
        OWN.map(async (file) => [
          file,
          file === HANDOFF_FILE ? await this.handoffBytes() : await boundedBytes(path.join(this.addonDir, file)),
        ]),
      );
      // Painted textures (binary): every .tga in the addon's art folders.
      const art = await Promise.all(
        (await artFiles(this.addonDir)).map(async (parts) => [
          path.join(...parts),
          await boundedBytes(path.join(this.addonDir, ...parts)),
        ]),
      );
      const artFolders = [...new Set(art.map(([file]) => path.dirname(file)))];
      for (const dir of artFolders)
        if (!(await ensure(folder, dir.split(path.sep)))) return this.status();
      // Stage and verify every module and texture before committing the loader last.
      const staged = [];
      try {
        for (const [file, content] of [...sources.slice(1), ...art, sources[0]]) {
          const dest = path.join(folder, file);
          try {
            await safe(dest, "file");
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          if (stale()) return this.status();
          let previous = null;
          try {
            previous = await boundedBytes(dest);
            if (previous.equals(content)) continue;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (stale()) return this.status();
          const temporary = path.join(
            path.dirname(dest),
            ".backstage-" + crypto.randomUUID() + ".tmp",
          );
          staged.push({ temporary, dest, content, previous });
          await fs.writeFile(temporary, content, { flag: "wx" });
          if (!(await boundedBytes(temporary)).equals(content)) throw Error("Verification failed");
        }
        await safe(folder, "dir");
        for (const dir of artFolders) await safe(path.join(folder, dir), "dir");
        if (stale()) return this.status();
        const committed = [];
        try {
          // Publish files and connection at the same cancellation boundary.
          for (const entry of staged) {
            fsSync.renameSync(entry.temporary, entry.dest);
            committed.push(entry);
            if (!fsSync.readFileSync(entry.dest).equals(entry.content))
              throw Error("Verification failed");
          }
          selectRoot(true);
          this.state = {
            ...this.state, setupIssue: null, addonInstalled: true, addonCurrent: true,
            addonVersion: sources[0][1].toString("utf8").match(/^## Version:\s*(.+)$/m)?.[1]?.trim() || null,
            addonUpdatedAt: new Date().toISOString(), phase: "needs-reload",
            message: "Companion prepared. You can play now; the files activate at your next game login. Desktop progress reflects game saves.",
          };
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
    } catch {
      if (!stale() && selectRoot(false))
        this.state = {
          ...this.state,
          setupIssue: "install-failed",
          addonInstalled: false,
          addonCurrent: false,
          addonVersion: null,
          phase: "needs-addon",
          message: INSTALL_FAILURE,
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
      let malformed = false, unreadableAccountCount = 0, newestWrite = 0;
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
          // When WoW wrote the file (a /reload, logout or exit), not when the addon captured.
          const written = (await fs.stat(file).catch(() => null))?.mtimeMs;
          if (Number.isFinite(written) && written > newestWrite) newestWrite = written;
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
        savedAt: newestWrite ? new Date(newestWrite).toISOString() : this.state.savedAt || null,
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
      setupIssue: null,
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
module.exports = { GameSync, parseSavedVariables, ADDON_FILES: OWN, ART_DIRS };
