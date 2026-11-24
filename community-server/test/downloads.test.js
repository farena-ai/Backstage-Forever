"use strict";
// GitHub release download counts: the fetch job against a fake GitHub, and the maths.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Store, SCHEMA_VERSION } = require("../lib/store");
const { loadConfig } = require("../lib/config");
const D = require("../lib/downloads");
const { SALT, T0, DAY, tempDb, boot, get, admin } = require("./helpers");

const HOUR = 3_600_000;
const at = (day, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const asset = (name, download_count) => ({ name, download_count, size: 1, browser_download_url: `https://github.com/x/${name}` });
const files = (v, win, mac = 0, addon = 0, update = 0) => [
  asset(`Backstage-Forever-${v}-Windows-x64-Setup.exe`, win), asset(`Backstage-Forever-${v}-macOS-arm64.zip`, mac),
  asset(`BackstageForever-Addon-${v}.zip`, addon), asset("backstage-update.json", update),
];
const release = (v, assets, extra = {}) => ({ tag_name: `v${v}`, name: `Release ${v}`, draft: false, prerelease: false, published_at: "2026-11-01T10:00:00Z", author: { login: "someone" }, body: "notes", assets, ...extra });

// A stand-in for api.github.com. `answer(req, page)` returns { status, headers, body }.
async function fakeGitHub() {
  const state = { answer: () => ({ status: 200, body: "[]" }), seen: [], asked: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    state.seen.push({ path: req.url, headers: req.headers, page: Number(url.searchParams.get("page")) });
    const a = state.answer(req, Number(url.searchParams.get("page")));
    res.writeHead(a.status, a.headers || {});
    res.end(typeof a.body === "string" || Buffer.isBuffer(a.body) ? a.body : a.body === undefined ? "" : JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // What production does, except that the socket goes to the fake. The options the fetcher asked for are kept.
  state.request = (options, cb) => { state.asked.push({ ...options }); return http.request({ ...options, protocol: "http:", hostname: "127.0.0.1", port: server.address().port }, cb); };
  state.close = () => new Promise((r) => server.close(r));
  return state;
}

function setup(t, gh, downloads = {}) {
  const store = new Store(":memory:"), clock = { t: T0 }, logs = [];
  t.after(() => store.close());
  const config = { downloads: { enabled: true, repo: D.DEFAULT_REPO, token: null, ...downloads } };
  const fetcher = new D.DownloadsFetcher({ store, config, request: gh ? gh.request : () => { throw new Error("no network in this test"); }, now: () => clock.t, log: (l) => logs.push(l) });
  const rows = () => store.db.prepare("SELECT tag, asset, day, count FROM gh_downloads ORDER BY tag, asset, day").all().map(r => `${r.tag} ${r.asset} ${r.day} ${r.count}`);
  return { store, clock, logs, fetcher, rows };
}

test("assets are sorted into file kinds; update and checksum files are kept apart", () => {
  const table = {
    "Backstage-Forever-1.26.0-Windows-x64-Setup.exe": "windows", "Backstage-Forever-1.26.0-macOS-arm64.zip": "mac-arm64", "Backstage-Forever-1.26.0-macOS-x64.zip": "mac-x64",
    "Backstage-Forever-1.26.0-Linux-x64.AppImage": "linux", "BackstageForever-Addon-1.26.0.zip": "addon", "Backstage-Forever-1.26.0-Source.zip": "source",
    "backstage-update.json": "update", "SHA256SUMS.txt": "update", "latest.yml": "update", "latest-mac.yml": "update",
    "Backstage-Forever-1.26.0-Windows-x64-Setup.exe.blockmap": "update", "Backstage-Forever-1.26.0-macOS-arm64.zip.blockmap": "update", "Backstage-Forever-1.26.0-Windows-x64-Setup.exe.sig": "update",
    "Backstage-Forever-1.20.0-mac-arm64.dmg": "mac-arm64", "Backstage-Forever-1.20.0.dmg": "mac-x64", "backstage-forever_1.26.0_amd64.deb": "linux", "Backstage-Forever-Setup-1.2.0.msi": "windows",
    "screenshot.png": "other", "README.pdf": "other",
  };
  for (const [name, kind] of Object.entries(table)) assert.equal(D.classify(name), kind, name);
  assert.deepEqual(D.CLASSES, ["windows", "mac-arm64", "mac-x64", "linux", "addon", "source", "other"]);
  assert.ok(!D.CLASSES.includes("update"));
});

test("configuration: on by default for the project's repository; a switch turns it off; values are checked", () => {
  const c = loadConfig({}, { salt: SALT }).downloads;
  assert.deepEqual(c, { enabled: true, repo: "farena-ai/Backstage-Forever", token: null });
  for (const off of ["off", "OFF", "0"]) assert.equal(loadConfig({ BF_DESK_DOWNLOADS: off }, { salt: SALT }).downloads.enabled, false);
  assert.equal(loadConfig({ BF_DESK_GITHUB_REPO: "someone/other-repo.js" }, { salt: SALT }).downloads.repo, "someone/other-repo.js");
  for (const bad of ["just-a-name", "a/b/c", "../../x", "owner/..", "https://github.com/a/b", "a b/c", "owner/repo?x=1", "owner/repo#x", "evil.example/x%40y"])
    assert.throws(() => loadConfig({ BF_DESK_GITHUB_REPO: bad }, { salt: SALT }), /BF_DESK_GITHUB_REPO/, bad);
  assert.equal(loadConfig({ BF_DESK_GITHUB_TOKEN: "github_pat_0123456789abcdefghijABCDEFGHIJ" }, { salt: SALT }).downloads.token, "github_pat_0123456789abcdefghijABCDEFGHIJ");
  for (const bad of ["short", "has space in it 0123456789012345", "line\nbreak0123456789012345678901", "x".repeat(300)]) {
    try { loadConfig({ BF_DESK_GITHUB_TOKEN: bad }, { salt: SALT }); assert.fail("accepted"); } catch (e) { assert.match(e.message, /BF_DESK_GITHUB_TOKEN/); assert.ok(!e.message.includes(bad)); }
  }
});

test("switched off: no outbound call, ever", async (t) => {
  let calls = 0;
  const store = new Store(":memory:"); t.after(() => store.close());
  const fetcher = new D.DownloadsFetcher({ store, config: { downloads: { enabled: false, repo: D.DEFAULT_REPO } }, request: () => { calls += 1; throw new Error("called"); } });
  assert.deepEqual(await fetcher.run(), { status: "off" });
  assert.deepEqual(await fetcher.run({ force: true }), { status: "off" });
  const stop = D.startDownloads(fetcher, { firstDelayMs: 1, everyMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  stop();
  assert.equal(calls, 0);
  // A config without the section is off too.
  assert.deepEqual(await new D.DownloadsFetcher({ store, config: {}, request: () => { calls += 1; } }).run({ force: true }), { status: "off" });
  assert.equal(calls, 0);
});

test("fetch: public API, fixed User-Agent, pagination, and only api.github.com is ever asked", async (t) => {
  const gh = await fakeGitHub(); t.after(() => gh.close());
  const s = setup(t, gh);
  gh.answer = (req, page) => {
    if (page === 1) return { status: 200, headers: { ETag: '"p1"', Link: '<https://evil.example/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/x?page=3>; rel="last"' }, body: [release("1.26.0", files("1.26.0", 100, 10, 5, 400)), release("1.25.1", files("1.25.1", 900, 80, 40, 3000))] };
    if (page === 2) return { status: 200, headers: { ETag: '"p2"', Link: '<https://api.github.com/x?page=3>; rel="next"' }, body: [release("1.25.0", files("1.25.0", 700, 60, 30, 2000)), release("0.9.0", [], { draft: true }), release("1.27.0-beta.1", files("1.27.0", 3), { prerelease: true })] };
    return { status: 200, headers: { ETag: '"p3"' }, body: [release("1.24.0", [asset("Backstage-Forever-1.24.0-Windows-x64-Setup.exe", 50)])] };
  };
  const r = await s.fetcher.run();
  assert.deepEqual(r, { status: "updated", releases: 5, rows: 17 });
  assert.deepEqual(gh.seen.map(x => x.path), [1, 2, 3].map(p => `/repos/farena-ai/Backstage-Forever/releases?per_page=100&page=${p}`));
  for (const a of gh.asked) assert.deepEqual([a.protocol, a.hostname, a.port, a.method], ["https:", "api.github.com", 443, "GET"]); // the "next" link to another host was not followed
  for (const x of gh.seen) {
    assert.equal(x.headers["user-agent"], "backstage-forever-desk");
    assert.equal(x.headers.accept, "application/vnd.github+json");
    assert.equal(x.headers.authorization, undefined);
    assert.equal(x.headers.cookie, undefined);
    assert.equal(x.headers["if-none-match"], undefined);
    assert.deepEqual(Object.keys(x.headers).sort(), ["accept", "connection", "host", "user-agent", "x-github-api-version"]); // nothing else leaves the server
  }
  assert.equal(s.rows().length, 17);
  assert.ok(s.rows().includes("v1.26.0 Backstage-Forever-1.26.0-Windows-x64-Setup.exe 2026-11-24 100"));
  const rels = s.store.db.prepare("SELECT tag, published_at, prerelease, first_day FROM gh_releases ORDER BY tag").all().map(x => ({ ...x }));
  assert.deepEqual(rels.map(x => x.tag), ["v1.24.0", "v1.25.0", "v1.25.1", "v1.26.0", "v1.27.0-beta.1"]); // the draft is skipped
  assert.deepEqual(rels[4], { tag: "v1.27.0-beta.1", published_at: "2026-11-01T10:00:00Z", prerelease: 1, first_day: "2026-11-24" });
  // Only tag, asset name, day and count are kept: no author, no notes, no URLs.
  const dump = JSON.stringify(s.store.db.prepare("SELECT * FROM gh_downloads").all()) + JSON.stringify(rels);
  for (const no of ["someone", "notes", "github.com/x", "Release 1.26.0"]) assert.ok(!dump.includes(no), no);

  // An optional token is sent as a bearer token, and never logged.
  const g2 = await fakeGitHub(); t.after(() => g2.close());
  const s2 = setup(t, g2, { token: "github_pat_SECRETSECRETSECRETSECRET", repo: "someone/else" });
  g2.answer = () => ({ status: 500, body: "boom" });
  assert.equal((await s2.fetcher.run()).status, "failed");
  assert.equal(g2.seen[0].headers.authorization, "Bearer github_pat_SECRETSECRETSECRETSECRET");
  assert.equal(g2.seen[0].path, "/repos/someone/else/releases?per_page=100&page=1");
  assert.ok(!s2.logs.join("\n").includes("SECRET"));

  // A list that never ends stops at ten pages.
  const g3 = await fakeGitHub(); t.after(() => g3.close());
  const s3 = setup(t, g3);
  g3.answer = (req, page) => ({ status: 200, headers: { Link: '<x>; rel="next"' }, body: [release(`3.0.${page}`, [asset("a.exe", page)])] });
  assert.equal((await s3.fetcher.run()).releases, 10);
  assert.equal(g3.seen.length, 10);
});

test("at most once an hour; an unchanged list answers 304 and stores nothing new", async (t) => {
  const gh = await fakeGitHub(); t.after(() => gh.close());
  const s = setup(t, gh);
  let win = 100, old = 50;
  gh.answer = (req, page) => {
    const tag = page === 1 ? `"p1-${win}"` : `"p2-${old}"`;
    if (req.headers["if-none-match"] === tag) return { status: 304, headers: { ETag: tag } };
    return page === 1
      ? { status: 200, headers: { ETag: tag, Link: '<x>; rel="next"' }, body: [release("1.26.0", [asset("Setup.exe", win)])] }
      : { status: 200, headers: { ETag: tag }, body: [release("1.25.0", [asset("Setup.exe", old)])] };
  };
  assert.equal((await s.fetcher.run()).status, "updated");
  assert.equal(gh.seen.length, 2);

  // Less than an hour later: no request at all.
  s.clock.t += 59 * 60_000;
  assert.deepEqual(await s.fetcher.run(), { status: "skipped" });
  assert.equal(gh.seen.length, 2);
  // An hour later: conditional requests for both pages, both unchanged.
  s.clock.t += 60_000;
  assert.deepEqual(await s.fetcher.run(), { status: "unchanged" });
  assert.deepEqual(gh.seen.slice(2).map(x => [x.page, x.headers["if-none-match"]]), [[1, '"p1-100"'], [2, '"p2-50"']]);
  assert.equal(s.rows().length, 2);

  // Next day only the old release (page 2) changed: page 1 is a 304, page 2 is read, one row is added.
  s.clock.t += DAY; old = 53;
  assert.deepEqual(await s.fetcher.run(), { status: "updated", releases: 1, rows: 1 });
  assert.deepEqual(s.rows(), ["v1.25.0 Setup.exe 2026-11-24 50", "v1.25.0 Setup.exe 2026-11-25 53", "v1.26.0 Setup.exe 2026-11-24 100"]);
  // Later the same day the newest changes twice: the last value of the day wins.
  s.clock.t += HOUR; win = 110;
  await s.fetcher.run();
  s.clock.t += HOUR; win = 125;
  await s.fetcher.run();
  assert.deepEqual(s.rows().filter(r => r.startsWith("v1.26.0")), ["v1.26.0 Setup.exe 2026-11-24 100", "v1.26.0 Setup.exe 2026-11-25 125"]);
  // A manual run skips the one-hour wait (it is still a conditional request).
  const before = gh.seen.length;
  s.clock.t += 60_000;
  assert.deepEqual(await s.fetcher.run({ force: true }), { status: "unchanged" });
  assert.equal(gh.seen.length, before + 2);
  // Two runs at once share one fetch.
  s.clock.t += HOUR;
  const [a, b] = await Promise.all([s.fetcher.run(), s.fetcher.run()]);
  assert.equal(a, b);
  assert.equal(gh.seen.length, before + 4);
});

test("rate limits: GitHub says wait, so we wait, also on a manual run", async (t) => {
  const gh = await fakeGitHub(); t.after(() => gh.close());
  const s = setup(t, gh);
  const reset = Math.floor((T0 + 40 * 60_000) / 1000);
  gh.answer = () => ({ status: 403, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) }, body: { message: "API rate limit exceeded for 203.0.113.9." } });
  const r = await s.fetcher.run();
  assert.equal(r.status, "backoff");
  assert.equal(r.until, new Date(reset * 1000 + 5000).toISOString());
  assert.equal(gh.seen.length, 1);
  assert.equal(s.logs.length, 1);
  assert.match(s.logs[0], /downloads fetch: rate limited by GitHub, next try after 2026-11-24T12:40:05\.000Z$/);
  assert.ok(!s.logs[0].includes("203.0.113.9"), "the answer's text is not logged");
  s.clock.t += 39 * 60_000;
  assert.equal((await s.fetcher.run({ force: true })).status, "backoff");
  assert.equal(gh.seen.length, 1, "no request while waiting");
  gh.answer = () => ({ status: 200, body: [release("1.26.0", [asset("Setup.exe", 1)])] });
  s.clock.t += 2 * 60_000;
  assert.equal((await s.fetcher.run({ force: true })).status, "updated");

  // 429 with Retry-After; a wait is never shorter than a minute nor longer than six hours.
  for (const [headers, wantMs] of [[{ "Retry-After": "120" }, 120_000], [{ "Retry-After": "1" }, 60_000], [{ "Retry-After": "999999" }, 6 * HOUR], [{}, HOUR],
    [{ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.floor((T0 + 99 * DAY) / 1000)) }, 6 * HOUR]]) {
    const g = await fakeGitHub(); t.after(() => g.close());
    const x = setup(t, g);
    g.answer = () => ({ status: 429, headers, body: "slow down" });
    assert.equal((await x.fetcher.run()).until, new Date(T0 + wantMs).toISOString(), JSON.stringify(headers));
  }
  // A good answer that used the last allowed request also waits for the reset.
  const g = await fakeGitHub(); t.after(() => g.close());
  const x = setup(t, g);
  g.answer = () => ({ status: 200, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.floor((T0 + 2 * HOUR) / 1000)) }, body: [release("1.26.0", [asset("Setup.exe", 1)])] });
  assert.equal((await x.fetcher.run()).status, "updated");
  x.clock.t += HOUR + 1000;
  assert.equal((await x.fetcher.run()).status, "backoff");
  x.clock.t += HOUR + 5000;
  assert.equal((await x.fetcher.run()).status, "updated"); // no ETag was sent by the fake, so it is read again
});

