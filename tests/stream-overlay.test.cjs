"use strict";
// Stream overlay (S7): a page on 127.0.0.1 only, two addresses, read-only, off until switched on.
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), net = require("node:net"), fs = require("node:fs"), path = require("node:path");
const O = require("../src/core/stream-overlay.cjs");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const PORT = 51234;
const ask = (over = {}, state = () => ({ level: 24 })) => O.respond({ method: "GET", url: "/", headers: { host: `127.0.0.1:${PORT}` }, ...over }, PORT, state);

test("only the page and the small JSON are served, to GET and HEAD", () => {
  const page = ask();
  assert.equal(page.status, 200); assert.match(page.headers["Content-Type"], /^text\/html/); assert.equal(page.body, O.PAGE);
  assert.match(page.headers["Content-Security-Policy"], /default-src 'none'/); assert.match(page.headers["Content-Security-Policy"], /connect-src 'self'/);
  assert.doesNotMatch(page.headers["Content-Security-Policy"], /unsafe/); assert.equal(page.headers["Cache-Control"], "no-store");
  assert.equal(page.headers["Access-Control-Allow-Origin"], undefined, "no other site may read it");
  const json = ask({ url: "/state.json" }, () => ({ level: 24, xpPercent: 41.6, zone: "Westfall", splitSeconds: 5400, splitLabel: "Level 23 to 24", deaths: 2, step: "Hand in Red Silk Bandanas", stepDetail: "To Scout Riell", live: true, secret: "x", path: "C:\\Users" }));
  assert.equal(json.status, 200); assert.match(json.headers["Content-Type"], /^application\/json/);
  assert.deepEqual(JSON.parse(json.body), { level: 24, xpPercent: 42, zone: "Westfall", splitSeconds: 5400, splitLabel: "Level 23 to 24", deaths: 2, step: "Hand in Red Silk Bandanas", stepDetail: "To Scout Riell", live: true });
  assert.equal(ask({ method: "HEAD" }).status, 200); assert.equal(ask({ method: "HEAD" }).body, ""); assert.equal(ask({ method: "HEAD", url: "/state.json" }).body, "");
  assert.equal(ask({ headers: { host: `localhost:${PORT}` } }).status, 200);
  assert.equal(ask({ headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, "sec-fetch-site": "same-origin" } }).status, 200);
});

test("every other path is refused", () => {
  for (const url of ["/index.html", "/state", "/state.json/", "/state.json?x=1", "/?file=C:/Windows/win.ini", "//", "/..", "/../state.json", "/%2e%2e/", "/favicon.ico", "/overlay", "/STATE.JSON", "", "*", "http://127.0.0.1/", "/state.json#x", `/${"a".repeat(200)}`, "/api/profiles", "/journey.json", "/.env", "\\", undefined, null, 5]) {
    const r = ask({ url });
    assert.equal(r.status, 404, String(url)); assert.equal(r.body, "", String(url));
  }
});

test("every other method is refused", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT", "get", "PROPFIND", "", undefined]) {
    for (const url of ["/", "/state.json"]) {
      const r = ask({ method, url });
      assert.equal(r.status, 405, `${method} ${url}`); assert.equal(r.headers.Allow, "GET, HEAD"); assert.equal(r.body, "");
    }
  }
  assert.equal(ask({ method: "POST", url: "/other" }).status, 404, "an unknown path stays unknown whatever the method");
});

test("every other host name and every request from another website is refused", () => {
  for (const host of [undefined, "", "127.0.0.1", "localhost", `127.0.0.1:${PORT + 1}`, `example.com:${PORT}`, "example.com", `192.168.1.20:${PORT}`, `0.0.0.0:${PORT}`, `[::1]:${PORT}`, `127.0.0.1.evil.test:${PORT}`, `evil.test@127.0.0.1:${PORT}`, `127.0.0.1:${PORT} `, `127.0.0.1:${PORT}, evil.test`, 5]) {
    for (const url of ["/", "/state.json"]) {
      const r = O.respond({ method: "GET", url, headers: { host } }, PORT, () => ({ level: 9 }));
      assert.equal(r.status, 403, `${host} ${url}`); assert.equal(r.body, "");
    }
  }
  for (const origin of ["https://evil.test", "http://127.0.0.1:1", "null", `http://127.0.0.1:${PORT}.evil.test`, ""]) assert.equal(ask({ url: "/state.json", headers: { host: `127.0.0.1:${PORT}`, origin } }).status, 403, origin);
  for (const site of ["cross-site", "same-site"]) assert.equal(ask({ url: "/state.json", headers: { host: `127.0.0.1:${PORT}`, "sec-fetch-site": site } }).status, 403, site);
});

