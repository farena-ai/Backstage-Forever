const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  verifyManifest,
  assetURL,
  allowedURL,
} = require("../src/core/updater.cjs");
const keys = crypto.generateKeyPairSync("ed25519");
function fixture(change = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      version: "0.3.0",
      releaseTag: "v0.3.0",
      url: assetURL("0.3.0"),
      sha256: "a".repeat(64),
      size: 123,
      publishedAt: "2026-11-08T00:00:00Z",
      ...change,
    }),
  );
  return {
    payload: payload.toString("base64"),
    signature: crypto.sign(null, payload, keys.privateKey).toString("base64"),
  };
}
test("only original signed, strictly bound manifests authorize updates", () => {
  assert.equal(
    verifyManifest(fixture(), keys.publicKey, "0.2.0").version,
    "0.3.0",
  );
  for (const change of [
    { version: "0.1.0" },
    { url: "https://evil.example/a.exe" },
    { releaseTag: "v0.4.0" },
    { extra: true },
  ])
    assert.throws(() =>
      verifyManifest(fixture(change), keys.publicKey, "0.2.0"),
    );
  const bad = fixture();
  bad.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyManifest(bad, keys.publicKey, "0.2.0"));
});
test("redirects reject credentials, non HTTPS and lookalike hosts", () => {
  assert.equal(
    allowedURL("https://release-assets.githubusercontent.com/a"),
    true,
  );
  for (const url of [
    "http://github.com/a",
    "https://github.com.evil.test/a",
    "https://token@github.com/a",
    "https://api.github.com/a",
  ])
    assert.equal(allowedURL(url), false);
});
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Updater } = require("../src/core/updater.cjs");
function harness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-updater-"));
  t.after(() => {
    const real = fs.realpathSync(dir);
    assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(real).startsWith("bf-updater-"));
    fs.rmSync(real, { recursive: true, force: true });
  });
  const data = Buffer.from("trusted installer fixture");
  const envelope = fixture({
    size: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  });
  let calls = 0,
    launches = 0;
  const fetch = async (url, signal, limit, chunk) => {
    calls++;
    if (url.includes("api.github.com"))
      return Buffer.from(
        JSON.stringify([
          {
            tag_name: "v0.3.0",
            draft: false,
            prerelease: true,
            assets: [
              {
                name: "backstage-update.json",
                browser_download_url:
                  "https://github.com/farena-ai/Backstage-Forever/releases/download/v0.3.0/backstage-update.json",
              },
            ],
          },
        ]),
      );
    if (url.endsWith(".json")) return Buffer.from(JSON.stringify(envelope));
    await options.beforeDownload?.();
    if (signal.aborted) throw Error("aborted");
    const bytes = options.corrupt ? Buffer.from("bad") : data;
    chunk(bytes, bytes.length);
    return bytes.length;
  };
  const updater = new Updater({
    dataDir: dir,
    currentVersion: "0.2.0",
    publicKey: keys.publicKey,
    packaged: true,
    platform: "win32",
    fetch,
    installRunner: async (file) => {
      assert.equal(fs.readFileSync(file).toString(), data.toString());
      launches++;
    },
    ...options,
  });
  return { updater, dir, calls: () => calls, launches: () => launches };
}
test("preview fixture downloads atomically, restores and installs only after rehash", async (t) => {
  const h = harness(t);
  assert.equal((await h.updater.check()).phase, "ready");
  assert.equal(
    fs
      .readdirSync(path.join(h.dir, "updates"))
      .some((n) => n.endsWith(".partial")),
    false,
  );
  assert.equal(await h.updater.install({ onQuit: true }), true);
  assert.equal(h.launches(), 1);
  const restored = new Updater({
    dataDir: h.dir,
    currentVersion: "0.2.0",
    publicKey: keys.publicKey,
    packaged: true,
    platform: "win32",
    installRunner: () => assert.fail("tampered installer executed"),
  });
  assert.equal(restored.status().phase, "ready");
  fs.writeFileSync(
    path.join(
      h.dir,
      "updates",
      "Backstage-Forever-0.3.0-Windows-x64-Setup.exe",
    ),
    "tampered",
  );
  await assert.rejects(restored.install());
});
test("hash mismatch never becomes an installer or leaves a partial file", async (t) => {
  const h = harness(t, { corrupt: true });
  assert.equal((await h.updater.check()).phase, "error");
  assert.equal(await h.updater.install(), false);
  assert.deepEqual(fs.readdirSync(path.join(h.dir, "updates")), [
    "diagnostic.json",
  ]);
});
test("opt out cancels an in-flight download without resurrecting ready state", async (t) => {
  let release;
  let entered;
  const started = new Promise((r) => (entered = r));
  const h = harness(t, {
    beforeDownload: () => {
      entered();
      return new Promise((r) => (release = r));
    },
  });
  const pending = h.updater.check();
  await started;
  await h.updater.setPreferences({ automatic: false, installOnQuit: false });
  release();
  await pending;
  assert.equal(h.updater.status().phase, "disabled");
  assert.equal(await h.updater.install(), false);
  assert.equal(h.launches(), 0);
});
test("reset cancels transfers and clears update files without recreating queued updates", async (t) => {
  let release;
  let entered;
  const started = new Promise((r) => (entered = r));
  const h = harness(t, {
    beforeDownload: () => {
      entered();
      return new Promise((r) => (release = r));
    },
  });
  const pending = h.updater.check();
  await started;
  const reset = h.updater.reset();
  release();
  await Promise.all([pending, reset]);
  assert.deepEqual(fs.readdirSync(path.join(h.dir, "updates")), [
    "preferences.json",
  ]);
  assert.equal(h.updater.status().phase, "disabled");
});
test("source builds schedule no network and cannot execute installers", async (t) => {
  const h = harness(t, {
    packaged: false,
    setTimer: () => assert.fail("source build scheduled auto check"),
  });
  h.updater.start();
  assert.equal(h.calls(), 0);
  await h.updater.check();
  assert.equal(await h.updater.install(), false);
});
test("install-on-exit preference prevents automatic installation", async (t) => {
  const h = harness(t);
  await h.updater.check();
  await h.updater.setPreferences({ automatic: true, installOnQuit: false });
  assert.equal(await h.updater.install({ onQuit: true }), false);
  h.updater.close();
  assert.equal(h.launches(), 0);
});
test("obsolete timer callbacks cannot issue network after cancellation", async (t) => {
  const scheduled = [];
  const h = harness(t, {
    setTimer: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimer: () => {},
  });
  h.updater.start();
  const stale = scheduled[0];
  await h.updater.setPreferences({ automatic: false, installOnQuit: false });
  stale();
  await Promise.resolve();
  assert.equal(h.calls(), 0);
  assert.equal(scheduled.length, 1);
});
test("explicit update requests restart while normal exit does not", async (t) => {
  for (const onQuit of [true, false]) {
    let restart;
    const h = harness(t, {
      installRunner: async (_file, options) => {
        restart = options.restart;
      },
    });
    await h.updater.check();
    await h.updater.install({ onQuit });
    assert.equal(restart, !onQuit);
  }
});
test("preference change replaces rather than duplicates an in-flight timer chain", async (t) => {
  const scheduled = [];
  let release;
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  const h = harness(t, {
    setTimer: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimer: () => {},
    beforeDownload: () => {
      entered();
      return new Promise((resolve) => (release = resolve));
    },
  });
  h.updater.start();
  scheduled[0].callback();
  await started;
  await h.updater.setPreferences({ automatic: true, installOnQuit: true });
  release();
  await h.updater.pending;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].delay, 15000);
  h.updater.close();
});
test("automatic opt-out still permits an explicitly checked and requested restart", async (t) => {
  let restart;
  const h = harness(t, {
    installRunner: async (_file, options) => {
      restart = options.restart;
    },
  });
  await h.updater.check();
  await h.updater.setPreferences({ automatic: false, installOnQuit: true });
  assert.equal(await h.updater.install({ onQuit: false }), false);
  assert.equal((await h.updater.check()).phase, "ready");
  assert.equal(await h.updater.install({ onQuit: true }), false);
  assert.equal(restart, undefined);
  assert.equal(await h.updater.install({ onQuit: false }), true);
  assert.equal(restart, true);
});
