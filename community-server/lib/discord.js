"use strict";
// Discord for linked guilds: settings, the signature check for the interaction
// webhook, the signed OAuth state, safe text, message layouts and the outbound
// bot client. Everything is OFF unless all four settings are in the env file.
//
// Rules this file keeps:
//  - Outbound HTTPS only, and only to discord.com (the bot REST API and the
//    OAuth token exchange). Redirects are not followed.
//  - Every message carries allowed_mentions with an empty parse list, and
//    player text is escaped, so a title or a name can never ping or format.
//  - Calls for one Discord server run one after another, so edits stay in order.
//  - A rate-limit answer is waited out (Retry-After), never hammered.
//  - The bot token and the client secret are never logged or put in an error.
const https = require("node:https");
const crypto = require("node:crypto");
const { SNOWFLAKE } = require("./validate-live");

const API_HOST = "discord.com";
const API_PREFIX = "/api/v10";
const USER_AGENT = "DiscordBot (https://bf.backstagecoding.com, 1.0)";
const ALLOWED_PATHS = /^\/(?:channels\/\d{15,22}(?:\/messages(?:\/\d{15,22})?)?|guilds\/\d{15,22}\/scheduled-events(?:\/\d{15,22})?|users\/@me\/guilds\/\d{15,22}|applications\/\d{15,22}\/commands|oauth2\/token)$/;
const TIMEOUT_MS = 10_000, MAX_BODY = 256 * 1024, MAX_ATTEMPTS = 4, MAX_WAIT_MS = 30_000, MAX_QUEUE = 100;
const INTERACTION_WINDOW_MS = 5 * 60_000;
const STATE_MS = 15 * 60_000;
// View Channel, Send Messages, Embed Links, Manage Events, and Create Events (Discord asks for
// that one to make a scheduled event).
const PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 33n) | (1n << 44n);
const MANAGE_GUILD = 1n << 5n, ADMINISTRATOR = 1n << 3n;
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const ZWSP = String.fromCodePoint(0x200b);
const HIDDEN = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => "\\u{" + a.toString(16) + "}-\\u{" + b.toString(16) + "}").join("") + "]", "gu");

// ------------------------------------------------------------------ settings
// -> null (off) or { appId, publicKeyHex, publicKey, botToken, clientSecret }. A value that is set
// but malformed is an error at start; some set and some missing means off (the caller says so).
function parseDiscordConfig(env) {
  const names = ["BF_DISCORD_APP_ID", "BF_DISCORD_PUBLIC_KEY", "BF_DISCORD_BOT_TOKEN", "BF_DISCORD_CLIENT_SECRET"];
  const set = names.filter(n => typeof env[n] === "string" && env[n].trim() !== "");
  if (!set.length) return { discord: null, partial: false };
  const v = Object.fromEntries(set.map(n => [n, env[n].trim()]));
  if (v.BF_DISCORD_APP_ID !== undefined && !SNOWFLAKE.test(v.BF_DISCORD_APP_ID)) throw new Error("BF_DISCORD_APP_ID must be the application id (digits only)");
  if (v.BF_DISCORD_PUBLIC_KEY !== undefined && !/^[0-9a-fA-F]{64}$/.test(v.BF_DISCORD_PUBLIC_KEY)) throw new Error("BF_DISCORD_PUBLIC_KEY must be the 64-character public key");
  if (v.BF_DISCORD_BOT_TOKEN !== undefined && !/^[A-Za-z0-9._-]{40,120}$/.test(v.BF_DISCORD_BOT_TOKEN)) throw new Error("BF_DISCORD_BOT_TOKEN does not look like a bot token");
  if (v.BF_DISCORD_CLIENT_SECRET !== undefined && !/^[A-Za-z0-9._-]{16,80}$/.test(v.BF_DISCORD_CLIENT_SECRET)) throw new Error("BF_DISCORD_CLIENT_SECRET does not look like a client secret");
  if (set.length < names.length) return { discord: null, partial: true };
  const publicKeyHex = v.BF_DISCORD_PUBLIC_KEY.toLowerCase();
  return { discord: { appId: v.BF_DISCORD_APP_ID, publicKeyHex, publicKey: verifyKey(publicKeyHex), botToken: v.BF_DISCORD_BOT_TOKEN, clientSecret: v.BF_DISCORD_CLIENT_SECRET }, partial: false };
}