test("the JSON holds only the listed facts, bounded, even when the source misbehaves", () => {
  assert.deepEqual(O.overlayState(), { level: null, xpPercent: null, zone: "", splitSeconds: null, splitLabel: "", deaths: null, step: "", stepDetail: "", live: false });
  const s = O.overlayState({ level: 999, xpPercent: 140, zone: "Z\u0000one\n" + "x".repeat(200), deaths: -1, step: { toString: () => "x" }, live: "yes", name: "Aeralyn", realm: "R" });
  assert.equal(s.level, null); assert.equal(s.xpPercent, null); assert.equal(s.deaths, null); assert.equal(s.step, ""); assert.equal(s.live, false);
  assert.ok(s.zone.length <= 60); assert.doesNotMatch(s.zone, /[\x00-\x1f]/); assert.equal(s.name, undefined); assert.equal(s.realm, undefined);
  const broken = ask({ url: "/state.json" }, () => { throw Error("boom"); });
  assert.equal(broken.status, 200); assert.equal(JSON.parse(broken.body).level, null);
  assert.doesNotMatch(O.PAGE, /https?:\/\/|src=|href=/, "the page loads nothing from anywhere else");
  assert.match(O.PAGE, /background:transparent/);
});

const get = (port, { method = "GET", pathname = "/", headers = {}, host = "127.0.0.1" } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host, port, method, path: pathname, headers, agent: false }, (res) => { let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); });
  req.on("error", reject); req.end();
});

test("the real server listens on loopback only, on a high port, and stops when told", async () => {
  const overlay = new O.StreamOverlay({ getState: () => ({ level: 31, zone: "Stranglethorn Vale" }) });
  assert.deepEqual(overlay.status(), { running: false, port: null, url: null });
  const status = await overlay.start();
  try {
    assert.equal(status.running, true); assert.ok(status.port >= 1024 && status.port <= 65535); assert.equal(status.url, `http://127.0.0.1:${status.port}/`);
    assert.deepEqual(overlay.server.address().address, "127.0.0.1", "never bound to another interface");
    assert.deepEqual(await overlay.start(), status, "switching on twice changes nothing");
    const page = await get(status.port);
    assert.equal(page.status, 200); assert.match(page.body, /Backstage Forever overlay/);
    const json = await get(status.port, { pathname: "/state.json" });
    assert.equal(JSON.parse(json.body).zone, "Stranglethorn Vale");
    assert.equal((await get(status.port, { method: "POST", pathname: "/state.json" })).status, 405);
    assert.equal((await get(status.port, { method: "DELETE" })).status, 405);
    assert.equal((await get(status.port, { pathname: "/journey.json" })).status, 404);
    assert.equal((await get(status.port, { pathname: "/../../state.json" })).status, 404);
    assert.equal((await get(status.port, { headers: { Host: "evil.test" } })).status, 403);
    assert.equal((await get(status.port, { pathname: "/state.json", headers: { Host: `evil.test:${status.port}` } })).status, 403);
    assert.equal((await get(status.port, { pathname: "/state.json", headers: { Origin: "https://evil.test" } })).status, 403);
  } finally { await overlay.stop(); }
  assert.deepEqual(overlay.status(), { running: false, port: null, url: null });
  await assert.rejects(get(status.port), /ECONNREFUSED/, "nothing answers after it is switched off");
  // The port used last time is tried first, and a busy one is replaced, not fought over.
  const again = await overlay.start(status.port);
  assert.equal(again.port, status.port);
  const second = new O.StreamOverlay();
  const other = await second.start(status.port);
  assert.notEqual(other.port, status.port);
  await second.stop(); await overlay.stop();
  const taken = net.createServer();
  await new Promise((resolve) => taken.listen(0, "127.0.0.1", resolve));
  const third = await overlay.start(taken.address().port);
  assert.notEqual(third.port, taken.address().port);
  await overlay.stop(); await new Promise((resolve) => taken.close(resolve));
  for (const bad of [80, 0, -1, 70000, "8080", 1.5]) { const s = await overlay.start(bad); assert.ok(s.port >= 1024 && s.port !== bad); await overlay.stop(); }
});

test("the overlay is opt-in: off by default, started only by its switch, stopped on quit and on data reset", () => {
  const main = read("src/main.cjs"), ipc = read("src/core/journey-extras-ipc.cjs"), store = read("src/core/journey-store.cjs"), core = read("src/core/stream-overlay.cjs");
  assert.match(store, /overlay: \{ enabled: false, port: null \}/);
  assert.match(ipc, /handle\("setStreamOverlay"[\s\S]*?\{ privateOnly: true \}/, "only the window's own switch can start it");
  assert.match(ipc, /if \(!journey\.data\.overlay\.enabled\) return false;/, "at launch it starts only when the player left it on");
  assert.match(main, /app\.on\("before-quit", \(\) => \{ void streamOverlay\?\.stop\(\); \}\)/);
  assert.match(main, /clearJourneyExtras = \(\) => \{ void streamOverlay\.stop\(\);/);
  assert.match(core, /server\.listen\(\{ host: HOST, port, exclusive: true \}/); assert.match(core, /const HOST = "127\.0\.0\.1";/);
  assert.doesNotMatch(core, /require\("node:fs"\)|readFile|0\.0\.0\.0|"::"/, "the server reads no files and names no other interface");
});
