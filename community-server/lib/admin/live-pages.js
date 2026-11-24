"use strict";
// Admin pages for Backstage Live: linked guilds, the party board, and the
// "Backstage Live" block of the dashboard. Same rules as web.js: player text
// reaches a page only through text()/esc(), every action needs the CSRF token
// and is written to the audit log, and the audit log never holds player text
// (a guild is named there by its id, a listing by its id, an install by the
// first eight characters of its hash).
const { esc, text, clip, field, csrfInput, when, num, chip } = require("./html");
const { columnChart, barList, shortDay, r1 } = require("./charts");

const GUILD_ROUTE = "(g_[A-Za-z0-9_-]{16})";
const FLASH = Object.freeze({
  gdisconnected: "Discord was disconnected for that guild. The bot was asked to leave the Discord server.",
  gdeleted: "The guild and everything stored for it were deleted.",
  gmember: "That member was removed from the guild.",
  lremoved: "The listing was removed.",
  lblocked: "The listing was removed and that install is blocked.",
});
const DISCORD_CHIP = { none: ["not connected", ""], pending: ["being connected", "st-looking"], connected: ["connected", "st-fixed"], problem: ["problem", "sev-high"] };
const FACTION = { horde: "Horde", alliance: "Alliance" };
const ROLE_NAME = { tank: "Tank", healer: "Healer", damage: "Damage" };

