"use strict";
// Tells the admins that a report arrived or a player replied. Two optional
// channels, both OFF unless set in the env file: e-mail through the local
// sendmail binary, and a Discord webhook.
//
// A notification carries only: ticket number, kind, area, app version and the
// first 80 characters of the summary. Nothing else about the player or the
// report ever leaves the server this way. Sending never blocks or fails the
// request that caused it; failures are logged without any content.
const https = require("node:https");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");

const DISCORD_HOSTS = Object.freeze(["discord.com", "discordapp.com"]);
const EMAIL = /^[A-Za-z0-9_][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,24}$/;
const SUMMARY_CHARS = 80;

function parseEmailList(raw, name) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  const list = String(raw).split(",").map(s => s.trim()).filter(Boolean);
  if (list.length > 10) throw new Error(`${name} lists more than 10 addresses`);
  for (const a of list) if (!EMAIL.test(a)) throw new Error(`${name} contains an invalid e-mail address`);
  return list;
}

// Only https://discord.com/api/webhooks/<id>/<token> (or discordapp.com). The value is a secret: never logged.
function parseDiscordWebhook(raw, name = "BF_DESK_DISCORD_WEBHOOK") {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error(`${name} is not a valid URL`); }
  if (url.protocol !== "https:" || !DISCORD_HOSTS.includes(url.hostname) || url.port || url.username || url.password ||
      !/^\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname) || url.hash)
    throw new Error(`${name} must be an https://discord.com/api/webhooks/... URL`);
  return { hostname: url.hostname, path: url.pathname };
}

