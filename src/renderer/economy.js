"use strict";
// Plans → Calendar (E11) and Adventure → Run history (G11). Both are read-only views of what
// the addon saved: the calendar shows every character's profession cooldowns and mail expiry,
// and with them lockout resets and guild events (guild-events.cjs);
// run history lists dungeon and raid runs with a personal best per dungeon. The only actions
// are the notification switch (off by default) and saving a calendar file.
window.EconomyView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const nowSec = () => Math.floor(Date.now() / 1000);
  const state = {
    calendar: { data: null, error: "", loading: false, loadedAt: 0, month: null, note: "", busy: false },
    runs: { data: null, error: "", loading: false, loadedAt: 0, profileId: null, dungeon: "" },
  };
  let mountedFor = null;
  const num = ' class="ldg-num"';
  function wait(seconds) {
    const minutes = Math.max(1, Math.ceil(seconds / 60)), h = Math.floor(minutes / 60), m = minutes % 60;
    if (h >= 48) return `${Math.floor(h / 24)} days`;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }
  function span(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const stamp = (v, kind) => (window.I18n?.when ? window.I18n.when(v, kind) : new Date(v).toLocaleString()); // one date format, in the shown language (i18n.js)
  const when = (at) => stamp(at * 1000, "weekday");
  const dateOf = (at) => stamp(at * 1000, "date");
  const timeOf = (at) => stamp(at * 1000, "time");
  function table(id, label, columns, content, count = 0) {
    return `<div class="ldg-table-frame${count > 12 ? " ldg-long" : ""}"><table class="ldg-table eco-table-${id}"><caption class="sr-only">${label}</caption><thead><tr>${columns.map(([text, numeric]) => `<th scope="col"${numeric ? num : ""}>${text}</th>`).join("")}</tr></thead>${content}</table></div>`;
  }

  // ---- Calendar ----
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function monthGrid(c, events) {
    const today = new Date(), month = c.month || { y: today.getFullYear(), m: today.getMonth() };
    const first = new Date(month.y, month.m, 1), offset = (first.getDay() + 6) % 7, days = new Date(month.y, month.m + 1, 0).getDate();
    const byDay = new Map();
    for (const e of events) { const k = dayKey(new Date(e.at * 1000)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(`<td class="eco-day eco-out" aria-hidden="true"></td>`);
    for (let d = 1; d <= days; d++) {
      const date = new Date(month.y, month.m, d), key = dayKey(date), list = byDay.get(key) || [];
      const chips = list.slice(0, 3).map((e) => `<li class="eco-chip eco-${e.kind}${e.past ? " eco-past" : ""}" title="${esc(`${e.title} · ${e.character} · ${when(e.at)}`)}"><strong${e.kind === "event" || e.kind === "lockout" ? " data-no-translate" : ""}>${esc(e.kind === "mail" ? "Mail expires" : e.title.replace(/ (ready|resets)$/, ""))}</strong><span>${esc(e.character)} · ${esc(timeOf(e.at))}</span></li>`).join("");
      cells.push(`<td class="eco-day${key === dayKey(today) ? " eco-today" : ""}${list.length ? " eco-has" : ""}" data-eco-day="${key}"><span class="eco-day-num"${key === dayKey(today) ? ' aria-label="Today"' : ""}>${d}</span>${list.length ? `<ul>${chips}${list.length > 3 ? `<li class="eco-more">+${list.length - 3} more</li>` : ""}</ul>` : ""}</td>`);
    }
    while (cells.length % 7) cells.push(`<td class="eco-day eco-out" aria-hidden="true"></td>`);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);
    const title = stamp(first, "month");
    return `<div class="ldg-toolbar"><h2 data-eco-month>${esc(title)}</h2><div class="eco-month-nav"><button type="button" data-eco-step="-1" aria-label="Earlier month">‹ Earlier</button><button type="button" data-eco-step="0">This month</button><button type="button" data-eco-step="1" aria-label="Later month">Later ›</button></div></div>
      <div class="eco-month-frame"><table class="eco-month"><caption class="sr-only">${esc(title)}</caption><thead><tr>${WEEKDAYS.map((w) => `<th scope="col">${w}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <p class="eco-legend"><span class="eco-chip eco-cooldown">Cooldown ready</span><span class="eco-chip eco-mail">Mail expires</span><span class="eco-chip eco-lockout">Lockout resets</span><span class="eco-chip eco-event">Guild event</span></p>`;
  }
  function eventRows(list, t) {
    return list.map((e) => `<tr data-eco-event="${esc(e.kind)}"><th scope="row">${e.kind === "event" || e.kind === "lockout" ? `<span data-no-translate>${esc(e.title)}</span>` : esc(e.kind === "mail" ? "Mail expires" : e.title)}<small class="ldg-cell-note"${e.kind === "event" || e.kind === "lockout" ? " data-no-translate" : ""}>${esc(e.detail)}</small></th><td>${esc(e.character)}${e.faction ? `<small class="ldg-cell-note">${esc(e.faction)}</small>` : ""}</td><td>${esc(when(e.at))}</td><td${num}>${e.at <= t ? (e.kind === "mail" ? `<strong class="eco-late">Expired</strong>` : `<strong class="ldg-ready">Ready</strong>`) : `in ${esc(wait(e.at - t))}`}</td></tr>`).join("");
  }
  // Every character's saved instances, soonest reset first. A character whose game client has no
  // list of saved instances says so instead of looking free.
  function lockoutCard(list, t) {
    if (!list.length) return `<section class="ldg-card" data-eco-lockouts><h2>Lockouts</h2><p class="ldg-empty">No lockouts saved yet. Log in on a character with the current addon, then type <code>/reload</code> once.</p></section>`;
    const rows = list.map((c) => {
      const who = `<th scope="row" rowspan="${Math.max(1, c.rows.length)}"><span data-no-translate>${esc(c.character)}</span><small class="ldg-cell-note"><span>saved</span> ${esc(dateOf(c.savedAt))}</small></th>`;
      if (!c.available) return `<tr data-eco-lockout="unknown">${who}<td colspan="3"><em class="ldg-unknown">The game client did not tell the addon which instances this character is saved to.</em></td></tr>`;
      if (!c.rows.length) return `<tr data-eco-lockout="free">${who}<td colspan="3"><span class="eco-muted">Not saved to any dungeon or raid.</span></td></tr>`;
      return c.rows.map((r, i) => `<tr data-eco-lockout="saved">${i ? "" : who}<td><strong data-no-translate>${esc(r.name)}</strong><small class="ldg-cell-note">${r.raid ? "Raid" : "Dungeon"}${r.total ? ` · <span>${r.progress} of ${r.total}</span> <span>bosses down</span>` : ""}</small></td><td>${esc(when(r.resetAt))}</td><td${num}>in ${esc(wait(r.resetAt - t))}</td></tr>`).join("");
    }).join("");
    return `<section class="ldg-card" data-eco-lockouts><h2>Lockouts</h2>${table("lockouts", "Lockouts", [["Character"], ["Saved to"], ["Resets"], ["Time left", true]], `<tbody>${rows}</tbody>`, list.reduce((n, c) => n + Math.max(1, c.rows.length), 0))}
      <p class="ldg-note ldg-after">A lockout that has reset since a character's last save is left out. In game the same list is <code>/bf lockouts</code></p></section>`;
  }
  function calendarBody() {
    const c = state.calendar;
    if (c.error) return `<p class="ldg-empty">${esc(c.error)}</p>`;
    if (!c.data) return `<p class="ldg-empty">${c.loading ? "Opening your calendar…" : "Your calendar is loading."}</p>`;
    const t = nowSec(), events = c.data.events;
    const ready = events.filter((e) => e.kind === "cooldown" && e.at <= t), ahead = events.filter((e) => e.at > t), expired = events.filter((e) => e.kind === "mail" && e.at <= t);
    const next = ahead[0];
    const honest = `<p class="ldg-note ldg-after">Only what the game saved is here: a cooldown shows once a character has used it, and mail shows after you open that character's mailbox. Times are from each character's last save.</p><p class="ldg-note ldg-after">Guild events come from guild members who run the addon and switched guild events on. Lockouts are the game's own list of saved instances, as each character last saved it. All times are your computer's time.</p>`;
    const list = [...ready, ...expired, ...ahead];
    return `<div class="ldg-summary"><div><strong>${ready.length}</strong><span>cooldown${ready.length === 1 ? "" : "s"} ready now</span></div><div><strong>${ahead.length}</strong><span>coming up</span></div><div><strong>${next ? esc(wait(next.at - t)) : "—"}</strong><span>${next ? `until ${esc(next.kind === "mail" ? "mail expires" : next.title.toLowerCase())} on ${esc(next.character)}` : "nothing ahead yet"}</span></div></div>
      <section class="ldg-card eco-calendar" data-eco-calendar>${monthGrid(c, events)}</section>
      <section class="ldg-card"><h2>Ready now and coming up</h2>${list.length ? table("events", "Ready now and coming up", [["What"], ["Character"], ["When"], ["Status", true]], `<tbody>${eventRows(list, t)}</tbody>`, list.length) : `<p class="ldg-empty">Nothing on the calendar yet. Use a profession cooldown (a transmute, Mooncloth, the Salt Shaker) or open a mailbox in game, then type <code>/reload</code> once.</p>`}${honest}</section>
      ${lockoutCard(c.data.lockouts || [], t)}
      <section class="ldg-card eco-remind"><h2>Reminders</h2>
        <div class="eco-remind-row"><div><strong>Desktop notifications</strong><p class="ldg-note">${c.data.canNotify ? "A small notice when a cooldown comes ready or mail is two days from expiring. Only while this app is open; nothing runs in the background." : "This computer does not offer desktop notifications to the app."}</p></div><button type="button" class="${c.data.notify ? "" : "primary"}" data-eco-notify="${c.data.notify ? "off" : "on"}" aria-pressed="${c.data.notify ? "true" : "false"}"${c.data.canNotify && !c.busy ? "" : " disabled"}>${c.data.notify ? "Turn notifications off" : "Turn notifications on"}</button></div>
        <div class="eco-remind-row"><div><strong>Calendar file</strong><p class="ldg-note">Save the ${ahead.length} event${ahead.length === 1 ? "" : "s"} still ahead as an .ics file and open it in any calendar app. The file is a copy: it does not update itself.</p></div><button type="button" data-eco-export${ahead.length && !c.busy ? "" : " disabled"}>Save calendar file</button></div>
        <p class="eco-msg" role="status" data-eco-msg>${esc(c.note)}</p></section>`;
  }
  function calendar() {
    return `<section class="eco-page" data-economy="calendar">${PageHero.render({ art: "plans", eyebrow: "Plans · Calendar", title: "Cooldown calendar", subtitle: "Every character's profession cooldowns, mail expiry, lockout resets and guild events on one calendar.", compact: true })}<div data-eco-body>${calendarBody()}</div></section>`;
  }

  // ---- Run history ----
  function lootCell(r) {
    if (r.loot === null) return `<em class="ldg-unknown">Not recorded</em>`;
    if (!r.loot.length) return `<span class="eco-muted">None seen</span>`;
    return `<ul class="eco-loot">${r.loot.map((l) => `<li data-card-item="${l.itemId}"><span class="ldg-name q-${QUALITY[l.quality] || "common"}">${esc(l.name)}</span>${l.count > 1 ? ` ×${l.count}` : ""}</li>`).join("")}</ul>`;
  }
  // S9: a run as a picture; a personal best says so on the card.
  function shareRun(r) {
    if (!window.ShareCard) return "";
    return ShareCard.button("run", { name: r.name, instanceType: r.instanceType, bosses: r.bosses.length, knownBosses: r.knownBosses, timed: r.timed, seconds: r.seconds, deaths: r.deaths, personalBest: r.personalBest, at: r.startedAt }, "Share", state.runs.data?.profileId ?? null);
  }
  function runRows(rows) {
    return rows.map((r) => `<tr data-eco-run="${esc(r.id)}"><th scope="row">${esc(dateOf(r.startedAt))}<small class="ldg-cell-note">${esc(timeOf(r.startedAt))}</small></th>
      <td><strong>${esc(r.name)}</strong><small class="ldg-cell-note">${r.instanceType === "raid" ? "Raid" : "Dungeon"}</small></td>
      <td${num}>${r.timed ? `${esc(span(r.seconds))}${r.personalBest ? `<small class="ldg-cell-note eco-best" data-eco-best>Personal best</small>` : ""}` : `<em class="ldg-unknown">Not timed</em>${r.bossSpanSeconds ? `<small class="ldg-cell-note">${esc(span(r.bossSpanSeconds))} first to last boss</small>` : ""}`}</td>
      <td><strong>${r.bosses.length}${r.knownBosses ? ` of ${r.knownBosses}` : ""}</strong>${r.bosses.length ? `<small class="ldg-cell-note">${r.bosses.map((b) => esc(b.name)).join(", ")}</small>` : ""}</td>
      <td${num}>${r.deaths === null ? `<em class="ldg-unknown">—</em>` : r.deaths}</td><td>${lootCell(r)}</td><td>${shareRun(r)}</td></tr>`).join("");
  }
  function runsBody() {
    const s = state.runs;
    if (s.error) return `<p class="ldg-empty">${esc(s.error)}</p>`;
    if (!s.data) return `<p class="ldg-empty">${s.loading ? "Opening your run history…" : "Your run history is loading."}</p>`;
    const d = s.data;
    const picker = d.characters.length > 1 ? `<label class="ldg-pick ldg-inline">Character <select data-eco-run-character aria-label="Run history of">${d.characters.map((c) => `<option value="${esc(c.profileId)}"${c.profileId === d.profileId ? " selected" : ""}>${esc(c.name)} · ${c.runs} run${c.runs === 1 ? "" : "s"}</option>`).join("")}</select></label>` : "";
    if (!d.profileId) return `<p class="ldg-empty">No character yet. Log in with the addon and type <code>/reload</code> once.</p>`;
    const honest = `<p class="ldg-note ldg-after">A run is timed from walking in to walking out; coming back within half an hour continues the same run. Deaths are your own. Loot is what you picked up yourself, uncommon or better. Runs saved by an older addon version have only their boss kills. Who you ran with is not recorded.</p>`;
    if (!d.rows.length) return `<section class="ldg-card"><div class="ldg-toolbar"><h2>Every run</h2>${picker}</div><p class="ldg-empty">${esc(d.name)} has no dungeon or raid runs saved yet. Runs appear here after the next save that follows one (type <code>/reload</code> or log out).</p>${honest}</section>`;
    const shown = s.dungeon ? d.rows.filter((r) => `${r.instanceType}:${r.instanceMap}` === s.dungeon) : d.rows;
    const filter = d.dungeons.length > 1 ? `<label class="ldg-pick ldg-inline">Show <select data-eco-run-dungeon aria-label="Show runs of"><option value="">All dungeons and raids</option>${d.dungeons.map((x) => `<option value="${esc(`${x.instanceType}:${x.instanceMap}`)}"${`${x.instanceType}:${x.instanceMap}` === s.dungeon ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : "";
    const bests = d.dungeons.map((x) => `<tr><th scope="row">${esc(x.name)}<small class="ldg-cell-note">${x.instanceType === "raid" ? "Raid" : "Dungeon"}</small></th><td${num}>${x.runs}</td><td${num}>${x.mostBosses}${x.knownBosses ? ` of ${x.knownBosses}` : ""}</td><td${num}>${x.bestSeconds === null ? `<em class="ldg-unknown">No timed run yet</em>` : `<strong>${esc(span(x.bestSeconds))}</strong><small class="ldg-cell-note">${esc(dateOf(x.bestAt))}</small>`}</td><td>${esc(dateOf(x.lastAt))}</td></tr>`).join("");
    return `<div class="ldg-summary"><div><strong>${d.totals.runs}</strong><span>run${d.totals.runs === 1 ? "" : "s"} by ${esc(d.name)}</span></div><div><strong>${d.dungeons.length}</strong><span>dungeon${d.dungeons.length === 1 ? "" : "s"} and raids</span></div><div><strong>${d.totals.bosses}</strong><span>boss kills</span></div><div><strong>${d.totals.timed}</strong><span>timed run${d.totals.timed === 1 ? "" : "s"}</span></div></div>
      <section class="ldg-card"><div class="ldg-toolbar"><h2>Personal bests</h2>${picker}</div>${table("bests", "Personal bests", [["Dungeon"], ["Runs", true], ["Most bosses in one run", true], ["Best time", true], ["Last run"]], `<tbody>${bests}</tbody>`, d.dungeons.length)}
        <p class="ldg-note ldg-after">Best time is your fastest timed run that killed as many bosses as your fullest run there.</p></section>
      <section class="ldg-card"><div class="ldg-toolbar"><h2>Every run</h2>${filter}</div><div data-eco-run-list>${table("runs", "Every run", [["Date"], ["Dungeon"], ["Time", true], ["Bosses"], ["Deaths", true], ["Loot"], ["Picture"]], `<tbody>${runRows(shown)}</tbody>`, shown.length)}</div>${honest}</section>`;
  }
  function runs() {
    return `<section class="eco-page" data-economy="runs">${PageHero.render({ art: "dungeons", eyebrow: "Adventure · Dungeons & raids", title: "Run history", subtitle: "Your dungeon and raid runs, kept on this computer, with your best time in each.", compact: true, aside: `<button type="button" class="atlas-history-link" data-nav="dungeons" data-shell-control="run-history-back"><span aria-hidden="true">←</span> Dungeons &amp; raids</button>` })}<div data-eco-body>${runsBody()}</div></section>`;
  }

  function repaint() {
    const root = document.querySelector("[data-economy]");
    if (!root) return;
    root.outerHTML = root.dataset.economy === "calendar" ? calendar() : runs();
    mountedFor = null; mounted();
  }
  async function load(kind) {
    const s = state[kind];
    if (s.loading) return;
    s.loading = true;
    try { s.data = kind === "calendar" ? await api.economyCalendar() : await api.runHistory(s.profileId); s.error = ""; }
    catch (e) { s.error = e.message || "This page is unavailable."; }
    s.loading = false; s.loadedAt = Date.now();
    if (document.querySelector(`[data-economy="${kind}"]`)) repaint();
  }
  function mounted() {
    const root = document.querySelector("[data-economy]");
    if (!root) { mountedFor = null; return; }
    if (mountedFor === root) return;
    mountedFor = root;
    const kind = root.dataset.economy, s = state[kind];
    if (kind === "calendar") {
      for (const b of root.querySelectorAll("[data-eco-step]")) b.addEventListener("click", () => {
        const today = new Date(), step = Number(b.dataset.ecoStep), cur = s.month || { y: today.getFullYear(), m: today.getMonth() };
        const next = step ? new Date(cur.y, cur.m + step, 1) : today;
        s.month = { y: next.getFullYear(), m: next.getMonth() };
        repaint();
        document.querySelector(`[data-eco-step="${step}"]`)?.focus({ preventScroll: true });
      });
      root.querySelector("[data-eco-notify]")?.addEventListener("click", async (e) => {
        if (s.busy) return;
        s.busy = true; s.note = "";
        const on = e.currentTarget.dataset.ecoNotify === "on";
        try { s.data = await api.setCalendarNotify(on); s.note = on ? "Notifications are on while the app is open." : "Notifications are off."; }
        catch { s.note = "That setting could not be saved."; }
        s.busy = false; repaint();
        document.querySelector("[data-eco-notify]")?.focus({ preventScroll: true });
      });
      root.querySelector("[data-eco-export]")?.addEventListener("click", async () => {
        if (s.busy) return;
        s.busy = true; s.note = "";
        try {
          const result = await api.exportCalendar();
          s.note = result?.saved ? `Saved ${result.events} event${result.events === 1 ? "" : "s"} to the calendar file.` : result?.reason === "empty" ? "Nothing is ahead on the calendar yet." : "";
        } catch { s.note = "The calendar file could not be saved."; }
        s.busy = false; repaint();
        document.querySelector("[data-eco-export]")?.focus({ preventScroll: true });
      });
    } else {
      root.querySelector("[data-eco-run-character]")?.addEventListener("change", (e) => { s.profileId = e.target.value; s.dungeon = ""; s.loadedAt = 0; load("runs"); });
      root.querySelector("[data-eco-run-dungeon]")?.addEventListener("change", (e) => { s.dungeon = e.target.value; repaint(); document.querySelector("[data-eco-run-dungeon]")?.focus({ preventScroll: true }); });
    }
    // Each visit reads the newest save (a game save may have arrived since).
    const active = document.querySelector("#active-character")?.value;
    const stale = kind === "runs" && !s.profileId && s.data && active && s.data.profileId !== active;
    if (!s.loading && (stale || Date.now() - s.loadedAt > 3000)) load(kind);
  }
  return { calendar, runs, mounted, _state: () => state };
})();
