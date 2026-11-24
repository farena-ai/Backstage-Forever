"use strict";
// Download counts of the public GitHub releases, for the Desk dashboard.
//
// At most once an hour the service asks the PUBLIC GitHub API for the release
// list of one repository and keeps, per release tag and asset name, the
// cumulative download count per UTC day (last value of the day wins). No
// player data is involved in either direction: the request carries nothing
// but a fixed User-Agent (and an optional token from the env file), and the
// answer is public information about files.
//
// Rules this file keeps:
//  - Outbound HTTPS only, and only to api.github.com. Redirects are not followed.
//  - Conditional requests (ETag / If-None-Match) so an unchanged list costs nothing.
//  - Rate-limit answers and failures push the next try back; nothing here can
//    slow down or fail a request to the service.
//  - A failure is logged as one short line without any content.
const https = require("node:https");

const API_HOST = "api.github.com";
const DEFAULT_REPO = "farena-ai/Backstage-Forever";
const USER_AGENT = "backstage-forever-desk";
const HOUR = 3_600_000, DAY_MS = 86_400_000;
const MAX_PAGES = 10, MAX_BODY = 4 * 1024 * 1024, MAX_BACKOFF = 6 * HOUR;

// Asset classes. "update" files are fetched by the app's updater and by people
// checking a download; they are shown but never counted as downloads.
const CLASSES = Object.freeze(["windows", "mac-arm64", "mac-x64", "linux", "addon", "source", "other"]);
const CLASS_LABEL = Object.freeze({
  windows: "Windows installer", "mac-arm64": "macOS (Apple silicon)", "mac-x64": "macOS (Intel)", linux: "Linux AppImage",
  addon: "Addon zip", source: "Source zip", other: "Other files", update: "Update and checksum files",
});

function classify(name) {
  const n = String(name);
  if (/\.(?:blockmap|ya?ml|json|sig|asc|sha256|sha512|txt)$/i.test(n) || /sha256sums|checksums?/i.test(n)) return "update";
  if (/addon/i.test(n) && /\.zip$/i.test(n)) return "addon";
  if (/source/i.test(n) && /\.(?:zip|tar\.gz|tgz)$/i.test(n)) return "source";
  if (/\.(?:exe|msi)$/i.test(n)) return "windows";
  if (/mac(?:os)?|darwin|osx/i.test(n) && /\.(?:zip|dmg|pkg)$/i.test(n)) return /arm64|aarch64/i.test(n) ? "mac-arm64" : "mac-x64";
  if (/\.dmg$/i.test(n)) return /arm64|aarch64/i.test(n) ? "mac-arm64" : "mac-x64";
  if (/\.(?:appimage|deb|rpm)$/i.test(n) || (/linux/i.test(n) && /\.(?:zip|tar\.gz|tgz)$/i.test(n))) return "linux";
  return "other";
}

function day(now) { return new Date(now).toISOString().slice(0, 10); }
function addDays(d, n) { return day(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS); }

function parseRepo(value, name = "BF_DESK_GITHUB_REPO") {
  const repo = value === undefined || value === "" ? DEFAULT_REPO : String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo) || repo.includes("..")) throw new Error(`${name} must look like owner/repository`);
  return repo;
}
function parseToken(value, name = "BF_DESK_GITHUB_TOKEN") {
  if (value === undefined || value === "") return null;
  if (!/^[A-Za-z0-9_]{20,255}$/.test(String(value))) throw new Error(`${name} does not look like a GitHub token`);
  return String(value);
}

class BadResponse extends Error {}

// Turns one page of the API answer into plain rows, or throws BadResponse.
// Everything is checked: this is data from the network.
function parseReleases(json) {
  if (!Array.isArray(json) || json.length > 100) throw new BadResponse("not a release list");
  const out = [];
  for (const r of json) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw new BadResponse("release is not an object");
    if (r.draft === true) continue;
    if (typeof r.tag_name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,59}$/.test(r.tag_name)) throw new BadResponse("bad tag");
    const published = typeof r.published_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.published_at) ? r.published_at : null;
    if (!Array.isArray(r.assets) || r.assets.length > 200) throw new BadResponse("bad assets");
    const assets = new Map();
    for (const a of r.assets) {
      if (a === null || typeof a !== "object") throw new BadResponse("asset is not an object");
      if (typeof a.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+ ()-]{0,149}$/.test(a.name)) throw new BadResponse("bad asset name");
      if (!Number.isSafeInteger(a.download_count) || a.download_count < 0) throw new BadResponse("bad download count");
      assets.set(a.name, a.download_count);
    }
    out.push({ tag: r.tag_name, publishedAt: published, prerelease: r.prerelease === true, assets: [...assets].map(([name, count]) => ({ name, count })) });
  }
  return out;
}