// One line of player text, made safe for a notification: whitespace folded,
// invisible direction/format characters removed, cut to 80 characters.
function summaryLine(summary) {
  const flat = String(summary ?? "").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "").replace(/[\s\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  return [...flat].slice(0, SUMMARY_CHARS).join("");
}

// The complete set of facts a notification may contain.
function eventFacts(type, t) {
  return {
    type: type === "reply" ? "reply" : "new",
    ticket: String(t.ticket), kind: String(t.kind), area: String(t.area),
    appVersion: t.appVersion ? String(t.appVersion) : "unknown",
    summary: summaryLine(t.summary),
  };
}

function headline(f) { return f.type === "reply" ? `Player reply on ${f.ticket}` : `New report ${f.ticket}`; }

function discordPayload(f) {
  const escaped = f.summary.replace(/[\\*_~`|>[\]()#@:<-]/g, "\\$&");
  return {
    content: `**${headline(f)}** · ${f.kind} · ${f.area} · app ${f.appVersion}\n${escaped}`,
    allowed_mentions: { parse: [] },
    flags: 4, // no link previews
  };
}

function emailMessage(f, { to, from, replyTo, publicOrigin, now = Date.now(), text }) {
  const subject = text ? "[Backstage Desk] Test message" : `[Backstage Desk] ${headline(f)}`;
  const headers = [
    ...(from ? [`From: Backstage Desk <${from}>`] : []),
    `To: ${to.join(", ")}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${subject}`,
    `Date: ${new Date(now).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(16).toString("hex")}@bf-desk>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
  ];
  const body = text ? [text] : [
    `${headline(f)}`, "",
    `Kind:        ${f.kind}`,
    `Area:        ${f.area}`,
    `App version: ${f.appVersion}`,
    `Summary:     ${f.summary}`, "",
    ...(publicOrigin ? [`Open it: ${publicOrigin}/admin/tickets/${f.ticket}`, ""] : []),
    "The full report can only be read in the admin area.",
  ];
  return `${headers.join("\n")}\n\n${body.join("\n")}\n`;
}

class Notifier {
  // config.notify: { email: [..], from, replyTo, maxPerHour, sendmail, discord: {hostname, path} | null }
  constructor({ config, log = () => {}, now = () => Date.now(), spawn = childProcess.spawn, request = https.request }) {
    this.n = config.notify || { email: [], discord: null };
    this.publicOrigin = config.publicOrigin || "";
    this.log = log; this.now = now; this.spawn = spawn; this.request = request;
    this.windows = { email: { start: 0, count: 0, warned: false }, discord: { start: 0, count: 0, warned: false } };
  }

  channels() { return { email: this.n.email.length > 0, discord: !!this.n.discord }; }

  // Simple hourly cap per channel so a burst of reports cannot flood an inbox.
  allow(channel) {
    const w = this.windows[channel], now = this.now(), max = this.n.maxPerHour ?? 30;
    if (now - w.start >= 3_600_000) { w.start = now; w.count = 0; w.warned = false; }
    if (w.count >= max) {
      if (!w.warned) { w.warned = true; this.note(`notify ${channel}: hourly cap of ${max} reached, skipping until the hour ends`); }
      return false;
    }
    w.count += 1;
    return true;
  }

  note(line) { try { this.log(`${new Date(this.now()).toISOString()} ${line}`); } catch { /* logging must not throw */ } }

  // Fire and forget. Never throws, never rejects.
  ticketEvent(type, ticket) {
    let facts;
    try { facts = eventFacts(type, ticket); } catch { return Promise.resolve([]); }
    const jobs = [];
    const on = this.channels();
    if (on.email && this.allow("email")) jobs.push(this.sendEmail(emailMessage(facts, this.mailOptions())));
    if (on.discord && this.allow("discord")) jobs.push(this.sendDiscord(discordPayload(facts)));
    return Promise.all(jobs).catch(() => []);
  }

  // For `admin.js notify-test`: a harmless message to whatever is configured.
  async test() {
    const on = this.channels(), out = {};
    const text = "This is a test message from Backstage Desk. Nothing is wrong and there is nothing to do.";
    if (on.email) out.email = await this.sendEmail(emailMessage(null, { ...this.mailOptions(), text }));
    if (on.discord) out.discord = await this.sendDiscord({ content: text, allowed_mentions: { parse: [] }, flags: 4 });
    return out;
  }

  mailOptions() { return { to: this.n.email, from: this.n.from || null, replyTo: this.n.replyTo || null, publicOrigin: this.publicOrigin, now: this.now() }; }

  // Resolves to true or false. Recipients are passed as arguments after "--",
  // never through a shell and never taken from the message.
  sendEmail(message) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, why) => { if (done) return; done = true; clearTimeout(timer); if (!ok) this.note(`notify email failed: ${why}`); resolve(ok); };
      let child, timer;
      try {
        child = this.spawn(this.n.sendmail || "/usr/sbin/sendmail", ["-i", "--", ...this.n.email], { stdio: ["pipe", "ignore", "ignore"], shell: false, windowsHide: true });
      } catch (e) { return finish(false, e.code || "spawn error"); }
      timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } finish(false, "timeout"); }, 20_000);
      timer.unref?.();
      child.on("error", (e) => finish(false, e.code || "spawn error"));
      child.on("close", (code) => finish(code === 0, `exit ${code}`));
      child.stdin.on("error", () => {});
      child.stdin.end(message);
    });
  }

  // Resolves to true or false. HTTPS only, to the allow-listed host only, no redirects followed.
  sendDiscord(payload) {
    return new Promise((resolve) => {
      const target = this.n.discord;
      let done = false;
      const finish = (ok, why) => { if (done) return; done = true; if (!ok) this.note(`notify discord failed: ${why}`); resolve(ok); };
      if (!target || !DISCORD_HOSTS.includes(target.hostname)) return finish(false, "not configured");
      const body = Buffer.from(JSON.stringify(payload));
      let req;
      try {
        req = this.request({
          protocol: "https:", hostname: target.hostname, port: 443, path: target.path, method: "POST", timeout: 10_000,
          headers: { "Content-Type": "application/json", "Content-Length": body.length, "User-Agent": "BackstageDesk (self-hosted, 1.0)" },
        }, (res) => { res.resume(); res.on("end", () => finish(res.statusCode >= 200 && res.statusCode < 300, `status ${res.statusCode}`)); res.on("error", () => finish(false, "response error")); });
      } catch (e) { return finish(false, e.code || "request error"); }
      req.on("timeout", () => { req.destroy(); finish(false, "timeout"); });
      req.on("error", (e) => finish(false, e.code || "request error"));
      req.end(body);
    });
  }
}

module.exports = { Notifier, parseEmailList, parseDiscordWebhook, summaryLine, eventFacts, discordPayload, emailMessage, DISCORD_HOSTS, EMAIL };