function verifyKey(hex) {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
}

// ---------------------------------------------------------------- signatures
// True only for a body Discord signed, with a timestamp inside the window. Called on the raw
// bytes before anything is parsed.
function verifyInteraction(publicKey, signature, timestamp, rawBody, now = Date.now()) {
  if (typeof signature !== "string" || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  if (typeof timestamp !== "string" || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > INTERACTION_WINDOW_MS) return false;
  try { return crypto.verify(null, Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]), publicKey, Buffer.from(signature, "hex")); }
  catch { return false; }
}

// The OAuth "state": which guild started the connection, a one-time nonce and the time, signed.
function stateKey(salt) { return crypto.createHmac("sha256", salt).update("discord-oauth-state").digest(); }
function signState(salt, guildId, nonce, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ g: guildId, n: nonce, t: now })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", stateKey(salt)).update(body).digest("base64url")}`;
}
function readState(salt, state, now = Date.now()) {
  const m = /^([A-Za-z0-9_-]{20,400})\.([A-Za-z0-9_-]{43})$/.exec(String(state ?? ""));
  if (!m) return null;
  const want = Buffer.from(crypto.createHmac("sha256", stateKey(salt)).update(m[1]).digest("base64url"));
  if (!crypto.timingSafeEqual(want, Buffer.from(m[2]))) return null;
  let v;
  try { v = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch { return null; }
  if (!v || typeof v.g !== "string" || typeof v.n !== "string" || !Number.isSafeInteger(v.t)) return null;
  if (now - v.t > STATE_MS || now < v.t - 60_000) return null;
  return { guildId: v.g, nonce: v.n };
}

function authorizeUrl(appId, redirectUri, state) {
  const q = new URLSearchParams({ client_id: appId, scope: "bot applications.commands", permissions: String(PERMISSIONS), response_type: "code", redirect_uri: redirectUri, state });
  return `https://${API_HOST}/oauth2/authorize?${q}`;
}

// ----------------------------------------------------------------------- text
// Player text made safe for a Discord message: hidden characters removed, one line, cut, and every
// character Discord gives a meaning to escaped. "@" also gets a zero-width space after it, so
// "@everyone" is not a mention even where escaping is ignored.
function escapeText(value, max = 100) {
  const flat = String(value ?? "").replace(/\s+/g, " ").replace(HIDDEN, "").replace(/ {2,}/g, " ").trim();
  return [...flat].slice(0, max).join("").replace(/[\\*_~`|>[\](){}#@:<&.!+-]/g, "\\$&").replace(/@/g, `@${ZWSP}`);
}
// A Discord display name or channel name before it is stored: hidden characters out, one line, cut.
function cleanName(value, max = 32) {
  const flat = String(value ?? "").replace(/\s+/g, " ").replace(HIDDEN, "").replace(/ {2,}/g, " ").trim();
  return [...flat].slice(0, max).join("");
}
function snowflake(value) { return typeof value === "string" && SNOWFLAKE.test(value) ? value : null; }
const NO_MENTIONS = Object.freeze({ parse: [] });
const EPHEMERAL = 64;
const ANSWER_LABEL = Object.freeze({ tank: "Tank", healer: "Healer", damage: "Damage", maybe: "Maybe", no: "No" });
const BUTTON_STYLE = Object.freeze({ tank: 1, healer: 3, damage: 4, maybe: 2, no: 2 });

function nameList(rows, budget) {
  const out = [];
  let used = 0;
  for (const [i, r] of rows.entries()) {
    const n = escapeText(r.name, 24);
    if (used + n.length + 2 > budget) { out.push(`and ${rows.length - i} more`); break; }
    out.push(n); used += n.length + 2;
  }
  return out.length ? out.join(", ") : "nobody yet";
}

// One message per event, edited in place. ev: a guild_events row; signups: guild_signups rows.
function renderEvent(ev, signups, { open }) {
  const unix = Math.floor(ev.at_ms / 1000), by = (a) => signups.filter(s => s.answer === a);
  const lines = [
    ev.cancelled ? `~~**${escapeText(ev.title, 40)}**~~ (called off)` : `**${escapeText(ev.title, 40)}**`,
    `<t:${unix}:F> (<t:${unix}:R>)${ev.place !== "other" ? ` · ${escapeText(ev.place, 8)}` : ""}`,
  ];
  if (ev.note) lines.push(escapeText(ev.note, 80));
  lines.push("");
  for (const [a, want] of [["tank", ev.tank], ["healer", ev.healer], ["damage", ev.damage]])
    lines.push(`**${ANSWER_LABEL[a]}** (${by(a).length}/${want}): ${nameList(by(a), 330)}`);
  if (by("maybe").length) lines.push(`**Maybe** (${by("maybe").length}): ${nameList(by("maybe"), 250)}`);
  if (by("no").length) lines.push(`**No** (${by("no").length}): ${nameList(by("no"), 250)}`);
  if (open) lines.push("", "Answer with the buttons. The first time, run `/backstage link` to tie your Discord name to your character.");
  return {
    content: lines.join("\n").slice(0, 1990),
    allowed_mentions: NO_MENTIONS,
    components: open ? [{ type: 1, components: Object.keys(ANSWER_LABEL).map(a => ({ type: 2, style: BUTTON_STYLE[a], label: ANSWER_LABEL[a], custom_id: `bf:s:${ev.id}:${a}` })) }] : [],
  };
}

// The 15-minute reminder. Members who linked Discord and said yes or maybe are named, and only they.
function renderReminder(ev, signups, members) {
  const unix = Math.floor(ev.at_ms / 1000);
  const going = new Set(signups.filter(s => s.answer !== "no").map(s => s.name_key));
  const users = [...new Set(members.filter(m => m.discord_user && going.has(m.name_key) && SNOWFLAKE.test(m.discord_user)).map(m => m.discord_user))].slice(0, 50);
  return {
    content: `**${escapeText(ev.title, 40)}** starts <t:${unix}:R>.${users.length ? `\n${users.map(u => `<@${u}>`).join(" ")}` : ""}`.slice(0, 1990),
    allowed_mentions: { parse: [], users },
  };
}

function renderSummary(ev, s) {
  const mins = Math.round(s.durationSec / 60), time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  const lines = [`**${escapeText(ev.title, 40)}** is done.`, `Attended (${s.attended.length}): ${nameList(s.attended.map(name => ({ name })), 1500)}`];
  if (s.bosses) lines.push(`Bosses down: ${s.bosses}`);
  if (s.durationSec) lines.push(`Time: ${time}`);
  return { content: lines.join("\n").slice(0, 1990), allowed_mentions: NO_MENTIONS };
}

const TEST_MESSAGE = Object.freeze({ content: "Backstage Forever is connected. Guild events will be posted in this channel.", allowed_mentions: NO_MENTIONS });

function scheduledEvent(ev) {
  return {
    name: [...String(ev.title).replace(HIDDEN, "")].slice(0, 100).join(""), privacy_level: 2, entity_type: 3,
    scheduled_start_time: ev.at, scheduled_end_time: new Date(ev.at_ms + 3 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    entity_metadata: { location: ev.place !== "other" ? `In the game (${ev.place})` : "In the game" },
    description: ev.note ? escapeText(ev.note, 80) : "",
  };
}

// What `admin.js discord-register-commands` sends: one command with three sub-commands.
function commandDefinitions() {
  return [{
    name: "backstage", description: "Backstage Forever guild events", type: 1, dm_permission: false,
    options: [
      { type: 1, name: "link", description: "Tie your Discord name to your character, so the sign-up buttons work for you" },
      { type: 1, name: "channel", description: "Choose the channel guild events are posted in (needs Manage Server)",
        options: [{ type: 7, name: "channel", description: "The channel (this one when left out)", required: false, channel_types: [0, 5] }] },
      { type: 1, name: "events", description: "Show the coming guild events" },
    ],
  }];
}

// Registers the slash commands for every server the bot is in. -> how many commands Discord now lists.
async function registerCommands(client) {
  const r = await client.call("PUT", `/applications/${client.d.appId}/commands`, { json: commandDefinitions() });
  if (!Array.isArray(r)) throw new DiscordError("bad_answer");
  return r.length;
}

// ------------------------------------------------------------------- client
class DiscordError extends Error {
  // kind: "http" (Discord answered with an error), "timeout", "network", "rate_limited", "bad_answer", "refused"
  constructor(kind, { status = 0, code = 0 } = {}) { super(`discord ${kind}${status ? ` ${status}` : ""}${code ? ` code ${code}` : ""}`); this.kind = kind; this.status = status; this.code = code; }
}

class DiscordClient {
  constructor({ discord, request = https.request, now = () => Date.now(), sleep, log = () => {} }) {
    this.d = discord; this.request = request; this.now = now; this.log = log;
    this.sleep = sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this.queues = new Map(); // queue key -> { tail, size, pending:Set }
    this.globalUntil = 0;
    this.counters = { calls: 0, failures: 0, rateLimited: 0, dropped: 0 };
  }

  // One HTTPS request. Resolves { status, headers, json } and rejects with a DiscordError.
  raw(method, path, { json, form, auth = true } = {}) {
    return new Promise((resolve, reject) => {
      // The allow-list: this is the only host, and these are the only paths, this code can reach.
      if (!this.d || !ALLOWED_PATHS.test(path)) return reject(new DiscordError("refused"));
      const body = json !== undefined ? Buffer.from(JSON.stringify(json)) : form !== undefined ? Buffer.from(new URLSearchParams(form).toString()) : null;
      const options = {
        protocol: "https:", hostname: API_HOST, port: 443, method, path: `${API_PREFIX}${path}`, timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT, Accept: "application/json",
          ...(auth ? { Authorization: `Bot ${this.d.botToken}` } : {}),
          ...(body ? { "Content-Type": json !== undefined ? "application/json" : "application/x-www-form-urlencoded", "Content-Length": body.length } : {}),
        },
      };
      let done = false;
      const fail = (kind) => { if (!done) { done = true; reject(new DiscordError(kind)); } };
      let req;
      try {
        req = this.request(options, (res) => {
          const chunks = []; let size = 0;
          res.on("data", (c) => { size += c.length; if (size > MAX_BODY) { res.destroy(); fail("bad_answer"); } else chunks.push(c); });
          res.on("end", () => {
            if (done) return;
            done = true;
            let parsed = null;
            if (chunks.length) { try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { parsed = null; } }
            resolve({ status: res.statusCode, headers: res.headers, json: parsed });
          });
          res.on("error", () => fail("network"));
        });
      } catch { return fail("network"); }
      req.on("timeout", () => { req.destroy(); fail("timeout"); });
      req.on("error", () => fail("network"));
      req.end(body || undefined);
    });
  }

  // A request with rate-limit handling. Resolves the parsed answer (or null); rejects with a DiscordError.
  async call(method, path, options = {}) {
    this.counters.calls += 1;
    let serverErrors = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const wait = this.globalUntil - this.now();
      if (wait > 0) await this.sleep(Math.min(wait, MAX_WAIT_MS));
      let res;
      try { res = await this.raw(method, path, options); }
      catch (e) { this.counters.failures += 1; throw e; }
      if (res.status === 429) {
        this.counters.rateLimited += 1;
        const header = Number(res.headers["retry-after"]), fromBody = res.json && Number(res.json.retry_after);
        const sec = Number.isFinite(header) && header >= 0 ? header : Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : 1;
        const ms = Math.min(MAX_WAIT_MS, Math.max(50, Math.ceil(sec * 1000)));
        if ((res.json && res.json.global === true) || res.headers["x-ratelimit-global"] === "true") this.globalUntil = this.now() + ms;
        if (attempt === MAX_ATTEMPTS) break;
        await this.sleep(ms);
        continue;
      }
      if (res.status >= 500 && serverErrors < 1 && attempt < MAX_ATTEMPTS) { serverErrors += 1; await this.sleep(1000); continue; }
      if (res.status < 200 || res.status >= 300) {
        this.counters.failures += 1;
        const code = res.json && Number.isSafeInteger(res.json.code) ? res.json.code : 0;
        throw new DiscordError("http", { status: res.status, code });
      }
      // The bucket is used up: the next call of this queue waits until it refills.
      const left = res.headers["x-ratelimit-remaining"], after = Number(res.headers["x-ratelimit-reset-after"]);
      if (String(left) === "0" && Number.isFinite(after) && after > 0 && options.queue) options.queue.pauseUntil = this.now() + Math.min(MAX_WAIT_MS, Math.ceil(after * 1000));
      return res.json;
    }
    this.counters.failures += 1;
    throw new DiscordError("rate_limited", { status: 429 });
  }

  // Runs jobs of one key (a Discord server) strictly one after another. A job with a name that is
  // already waiting is not added twice: the waiting one reads the newest state when it runs.
  enqueue(queueKey, jobName, fn) {
    let q = this.queues.get(queueKey);
    if (!q) { q = { tail: Promise.resolve(), size: 0, pending: new Map(), pauseUntil: 0 }; this.queues.set(queueKey, q); }
    if (jobName && q.pending.has(jobName)) return q.pending.get(jobName);
    if (q.size >= MAX_QUEUE) { this.counters.dropped += 1; return Promise.resolve({ dropped: true }); }
    q.size += 1;
    const run = async () => {
      if (jobName) q.pending.delete(jobName);
      try {
        const wait = q.pauseUntil - this.now();
        if (wait > 0) await this.sleep(Math.min(wait, MAX_WAIT_MS));
        return await fn(q);
      } finally {
        q.size -= 1;
        if (q.size === 0 && this.queues.get(queueKey) === q) this.queues.delete(queueKey);
      }
    };
    const result = q.tail.then(run, run);
    q.tail = result.catch(() => {});
    if (jobName) q.pending.set(jobName, result);
    return result;
  }

  // Resolves when every queued job has finished (tests, shutdown).
  async idle() { while (this.queues.size) await Promise.all([...this.queues.values()].map(q => q.tail)); }
}

// A plain sentence for the guild's leader about what went wrong. channel: "#raids" or null.
function problemText(e, { action = "post", channel = null } = {}) {
  const where = channel ? `in ${channel}` : "in the chosen channel";
  if (!(e instanceof DiscordError)) return "Something went wrong while talking to Discord. It will be tried again.";
  if (e.kind === "timeout" || e.kind === "network") return "Discord did not answer. It will be tried again.";
  if (e.kind === "rate_limited") return "Discord asked the bot to slow down. It will be tried again.";
  if (e.kind !== "http") return "Something went wrong while talking to Discord. It will be tried again.";
  if (e.status === 401) return "Discord refused the bot's sign-in. The service owner has to check the Discord settings.";
  if (e.code === 10003) return `The channel ${channel || "that was chosen"} no longer exists. Run /backstage channel in the channel you want.`;
  if (e.code === 10004) return "The bot is no longer in the Discord server. Connect Discord again from the app.";
  if (e.code === 50001) return action === "event" ? "The bot cannot see the Discord server's events: missing permission Manage Events" : `The bot cannot see ${channel || "the chosen channel"}: missing permission View Channel`;
  if (e.code === 50013 || e.status === 403) return action === "event" ? "The bot cannot make Discord events: missing permission Manage Events" : `The bot cannot post ${where}: missing permission Send Messages`;
  if (e.status === 404) return action === "event" ? "Discord could not find the event. It will be made again." : `Discord could not find ${channel || "the chosen channel"}. Run /backstage channel in the channel you want.`;
  if (e.status >= 500) return "Discord has a problem right now. It will be tried again.";
  return "Discord did not accept the message. It will be tried again.";
}

module.exports = {
  parseDiscordConfig, verifyKey, verifyInteraction, signState, readState, authorizeUrl, escapeText, cleanName, snowflake,
  renderEvent, renderReminder, renderSummary, scheduledEvent, commandDefinitions, registerCommands, problemText, DiscordClient, DiscordError,
  API_HOST, API_PREFIX, ALLOWED_PATHS, PERMISSIONS, MANAGE_GUILD, ADMINISTRATOR, NO_MENTIONS, EPHEMERAL, TEST_MESSAGE, ANSWER_LABEL,
  INTERACTION_WINDOW_MS, STATE_MS,
};