test("malformed answers and failures store nothing, are logged without noise, and never throw", async (t) => {
  const good = [release("1.26.0", [asset("Setup.exe", 5)])];
  const bad = {
    "not JSON": "<html>oops</html>", "an object": { message: "Not Found" }, "a string": '"hello"', "null": "null",
    "release not an object": [1], "missing tag": [{ assets: [] }], "tag with markup": [release("<script>", [])], "tag too long": [release("x".repeat(80), [])],
    "assets missing": [{ tag_name: "v1" }], "assets not a list": [{ tag_name: "v1", assets: {} }], "asset null": [release("1.0.0", [null])],
    "asset name with markup": [release("1.0.0", [asset("<img src=x>.exe", 1)])], "asset name with a path": [release("1.0.0", [asset("../../etc/passwd", 1)])],
    "negative count": [release("1.0.0", [asset("a.exe", -1)])], "count as text": [release("1.0.0", [asset("a.exe", "12")])], "count not whole": [release("1.0.0", [asset("a.exe", 1.5)])],
    "count absurd": [release("1.0.0", [asset("a.exe", 1e300)])], "101 releases": Array.from({ length: 101 }, (_, i) => release(`1.0.${i}`, [])),
  };
  for (const [label, body] of Object.entries(bad)) {
    const gh = await fakeGitHub(); t.after(() => gh.close());
    const s = setup(t, gh);
    gh.answer = () => ({ status: 200, headers: { ETag: '"bad"' }, body });
    const r = await s.fetcher.run();
    assert.deepEqual(r, { status: "failed", why: "unexpected answer" }, label);
    assert.equal(s.rows().length, 0, label);
    assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM gh_releases").get().c, 0, label);
    assert.deepEqual(s.logs.map(l => l.replace(/^\S+ /, "")), ["downloads fetch failed: unexpected answer"], label);
    // The bad page's ETag is not remembered, so a later good answer is read in full.
    gh.answer = (req) => { assert.equal(req.headers["if-none-match"], undefined); return { status: 200, body: good }; };
    s.clock.t += HOUR;
    assert.equal((await s.fetcher.run()).status, "updated", label);
  }
  // A page that fails half way through a list: nothing of that run is stored.
  const gh = await fakeGitHub(); t.after(() => gh.close());
  const s = setup(t, gh);
  gh.answer = (req, page) => (page === 1 ? { status: 200, headers: { Link: '<x>; rel="next"' }, body: good } : { status: 200, body: "{broken" });
  assert.equal((await s.fetcher.run()).status, "failed");
  assert.equal(s.rows().length, 0);

  // Server errors, redirects (never followed), an answer that is too large.
  for (const [answer, why] of [[{ status: 500, body: "x" }, "status 500"], [{ status: 404, body: { message: "Not Found" } }, "status 404"], [{ status: 302, headers: { Location: "https://evil.example/" } }, "status 302"],
    [{ status: 200, body: Buffer.alloc(4 * 1024 * 1024 + 10, 32) }, "too large"]]) {
    const g = await fakeGitHub(); t.after(() => g.close());
    const x = setup(t, g);
    g.answer = () => answer;
    assert.deepEqual(await x.fetcher.run(), { status: "failed", why });
    assert.equal(g.seen.length, 1);
    assert.deepEqual(x.logs.map(l => l.replace(/^\S+ /, "")), [`downloads fetch failed: ${why}`]);
  }

  // Repeated failures: tries are spaced out (1 h, 2 h, 4 h, 6 h at most) and only the first is logged.
  const g = await fakeGitHub(); t.after(() => g.close());
  const x = setup(t, g);
  g.answer = () => ({ status: 503, body: "down" });
  for (let i = 0; i < 200; i++) { await x.fetcher.run(); x.clock.t += 30 * 60_000; } // 100 hours of half-hourly ticks
  assert.ok(g.seen.length >= 16 && g.seen.length <= 22, `${g.seen.length} requests in 100 hours`);
  assert.equal(x.logs.length, 1, "one line, not one per failure");
  g.answer = () => ({ status: 200, body: good });
  x.clock.t += 6 * HOUR;
  assert.equal((await x.fetcher.run()).status, "updated");

  // No network at all, a request function that throws, a broken logger: still no exception.
  const dead = setup(t, { request: () => { const e = new Error("getaddrinfo ENOTFOUND api.github.com"); e.code = "ENOTFOUND"; throw e; } });
  assert.deepEqual(await dead.fetcher.run(), { status: "failed", why: "ENOTFOUND" });
  const store = new Store(":memory:"); t.after(() => store.close());
  const loud = new D.DownloadsFetcher({ store, config: { downloads: { enabled: true, repo: D.DEFAULT_REPO } }, request: () => { throw new Error("x"); }, log: () => { throw new Error("log broke"); } });
  assert.equal((await loud.run()).status, "failed");
});

