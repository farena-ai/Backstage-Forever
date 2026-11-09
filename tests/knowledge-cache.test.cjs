const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
const { FILES } = require("../src/core/knowledge.cjs");
const build = "1.60.1.70862",
  commit = "23f9636486d3d60479dc0bcee2356053c33faf2c";
const bundled = path.join(__dirname, "../data/forever/pack.json");
function setup(t, fetcher) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-knowledge-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return new KnowledgeService({ dataDir, bundledPath: bundled, fetcher });
}
const fixture = require("./fixtures/forever-facts.cjs").fixture();
for (const source of Object.values(fixture)) source.meta.collectedOn.last = "2026-11-09";
const raw = (n) => JSON.stringify(fixture[n]);
test("offline bundled lookup, exact selected build and checks without redownloading unchanged commit", async (t) => {
  const urls = [];
  const s = setup(t, async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ commit: { sha: commit } }));
  });
  s.setContext({ clientBuild: build }, false);
  await s.refresh();
  assert.equal(urls.length, 1);
  assert.ok(s.status().lastChecked);
  assert.equal(s.status().build, build);
  assert.equal(s.status().packBuild, build);
  assert.equal(s.index().pack.observedThrough, "2026-11-09");
  s.setContext({ clientBuild: "1.60.1.999" }, false);
  assert.equal(s.index(), null);
  assert.equal(s.status().phase, "mismatch");
  assert.equal(s.status().packBuild, build);
  s.setContext({}, false);
  assert.equal(s.status().build, null);
  assert.ok(s.index());
});

test("offline upgrade prefers newer compatible bundled observation date over old valid cache without writes or network", t => {
  let calls = 0;
  const s = setup(t, async () => { calls++; throw Error("must remain offline"); });
  const oldRaw = structuredClone(fixture);
  for (const source of Object.values(oldRaw)) source.meta.collectedOn.last = "2026-11-08";
  const old = require("../src/core/knowledge.cjs").normalizeData(oldRaw, { commit: "f".repeat(40), build });
  const payload = JSON.stringify(old); s.write(`${build}.json`, { schemaVersion: 1, payload, sha256: require("../src/core/knowledge.cjs").hash(payload) });
  const cacheFile = path.join(s.cacheDir, `${build}.json`), before = fs.readFileSync(cacheFile);
  s.setContext({ clientBuild: build }, false);
  assert.equal(s.status().sourceCommit, commit); assert.equal(s.status().observedThrough, "2026-11-09");
  assert.equal(s.index().pack.counts.quests, 3884); assert.equal(calls, 0); assert.deepEqual(fs.readFileSync(cacheFile), before);
});

test("offline cache with equal or newer canonical observation date remains selected regardless of SHA or record count", t => {
  for (const date of ["2026-11-09", "2026-11-10"]) {
    const s = setup(t, async () => { throw Error("must remain offline"); });
    const cached = require("../src/core/knowledge.cjs").normalizeData(fixture, { commit: "0".repeat(40), build });
    cached.observedThrough = date;
    const payload = JSON.stringify(cached); s.write(`${build}.json`, { schemaVersion: 1, payload, sha256: require("../src/core/knowledge.cjs").hash(payload) });
    s.setContext({ clientBuild: build }, false);
    assert.equal(s.status().sourceCommit, "0".repeat(40)); assert.equal(s.status().observedThrough, date);
    assert.ok(s.index().pack.counts.quests < s.bundled.pack.counts.quests);
  }
});

