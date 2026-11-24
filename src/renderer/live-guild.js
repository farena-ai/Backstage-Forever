"use strict";
// Backstage Live in the main window: the guild cards on Plans → Guild (the invitation to join, the
// guided "Connect our guild to Discord" setup, Link my Discord, live status), and the group planner,
// regulars and the realm party board on Plans → Party, the guide page under Help, and the block on
// Settings → Privacy & sharing. Every sentence that asks for consent comes from privacy-wording.js.
// The screens keep no secrets: the main process never hands a member key to this file.
window.LiveGuild = (() => {
  const api = window.backstage, W = window.PrivacyWording;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const keep = (v) => `<span data-no-translate>${esc(v)}</span>`;
  // The translator leaves text boxes alone, so their hints and labels are translated here.
  const T = (text) => window.I18n?.tr?.(text) || text;
  const ROLE = { tank: "Tank", healer: "Healer", damage: "Damage" }, ROLES = ["tank", "healer", "damage"];
  const ROLE_PLURAL = { tank: "Tanks", healer: "Healers", damage: "Damage" };
  const ANSWER = { tank: "Tank", healer: "Healer", damage: "Damage", maybe: "Maybe", no: "No" };
  const CLASS = { warrior: "Warrior", paladin: "Paladin", hunter: "Hunter", rogue: "Rogue", priest: "Priest", shaman: "Shaman", mage: "Mage", warlock: "Warlock", druid: "Druid" };
  const RANK = { leader: "Guild leader", officer: "Officer", member: "Member" };
  const INTRO_KEY = "bf-live-guild-intro-v1", PARTY_INTRO_KEY = "bf-live-party-intro-v1";
  const S = { data: null, loadedFor: undefined, loading: false, error: "", busy: "", note: {}, drafts: {}, plan: null, planFor: undefined, regulars: null, eventKey: null, pick: null,
    confirm: null, focus: null, dirty: false, boardFilter: { place: "", role: "" }, form: null, tick: null, open: {}, postAsk: false, regularQuery: "" };
  let host = { navigate: () => {}, page: () => "", profileId: () => null };
  const stamp = (v, kind) => (window.I18n?.when ? window.I18n.when(v, kind) : new Date(v).toLocaleString());
  const when = (iso) => stamp(Date.parse(iso), "weekday");
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
  const say = (key, text, bad = false) => { S.note[key] = text ? { text, bad } : null; };
  const noteLine = (key) => `<p class="lg-msg${S.note[key]?.bad ? " lg-bad" : ""}" role="status" data-lg-note="${key}">${esc(S.note[key]?.text || "")}</p>`;
  const draft = (key, fallback = "") => (key in S.drafts ? S.drafts[key] : fallback);
  const busy = (key) => (S.busy === key ? " disabled" : S.busy ? " disabled" : "");

  // ---------------------------------------------------------------- small pieces
  /** A status light with its words: colour is never the only signal. */
  function light(kind, text) {
    const mark = { ok: "●", wait: "◐", bad: "✕", off: "○" }[kind] || "○";
    return `<span class="lg-status lg-status-${kind}"><span class="lg-dot" aria-hidden="true">${mark}</span><span>${text}</span></span>`;
  }
  function liveStatus(d) {
    const s = d?.live?.state;
    if (s === "live") return light("ok", "Live");
    if (s === "connecting") return light("wait", "Connecting…");
    if (s === "reconnecting") return light("wait", "Reconnecting…");
    if (s === "offline") return light("bad", "Offline. Your changes are kept and sent later.");
    return light("off", "Not connected");
  }
  const pendingLine = (n) => (n > 0 ? `<p class="lg-pending" data-lg-pending><span class="lg-dot" aria-hidden="true">↻</span> <span>${n === 1 ? "1 update will reach the game at your next /reload" : `${n} updates will reach the game at your next /reload`}</span></p>` : "");
  const flow = (...nodes) => `<div class="lg-flow" aria-hidden="true">${nodes.map((n, i) => `${i ? '<span class="lg-arrow">→</span>' : ""}<span class="lg-node${n[1] ? ` lg-node-${n[1]}` : ""}">${n[0]}</span>`).join("")}</div>`;
  // A membership is one character in one guild; its id (memberId) is what every action names.
  const myGuild = (d) => (d?.guildId ? d.guilds.find((g) => g.memberId === d.guildId) || null : null);
  const copyButton = (text, label = "Copy") => `<button type="button" class="lg-copy" data-lg="copy" data-text="${esc(text)}"${label === "Copy whisper" ? ' title="Copy whisper command"' : ""}>${label}</button>`;

  // ---------------------------------------------------------------- the invitation (consent card)
  function offerCard(o, where) {
    const key = `offer:${o.code}`;
    return `<section class="ldg-card lg-consent" data-lg-offer="${esc(o.code)}" aria-label="Invitation from your guild">
      <div class="lg-eyebrow">Invitation from your guild</div>
      <h2><span>Join the events of</span> ${keep(o.guildName)}<span>?</span></h2>
      <p class="lg-lead"><span>${esc(W.GUILD.join[0])}</span> <strong data-no-translate>${esc(o.guildName)}</strong> <span>${esc(W.GUILD.join[1])}</span></p>
      <dl class="lg-facts">
        <div><dt>What is shared</dt><dd><span>The name</span> ${keep(o.character.name)} <span>and the realm</span> ${keep(o.character.realm)}<span>, your guild rank number, and your answers to guild events.</span></dd></div>
        <div><dt>Who sees it</dt><dd>${esc(W.GUILD.who[0])}. ${esc(W.GUILD.who[1])}.</dd></div>
        <div><dt>How to stop</dt><dd>${esc(W.GUILD.leave[0])}</dd></div>
      </dl>
      <div class="lg-actions"><button type="button" class="primary" data-lg="join" data-code="${esc(o.code)}"${busy(key)}>Join</button><button type="button" data-lg="decline" data-code="${esc(o.code)}"${busy(key)}>Not now</button><button type="button" data-lg="never" data-code="${esc(o.code)}"${busy(key)}>Never for this guild</button>${where === "dock" ? "" : `<button type="button" class="subtle" data-nav="guild-guide">How this works</button>`}</div>
      <p class="lg-fine">Nothing is sent until you choose Join. “Not now” asks again the next time your guild's link is heard in game.</p>${noteLine(key)}</section>`;
  }

  // ---------------------------------------------------------------- leader: Connect our guild to Discord
  function chatPicture(command) {
    return `<div class="lg-chat" role="img" aria-label="The game's chat box with the command typed in"><div class="lg-chat-log"><span class="lg-chat-line">[Guild] …</span></div><div class="lg-chat-box"><span class="lg-chat-caret" aria-hidden="true"></span><code data-no-translate>${esc(command)}</code></div><div class="lg-chat-key"><span class="lg-keycap">Enter</span></div></div>`;
  }
  function stepOne(g) {
    const d = g.discord;
    if (!d.available) return `<li class="lg-step" data-lg-step="discord"><div class="lg-step-head"><span class="lg-num">1</span><h3>Add to Discord</h3>${light("off", "Not available yet")}</div>
      <p class="lg-off" data-lg-discord-off>Discord connection is not available yet.</p><p class="lg-fine">Everything else on this page works without it: events, sign-ups and the panel. Come back later and press Check again.</p>
      <div class="lg-actions"><button type="button" data-lg="discord" data-action="start" data-guild="${esc(g.memberId)}"${busy("discord")}>Check again</button></div>${noteLine("discord")}</li>`;
    const status = d.state === "connected" ? light("ok", "Connected") : d.state === "pending" ? light("wait", "Waiting for you in the browser") : d.state === "problem" ? light("bad", "Needs a fix") : light("off", "Not done yet");
    const detail = d.state === "connected" ? `<p class="lg-good"><span>Connected to the Discord server</span> ${keep(d.guildName || "?")}<span>.</span> ${d.channel ? `<span>Events are posted in</span> ${keep(d.channel)}<span>.</span>` : `<span>Events are posted in the server's default channel.</span>`}</p>
        <p class="lg-fine"><strong>Change channel:</strong> <span>in Discord, go to the channel you want and type</span> <code data-no-translate>/backstage channel</code> ${copyButton("/backstage channel")}</p>`
      : d.state === "pending" ? `<p class="lg-fine">Your browser opened Discord's own page. Pick your server there and choose Authorise. This step turns green by itself; you do not need to press anything here.</p>`
      : d.state === "problem" ? `<p class="lg-problem"><strong>Problem:</strong> ${keep(d.problem || "Discord refused the last post.")}</p><p class="lg-fix"><strong>How to fix it:</strong> <span>in Discord, open the channel's settings and allow Backstage Forever to View Channel, Send Messages and Embed Links. Or pick another channel: type</span> <code data-no-translate>/backstage channel</code> <span>there. Then press Send a test post below.</span></p>`
      : `<p class="lg-fine">Opens Discord's own page in your browser. You need the “Manage Server” right on your Discord server. The bot asks for four permissions only: View Channel, Send Messages, Embed Links and Manage Events.</p>`;
    return `<li class="lg-step${d.state === "connected" ? " lg-done" : ""}" data-lg-step="discord"><div class="lg-step-head"><span class="lg-num">1</span><h3>Add to Discord</h3>${status}</div>${detail}
      <div class="lg-actions"><button type="button" class="${d.state === "connected" ? "" : "primary"}" data-lg="discord" data-action="start" data-guild="${esc(g.memberId)}"${g.canManage ? busy("discord") : " disabled"}>${d.state === "connected" ? "Add to another server ↗" : d.state === "pending" ? "Open Discord's page again ↗" : "Add to Discord ↗"}</button>
      ${d.state === "pending" ? `<button type="button" data-lg="discord" data-action="refresh" data-guild="${esc(g.memberId)}"${busy("discord")}>Check now</button>` : ""}</div>${d.state === "pending" || S.note.discord?.bad ? noteLine("discord") : ""}</li>`;
  }
  function stepTwo(g) {
    const command = `/bf guild link ${g.linkCode || ""}`.trim();
    const status = g.linkHeard ? light("ok", "Heard in game") : light("wait", "Waiting for you to type it");
    return `<li class="lg-step${g.linkHeard ? " lg-done" : ""}" data-lg-step="link"><div class="lg-step-head"><span class="lg-num">2</span><h3>Type this in game</h3>${status}</div>
      ${g.linkCode ? `<div class="lg-command"><code data-no-translate data-lg-command>${esc(command)}</code>${copyButton(command)}</div>${chatPicture(command)}
      ${flow(["You type it", "you"], ["Guild chat"], ["Members' apps"], ["Join?", "ok"])}
      <p class="lg-fine">${g.linkHeard ? "Your guild's addons heard it. Members who run the app now see an invitation and join with one click." : "Log in on a character of this guild, paste the line into the chat box and press Enter. Members who are online and run the app get an invitation; nobody else sees anything."}</p>
      <p class="lg-fine">Type it again later for members who were offline. The code is not a secret from your guild, but only your guild should have it.</p>`
      : `<p class="lg-fine">Only the guild leader and officers see the link code. Ask them to type it in guild chat for new members.</p>`}${noteLine("link")}</li>`;
  }
  function stepThree(g) {
    const d = g.discord, ready = d.available && (d.state === "connected" || d.state === "problem");
    const status = !d.available ? light("off", "Not available yet") : d.testAt ? light("ok", "Test post sent") : ready ? light("wait", "Ready to test") : light("off", "After step 1");
    return `<li class="lg-step${d.testAt ? " lg-done" : ""}" data-lg-step="test"><div class="lg-step-head"><span class="lg-num">3</span><h3>Send a test post</h3>${status}</div>
      <p class="lg-fine">${!d.available ? "This needs Discord, which is not available yet." : d.testAt ? `<span>Sent</span> ${keep(stamp(d.testAt, "time"))}<span>. Look in your Discord channel: a short message from Backstage Forever should be there.</span>` : ready ? "Posts one short message in your channel, so you know it works before the first event." : "Finish step 1 first. The button wakes up when Discord is connected."}</p>
      <div class="lg-actions"><button type="button" data-lg="discord" data-action="test" data-guild="${esc(g.memberId)}"${ready && g.canManage ? busy("test") : " disabled"}>Send a test post</button></div>${noteLine("test")}</li>`;
  }
  function manageBlock(g) {
    const open = S.open.manage ? " open" : "";
    const members = g.members.length ? `<ul class="lg-members">${g.members.map((m) => `<li><span class="lg-member-name">${keep(m.name)}${m.me ? ` <small>this is you</small>` : ""}</span><span>${RANK[m.role] || "Member"}</span><span>${m.discord ? `<span>Discord:</span> ${keep(m.discord)}` : `<span class="lg-muted">Discord not linked</span>`}</span>${!m.me && m.role !== "leader" && g.canManage ? `<button type="button" class="subtle" data-lg="remove-member" data-guild="${esc(g.memberId)}" data-name="${esc(m.name)}">Remove</button>` : "<span></span>"}</li>`).join("")}</ul>` : `<p class="lg-muted">Nobody has joined yet.</p>`;
    const confirming = S.confirm === `delete:${g.memberId}`;
    return `<details class="lg-manage" data-lg-details="manage"${open}><summary>Members and guild settings</summary>
      <h3>Members who joined (${g.memberCount})</h3>${members}
      <div class="lg-manage-row"><div><h3>Rotate code</h3><p class="lg-fine">Makes a new link code. The old one stops working at once; members who already joined stay.</p></div><button type="button" data-lg="rotate" data-guild="${esc(g.memberId)}"${g.isLeader ? busy("rotate") : " disabled"}>Rotate code</button></div>
      <div class="lg-manage-row"><div><h3>Disconnect Discord</h3><p class="lg-fine">The bot stops posting and the Discord names are forgotten. Events and sign-ups stay.</p></div><button type="button" data-lg="discord" data-action="disconnect" data-guild="${esc(g.memberId)}"${g.canManage && g.discord.state !== "none" ? busy("discord") : " disabled"}>Disconnect</button></div>
      <div class="lg-manage-row lg-danger-row"><div><h3>Delete our guild's data</h3><p class="lg-fine">Removes everything the service holds about this guild: members, events, sign-ups and the Discord connection. It cannot be undone. Only the guild leader can do it.</p>
        ${confirming ? `<label class="lg-field"><span>Type the guild's name to confirm:</span> ${keep(g.guildName)}<input type="text" data-lg-input="delete:${esc(g.memberId)}" maxlength="40" value="${esc(draft(`delete:${g.memberId}`))}" autocomplete="off" spellcheck="false"></label>` : ""}</div>
        ${confirming ? `<div class="lg-stack"><button type="button" class="danger" data-lg="delete-confirm" data-guild="${esc(g.memberId)}"${busy("delete")}>Delete everything</button><button type="button" data-lg="delete-cancel">Cancel</button></div>` : `<button type="button" class="danger" data-lg="delete-ask" data-guild="${esc(g.memberId)}"${g.isLeader ? "" : " disabled"}>Delete our guild's data…</button>`}</div>
      ${noteLine("manage")}</details>`;
  }
  function setupCard(d, g) {
    if (g) return `<section class="ldg-card lg-setup" data-lg-setup="steps"><div class="ldg-toolbar"><h2>Connect our guild to Discord</h2>${liveStatus(d)}</div>
      <p class="ldg-note">Three steps. Each one shows a light: grey is not done, amber is waiting, green is done. Steps 1 and 3 are for Discord; step 2 is all your members need.</p>
      <ol class="lg-steps">${stepOne(g)}${stepTwo(g)}${stepThree(g)}</ol>${manageBlock(g)}</section>`;
    const c = d.context, ready = c && c.usable && c.faction && c.guildName;
    const why = !c ? "Choose a character first." : !c.usable || !c.faction ? "The app does not know this character's realm and faction yet. Log in with it in game and type /reload once." : !c.guildName ? "The app does not know this character's guild yet. Log in with it in game, then type /reload once." : "";
    const rank = draft("rank", "0");
    return `<section class="ldg-card lg-setup" data-lg-setup="start"><div class="ldg-toolbar"><h2>Connect our guild to Discord</h2><span class="lg-tag">For guild leaders and officers</span></div>
      <p class="ldg-note">Your members then join with one click, see events and sign-ups live, and can answer from Discord. Nobody needs an account or a password.</p>
      <ol class="lg-preview"><li><span class="lg-num">1</span><span>Add to Discord</span></li><li><span class="lg-num">2</span><span>Type one line in game</span></li><li><span class="lg-num">3</span><span>Send a test post</span></li></ol>
      <div class="lg-consent-box"><p><strong>What this keeps on the service.</strong> <span>${esc(W.GUILD.leader)}</span></p>
        ${ready ? `<p><span>Guild:</span> ${keep(c.guildName)} · ${keep(c.realm)} · <span>${c.faction === "horde" ? "Horde" : "Alliance"}</span> · <span>set up by</span> ${keep(c.name)}</p>` : ""}
        <fieldset class="lg-rank"><legend>In this guild I am</legend><label><input type="radio" name="lg-rank" value="0" data-lg-input="rank"${rank === "0" ? " checked" : ""}> <span>the guild leader</span></label><label><input type="radio" name="lg-rank" value="1" data-lg-input="rank"${rank === "1" ? " checked" : ""}> <span>an officer</span></label></fieldset></div>
      ${why ? `<p class="lg-fix" data-lg-why><strong>Before you can start:</strong> <span>${why}</span></p>` : ""}
      <div class="lg-actions"><button type="button" class="primary" data-lg="create"${ready ? busy("create") : " disabled"}>I agree, start the setup</button><button type="button" class="subtle" data-nav="guild-guide">Read the guide first</button></div>
      <p class="lg-fine">Is your guild already connected? Then ask a member to type <code data-no-translate>/bf guild link</code> in game; an invitation appears here.</p>${noteLine("create")}</section>`;
  }

  // ---------------------------------------------------------------- member: live status, Link my Discord, Leave
  function discordMe(g) {
    const d = g.discord;
    if (!d.available) return `<div class="lg-sub" data-lg-discord-me><h3>Link my Discord</h3><p class="lg-off" data-lg-discord-off>Discord connection is not available yet.</p></div>`;
    if (d.state !== "connected" && d.state !== "problem") return `<div class="lg-sub" data-lg-discord-me><h3>Link my Discord</h3><p class="lg-muted">Your guild has not connected a Discord server yet. A guild leader or officer does that with the three steps on this page.</p></div>`;
    if (g.linkedDiscord) return `<div class="lg-sub" data-lg-discord-me><h3>Link my Discord</h3><p>${light("ok", "Linked")} <span>Your Discord name:</span> ${keep(g.linkedDiscord)}<span>. The buttons under event posts in Discord now answer for</span> ${keep(g.character.name)}<span>.</span></p>
      <div class="lg-actions"><button type="button" data-lg="discord" data-action="unlink" data-guild="${esc(g.memberId)}"${busy("me")}>Unlink</button></div>${noteLine("me")}</div>`;
    return `<div class="lg-sub" data-lg-discord-me><h3>Link my Discord</h3>
      <p>In your guild's Discord, type <code data-no-translate>/backstage link</code> ${copyButton("/backstage link")}. <span>Discord shows a code only you can see. Paste it here, and the sign-up buttons under event posts answer as this character.</span></p>
      <div class="lg-inline"><label class="lg-field"><span>Code from Discord</span><input type="text" data-lg-input="discord-code" maxlength="64" value="${esc(draft("discord-code"))}" autocomplete="off" spellcheck="false" placeholder="L-…"></label><button type="button" class="primary" data-lg="discord" data-action="link" data-guild="${esc(g.memberId)}"${busy("me")}>Link my Discord</button></div>
      <p class="lg-fine">The service keeps only your Discord user number and display name.</p>${noteLine("me")}</div>`;
  }
  function eventForm(d, g) {
    if (!g.canPropose) return "";
    const f = S.form || (S.form = { title: "", place: "mc", date: "", time: "20:00", tank: 2, healer: 8, damage: 30, note: "" });
    const places = d.places.map((p) => `<option value="${esc(p.id)}"${p.id === f.place ? " selected" : ""} data-keep>${esc(p.name)}</option>`).join("");
    return `<details class="lg-manage lg-propose" data-lg-details="propose"${S.open.propose ? " open" : ""}><summary>Propose an event from here</summary>
      <div class="lg-form"><label class="lg-field lg-wide"><span>Title</span><input type="text" data-lg-input="ev:title" maxlength="40" value="${esc(f.title)}" placeholder="${esc(T("Molten Core, Thursday"))}"></label>
        <label class="lg-field"><span>Where</span><select data-lg-input="ev:place" aria-label="Where">${places}</select></label>
        <label class="lg-field"><span>Day</span><input type="date" data-lg-input="ev:date" value="${esc(f.date)}"></label>
        <label class="lg-field"><span>Time (your computer's)</span><input type="time" data-lg-input="ev:time" value="${esc(f.time)}"></label>
        ${ROLES.map((r) => `<label class="lg-field lg-count"><span>${ROLE_PLURAL[r]}</span><input type="number" min="0" max="${r === "damage" ? 40 : 9}" data-lg-input="ev:${r}" value="${esc(f[r])}"></label>`).join("")}
        <label class="lg-field lg-wide"><span>Note (optional)</span><input type="text" data-lg-input="ev:note" maxlength="80" value="${esc(f.note)}"></label></div>
      <div class="lg-actions"><button type="button" class="primary" data-lg="propose" data-guild="${esc(g.memberId)}"${busy("propose")}>Propose event</button></div>
      <p class="lg-fine">Members' apps and Discord get it within seconds. The game gets it at the next /reload of any member who runs the app, and passes it on in guild chat from there.</p>${noteLine("propose")}</details>`;
  }
  function memberCard(d, g) {
    const confirming = S.confirm === `leave:${g.memberId}`;
    return `<section class="ldg-card lg-live" data-lg-member="${esc(g.guildId)}"><div class="ldg-toolbar"><h2>Live with your guild</h2>${liveStatus(d)}</div>
      <div class="lg-summary"><div><strong data-no-translate>${esc(g.guildName)}</strong><span>${RANK[g.role] || "Member"}</span></div><div><strong>${g.memberCount}</strong><span>${g.memberCount === 1 ? "member joined" : "members joined"}</span></div><div><strong>${g.events.length}</strong><span>${g.events.length === 1 ? "event ahead" : "events ahead"}</span></div>
        <div>${g.discord.available ? (g.discord.state === "connected" ? light("ok", "Discord connected") : g.discord.state === "problem" ? light("bad", "Discord needs a fix") : light("off", "No Discord yet")) : light("off", "Discord not available yet")}</div></div>
      ${g.waiting ? `<p class="lg-pending"><span class="lg-dot" aria-hidden="true">⧗</span> <span>${g.waiting === 1 ? "1 change is waiting for the service and will be sent by itself" : `${g.waiting} changes are waiting for the service and will be sent by themselves`}</span></p>` : ""}${pendingLine(d.pending)}
      <div class="lg-actions"><button type="button" class="primary" data-lg="panel" data-tab="events">Open the Guild &amp; Party panel</button><button type="button" data-lg="refresh"${busy("refresh")}>Refresh</button><button type="button" class="subtle" data-nav="guild-guide">Guide</button></div>
      ${eventForm(d, g)}${discordMe(g)}
      <div class="lg-sub lg-leave"><h3>Leave</h3><p class="lg-fine">${esc(W.GUILD.leave[0])} <span>You stay in the guild in game; only the app stops sharing.</span></p>
        ${confirming ? `<div class="lg-actions"><button type="button" class="danger" data-lg="leave-confirm" data-guild="${esc(g.memberId)}"${busy("leave")}>Yes, leave</button><button type="button" data-lg="leave-cancel">Stay</button></div>` : `<div class="lg-actions"><button type="button" data-lg="leave-ask" data-guild="${esc(g.memberId)}">Leave…</button></div>`}${noteLine("leave")}</div>${noteLine("member")}</section>`;
  }
  function introCard() {
    if (store(INTRO_KEY) === "done") return "";
    return `<section class="ldg-card lg-intro" data-lg-intro><div class="lg-eyebrow">New · Guild &amp; Party, live</div><h2>Your guild's events, live</h2>
      <ul class="lg-bullets"><li><strong>Members:</strong> <span>when your guild uses this, an invitation appears here. One click joins.</span></li><li><strong>Leaders and officers:</strong> <span>connect the guild in three steps below, with or without Discord.</span></li><li><strong>Everyone:</strong> <span>a small window over the game shows events, your group and a party board for your realm.</span></li></ul>
      <div class="lg-actions"><button type="button" class="primary" data-nav="guild-guide">Show me how</button><button type="button" data-lg="intro-done">Got it</button></div></section>`;
  }
  function neverLine(d) {
    if (!d.never.length) return "";
    return `<p class="lg-fine" data-lg-never><span>You said never for:</span> ${d.never.map((n) => `${keep(n.guildName)} <button type="button" class="subtle" data-lg="allow" data-key="${esc(n.key)}">Ask me again</button>`).join(" ")}</p>`;
  }
  /** Everything Backstage Live adds to Plans → Guild for the character that page shows. */
  function guildHtml(profileId = null) {
    const d = S.data && S.loadedFor === (profileId ?? null) ? S.data : null;
    const inner = !api?.liveGuildState ? "" : !d ? `<p class="ldg-empty">${S.error ? esc(S.error) : "Looking for your guild's live link…"}</p>` : (() => {
      const g = myGuild(d);
      // Opened sections belong to one membership; another character starts with them closed.
      if (S.openFor !== (g?.memberId || "")) { S.openFor = g?.memberId || ""; S.open = {}; S.confirm = null; }
      const setup = g && g.role === "member" ? "" : d.offersHere.length && !g ? "" : setupCard(d, g);
      return `${introCard()}${d.offersHere.map((o) => offerCard(o, "page")).join("")}${g && g.canManage ? setup : ""}${g ? memberCard(d, g) : ""}${g && g.canManage ? "" : setup}${neverLine(d)}`;
    })();
    return `<div class="lg-root" data-lg-root="guild" data-lg-profile="${esc(profileId ?? "")}">${inner}</div>`;
  }
  /** For guild.js: the live events of this character's guild in that page's own shape, or null when not joined. */
  function eventsFor(profileId = null) {
    const d = S.data && S.loadedFor === (profileId ?? null) ? S.data : null, g = d ? myGuild(d) : null;
    if (!g) return null;
    const short = { tank: "t", healer: "h", damage: "d", maybe: "m", no: "n" };
    return { guildId: g.memberId, live: d.live?.state === "live", events: g.events.map((e) => ({ id: e.id, title: e.title, place: e.placeName, at: Math.floor(Date.parse(e.at) / 1000), creator: e.creator.name, editor: e.editor && e.editor.name !== e.creator.name ? e.editor.name : null, relayed: false,
      roles: { t: e.roles.tank, h: e.roles.healer, d: e.roles.damage }, note: e.note || null, mine: e.mine ? short[e.mine] : null, mineWord: e.mine, waiting: e.waiting, inGame: e.inGame, canCancel: g.canEdit || e.creator.name === g.character.name,
      signups: Object.fromEntries(Object.entries(short).map(([word, k]) => [k, e.names[word]])) })) };
  }
  /** The one-click answer row under an event on Plans → Guild. */
  function answerRow(guildId, e) {
    return `<div class="lg-answer" data-lg-answer-row="${esc(e.id)}"><span class="lg-answer-label">Your answer:</span>${Object.keys(ANSWER).map((a) => `<button type="button" class="lg-answer-btn${e.mineWord === a ? " lg-on" : ""}" data-lg="answer" data-guild="${esc(guildId)}" data-event="${esc(e.id)}" data-answer="${a}" aria-pressed="${e.mineWord === a}"${busy(`answer:${e.id}`)}>${ANSWER[a]}</button>`).join("")}
      ${e.waiting ? `<span class="lg-muted">Waiting for the service</span>` : e.mineWord && !e.inGame ? `<span class="lg-muted">In game after your next /reload</span>` : ""}${e.canCancel ? `<button type="button" class="subtle lg-calloff" data-lg="cancel-event" data-guild="${esc(guildId)}" data-event="${esc(e.id)}">Call off</button>` : ""}</div>`;
  }

  // ---------------------------------------------------------------- Plans → Party: the group planner
  function chip(m, opts = {}) {
    const picked = S.pick && S.pick.name === m.name && S.pick.realm === m.realm;
    const source = { party: "In your group", signup: "Signed up", yours: "Your character" }[m.source] || "";
    return `<button type="button" class="lg-chip${picked ? " lg-picked" : ""}${m.online === false ? " lg-offline" : ""}" draggable="true" data-lg="pick" data-name="${esc(m.name)}" data-realm="${esc(m.realm)}" aria-pressed="${picked}" title="${esc(source)}"><strong data-no-translate>${esc(m.name)}</strong><small>${[m.class && CLASS[m.class] ? `<span>${CLASS[m.class]}</span>` : "", m.level ? `<span data-no-translate>${m.level}</span>` : "", m.role ? `<span>${ROLE[m.role]}</span>` : "", m.ready === true ? `<span>Ready</span>` : "", opts.source && source ? `<span>${source}</span>` : ""].filter(Boolean).join(" · ")}</small></button>`;
  }
  function warning(w) {
    return `<li class="lg-warn-${esc(w.kind)}">${w.verbatim ? `<span>Missing:</span> ${keep(w.text)}` : `<span>${esc(w.text)}</span>`}${w.detail ? ` ${keep(w.detail)}` : ""}</li>`;
  }
  function slot(s, readOnly = false) {
    const body = s.empty ? `<span class="lg-slot-empty">${readOnly ? "Empty" : "Empty: drop or click a name"}</span>` : `<strong data-no-translate>${esc(s.name)}</strong><small>${[s.class && CLASS[s.class] ? `<span>${CLASS[s.class]}</span>` : "", s.level ? `<span>Level</span> <span data-no-translate>${s.level}</span>` : "", s.yours ? `<span>Your character</span>` : ""].filter(Boolean).join(" · ")}</small>`;
    if (readOnly) return `<div class="lg-slot${s.empty ? " lg-empty" : ""}"><div class="lg-slot-main">${body}</div>${s.note ? `<p class="lg-slot-note" data-no-translate>${esc(s.note)}</p>` : ""}</div>`;
    return `<div class="lg-slot${s.empty ? " lg-empty" : ""}" data-lg-slot="${s.index}"><div class="lg-slot-row"><button type="button" class="lg-slot-main" data-lg="slot" data-slot="${s.index}" aria-label="${s.empty ? "Empty slot" : "Filled slot"}">${body}</button>${s.empty ? "" : `<button type="button" class="lg-slot-clear" data-lg="slot-clear" data-slot="${s.index}" aria-label="Take out of this slot" title="Take out of this slot">×</button>`}</div>
      ${s.warnings.length ? `<ul class="lg-warn">${s.warnings.map(warning).join("")}</ul>` : ""}
      <input type="text" class="lg-slot-input" data-lg-input="slotnote:${s.index}" maxlength="60" value="${esc(draft(`slotnote:${s.index}`, s.note))}" placeholder="${esc(T("Note for this slot"))}" aria-label="${esc(T("Note for this slot"))}"></div>`;
  }
  const columns = (p, readOnly) => `<div class="lg-columns">${ROLES.map((r) => `<div class="lg-col lg-col-${r}"><h3>${ROLE_PLURAL[r]}</h3>${p.slots.filter((s) => s.role === r).map((s) => slot(s, readOnly)).join("")}</div>`).join("")}</div>`;
  function plannerCard() {
    const p = S.plan;
    if (!p) return `<section class="ldg-card lg-planner" data-lg-planner><h2>Group planner</h2><p class="ldg-empty">Opening the planner…</p></section>`;
    if (p.empty) return `<section class="ldg-card lg-planner" data-lg-planner><h2>Group planner</h2><p class="ldg-empty">Choose a character first.</p></section>`;
    const places = p.places.map((x) => `<option value="${esc(x.id)}"${x.id === p.place ? " selected" : ""} data-keep>${esc(x.name)}</option>`).join("");
    const sizes = p.sizes.map((n) => `<option value="${n}"${n === p.size ? " selected" : ""} data-keep>${n}</option>`).join("");
    const events = p.events.length ? `<label class="ldg-pick"><span>Sign-ups of</span> <select data-lg-input="plan:event" aria-label="Use the sign-ups of a guild event"><option value="">No event</option>${p.events.map((e) => `<option value="${esc(e.key)}"${e.key === p.eventKey ? " selected" : ""} data-keep>${esc(e.title)}</option>`).join("")}</select></label>` : "";
    const lacking = p.missing.length ? `<p class="lg-lacking" data-lg-lacking><strong>Still open:</strong> ${p.missing.map((m) => `<span class="lg-need">${m.open} × <span>${ROLE[m.role]}</span></span>`).join(" ")}</p>` : `<p class="lg-good" data-lg-lacking>Every slot is filled.</p>`;
    const shared = p.shared ? `<div class="lg-shared" data-lg-shared><h3><span>Plan from your group's leader</span>${p.sharedBy ? ` ${keep(p.sharedBy)}` : ""}</h3>${columns(p.shared, true)}${p.shared.note ? `<p class="lg-slot-note" data-no-translate>${esc(p.shared.note)}</p>` : ""}</div>` : "";
    return `<section class="ldg-card lg-planner" data-lg-planner><div class="ldg-toolbar"><h2>Group planner</h2><div class="lg-tools"><label class="ldg-pick"><span>Dungeon</span> <select data-lg-input="plan:place" aria-label="Dungeon or raid">${places}</select></label><label class="ldg-pick"><span>Players</span> <select data-lg-input="plan:size" aria-label="Group size">${sizes}</select></label>${events}</div></div>
      ${store(PARTY_INTRO_KEY) === "done" ? "" : `<p class="lg-hint" data-lg-party-intro><strong>How it works:</strong> <span>drag a name into a slot, or click a name and then a slot. Add a short note per slot. The plan travels to the game at your next /reload.</span> <button type="button" class="subtle" data-lg="party-intro-done">Got it</button></p>`}
      ${columns(p, false)}${lacking}
      <div class="lg-bench" data-lg-bench><h3>Not placed yet</h3>${p.bench.length ? `<div class="lg-chips">${p.bench.map((m) => chip(m, { source: true })).join("")}</div>` : `<p class="lg-muted">${p.inGroup ? "Everybody at hand is placed." : "Nobody at hand yet. Names appear when you are in a group with the live link on, when you pick a guild event above, and for your own characters."}</p>`}</div>
      <label class="lg-field lg-wide"><span>Note for the whole group</span><input type="text" data-lg-input="plan:note" maxlength="120" value="${esc(draft("plan:note", p.note))}" placeholder="${esc(T("Meet at the stone at 19:45"))}"></label>
      <div class="lg-actions"><button type="button" data-lg="plan-auto"${busy("plan")}>Fill from roles</button><button type="button" data-lg="plan-clear"${busy("plan")}>Clear</button><button type="button" class="primary" data-lg="panel" data-tab="party">Open the panel</button></div>
      ${pendingLine(S.data?.pending || 0)}
      <p class="ldg-note ldg-after" data-lg-plan-honest><strong>How the plan travels.</strong> <span>It is saved on this computer and handed to your game at your next /reload. From there the game passes it to your group, and their panels show it within seconds if their live link is on. There is no faster way: a running game cannot be written to.</span> <span>In game, type</span> <code data-no-translate>/bf plan</code> <span>to read it.</span></p>
      <p class="ldg-note ldg-after"><strong>What the checks know.</strong> <span>Keys and attunements are checked for your own characters only. For other players the app knows their level and class, and what their game shared with the group.</span></p>
      ${shared}${noteLine("plan")}</section>`;
  }

  // ---------------------------------------------------------------- regulars
  function regularsCard() {
    const r = S.regulars;
    if (!r) return `<section class="ldg-card" data-lg-regulars><h2>People you have run with</h2><p class="ldg-empty">Opening your list…</p></section>`;
    const q = S.regularQuery.trim().toLowerCase();
    const rows = r.rows.filter((x) => !q || x.name.toLowerCase().includes(q) || x.note.toLowerCase().includes(q)).slice(0, 60);
    const table = rows.length ? `<div class="ldg-table-frame${rows.length > 12 ? " ldg-long" : ""}" tabindex="0"><table class="ldg-table lg-table-regulars"><caption class="sr-only">People you have run with</caption><thead><tr><th scope="col">Player</th><th scope="col" class="ldg-num">Runs together</th><th scope="col">Last run</th><th scope="col">Dungeons</th><th scope="col">Your note</th><th scope="col">Whisper</th></tr></thead><tbody>${rows.map((x) => `<tr data-lg-regular="${esc(x.name)}"><th scope="row">${keep(x.name)}<small class="ldg-cell-note">${x.class && CLASS[x.class] ? CLASS[x.class] : ""} ${keep(x.realm)}</small></th>
      <td class="ldg-num">${x.runs}</td><td>${x.lastRun ? esc(stamp(x.lastRun, "date")) : `<span class="lg-muted">Grouped, no run yet</span>`}</td>
      <td>${x.places.length ? x.places.slice(0, 4).map((p) => `<span class="lg-place">${keep(p.name)}${p.runs > 1 ? ` ×${p.runs}` : ""}</span>`).join("") : `<span class="lg-muted">—</span>`}</td>
      <td><input type="text" class="lg-note-input" data-lg-input="regnote:${esc(x.name)}|${esc(x.realm)}" maxlength="300" value="${esc(draft(`regnote:${x.name}|${x.realm}`, x.note))}" placeholder="${esc(T("Add a note"))}" aria-label="${esc(T("Your note"))}"></td>
      <td>${x.whisper ? copyButton(x.whisper, "Copy whisper") : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="ldg-empty" data-lg-regulars-empty>${r.total ? "Nobody matches." : "Nobody yet. A run is counted when you are in a dungeon or raid with a group while the live link is on, and for guild events you were at."}</p>`;
    return `<section class="ldg-card" data-lg-regulars><div class="ldg-toolbar"><h2>People you have run with</h2>${r.total > 8 ? `<label class="ldg-pick"><span>Find</span> <input type="search" class="lg-search" data-lg-input="regquery" maxlength="40" value="${esc(S.regularQuery)}" aria-label="${esc(T("Find a player or a note"))}"></label>` : ""}</div>${table}
      <p class="ldg-note ldg-after"><strong>On this computer only.</strong> <span>This list, your notes and the counts are never sent anywhere. “Copy whisper” puts the whisper command, a line like</span> <code data-no-translate>/w Name</code> <span>on your clipboard; you paste it into the game yourself.</span></p>${noteLine("regulars")}</section>`;
  }

  // ---------------------------------------------------------------- the realm party board
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }
  function listingRow(l, d) {
    const mineRealm = d.context?.realm || "";
    const whisper = `/w ${l.who.name}${mineRealm.toLowerCase() === l.who.realm.toLowerCase() ? "" : `-${l.who.realm.replace(/[\s']/g, "")}`} `;
    return `<tr data-lg-listing="${esc(l.id)}"><th scope="row">${keep(l.who.name)}<small class="ldg-cell-note">${l.class && CLASS[l.class] ? `<span>${CLASS[l.class]}</span> · ` : ""}<span>Level</span> ${l.level}</small></th>
      <td>${keep(l.placeName)}<small class="ldg-cell-note">${l.kind === "lfm" ? "More players for a group" : "A group to join"}${l.source === "game" ? ` · <span>heard in game</span>` : ""}</small></td>
      <td>${l.roles.map((r) => `<span class="lg-role-tag lg-role-${r}">${ROLE[r]}</span>`).join("")}${l.need ? `<small class="ldg-cell-note"><span>Needs:</span> ${ROLES.filter((r) => l.need[r] > 0).map((r) => `${l.need[r]} × <span>${ROLE[r]}</span>`).join(", ") || "—"}</small>` : ""}</td>
      <td>${l.note ? keep(l.note) : `<span class="lg-muted">—</span>`}</td><td>${copyButton(whisper, "Copy whisper")}</td></tr>`;
  }
  function listingForm(d, mine) {
    const c = d.context;
    const f = S.listing || (S.listing = mine ? { kind: mine.kind, place: mine.place, roles: [...mine.roles], note: mine.note, tank: mine.need?.tank ?? 0, healer: mine.need?.healer ?? 0, damage: mine.need?.damage ?? 0 } : { kind: "lfg", place: "sm", roles: [], note: "", tank: 1, healer: 1, damage: 0 });
    const places = d.places.map((p) => `<option value="${esc(p.id)}"${p.id === f.place ? " selected" : ""} data-keep>${esc(p.name)}</option>`).join("");
    return `<div class="lg-form" data-lg-listing-form>
      <fieldset class="lg-rank lg-wide"><legend>I am</legend><label><input type="radio" name="lg-kind" value="lfg" data-lg-input="ls:kind"${f.kind === "lfg" ? " checked" : ""}> <span>looking for a group</span></label><label><input type="radio" name="lg-kind" value="lfm" data-lg-input="ls:kind"${f.kind === "lfm" ? " checked" : ""}> <span>looking for more players</span></label></fieldset>
      <label class="lg-field"><span>Dungeon or raid</span><select data-lg-input="ls:place" aria-label="Dungeon or raid">${places}</select></label>
      <fieldset class="lg-rank"><legend>My role</legend>${ROLES.map((r) => `<label><input type="checkbox" value="${r}" data-lg-input="ls:role"${f.roles.includes(r) ? " checked" : ""}> <span>${ROLE[r]}</span></label>`).join("")}</fieldset>
      ${f.kind === "lfm" ? `<div class="lg-needs"><span class="lg-legend">Still needed</span>${ROLES.map((r) => `<label class="lg-field lg-count"><span>${ROLE_PLURAL[r]}</span><input type="number" min="0" max="40" data-lg-input="ls:${r}" value="${esc(f[r])}"></label>`).join("")}</div>` : ""}
      <label class="lg-field lg-wide"><span>Note (optional, 60 characters)</span><input type="text" data-lg-input="ls:note" maxlength="60" value="${esc(f.note)}" placeholder="${esc(T("Cathedral, have the key"))}"></label></div>
      <p class="lg-fine"><span>Posted as</span> ${keep(c?.name || "?")}<span>, level</span> ${c?.level ?? "?"}${c?.className ? `, <span>${esc(c.className)}</span>` : ""}<span>. These come from your saved character and cannot be typed.</span></p>`;
  }
  function boardCard() {
    const d = S.data;
    if (!d) return `<section class="ldg-card lg-board" data-lg-board><h2>Realm party board</h2><p class="ldg-empty">Opening the board…</p></section>`;
    const b = d.board, c = d.context;
    const where = b.where ? `${keep(b.where.realm)} · <span>${b.where.faction === "horde" ? "Horde" : "Alliance"}</span>` : "";
    if (!b.on) return `<section class="ldg-card lg-board" data-lg-board="off"><div class="ldg-toolbar"><h2>Realm party board</h2>${light("off", "Switched off")}</div>
      <p class="ldg-note">Find a group, or players for yours, among Backstage Forever users on your realm and faction. Listings appear live and last 30 minutes.</p>
      <div class="lg-consent-box"><p><strong>Before you switch it on.</strong> <span>${esc(W.GUILD.boardOn)}</span></p><p>${esc(W.GUILD.board)} <span>That only happens when you post a listing; you are asked again then.</span></p></div>
      ${c?.realm && c.faction ? "" : `<p class="lg-fix"><strong>Before you can start:</strong> <span>The app does not know this character's realm and faction yet. Log in with it in game and type /reload once.</span></p>`}
      <div class="lg-actions"><button type="button" class="primary" data-lg="board-on"${c?.realm && c.faction ? busy("board") : " disabled"}>I agree, switch the board on</button></div>${noteLine("board")}</section>`;
    const mine = b.mine, left = mine ? mine.expiresAt - Date.now() : 0;
    const filterPlaces = [...new Map(b.listings.map((l) => [l.place, l.placeName])).entries()];
    const shown = b.listings.filter((l) => (!S.boardFilter.place || l.place === S.boardFilter.place) && (!S.boardFilter.role || l.roles.includes(S.boardFilter.role) || (l.need && l.need[S.boardFilter.role] > 0)));
    const mineBlock = mine && !S.editing ? `<div class="lg-mine" data-lg-mine><div><strong>${mine.kind === "lfm" ? "Looking for more" : "Looking for a group"}</strong> · ${keep(mine.placeName)} · ${mine.roles.map((r) => `<span>${ROLE[r]}</span>`).join(", ")}${mine.note ? ` · ${keep(mine.note)}` : ""}</div>
        <div class="lg-countdown${left < 5 * 60 * 1000 ? " lg-soon" : ""}"><span>Shown for another</span> <strong data-lg-countdown="${mine.expiresAt}" data-no-translate>${countdown(left)}</strong></div>
        <div class="lg-actions"><button type="button" class="primary" data-lg="board-renew"${busy("board")}>Renew</button><button type="button" data-lg="board-edit">Edit</button><button type="button" data-lg="board-remove"${busy("board")}>Remove</button></div></div>`
      : `<details class="lg-manage" data-lg-details="post"${S.open.post || S.editing ? " open" : ""}><summary>${mine ? "Edit my listing" : "Post a listing"}</summary>${listingForm(d, mine)}
        ${S.postAsk ? `<div class="lg-consent-box" data-lg-post-consent><p><strong>Before your first listing.</strong> <span>${esc(W.GUILD.board)}</span></p><p>${esc(W.GUILD.boardHolds)}</p><div class="lg-actions"><button type="button" class="primary" data-lg="board-post" data-consent="yes"${busy("board")}>I agree, post it</button><button type="button" data-lg="board-post-cancel">Cancel</button></div></div>`
        : `<div class="lg-actions"><button type="button" class="primary" data-lg="board-post"${busy("board")}>${mine ? "Save changes" : "Post"}</button>${mine ? `<button type="button" data-lg="board-edit-cancel">Cancel</button>` : ""}</div>`}</details>`;
    const table = shown.length ? `<div class="ldg-table-frame${shown.length > 12 ? " ldg-long" : ""}" tabindex="0"><table class="ldg-table lg-table-board"><caption class="sr-only">Listings on your realm</caption><thead><tr><th scope="col">Player</th><th scope="col">Looking for</th><th scope="col">Role</th><th scope="col">Note</th><th scope="col">Whisper</th></tr></thead><tbody>${shown.map((l) => listingRow(l, d)).join("")}</tbody></table></div>`
      : `<p class="ldg-empty" data-lg-board-empty>${b.listings.length ? "No listing matches these filters." : b.error ? esc(b.error) : "No listings right now. Post one, or look again in a little while: new ones appear by themselves."}</p>`;
    return `<section class="ldg-card lg-board" data-lg-board="on"><div class="ldg-toolbar"><h2>Realm party board</h2><div class="lg-tools"><span class="lg-where">${where}</span>${liveStatus(d)}</div></div>
      ${mineBlock}
      <div class="lg-filters"><label class="ldg-pick"><span>Dungeon</span> <select data-lg-input="bf:place" aria-label="Show listings for"><option value="">All</option>${filterPlaces.map(([id, name]) => `<option value="${esc(id)}"${id === S.boardFilter.place ? " selected" : ""} data-keep>${esc(name)}</option>`).join("")}</select></label>
        <label class="ldg-pick"><span>Role</span> <select data-lg-input="bf:role" aria-label="Show listings with the role"><option value="">All</option>${ROLES.map((r) => `<option value="${r}"${r === S.boardFilter.role ? " selected" : ""}>${ROLE[r]}</option>`).join("")}</select></label>
        <span class="lg-count-line"><strong>${shown.length}</strong> <span>${shown.length === 1 ? "listing" : "listings"}</span></span></div>
      ${table}
      <div class="lg-actions lg-end"><button type="button" class="subtle" data-lg="board-off"${busy("board")}>Switch the board off</button></div>
      <p class="ldg-note ldg-after">Listings come in live. “Heard in game” ones came through your own game and are not passed on. In game the board is filled at your next /reload.</p>
      <p class="ldg-note ldg-after"><span>From the game:</span> <code data-no-translate>/bf lfg list DUNGEON</code> <span>posts a listing and</span> <code data-no-translate>/bf lfg list off</code> <span>removes it. The app passes it on only after you posted once from here and agreed.</span></p>${noteLine("board")}</section>`;
  }
  function partyHtml() {
    if (!api?.liveGuildState) return "";
    return `<div class="lg-root lg-party" data-lg-root="party">${plannerCard()}${boardCard()}${regularsCard()}</div>`;
  }

  // ---------------------------------------------------------------- Help → Guild & Party guide
  function guidePage() {
    const step = (n, title, body) => `<li><span class="lg-num">${n}</span><div><strong>${title}</strong><p>${body}</p></div></li>`;
    const row = (what, speed, kind) => `<tr><th scope="row">${what}</th><td class="lg-speed lg-speed-${kind}">${speed}</td></tr>`;
    return `<section class="eco-page lg-guide" data-lg-guide>${PageHero.render({ art: "plans", eyebrow: "Help · Guild & Party", title: "Guild & Party, step by step", subtitle: "Set it up, join, link Discord, and use the panel, the planner and the board.", compact: true })}<div data-eco-body>
      <p class="gld-honest"><strong>Good to know first.</strong> <span>All of this is optional. Nothing is shared until you join your guild in the app or switch the party board on, and you can leave at any time.</span> <button type="button" class="subtle" data-nav="guild">Open Plans → Guild</button> <button type="button" class="subtle" data-nav="party">Open Plans → Party</button></p>
      <section class="ldg-card" data-lg-guide-leader><h2>1 · Guild leaders and officers: connect your guild</h2>${flow(["Plans → Guild", "you"], ["Add to Discord"], ["One line in game"], ["Test post", "ok"])}
        <ol class="lg-guide-steps">${step(1, "Open Plans → Guild", "Pick a character of your guild at the top. Under “Connect our guild to Discord”, say whether you are the leader or an officer and press “I agree, start the setup”.")}
        ${step(2, "Add to Discord (optional)", "Press “Add to Discord”. Your browser opens Discord's own page: choose your server and authorise. The first light turns green by itself. No Discord? Skip this step; events and the panel work without it.")}
        ${step(3, "Type one line in game", "Copy the line that starts with <code data-no-translate>/bf guild link</code>, paste it into the game's chat box and press Enter. Your guild chat carries it to members' addons.")}
        ${step(4, "Send a test post", "Press “Send a test post” and look in your Discord channel. To post somewhere else, type <code data-no-translate>/backstage channel</code> in that channel.")}</ol>
        <p class="ldg-note ldg-after">If a light turns red, the fix is written right beside it. “Rotate code” makes a new link code; “Delete our guild's data” removes everything after you type the guild's name.</p></section>
      <section class="ldg-card" data-lg-guide-member><h2>2 · Members: join with one click</h2>${flow(["Leader types the line"], ["Your game hears it"], ["Invitation in the app", "you"], ["Join", "ok"])}
        <ol class="lg-guide-steps">${step(1, "Be online once", "When your leader types the link line while you are in game, your addon hears it. With the live link on the invitation appears within seconds; without it, after your next /reload.")}
        ${step(2, "Read the invitation", "It says exactly what is shared: your character's name and realm, your guild rank number and your answers to guild events. Never your account, files or chat.")}
        ${step(3, "Choose", "“Join” joins. “Not now” asks again next time. “Never for this guild” stops asking; you can take that back on Plans → Guild.")}</ol>
        <p class="ldg-note ldg-after">Missed it? Ask any officer to type the line again. To stop, use “Leave” on Plans → Guild: your name and answers are removed from the service.</p></section>
      <section class="ldg-card" data-lg-guide-discord><h2>3 · Link my Discord</h2>${flow(["/backstage link in Discord", "you"], ["Discord shows a code"], ["Paste it in the app"], ["Buttons answer as you", "ok"])}
        <ol class="lg-guide-steps">${step(1, "In Discord", "In your guild's server type <code data-no-translate>/backstage link</code>. Only you see the reply. It holds a short code.")}
        ${step(2, "In the app", "On Plans → Guild, under “Link my Discord”, paste the code and press the button. Your Discord name appears there.")}
        ${step(3, "Answer from Discord", "Under each event post are five buttons: Tank, Healer, Damage, Maybe, No. They now answer as your character. “Unlink” undoes it.")}</ol></section>
      <section class="ldg-card" data-lg-guide-panel><h2>4 · The Guild & Party panel</h2>${flow(["Open the panel", "you"], ["Events"], ["Party"], ["Board"])}
        <ol class="lg-guide-steps">${step(1, "Open it", "Press “Open the Guild & Party panel” on Plans → Guild or Plans → Party. It is a small window that stays on top of a windowed or borderless game, or sits on a second monitor.")}
        ${step(2, "Move and size it", "Drag the top bar to move it and an edge to resize it. It remembers where you put it. The gear sets how see-through it is and whether it hides while you fight.")}
        ${step(3, "Use the tabs", "Events: the next events, with one-click answers and live counts by role. Party: your group and the plan. Board: listings on your realm, with your own listing's countdown.")}</ol>
        <p class="ldg-note ldg-after">The panel never types or clicks in the game and never takes the keyboard away from it by itself. A full-screen (exclusive) game covers it; use windowed or borderless mode.</p></section>
      <section class="ldg-card" data-lg-guide-planner><h2>5 · The group planner</h2>${flow(["Pick the dungeon", "you"], ["Drag names into slots"], ["/reload"], ["Your group sees it", "ok"])}
        <ol class="lg-guide-steps">${step(1, "Pick the dungeon and size", "On Plans → Party choose where you are going. The planner makes the tank, healer and damage slots.")}
        ${step(2, "Place people", "Drag a name into a slot, or click the name and then the slot. “Fill from roles” places everyone who already named a role.")}
        ${step(3, "Read the marks", "A slot shows what the app really knows: a level under the dungeon's, a member who is offline, a key your own character still lacks.")}
        ${step(4, "Send it", "Type /reload in game. The game takes the plan and passes it to your group. Anyone can read it there with <code data-no-translate>/bf plan</code>.")}</ol></section>
      <section class="ldg-card" data-lg-guide-board><h2>6 · The realm party board</h2>${flow(["Switch it on", "you"], ["Post or browse"], ["30 minutes"], ["Renew or remove", "ok"])}
        <ol class="lg-guide-steps">${step(1, "Switch it on", "On Plans → Party, under “Realm party board”. Reading the board sends only your realm and faction.")}
        ${step(2, "Post", "Say whether you look for a group or for more players, pick the dungeon and your role. The first time, the app asks before it shows your character's name, level and role to others.")}
        ${step(3, "Keep it fresh", "A listing lasts 30 minutes and shows its countdown. “Renew” gives it another 30; “Remove” takes it down at once.")}
        ${step(4, "Get in touch", "“Copy whisper” puts the whisper command on your clipboard. Paste it into the game's chat box. In game, <code data-no-translate>/bf lfg list DUNGEON</code> posts a listing too, and <code data-no-translate>/bf lfg list off</code> removes it.")}</ol></section>
      <section class="ldg-card" data-lg-guide-table><h2>What is live, and what waits for /reload</h2>
        <div class="ldg-table-frame" tabindex="0"><table class="ldg-table lg-table-live"><caption class="sr-only">How fast each thing travels</caption><thead><tr><th scope="col">What travels</th><th scope="col">How fast</th></tr></thead><tbody>
        ${row("A guild member's answer in game → guildmates in game", "At once, over the game's guild channel", "now")}
        ${row("Your game → your desktop app and panel", "Seconds with the live link on. Without it only events and your own answers arrive, at your next /reload or logout", "sec")}
        ${row("Your app → the service → other members' apps and panels", "Seconds", "sec")}
        ${row("The service → your guild's Discord post", "Seconds", "sec")}
        ${row("A button pressed in Discord → members' apps and panels", "Seconds", "sec")}
        ${row("Party board listings → the app and the panel", "Seconds", "sec")}
        ${row("Anything from the app or from Discord → inside your running game", "Waits for your next /reload. A running game cannot be written to", "wait")}
        ${row("One member reloads → every guildmate in game", "At once after that reload: the game passes the news on", "now")}
        ${row("The group plan → your game", "Your next /reload", "wait")}
        ${row("The group plan → your group, in game and in their panels", "At once after your /reload, and seconds later in their panels", "now")}
        </tbody></table></div>
        <p class="ldg-note ldg-after">Until the game has it, the panel shows “updates will reach the game at your next /reload”, so you always know what the game does not know yet.</p></section>
      <section class="ldg-card" data-lg-guide-privacy><h2>What is shared, and with whom</h2><p>${esc(W.GUILD.text)}</p><ul class="lg-bullets">${W.GUILD.who.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p>${esc(W.GUILD.never)}</p><p>${esc(W.GUILD.planner)}</p>
        <div class="lg-actions"><button type="button" data-nav="privacy">See every field under Settings → Privacy &amp; sharing</button></div></section>
    </div></section>`;
  }

  // ---------------------------------------------------------------- Settings → Privacy & sharing
  function privacyHtml() {
    if (!W?.GUILD) return "";
    const d = S.data;
    const rows = (list) => `<dl class="desk-sent desk-sent-share">${list.map(([key, name, what]) => `<div><dt>${esc(name)}</dt><dd>${esc(what || "—")} <code data-no-translate>${esc(key)}</code></dd></div>`).join("")}</dl>`;
    const joined = d?.guilds?.length ? `<p class="desk-muted" data-lg-privacy-state><strong>Now:</strong> <span>joined</span> ${d.guilds.map((g) => `${keep(g.guildName)} (<span>with the character</span> ${keep(g.character.name)})`).join(", ")}. <button type="button" class="subtle" data-nav="guild">Leave on Plans → Guild</button></p>` : `<p class="desk-muted" data-lg-privacy-state><strong>Now:</strong> <span>you have not joined a guild in the app, so nothing of this is sent.</span></p>`;
    const board = d?.board?.on ? `<p class="desk-muted"><strong>Party board:</strong> <span>switched on.</span> ${d.board.mine ? `<span>Your listing is up.</span>` : `<span>You have no listing.</span>`} <button type="button" class="subtle" data-nav="party">Change on Plans → Party</button></p>` : `<p class="desk-muted"><strong>Party board:</strong> <span>switched off, so nothing is asked or sent.</span></p>`;
    return `<div class="desk-switch lg-privacy" data-lg-privacy><h3>${esc(W.GUILD.label)}</h3><p>${esc(W.GUILD.text)}</p>${joined}${board}
      <details class="lg-see" data-player-tool="lg-see"><summary>${esc(W.BUTTONS.see)}</summary>
        <p class="desk-muted"><strong>Who sees it.</strong> ${W.GUILD.who.map((x) => `<span>${esc(x)}</span>`).join(". ")}.</p>
        <h4>When you join a guild</h4>${rows(W.FIELDS.guildJoin)}
        <h4>Each answer to an event</h4>${rows(W.FIELDS.guildSignup)}
        <h4>With every guild request</h4>${rows(W.FIELDS.guildMember)}
        <h4>When a leader or officer connects the guild</h4>${rows(W.FIELDS.guildCreate)}
        <h4>A guild event (members whose rank allows it)</h4>${rows(W.FIELDS.guildEvent)}
        <h4>A party board listing</h4>${rows(W.FIELDS.board)}
        <h4>Reading the party board</h4>${rows(W.FIELDS.boardRead)}
        <h4>The live connection</h4>${rows(W.FIELDS.live)}
        <h4>How to leave and delete</h4><ul>${W.GUILD.leave.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p class="desk-muted">${esc(W.GUILD.never)} ${esc(W.GUILD.planner)}</p></details></div>`;
  }

  // ---------------------------------------------------------------- loading and painting
  function paint() {
    const active = document.activeElement;
    if (active?.matches?.("[data-lg-input]") && active.closest("[data-lg-root]") && !["radio", "checkbox"].includes(active.type) && active.tagName !== "SELECT") { S.dirty = true; return; }
    S.dirty = false;
    for (const root of document.querySelectorAll("[data-lg-root]")) {
      const kind = root.dataset.lgRoot, html = kind === "guild" ? guildHtml(root.dataset.lgProfile || null) : kind === "party" ? partyHtml() : null;
      if (html === null) continue;
      const box = document.createElement("div"); box.innerHTML = html;
      const next = box.firstElementChild;
      // Compared with what was drawn last (in English), not with the page, which may show another language.
      if (next && root.lgSource !== next.innerHTML) { const first = root.lgSource === undefined && root.innerHTML === next.innerHTML; root.lgSource = next.innerHTML; if (!first) root.innerHTML = next.innerHTML; }
    }
    // Plans → Guild shows the live events inside its own "Events ahead" card.
    if (document.querySelector("[data-guild-page]") && !document.activeElement?.matches?.("[data-guild-note], [data-guild-query], [data-lg-input]")) window.GuildView?.liveChanged?.();
    const priv = document.querySelector("[data-lg-privacy]");
    if (priv && !priv.querySelector("details")?.open) priv.outerHTML = privacyHtml();
    dock(); ticking();
  }
  /** A slim card at the top of any page when your guild invites you, so one click joins from anywhere. */
  function dock() {
    const el = document.getElementById("live-dock");
    if (!el) return;
    const offer = S.data?.offers?.[0];
    const show = offer && host.page() && host.page() !== "guild" && !document.querySelector("dialog[open]") && !S.dockHidden?.includes(offer.code);
    const html = show ? `<div class="lg-dock-card">${offerCard(offer, "dock")}<button type="button" class="lg-dock-close" data-lg="dock-hide" data-code="${esc(offer.code)}" aria-label="Hide this for now" title="Hide this for now">×</button></div>` : "";
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function ticking() {
    const need = Boolean(document.querySelector("[data-lg-countdown]"));
    if (need && !S.tick) S.tick = setInterval(() => {
      const nodes = document.querySelectorAll("[data-lg-countdown]");
      if (!nodes.length) { clearInterval(S.tick); S.tick = null; return; }
      for (const n of nodes) { const left = Number(n.dataset.lgCountdown) - Date.now(); n.textContent = countdown(left); if (left <= 0 && !S.loading) { void load(S.loadedFor ?? null, true); } }
    }, 1000);
  }
  async function load(profileId = null, force = false) {
    if (!api?.liveGuildState) return;
    // News that arrives while a read is under way is not dropped: one more read follows it.
    if (S.loading) { S.again = { profileId }; return; }
    if (!force && S.data && S.loadedFor === (profileId ?? null) && Date.now() - (S.loadedAt || 0) < 1500) return;
    S.loading = true;
    try { S.data = await api.liveGuildState(profileId); S.loadedFor = profileId ?? null; S.error = ""; }
    catch (e) { S.error = e?.message || "This page is unavailable."; }
    S.loading = false; S.loadedAt = Date.now();
    paint();
    if (S.again) { const next = S.again; S.again = null; void load(next.profileId, true); }
  }
  async function loadParty(force = false) {
    if (!api?.livePlan) return;
    const id = host.profileId?.() ?? null;
    if (!force && S.plan && S.planFor === id && Date.now() - (S.partyAt || 0) < 1500) return;
    if (S.partyLoading) { S.partyAgain = true; return; }
    S.partyLoading = true;
    try { [S.plan, S.regulars] = await Promise.all([api.livePlan({ action: "get", profileId: id, eventKey: S.eventKey }), api.liveRegulars(id)]); S.planFor = id; }
    catch { /* the cards say they are opening; the next change tries again */ }
    S.partyLoading = false; S.partyAt = Date.now();
    paint();
    if (S.partyAgain) { S.partyAgain = false; void loadParty(true); }
  }
  /** Called after every render of the app and of the Guild page. */
  function mounted() {
    if (!api?.liveGuildState) return;
    const guild = document.querySelector('[data-lg-root="guild"]'), party = document.querySelector('[data-lg-root="party"]');
    if (guild) { const id = guild.dataset.lgProfile || null; if (S.loadedFor !== id || !S.data) void load(id); }
    if (party) {
      const id = host.profileId?.() ?? null;
      if (!S.data || S.loadedFor !== id) void load(id);
      if (!S.plan || S.planFor !== id) void loadParty();
      if (S.data?.board?.on && Date.now() - (S.watchedAt || 0) > 60000) { S.watchedAt = Date.now(); api.liveBoard({ action: "watch", profileId: id }).then((r) => { S.data = r.state; S.loadedFor = id; paint(); }).catch(() => {}); }
    } else if (S.watchedAt) { S.watchedAt = 0; api.liveBoard?.({ action: "unwatch" }).catch(() => {}); }
    if (document.querySelector("[data-lg-privacy]") && !S.data) void load(host.profileId?.() ?? null);
    if (S.focus) { const el = document.querySelector(`[data-lg-input="${CSS.escape(S.focus.key)}"]`); if (el && document.activeElement !== el && !document.activeElement?.matches?.("input, textarea, select")) { el.focus({ preventScroll: true }); try { el.setSelectionRange(S.focus.start, S.focus.end); } catch {} } }
    dock(); ticking();
  }
  const fail = (key, e) => { say(key, e?.message || "That did not work. Try again.", true); };
  async function run(key, noteKey, fn, ok = "") {
    if (S.busy) return;
    S.busy = key; say(noteKey, ""); paint();
    try { const r = await fn(); say(noteKey, typeof ok === "function" ? ok(r) : ok); }
    catch (e) { fail(noteKey, e); }
    // The picture is read again for the character this page shows, whatever the action answered with.
    try { S.data = await api.liveGuildState(S.loadedFor ?? null); S.loadedAt = Date.now(); } catch {}
    S.busy = ""; paint();
  }
  const planCall = async (change, key = "plan") => {
    try { S.plan = await api.livePlan({ profileId: host.profileId?.() ?? null, eventKey: S.eventKey, ...change }); say("plan", ""); }
    catch (e) { fail(key, e); }
    paint();
  };

  // ---------------------------------------------------------------- what the player does
  async function click(t) {
    const b = t.closest("[data-lg]");
    if (!b || b.disabled) return;
    const a = b.dataset.lg, guild = b.dataset.guild, id = host.profileId?.() ?? null, pid = S.loadedFor ?? id;
    if (a === "intro-done") { store(INTRO_KEY, "done"); paint(); return; }
    if (a === "party-intro-done") { store(PARTY_INTRO_KEY, "done"); paint(); return; }
    if (a === "dock-hide") { S.dockHidden = [...(S.dockHidden || []), b.dataset.code]; dock(); return; }
    if (a === "copy") { try { await api.liveCopy(b.dataset.text); const old = b.textContent; b.textContent = "Copied"; b.classList.add("lg-copied"); setTimeout(() => { if (b.isConnected) { b.textContent = old; b.classList.remove("lg-copied"); } }, 1600); } catch { b.textContent = "Could not copy"; } return; }
    if (a === "panel") { try { await api.livePanel({ action: "open", tab: b.dataset.tab || "events" }); } catch (e) { fail("member", e); paint(); } return; }
    if (a === "join") return run(`offer:${b.dataset.code}`, "member", () => api.liveGuildJoin({ code: b.dataset.code, consent: true }), "You joined. Events and sign-ups now arrive live.");
    if (a === "decline" || a === "never") return run(`offer:${b.dataset.code}`, "member", () => api.liveGuildDecline({ code: b.dataset.code, never: a === "never" }));
    if (a === "allow") return run("allow", "member", () => api.liveGuildAllow(b.dataset.key));
    if (a === "create") return run("create", "create", () => api.liveGuildCreate({ profileId: pid, rankIndex: Number(draft("rank", "0")) === 1 ? 1 : 0, consent: true }));
    if (a === "refresh") return run("refresh", "member", () => api.liveGuildRefresh(pid), "Up to date.");
    if (a === "rotate") return run("rotate", "manage", () => api.liveGuildRotate(guild), "New code made. Type the new line in game for members who have not joined yet.");
    if (a === "remove-member") return run("manage", "manage", () => api.liveGuildRemoveMember({ guildId: guild, name: b.dataset.name }), "Removed.");
    if (a === "leave-ask") { S.confirm = `leave:${guild}`; paint(); return; }
    if (a === "leave-cancel" || a === "delete-cancel") { S.confirm = null; paint(); return; }
    if (a === "leave-confirm") { S.confirm = null; return run("leave", "leave", () => api.liveGuildLeave(guild), "You left. Your name and answers were removed from the service."); }
    if (a === "delete-ask") { S.confirm = `delete:${guild}`; S.open.manage = true; paint(); document.querySelector(`[data-lg-input="delete:${CSS.escape(guild)}"]`)?.focus(); return; }
    if (a === "delete-confirm") return run("delete", "manage", async () => { const r = await api.liveGuildDelete({ guildId: guild, typed: draft(`delete:${guild}`) }); S.confirm = null; delete S.drafts[`delete:${guild}`]; return r; }, "Deleted. The service holds nothing about this guild any more.");
    if (a === "discord") {
      const action = b.dataset.action, noteKey = action === "test" ? "test" : ["link", "unlink"].includes(action) ? "me" : "discord";
      return run(action === "test" ? "test" : ["link", "unlink"].includes(action) ? "me" : "discord", noteKey, async () => { const r = await api.liveDiscord({ action, guildId: guild, ...(action === "link" ? { code: draft("discord-code").trim() } : {}) }); if (action === "link") delete S.drafts["discord-code"]; return r; },
        action === "start" ? "Discord's page is open in your browser." : action === "test" ? "Sent. Look in your Discord channel." : action === "link" ? "Linked." : action === "unlink" ? "Unlinked." : action === "disconnect" ? "Disconnected." : "");
    }
    if (a === "answer") return run(`answer:${b.dataset.event}`, "member", () => api.liveEvent({ action: "answer", guildId: guild, eventId: b.dataset.event, answer: b.dataset.answer }));
    if (a === "cancel-event") return run("propose", "member", () => api.liveEvent({ action: "cancel", guildId: guild, eventId: b.dataset.event }), "Called off.");
    if (a === "propose") {
      const f = S.form, at = f?.date && f.time ? new Date(`${f.date}T${f.time}`) : null;
      if (!at || !Number.isFinite(at.getTime())) { say("propose", "Pick the day and the time first.", true); paint(); return; }
      return run("propose", "propose", async () => { const r = await api.liveEvent({ action: "save", guildId: guild, event: { title: f.title, place: f.place, at: at.toISOString(), note: f.note, roles: { tank: Number(f.tank) || 0, healer: Number(f.healer) || 0, damage: Number(f.damage) || 0 } } }); S.form = null; return r; },
        (r) => (r?.queued ? "Saved. It is sent as soon as the service can be reached." : "Proposed. Your guild sees it now."));
    }
    if (a === "pick") { const m = { name: b.dataset.name, realm: b.dataset.realm }; S.pick = S.pick && S.pick.name === m.name && S.pick.realm === m.realm ? null : m; paint(); return; }
    if (a === "slot") {
      const index = Number(b.dataset.slot), s = S.plan?.slots?.[index];
      if (S.pick) { const member = S.pick; S.pick = null; return planCall({ action: "assign", slot: index, member }); }
      if (s && !s.empty) { S.pick = { name: s.name, realm: s.realm }; paint(); }
      return;
    }
    if (a === "slot-clear") return planCall({ action: "assign", slot: Number(b.dataset.slot), member: null });
    if (a === "plan-auto") return planCall({ action: "auto" });
    if (a === "plan-clear") { for (const k of Object.keys(S.drafts)) if (k.startsWith("slotnote:") || k === "plan:note") delete S.drafts[k]; return planCall({ action: "clear" }); }
    if (a === "board-on") return run("board", "board", () => api.liveBoard({ action: "on", profileId: id, consent: true }));
    if (a === "board-off") { S.listing = null; S.editing = false; return run("board", "board", () => api.liveBoard({ action: "off", profileId: id }), "Switched off. Your listing was removed."); }
    if (a === "board-edit") { S.editing = true; S.listing = null; paint(); return; }
    if (a === "board-edit-cancel") { S.editing = false; S.listing = null; S.postAsk = false; paint(); return; }
    if (a === "board-post-cancel") { S.postAsk = false; paint(); return; }
    if (a === "board-renew") return run("board", "board", () => api.liveBoard({ action: "renew", profileId: id }), "Renewed for another 30 minutes.");
    if (a === "board-remove") { S.listing = null; return run("board", "board", () => api.liveBoard({ action: "remove", profileId: id }), "Removed."); }
    if (a === "board-post") {
      const f = S.listing;
      if (!f || !f.roles.length) { say("board", "Tick at least one role first.", true); paint(); return; }
      if (!S.data?.board?.postConsent && b.dataset.consent !== "yes") { S.postAsk = true; S.open.post = true; paint(); return; }
      return run("board", "board", async () => {
        const r = await api.liveBoard({ action: "post", profileId: id, consent: true, listing: { kind: f.kind, roles: f.roles, place: f.place, note: f.note, need: f.kind === "lfm" ? { tank: Number(f.tank) || 0, healer: Number(f.healer) || 0, damage: Number(f.damage) || 0 } : null } });
        S.postAsk = false; S.editing = false; S.listing = null; S.open.post = false; return r;
      }, "Posted. It is shown for 30 minutes.");
    }
  }
  function input(t, committed) {
    const key = t.dataset.lgInput;
    if (!key) return;
    const v = t.type === "checkbox" ? t.checked : t.value;
    if (key === "rank") { S.drafts.rank = t.value; return; }
    if (key.startsWith("ev:")) { (S.form ||= {})[key.slice(3)] = t.value; return; }
    if (key.startsWith("ls:")) {
      const f = S.listing; if (!f) return;
      const k = key.slice(3);
      if (k === "role") { f.roles = ROLES.filter((r) => (r === t.value ? t.checked : f.roles.includes(r))); return; }
      f[k] = t.value;
      if (k === "kind") paint();
      return;
    }
    if (key.startsWith("bf:")) { S.boardFilter[key.slice(3)] = t.value; paint(); return; }
    if (key === "regquery") {
      // Only the table under the search box is redrawn, so typing is never interrupted.
      S.regularQuery = t.value;
      const card = t.closest("[data-lg-regulars]"), frame = card?.querySelector(".ldg-table-frame, [data-lg-regulars-empty]");
      if (frame) { const box = document.createElement("div"); box.innerHTML = regularsCard(); const next = box.querySelector(".ldg-table-frame, [data-lg-regulars-empty]"); if (next) frame.replaceWith(next); }
      return;
    }
    if (key === "plan:place" || key === "plan:size") { void planCall({ action: "shape", ...(key === "plan:place" ? { place: t.value } : { size: Number(t.value) }) }); return; }
    if (key === "plan:event") { S.eventKey = t.value || null; void loadParty(true); return; }
    S.drafts[key] = v;
    if (!committed) return;
    if (key.startsWith("slotnote:")) { const slot = Number(key.slice(9)); delete S.drafts[key]; void planCall({ action: "note", slot, note: String(v) }); }
    else if (key === "plan:note") { delete S.drafts[key]; void planCall({ action: "planNote", note: String(v) }); }
    else if (key.startsWith("regnote:")) {
      const [name, realm] = key.slice(8).split("|");
      api.liveRegularNote({ name, realm, note: String(v) }).then((r) => { S.regulars = r; delete S.drafts[key]; say("regulars", "Note saved on this computer."); paint(); }).catch((e) => { fail("regulars", e); paint(); });
    }
  }
  function init(value) {
    host = { ...host, ...value };
    if (!api?.liveGuildState) return;
    document.addEventListener("click", (e) => { if (e.target.closest?.("[data-lg]")) void click(e.target); });
    document.addEventListener("input", (e) => { if (e.target.matches?.("[data-lg-input]")) input(e.target, false); });
    document.addEventListener("change", (e) => { if (e.target.matches?.("[data-lg-input]")) input(e.target, true); });
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("input[data-lg-input]")) e.target.blur(); });
    document.addEventListener("focusin", (e) => { const k = e.target?.dataset?.lgInput; S.focus = k && e.target.matches("input[type=text], input[type=search]") ? { key: k, start: e.target.selectionStart, end: e.target.selectionEnd } : null; });
    document.addEventListener("focusout", (e) => { if (e.target.matches?.("[data-lg-input]")) { S.focus = null; if (S.dirty) setTimeout(paint, 0); } });
    document.addEventListener("toggle", (e) => { const k = e.target?.dataset?.lgDetails; if (k) S.open[k] = e.target.open; }, true);
    // Drag a name into a slot.
    document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".lg-chip"); if (!c) return; e.dataTransfer.setData("text/plain", JSON.stringify({ name: c.dataset.name, realm: c.dataset.realm })); e.dataTransfer.effectAllowed = "move"; });
    document.addEventListener("dragover", (e) => { const s = e.target.closest?.("[data-lg-slot]"); if (s) { e.preventDefault(); s.classList.add("lg-over"); } });
    document.addEventListener("dragleave", (e) => { e.target.closest?.("[data-lg-slot]")?.classList.remove("lg-over"); });
    document.addEventListener("drop", (e) => {
      const s = e.target.closest?.("[data-lg-slot]"); if (!s) return;
      e.preventDefault(); s.classList.remove("lg-over");
      let m = null; try { m = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
      if (m && typeof m.name === "string" && typeof m.realm === "string") { S.pick = null; void planCall({ action: "assign", slot: Number(s.dataset.lgSlot), member: { name: m.name, realm: m.realm } }); }
    });
    api.onLiveGuild?.(() => {
      const guild = document.querySelector('[data-lg-root="guild"]');
      void load(guild ? guild.dataset.lgProfile || null : S.loadedFor ?? host.profileId?.() ?? null, true);
      if (document.querySelector('[data-lg-root="party"]')) void loadParty(true);
    });
    // Invitations are looked for once at start, so the card can show on any page.
    setTimeout(() => { if (!S.data) void load(host.profileId?.() ?? null); }, 2500);
  }
  return { init, mounted, guildHtml, partyHtml, guidePage, privacyHtml, eventsFor, answerRow, reload: load,
    _state: () => S, _test: { offerCard, setupCard, memberCard, plannerCard, boardCard, regularsCard, countdown } };
})();