function meta(store, key) { const r = store.db.prepare("SELECT v FROM meta WHERE k = ?").get(key); return r ? r.v : null; }
function setMeta(store, key, value) { store.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run(key, String(value)); }

// Stores what was just read. A row is written only when a count is new or has
// changed, so a quiet day costs nothing; a second reading on the same day
// replaces that day's value.
function recordSnapshot(store, releases, now = Date.now()) {
  const d = day(now), db = store.db;
  let rows = 0;
  store.tx(() => {
    const putRelease = db.prepare(`INSERT INTO gh_releases(tag, published_at, prerelease, first_day) VALUES (?, ?, ?, ?)
      ON CONFLICT(tag) DO UPDATE SET published_at = excluded.published_at, prerelease = excluded.prerelease`);
    const last = db.prepare("SELECT day, count FROM gh_downloads WHERE tag = ? AND asset = ? ORDER BY day DESC LIMIT 1");
    const put = db.prepare("INSERT OR REPLACE INTO gh_downloads(tag, asset, day, count) VALUES (?, ?, ?, ?)");
    for (const r of releases) {
      putRelease.run(r.tag, r.publishedAt, r.prerelease ? 1 : 0, d);
      for (const a of r.assets) {
        const prev = last.get(r.tag, a.name);
        if (prev && prev.count === a.count) continue;
        put.run(r.tag, a.name, d, a.count);
        rows += 1;
      }
    }
  });
  return rows;
}

class DownloadsFetcher {
  // config.downloads: { enabled, repo, token }
  constructor({ store, config, log = () => {}, now = () => Date.now(), request = https.request }) {
    this.store = store; this.c = config.downloads || { enabled: false }; this.log = log; this.now = now; this.request = request;
    this.running = null;
  }

  note(line) { try { this.log(`${new Date(this.now()).toISOString()} ${line}`); } catch { /* logging must not throw */ } }