test("a valid different-build cache remains usable with its own older observation date", t => {
  const s = setup(t), otherBuild = "1.60.1.70000", sources = structuredClone(fixture);
  for (const source of Object.values(sources)) { source.meta.clientBuild = otherBuild; source.meta.collectedOn.last = "2026-11-08"; }
  const cached = require("../src/core/knowledge.cjs").normalizeData(sources, { commit: "b".repeat(40), build: otherBuild });
  const payload = JSON.stringify(cached); s.write(`${otherBuild}.json`, { schemaVersion: 1, payload, sha256: require("../src/core/knowledge.cjs").hash(payload) });
  s.setContext({ clientBuild: otherBuild }, false);
  assert.equal(s.status().packBuild, otherBuild); assert.equal(s.status().observedThrough, "2026-11-08"); assert.equal(s.status().sourceCommit, "b".repeat(40));
});
test("new commit fetches only six literal exact-build files, persists validated cache and falls back offline", async (t) => {
  const urls = [],
    next = "a".repeat(40);
  const s = setup(t, async (url) => {
    urls.push(url);
    return url.includes("api.github")
      ? new Response(JSON.stringify({ commit: { sha: next } }))
      : new Response(raw(url.split("/").at(-1)));
  });
  s.setContext(
    { clientBuild: build, name: "PRIVATE", source: { id: "PRIVATE" } },
    false,
  );
  await s.refresh();
  assert.equal(urls.length, 7);
  assert.equal(s.status().sourceCommit, next);
  for (const url of urls) {
    assert.doesNotMatch(url, /PRIVATE/);
    if (!url.includes("api.github"))
      assert.ok(FILES.some((n) => url.endsWith(`/data/wowf/${build}/${n}`)));
  }
  const s2 = new KnowledgeService({
    dataDir: s.dataDir,
    bundledPath: bundled,
    fetcher: async () => {
      throw Error("offline PRIVATE");
    },
  });
  s2.setContext({ clientBuild: build }, false);
  await s2.refresh();
  assert.equal(s2.status().sourceCommit, next);
  assert.doesNotMatch(s2.status().message, /PRIVATE/);
});
test("partial build and corrupt cache preserve last good bundle", async (t) => {
  const s = setup(t, async (url) =>
    url.includes("api.github")
      ? new Response(JSON.stringify({ commit: { sha: "b".repeat(40) } }))
      : new Response("{}"),
  );
  s.setContext({ clientBuild: build }, false);
  await s.refresh();
  assert.equal(s.status().sourceCommit, commit);
  assert.match(s.status().message, /unavailable|preserved/i);
  fs.mkdirSync(s.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(s.cacheDir, `${build}.json`), "{broken");
  const s2 = new KnowledgeService({
    dataDir: s.dataDir,
    bundledPath: bundled,
    fetcher: async () => {
      throw Error("offline");
    },
  });
  s2.setContext({ clientBuild: build }, false);
  assert.equal(s2.status().sourceCommit, commit);
});
test("dedup, auto-off, disconnect and reset cancel late transfers without repopulation", async (t) => {
  let resolve,
    calls = 0;
  const s = setup(t, () => {
    calls++;
    return new Promise((r) => (resolve = r));
  });
  s.setContext({ clientBuild: build }, false);
  const a = s.refresh(),
    b = s.refresh();
  assert.equal(a, b);
  assert.equal(calls, 1);
  s.setAutomatic(false);
  resolve(new Response(JSON.stringify({ commit: { sha: commit } })));
  await a;
  assert.equal(s.status().lastChecked, null);
  assert.equal(s.status().automatic, false);
  s.setAutomatic(true);
  s.setContext(
    {
      clientBuild: build,
      source: { kind: "wow-addon", updatedAt: "2026-11-09T00:00:00.000Z" },
    },
    true,
  );
  assert.equal(calls, 2);
  s.setContext({}, false);
  resolve(new Response(JSON.stringify({ commit: { sha: commit } })));
  await b;
  await new Promise((r) => setImmediate(r));
  assert.equal(s.status().lastChecked, null);
  const pending = s.refresh();
  const reset = s.reset();
  resolve(new Response(JSON.stringify({ commit: { sha: "c".repeat(40) } })));
  await Promise.all([pending, reset]);
  assert.equal(s.status().lastChecked, null);
  assert.equal(s.status().automatic, true);
  assert.equal(fs.existsSync(s.cacheDir), false);
});
test("no renderer URLs, invalid booleans or oversized branch data are accepted", async (t) => {
  const s = setup(t, async () => new Response(" ".repeat(70000)));
  assert.throws(() => s.setAutomatic("yes"));
  s.setContext({ clientBuild: build }, false);
  await s.refresh();
  assert.equal(s.status().sourceCommit, commit);
});
test("failed automatic checks are bounded to daily attempts and manual profiles never auto-refresh", async (t) => {
  let calls = 0;
  const s = setup(t, async () => {
    calls++;
    throw Error("offline");
  });
  s.setContext({ clientBuild: build }, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  const p = {
    clientBuild: build,
    source: { kind: "wow-addon", updatedAt: "2026-11-09T00:00:00.000Z" },
  };
  s.setContext(p, true);
  await s.pending;
  const after = calls;
  s.setContext(p, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, after);
});
test("cache refuses a junction ancestor before writing outside owned directory", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bf-knowledge-junction-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, "real"),
    link = path.join(base, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
  const s = new KnowledgeService({
    dataDir: path.join(link, "owned"),
    bundledPath: bundled,
    fetcher: async () => {
      throw Error("offline");
    },
  });
  assert.throws(() => s.setAutomatic(false), /directory/);
  assert.equal(fs.existsSync(path.join(real, "owned")), false);
});

