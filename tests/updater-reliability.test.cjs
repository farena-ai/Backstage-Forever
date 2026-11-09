"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Updater, request, assetURL } = require("../src/core/updater.cjs");
const keys = crypto.generateKeyPairSync("ed25519");
const data = Buffer.from("authenticated fixture bytes");
function envelope(version = "0.5.0", change = {}) {
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      version,
      releaseTag: `v${version}`,
      url: assetURL(version),
      size: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      publishedAt: "2026-11-09T00:00:00Z",
      ...change,
    }),
  );
  return {
    payload: bytes.toString("base64"),
    signature: crypto.sign(null, bytes, keys.privateKey).toString("base64"),
  };
}
function harness(t, options = {}) {
  const root = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, "bf-reliability-"));
  t.after(() => {
    const real = fs.realpathSync(dir);
    assert.equal(path.dirname(real), root);
    assert.ok(path.basename(real).startsWith("bf-reliability-"));
    fs.rmSync(real, { recursive: true, force: true });
  });
  let attempts = 0;
  const waits = [];
  const fetch = async (url, signal, limit, chunk) => {
    if (url.includes("api.github.com"))
      return Buffer.from(
        JSON.stringify([
          {
            tag_name: "v0.5.0",
            assets: [
              {
                name: "backstage-update.json",
                browser_download_url:
                  "https://github.com/farena-ai/Backstage-Forever/releases/download/v0.5.0/backstage-update.json",
              },
            ],
          },
        ]),
      );
    if (!chunk) {
      if (options.manifestError) throw options.manifestError;
      return Buffer.from(JSON.stringify(options.envelope || envelope()));
    }
    attempts++;
    if (options.download)
      return options.download({ attempts, chunk, signal, limit });
    chunk(data, data.length);
    return data.length;
  };
  const updater = new Updater({
    dataDir: dir,
    currentVersion: "0.3.0",
    packaged: true,
    platform: "win32",
    publicKey: keys.publicKey,
    fetch,
    retryDelay: async (ms, signal) => {
      waits.push(ms);
      if (signal.aborted) throw Error("cancelled");
    },
    installRunner: () => assert.fail("installer execution forbidden"),
    ...options,
  });
  t.after(() => updater.close());
  return { updater, dir, attempts: () => attempts, waits };
}
function transient(code = "ECONNRESET") {
  return Object.assign(
    Error("https://secret.invalid/?token=hidden C:\\private\\file"),
    { code },
  );
}

