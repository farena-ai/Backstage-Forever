"use strict";
// Characters → Journey: a painted badge wall, speed splits per level and the rested planner.
window.JourneyView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let data = null, error = "", mountedFor = null, week = null, request = null, scope = null;
  let selected = () => null, selectionPending = () => false;
  let manual = null, saving = null;
  const scopeOf = (p) => JSON.stringify([p?.id, p?.source?.kind, p?.source?.id, p?.source?.updatedAt, p?.clientBuild]);
  const dur = (s) => { if (!Number.isFinite(s)) return "?"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
  const day = (t) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  function dungeonDefeats(evidence) {
    const date = value => `<time datetime="${esc(value.toISOString())}">${esc(value.toLocaleString(window.I18n?.lang, { dateStyle: "medium", timeStyle: "short" }))}</time>`;
    return `<section class="jr-card" data-journey-defeats><h2>Personal dungeon boss defeats</h2>${evidence ? `
      <p><strong>${evidence.distinct === 1 ? "1 distinct boss encounter in retained history" : `${evidence.distinct} distinct boss encounters in retained history`}</strong></p>
      <p>Last character save: ${date(new Date(evidence.savedAt))}</p>
      <p>Recent recorded defeats, not full runs, lockouts or loot.</p>
      <ul class="jr-sessions jr-defeats">${evidence.recent.map(row => `<li><strong data-no-translate>${esc(row.name)}</strong>${date(new Date(row.at * 1000))}</li>`).join("")}</ul>` :
      `<p class="jr-empty">No personal dungeon boss defeats recorded.</p>`}</section>`;
  }
  function badges(b) {
    const groups = [...new Set(b.badges.map((x) => x.group))];
    return groups.map((g) => `<h3 class="jr-group">${esc(g)}</h3><ul class="jr-badges">${b.badges.filter((x) => x.group === g).map((x) => `<li class="jr-badge${x.earned ? " earned" : ""}" title="${esc(x.how)}">
      <img src="art/badges/${esc(x.id)}.png" alt="" width="96" height="96"><strong>${esc(x.name)}</strong>
      <span>${x.earned ? (x.at ? `Earned ${esc(day(x.at))}` : "Earned") : esc(x.how)}</span>
      ${!x.earned && x.progress ? `<span class="jr-prog"><span data-w="${Math.round((x.progress.have / x.progress.need) * 100)}"></span></span><small>${x.progress.have} / ${x.progress.need}</small>` : ""}</li>`).join("")}</ul>`).join("");
  }
  function splits(d) {
    if (!d.splits.length) return `<p class="jr-empty">${d.hasJournal ? "Gain a level with the addon running and your time for each level shows up here, with your best times." : "Log in and type <code>/reload</code> once with the addon on: from then on each level's /played time is recorded."}</p>`;
    const max = Math.max(...d.splits.map((s) => s.seconds));
    return `<ol class="jr-splits">${d.splits.slice(-20).map((s) => `<li${s.personalBest ? ' class="best"' : ""}><span class="jr-lv">${s.level}→${s.level + 1}</span><span class="jr-bar"><span data-w="${Math.max(3, Math.round((s.seconds / max) * 100))}"></span>${s.best && !s.personalBest ? `<i data-l="${Math.round((s.best.seconds / max) * 100)}" title="Best: ${esc(dur(s.best.seconds))} by ${esc(s.best.name)}"></i>` : ""}</span><span class="jr-time">${esc(dur(s.seconds))}${s.personalBest ? ' <em>best</em>' : s.best ? ` <small>best ${esc(dur(s.best.seconds))}</small>` : ""}</span></li>`).join("")}</ol>`;
  }
  function restedCard(r) {
    if (!r) return `<p class="jr-empty">Rested experience shows here once your character has been saved.</p>`;
    return `<div class="jr-rested"><div class="jr-moon" aria-hidden="true"></div><div><p><strong>${r.percentOfLevel}% of a level</strong> rested right now${r.xp ? ` (${r.xp.toLocaleString()} XP)` : ""}.</p>
      <p>Logging out in an inn or a city adds about <strong>${r.perNight}% of a level every 8 hours</strong>, up to ${r.capPercent}%. ${r.hoursToCap ? `About ${r.hoursToCap} hours offline in an inn fills it.` : "You're full: spend it!"}</p>
      <p class="jr-tip">Rested kills give double experience until the bonus runs out.</p></div></div>`;
  }
  // Past sessions (0.48, 3.1): levels per day for two weeks, then the latest sessions.
  function history(h) {
    if (!h || !h.totals.sessions) return `<p class="jr-empty">Play with the live link on and each session is kept here: when, how long, levels gained, deaths and zones. A break of 30 minutes starts a new session.</p>`;
    const max = Math.max(0.25, ...h.days.map((d) => d.levels));
    const when = (ms) => new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<p class="jr-hist-total">${h.totals.sessions} session${h.totals.sessions === 1 ? "" : "s"} · ${esc(dur(h.totals.minutes * 60))} played · ${h.totals.levels} levels · ${h.totals.deaths} death${h.totals.deaths === 1 ? "" : "s"}</p>
      <ol class="jr-days" aria-label="Levels gained per day, last 14 days">${h.days.map((d) => `<li title="${esc(d.day)}: ${d.levels} levels in ${d.minutes} min"><span class="jr-day-bar"><span data-h="${Math.round((d.levels / max) * 100)}"></span></span><small>${esc(d.day.slice(8))}</small></li>`).join("")}</ol>
      <ul class="jr-sessions">${h.sessions.slice(0, 8).map((x) => `<li><strong>${esc(when(x.startedAt))}</strong><span>${esc(dur(x.minutes * 60))}${x.startLevel && x.level ? ` · level ${x.startLevel}${x.level > x.startLevel ? ` → ${x.level}` : ""}` : ""}${x.levelsGained ? ` · +${x.levelsGained} levels` : ""} · ${x.deaths} death${x.deaths === 1 ? "" : "s"} · ${x.zones.length} zone${x.zones.length === 1 ? "" : "s"}</span></li>`).join("")}</ul>`;
  }
  // 1.4 (J17): the last seven days, for this character and all of them.
  const weeklyTime = at => new Date(at).toLocaleString(window.I18n?.lang, { dateStyle: "medium", timeStyle: "short" });
  const entryLabel = kind => kind === "accomplishment" ? "Accomplishment" : "Correction";
  function privatePanel(model) {
    if (!model || selectionPending()) return "";
    const seen = model.rows;
    const sessions = seen.filter(row => row.source === "observed");
    const form = kind => {
      const label = entryLabel(kind), id = `private-weekly-${kind}`;
      if (seen.some(row => row.kind === kind)) return "";
      if (kind === "correction" && !sessions.length) return `<p class="jr-empty">A correction needs a dated observed session from this week.</p>`;
      return `<form data-private-weekly-form="${kind}"><fieldset ${saving ? "disabled" : ""}><legend>Add a manual ${kind}</legend>
        ${kind === "accomplishment" ? `<label for="private-weekly-accomplishment-at">Accomplishment date and time</label><input id="private-weekly-accomplishment-at" name="at" type="datetime-local" required>` :
          `<label for="private-weekly-correction-target">Observed session</label><select id="private-weekly-correction-target" name="target" required><option value="">Choose a session</option>${sessions.map((row, i) => `<option value="${i}">${esc(weeklyTime(row.at))} · ${esc(dur(row.minutes * 60))} played</option>`).join("")}</select>`}
        <label>${label}<textarea id="${id}-text" name="text" rows="2" maxlength="${model.limits.maxText}" required></textarea></label>
        <button id="${id}-submit" type="submit">Add private ${kind}</button></fieldset><p role="status" data-private-weekly-status></p></form>`;
    };
    return `<section data-private-weekly class="jr-private-weekly" aria-labelledby="private-weekly-heading"><h3 id="private-weekly-heading">Private weekly timeline</h3>
      <p>One accomplishment and one correction for this character, kept until you quit the app. They aren’t shared or backed up. A correction adds context to a session without changing what was recorded.</p>
      ${seen.length ? `<ol class="jr-private-rows">${seen.map(row => `<li><strong${row.source === "manual" ? ` id="private-weekly-${esc(row.kind)}-added" tabindex="-1"` : ""}>${row.source === "observed" ? "Observed session" : `Manual ${esc(row.kind)}`}</strong> · <time datetime="${esc(new Date(row.at).toISOString())}">${esc(weeklyTime(row.at))}</time>${row.source === "observed" ? `<div>${esc(dur(row.minutes * 60))} played · ${row.deaths} death${row.deaths === 1 ? "" : "s"}</div>` : `<p data-no-translate>${esc(row.text)}</p>`}</li>`).join("")}</ol>` : `<p class="jr-empty">No dated sessions or manual entries for this character this week.</p>`}
      <div class="jr-private-forms">${form("accomplishment")}${form("correction")}</div></section>`;
  }
  function localTime(value) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    // Reject normalized clock times in a daylight-saving gap instead of silently moving the entry.
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) === value ? d.getTime() : null;
  }
  async function addManual(event) {
    event.preventDefault();
    const form = event.currentTarget, model = manual, kind = form.dataset.privateWeeklyForm;
    const owner = scope;
    const current = () => !selectionPending() && scope === owner && scopeOf(selected()) === owner &&
      document.getElementById("active-character")?.value === model?.profileId;
    if (!form.isConnected || !model || !current() || saving) return;
    const fields = new FormData(form), index = fields.get("target");
    const target = typeof index === "string" && index !== "" ? model.rows.filter(row => row.source === "observed")[Number(index)] : null;
    const input = { token: model.token, kind, text: fields.get("text"), at: kind === "correction" ? target?.at : localTime(fields.get("at")) };
    if (kind === "correction") input.sessionId = target?.sessionId;
    const status = form.querySelector("[data-private-weekly-status]");
    if (!input.at) { status.textContent = "Choose a known date and time or a dated session."; return; }
    const pending = {};
    saving = pending;
    const panel = form.closest("[data-private-weekly]");
    panel.querySelectorAll("fieldset").forEach(el => { el.disabled = true; });
    let result = null;
    try { result = await api.addPrivateWeekly(input); } catch {}
    if (saving !== pending) return;
    saving = null;
    if (!current() || manual !== model) return;
    const mountedPanel = document.querySelector("[data-private-weekly]");
    if (result?.token !== model.token || result.profileId !== model.profileId) {
      mountedPanel?.querySelectorAll("fieldset").forEach(el => { el.disabled = false; });
      const liveStatus = mountedPanel?.querySelector(`[data-private-weekly-form="${kind}"] [data-private-weekly-status]`);
      if (liveStatus) liveStatus.textContent = "Not added. Check that the date is in the last seven days and the session and character are still current.";
      return;
    }
    manual = result;
    if (!mountedPanel) return;
    const restoreFocus = document.activeElement === document.body || mountedPanel.contains(document.activeElement);
    // privatePanel escapes manually entered text and renders typed values from main.
    mountedPanel.outerHTML = privatePanel(result);
    bindPrivate(document.querySelector("[data-private-weekly]"));
    if (restoreFocus) document.getElementById(`private-weekly-${kind}-added`)?.focus();
  }
  function bindPrivate(root) {
    root?.querySelectorAll("[data-private-weekly-form]").forEach(form => form.addEventListener("submit", addManual));
  }
  let debrief = null, debriefDraft = null, debriefWrite = null;
  function resetDebrief() { debrief = debriefDraft = debriefWrite = null; }
  function debriefPanel() {
    if (!debrief || selectionPending()) return "";
    const { rows, maxText, moreDefeats, review } = debrief;
    const draft = debriefDraft ?? review;
    const open = document.querySelector("[data-private-after-action]")?.open;
    return `<details class="jr-card jr-after-action" data-private-after-action ${open ? "open" : ""}><summary id="private-after-action-summary">Private after-action review</summary>
      <p>Recent observations from the last seven days. These sources are shown in date order, not linked into a run. Partial records do not explain deaths or show full dungeon runs.</p>
      ${rows.length ? `<ol class="jr-private-rows">${rows.map(row => `<li><strong>${row.source === "addon-save" ? "Addon save" : "Live link"}</strong> · <time datetime="${esc(new Date(row.at).toISOString())}">${esc(weeklyTime(row.at))}</time>${row.kind === "defeat" ? `<div>Recorded Deadmines defeat: <span data-no-translate>${esc(row.name)}</span> · capture build unknown</div>` : `<div>Play session started · ${esc(dur(row.minutes * 60))} recorded play · ${row.deaths} recorded death${row.deaths === 1 ? "" : "s"}</div>`}</li>`).join("")}</ol>` : `<p class="jr-empty">No eligible observations in this window.</p>`}
      ${moreDefeats ? "<p>Showing up to five recent retained Deadmines defeats.</p>" : ""}
      <p id="private-after-action-help">Write one action you want to try next time. Your optional note and improvement stay private until you quit the app; they are not shared or backed up.</p>
      <div class="jr-private-forms"><form data-after-action-form aria-describedby="private-after-action-help">
        <fieldset><legend>Manual review</legend>
          <label for="private-after-action-note">Private note (optional)</label><textarea id="private-after-action-note" name="note" rows="2" maxlength="${maxText}" ${debriefWrite ? "readonly" : ""}>
${esc(draft?.note)}</textarea>
          <label for="private-after-action-next">Next improvement</label><textarea id="private-after-action-next" name="improvement" rows="2" maxlength="${maxText}" required ${debriefWrite ? "readonly" : ""}>
${esc(draft?.improvement)}</textarea>
          <div class="jr-after-actions"><button type="submit" id="private-after-action-save">Save private review</button><button type="button" id="private-after-action-clear" ${review ? "" : "hidden"}>Clear private review</button></div>
        </fieldset><p role="status" data-after-action-status></p>
      </form></div></details>`;
  }
  function bindDebrief(root) {
    const form = root.querySelector("[data-after-action-form]");
    if (!form) return;
    const fields = () => ({ note: form.elements.note.value, improvement: form.elements.improvement.value });
    form.addEventListener("input", () => { debriefDraft = fields(); });
    async function write(clear) {
      const model = debrief, owner = scope;
      const current = () => model === debrief && !selectionPending() && scope === owner && scopeOf(selected()) === owner &&
        document.getElementById("active-character")?.value === model?.profileId;
      if (!form.isConnected || !model || !current() || debriefWrite) return;
      const status = form.querySelector("[data-after-action-status]");
      const text = fields();
      if (!clear && !text.improvement.trim()) { status.textContent = "Enter one next improvement."; return; }
      const pending = {};
      debriefWrite = pending;
      // Lock edits without moving keyboard focus while the write settles.
      form.elements.note.readOnly = form.elements.improvement.readOnly = true;
      let result = null;
      try { result = await api.savePrivateAfterAction({ token: model.token, ...(clear ? { clear: true } : text) }); } catch {}
      if (debriefWrite !== pending) return;
      debriefWrite = null;
      if (!current()) return;
      const live = document.querySelector("[data-after-action-form]");
      if (live) live.elements.note.readOnly = live.elements.improvement.readOnly = false;
      if (result?.token !== model.token || result.scope !== owner) {
        if (live) live.querySelector("[data-after-action-status]").textContent = "Private review not changed. Check the active character and try again.";
        return;
      }
      debrief = result;
      debriefDraft = null;
      if (!live) return;
      live.elements.note.value = result.review?.note ?? "";
      live.elements.improvement.value = result.review?.improvement ?? "";
      const clearButton = live.querySelector("#private-after-action-clear");
      if (clear && document.activeElement === clearButton) live.elements.improvement.focus();
      clearButton.hidden = !result.review;
      live.querySelector("[data-after-action-status]").textContent = clear ? "Private review cleared." : "Private review saved.";
    }
    form.addEventListener("submit", e => { e.preventDefault(); void write(false); });
    form.querySelector("#private-after-action-clear").addEventListener("click", () => { void write(true); });
  }
  function weekCard() {
    const r = week?.recap;
    if (!r) return "";
    const me = r.active, t = r.totals;
    const coins = (c) => { const v = Math.abs(c), g = Math.floor(v / 10000), s = Math.floor(v / 100) % 100; return `${c < 0 ? "−" : "+"}${g ? `${g}g ` : ""}${s}s`; };
    const mine = me && me.played ? `<ul class="jr-week"><li><strong>${me.levelsGained}</strong><span>level${me.levelsGained === 1 ? "" : "s"}</span></li><li><strong>${me.badges.length}</strong><span>badge${me.badges.length === 1 ? "" : "s"}</span></li><li><strong>${esc(dur(me.minutes * 60))}</strong><span>played</span></li><li><strong>${me.deaths}</strong><span>death${me.deaths === 1 ? "" : "s"}</span></li>${me.gold !== null ? `<li><strong>${esc(coins(me.gold))}</strong><span>gold</span></li>` : ""}${me.bestSplit ? `<li><strong>${esc(dur(me.bestSplit.seconds))}</strong><span>fastest level (${me.bestSplit.level}→${me.bestSplit.level + 1})</span></li>` : ""}</ul>${me.badges.length ? `<p class="jr-week-badges">New: ${me.badges.map((b) => esc(b.name)).join(", ")}</p>` : ""}`
      : `<p class="jr-empty">Nothing recorded for this character in the last seven days.</p>`;
    const others = r.characters.filter((c) => c.profileId !== me?.profileId);
    return `<section class="jr-card" data-journey-week><h2>This week</h2>${mine}${others.length ? `<p class="jr-week-all">All characters: ${t.levels} level${t.levels === 1 ? "" : "s"}, ${t.badges} badge${t.badges === 1 ? "" : "s"}, ${esc(dur(t.minutes * 60))} played. ${others.map((c) => `${esc(c.name)} +${c.levelsGained}`).join(", ")}.</p>` : ""}${privatePanel(manual)}</section>`;
  }
  function body() {
    if (error) return `<p class="jr-empty">${esc(error)}</p>`;
    if (!data) return `<p class="jr-empty">${selected() ? "Reading your journey…" : "Choose a character in Characters."}</p>`;
    const d = data;
    return `<div class="jr-summary"><div><strong>${d.badges.earned}</strong><span>of ${d.badges.total} badges</span></div><div><strong>${d.level ?? "?"}</strong><span>level</span></div><div><strong>${esc(d.played ? dur(d.played) : "?")}</strong><span>played</span></div><div><strong>${d.zones}</strong><span>zones visited</span></div></div>
      ${weekCard()}
      ${debriefPanel()}
      ${dungeonDefeats(d.dungeonDefeats)}
      <section class="jr-card"><h2>Badges</h2>${badges(d.badges)}</section>
      <div class="jr-two"><section class="jr-card"><h2>Speed splits</h2>${splits(d)}</section><section class="jr-card"><h2>Rested planner</h2>${restedCard(d.rested)}</section></div>
      <section class="jr-card"><h2>Past sessions</h2>${history(d.history)}</section>`;
  }
  function page() {
    const next = scopeOf(selected());
    if (scope !== next) { scope = next; data = week = request = manual = saving = null; resetDebrief(); error = ""; }
    const cls = String(data?.className || "").toLowerCase();
    return `<section class="journey-page" data-journey>${PageHero.render({ art: "journey", eyebrow: "Characters · Journey", title: esc(data?.name || "Your journey"), crest: PageHero.classCrest(cls), subtitle: "Badges you've earned, how fast each level went, and your rested bonus." })}
      <section class="jr-card" aria-labelledby="journey-newcomer-title"><h2 id="journey-newcomer-title">Newcomer dungeon run</h2><p>Plan a relaxed first run with a volunteer mentor. The template opens in Party and does not copy your journal.</p><button type="button" data-journey-newcomer>Use newcomer/mentor template</button></section>
      <div data-journey-body>${body()}</div></section>`;
  }
  function sizes(root) {
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of root.querySelectorAll("[data-l]")) el.style.left = `${Number(el.dataset.l)}%`;
    for (const el of root.querySelectorAll("[data-h]")) el.style.height = `${Math.max(2, Number(el.dataset.h))}%`;
  }
  async function load() {
    const owner = { scope, id: selected()?.id };
    if (!owner.id || request || selectionPending()) return;
    request = owner;
    const [result, recap, privateRecap, afterAction] = await Promise.allSettled([api.journey(), api.weekly?.(), api.privateWeekly(), api.privateAfterAction()]);
    if (request !== owner) return;
    request = null;
    const root = document.querySelector("[data-journey]");
    if (!root || selectionPending() || owner.scope !== scopeOf(selected()) || document.getElementById("active-character")?.value !== owner.id) return;
    if (result.status === "fulfilled" && result.value?.id === owner.id) {
      data = result.value;
      debrief = afterAction.status === "fulfilled" && afterAction.value?.scope === owner.scope ? afterAction.value : null;
      week = recap.status === "fulfilled" && recap.value?.recap?.active?.profileId === owner.id ? recap.value : null;
      manual = privateRecap.status === "fulfilled" && privateRecap.value?.profileId === owner.id ? privateRecap.value : null;
    } else {
      error = "Your journey is unavailable.";
    }
    // page() escapes saved names/dates and renders numeric counts from the validated IPC model.
    root.outerHTML = page(); mounted();
    announce(data);
  }
  // A newly earned badge gets its moment: a painted banner, once per badge per character.
  function announce(d) {
    if (!d?.badges) return;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem("bf-badges-seen") || "{}"); } catch {}
    const mine = new Set(seen[d.id] || []), fresh = d.badges.badges.filter((b) => b.earned && !mine.has(b.id));
    if (seen[d.id] && fresh.length) show(fresh[0], fresh.length, d.id);
    seen[d.id] = d.badges.badges.filter((b) => b.earned).map((b) => b.id);
    try { localStorage.setItem("bf-badges-seen", JSON.stringify(seen)); } catch {}
  }
  const BIG = new Set(["first-mount", "level-40", "level-60", "profession-300", "rep-exalted", "gold-1000", "quests-500", "explorer-30"]);
  // 1.5 (J21): a finished zone gets its moment too: the zone's painting and a gold banner.
  function celebrate({ img, kicker, title, line, big = false, nav = null }) {
    document.querySelector(".bf-badge-pop")?.remove();
    const el = document.createElement("div");
    el.className = `bf-badge-pop${big ? " big" : ""} bf-zone-pop`; el.setAttribute("role", "status");
    el.innerHTML = `${img ? `<img src="${esc(img)}" alt="" width="120" height="120">` : ""}<div><span>${esc(kicker)}</span><strong>${esc(title)}</strong><em>${esc(line)}</em></div>`;
    document.body.append(el);
    el.addEventListener("click", () => { el.remove(); if (nav) { const root = document.getElementById("app"); if (root) { const go = document.createElement("button"); go.type = "button"; go.hidden = true; go.dataset.nav = nav; root.append(go); go.click(); go.remove(); } } });
    setTimeout(() => el.classList.add("out"), 6200); setTimeout(() => el.remove(), 7000);
    return el;
  }
  function show(b, n, profileId = null) {
    document.querySelector(".bf-badge-pop")?.remove();
    const el = document.createElement("div");
    // 1.5 (J21): the big ones (your own mount, level 40 and 60, Artisan, Exalted) get the big moment.
    el.className = `bf-badge-pop${BIG.has(b.id) ? " big" : ""}`; el.setAttribute("role", "status");
    el.innerHTML = `<img src="art/badges/${esc(b.id)}.png" alt="" width="120" height="120"><div><span>New badge${n > 1 ? `, and ${n - 1} more` : ""}</span><strong>${esc(b.name)}</strong><em>${esc(b.how)}</em><span class="bd-pop-link">See all your badges →</span></div>`;
    document.body.append(el);
    el.title = "Open Characters → Badges";
    el.addEventListener("click", () => { el.remove(); window.BadgesView?.open(profileId, b.id); const root = document.getElementById("app"); if (root) { const go = document.createElement("button"); go.type = "button"; go.hidden = true; go.dataset.nav = "badges"; root.append(go); go.click(); go.remove(); } });
    setTimeout(() => el.classList.add("out"), 5200); setTimeout(() => el.remove(), 6000);
  }
  function mounted() {
    const root = document.querySelector("[data-journey]");
    if (!root || mountedFor === root) return;
    mountedFor = root; sizes(root);
    bindPrivate(root);
    bindDebrief(root);
    if (!data && !error && !request) void load();
  }
  return { init: (getProfile, pending) => { selected = getProfile; selectionPending = pending; }, celebrate, page, mounted,
    check: () => api.journey?.().then(d => { if (d?.id === selected()?.id) announce(d); }).catch(() => {}),
    invalidate: () => {
      scope = data = week = request = manual = saving = null; resetDebrief(); error = "";
      document.querySelectorAll("[data-private-weekly], [data-private-after-action]").forEach(panel => panel.remove());
    }, _state: () => ({ data }), _show: show };
})();
