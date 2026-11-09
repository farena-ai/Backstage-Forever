"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { spawn } = require("node:child_process");
const REPO = "https://github.com/farena-ai/Backstage-Forever";
const API =
  "https://api.github.com/repos/farena-ai/Backstage-Forever/releases?per_page=30";
const MAX = 512 * 1024 * 1024;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const filename = (v) => `Backstage-Forever-${v}-Windows-x64-Setup.exe`;
const assetURL = (v) => `${REPO}/releases/download/v${v}/${filename(v)}`;
function newer(a, b) {
  if (!versionPattern.test(a) || !versionPattern.test(b)) return false;
  const x = a.split(".").map(BigInt),
    y = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}
function allowedURL(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
function decode(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 32768 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw Error("Invalid manifest");
  return Buffer.from(value, "base64");
}
function verifyManifest(envelope, key, current) {
  if (!envelope || Object.keys(envelope).sort().join() !== "payload,signature")
    throw Error("Invalid envelope");
  const publicKey = key?.type === "public" ? key : crypto.createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519")
    throw Error("Invalid key algorithm");
  const bytes = decode(envelope.payload),
    signature = decode(envelope.signature);
  if (
    signature.length !== 64 ||
    !crypto.verify(null, bytes, publicKey, signature)
  )
    throw Error("Invalid signature");
  const m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    !m ||
    Object.keys(m).sort().join() !==
      "publishedAt,releaseTag,schemaVersion,sha256,size,url,version" ||
    m.schemaVersion !== 1 ||
    !newer(m.version, current) ||
    m.releaseTag !== `v${m.version}` ||
    m.url !== assetURL(m.version) ||
    !Number.isSafeInteger(m.size) ||
    m.size <= 0 ||
    m.size > MAX ||
    typeof m.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    typeof m.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(m.publishedAt))
  )
    throw Error("Invalid signed update");
  return m;
}
function request(url, signal, limit, onChunk, api = false, redirects = 0) {
  return new Promise((resolve, reject) => {
    if ((!api && !allowedURL(url)) || (api && url !== API) || redirects > 5)
      return reject(Error("Unsafe update URL"));
    const req = https.get(
      url,
      {
        signal,
        headers: {
          "User-Agent": "Backstage-Forever",
          Accept: api
            ? "application/vnd.github+json"
            : "application/octet-stream",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, url).href;
          } catch {
            return reject(Error("Invalid redirect"));
          }
          return request(
            next,
            signal,
            limit,
            onChunk,
            false,
            redirects + 1,
          ).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(Error("Update unavailable"));
        }
        if (Number(res.headers["content-length"]) > limit) {
          res.destroy();
          return reject(Error("Update too large"));
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > limit) {
            res.destroy(Error("Update too large"));
            return;
          }
          try {
            if (onChunk) onChunk(chunk, size);
            else chunks.push(chunk);
          } catch (e) {
            res.destroy(e);
          }
        });
        res.on("error", reject);
        res.on("end", () => resolve(onChunk ? size : Buffer.concat(chunks)));
      },
    );
    req.setTimeout(30000, () => req.destroy(Error("Update request timed out")));
    req.on("error", reject);
  });
}
function runInstaller(file, { restart = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      file,
      restart ? ["/S", "--updated", "--force-run"] : ["/S", "--updated"],
      {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
class Updater {
  constructor({
    dataDir,
    currentVersion,
    publicKey,
    packaged = false,
    platform = process.platform,
    fetch = request,
    installRunner = runInstaller,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    Object.assign(this, {
      dir: path.join(dataDir, "updates"),
      currentVersion,
      publicKey,
      packaged,
      platform,
      fetch,
      installRunner,
      setTimer,
      clearTimer,
    });
    this.epoch = 0;
    this.timers = [];
    this.preferences = { automatic: true, installOnQuit: true };
    this.phase = packaged && platform === "win32" ? "idle" : "unsupported";
    this.progress = 0;
    this.lastChecked = null;
    this.message = "";
    this.ready = null;
    this.safeDir();
    try {
      const p = JSON.parse(
        fs.readFileSync(path.join(this.dir, "preferences.json"), "utf8"),
      );
      if (
        typeof p.automatic === "boolean" &&
        typeof p.installOnQuit === "boolean"
      )
        this.preferences = {
          automatic: p.automatic,
          installOnQuit: p.installOnQuit,
        };
    } catch {}
    if (!this.preferences.automatic && this.phase !== "unsupported")
      this.phase = "disabled";
    this.restore();
  }
  safeDir() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (
      fs.lstatSync(this.dir).isSymbolicLink() ||
      fs.realpathSync(this.dir) !== path.resolve(this.dir)
    )
      throw Error("Unsafe update cache");
  }
  safeFile(name) {
    this.safeDir();
    const file = path.join(this.dir, name);
    if (
      fs.existsSync(file) &&
      (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    )
      throw Error("Unsafe update file");
    return file;
  }
  atomic(name, data) {
    const target = this.safeFile(name),
      tmp = this.safeFile(name + "." + crypto.randomUUID() + ".tmp");
    fs.writeFileSync(tmp, data, { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, target);
  }
  status() {
    return {
      phase: this.phase,
      currentVersion: this.currentVersion,
      availableVersion:
        this.ready?.manifest.version ?? this.availableVersion ?? null,
      ...this.preferences,
      progress: this.progress,
      lastChecked: this.lastChecked,
      message: this.message,
    };
  }
  verifyFile(m) {
    const file = this.safeFile(filename(m.version));
    const stat = fs.statSync(file);
    if (
      stat.size !== m.size ||
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex") !== m.sha256
    )
      throw Error("Invalid installer");
    return file;
  }
  restore() {
    try {
      const envelope = JSON.parse(
        fs.readFileSync(this.safeFile("ready.json"), "utf8"),
      );
      const manifest = verifyManifest(
        envelope,
        this.publicKey,
        this.currentVersion,
      );
      this.verifyFile(manifest);
      if (this.preferences.automatic) {
        this.ready = { envelope, manifest };
        this.phase =
          this.packaged && this.platform === "win32" ? "ready" : "unsupported";
      }
    } catch {}
  }
  start() {
    if (
      this.installing ||
      !this.packaged ||
      this.platform !== "win32" ||
      !this.preferences.automatic
    )
      return;
    const epoch = this.epoch;
    const active = () =>
      epoch === this.epoch && this.preferences.automatic && !this.stopped;
    const tick = () => {
      if (!active()) return;
      this.check().finally(() => {
        if (active()) this.timers.push(this.setTimer(tick, 6 * 60 * 60 * 1000));
      });
    };
    this.timers.push(this.setTimer(tick, 15000));
  }
  cancel() {
    this.epoch++;
    this.controller?.abort();
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers = [];
  }
  async setPreferences(input) {
    if (
      !input ||
      Object.keys(input).sort().join() !== "automatic,installOnQuit" ||
      typeof input.automatic !== "boolean" ||
      typeof input.installOnQuit !== "boolean"
    )
      throw Error("Invalid update preferences");
    this.cancel();
    this.preferences = { ...input };
    this.ready = null;
    this.availableVersion = null;
    this.phase =
      this.packaged && this.platform === "win32"
        ? input.automatic
          ? "idle"
          : "disabled"
        : "unsupported";
    this.atomic("preferences.json", JSON.stringify(input));
    if (input.automatic) {
      this.restore();
      this.start();
    }
    return this.status();
  }
  async check() {
    if (this.pending) return this.pending;
    this.pending = this.performCheck().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async performCheck() {
    const epoch = this.epoch;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const active = () => {
      if (epoch !== this.epoch || signal.aborted) throw Error("Cancelled");
    };
    this.phase = "checking";
    this.message = "";
    try {
      const releases = JSON.parse(
        (await this.fetch(API, signal, 1024 * 1024, null, true)).toString(
          "utf8",
        ),
      );
      active();
      if (!Array.isArray(releases) || releases.length > 30)
        throw Error("Invalid release list");
      const candidates = [];
      for (const r of releases) {
        active();
        if (
          r.draft ||
          typeof r.tag_name !== "string" ||
          !r.tag_name.startsWith("v") ||
          !newer(r.tag_name.slice(1), this.currentVersion) ||
          !Array.isArray(r.assets)
        )
          continue;
        const url = `${REPO}/releases/download/${r.tag_name}/backstage-update.json`;
        if (
          !r.assets.some(
            (a) =>
              a.name === "backstage-update.json" &&
              a.browser_download_url === url,
          )
        )
          continue;
        try {
          const envelope = JSON.parse(
            (await this.fetch(url, signal, 32768)).toString("utf8"),
          );
          active();
          const manifest = verifyManifest(
            envelope,
            this.publicKey,
            this.currentVersion,
          );
          if (manifest.releaseTag !== r.tag_name) continue;
          candidates.push({ envelope, manifest });
        } catch (e) {
          active();
        }
      }
      active();
      this.lastChecked = new Date().toISOString();
      candidates.sort((a, b) =>
        newer(a.manifest.version, b.manifest.version) ? -1 : 1,
      );
      const chosen = candidates[0];
      if (!chosen) {
        this.phase = this.ready ? "ready" : "current";
        return this.status();
      }
      if (
        this.ready &&
        !newer(chosen.manifest.version, this.ready.manifest.version)
      ) {
        this.phase = "ready";
        return this.status();
      }
      this.availableVersion = chosen.manifest.version;
      this.phase = "downloading";
      this.progress = 0;
      const tmp = this.safeFile("download-" + crypto.randomUUID() + ".partial");
      const fd = fs.openSync(tmp, "wx", 0o600);
      const hash = crypto.createHash("sha256");
      let size;
      try {
        size = await this.fetch(
          chosen.manifest.url,
          signal,
          chosen.manifest.size,
          (chunk, n) => {
            active();
            let offset = 0;
            while (offset < chunk.length)
              offset += fs.writeSync(fd, chunk, offset);
            hash.update(chunk);
            this.progress = Math.floor((n / chosen.manifest.size) * 100);
          },
        );
        active();
        if (
          size !== chosen.manifest.size ||
          hash.digest("hex") !== chosen.manifest.sha256
        )
          throw Error("Update verification failed");
        fs.fsyncSync(fd);
      } catch (e) {
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          fs.unlinkSync(tmp);
        } catch {}
        throw e;
      } finally {
        try {
          fs.closeSync(fd);
        } catch {}
      }
      try {
        active();
        fs.renameSync(tmp, this.safeFile(filename(chosen.manifest.version)));
        this.atomic("ready.json", JSON.stringify(chosen.envelope));
        this.ready = chosen;
        this.phase = "ready";
        this.progress = 100;
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    } catch {
      if (epoch === this.epoch) {
        this.phase = this.ready ? "ready" : "error";
        this.message =
          "The update could not be verified or downloaded. Try again later.";
      }
    }
    return this.status();
  }
  async install({ onQuit = false } = {}) {
    if (
      this.installing ||
      !this.packaged ||
      this.platform !== "win32" ||
      !this.ready ||
      (onQuit &&
        (!this.preferences.automatic || !this.preferences.installOnQuit))
    )
      return false;
    const epoch = this.epoch;
    const verified = verifyManifest(
      this.ready.envelope,
      this.publicKey,
      this.currentVersion,
    );
    const file = this.verifyFile(verified);
    if (epoch !== this.epoch) return false;
    this.installing = true;
    try {
      await this.installRunner(file, { restart: !onQuit });
      return true;
    } catch (error) {
      this.installing = false;
      throw error;
    }
  }
  async reset() {
    this.cancel();
    this.preferences = { automatic: false, installOnQuit: true };
    this.ready = null;
    this.availableVersion = null;
    await this.pending;
    this.safeDir();
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.preferences = { automatic: false, installOnQuit: true };
    this.phase =
      this.packaged && this.platform === "win32" ? "disabled" : "unsupported";
    this.progress = 0;
    this.lastChecked = null;
    this.message = "";
    this.safeDir();
    this.atomic("preferences.json", JSON.stringify(this.preferences));
    return this.status();
  }
  close() {
    this.stopped = true;
    this.cancel();
  }
}
module.exports = {
  Updater,
  verifyManifest,
  assetURL,
  allowedURL,
  request,
  newer,
};