test("delta maths: daily downloads from cumulative counts, a new release, and a count that goes down", (t) => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const snap = (day, list) => D.recordSnapshot(store, list.map(([v, win, mac, addon, update, extra = {}]) => release(v, files(v, win, mac, addon, update), extra)).map(r => D.parseReleases([r])[0]), at(day));
  // Day 1 (tracking starts): two releases already exist with history.
  snap("2026-11-20", [["1.25.0", 1000, 100, 50, 5000, { published_at: "2026-10-01T09:00:00Z" }], ["1.24.0", 400, 40, 20, 900, { published_at: "2026-09-01T09:00:00Z" }]]);
  // Day 2: +30 / +3 / +1 on 1.25.0; 1.24.0 unchanged (no row written).
  assert.equal(snap("2026-11-21", [["1.25.0", 1030, 103, 51, 5200, { published_at: "2026-10-01T09:00:00Z" }], ["1.24.0", 400, 40, 20, 900, { published_at: "2026-09-01T09:00:00Z" }]]), 4);
  // Day 3: 1.26.0 appears with 70 Windows, 8 Mac, 4 addon downloads already; 1.25.0 +5 Windows.
  snap("2026-11-22", [["1.26.0", 70, 8, 4, 300, { published_at: "2026-11-22T08:00:00Z" }], ["1.25.0", 1035, 103, 51, 5300, { published_at: "2026-10-01T09:00:00Z" }]]);
  // Day 4: GitHub recounts 1.25.0 Windows DOWN by 15 (never negative); 1.26.0 +120 Windows, +10 Mac.
  snap("2026-11-23", [["1.26.0", 190, 18, 4, 900, { published_at: "2026-11-22T08:00:00Z" }], ["1.25.0", 1020, 103, 51, 5300, { published_at: "2026-10-01T09:00:00Z" }]]);
  // Day 5 (today), read twice: the later reading replaces the earlier one. 1.25.0 Windows climbs from the lower value.
  snap("2026-11-24", [["1.26.0", 200, 18, 4, 950, { published_at: "2026-11-22T08:00:00Z" }], ["1.25.0", 1022, 103, 51, 5300, { published_at: "2026-10-01T09:00:00Z" }]]);
  snap("2026-11-24", [["1.26.0", 260, 20, 6, 990, { published_at: "2026-11-22T08:00:00Z" }], ["1.25.0", 1022, 103, 51, 5300, { published_at: "2026-10-01T09:00:00Z" }]]);

  const d = D.downloadStats(store, { now: T0, days: 7 });
  assert.equal(d.empty, false);
  assert.equal(d.trackingStart, "2026-11-20");
  assert.deepEqual(d.days, ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
  const row = (cls) => d.perDay[d.classes.indexOf(cls)];
  //                          18 19 20  21  22   23  24
  assert.deepEqual(row("windows"), [0, 0, 0, 30, 75, 120, 72]); // 22nd: 70 new release + 5; 23rd: 120 + max(0, -15); 24th: 70 + 2
  assert.deepEqual(row("mac-arm64"), [0, 0, 0, 3, 8, 10, 2]);
  assert.deepEqual(row("addon"), [0, 0, 0, 1, 4, 0, 2]);
  assert.deepEqual(row("linux"), [0, 0, 0, 0, 0, 0, 0]);
  assert.ok(d.perDay.every(list => list.every(n => n >= 0)), "never negative");
  assert.equal(d.inRange, 30 + 75 + 120 + 72 + 3 + 8 + 10 + 2 + 1 + 4 + 2);
  assert.equal(d.sinceStart, d.inRange);
  // All-time totals are GitHub's latest counts, update files left out.
  assert.deepEqual(d.totals, { windows: 260 + 1022 + 400, "mac-arm64": 20 + 103 + 40, "mac-x64": 0, linux: 0, addon: 6 + 51 + 20, source: 0, other: 0 });
  assert.equal(d.total, 1682 + 163 + 77);
  assert.deepEqual(d.byClass.map(x => [x.cls, x.n, x.pct]).slice(0, 2), [["windows", 1682, 87.5], ["mac-arm64", 163, 8.5]]);
  assert.ok(!d.byClass.some(x => x.cls === "other"), "an empty 'other' row is not shown");
  assert.deepEqual(d.updates, [{ name: "backstage-update.json", n: 990 + 5300 + 900 }]);
  // Per release, newest first, with days since it was published.
  assert.deepEqual(d.releases.map(r => [r.tag, r.published, r.daysSince, r.counts.windows, r.total]), [["v1.26.0", "2026-11-22", 2, 260, 286], ["v1.25.0", "2026-10-01", 54, 1022, 1176], ["v1.24.0", "2026-09-01", 84, 400, 460]]);
  // The newest release's running total, a gap before it existed.
  assert.equal(d.latest.tag, "v1.26.0");
  assert.deepEqual(d.latest.values, [null, null, null, null, 82, 212, 286]);

  // A shorter window that starts after tracking began still knows the earlier counts.
  const two = D.downloadStats(store, { now: T0, days: 2 });
  assert.deepEqual(two.perDay[0], [120, 72]);
  assert.deepEqual(two.latest.values, [212, 286]);
  assert.equal(two.sinceStart, d.sinceStart);
  // A pre-release is listed and marked but is never "the latest release".
  D.recordSnapshot(store, D.parseReleases([release("2.0.0-beta.1", files("2.0.0", 9), { prerelease: true, published_at: "2026-11-24T09:00:00Z" })]), T0);
  const withBeta = D.downloadStats(store, { now: T0, days: 7 });
  assert.equal(withBeta.latest.tag, "v1.26.0");
  assert.deepEqual([withBeta.releases[0].tag, withBeta.releases[0].prerelease], ["v2.0.0-beta.1", true]);
  assert.equal(withBeta.perDay[0].at(-1), 81);

  const empty = new Store(":memory:"); t.after(() => empty.close());
  const e = D.downloadStats(empty, { now: T0, days: 30 });
  assert.equal(e.empty, true);
  assert.equal(e.trackingStart, null);
});