  // One GET. Resolves { status, headers, body } and never rejects with content.
  get(path, etag) {
    return new Promise((resolve, reject) => {
      // The allow-list: this is the only host this code can ever talk to.
      const options = {
        protocol: "https:", hostname: API_HOST, port: 443, method: "GET", path, timeout: 15_000,
        headers: {
          "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          ...(etag ? { "If-None-Match": etag } : {}), ...(this.c.token ? { Authorization: `Bearer ${this.c.token}` } : {}),
        },
      };
      if (options.hostname !== API_HOST || !path.startsWith("/repos/")) return reject(new Error("host"));
      let done = false;
      const fail = (why) => { if (!done) { done = true; reject(new Error(why)); } };
      let req;
      try {
        req = this.request(options, (res) => {
          const chunks = []; let size = 0;
          res.on("data", (c) => { size += c.length; if (size > MAX_BODY) { res.destroy(); fail("too large"); } else chunks.push(c); });
          res.on("end", () => { if (!done) { done = true; resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); } });
          res.on("error", () => fail("response error"));
        });
      } catch (e) { return fail(e && e.code ? e.code : "request error"); }
      req.on("timeout", () => { req.destroy(); fail("timeout"); });
      req.on("error", (e) => fail(e && e.code ? e.code : "request error"));
      req.end();
    });
  }

  backoffFrom(headers, now) {
    const retry = Number(headers["retry-after"]), reset = Number(headers["x-ratelimit-reset"]) * 1000;
    let until = now + HOUR;
    if (Number.isFinite(retry) && retry > 0) until = now + retry * 1000;
    else if (String(headers["x-ratelimit-remaining"]) === "0" && Number.isFinite(reset) && reset > now) until = reset + 5000;
    return Math.min(now + MAX_BACKOFF, Math.max(now + 60_000, until));
  }

  // Resolves to { status, ... } with status one of:
  // off, skipped (asked less than an hour ago), backoff, unchanged, updated, failed.
  // Never rejects. Two runs never overlap.
  run({ force = false } = {}) {
    if (this.running) return this.running;
    this.running = this.runOnce(force).catch(() => ({ status: "failed", why: "error" })).finally(() => { this.running = null; });
    return this.running;
  }

  async runOnce(force) {
    const now = this.now(), store = this.store;
    if (!this.c.enabled) return { status: "off" };
    const backoff = Number(meta(store, "downloads_backoff_ms")) || 0;
    if (backoff > now) return { status: "backoff", until: new Date(backoff).toISOString() };
    const last = Number(meta(store, "downloads_attempt_ms")) || 0;
    if (!force && now - last < HOUR) return { status: "skipped" };
    setMeta(store, "downloads_attempt_ms", now);

    let etags = {};
    try { const e = JSON.parse(meta(store, "downloads_etags") || "{}"); if (e && typeof e === "object" && e.repo === this.c.repo) etags = e; } catch { etags = {}; }
    const knownPages = Number(etags.pages) || 0;
    const fresh = { repo: this.c.repo, pages: 0 }, releases = [];
    let changed = false, lowQuota = null;
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await this.get(`/repos/${this.c.repo}/releases?per_page=100&page=${page}`, typeof etags[page] === "string" ? etags[page] : null);
        if (res.status === 304) {
          fresh[page] = etags[page]; fresh.pages = page;
          if (page >= knownPages) break;
          continue;
        }
        if (res.status === 403 || res.status === 429) {
          const until = this.backoffFrom(res.headers, now);
          setMeta(store, "downloads_backoff_ms", until);
          this.note(`downloads fetch: rate limited by GitHub, next try after ${new Date(until).toISOString()}`);
          return { status: "backoff", until: new Date(until).toISOString() };
        }
        if (res.status !== 200) throw new Error(`status ${res.status}`);
        let json;
        try { json = JSON.parse(res.body.toString("utf8")); } catch { throw new BadResponse("not JSON"); }
        releases.push(...parseReleases(json));
        changed = true;
        if (typeof res.headers.etag === "string" && res.headers.etag.length < 200) fresh[page] = res.headers.etag;
        fresh.pages = page;
        if (String(res.headers["x-ratelimit-remaining"]) === "0") lowQuota = this.backoffFrom(res.headers, now);
        if (!/<[^>]*>;\s*rel="next"/.test(String(res.headers.link || ""))) break;
      }
    } catch (e) {
      const fails = (Number(meta(store, "downloads_fails")) || 0) + 1;
      setMeta(store, "downloads_fails", fails);
      setMeta(store, "downloads_backoff_ms", now + Math.min(MAX_BACKOFF, HOUR * 2 ** Math.min(fails - 1, 3)) - 60_000);
      const why = e instanceof BadResponse ? "unexpected answer" : /^(status \d{3}|timeout|too large|E[A-Z_]+)$/.test(e.message) ? e.message : "request error";
      if (fails === 1 || fails % 24 === 0) this.note(`downloads fetch failed: ${why}${fails > 1 ? ` (${fails} times in a row)` : ""}`);
      return { status: "failed", why };
    }
    setMeta(store, "downloads_fails", 0);
    setMeta(store, "downloads_ok_ms", now);
    if (lowQuota) setMeta(store, "downloads_backoff_ms", lowQuota);
    if (!changed) return { status: "unchanged" };
    const rows = recordSnapshot(store, releases, now);
    setMeta(store, "downloads_etags", JSON.stringify(fresh));
    return { status: "updated", releases: releases.length, rows };
  }
}