test("fresh transient retries reset hash, partial file and progress before success", async (t) => {
  const h = harness(t, {
    download: ({ attempts, chunk }) => {
      if (attempts < 3) {
        chunk(Buffer.from("discard"), 7);
        throw transient(attempts === 1 ? "ECONNRESET" : "ETIMEDOUT");
      }
      chunk(data, data.length);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
  assert.equal(h.attempts(), 3);
  assert.deepEqual(h.waits, [500, 1500]);
  assert.deepEqual(
    fs.readFileSync(
      path.join(h.dir, "updates", path.basename(assetURL("0.5.0"))),
    ),
    data,
  );
  assert.equal(
    fs
      .readdirSync(path.join(h.dir, "updates"))
      .some((n) => n.endsWith(".partial")),
    false,
  );
});
test("retry cap and diagnostics contain only bounded allowlisted fields", async (t) => {
  const h = harness(t, {
    download: ({ chunk }) => {
      chunk(Buffer.from("x"), 1);
      throw transient();
    },
  });
  const status = await h.updater.check();
  assert.equal(status.phase, "error");
  assert.equal(h.attempts(), 3);
  assert.deepEqual(status.diagnostic, {
    stage: "download",
    code: "NETWORK",
    attempt: 3,
    bytes: 1,
  });
  assert.match(status.message, /download.*retry/i);
  const saved = fs.readFileSync(
    path.join(h.dir, "updates/diagnostic.json"),
    "utf8",
  );
  assert.ok(saved.length < 512);
  assert.doesNotMatch(saved, /secret|token|private|stack|https:/);
});
test("cancellation during backoff stops immediately without another request", async (t) => {
  let entered;
  const started = new Promise((r) => (entered = r));
  const h = harness(t, {
    download: () => {
      throw transient();
    },
    retryDelay: (_ms, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
        entered();
      }),
  });
  const check = h.updater.check();
  await started;
  await h.updater.setPreferences({ automatic: false, installOnQuit: false });
  await check;
  assert.equal(h.attempts(), 1);
  assert.equal(h.updater.status().phase, "disabled");
});
test("a rejected newer manifest is an error instead of a false up-to-date result", async (t) => {
  const h = harness(t, {
    manifestError: Object.assign(transient(), { bytes: 3 }),
  });
  const status = await h.updater.check();
  assert.equal(status.phase, "error");
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.diagnostic.stage, "manifest");
  assert.equal(status.diagnostic.bytes, 3);
  assert.match(status.message, /update information/i);
  assert.equal(h.attempts(), 0);
});
test("bad signature, hash and final size are permanent failures", async (t) => {
  for (const kind of ["signature", "hash", "size"]) {
    const e = envelope();
    if (kind === "signature") e.signature = Buffer.alloc(64).toString("base64");
    const h = harness(t, {
      envelope: e,
      download: ({ chunk }) => {
        const bytes =
          kind === "hash" ? Buffer.alloc(data.length, 1) : data.subarray(0, 2);
        chunk(bytes, bytes.length);
        return bytes.length;
      },
    });
    const status = await h.updater.check();
    assert.equal(status.phase, "error");
    assert.equal(h.attempts(), kind === "signature" ? 0 : 1);
    assert.equal(
      status.diagnostic.code,
      { signature: "SIGNATURE", hash: "HASH", size: "SIZE" }[kind],
    );
  }
});
test("a failed newer download preserves the previous verified ready cache", async (t) => {
  const h = harness(t, {
    download: () => {
      throw transient();
    },
  });
  const old = envelope("0.4.0");
  fs.writeFileSync(path.join(h.dir, "updates/ready.json"), JSON.stringify(old));
  fs.writeFileSync(
    path.join(h.dir, "updates", path.basename(assetURL("0.4.0"))),
    data,
  );
  h.updater.restore();
  const status = await h.updater.check();
  assert.equal(status.phase, "ready");
  assert.match(status.message, /download/i);
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.readyVersion, "0.4.0");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(h.dir, "updates/ready.json"))),
    old,
  );
});
test("only transient HTTP statuses retry and every retry starts at zero progress", async (t) => {
  for (const httpStatus of [429, 500, 503, 404]) {
    const h = harness(t, {
      download: ({ attempts }) => {
        assert.equal(h.updater.status().progress, 0);
        throw Object.assign(Error("private upstream text"), {
          updateCode: "HTTP",
          httpStatus,
        });
      },
    });
    await h.updater.check();
    assert.equal(h.attempts(), httpStatus === 404 ? 1 : 3);
    assert.equal(h.updater.status().diagnostic.httpStatus, httpStatus);
  }
});
test("unsafe installer target is permanent and cannot publish ready metadata", async (t) => {
  const h = harness(t);
  fs.mkdirSync(path.join(h.dir, "updates", path.basename(assetURL("0.5.0"))));
  const status = await h.updater.check();
  assert.equal(status.phase, "error");
  assert.equal(status.diagnostic.code, "PATH");
  assert.equal(h.attempts(), 1);
  assert.equal(fs.existsSync(path.join(h.dir, "updates/ready.json")), false);
});
test("disk-full and access errors identify the cache stage and never retry", async (t) => {
  for (const [systemCode, expected] of [
    ["ENOSPC", "DISK"],
    ["EPERM", "PERMISSION"],
  ]) {
    const h = harness(t);
    const write = fs.writeSync;
    try {
      fs.writeSync = () => {
        throw Object.assign(Error("C:\\private\\secret"), { code: systemCode });
      };
      const status = await h.updater.check();
      assert.equal(status.phase, "error");
      assert.equal(status.diagnostic.code, expected);
      assert.equal(status.diagnostic.stage, "cache");
      assert.equal(h.attempts(), 1);
      assert.doesNotMatch(status.message, /private|secret/);
    } finally {
      fs.writeSync = write;
    }
  }
});
test("signed manifest version must match the discovery candidate", async (t) => {
  const h = harness(t, { envelope: envelope("0.4.0") });
  const status = await h.updater.check();
  assert.equal(status.phase, "error");
  assert.equal(status.diagnostic.code, "MANIFEST");
  assert.equal(h.attempts(), 0);
});
test("Windows accepts cache casing but rejects junctions and ancestor redirection", (t) => {
  const h = harness(t);
  const original = h.updater.dir;
  h.updater.dir = original.replace("bf-reliability-", "BF-RELIABILITY-");
  if (process.platform === "win32")
    assert.doesNotThrow(() => h.updater.safeDir());
  h.updater.dir = original;
  const outside = path.join(h.dir, "outside");
  fs.mkdirSync(outside);
  const link = path.join(h.dir, "linked");
  fs.symlinkSync(
    outside,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  h.updater.dir = path.join(link, "updates");
  assert.throws(() => h.updater.safeDir());
  assert.equal(
    fs.existsSync(path.join(outside, "updates")),
    false,
    "reject redirected ancestors before creating cache files",
  );
});

test("an unsafe startup cache reports a usable error without reading redirected preferences", (t) => {
  const h = harness(t);
  h.updater.close();
  fs.rmdirSync(path.join(h.dir, "updates"));
  const outside = path.join(h.dir, "outside-startup");
  fs.mkdirSync(outside);
  fs.writeFileSync(
    path.join(outside, "preferences.json"),
    JSON.stringify({ automatic: false, installOnQuit: false }),
  );
  fs.symlinkSync(
    outside,
    path.join(h.dir, "updates"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const updater = new Updater({
    dataDir: h.dir,
    currentVersion: "0.3.0",
    packaged: true,
    platform: "win32",
    publicKey: keys.publicKey,
  });
  assert.equal(updater.status().phase, "error");
  assert.equal(updater.status().diagnostic.code, "PATH");
  assert.equal(updater.status().automatic, true);
  assert.match(updater.status().message, /cache.*safely/i);
  assert.deepEqual(fs.readdirSync(outside), ["preferences.json"]);
  updater.close();
});

test("transient discovery and manifest failures retry with bounded fresh requests", async (t) => {
  let discovery = 0,
    manifest = 0;
  const h = harness(t, {
    fetch: async (url, _signal, _limit, chunk) => {
      if (url.includes("api.github.com")) {
        if (++discovery < 3)
          throw Object.assign(Error("upstream details"), {
            updateCode: "HTTP",
            httpStatus: 504,
          });
        return Buffer.from(
          JSON.stringify([
            {
              tag_name: "v0.5.0",
              assets: [
                {
                  name: "backstage-update.json",
                  browser_download_url:
                    "https://github.com/farena-ai/Backstage-Forever/releases/download/v0.5.0/backstage-update.json",
                },
              ],
            },
          ]),
        );
      }
      if (!chunk) {
        if (++manifest < 2) throw transient("ETIMEDOUT");
        return Buffer.from(JSON.stringify(envelope()));
      }
      chunk(data, data.length);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
  assert.equal(discovery, 3);
  assert.equal(manifest, 2);
  assert.deepEqual(h.waits, [500, 1500, 500]);
});

test("newest valid release wins without fetching older failing manifests", async (t) => {
  const seen = [];
  const h = harness(t, {
    fetch: async (url, _signal, _limit, chunk) => {
      if (url.includes("api.github.com"))
        return Buffer.from(
          JSON.stringify(
            ["0.4.0", "0.5.0"].map((v) => ({
              tag_name: "v" + v,
              assets: [
                {
                  name: "backstage-update.json",
                  browser_download_url: `https://github.com/farena-ai/Backstage-Forever/releases/download/v${v}/backstage-update.json`,
                },
              ],
            })),
          ),
        );
      if (!chunk) {
        const version = url.includes("v0.5.0") ? "0.5.0" : "0.4.0";
        seen.push(version);
        if (version === "0.4.0") throw transient();
        return Buffer.from(JSON.stringify(envelope()));
      }
      chunk(data, data.length);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
  assert.deepEqual(seen, ["0.5.0"]);
});

function transport(response) {
  return {
    get(_url, options, callback) {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = (error) => req.emit("error", error);
      queueMicrotask(() => response(req, callback, options));
      return req;
    },
  };
}
test("request rejects aborted and truncated bodies promptly with sanitized byte counts", async () => {
  for (const event of ["aborted", "close", "end"]) {
    const network = transport((_req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { "content-length": "10" };
      res.resume = () => {};
      res.destroy = () => res.emit("close");
      callback(res);
      res.emit("data", Buffer.from("two"));
      res.emit(event);
    });
    await assert.rejects(
      request(assetURL("0.5.0"), undefined, 100, null, false, 0, network),
      (e) => e.updateCode === "BODY_ABORT" && e.bytes === 3,
    );
  }
});
test("request emits stable HTTP and timeout errors and sends fresh-cache headers", async () => {
  const network = transport((_req, callback, options) => {
    assert.equal(options.headers["Cache-Control"], "no-cache");
    const res = new EventEmitter();
    res.statusCode = 503;
    res.headers = {};
    res.resume = () => {};
    callback(res);
  });
  await assert.rejects(
    request(assetURL("0.5.0"), undefined, 100, null, false, 0, network),
    (e) => e.updateCode === "HTTP" && e.httpStatus === 503,
  );
});
test("request timeout and redirect security fail with stable codes", async () => {
  const timed = {
    get() {
      const req = new EventEmitter();
      req.setTimeout = (_ms, expire) => queueMicrotask(expire);
      req.destroy = (error) => req.emit("error", error);
      return req;
    },
  };
  await assert.rejects(
    request(assetURL("0.5.0"), undefined, 100, null, false, 0, timed),
    (error) => error.updateCode === "TIMEOUT",
  );
  for (const location of [
    "http://github.com/insecure",
    "https://github.com.evil.invalid/secret?token=hidden",
    "https://token@github.com/private",
  ]) {
    const redirect = transport((_req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location };
      res.resume = () => {};
      callback(res);
    });
    await assert.rejects(
      request(assetURL("0.5.0"), undefined, 100, null, false, 0, redirect),
      (error) =>
        error.updateCode === "URL" && !/secret|token|https/.test(error.message),
    );
  }
});

test("redirect handoff ignores a completed origin socket error", async () => {
  let calls = 0;
  const network = transport((req, callback) => {
    const res = new EventEmitter();
    res.resume = () => {};
    if (++calls === 1) {
      res.statusCode = 302;
      res.headers = {
        location: "https://release-assets.githubusercontent.com/fixture",
      };
      callback(res);
      req.emit("error", transient());
    } else {
      res.statusCode = 200;
      res.headers = { "content-length": "2" };
      callback(res);
      res.emit("data", Buffer.from("ok"));
      res.emit("end");
    }
  });
  assert.equal(
    (
      await request(assetURL("0.5.0"), undefined, 100, null, false, 0, network)
    ).toString(),
    "ok",
  );
});

test("fresh GitHub release requests bypass stale redirect metadata without changing signed redirects", async () => {
  const seen = [];
  const signed =
    "https://release-assets.githubusercontent.com/fixture?signature=fixture-only";
  const network = {
    get(url, options, callback) {
      seen.push(url);
      const req = new EventEmitter();
      req.setTimeout = () => {};
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.resume = () => {};
        res.headers =
          seen.length === 1 ? { location: signed } : { "content-length": "2" };
        res.statusCode = seen.length === 1 ? 302 : 200;
        callback(res);
        if (res.statusCode === 200) {
          res.emit("data", Buffer.from("ok"));
          res.emit("end");
        }
      });
      return req;
    },
  };
  await request(assetURL("0.5.0"), undefined, 100, null, false, 0, network);
  const initial = new URL(seen[0]);
  assert.equal(initial.origin + initial.pathname, assetURL("0.5.0"));
  assert.match(initial.searchParams.get("_bf") || "", /^[a-f0-9-]{36}$/);
  assert.equal(seen[1], signed);
});
