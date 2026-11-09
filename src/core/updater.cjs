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
    throw updateError("SIGNATURE");
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
const errorCodes = new Set([
  "NETWORK",
  "TIMEOUT",
  "HTTP",
  "REDIRECT",
  "URL",
  "BODY_ABORT",
  "SIZE",
  "HASH",
  "SIGNATURE",
  "MANIFEST",
  "DISCOVERY",
  "PATH",
  "PERMISSION",
  "DISK",
  "CACHE",
  "CANCELLED",
]);
function updateError(code, fields = {}) {
  return Object.assign(new Error("Update operation failed"), {
    updateCode: code,
    ...fields,
  });
}
function classify(error, stage) {
  if (errorCodes.has(error?.updateCode)) return error.updateCode;
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EPIPE",
    ].includes(error?.code)
  )
    return "NETWORK";
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code)) return "TIMEOUT";
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) return "PERMISSION";
  if (["ENOSPC", "EDQUOT"].includes(error?.code)) return "DISK";
  if (error?.code === "ABORT_ERR") return "CANCELLED";
  return stage === "download"
    ? "NETWORK"
    : stage === "cache"
      ? "CACHE"
      : stage === "discovery"
        ? "DISCOVERY"
        : "MANIFEST";
}
function retryable(error) {
  const code = classify(error, "download");
  return (
    ["NETWORK", "TIMEOUT", "BODY_ABORT"].includes(code) ||
    (code === "HTTP" && (error.httpStatus === 429 || error.httpStatus >= 500))
  );
}
function failureMessage(stage, code) {
  if (["HASH", "SIZE", "SIGNATURE", "MANIFEST"].includes(code))
    return "The update could not be verified safely. Retry, or use the Releases page.";
  if (stage === "discovery")
    return "The release check could not connect. Retry, or use the Releases page.";
  if (stage === "manifest")
    return "The update information could not be retrieved. Retry, or use the Releases page.";
  if (stage === "cache") {
    if (code === "DISK")
      return "There is not enough space to save the update. Free some space and retry.";
    if (code === "PERMISSION")
      return "Windows could not save the update. Check folder access and retry, or use the Releases page.";
    return "The update cache could not be used safely. Retry, or use the Releases page.";
  }
  return "The update download was interrupted. Retry, or use the Releases page.";
}
function retryDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(updateError("CANCELLED"));
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(updateError("CANCELLED"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function request(
  url,
  signal,
  limit,
  onChunk,
  api = false,
  redirects = 0,
  transport = https,
) {
  return new Promise((resolve, reject) => {
    if ((!api && !allowedURL(url)) || (api && url !== API) || redirects > 5)
      return reject(updateError(redirects > 5 ? "REDIRECT" : "URL"));
    let size = 0,
      response,
      settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(
        updateError(classify(error, "download"), {
          ...(Number.isInteger(response?.statusCode)
            ? { httpStatus: response.statusCode }
            : {}),
          bytes: size,
        }),
      );
    };
    const target = new URL(url);
    if (
      !api &&
      redirects === 0 &&
      target.origin === "https://github.com" &&
      target.pathname.startsWith(
        "/farena-ai/Backstage-Forever/releases/download/",
      )
    ) {
      // Refresh GitHub's redirect metadata; never alter the signed CDN URL.
      target.searchParams.set("_bf", crypto.randomUUID());
    }
    const req = transport.get(
      target.href,
      {
        signal,
        headers: {
          "User-Agent": "Backstage-Forever",
          "Cache-Control": "no-cache",
          Accept: api
            ? "application/vnd.github+json"
            : "application/octet-stream",
        },
      },
      (res) => {
        response = res;
        res.on("error", fail);
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, url).href;
          } catch {
            return fail(updateError("REDIRECT"));
          }
          // The redirected request owns completion and cancellation from here.
          settled = true;
          return request(
            next,
            signal,
            limit,
            onChunk,
            false,
            redirects + 1,
            transport,
          ).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(updateError("HTTP"));
        }
        if (Number(res.headers["content-length"]) > limit) {
          fail(updateError("SIZE"));
          res.destroy();
          return;
        }
        const expected =
          res.headers["content-length"] === undefined
            ? null
            : Number(res.headers["content-length"]);
        const chunks = [];
        res.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > limit) {
            fail(updateError("SIZE"));
            res.destroy();
            return;
          }
          try {
            if (onChunk) onChunk(chunk, size);
            else chunks.push(chunk);
          } catch (e) {
            fail(e);
            res.destroy();
          }
        });
        res.on("aborted", () => fail(updateError("BODY_ABORT")));
        res.on("close", () => {
          if (!settled) fail(updateError("BODY_ABORT"));
        });
        res.on("end", () => {
          if (settled) return;
          if (
            expected !== null &&
            (!Number.isSafeInteger(expected) || expected !== size)
          )
            return fail(updateError("BODY_ABORT"));
          settled = true;
          resolve(onChunk ? size : Buffer.concat(chunks));
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(updateError("TIMEOUT")));
    req.on("error", fail);
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
    retryDelay: wait = retryDelay,
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
      retryDelay: wait,
    });
    this.epoch = 0;
    this.timers = [];
    this.preferences = { automatic: true, installOnQuit: true };
    this.phase = packaged && platform === "win32" ? "idle" : "unsupported";
    this.progress = 0;
    this.lastChecked = null;
    this.message = "";
    this.ready = null;
    this.diagnostic = null;
    this.retryAttempt = 0;
    try {
      this.safeDir();
    } catch (error) {
      if (this.phase !== "unsupported") this.phase = "error";
      this.recordFailure(error, "cache");
      this.message = failureMessage("cache", this.diagnostic.code);
      return;
    }
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
    const resolved = path.resolve(this.dir);
    const equal = (a, b) =>
      process.platform === "win32"
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
    // Validate the existing ancestor before recursive mkdir can follow a junction.
    let ancestor = resolved;
    while (true) {
      const stat = fs.lstatSync(ancestor, { throwIfNoEntry: false });
      if (stat) {
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          !equal(fs.realpathSync(ancestor), ancestor)
        )
          throw updateError("PATH");
        break;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw updateError("PATH");
      ancestor = parent;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    if (
      fs.lstatSync(this.dir).isSymbolicLink() ||
      !equal(fs.realpathSync(this.dir), resolved)
    )
      throw updateError("PATH");
  }
  safeFile(name) {
    this.safeDir();
    const file = path.join(this.dir, name);
    if (
      fs.existsSync(file) &&
      (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    )
      throw updateError("PATH");
    return file;
  }
  atomic(name, data) {
    const target = this.safeFile(name),
      tmp = this.safeFile(name + "." + crypto.randomUUID() + ".tmp");
    try {
      fs.writeFileSync(tmp, data, { flag: "wx", mode: 0o600 });
      fs.renameSync(tmp, target);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }
  recordFailure(error, stage, attempt = 0, bytes = 0) {
    this.diagnostic = {
      stage,
      code: classify(error, stage),
      attempt: Math.max(0, Math.min(3, attempt)),
      bytes: Math.max(
        0,
        Math.min(MAX, Number.isSafeInteger(bytes) ? bytes : 0),
      ),
      ...(Number.isInteger(error?.httpStatus) &&
      error.httpStatus >= 100 &&
      error.httpStatus <= 599
        ? { httpStatus: error.httpStatus }
        : {}),
    };
    try {
      this.atomic("diagnostic.json", JSON.stringify(this.diagnostic));
    } catch {}
  }
  status() {
    return {
      phase: this.phase,
      currentVersion: this.currentVersion,
      availableVersion:
        this.availableVersion ?? this.ready?.manifest.version ?? null,
      readyVersion: this.ready?.manifest.version ?? null,
      ...this.preferences,
      progress: this.progress,
      lastChecked: this.lastChecked,
      message: this.message,
      diagnostic: this.diagnostic ? { ...this.diagnostic } : null,
      retryAttempt: this.retryAttempt,
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
  async fetchMetadata(url, signal, limit, api, stage, active) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      active();
      this.retryAttempt = attempt;
      try {
        const result = await this.fetch(url, signal, limit, null, api);
        active();
        this.diagnostic = null;
        this.message = "";
        return result;
      } catch (error) {
        active();
        this.recordFailure(error, stage, attempt, error.bytes);
        if (!retryable(error) || attempt === 3) throw error;
      }
      await this.retryDelay(attempt === 1 ? 500 : 1500, signal);
      active();
    }
  }
  async performCheck() {
    const epoch = this.epoch;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const active = () => {
      if (epoch !== this.epoch || signal.aborted)
        throw updateError("CANCELLED");
    };
    this.phase = "checking";
    this.message = "";
    this.diagnostic = null;
    this.retryAttempt = 0;
    this.availableVersion = null;
    let stage = "discovery",
      bytes = 0;
    try {
      const releases = JSON.parse(
        (
          await this.fetchMetadata(
            API,
            signal,
            1024 * 1024,
            true,
            stage,
            active,
          )
        ).toString("utf8"),
      );
      active();
      if (!Array.isArray(releases) || releases.length > 30)
        throw Error("Invalid release list");
      this.lastChecked = new Date().toISOString();
      const release = releases
        .filter(
          (r) =>
            r &&
            !r.draft &&
            typeof r.tag_name === "string" &&
            r.tag_name.startsWith("v") &&
            newer(r.tag_name.slice(1), this.currentVersion),
        )
        .sort((a, b) =>
          newer(a.tag_name.slice(1), b.tag_name.slice(1)) ? -1 : 1,
        )[0];
      if (!release) {
        this.phase = this.ready ? "ready" : "current";
        return this.status();
      }
      active();
      this.availableVersion = release.tag_name.slice(1);
      stage = "manifest";
      const url = `${REPO}/releases/download/${release.tag_name}/backstage-update.json`;
      if (
        !Array.isArray(release.assets) ||
        !release.assets.some(
          (a) =>
            a &&
            a.name === "backstage-update.json" &&
            a.browser_download_url === url,
        )
      )
        throw updateError("MANIFEST");
      const envelope = JSON.parse(
        (
          await this.fetchMetadata(url, signal, 32768, false, stage, active)
        ).toString("utf8"),
      );
      active();
      const manifest = verifyManifest(
        envelope,
        this.publicKey,
        this.currentVersion,
      );
      if (manifest.releaseTag !== release.tag_name)
        throw updateError("MANIFEST");
      const chosen = { envelope, manifest };
      if (
        this.ready &&
        !newer(chosen.manifest.version, this.ready.manifest.version)
      ) {
        this.phase = "ready";
        return this.status();
      }
      this.availableVersion = chosen.manifest.version;
      this.phase = "downloading";
      let verifiedTmp;
      for (let attempt = 1; attempt <= 3; attempt++) {
        active();
        this.retryAttempt = attempt;
        this.progress = 0;
        bytes = 0;
        stage = "cache";
        const tmp = this.safeFile(
          "download-" + crypto.randomUUID() + ".partial",
        );
        let fd;
        let partialCreated = false;
        let successful = false;
        try {
          fd = fs.openSync(tmp, "wx", 0o600);
          partialCreated = true;
          const hash = crypto.createHash("sha256");
          stage = "download";
          const size = await this.fetch(
            chosen.manifest.url,
            signal,
            chosen.manifest.size,
            (chunk) => {
              active();
              if (
                !Buffer.isBuffer(chunk) ||
                bytes + chunk.length > chosen.manifest.size
              )
                throw updateError("SIZE");
              bytes += chunk.length;
              stage = "cache";
              let offset = 0;
              while (offset < chunk.length) {
                const written = fs.writeSync(
                  fd,
                  chunk,
                  offset,
                  chunk.length - offset,
                );
                if (written <= 0) throw updateError("DISK");
                offset += written;
              }
              hash.update(chunk);
              this.progress = Math.floor((bytes / chosen.manifest.size) * 100);
              stage = "download";
            },
          );
          active();
          if (size !== chosen.manifest.size || bytes !== chosen.manifest.size)
            throw updateError("SIZE");
          if (hash.digest("hex") !== chosen.manifest.sha256)
            throw updateError("HASH");
          stage = "cache";
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fd = undefined;
          successful = true;
          verifiedTmp = tmp;
        } catch (error) {
          active();
          this.recordFailure(error, stage, attempt, bytes);
          if (stage !== "download" || !retryable(error) || attempt === 3)
            throw error;
        } finally {
          let cleanupError;
          if (fd !== undefined) {
            try {
              fs.closeSync(fd);
            } catch (error) {
              cleanupError = error;
            }
          }
          if (!successful && partialCreated) {
            try {
              fs.unlinkSync(tmp);
            } catch (error) {
              if (error.code !== "ENOENT") cleanupError ??= error;
            }
          }
          if (cleanupError) {
            stage = "cache";
            const code = classify(cleanupError, stage);
            throw updateError(
              ["PERMISSION", "DISK", "PATH"].includes(code) ? code : "CACHE",
            );
          }
        }
        if (successful) break;
        this.message = "The download was interrupted. Retrying automatically…";
        await this.retryDelay(attempt === 1 ? 500 : 1500, signal);
        active();
      }
      const tmp = verifiedTmp;
      stage = "cache";
      try {
        active();
        fs.renameSync(tmp, this.safeFile(filename(chosen.manifest.version)));
        this.atomic("ready.json", JSON.stringify(chosen.envelope));
        this.ready = chosen;
        this.phase = "ready";
        this.progress = 100;
        this.message = "";
        this.diagnostic = null;
        try {
          fs.unlinkSync(this.safeFile("diagnostic.json"));
        } catch {}
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    } catch (error) {
      if (epoch === this.epoch) {
        this.phase = this.ready ? "ready" : "error";
        this.recordFailure(
          error,
          stage,
          this.retryAttempt,
          stage === "manifest" || stage === "discovery"
            ? (error.bytes ?? bytes)
            : bytes,
        );
        this.message = failureMessage(stage, this.diagnostic.code);
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
    this.diagnostic = null;
    this.retryAttempt = 0;
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
