const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
const { FILES } = require("../src/core/knowledge.cjs");
const build = "1.60.1.70862",
  commit = "156f29c9af78b1586883e8eb94a13467eb89638c";
const bundled = path.join(__dirname, "../data/forever/pack.json");
function setup(t, fetcher) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-knowledge-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return new KnowledgeService({ dataDir, bundledPath: bundled, fetcher });
}
const fixture = require("./fixtures/forever-facts.cjs").fixture();
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
  assert.equal(s.index().pack.observedThrough, "2026-11-08");
  s.setContext({ clientBuild: "1.60.1.999" }, false);
  assert.equal(s.index(), null);
  assert.equal(s.status().phase, "mismatch");
  assert.equal(s.status().packBuild, build);
  s.setContext({}, false);
  assert.equal(s.status().build, null);
  assert.ok(s.index());
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
