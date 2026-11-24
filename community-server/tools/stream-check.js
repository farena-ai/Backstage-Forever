#!/usr/bin/env node
"use strict";
// Checks that the realtime stream reaches a client event by event through whatever sits in front
// of the service (the web server's proxy). It opens one stream with a throwaway install id and
// no subscriptions, and reports when the hello event and the 20-second pings arrive.
//
//   node tools/stream-check.js https://bf.backstagecoding.com [--pings 2]
//
// A healthy answer: hello within a second or two, then one ping every 20 seconds. If hello only
// shows up after a long wait, or everything arrives at once, something in front is buffering.
// It sends nothing but that random id and stores nothing.
const crypto = require("node:crypto");

async function check(base, { pings = 2, helloMs = 5000, log = () => {} } = {}) {
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search) throw new Error("give the address of the service, such as https://bf.backstagecoding.com");
  const lib = url.protocol === "https:" ? require("node:https") : require("node:http");
  const started = Date.now(), since = () => Date.now() - started;
  const sessionRes = await fetch(`${url.origin}/v1/live/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema: 1, installId: crypto.randomUUID(), subs: [] }) });
  if (sessionRes.status !== 200) return { ok: false, why: `the session call answered ${sessionRes.status}`, helloMs: null, pingMs: [] };
  const { stream } = await sessionRes.json();
  return new Promise((resolve) => {
    const out = { ok: false, why: "", status: 0, contentType: null, encoding: null, helloMs: null, pingMs: [] };
    let buf = "", timer = null, req = null;
    const finish = (ok, why) => { clearTimeout(timer); out.ok = ok; out.why = why; if (req) req.destroy(); resolve(out); };
    const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => finish(false, why), ms); };
    req = lib.get(`${url.origin}/v1/live/stream?s=${stream}`, { headers: { Accept: "text/event-stream", "Accept-Encoding": "gzip, deflate, br" } }, (res) => {
      out.status = res.statusCode; out.contentType = res.headers["content-type"] || null; out.encoding = res.headers["content-encoding"] || null;
      if (res.statusCode !== 200) return finish(false, `the stream answered ${res.statusCode}`);
      if (out.encoding) return finish(false, `the answer is compressed (${out.encoding}): switch compression off for /v1/live/stream`);
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (/^event: hello$/m.test(block) && out.helloMs === null) { out.helloMs = since(); log(`hello after ${out.helloMs} ms`); if (pings === 0) return finish(true, "hello arrived"); arm(26_000, "no ping within 26 seconds of hello: the connection is being buffered or cut"); }
          else if (block.startsWith(": ping")) {
            out.pingMs.push(since()); log(`ping after ${since()} ms`);
            if (out.pingMs.length >= pings) {
              const gaps = out.pingMs.map((t, k) => t - (k ? out.pingMs[k - 1] : out.helloMs));
              return gaps.every(g => g > 15_000 && g < 26_000) ? finish(true, "hello and the pings arrived on time") : finish(false, `pings did not arrive one by one (gaps in ms: ${gaps.join(", ")}): something is buffering`);
            }
            arm(26_000, "the next ping did not arrive within 26 seconds");
          }
        }
      });
      res.on("close", () => finish(false, out.helloMs === null ? "the connection closed before hello" : "the connection was closed early"));
    });
    req.on("error", (e) => finish(false, `could not connect (${e.code || "error"})`));
    arm(helloMs, `no hello within ${helloMs / 1000} seconds: the stream is being buffered`);
  });
}

if (require.main === module) {
  const args = process.argv.slice(2), pi = args.indexOf("--pings");
  const pings = pi >= 0 ? Number(args[pi + 1]) : 2, base = args.find((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1));
  if (!base || !Number.isSafeInteger(pings) || pings < 0 || pings > 10) { console.error("usage: node tools/stream-check.js <https://address-of-the-service> [--pings 2]"); process.exit(1); }
  check(base, { pings, log: (l) => console.log(l) }).then((r) => {
    console.log(r.ok ? `OK: ${r.why}.` : `PROBLEM: ${r.why}.`);
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}

module.exports = { check };