test("cache accepts equivalent native canonical ancestor spelling before creating nested directories", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-canonical-alias-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = fs.realpathSync.native;
  const canonicalRoot = native(root) + "-canonical-spelling";
  t.mock.method(fs.realpathSync, "native", (value) => {
    const actual = native(value);
    const base = native(root);
    return actual === base || actual.startsWith(base + path.sep)
      ? canonicalRoot + actual.slice(base.length) : actual;
  });
  const dataDir = path.join(root, "not-created", "owned");
  const s = new KnowledgeService({ dataDir, bundledPath: bundled });
  assert.doesNotThrow(() => s.setAutomatic(false));
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.cacheDir,"preferences.json"))).automatic,false);
  const reopened = new KnowledgeService({ dataDir, bundledPath: bundled });
  assert.equal(reopened.automatic,false);
});

test("cache persists and reloads refreshed data through a real Windows short-name alias", {
  skip: process.platform !== "win32",
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-real-short-alias-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfShortPath]::GetShortPathName($env:BF_TEST_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command",script], {
    env: { ...process.env, BF_TEST_ALIAS_PATH: root }, encoding:"utf8",
  }).trim();
  if (alias.toLowerCase() === fs.realpathSync.native(root).toLowerCase())
    return t.skip("This volume does not create 8.3 aliases.");
  assert.equal(fs.statSync(alias).ino, fs.statSync(root).ino);
  const next = "d".repeat(40);
  const dataDir = path.join(alias,"owned");
  const s = new KnowledgeService({dataDir,bundledPath:bundled,fetcher:async url=>url.includes("api.github")
    ? new Response(JSON.stringify({commit:{sha:next}})) : new Response(raw(url.split("/").at(-1)))});
  s.setContext({clientBuild:build},false);
  await s.refresh();
  assert.equal(s.status().sourceCommit,next);
  assert.doesNotThrow(()=>s.setAutomatic(false));
  for (const spelling of [dataDir,path.join(root,"owned")]) {
    const reopened = new KnowledgeService({dataDir:spelling,bundledPath:bundled});
    reopened.setContext({clientBuild:build},false);
    assert.equal(reopened.automatic,false);
    assert.equal(reopened.status().sourceCommit,next);
  }
});

test("canonical child redirection and cache-directory junctions are still refused", (t) => {
  const s = setup(t);
  fs.mkdirSync(s.cacheDir,{recursive:true});
  const native = fs.realpathSync.native;
  t.mock.method(fs.realpathSync,"native",value=>path.resolve(value)===s.cacheDir
    ? path.join(s.dataDir,"other-cache") : native(value));
  assert.throws(()=>s.setAutomatic(false),/directory/);
  assert.equal(fs.readdirSync(s.cacheDir).length,0);
  t.mock.restoreAll();
  const outside = path.join(s.dataDir,"outside");
  fs.rmdirSync(s.cacheDir);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside,s.cacheDir,process.platform==="win32" ? "junction" : "dir");
  assert.throws(()=>s.setAutomatic(false),/directory/);
  assert.equal(fs.readdirSync(outside).length,0);
});
test("stream body bound and abort cancel active readers without stale commits", async (t) => {
  let cancelled = false;
  const s = setup(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(32000));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const pending = s.refresh();
  await new Promise((r) => setImmediate(r));
  s.cancel();
  await pending;
  assert.equal(cancelled, true);
  assert.equal(s.status().lastChecked, null);
  let oversizedCancelled = false;
  const big = setup(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(65000));
          },
          cancel() {
            oversizedCancelled = true;
          },
        }),
      ),
  );
  await big.refresh();
  assert.equal(oversizedCancelled, true);
  assert.equal(big.status().lastChecked, null);
});
