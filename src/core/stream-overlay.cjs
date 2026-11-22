"use strict";
// Stream overlay (S7). Off unless the player switches it on. While on, the app answers on this
// computer only (127.0.0.1, a random high port) with exactly two things: one small page for a
// streaming program's browser source, and one small JSON with level, XP bar, zone, split,
// deaths and the current step. It reads no files, has no other address, takes no input, and
// refuses every other path, method and host name. It stops when switched off or the app quits.
const http = require("node:http");
const crypto = require("node:crypto");
const HOST = "127.0.0.1";

const text = (v, max) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "");
const whole = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);
/** The only facts the overlay ever shows; anything else given to it is dropped here. */
function overlayState(input = {}) {
  return {
    level: whole(input.level, 1, 100), xpPercent: whole(input.xpPercent, 0, 100), zone: text(input.zone, 60),
    splitSeconds: whole(input.splitSeconds, 0, 1e8), splitLabel: text(input.splitLabel, 40),
    deaths: whole(input.deaths, 0, 100000), step: text(input.step, 120), stepDetail: text(input.stepDetail, 160), live: input.live === true,
  };
}

const SCRIPT = `(function(){
var $=function(id){return document.getElementById(id)};
function time(s){if(s===null)return"";var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?h+"h "+(m<10?"0":"")+m+"m":m+"m"}
function show(id,on){$(id).hidden=!on}
function draw(d){
$("level").textContent=d.level===null?"":"Level "+d.level;
$("zone").textContent=d.zone||"";
show("xp",d.xpPercent!==null);
if(d.xpPercent!==null){$("fill").style.width=d.xpPercent+"%";$("pct").textContent=d.xpPercent+"%"}
show("split",d.splitSeconds!==null);
$("splitv").textContent=time(d.splitSeconds);$("splitl").textContent=d.splitLabel||"This level";
show("deaths",d.deaths!==null);$("deathsv").textContent=d.deaths===null?"":d.deaths;
show("step",!!d.step);$("stepv").textContent=d.step||"";$("stepd").textContent=d.stepDetail||"";
$("card").className=d.live?"live":"saved"}
function tick(){fetch("/state.json",{cache:"no-store"}).then(function(r){return r.json()}).then(draw).catch(function(){})}
tick();setInterval(tick,2000)})();`;
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Backstage Forever overlay</title>
<style>
html,body{margin:0;background:transparent;color:#fff1d6;font:600 22px Georgia,"Times New Roman",serif}
#card{display:inline-flex;flex-direction:column;gap:10px;margin:12px;padding:16px 22px;min-width:420px;max-width:640px;border:3px solid #c79a4a;border-radius:10px;background:linear-gradient(180deg,rgba(54,22,10,.88),rgba(22,9,4,.9));box-shadow:0 6px 18px rgba(0,0,0,.55);text-shadow:0 2px 3px #000}
#top{display:flex;justify-content:space-between;align-items:baseline;gap:24px}
#level{font:700 40px Cinzel,Georgia,serif;color:#f6dc9a;white-space:nowrap}
#zone{font-size:24px;color:#f1dcb0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#xp{display:flex;align-items:center;gap:12px}
#bar{flex:1;height:18px;border-radius:9px;border:2px solid #8a5a18;background:rgba(0,0,0,.55);overflow:hidden}
#fill{height:100%;width:0;background:linear-gradient(90deg,#7a3fd0,#c58cff)}
#pct{min-width:58px;text-align:right;font-size:22px}
#row{display:flex;gap:28px}
#row div{display:flex;flex-direction:column}
small{font:700 13px Cinzel,Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#e8c983}
#row b{font-size:30px;color:#fff}
#stepv{font-size:26px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#stepd{font-size:19px;color:#f1dcb0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[hidden]{display:none!important}
</style></head><body>
<div id="card" class="saved"><div id="top"><span id="level"></span><span id="zone"></span></div>
<div id="xp" hidden><div id="bar"><div id="fill"></div></div><span id="pct"></span></div>
<div id="row"><div id="split" hidden><small id="splitl">This level</small><b id="splitv"></b></div><div id="deaths" hidden><small>Deaths</small><b id="deathsv"></b></div></div>
<div id="step" hidden><small>Next step</small><div id="stepv"></div><div id="stepd"></div></div></div>
<script>${SCRIPT}</script></body></html>
`;
const SCRIPT_HASH = crypto.createHash("sha256").update(SCRIPT).digest("base64");
const STYLE_HASH = crypto.createHash("sha256").update(PAGE.slice(PAGE.indexOf("<style>") + 7, PAGE.indexOf("</style>"))).digest("base64");
const CSP = `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; style-src 'sha256-${STYLE_HASH}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const COMMON = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };

/**
 * What to answer for one request, without touching the network: { status, headers, body }.
 * Only GET (or HEAD) for "/" and "/state.json", only when the Host header is this computer's own
 * loopback address with our port, and never for a request another website made.
 */
function respond({ method, url, headers = {} }, port, getState) {
  const refuse = (status, extra = {}) => ({ status, headers: { ...COMMON, "Content-Type": "text/plain; charset=utf-8", ...extra }, body: "" });
  const host = typeof headers.host === "string" ? headers.host.toLowerCase() : "";
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return refuse(403);
  const origin = headers.origin;
  if (origin !== undefined && origin !== `http://${HOST}:${port}` && origin !== `http://localhost:${port}`) return refuse(403);
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return refuse(403);
  if (typeof url !== "string" || url.length > 64 || (url !== "/" && url !== "/state.json")) return refuse(404);
  if (method !== "GET" && method !== "HEAD") return refuse(405, { Allow: "GET, HEAD" });
  if (url === "/") return { status: 200, headers: { ...COMMON, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP }, body: method === "HEAD" ? "" : PAGE };
  let state;
  try { state = overlayState(getState()); } catch { state = overlayState(); }
  return { status: 200, headers: { ...COMMON, "Content-Type": "application/json; charset=utf-8" }, body: method === "HEAD" ? "" : JSON.stringify(state) };
}

class StreamOverlay {
  constructor({ getState = () => ({}), createServer = http.createServer } = {}) { Object.assign(this, { getState, createServer, server: null, port: null }); }
  status() { return { running: !!this.server, port: this.port, url: this.server ? `http://${HOST}:${this.port}/` : null }; }
  /** Start on loopback only. `preferred` (the port used last time) is tried first, so a streaming program's saved address keeps working. */
  async start(preferred = null) {
    if (this.server) return this.status();
    const listen = (port) => new Promise((resolve, reject) => {
      const server = this.createServer((req, res) => {
        let answer;
        try { answer = respond({ method: req.method, url: req.url, headers: req.headers }, this.port, this.getState); }
        catch { answer = { status: 500, headers: { ...COMMON }, body: "" }; }
        res.writeHead(answer.status, answer.headers);
        res.end(answer.body);
        req.resume();
      });
      server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000; server.maxHeadersCount = 40;
      server.once("error", reject);
      // The address is fixed to loopback: the page is never reachable from another computer.
      server.listen({ host: HOST, port, exclusive: true }, () => { server.removeListener("error", reject); server.on("error", () => {}); resolve(server); });
    });
    let server = null;
    if (Number.isSafeInteger(preferred) && preferred >= 1024 && preferred <= 65535) { try { server = await listen(preferred); } catch { server = null; } }
    if (!server) server = await listen(0);
    const address = server.address();
    if (!address || address.address !== HOST) { server.close(); throw Error("The overlay could not start on this computer."); }
    this.server = server; this.port = address.port;
    return this.status();
  }
  async stop() {
    const server = this.server;
    this.server = null; this.port = null;
    if (!server) return this.status();
    await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    return this.status();
  }
}

module.exports = { StreamOverlay, respond, overlayState, HOST, PAGE, CSP };
