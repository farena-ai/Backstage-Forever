"use strict";
// Plans → Guild. A read-only view of what the addon saved: guild events with sign-ups, the guild
// members who run the addon and chose to share, who can make what, and past events with
// attendance and the run that belonged to them. The only things kept by this page are the notes
// you write about members (on this computer) and a calendar file you choose to save.
window.GuildView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const CLASS = { WARRIOR: "Warrior", PALADIN: "Paladin", HUNTER: "Hunter", ROGUE: "Rogue", PRIEST: "Priest", SHAMAN: "Shaman", MAGE: "Mage", WARLOCK: "Warlock", DRUID: "Druid" };
  const GROUPS = [["t", "Tanks"], ["h", "Healers"], ["d", "Damage"], ["m", "Maybe"], ["n", "Not coming"]];
  const MINE = { t: "You signed up as tank.", h: "You signed up as healer.", d: "You signed up as damage.", m: "You answered maybe.", n: "You answered no." };
  const state = { data: null, error: "", loading: false, loadedAt: 0, profileId: null, query: "", msg: "", busy: false, pastShown: 6 };
  let mountedFor = null;
  const num = ' class="ldg-num"';
  const keep = (v) => `<span data-no-translate>${esc(v)}</span>`;
  const stamp = (v, kind) => (window.I18n?.when ? window.I18n.when(v, kind) : new Date(v).toLocaleString());
  const when = (at) => stamp(at * 1000, "weekday");
  const dateOf = (at) => stamp(at * 1000, "date");
  const two = (n) => String(n).padStart(2, "0");
  // The realm's clock for a moment, from how far the realm clock was ahead of UTC at the last save.
  const realmTime = (at, offset) => { const d = new Date((at + offset * 60) * 1000); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
  function span(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h ? `${h}h ${two(m)}m` : `${m}m ${two(s)}s`;
  }
  function ago(at, now) {
    const s = Math.max(0, now - at);
    if (s < 3600) return "Under an hour ago";
    if (s < 7200) return "1 hour ago";
    if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
    if (s < 2 * 86400) return "1 day ago";
    return `${Math.floor(s / 86400)} days ago`;
  }
  function table(id, label, columns, content, count = 0) {
    return `<div class="ldg-table-frame${count > 12 ? " ldg-long" : ""}" tabindex="0"><table class="ldg-table gld-table-${id}"><caption class="sr-only">${label}</caption><thead><tr>${columns.map(([text, numeric]) => `<th scope="col"${numeric ? num : ""}>${text}</th>`).join("")}</tr></thead>${content}</table></div>`;
  }
  const timeLine = (at, d) => `<span class="gld-when"><strong>${esc(when(at))}</strong> <span>your computer's time</span>${d.realmOffset === null ? "" : ` · <span>realm time</span> <strong>${esc(realmTime(at, d.realmOffset))}</strong>`}</span>`;

  function roleRows(e, past) {
    return GROUPS.map(([key, label]) => {
      const names = e.signups[key], wanted = e.roles[key];
      if (!names.length && wanted === undefined && past) return "";
      return `<div class="gld-role gld-role-${key}"><dt><span>${label}</span> <strong>${wanted === undefined ? names.length : `${names.length} of ${wanted}`}</strong></dt><dd>${names.length ? names.map((n) => `<span class="gld-name${n.toLowerCase() === String(state.data.me).toLowerCase() ? " gld-me" : ""}" data-no-translate>${esc(n)}</span>`).join("") : `<span class="gld-none">Nobody yet</span>`}</dd></div>`;
    }).join("");
  }
  function upcomingCard(d) {
    const picker = d.characters.length > 1 ? `<label class="ldg-pick ldg-inline">Character <select data-guild-character aria-label="Guild page of">${d.characters.map((c) => `<option value="${esc(c.profileId)}"${c.profileId === d.profileId ? " selected" : ""} data-keep>${esc(c.name)}${c.guild ? ` · ${esc(c.guild)}` : ""}</option>`).join("")}</select></label>` : "";
    const tools = `<div class="gld-tools">${picker}<button type="button" data-guild-export${d.upcoming.length && !state.busy ? "" : " disabled"}>Save events as a calendar file</button></div>`;
    if (!d.upcoming.length) return `<section class="ldg-card" data-guild-upcoming><div class="ldg-toolbar"><h2>Events ahead</h2>${tools}</div><p class="ldg-empty">No guild events ahead. Propose one in game with <code>/bf event add</code></p><p class="eco-msg" role="status" data-guild-msg>${esc(state.msg)}</p></section>`;
    const items = d.upcoming.map((e) => `<article class="gld-event" data-guild-event="${esc(e.id)}"><header><h3 data-no-translate>${esc(e.title)}</h3><p class="gld-meta">${timeLine(e.at, d)}</p>
        <p class="gld-meta"><strong data-no-translate>${esc(e.place)}</strong> · <span>proposed by</span> ${keep(e.creator)}${e.editor ? ` · <span>changed by</span> ${keep(e.editor)}` : ""}${e.relayed ? ` · <span class="gld-flag">Passed on by another member, not yet confirmed by its creator</span>` : ""}</p>
        ${e.note ? `<p class="gld-note" data-no-translate>${esc(e.note)}</p>` : ""}</header>
      <dl class="gld-roles">${roleRows(e, false)}</dl>
      <p class="gld-mine${e.mine ? " gld-answered" : ""}" data-guild-mine>${e.mine ? MINE[e.mine] : "You have not answered yet."}</p></article>`).join("");
    return `<section class="ldg-card" data-guild-upcoming><div class="ldg-toolbar"><h2>Events ahead</h2>${tools}</div><div class="gld-events">${items}</div>
      <p class="ldg-note ldg-after">You answer in game. This page shows the answers your addon had when the game last saved.</p><p class="eco-msg" role="status" data-guild-msg>${esc(state.msg)}</p></section>`;
  }
  function rosterCard(d) {
    if (!d.roster.length) return `<section class="ldg-card" data-guild-roster><h2>Members who share</h2><p class="ldg-empty">No guild member has shared with this character yet. Members appear here once they share and your game has saved. Switch guild sharing on in game with <code>/bf guild on</code></p></section>`;
    const rows = d.roster.map((m) => `<tr data-guild-member="${esc(m.name)}"><th scope="row">${keep(m.name)}<small class="ldg-cell-note">${m.classFile && CLASS[m.classFile] ? CLASS[m.classFile] : `<span class="gld-none">Class not known</span>`}</small></th>
      <td${num}>${m.level ?? "—"}</td>
      <td>${m.zone ? keep(m.zone) : `<span class="gld-none">—</span>`}${m.lookingFor ? `<small class="ldg-cell-note"><span>Looking for</span> ${keep(m.lookingFor)}</small>` : ""}</td>
      <td>${m.professions.length ? m.professions.map((p) => `<span class="gld-prof">${keep(p.name)} <strong>${p.skill}</strong></span>`).join("") : `<span class="gld-none">None shared</span>`}</td>
      <td>${esc(ago(m.seenAt, d.now))}<small class="ldg-cell-note">${esc(dateOf(m.seenAt))}</small></td>
      <td>${m.attendance ? `<strong>${m.attendance.came} of ${m.attendance.events}</strong>` : `<span class="gld-none">—</span>`}</td>
      <td><input type="text" class="gld-note-input" maxlength="300" value="${esc(m.note)}" data-guild-note="${esc(m.name)}" aria-label="Your note about ${esc(m.name)}" placeholder="Add a note"></td></tr>`).join("");
    return `<section class="ldg-card" data-guild-roster><h2>Members who share</h2>${table("roster", "Members who share", [["Member"], ["Level", true], ["Where"], ["Professions"], ["Last heard"], ["Came"], ["Your note"]], `<tbody>${rows}</tbody>`, d.roster.length)}
      <p class="ldg-note ldg-after">Level, zone and professions are what each member last shared. “Came” counts guild events this character was at. Notes stay on this computer.</p><p class="eco-msg" role="status" data-guild-note-msg></p></section>`;
  }
  function craftRows(d) {
    const q = state.query.trim().toLowerCase();
    if (q.length < 2) return `<p class="ldg-empty" data-guild-craft-hint>Type at least two letters: a profession, a recipe or a name.</p>`;
    const found = d.crafts.filter((c) => c.name.toLowerCase().includes(q) || c.who.toLowerCase().includes(q));
    if (!found.length) return `<p class="ldg-empty" data-guild-craft-none>Nothing known matches. Ask your guild in game with <code>/bf guild craft NAME</code></p>`;
    const rows = found.slice(0, 60).map((c) => `<tr data-guild-craft-row><th scope="row">${keep(c.name)}</th><td>${c.kind === "profession" ? `<span>Profession</span> · <span>skill</span> <strong>${c.skill}</strong>` : `<span>Recipe</span>`}</td><td>${keep(c.who)}${c.yours ? `<small class="ldg-cell-note">Your character</small>` : ""}</td></tr>`).join("");
    return `${table("crafts", "Who can make it", [["What"], ["Kind"], ["Who"]], `<tbody>${rows}</tbody>`, Math.min(found.length, 60))}${found.length > 60 ? `<p class="ldg-note ldg-after">Showing the first 60 matches. Type more letters to narrow it down.</p>` : ""}`;
  }
  function craftCard(d) {
    return `<section class="ldg-card" data-guild-craft><div class="ldg-toolbar"><h2>Who can make it</h2><label class="ldg-pick">Find <input type="search" class="gld-search" maxlength="48" value="${esc(state.query)}" data-guild-query aria-label="Find a profession, recipe or member" placeholder="Ghost Dye, Tailoring…"></label></div>
      <div data-guild-craft-results>${craftRows(d)}</div>
      <p class="ldg-note ldg-after">Professions and skill are what members share. A member's recipes are known only from answers to questions you asked in game. Your own characters' saved recipes are listed too.</p></section>`;
  }
  function attendanceLine(e) {
    const a = e.attendance;
    if (!a.known) return `<p class="gld-meta"><strong>${a.signedYes}</strong> <span>said yes.</span> <span>This character was not in the run, so who came is not known.</span></p>`;
    return `<p class="gld-meta"><strong>${a.signedYes}</strong> <span>said yes,</span> <strong>${a.came}</strong> <span>were in your group.</span></p>
      ${a.missed.length ? `<p class="gld-meta"><span>Said yes but not seen:</span> ${a.missed.map(keep).join(", ")}</p>` : ""}
      ${a.unannounced.length ? `<p class="gld-meta"><span>In your group without a yes:</span> ${a.unannounced.map(keep).join(", ")}</p>` : ""}`;
  }
  function runLine(e) {
    if (!e.canMatch) return `<p class="gld-meta gld-none">This event names no dungeon or raid from the list, so no run can be matched to it.</p>`;
    if (!e.run) return `<p class="gld-meta gld-none">No saved run of this character fits: the same place, from 30 minutes before the event to 4 hours after it began.</p>`;
    const r = e.run;
    const loot = r.loot === null ? `<span class="gld-none">not recorded</span>` : r.loot.length ? r.loot.map((l) => `<span class="ldg-name q-${QUALITY[l.quality] || "common"}" data-card-item="${l.itemId}" data-no-translate>${esc(l.name)}</span>${l.count > 1 ? ` ×${l.count}` : ""}`).join(", ") : `<span class="gld-none">none</span>`;
    return `<p class="gld-meta"><span>Your run:</span> <strong>${r.seconds === null ? "not timed" : esc(span(r.seconds))}</strong> · <strong>${r.bosses.length}${r.knownBosses ? ` of ${r.knownBosses}` : ""}</strong> <span>bosses</span>${r.deaths === null ? "" : ` · <strong>${r.deaths}</strong> <span>deaths of yours</span>`}</p>
      ${r.bosses.length ? `<p class="gld-meta gld-bosses" data-no-translate>${r.bosses.map((b) => esc(b.name)).join(", ")}</p>` : ""}
      <p class="gld-meta"><span>Your loot:</span> ${loot}</p>`;
  }
  function pastCard(d) {
    if (!d.past.length) return `<section class="ldg-card" data-guild-past><h2>Past events</h2><p class="ldg-empty">No finished guild event yet. An event moves here four hours after it began.</p></section>`;
    const shown = d.past.slice(0, state.pastShown);
    const items = shown.map((e) => `<article class="gld-event gld-past" data-guild-past-event="${esc(e.id)}"><header><h3 data-no-translate>${esc(e.title)}</h3><p class="gld-meta"><strong>${esc(when(e.at))}</strong> · <strong data-no-translate>${esc(e.place)}</strong> · <span>proposed by</span> ${keep(e.creator)}</p></header>
      ${attendanceLine(e)}${runLine(e)}
      ${e.guildLoot.length ? `<p class="gld-meta"><span>Won in the run (your loot notes):</span> ${e.guildLoot.map((l) => `${keep(l.who)}: <span class="ldg-name q-${QUALITY[l.quality] || "common"}" data-card-item="${l.itemId}" data-no-translate>${esc(l.name)}</span>`).join(", ")}</p>` : ""}
      <details class="gld-answers"><summary>Who answered what</summary><dl class="gld-roles">${roleRows(e, true)}</dl></details></article>`).join("");
    return `<section class="ldg-card" data-guild-past><h2>Past events</h2><div class="gld-events">${items}</div>${d.past.length > shown.length ? `<p><button type="button" data-guild-more>Show ${Math.min(10, d.past.length - shown.length)} more</button></p>` : ""}
      <p class="ldg-note ldg-after">A run belongs to an event when it is in the same dungeon or raid and overlaps the time from 30 minutes before the event to 4 hours after it began. Who was there is your own group as your addon saw it. Other players' loot is noted only when you switched on guild-run loot notes in game: the item and the winner's name, on this computer only.</p></section>`;
  }
  function body() {
    const s = state;
    if (s.error) return `<p class="ldg-empty">${esc(s.error)}</p>`;
    if (!s.data) return `<p class="ldg-empty">${s.loading ? "Opening your guild page…" : "Your guild page is loading."}</p>`;
    const d = s.data;
    const honest = `<p class="gld-honest" data-guild-honest><strong>What this page can know.</strong> <span>It lists only guild members who run Backstage Forever and chose to share. Events and sign-ups travel between those members inside the game's guild channel; this page reads them from your game's saved file. Nothing is sent to any server.</span></p>`;
    if (d.empty) return `${honest}<section class="ldg-card"><h2>Nothing saved yet</h2><p class="ldg-empty">No character has guild data in the saved file yet. Guild sharing and guild events are both off until you switch them on in game: <code>/bf guild on</code> <code>/bf event on</code></p></section>`;
    return `${honest}<div class="ldg-summary gld-summary"><div><strong data-no-translate>${esc(d.guild || d.character)}</strong><span>${d.guild ? `<span>guild of</span> ${keep(d.character)}` : "guild name not saved"}</span></div><div><strong>${d.totals.members}</strong><span>members sharing</span></div><div><strong>${d.totals.upcoming}</strong><span>events ahead</span></div><div><strong>${esc(dateOf(d.savedAt))}</strong><span>last saved by the game</span></div></div>
      ${d.on ? "" : `<p class="ldg-empty" data-guild-off>Guild events are switched off on this character, so nothing new arrives. Switch them on in game with <code>/bf event on</code></p>`}
      ${upcomingCard(d)}${rosterCard(d)}${craftCard(d)}${pastCard(d)}`;
  }
  function page() {
    return `<section class="eco-page gld-page" data-guild-page>${PageHero.render({ art: "plans", eyebrow: "Plans · Guild", title: "Guild", subtitle: "Events with sign-ups, who shares, who can make what, and who came.", compact: true })}<div data-eco-body>${body()}</div></section>`;
  }
  function repaint() {
    const root = document.querySelector("[data-guild-page]");
    if (!root) return;
    root.outerHTML = page();
    mountedFor = null; mounted();
  }
  async function load() {
    const s = state;
    if (s.loading) return;
    s.loading = true;
    try { s.data = await api.guildPage(s.profileId); s.error = ""; }
    catch (e) { s.error = e.message || "This page is unavailable."; }
    s.loading = false; s.loadedAt = Date.now();
    // A note being typed is not thrown away by a refresh.
    if (document.querySelector("[data-guild-page]") && !document.activeElement?.matches?.("[data-guild-note], [data-guild-query]")) repaint();
  }
  function mounted() {
    const root = document.querySelector("[data-guild-page]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    const s = state;
    root.querySelector("[data-guild-character]")?.addEventListener("change", (e) => { s.profileId = e.target.value; s.loadedAt = 0; s.query = ""; s.msg = ""; s.pastShown = 6; load(); });
    root.querySelector("[data-guild-query]")?.addEventListener("input", (e) => {
      s.query = e.target.value;
      const box = root.querySelector("[data-guild-craft-results]");
      if (box && s.data && !s.data.empty) box.innerHTML = craftRows(s.data);
    });
    root.querySelector("[data-guild-more]")?.addEventListener("click", () => { s.pastShown += 10; repaint(); document.querySelector("[data-guild-more]")?.focus({ preventScroll: true }); });
    root.querySelector("[data-guild-export]")?.addEventListener("click", async () => {
      if (s.busy) return;
      s.busy = true; s.msg = "";
      try {
        const result = await api.exportGuildEvents();
        s.msg = result?.saved ? `Saved ${result.events} event${result.events === 1 ? "" : "s"} to the calendar file.` : result?.reason === "empty" ? "No guild event is ahead." : "";
      } catch { s.msg = "The calendar file could not be saved."; }
      s.busy = false; repaint();
      document.querySelector("[data-guild-export]")?.focus({ preventScroll: true });
    });
    for (const input of root.querySelectorAll("[data-guild-note]")) {
      const save = async () => {
        const name = input.dataset.guildNote, row = s.data?.roster?.find((m) => m.name === name), status = root.querySelector("[data-guild-note-msg]");
        if (!row || input.value === row.note) return;
        try { const result = await api.setGuildNote(s.data.profileId, name, input.value); row.note = result.note; input.value = result.note; if (status) status.textContent = "Note saved on this computer."; }
        catch { if (status) status.textContent = "That note could not be saved."; }
      };
      input.addEventListener("change", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    }
    // Each visit reads the newest save (a game save may have arrived since).
    if (!s.loading && Date.now() - s.loadedAt > 3000) load();
  }
  return { page, mounted, _state: () => state };
})();
