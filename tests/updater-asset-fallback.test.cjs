"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Updater, request, assetURL } = require("../src/core/updater.cjs");
const API =
  "https://api.github.com/repos/farena-ai/Backstage-Forever/releases?per_page=30";
const assetAPI = (id) =>
  `https://api.github.com/repos/farena-ai/Backstage-Forever/releases/assets/${id}`;
const manifestURL =
  "https://github.com/farena-ai/Backstage-Forever/releases/download/v0.5.0/backstage-update.json";
const keys = crypto.generateKeyPairSync("ed25519");
const data = Buffer.from(
  "same signed installer bytes on either official route",
);
function envelope(change = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      version: "0.5.0",
      releaseTag: "v0.5.0",
      url: assetURL("0.5.0"),
      size: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      publishedAt: "2026-11-09T00:00:00Z",
      ...change,
    }),
  );
  return {
    payload: payload.toString("base64"),
    signature: crypto.sign(null, payload, keys.privateKey).toString("base64"),
  };
}
function assets() {
  return [
    {
      id: 101,
      name: "backstage-update.json",
      browser_download_url: manifestURL,
    },
    {
      id: 102,
      name: path.basename(assetURL("0.5.0")),
      browser_download_url: assetURL("0.5.0"),
    },
  ];
}
function transient() {
  return Object.assign(Error("private upstream details"), {
    updateCode: "HTTP",
    httpStatus: 504,
  });
}
function harness(t, options = {}) {
  const root = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, "bf-asset-fallback-"));
  const calls = [],
    waits = [];
  const updater = new Updater({
    dataDir: dir,
    currentVersion: "0.4.0",
    publicKey: keys.publicKey,
    packaged: true,
    platform: "win32",
    fetch: async (url, signal, limit, chunk, api) => {
      calls.push({ url, api });
      if (url === API)
        return Buffer.from(
          JSON.stringify(
            options.releases || [
              { tag_name: "v0.5.0", assets: options.assets || assets() },
            ],
          ),
        );
      return options.fetch({ url, signal, limit, chunk, api, dir, calls });
    },
    retryDelay: async (ms) => {
      assert.equal(
        fs
          .readdirSync(path.join(dir, "updates"))
          .some((n) => n.endsWith(".partial")),
        false,
      );
      waits.push(ms);
      await options.wait?.();
    },
    installRunner: () => assert.fail("installer execution forbidden"),
  });
  t.after(() => {
    updater.close();
    const real = fs.realpathSync(dir);
    assert.equal(path.dirname(real), root);
    assert.ok(path.basename(real).startsWith("bf-asset-fallback-"));
    fs.rmSync(real, { recursive: true, force: true });
  });
  return { updater, dir, calls, waits };
}