// Runs the fetch on its own timer: a first try shortly after start, then every 61 minutes.
function startDownloads(fetcher, { firstDelayMs = 90_000, everyMs = 61 * 60_000 } = {}) {
  if (!fetcher.c.enabled) return () => {};
  const tick = () => { fetcher.run().catch(() => {}); };
  const first = setTimeout(tick, firstDelayMs), timer = setInterval(tick, everyMs);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

// Numbers for the dashboard. Daily downloads are the differences between
// stored counts. An asset that already existed when tracking began has no
// difference on its first day; a release first seen later counts in full on
// the day it appeared. A count that goes down (GitHub recounts now and then)
// is treated as no downloads, never as a negative number.
function downloadStats(store, { now = Date.now(), days = 30 } = {}) {
  const db = store.db, today = day(now), start = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
  const first = db.prepare("SELECT MIN(day) AS d FROM gh_downloads").get().d;
  const okMs = Number(meta(store, "downloads_ok_ms")) || 0;
  const base = { days: dayList, classes: CLASSES, labels: CLASS_LABEL, trackingStart: first, lastChecked: okMs ? new Date(okMs).toISOString() : null };
  if (!first) return { ...base, empty: true };

  const rels = new Map(db.prepare("SELECT tag, published_at, prerelease, first_day FROM gh_releases").all().map(r => [r.tag, r]));
  const zero = () => Object.fromEntries(CLASSES.map(c => [c, 0]));
  const perDay = new Map(dayList.map(d => [d, zero()]));
  const totals = zero(), byRelease = new Map(), updates = new Map(), sinceStart = zero();
  const series = new Map(); // tag -> [{ day, total }] of counted classes, for the latest-release curve
  let cur = null, prev = null;
  const flush = () => {
    if (!cur) return;
    if (cur.cls === "update") {
      const key = cur.asset.replace(/\d+\.\d+\.\d+/g, "<version>");
      updates.set(key, (updates.get(key) || 0) + prev);
    } else {
      totals[cur.cls] += prev;
      const r = byRelease.get(cur.tag) || zero();
      r[cur.cls] += prev;
      byRelease.set(cur.tag, r);
    }
  };
  for (const row of db.prepare("SELECT tag, asset, day, count FROM gh_downloads ORDER BY tag, asset, day").all()) {
    if (!cur || cur.tag !== row.tag || cur.asset !== row.asset) { flush(); cur = { tag: row.tag, asset: row.asset, cls: classify(row.asset) }; prev = null; }
    const rel = rels.get(row.tag);
    let delta = null;
    if (prev !== null) delta = Math.max(0, row.count - prev);
    else if (rel && rel.first_day > first) delta = row.count; // a release that appeared after tracking began
    if (cur.cls !== "update") {
      if (delta !== null) {
        sinceStart[cur.cls] += delta;
        const bucket = perDay.get(row.day);
        if (bucket) bucket[cur.cls] += delta;
      }
      const s = series.get(row.tag) || [];
      s.push({ day: row.day, asset: row.asset, count: row.count });
      series.set(row.tag, s);
    }
    prev = row.count;
  }
  flush();

  const stable = [...rels.values()].filter(r => !r.prerelease && byRelease.has(r.tag)).sort((a, b) => String(b.published_at || b.first_day).localeCompare(String(a.published_at || a.first_day)));
  const latest = stable[0] || null;
  let latestCurve = null;
  if (latest) {
    const points = series.get(latest.tag) || [], state = new Map();
    const before = points.filter(p => p.day < start);
    for (const p of before) state.set(p.asset, p.count);
    const byDay = new Map();
    for (const p of points) if (p.day >= start) { const l = byDay.get(p.day) || []; l.push(p); byDay.set(p.day, l); }
    const firstDay = points.length ? points.reduce((m, p) => (p.day < m ? p.day : m), points[0].day) : null;
    latestCurve = {
      tag: latest.tag, publishedAt: latest.published_at, firstDay,
      values: dayList.map((d) => {
        for (const p of byDay.get(d) || []) state.set(p.asset, p.count);
        return firstDay && d >= firstDay ? [...state.values()].reduce((a, b) => a + b, 0) : null;
      }),
    };
  }
  const sum = (o) => CLASSES.reduce((a, c) => a + o[c], 0);
  const releases = [...byRelease.entries()].map(([tag, counts]) => {
    const r = rels.get(tag) || { published_at: null, prerelease: 0, first_day: first };
    const pub = r.published_at ? r.published_at.slice(0, 10) : null;
    return { tag, published: pub, prerelease: !!r.prerelease, daysSince: pub ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${pub}T00:00:00Z`)) / DAY_MS)) : null, counts, total: sum(counts) };
  }).sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")) || b.tag.localeCompare(a.tag));
  const total = sum(totals);
  return {
    ...base, empty: false, total, totals,
    byClass: CLASSES.map(c => ({ cls: c, label: CLASS_LABEL[c], n: totals[c], pct: total ? Math.round((totals[c] / total) * 1000) / 10 : 0 })).filter(x => x.n > 0 || x.cls !== "other"),
    perDay: CLASSES.map(c => dayList.map(d => perDay.get(d)[c])),
    inRange: dayList.reduce((a, d) => a + sum(perDay.get(d)), 0),
    sinceStart: sum(sinceStart),
    releases, latest: latestCurve,
    updates: [...updates.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
  };
}

module.exports = { DownloadsFetcher, startDownloads, downloadStats, recordSnapshot, parseReleases, classify, parseRepo, parseToken, CLASSES, CLASS_LABEL, API_HOST, DEFAULT_REPO, USER_AGENT };
