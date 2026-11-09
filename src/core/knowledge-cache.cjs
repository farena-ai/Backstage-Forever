"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const {
  FILES,
  BUILD,
  COMMIT,
  LIMIT,
  normalizeData,
  KnowledgeIndex,
  hash,
  observedBuild,
} = require("./knowledge.cjs");
const BRANCH =
  "https://api.github.com/repos/JIVESCORP/eg-link-output-wowf/branches/main";
class KnowledgeService {
  constructor({
    dataDir,
    bundledPath = path.join(__dirname, "../../data/forever/pack.json"),
    fetcher = fetch,
    now = Date.now,
  } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.cacheDir = path.join(this.dataDir, "knowledge-v1");
    this.fetcher = fetcher;
    this.now = now;
    this.bundled = new KnowledgeIndex(
      JSON.parse(fs.readFileSync(bundledPath, "utf8")),
    );
    this.packs = new Map([[this.bundled.pack.build, this.bundled]]);
    this.loaded = new Set();
    this.checked = {};
    this.automatic = true;
    this.connected = false;
    this.build = null;
    this.pending = null;
    this.controller = null;
    this.epoch = 0;
    this.message = "Bundled reference data available offline.";
    this.phase = null;
    this.attempted = {};
    this.captureObserved = false;
    try {
      this.safeDir(false);
      const p = this.read("preferences.json", 10000);
      if (
        typeof p.automatic !== "boolean" ||
        !p.checked ||
        typeof p.checked !== "object"
      )
        throw Error();
      this.automatic = p.automatic;
      for (const [b, v] of Object.entries(p.checked))
        if (
          BUILD.test(b) &&
          typeof v === "string" &&
          Number.isFinite(Date.parse(v))
        )
          this.checked[b] = v;
    } catch {}
  }
  safeDir(create = true) {
    let current = this.cacheDir,
      expected;
    while (true) {
      if (fs.existsSync(current)) {
        const s = fs.lstatSync(current);
        if (!s.isDirectory() || s.isSymbolicLink())
          throw Error("Invalid reference directory.");
        // Native realpath expands Windows 8.3 aliases. Anchor the expected child
        // to an existing checked parent before creation, not its lexical spelling.
        if (!expected && current !== this.cacheDir)
          expected = path.join(
            fs.realpathSync.native(current),
            path.relative(current, this.cacheDir),
          );
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (create && !fs.existsSync(this.cacheDir))
      fs.mkdirSync(this.cacheDir, { recursive: true });
    if (fs.existsSync(this.cacheDir)) {
      const canonical = fs.realpathSync.native(this.cacheDir);
      if (
        (process.platform === "win32" ? canonical.toLowerCase() : canonical) !==
        (process.platform === "win32" ? expected.toLowerCase() : expected)
      )
        throw Error("Invalid reference directory.");
    }
  }
  read(name, max) {
    this.safeDir(false);
    const file = path.join(this.cacheDir, name),
      s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > max)
      throw Error("Invalid reference cache.");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  write(name, value) {
    this.safeDir();
    const file = path.join(this.cacheDir, name),
      temp = file + ".tmp";
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw Error("Invalid reference cache.");
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx" });
    fs.renameSync(temp, file);
  }
  preferences() {
    this.write("preferences.json", {
      automatic: this.automatic,
      checked: this.checked,
    });
  }
  load(build) {
    if (!BUILD.test(build) || this.loaded.has(build)) return;
    this.loaded.add(build);
    try {
      const c = this.read(`${build}.json`, 12 * 1024 * 1024);
      if (
        c.schemaVersion !== 1 ||
        typeof c.payload !== "string" ||
        hash(c.payload) !== c.sha256
      )
        throw Error();
      const index = new KnowledgeIndex(JSON.parse(c.payload));
      if (index.pack.build !== build) throw Error();
      // Both dates have passed strict pack validation. An upgrade's newer bundled
      // observations must remain useful offline; equal/newer saved caches still win.
      const existing = this.packs.get(build);
      if (!existing || index.pack.observedThrough >= existing.pack.observedThrough)
        this.packs.set(build, index);
    } catch {}
  }
  index(profile) {
    const build = profile === undefined ? this.build : profile?.clientBuild;
    if (build) {
      this.load(build);
      return this.packs.get(build) || null;
    }
    return this.bundled;
  }
  setContext(profile = {}, connected = false) {
    const next = BUILD.test(profile?.clientBuild) ? profile.clientBuild : null,
      observed = Boolean(observedBuild(profile));
    if (
      this.build !== next ||
      this.connected !== Boolean(connected) ||
      this.captureObserved !== observed
    )
      this.cancel();
    this.build = next;
    this.captureObserved = observed;
    this.connected = Boolean(connected);
    if (next) this.load(next);
    this.maybeRefresh();
  }
  maybeRefresh() {
    const last = Math.max(
      Date.parse(this.checked[this.build]) || 0,
      this.attempted[this.build] || 0,
    );
    if (
      this.automatic &&
      this.connected &&
      this.captureObserved &&
      this.build &&
      (!last || this.now() - last >= 86400000)
    )
      void this.refresh().catch(() => {});
  }
  status(profile) {
    const selected =
        profile === undefined ? this.build : profile?.clientBuild || null,
      index = this.index(profile),
      pack = (index || this.bundled).pack,
      observed =
        profile === undefined ? this.captureObserved : observedBuild(profile);
    return {
      phase: this.pending
        ? "refreshing"
        : selected && !index
          ? "mismatch"
          : this.phase || (selected && observed ? "ready" : "reference"),
      build: selected,
      packBuild: pack.build,
      bundledBuild: this.bundled.pack.build,
      sourceCommit: pack.sourceCommit,
      observedThrough: pack.observedThrough,
      lastChecked: this.checked[selected || pack.build] || null,
      automatic: this.automatic,
      counts: { ...pack.counts },
      message:
        selected && !index
          ? `No reference pack matches character build ${selected}; bundled reference build ${this.bundled.pack.build} remains available for manual profiles.`
          : this.message,
      coverage:
        "Partial live observations; reported links are not proven prerequisites. NPC positions are approximate.",
      attribution: pack.attribution,
      sourceUrl: `https://github.com/JIVESCORP/eg-link-output-wowf/tree/${pack.sourceCommit}/data/wowf/${pack.build}`,
    };
  }
  cancel() {
    this.epoch++;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    this.phase = null;
  }
  setAutomatic(value) {
    if (typeof value !== "boolean")
      throw Error("Invalid reference preference.");
    if (!value) this.cancel();
    this.automatic = value;
    this.preferences();
    this.maybeRefresh();
    return this.status();
  }
  async readResponse(url, signal, max) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw Error("Cancelled");
      try {
        const requestSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(20000),
        ]);
        const r = await this.fetcher(url, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal: requestSignal,
        });
        if (requestSignal.aborted) {
          await r.body?.cancel().catch(() => {});
          throw Error("Cancelled");
        }
        if (!r.ok) {
          await r.body?.cancel().catch(() => {});
          if (attempt === 0 && (r.status === 429 || r.status >= 500)) continue;
          throw Error("Unavailable");
        }
        if (Number(r.headers.get("content-length")) > max) {
          await r.body?.cancel().catch(() => {});
          throw Error("Oversized");
        }
        const reader = r.body?.getReader();
        if (!reader) throw Error("Unavailable");
        let size = 0;
        const chunks = [];
        const abort = () => {
          void reader.cancel().catch(() => {});
        };
        requestSignal.addEventListener("abort", abort, { once: true });
        try {
          while (true) {
            if (requestSignal.aborted) throw Error("Cancelled");
            const { value, done } = await reader.read();
            if (requestSignal.aborted) throw Error("Cancelled");
            if (done) break;
            size += value.byteLength;
            if (size > max) throw Error("Oversized");
            chunks.push(Buffer.from(value));
          }
        } finally {
          requestSignal.removeEventListener("abort", abort);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        return Buffer.concat(chunks);
      } catch (error) {
        if (
          signal.aborted ||
          attempt === 1 ||
          /Oversized|Unavailable/.test(error.message)
        )
          throw error;
      }
    }
  }
  refresh() {
    if (this.pending) return this.pending;
    const build = this.build || this.bundled.pack.build,
      epoch = this.epoch,
      controller = new AbortController();
    this.controller = controller;
    this.phase = null;
    const valid = () => epoch === this.epoch && !controller.signal.aborted;
    const run = async () => {
      try {
        const branch = JSON.parse(
            (
              await this.readResponse(BRANCH, controller.signal, 64000)
            ).toString("utf8"),
          ),
          commit = branch?.commit?.sha;
        if (!COMMIT.test(commit)) throw Error("Invalid commit");
        if (!valid()) return this.status();
        const existing = this.index({ clientBuild: build });
        if (existing?.pack.sourceCommit !== commit) {
          const inputs = {};
          let total = 0;
          for (const name of FILES) {
            const bytes = await this.readResponse(
              `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${name}`,
              controller.signal,
              LIMIT,
            );
            total += bytes.length;
            if (total > 12 * 1024 * 1024) throw Error("Oversized");
            inputs[name] = bytes;
            if (!valid()) return this.status();
          }
          const pack = normalizeData(inputs, { commit, build }),
            index = new KnowledgeIndex(pack),
            payload = JSON.stringify(pack);
          if (!valid()) return this.status();
          this.write(`${build}.json`, {
            schemaVersion: 1,
            sha256: hash(payload),
            payload,
          });
          this.packs.set(build, index);
        }
        if (valid()) {
          this.checked[build] = new Date(this.now()).toISOString();
          this.preferences();
          this.message =
            "Reference source checked; collection dates describe the observations.";
        }
      } catch {
        if (valid()) {
          this.attempted[build] = this.now();
          this.phase = "offline";
          this.message =
            "Reference refresh unavailable; last good data preserved.";
        }
      } finally {
        if (valid()) {
          this.pending = null;
          this.controller = null;
        }
      }
      return this.status();
    };
    this.pending = run();
    return this.pending;
  }
  async reset() {
    const pending = this.pending;
    this.cancel();
    this.connected = false;
    this.captureObserved = false;
    this.build = null;
    this.packs = new Map([[this.bundled.pack.build, this.bundled]]);
    this.loaded.clear();
    this.checked = {};
    this.attempted = {};
    this.automatic = true;
    this.message = "Bundled reference data available offline.";
    await pending?.catch(() => {});
    if (fs.existsSync(this.cacheDir)) {
      this.safeDir(false);
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
    }
    return this.status();
  }
}
module.exports = { KnowledgeService, BRANCH };