test("manifest and installer recover through selected numeric API aliases after standard 504s", async (t) => {
  const h = harness(t, {
    fetch: ({ url, chunk, api }) => {
      if (url === manifestURL || url === assetURL("0.5.0")) {
        if (chunk) chunk(Buffer.from("discard"));
        throw transient();
      }
      assert.equal(api, "asset");
      if (url === assetAPI(101)) return Buffer.from(JSON.stringify(envelope()));
      assert.equal(url, assetAPI(102));
      chunk(data);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
  assert.deepEqual(
    h.calls.map((c) => c.url),
    [API, manifestURL, assetAPI(101), assetURL("0.5.0"), assetAPI(102)],
  );
  assert.deepEqual(h.waits, [500, 500]);
  assert.deepEqual(
    fs.readFileSync(
      path.join(h.dir, "updates", path.basename(assetURL("0.5.0"))),
    ),
    data,
  );
  assert.equal(h.updater.ready.manifest.url, assetURL("0.5.0"));
  h.updater.verifyFile(h.updater.ready.manifest);
});

test("both routes share three total attempts per operation", async (t) => {
  for (const stage of ["manifest", "download"]) {
    const h = harness(t, {
      fetch: ({ url, chunk }) => {
        if (stage === "download" && !chunk)
          return Buffer.from(JSON.stringify(envelope()));
        if (chunk) chunk(Buffer.from("discard"));
        throw transient();
      },
    });
    const status = await h.updater.check();
    assert.equal(status.phase, "error");
    assert.equal(status.diagnostic.attempt, 3);
    const attempts = h.calls.slice(stage === "manifest" ? 1 : 2);
    assert.deepEqual(
      attempts.map((c) => c.url),
      stage === "manifest"
        ? [manifestURL, assetAPI(101), assetAPI(101)]
        : [assetURL("0.5.0"), assetAPI(102), assetAPI(102)],
    );
    assert.deepEqual(h.waits, [500, 1500]);
  }
});

test("missing, unsafe or mismatched asset IDs disable aliases without blocking ordinary releases", async (t) => {
  for (const change of [
    { id: undefined },
    { id: "102" },
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { name: "foreign.exe" },
    {
      browser_download_url:
        "https://github.com/foreign/repo/releases/download/v0.5.0/file.exe",
    },
  ]) {
    const records = assets();
    Object.assign(records[1], change);
    const h = harness(t, {
      assets: records,
      fetch: ({ url, chunk }) => {
        if (!chunk) return Buffer.from(JSON.stringify(envelope()));
        assert.equal(url, assetURL("0.5.0"));
        throw transient();
      },
    });
    assert.equal((await h.updater.check()).phase, "error");
    assert.equal(h.calls.filter((c) => c.url === assetURL("0.5.0")).length, 3);
  }
  const h = harness(t, {
    assets: assets().map(({ id, ...record }) => record),
    fetch: ({ chunk }) => {
      if (!chunk) return Buffer.from(JSON.stringify(envelope()));
      chunk(data);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
});

test("signature, signed binding, hash and size failures never switch route", async (t) => {
  for (const kind of ["signature", "binding", "hash", "size"]) {
    const signed = envelope(kind === "binding" ? { url: assetAPI(102) } : {});
    if (kind === "signature")
      signed.signature = Buffer.alloc(64).toString("base64");
    const h = harness(t, {
      fetch: ({ url, chunk }) => {
        assert.ok(!url.includes("/releases/assets/"));
        if (!chunk) return Buffer.from(JSON.stringify(signed));
        const bytes =
          kind === "hash" ? Buffer.alloc(data.length) : data.subarray(0, 2);
        chunk(bytes);
        return bytes.length;
      },
    });
    assert.equal((await h.updater.check()).phase, "error");
    assert.equal(h.waits.length, 0);
    assert.equal(
      h.calls.length,
      ["signature", "binding"].includes(kind) ? 2 : 3,
    );
  }
});

test("invalid manifest IDs stay on the browser route", async (t) => {
  for (const id of [
    undefined,
    "101",
    0,
    -1,
    1.1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const records = assets();
    records[0].id = id;
    const h = harness(t, {
      assets: records,
      fetch: ({ url }) => {
        assert.equal(url, manifestURL);
        throw transient();
      },
    });
    assert.equal((await h.updater.check()).phase, "error");
    assert.deepEqual(
      h.calls.slice(1).map((c) => c.url),
      Array(3).fill(manifestURL),
    );
  }
});

test("only the selected newest release supplies exact-name and browser-URL aliases", async (t) => {
  const records = assets();
  records[0].url =
    "https://api.github.com/repos/foreign/repo/releases/assets/666";
  const h = harness(t, {
    releases: [
      { tag_name: "v0.4.1", assets: assets().map((a) => ({ ...a, id: 666 })) },
      { tag_name: "v0.5.0", assets: records },
    ],
    fetch: ({ url, chunk }) => {
      if (url === manifestURL) throw transient();
      if (!chunk) {
        assert.equal(url, assetAPI(101));
        return Buffer.from(JSON.stringify(envelope()));
      }
      chunk(data);
      return data.length;
    },
  });
  assert.equal((await h.updater.check()).phase, "ready");
  assert.ok(h.calls.every((c) => !c.url.includes("666")));
  for (const change of [
    { name: "foreign.json" },
    { browser_download_url: manifestURL.replace("farena-ai", "foreign") },
  ]) {
    const metadata = assets();
    Object.assign(metadata[0], change);
    const invalid = harness(t, {
      assets: metadata,
      fetch: () => assert.fail("mismatched manifest metadata fetched"),
    });
    assert.equal((await invalid.updater.check()).diagnostic.code, "MANIFEST");
    assert.equal(invalid.calls.length, 1);
  }
});

test("permanent API verification failures stop after the first fallback response", async (t) => {
  for (const kind of ["signature", "hash", "size"]) {
    const signed = envelope();
    if (kind === "signature")
      signed.signature = Buffer.alloc(64).toString("base64");
    const h = harness(t, {
      fetch: ({ url, chunk }) => {
        if (
          kind === "signature" ? url === manifestURL : url === assetURL("0.5.0")
        )
          throw transient();
        if (!chunk) return Buffer.from(JSON.stringify(signed));
        const bytes =
          kind === "hash" ? Buffer.alloc(data.length) : data.subarray(0, 2);
        chunk(bytes);
        return bytes.length;
      },
    });
    const status = await h.updater.check();
    assert.equal(status.phase, "error");
    assert.equal(status.diagnostic.attempt, 2);
    assert.equal(
      status.diagnostic.code,
      { signature: "SIGNATURE", hash: "HASH", size: "SIZE" }[kind],
    );
    assert.equal(h.calls.filter((c) => c.api === "asset").length, 1);
  }
});

test("permanent HTTP and redirect failures do not enable fallback", async (t) => {
  for (const error of [
    Object.assign(Error(), { updateCode: "HTTP", httpStatus: 404 }),
    Object.assign(Error(), { updateCode: "URL" }),
    Object.assign(Error(), { updateCode: "REDIRECT" }),
  ]) {
    const h = harness(t, {
      fetch: () => {
        throw error;
      },
    });
    assert.equal((await h.updater.check()).phase, "error");
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.waits, []);
  }
});

test("cancellation in an API stream removes the partial without publishing ready state", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const h = harness(t, {
    fetch: async ({ url, chunk }) => {
      if (!chunk) return Buffer.from(JSON.stringify(envelope()));
      if (url === assetURL("0.5.0")) throw transient();
      assert.equal(url, assetAPI(102));
      chunk(Buffer.from("partial"));
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      chunk(data);
      return data.length;
    },
  });
  const pending = h.updater.check();
  await started;
  await h.updater.setPreferences({ automatic: false, installOnQuit: false });
  release();
  await pending;
  assert.equal(h.updater.status().phase, "disabled");
  assert.equal(h.updater.status().readyVersion, null);
  assert.equal(fs.existsSync(path.join(h.dir, "updates/ready.json")), false);
  assert.equal(
    fs
      .readdirSync(path.join(h.dir, "updates"))
      .some((n) => n.endsWith(".partial")),
    false,
  );
});

test("failed primary partial cleanup prevents the API attempt", async (t) => {
  const h = harness(t, {
    fetch: ({ chunk }) => {
      if (!chunk) return Buffer.from(JSON.stringify(envelope()));
      chunk(Buffer.from("partial"));
      throw transient();
    },
  });
  const unlink = fs.unlinkSync;
  try {
    fs.unlinkSync = (file) => {
      if (file.endsWith(".partial"))
        throw Object.assign(Error(), { code: "EPERM" });
      return unlink(file);
    };
    const status = await h.updater.check();
    assert.equal(status.phase, "error");
    assert.equal(status.diagnostic.code, "PERMISSION");
    assert.equal(h.calls.filter((c) => c.api === "asset").length, 0);
    assert.deepEqual(h.waits, []);
  } finally {
    fs.unlinkSync = unlink;
  }
});

test("exhausted API recovery preserves the previous verified ready installer", async (t) => {
  const h = harness(t, {
    fetch: ({ chunk }) => {
      if (!chunk) return Buffer.from(JSON.stringify(envelope()));
      chunk(Buffer.from("partial"));
      throw transient();
    },
  });
  const previous = envelope({
    version: "0.4.1",
    releaseTag: "v0.4.1",
    url: assetURL("0.4.1"),
  });
  fs.writeFileSync(
    path.join(h.dir, "updates/ready.json"),
    JSON.stringify(previous),
  );
  fs.writeFileSync(
    path.join(h.dir, "updates", path.basename(assetURL("0.4.1"))),
    data,
  );
  h.updater.restore();
  const status = await h.updater.check();
  assert.equal(status.phase, "ready");
  assert.equal(status.readyVersion, "0.4.1");
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.diagnostic.attempt, 3);
  assert.equal(h.calls.filter((c) => c.api === "asset").length, 2);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(h.dir, "updates/ready.json"))),
    previous,
  );
  h.updater.verifyFile(h.updater.ready.manifest);
});

function network(reply) {
  return {
    get(url, options, callback) {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = (error) => req.emit("error", error);
      queueMicrotask(() => {
        const res = new EventEmitter();
        Object.assign(res, reply(url, options));
        res.resume = () => {};
        res.destroy = () => res.emit("close");
        callback(res);
        if (res.statusCode === 200) {
          res.emit("data", Buffer.from("ok"));
          res.emit("end");
        }
      });
      return req;
    },
  };
}
test("binary API transport allows exact fixed repository IDs, direct 200 and restricted 302", async () => {
  for (const redirect of [false, true]) {
    const seen = [];
    const signed =
      "https://release-assets.githubusercontent.com/fixture?signature=fixture";
    const transport = network((url, options) => {
      seen.push(url);
      assert.equal(options.headers.Accept, "application/octet-stream");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      return redirect && seen.length === 1
        ? { statusCode: 302, headers: { location: signed } }
        : { statusCode: 200, headers: { "content-length": "2" } };
    });
    assert.equal(
      (
        await request(
          assetAPI(102),
          undefined,
          100,
          null,
          "asset",
          0,
          transport,
        )
      ).toString(),
      "ok",
    );
    assert.deepEqual(
      seen,
      redirect ? [assetAPI(102), signed] : [assetAPI(102)],
    );
  }
});

test("binary API transport refuses alternate paths, encodings, credentials and unsafe redirects", async () => {
  for (const url of [
    assetAPI(0),
    assetAPI("01"),
    assetAPI("1.5"),
    assetAPI("9007199254740992"),
    assetAPI("102?token=secret"),
    assetAPI("102#fragment"),
    assetAPI("102/extra"),
    assetAPI("%31%30%32"),
    assetAPI("../102"),
    assetAPI(102).replace("farena-ai", "foreign"),
    assetAPI(102).replace("https:", "http:"),
    assetAPI(102).replace("api.github.com", "token@api.github.com"),
    assetAPI(102).replace("api.github.com", "api.github.com:443"),
    API,
  ]) {
    await assert.rejects(
      request(url, undefined, 100, null, "asset", 0, {
        get: () => assert.fail("unsafe target reached transport"),
      }),
      (e) => e.updateCode === "URL",
    );
  }
  for (const location of [
    assetAPI(103),
    assetAPI(103).replace("farena-ai", "foreign"),
    "https://api.github.com/arbitrary/path",
    "https://github.com/foreign/repository/releases/download/v1/file.exe",
    "http://github.com/file",
    "https://evil.invalid/file",
    "https://token@github.com/file",
  ]) {
    await assert.rejects(
      request(
        assetAPI(102),
        undefined,
        100,
        null,
        "asset",
        0,
        network(() => ({ statusCode: 302, headers: { location } })),
      ),
      (e) => e.updateCode === "URL",
    );
  }
  let hops = 0;
  await assert.rejects(
    request(
      assetAPI(102),
      undefined,
      100,
      null,
      "asset",
      0,
      network(() => ({
        statusCode: 302,
        headers: {
          location:
            ++hops === 1
              ? "https://release-assets.githubusercontent.com/first"
              : "https://github.com/foreign/repository/releases/download/v1/file.exe",
        },
      })),
    ),
    (e) => e.updateCode === "URL",
  );
  assert.equal(hops, 2, "API origin policy survives multiple redirect hops");
});