test("schema 3 is added to a schema 2 database without touching anything else", (t) => {
  const tmp = tempDb();
  let store = new Store(tmp.file);
  t.after(() => { try { store.close(); } catch { /* closed */ } tmp.cleanup(); });
  store.desk.createTicket("a".repeat(64), require("./helpers").ticket("x"), T0);
  store.db.exec("DROP TABLE gh_downloads; DROP TABLE gh_releases; PRAGMA user_version = 2;"); // what the live database looks like today
  store.close();
  store = new Store(tmp.file);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM tickets").get().c, 1);
  assert.equal(D.recordSnapshot(store, D.parseReleases([release("1.26.0", [asset("Setup.exe", 5)])]), T0), 1);
  assert.equal(store.desk.createTicket("a".repeat(64), require("./helpers").ticket("x"), T0).ticket, "BF-1002");
});

test("dashboard: the Downloads section says plainly that downloads are not new players", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await admin(s);
  let body = await (await get(s.base, "/admin/", { cookie: a.cookie })).text();
  assert.match(body, /<div class="section-head"><h2>Downloads<\/h2>/);
  assert.match(body, /No download counts yet\. The service asks GitHub about once an hour\./);

  const hostile = '<script>alert(1)</script>';
  for (const [day, win] of [["2026-11-22", 100], ["2026-11-23", 160], ["2026-11-24", 200]])
    D.recordSnapshot(s.store, D.parseReleases([release("1.26.0", files("1.26.0", win, 10, 5, 800), { published_at: "2026-11-10T08:00:00Z" })]), at(day));
  // Names are checked on the way in; even a name planted in the database is escaped on the page.
  s.store.db.prepare("INSERT INTO gh_downloads(tag, asset, day, count) VALUES (?, ?, '2026-11-24', 3)").run("v1.26.0", `${hostile}.json`);
  s.store.db.prepare("INSERT INTO gh_releases(tag, published_at, prerelease, first_day) VALUES (?, NULL, 1, '2026-11-24')").run(hostile);
  s.store.db.prepare("INSERT INTO gh_downloads(tag, asset, day, count) VALUES (?, 'x.exe', '2026-11-24', 3)").run(hostile);
  s.clock.t += 61_000; // past the dashboard's one-minute cache
  const res = await get(s.base, "/admin/?days=7", { cookie: a.cookie });
  body = await res.text();
  assert.ok(!body.includes(hostile));
  assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal((body.match(/<script\b/g) || []).length, 1);
  assert.match(body, /Downloads are not new players\. Installer downloads include automatic updates of existing installs/);
  for (const title of ["Downloads by platform, all time", "Downloads per day", "Update and checksum files", "Downloads per release", "Downloads of v1.26.0"]) assert.ok(body.includes(`<h3>${title}</h3>`), title);
  assert.match(body, /Tracking started on 2026-11-22; earlier days cannot be shown\./);
  assert.match(body, /<th scope="row">Windows installer<\/th>.*?<td class="n">203<\/td>/s);
  assert.match(body, /<th scope="row">v1\.26\.0<\/th><td class="nowrap">2026-11-10<\/td><td class="n">14<\/td><td class="n">200<\/td>/);
  assert.match(body, /103 downloads in the last 7 days/); // 60 + 40 on the installer, 3 from the release first seen today
  assert.match(await (await get(s.base, "/admin/data", { cookie: a.cookie })).text(), /GitHub download counts \(public data\)<\/th><td class="n">8<\/td>/);

  // Switched off: the section says so and draws nothing.
  const off = await boot({ downloads: { enabled: false } }); t.after(() => off.close());
  const b = await admin(off);
  const offBody = await (await get(off.base, "/admin/", { cookie: b.cookie })).text();
  assert.match(offBody, /Download counts are switched off on this server\./);
  assert.ok(!offBody.includes("Downloads by platform"));
});
