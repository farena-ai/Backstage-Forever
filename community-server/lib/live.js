"use strict";
// Backstage Live, the service layer: every accepted change is stored through
// lib/guilds.js, published to the realtime hub and, for guilds that connected
// Discord, mirrored there by the bot. The HTTP routes are in live-http.js.
//
// Nothing here blocks a request on Discord: bot calls are queued per Discord
// server and their failures only change the guild's Discord state.
const crypto = require("node:crypto");
const { Hub, topic } = require("./hub");
const G = require("./guilds");
const D = require("./discord");
const { ticketLabel } = require("./validate-desk");
const { realmKey, nameKey, DISCORD_CODE, ANSWERS, EVENT_ID } = require("./validate-live");

const NO_CHANNEL = "No channel is chosen yet. Run /backstage channel in the Discord channel you want.";
const SWEEP_MS = 30_000, EXPIRE_MS = 3_600_000, SEEN_MS = 10 * 60_000;

class Live {
  constructor({ store, config, now = () => Date.now(), log = () => {}, request, sleep }) {
    this.store = store; this.guilds = store.guilds; this.config = config; this.now = now; this.log = log;
    this.hub = new Hub({ now, options: config.live || {} });
    this.discord = config.discord || null;
    this.client = this.discord ? new D.DiscordClient({ discord: this.discord, request, now, sleep, log }) : null;
    this.redirectUri = `${config.publicOrigin}/discord/callback`;
    this.seen = new Map(); // interaction id -> time, so one delivery is handled once
    this.lastSweep = 0; this.lastExpire = 0; this.timer = null;
  }

  note(line) { try { this.log(`${new Date(this.now()).toISOString()} ${line}`); } catch { /* logging must not throw */ } }
  hash(code) { return G.codeHash(this.config.salt, code); }
  pub(guildId, event, data) { return this.hub.publish(topic.guild(guildId), event, { guildId, ...data }); }

  // ------------------------------------------------------------------ tickets
  // An admin reply or a status change: tell the streams that hold this ticket's key.
  publishTicket(id) {
    try {
      const t = this.store.desk.get("SELECT id, status, fixed_in, key_hash FROM tickets WHERE id = ?", id);
      if (!t || !t.key_hash) return 0;
      const m = this.store.desk.get(`SELECT COALESCE(MAX(seq), 0) AS last, COALESCE(MAX(CASE WHEN sender = 'player' THEN seq END), 0) AS mine
        FROM messages WHERE ticket = ? AND sender IN ('player','team')`, id);
      const unread = this.store.desk.get("SELECT COUNT(*) AS c FROM messages WHERE ticket = ? AND sender = 'team' AND seq > ?", id, m.mine).c;
      return this.hub.publish(topic.ticket(id), "ticket", { ticket: ticketLabel(id), status: t.status, fixedIn: t.fixed_in, unread, lastId: m.last });
    } catch { return 0; }
  }
  ticketGone(id) { this.hub.dropTopic(topic.ticket(id)); }

  // ------------------------------------------------------------------- guilds
  createGuild(install, g) {
    for (let i = 0; i < 5; i++) {
      const linkCode = G.randomCode("BFG");
      if (this.guilds.guildByCodeHash(this.hash(linkCode))) continue;
      const r = this.guilds.createGuild(install, g, this.hash(linkCode), this.now());
      return r.error ? r : { ...r, linkCode };
    }
    throw new Error("no free link code");
  }

  join(guild, install, j) {
    const r = this.guilds.join(guild, install, j, this.config.maxGuildMembers, this.now());
    if (!r.error && !r.renewed) this.pub(guild.id, "guild.member", { members: r.members });
    return r;
  }

  rotateCode(guildId) {
    for (let i = 0; i < 5; i++) {
      const linkCode = G.randomCode("BFG");
      if (this.guilds.guildByCodeHash(this.hash(linkCode))) continue;
      return this.guilds.setCodeHash(guildId, this.hash(linkCode)) ? linkCode : null;
    }
    throw new Error("no free link code");
  }