function discordChip(state) { const [label, cls] = DISCORD_CHIP[state] || [state, ""]; return cls ? chip(label, cls) : `<span class="dim">${esc(label)}</span>`; }
function tile(label, value, sub = "") {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div><div class="tile-sub">${esc(sub)}</div></div>`;
}

// The dashboard block. s: Guilds.stats(); hub: Hub.stats(); range: "30 days".
function renderLive(s, hub, range, discordOn) {
  const total = s.signups.game + s.signups.desktop + s.signups.discord;
  const pct = (n) => (total ? r1((n / total) * 100) : 0);
  return `<div class="section-head"><h2>Backstage Live</h2><span class="dim">guilds, events, sign-ups and the party board; Discord for guilds is ${discordOn ? "on" : "off"}</span></div>
<section class="tiles" aria-label="Backstage Live numbers">
${tile("Live connections", num(hub.streams), "apps connected right now")}
${tile("Stream errors", num(hub.errors), `since the service started${hub.slow ? `, ${num(hub.slow)} too slow` : ""}`)}
${tile("Guilds linked", num(s.guilds), `${num(s.members)} members in all`)}
${tile("With Discord", num(s.guildsWithDiscord), s.guildsWithProblem ? `${num(s.guildsWithProblem)} with a problem` : "none with a problem")}
${tile("Active guilds", num(s.weeklyActiveGuilds), "last 7 days")}
${tile("Events created", num(s.eventsCreated), `last ${range}`)}
${tile("Party listings", num(s.listingsNow), `live now, ${num(s.listingsInRange)} in ${range}`)}
</section>
<div class="charts">
${barList({ title: "Sign-ups by source", what: "Where the answer was given", countLabel: "Sign-ups", of: "Share",
    summary: `${num(total)} sign-ups reached the service in the last ${range}: from the game through a member's app, typed in the desktop app, or pressed on a Discord button.`,
    rows: [{ label: "In the game", n: s.signups.game, pct: pct(s.signups.game) }, { label: "Desktop app", n: s.signups.desktop, pct: pct(s.signups.desktop) }, { label: "Discord button", n: s.signups.discord, pct: pct(s.signups.discord) }] })}
${columnChart({ title: "Party listings per day", summary: `${num(s.listingsInRange)} listings were put on the party board in the last ${range}. A listing that is kept alive counts once.`,
    labels: s.days.map(shortDay), keys: s.days, series: [{ name: "Listings", values: s.listingsPerDay, cls: "s1" }], yLabel: "Listings" })}
</div>
<p class="footnote">Live connections and stream errors are counted in memory and start again from zero when the service restarts. ${num(hub.opened)} streams were opened since then.</p>`;
}

function createLivePages({ store, live, now, Refuse, need }) {
  const guilds = store.guilds, desk = store.desk;
  const label = (hash) => (hash ? hash.slice(0, 8) : "none");

  function guildList(ctx) {
    const q = clip((ctx.url.searchParams.get("q") || "").trim(), 60);
    const rows = guilds.adminList({ q });
    const s = guilds.stats(now(), 30);
    ctx.html({
      title: "Guilds", active: "guilds", wide: true,
      body: `<div class="head"><h1>Guilds</h1><span class="dim">${num(s.guilds)} linked, ${num(s.guildsWithDiscord)} with Discord, ${num(s.guildsWithProblem)} with a Discord problem</span></div>
<p class="lede">Guilds whose leader linked them in the app. Members joined with the guild's code and agreed to their character name being stored.</p>
<form class="filters card" method="get" action="/admin/guilds">
<label class="field grow"><span class="field-label">Search guild name, realm or guild id</span><input type="search" name="q" value="${esc(q)}" maxlength="60"></label>
<div class="filter-go"><button class="btn primary" type="submit">Search</button><a class="btn quiet" href="/admin/guilds">Clear</a></div></form>
${rows.length ? `<div class="card flush"><div class="scroll"><table class="grid-table">
<thead><tr><th scope="col">Guild</th><th scope="col">Realm</th><th scope="col">Faction</th><th scope="col" class="n">Members</th><th scope="col" class="n">Events</th><th scope="col">Discord</th><th scope="col">Last activity</th><th scope="col">Problem</th></tr></thead><tbody>
${rows.map(g => `<tr><th scope="row"><a href="/admin/guilds/${esc(g.id)}" dir="auto">${text(g.name)}</a></th><td dir="auto">${text(g.realm)}</td><td>${esc(FACTION[g.faction] || g.faction)}</td><td class="n">${num(g.members)}</td><td class="n">${num(g.events)}</td><td>${discordChip(g.discord_state)}</td><td class="nowrap">${when(g.active_at)}</td><td class="dim">${g.discord_problem ? text(clip(g.discord_problem, 90)) : "–"}</td></tr>`).join("")}
</tbody></table></div></div>${rows.length >= 200 ? '<p class="footnote">The 200 most recently active guilds are shown. Search to find another.</p>' : ""}` : '<p class="card empty">No guild matches.</p>'}`,
    });
  }

  function guildPage(ctx, id, newCode = "") {
    const d = guilds.adminDetail(id);
    if (!d) throw new Refuse(404, "There is no such guild. It may have been deleted.");
    const g = d.guild, base = `/admin/guilds/${g.id}`, s = ctx.session;
    const dl = (pairs) => `<dl class="facts">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
    ctx.html({
      title: "Guild", active: "guilds", wide: true,
      body: `<p class="crumb"><a href="/admin/guilds">Guilds</a> › <span dir="auto">${text(g.name)}</span></p>
<div class="head"><h1 dir="auto">${text(g.name)}</h1><div class="head-chips">${chip(FACTION[g.faction] || g.faction, "tag")}${discordChip(g.discord_state)}</div></div>
${newCode ? `<p class="flash" role="status">The old code no longer works. The new link code is <b>${esc(newCode)}</b>. It is shown only now: give it to the guild's leader.</p>` : ""}
<div class="ticket"><div class="ticket-main">
<section class="card flush"><table class="grid-table">
<thead><tr><th scope="col">Member</th><th scope="col">Realm</th><th scope="col">Role</th><th scope="col" class="n">Rank</th><th scope="col">Discord</th><th scope="col">Joined</th><th scope="col">Last seen</th><th scope="col"><span class="vh">Action</span></th></tr></thead><tbody>
${d.members.map(m => `<tr><th scope="row" dir="auto">${text(m.name)}</th><td dir="auto">${text(m.realm)}</td><td>${chip(m.role, m.role === "leader" ? "st-fixed" : m.role === "officer" ? "st-looking" : "tag")}</td><td class="n">${num(m.rank)}</td><td>${m.linked ? `<span dir="auto">${text(clip(m.discord_name, 32))}</span>` : '<span class="dim">–</span>'}</td><td class="nowrap">${when(m.joined_at)}</td><td class="nowrap">${when(m.seen_at)}</td>
<td><form method="post" action="${base}/remove" class="inline-form">${csrfInput(s)}<input type="hidden" name="name" value="${esc(m.name)}"><button class="btn danger quiet" type="submit" data-confirm="Remove this member from the guild?">Remove</button></form></td></tr>`).join("")}
</tbody></table></section>
</div><aside class="ticket-side">
<section class="card"><h2>Guild</h2>
${dl([["Guild id", `<code>${esc(g.id)}</code>`], ["Realm", `<span dir="auto">${text(g.realm)}</span>`], ["Faction", esc(FACTION[g.faction] || g.faction)],
    ["Members", `${num(d.members.length)} (${num(d.roles.leader)} leader, ${num(d.roles.officer)} officer, ${num(d.roles.member)} member)`],
    ["Events stored", num(d.events)], ["Sign-ups stored", num(d.signups)], ["Past-event summaries", num(d.summaries)],
    ["Rank rules", esc(`officer up to rank ${g.officer_rank}, propose up to ${g.propose_rank}, edit up to ${g.edit_rank}`)],
    ["Linked", when(g.created_at)], ["Last activity", when(g.active_at)]])}
</section>
<section class="card"><h2>Discord</h2>
${dl([["State", discordChip(g.discord_state)], ["Server", g.discord_guild_name ? `<span dir="auto">${text(g.discord_guild_name)}</span>` : '<span class="dim">–</span>'],
    ["Channel", g.discord_channel_name ? `<span dir="auto">#${text(g.discord_channel_name)}</span>` : '<span class="dim">–</span>'],
    ["Problem", g.discord_problem ? text(g.discord_problem) : '<span class="dim">none</span>']])}
${g.discord_guild || g.discord_state === "pending" ? `<form method="post" action="${base}/disconnect" class="stack">${csrfInput(s)}<p class="dim">Removes the link and every member's Discord tie, and asks the bot to leave that Discord server.</p><button class="btn danger" type="submit" data-confirm="Disconnect Discord for this guild?">Disconnect Discord</button></form>` : ""}
</section>
<section class="card danger"><h2>Link code</h2>
<form method="post" action="${base}/rotate" class="stack">${csrfInput(s)}<p class="dim">Makes a new code and ends the old one, for a code that leaked. Members who already joined stay.</p><button class="btn danger" type="submit" data-confirm="Make a new link code? The old one stops working.">Rotate the code</button></form>
</section>
<section class="card danger"><h2>Delete guild</h2>
<form method="post" action="${base}/delete" class="stack">${csrfInput(s)}
<label class="tick"><input type="checkbox" name="confirm" value="yes" required> Delete this guild, its members, events and sign-ups for good</label>
<button class="btn danger" type="submit">Delete guild</button></form>
</section>
</aside></div>`,
    });
  }

  function guildView(ctx, id) { guildPage(ctx, id); }

  function guildRotate(ctx, id) {
    const g = guilds.guild(id);
    if (!g) throw new Refuse(404, "There is no such guild.");
    const code = live.rotateCode(id);
    desk.audit(ctx.session.admin, "guild_rotate_code", `guild ${id}`, "", now());
    guildPage(ctx, id, code); // shown once, on this answer only; never stored in clear
  }

  function guildDisconnect(ctx, id) {
    const g = guilds.guild(id);
    if (!g) throw new Refuse(404, "There is no such guild.");
    live.discordDisconnect(g);
    desk.audit(ctx.session.admin, "guild_discord_disconnect", `guild ${id}`, `was=${g.discord_state}`, now());
    ctx.redirect(`/admin/guilds/${id}?done=gdisconnected`);
  }

  function guildDelete(ctx, id) {
    const g = guilds.guild(id);
    need(ctx.form.get("confirm") === "yes", "Tick the box to confirm.");
    if (!g) throw new Refuse(404, "There is no such guild.");
    const d = guilds.adminDetail(id);
    live.deleteGuild(g);
    desk.audit(ctx.session.admin, "guild_delete", `guild ${id}`, `members=${d.members.length} events=${d.events} signups=${d.signups}`, now());
    ctx.redirect("/admin/guilds?done=gdeleted");
  }

  function guildRemove(ctx, id) {
    const g = guilds.guild(id);
    if (!g) throw new Refuse(404, "There is no such guild.");
    const key = String(ctx.form.get("name") ?? "").normalize("NFC").toLowerCase();
    const r = live.removeMember(g, key);
    if (!r.removed) throw new Refuse(404, "There is no such member in that guild.");
    desk.audit(ctx.session.admin, "guild_member_remove", `guild ${id}`, `members_left=${r.members}${r.deleted ? " guild_deleted=yes" : ""}`, now());
    ctx.redirect(r.deleted ? "/admin/guilds?done=gdeleted" : `/admin/guilds/${id}?done=gmember`);
  }

  function partyList(ctx) {
    const rows = guilds.adminListings(now());
    const roles = (r) => (r.roles ? r.roles.split(",").map(x => ROLE_NAME[x] || x).join(", ") : "–");
    const needText = (r) => { if (!r.need) return "–"; let n; try { n = JSON.parse(r.need); } catch { return "–"; } return `${n.tank} tank, ${n.healer} healer, ${n.damage} damage`; };
    ctx.html({
      title: "Party board", active: "party", wide: true,
      body: `<div class="head"><h1>Party board</h1><span class="dim">${num(rows.length)} live listings</span></div>
<p class="lede">What players put on the realm board to find a party. A listing disappears 30 minutes after its app last refreshed it. Players on the same realm and faction see these.</p>
${rows.length ? `<div class="card flush"><div class="scroll"><table class="grid-table">
<thead><tr><th scope="col">Character</th><th scope="col">Realm</th><th scope="col">Faction</th><th scope="col">Kind</th><th scope="col" class="n">Level</th><th scope="col">Class</th><th scope="col">Roles</th><th scope="col">Place</th><th scope="col">Needs</th><th scope="col">Note</th><th scope="col">Refreshed</th><th scope="col">Install</th><th scope="col"><span class="vh">Actions</span></th></tr></thead><tbody>
${rows.map(r => `<tr><th scope="row" class="nowrap" dir="auto">${text(r.name)}</th><td class="nowrap" dir="auto">${text(r.realm)}</td><td>${esc(FACTION[r.faction] || r.faction)}</td><td class="nowrap">${esc(r.kind === "lfm" ? "Looking for more" : "Looking for group")}</td><td class="n">${num(r.level)}</td><td class="nowrap">${text(r.class || "–")}</td><td class="nowrap">${esc(roles(r))}</td><td class="nowrap">${text(r.place)}</td><td class="nowrap">${esc(needText(r))}</td><td class="nowrap" dir="auto">${r.note ? text(r.note) : '<span class="dim">–</span>'}</td><td class="nowrap">${when(r.at)}</td><td><code>${esc(label(r.install))}</code></td>
<td class="nowrap"><form method="post" action="/admin/party/${esc(r.id)}/remove" class="inline-form">${csrfInput(ctx.session)}<button class="btn quiet" type="submit">Remove</button></form>
<form method="post" action="/admin/party/${esc(r.id)}/block" class="inline-form">${csrfInput(ctx.session)}<button class="btn danger quiet" type="submit" data-confirm="Remove this listing and refuse everything this install sends from now on?">Block install</button></form></td></tr>`).join("")}
</tbody></table></div></div>` : '<p class="card empty">Nobody is looking for a party right now.</p>'}`,
    });
  }

  function partyRemove(ctx, id) {
    if (!live.adminRemoveListing(id)) throw new Refuse(404, "There is no such listing. It may have run out.");
    desk.audit(ctx.session.admin, "listing_remove", `listing ${id}`, "", now());
    ctx.redirect("/admin/party?done=lremoved");
  }

  function partyBlock(ctx, id) {
    const row = guilds.listing(id);
    if (!row) throw new Refuse(404, "There is no such listing. It may have run out.");
    live.adminRemoveListing(id);
    store.blockInstall(row.install, now());
    live.hub.dropInstall(row.install);
    desk.audit(ctx.session.admin, "install_block", `install ${label(row.install)}`, `from=listing ${id}`, now());
    ctx.redirect("/admin/party?done=lblocked");
  }

  const ROUTES = [
    ["GET", /^\/admin\/guilds\/?$/, "/admin/guilds", guildList],
    ["GET", new RegExp(`^/admin/guilds/${GUILD_ROUTE}$`), "/admin/guilds/:id", guildView],
    ["POST", new RegExp(`^/admin/guilds/${GUILD_ROUTE}/rotate$`), "/admin/guilds/:id/rotate", guildRotate],
    ["POST", new RegExp(`^/admin/guilds/${GUILD_ROUTE}/disconnect$`), "/admin/guilds/:id/disconnect", guildDisconnect],
    ["POST", new RegExp(`^/admin/guilds/${GUILD_ROUTE}/delete$`), "/admin/guilds/:id/delete", guildDelete],
    ["POST", new RegExp(`^/admin/guilds/${GUILD_ROUTE}/remove$`), "/admin/guilds/:id/remove", guildRemove],
    ["GET", /^\/admin\/party\/?$/, "/admin/party", partyList],
    ["POST", /^\/admin\/party\/([A-Za-z0-9_-]{16})\/remove$/, "/admin/party/:id/remove", partyRemove],
    ["POST", /^\/admin\/party\/([A-Za-z0-9_-]{16})\/block$/, "/admin/party/:id/block", partyBlock],
  ];
  return { ROUTES };
}

module.exports = { createLivePages, renderLive, FLASH };