  // Leave, removal by an officer and removal by an admin all end here.
  removeMember(guild, memberKey) {
    const r = this.guilds.removeMember(guild.id, memberKey);
    if (!r.removed) return r;
    this.hub.dropMember(guild.id, memberKey);
    if (r.deleted) this.afterGuildDeleted(guild);
    else {
      this.pub(guild.id, "guild.member", { members: r.members });
      // Their sign-ups went with them: bring the Discord posts up to date.
      if (guild.discord_guild) for (const e of this.guilds.liveEvents(guild.id, this.now())) this.syncEvent(guild.id, e.id);
    }
    return r;
  }

  deleteGuild(guild) {
    const n = this.guilds.deleteGuild(guild.id);
    if (n) this.afterGuildDeleted(guild);
    return n;
  }
  afterGuildDeleted(guild) {
    this.pub(guild.id, "guild.member", { members: 0 });
    this.hub.dropGuild(guild.id);
    if (guild.discord_guild) this.leaveDiscordServer(guild.discord_guild);
  }

  // After Store.purgeInstall: the same follow-up for every guild that install was in.
  afterForget(install, purged) {
    this.hub.dropInstall(install);
    if (!purged || !purged.live) return;
    for (const l of purged.live.left) {
      this.hub.dropMember(l.guildId, l.memberKey);
      if (l.deleted) { this.hub.dropGuild(l.guildId); if (l.discordGuild) this.leaveDiscordServer(l.discordGuild); }
      else {
        this.pub(l.guildId, "guild.member", { members: l.members });
        if (l.discordGuild) for (const e of this.guilds.liveEvents(l.guildId, this.now())) this.syncEvent(l.guildId, e.id);
      }
    }
    if (purged.live.listing) this.publishListingGone(purged.live.listing);
  }

  // ---------------------------------------------------------- events, sign-ups
  putEvent(guild, member, e) {
    const r = this.guilds.putEvent(guild, member, e, this.now());
    if (r.accepted) {
      this.pub(guild.id, "guild.event", { event: r.event });
      this.syncEvent(guild.id, e.id);
    }
    return r;
  }

  putSignup(guild, eventId, s, direct) {
    const r = this.guilds.putSignup(guild, eventId, s, direct, this.now());
    if (r.accepted) {
      this.pub(guild.id, "guild.signup", { eventId, signup: r.signup });
      this.syncEvent(guild.id, eventId);
    }
    return r;
  }

  // -> { posted } : whether a Discord post was queued.
  summary(guild, ev, s) {
    this.guilds.putSummary(guild, ev, s, this.now());
    if (!this.client || !guild.discord_guild || !guild.discord_channel) return { posted: false };
    this.job(guild.id, null, "post", (g, call) => call("POST", `/channels/${g.discord_channel}/messages`, D.renderSummary(ev, s)));
    return { posted: true };
  }

  // -------------------------------------------------------------- party board
  lfgTopic(row) { return topic.lfg(row.realm_key, row.faction); }
  publishListingGone(row) { this.hub.publish(this.lfgTopic(row), "lfg", { op: "gone", listing: G.listingShape(row) }); }
  putListing(install, v) {
    const r = this.guilds.putListing(install, v, this.now());
    if (r.error) return r;
    if (r.replaced) this.publishListingGone(r.replaced);
    this.hub.publish(topic.lfg(realmKey(v.realm), v.faction), "lfg", { op: "put", listing: r.listing });
    return r;
  }
  deleteListing(install, id) {
    const row = this.guilds.deleteListing(install, id);
    if (row && row.expires_ms > this.now()) this.publishListingGone(row);
    return row;
  }
  adminRemoveListing(id) {
    const row = this.guilds.removeListing(id);
    if (row && row.expires_ms > this.now()) this.publishListingGone(row);
    return row;
  }

  // ------------------------------------------------------------------ discord
  discordChanged(guildId) {
    const g = this.guilds.guild(guildId);
    if (g) this.pub(guildId, "guild.discord", { state: g.discord_state });
  }
  discordOk(g) { if (g.discord_channel && this.guilds.discordState(g.id, "connected", null)) this.discordChanged(g.id); }
  discordProblem(g, text) { if (this.guilds.discordState(g.id, "problem", text)) this.discordChanged(g.id); }
  channelLabel(g) { return g.discord_channel_name ? `#${g.discord_channel_name}` : null; }

  // Queues one piece of bot work for a guild. fn(guild, call) makes the calls; a failure becomes the
  // guild's "problem" state with a plain reason, a success clears it. Resolves true/false/null (skipped).
  job(guildId, name, action, fn) {
    if (!this.client) return Promise.resolve(null);
    const g0 = this.guilds.guild(guildId);
    if (!g0 || !g0.discord_guild) return Promise.resolve(null);
    return this.client.enqueue(g0.discord_guild, name, async (queue) => {
      const g = this.guilds.guild(guildId);
      if (!g || !g.discord_guild || g.discord_guild !== g0.discord_guild) return null;
      try {
        await fn(g, (method, path, json) => this.client.call(method, path, { json, queue }));
        this.discordOk(this.guilds.guild(guildId) || g);
        return true;
      } catch (e) {
        if (!(e instanceof D.DiscordError)) this.note("discord job failed: internal error");
        else this.note(`discord job failed: ${e.kind}${e.status ? ` ${e.status}` : ""}${e.code ? ` code ${e.code}` : ""}`);
        const now = this.guilds.guild(guildId);
        if (now && now.discord_guild) this.discordProblem(now, D.problemText(e, { action: (e && e.action) || action, channel: this.channelLabel(now) }));
        return false;
      }
    }).catch(() => false);
  }

  // The one message of an event (made, then edited in place) and its Discord scheduled event.
  syncEvent(guildId, eventId) {
    return this.job(guildId, `event:${eventId}`, "post", async (g, call) => {
      const ev = this.guilds.eventRow(guildId, eventId);
      if (!ev || !g.discord_channel) return;
      const t = this.now(), over = t > ev.at_ms + G.AFTER_MS;
      const payload = D.renderEvent(ev, this.guilds.signups(guildId, eventId), { open: !ev.cancelled && !over });
      let posted = false;
      if (ev.discord_message && ev.discord_channel === g.discord_channel) {
        try { await call("PATCH", `/channels/${g.discord_channel}/messages/${ev.discord_message}`, payload); posted = true; }
        catch (e) { if (!(e instanceof D.DiscordError) || e.code !== 10008) throw e; } // the message was deleted: post it again
      }
      if (!posted) {
        if (over) return; // nothing to announce about an event that is over
        const made = await call("POST", `/channels/${g.discord_channel}/messages`, payload);
        const id = made && D.snowflake(made.id);
        if (!id) throw new D.DiscordError("bad_answer");
        this.guilds.setEventDiscord(guildId, eventId, { discord_message: id, discord_channel: g.discord_channel });
      }
      if (over) this.guilds.setEventDiscord(guildId, eventId, { closed: 1 });
      try { await this.syncScheduled(g, this.guilds.eventRow(guildId, eventId), call, t); }
      catch (e) { if (e instanceof D.DiscordError) e.action = "event"; throw e; }
    });
  }

  async syncScheduled(g, ev, call, t) {
    if (!ev) return;
    const base = `/guilds/${g.discord_guild}/scheduled-events`;
    if (ev.cancelled) {
      if (!ev.discord_event) return;
      try { await call("DELETE", `${base}/${ev.discord_event}`); }
      catch (e) { if (!(e instanceof D.DiscordError) || e.status !== 404) throw e; }
      this.guilds.setEventDiscord(g.id, ev.id, { discord_event: null, discord_sig: null });
      return;
    }
    if (ev.at_ms < t + 60_000) return; // Discord refuses a start in the past
    const body = D.scheduledEvent(ev), sig = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24);
    if (ev.discord_event && ev.discord_sig === sig) return;
    if (ev.discord_event) {
      try { await call("PATCH", `${base}/${ev.discord_event}`, body); this.guilds.setEventDiscord(g.id, ev.id, { discord_sig: sig }); return; }
      catch (e) { if (!(e instanceof D.DiscordError) || e.status !== 404) throw e; }
    }
    const made = await call("POST", base, body);
    const id = made && D.snowflake(made.id);
    if (!id) throw new D.DiscordError("bad_answer");
    this.guilds.setEventDiscord(g.id, ev.id, { discord_event: id, discord_sig: sig });
  }

  syncAll(guildId) { for (const e of this.guilds.liveEvents(guildId, this.now())) this.syncEvent(guildId, e.id); }

  remind(guildId, eventId) {
    return this.job(guildId, `remind:${eventId}`, "post", async (g, call) => {
      const ev = this.guilds.eventRow(guildId, eventId);
      if (!ev || ev.cancelled || !g.discord_channel) return;
      const members = this.guilds.all("SELECT name_key, discord_user FROM guild_members WHERE guild = ? AND discord_user IS NOT NULL", guildId);
      await call("POST", `/channels/${g.discord_channel}/messages`, D.renderReminder(ev, this.guilds.signups(guildId, eventId), members));
    });
  }

  leaveDiscordServer(discordGuild) {
    if (!this.client || !D.snowflake(discordGuild)) return Promise.resolve(null);
    return this.client.enqueue(discordGuild, null, (queue) => this.client.call("DELETE", `/users/@me/guilds/${discordGuild}`, { queue })).then(() => true, () => false);
  }

  // D1: the address of Discord's own "add this bot" page for one guild.
  discordStart(guild) {
    const nonce = crypto.randomBytes(18).toString("base64url"), t = this.now();
    this.guilds.discordPending(guild.id, nonce, t);
    this.discordChanged(guild.id);
    return D.authorizeUrl(this.discord.appId, this.redirectUri, D.signState(this.config.salt, guild.id, nonce, t));
  }

  // D1: Discord sent the browser back. -> { status, title, text } for the plain page.
  async discordCallback(params) {
    const again = "Go back to Backstage Forever and start the Discord connection again.";
    const st = D.readState(this.config.salt, params.get("state"), this.now());
    if (!st) return { status: 400, title: "This link does not work any more", text: again };
    const g = this.guilds.discordTakeNonce(st.guildId, st.nonce, this.now());
    if (!g) return { status: 400, title: "This link does not work any more", text: again };
    const stop = (status, title, text) => { this.guilds.discordCancelPending(g.id); this.discordChanged(g.id); return { status, title, text }; };
    const code = params.get("code");
    if (params.get("error") || typeof code !== "string" || !/^[A-Za-z0-9._-]{8,200}$/.test(code)) return stop(200, "Nothing was connected", "The bot was not added. You can close this tab.");
    let token;
    try {
      token = await this.client.call("POST", "/oauth2/token", { auth: false, form: {
        client_id: this.discord.appId, client_secret: this.discord.clientSecret, grant_type: "authorization_code", code, redirect_uri: this.redirectUri } });
    } catch (e) {
      this.note(`discord connect failed: ${e instanceof D.DiscordError ? e.kind : "error"}${e && e.status ? ` ${e.status}` : ""}`);
      return stop(502, "Discord did not confirm the connection", again);
    }
    const dg = token && token.guild, discordGuild = dg && D.snowflake(dg.id);
    if (!discordGuild) return stop(502, "Discord did not confirm the connection", again);
    const other = this.guilds.guildByDiscord(discordGuild);
    if (other && other.id !== g.id) return stop(409, "That Discord server is already connected", "It is connected to another guild in Backstage Forever. Disconnect it there first.");
    const channel = D.snowflake(dg.system_channel_id);
    if (g.discord_guild && g.discord_guild !== discordGuild) this.leaveDiscordServer(g.discord_guild);
    this.guilds.discordConnect(g.id, { state: channel ? "connected" : "problem", guild: discordGuild, guildName: D.cleanName(dg.name, 100) || null,
      channel, channelName: null, problem: channel ? null : NO_CHANNEL });
    this.discordChanged(g.id);
    if (channel) {
      this.job(g.id, "channel-name", "post", async (now, call) => {
        const c = await call("GET", `/channels/${channel}`);
        if (c && typeof c.name === "string") this.guilds.discordChannelName(g.id, D.cleanName(c.name, 100));
      });
      this.syncAll(g.id);
    }
    return { status: 200, title: "Discord is connected", text: "You can close this tab and go back to Backstage Forever." };
  }

  // D1: a test post. Resolves { posted, discord } once the bot tried.
  async discordTest(guild) {
    let posted = false;
    if (guild.discord_guild && guild.discord_channel) {
      posted = (await this.job(guild.id, null, "post", (g, call) => call("POST", `/channels/${g.discord_channel}/messages`, D.TEST_MESSAGE))) === true;
    }
    return { posted, discord: G.discordView(this.guilds.guild(guild.id)) };
  }

  discordDisconnect(guild) {
    const had = guild.discord_guild;
    this.guilds.discordDisconnect(guild.id);
    this.discordChanged(guild.id);
    if (had) this.leaveDiscordServer(had);
    return true;
  }

  discordLink(guild, member, code) {
    const r = this.guilds.redeemDiscordCode(guild, member, this.hash(code), this.now());
    if (r) this.syncAll(guild.id);
    return r;
  }

  // The one-time code behind /backstage link and behind "Link your character first".
  linkReply(g, user, lead) {
    const code = G.randomCode("BFL");
    this.guilds.createDiscordCode(this.hash(code), { guild: g.discord_guild, user: user.id, name: user.name }, this.now());
    return reply(`${lead}\nOpen Backstage Forever on your computer, go to Guild and then Discord, and type this code: **${code}**\n` +
      `It works once, for 15 minutes, and only for you. Or open this page for the same steps: ${this.config.publicOrigin}/discord/link?code=${code}`);
  }

  // D2: one verified interaction. -> the JSON to answer with (always within the same request).
  interaction(i) {
    if (!i || typeof i !== "object" || Array.isArray(i)) return null;
    if (i.type === 1) return { type: 1 };
    if (i.type !== 2 && i.type !== 3) return null;
    const t = this.now(), iid = D.snowflake(i.id);
    if (!iid) return null;
    if (this.seen.has(iid)) return reply("That was already handled.");
    if (this.seen.size > 20_000) for (const [k, at] of this.seen) if (t - at > SEEN_MS) this.seen.delete(k);
    this.seen.set(iid, t);
    const discordGuild = D.snowflake(i.guild_id), mu = i.member && typeof i.member === "object" ? i.member.user : null;
    const userId = mu && typeof mu === "object" ? D.snowflake(mu.id) : null;
    if (!discordGuild || !userId) return reply("Use this inside your guild's Discord server.");
    const g = this.guilds.guildByDiscord(discordGuild);
    if (!g) return reply("This Discord server is not connected to a guild in Backstage Forever. A guild leader connects it from the desktop app.");
    const user = { id: userId, name: D.cleanName(i.member.nick || mu.global_name || mu.username, 32) || "Discord user" };
    const data = i.data && typeof i.data === "object" ? i.data : {};

    if (i.type === 3) {
      const m = /^bf:s:([A-Za-z0-9_-]{1,24}):([a-z]{2,6})$/.exec(String(data.custom_id ?? ""));
      if (!m || !EVENT_ID.test(m[1]) || !ANSWERS.includes(m[2])) return reply("That button is not known.");
      const member = this.guilds.memberByDiscord(g.id, userId);
      if (!member) return this.linkReply(g, user, "Link your character first.");
      if (this.store.isBlocked(member.install)) return reply("Signing up is not available for this character.");
      const r = this.guilds.discordSignup(g, m[1], member, m[2], t);
      if (r.error) return reply("That event is no longer on the list.");
      if (!r.accepted) return reply(r.reason === "full" ? "That event has no free sign-up places left." : "That event is closed. It takes no more answers.");
      this.pub(g.id, "guild.signup", { eventId: m[1], signup: r.signup });
      const ev = this.guilds.eventRow(g.id, m[1]);
      const mid = i.message && typeof i.message === "object" ? D.snowflake(i.message.id) : null;
      if (mid && ev && !ev.discord_message) this.guilds.setEventDiscord(g.id, m[1], { discord_message: mid, discord_channel: g.discord_channel });
      // The pressed message is redrawn in the answer itself, so no extra call is needed.
      return { type: 7, data: D.renderEvent(ev, this.guilds.signups(g.id, m[1]), { open: true }) };
    }

    if (data.name !== "backstage" || !Array.isArray(data.options) || !data.options[0] || typeof data.options[0] !== "object") return reply("That command is not known.");
    const sub = data.options[0];
    if (sub.name === "link") return this.linkReply(g, user, "Almost there.");
    if (sub.name === "events") {
      const rows = this.guilds.upcomingEvents(g.id, t, 10);
      if (!rows.length) return reply("No guild events are planned.");
      return reply(rows.map((e) => {
        const c = (a) => this.guilds.get("SELECT COUNT(*) AS c FROM guild_signups WHERE guild = ? AND event = ? AND answer = ?", g.id, e.id, a).c;
        return `**${D.escapeText(e.title, 40)}** <t:${Math.floor(e.at_ms / 1000)}:F> · tank ${c("tank")}/${e.tank}, healer ${c("healer")}/${e.healer}, damage ${c("damage")}/${e.damage}`;
      }).join("\n").slice(0, 1990));
    }
    if (sub.name === "channel") {
      let perms = 0n;
      try { perms = BigInt(String(i.member.permissions ?? "0")); } catch { perms = 0n; }
      if (!(perms & (D.MANAGE_GUILD | D.ADMINISTRATOR))) return reply("Only somebody who may manage this Discord server can choose the channel.");
      const opt = Array.isArray(sub.options) ? sub.options.find(o => o && o.name === "channel") : null;
      const channel = D.snowflake(opt ? opt.value : i.channel_id);
      if (!channel) return reply("That channel cannot be used.");
      const resolved = data.resolved && data.resolved.channels && typeof data.resolved.channels === "object" ? data.resolved.channels[channel] : null;
      const info = resolved || (i.channel && typeof i.channel === "object" && i.channel.id === channel ? i.channel : null);
      if (info && info.type !== undefined && ![0, 5].includes(info.type)) return reply("Choose a normal text channel.");
      const name = info && typeof info.name === "string" ? D.cleanName(info.name, 100) : null;
      this.guilds.discordChannel(g.id, channel, name || null);
      this.discordChanged(g.id);
      this.syncAll(g.id);
      return reply(`Guild events will be posted in ${name ? `#${D.escapeText(name, 100)}` : "that channel"} from now on.`);
    }
    return reply("That command is not known.");
  }

  // ---------------------------------------------------------------- the clock
  // Called about once a second: pings and stream lifetimes every time; listings, reminders and
  // closed events every 30 seconds; expiry every hour. Never throws.
  tick(t = this.now()) {
    try { this.hub.tick(t); } catch { /* a stream fault never stops the clock */ }
    if (t - this.lastSweep >= SWEEP_MS || t < this.lastSweep) {
      this.lastSweep = t;
      try { this.sweep(t); } catch (e) { this.note(`live sweep failed: ${e && e.code ? e.code : "error"}`); }
    }
    if (t - this.lastExpire >= EXPIRE_MS || t < this.lastExpire) {
      this.lastExpire = t;
      try { this.guilds.expire(t); } catch (e) { this.note(`live expiry failed: ${e && e.code ? e.code : "error"}`); }
    }
  }

  sweep(t) {
    for (const row of this.guilds.expireListings(t)) this.publishListingGone(row);
    if (!this.client) return;
    for (const r of this.guilds.dueReminders(t)) {
      this.guilds.setEventDiscord(r.guild, r.id, { reminded: 1 }); // marked first: a reminder is sent at most once
      this.remind(r.guild, r.id);
    }
    for (const r of this.guilds.dueClose(t)) {
      this.guilds.setEventDiscord(r.guild, r.id, { closed: 1 }); // one try to take the buttons off, not one every 30 seconds
      this.syncEvent(r.guild, r.id);
    }
  }

  start(everyMs = 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref();
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.hub.closeAll();
  }

  stats() { return { hub: this.hub.stats(), discord: { on: !!this.client, ...(this.client ? this.client.counters : {}) } }; }
}

function reply(content) { return { type: 4, data: { content: String(content).slice(0, 1990), flags: D.EPHEMERAL, allowed_mentions: D.NO_MENTIONS } }; }

module.exports = { Live, reply, NO_CHANNEL, DISCORD_CODE, nameKey };
