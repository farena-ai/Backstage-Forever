"use strict";
// Characters → Journey, the extra views: the story so far (W8), the timeline with screenshots
// (W7), leveling races (S4), Coach's notes (A4) and the stream overlay switch (S7). Each view
// asks the main process for a model built from saved data and paints it; nothing is worked out
// here. The Journey page owns the view switch and calls render() and mounted().
window.JourneyExtras = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const VIEWS = Object.freeze([["overview", "Overview"], ["story", "Story so far"], ["timeline", "Timeline"], ["races", "Races"], ["coach", "Coach's notes"], ["challenge", "Challenge run"], ["overlay", "Stream overlay"], ["discord", "Discord status"]]);
  const LOADERS = { story: () => api.story(), timeline: () => api.journeyTimeline(), races: () => api.raceBoard(), coach: () => api.coachNotes(), overlay: () => api.streamOverlay(), ...(window.JourneyMore?.loaders || {}) };
  const cache = {}, errors = {}, loading = {};
  let epoch = 0, note = "", busy = false, observer = null, thumbQueue = [], thumbBusy = false;
  const share = (kind, data, label) => window.ShareCard?.button(kind, data, label) || "";
  const dur = (s) => { if (!Number.isFinite(s)) return ""; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
  const dateTime = (at) => new Date(at * 1000).toLocaleString(window.I18n?.lang, { dateStyle: "medium", timeStyle: "short" });
  const longDay = (at) => new Date(at * 1000).toLocaleDateString(window.I18n?.lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const clock = (at) => new Date(at * 1000).toLocaleTimeString(window.I18n?.lang, { hour: "2-digit", minute: "2-digit" });
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const wait = (text) => `<p class="jr-empty" role="status">${esc(text)}</p>`;

  // ---- The story so far ----
  function story(d) {
    if (!d) return wait("Choose a character in Characters.");
    const lead = d.cards.find((c) => c.kind === "story");
    const chapters = d.chapters.map((c, i) => `<article class="jx-chapter" data-story-chapter="${esc(c.key)}"><h3><span class="jx-num" aria-hidden="true">${ROMAN[i] || i + 1}</span>${esc(c.title)}</h3><ul>${c.sentences.map((s) => `<li data-no-translate>${esc(s)}</li>`).join("")}</ul></article>`).join("");
    const pictures = d.cards.filter((c) => c.kind !== "story");
    return `<section class="jr-card jx-story" data-journey-story><div class="jx-head"><div><h2>The story so far</h2><p class="jx-lead">Written only from what was saved for <span data-no-translate>${esc(d.name)}</span>. Nothing is filled in.</p></div>${lead ? share("story", lead.data, "Share picture") : ""}</div>
      ${d.enough ? `<div class="jx-chapters">${chapters}</div>` : `<p class="jr-empty">There is no story to tell yet. Play with the addon on, then type <code>/reload</code> or log out: levels, quests picked up and firsts are saved from then on.</p>`}
      ${d.notSaved.length ? `<aside class="jx-missing" aria-labelledby="jx-missing-title"><h3 id="jx-missing-title">Not saved</h3><ul>${d.notSaved.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></aside>` : ""}
      ${d.hasQuestReference ? "" : `<p class="jx-foot">The quest reference is not loaded, so finished quest stories cannot be named.</p>`}
      ${pictures.length ? `<div class="jx-pictures"><h3>Pictures to share</h3><ul>${pictures.map((c) => `<li><span class="jx-kind">${esc({ level: "Level up", chain: "Quest story", zone: "Zone finished", run: "Dungeon run", best: "Personal best" }[c.kind] || c.kind)}</span><strong data-no-translate>${esc(c.label)}</strong>${share(c.kind, c.data, "Share picture")}</li>`).join("")}</ul></div>` : ""}
    </section>`;
  }

  // ---- Timeline with screenshots ----
  const MARK = { level: "Level", first: "First", run: "Dungeon", death: "Death", shot: "Picture" };
  function shotPlace(r) {
    const where = [r.level ? `Level ${r.level}` : "", r.zone || ""].filter(Boolean).join(" · ");
    if (!r.basis) return "Not placed: no saved session or level covers this time.";
    return `${where || "Level and zone not saved"} · ${r.basis === "session" ? "from a play session" : "from saved level dates"}`;
  }
  function timeline(d) {
    if (!d) return wait("Choose a character in Characters.");
    const f = d.folder;
    const folder = !f.found && !f.connected ? "Connect your game folder in Settings and your screenshots appear here."
      : !f.found ? "No Screenshots folder in your game folder yet. The game makes it with your first screenshot (the Print Screen key)."
        : d.counts.shots ? `${d.counts.shots} screenshot${d.counts.shots === 1 ? "" : "s"} read from your game's Screenshots folder (the newest ${f.limit} at most). ${d.counts.placed} placed by saved data.` : "Your game's Screenshots folder is empty.";
    const days = d.days.map((day) => {
      const shots = day.rows.filter((r) => r.kind === "shot"), events = day.rows.filter((r) => r.kind !== "shot");
      return `<section class="jx-day"><h3>${esc(longDay(day.at))}</h3>
        ${events.length ? `<ol class="jx-events">${events.map((r) => `<li class="jx-ev jx-ev-${esc(r.kind)}"><time datetime="${esc(new Date(r.at * 1000).toISOString())}">${esc(clock(r.at))}</time><span class="jx-mark">${esc(MARK[r.kind])}</span><span class="jx-what"><strong${r.kind === "run" || r.kind === "death" ? " data-no-translate" : ""}>${esc(r.title)}</strong>${r.detail ? `<small data-no-translate>${esc(r.detail)}</small>` : ""}</span></li>`).join("")}</ol>` : ""}
        ${shots.length ? `<ul class="jx-shots">${shots.map((r) => `<li class="jx-shot"><figure><div class="jx-frame">${r.preview ? `<canvas width="360" height="203" data-shot="${esc(r.name)}" role="img" aria-label="Screenshot taken at ${esc(clock(r.at))}"></canvas>` : `<p class="jx-nopreview">No preview for this file type.</p>`}</div>
          <figcaption><strong>${esc(clock(r.at))}</strong><span data-no-translate>${esc(shotPlace(r))}</span><button type="button" class="jx-link" data-shot-show="${esc(r.name)}">Show file</button></figcaption></figure></li>`).join("")}</ul>` : ""}</section>`;
    }).join("");
    return `<section class="jr-card jx-timeline" data-journey-timeline><div class="jx-head"><div><h2>Timeline</h2><p class="jx-lead">Level-ups, firsts, dungeon runs, deaths and your screenshots, newest first.</p></div></div>
      <p class="jx-folder" data-shot-folder>${esc(folder)}</p>
      <p class="jx-foot">Screenshots stay where the game saved them. The app only reads them to show small previews here; it never moves, changes or sends them. In WoW, <code>/bf moments shots on</code> takes one at each level-up and boss kill.</p>
      ${days || `<p class="jr-empty">Nothing with a saved date yet.</p>`}</section>`;
  }
  async function drawThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    const mine = epoch;
    while (thumbQueue.length && mine === epoch) {
      const canvas = thumbQueue.shift();
      if (!canvas.isConnected || canvas.dataset.drawn) continue;
      canvas.dataset.drawn = "1";
      try {
        const bytes = await api.screenshotThumb(canvas.dataset.shot);
        if (!bytes || !canvas.isConnected) { canvas.closest(".jx-frame")?.classList.add("jx-missing-shot"); continue; }
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const scale = Math.max(canvas.width / bmp.width, canvas.height / bmp.height), w = bmp.width * scale, h = bmp.height * scale;
        canvas.getContext("2d").drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        bmp.close();
      } catch { canvas.closest(".jx-frame")?.classList.add("jx-missing-shot"); }
    }
    thumbBusy = false;
  }
  function watchThumbs(root) {
    observer?.disconnect(); thumbQueue = [];
    const shots = root.querySelectorAll("canvas[data-shot]");
    if (!shots.length) return;
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); thumbQueue.push(e.target); }
      void drawThumbs();
    }, { rootMargin: "300px" });
    shots.forEach((c) => observer.observe(c));
  }

  // ---- Leveling races ----
  function races(d) {
    if (!d) return wait("Choose a character in Characters.");
    const b = d.board, kindWord = { you: "You", yours: "Your character", friend: "Friend" };
    const gap = (g) => (g === null || g === 0 ? "" : `<small class="${g < 0 ? "jx-ahead" : "jx-behind"}">${g < 0 ? "−" : "+"}${esc(dur(Math.abs(g)))}</small>`);
    const table = b.rows.length ? `<div class="jx-board-frame" tabindex="0" role="region" aria-label="Leveling race board"><table class="jx-board"><caption class="sr-only">Time played when each level was reached</caption>
      <thead><tr><th scope="col">Level</th>${b.columns.map((c) => `<th scope="col" class="jx-col-${esc(c.kind)}"><span data-no-translate>${esc(c.name)}</span><small>${esc(kindWord[c.kind])} · ${c.wins} fastest</small></th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr><th scope="row">${r.level}</th>${r.cells.map((c, i) => `<td class="${c.fastest ? "jx-fastest" : ""}${b.columns[i].kind === "you" ? " jx-you" : ""}">${c.seconds === null ? `<span class="jx-none" aria-label="No time saved">·</span>` : `${esc(dur(c.seconds))}${b.columns[i].kind === "you" ? "" : gap(c.gap)}`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="jx-foot">Each cell is the time played when that level was reached. Gold marks the fastest. The small figure is how far that racer was ahead of you (−) or behind you (+) at that level.</p>`
      : `<p class="jr-empty">No level times to compare yet. A level counts once the addon has saved its /played time.</p>`;
    const standings = b.standings.filter((s) => s.level !== null);
    return `<section class="jr-card jx-races" data-journey-races><div class="jx-head"><div><h2>Leveling races</h2><p class="jx-lead">Compare your level times with friends and with your own other characters. Codes travel by hand: there is no server.</p></div></div>
      <div class="jx-race-forms">
        <form class="jx-panel" data-race-name-form><h3>Your code</h3>
          <label for="jx-race-name">Display name on your code</label>
          <div class="jx-row"><input id="jx-race-name" name="name" type="text" maxlength="${d.limits.name}" value="${esc(d.name)}" placeholder="A name your friends know" autocomplete="off" data-no-translate><button type="submit">Save name</button></div>
          ${d.code ? `<label for="jx-race-code">Your code for this character (${d.levelsSaved} levels)</label><textarea id="jx-race-code" rows="3" readonly spellcheck="false" data-no-translate>${esc(d.code)}</textarea>
            <div class="jx-row"><button type="button" data-race-copy>Copy code</button><button type="button" data-race-save>Save as a file</button></div>` : `<p class="jx-hint">${esc(d.exportError || "No code yet.")}</p>`}
          <p class="jx-foot">The code holds only that name and, per level, the time played and the day. No realm, class or account.</p></form>
        <form class="jx-panel" data-race-add-form><h3>Add a friend</h3>
          <label for="jx-race-paste">Paste a friend's code</label><textarea id="jx-race-paste" name="code" rows="3" maxlength="4200" spellcheck="false" placeholder="BFRACE1…" data-no-translate></textarea>
          <div class="jx-row"><button type="submit">Add code</button><button type="button" data-race-open>Open a code file</button></div>
          ${d.friends.length ? `<ul class="jx-friends" aria-label="Friends on the board">${d.friends.map((f) => `<li><span><strong data-no-translate>${esc(f.name)}</strong><small>Level ${f.topLevel}</small></span><button type="button" class="jx-link" data-race-remove="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join("")}</ul>` : `<p class="jx-hint">No friends added yet. The board holds up to ${d.limits.friends}.</p>`}</form>
      </div>
      <p class="jx-status" role="status" data-race-status>${esc(note)}</p>
      ${standings.length ? `<ul class="jx-standings">${standings.map((s) => `<li><strong data-no-translate>${esc(s.name)}</strong><span>${s.gap === 0 ? `Level with you at level ${s.level}.` : s.gap < 0 ? `You reached level ${s.level} ${esc(dur(-s.gap))} sooner.` : `Reached level ${s.level} ${esc(dur(s.gap))} sooner than you.`}</span></li>`).join("")}</ul>` : ""}
      ${table}</section>`;
  }

  // ---- Coach's notes ----
  function coach(d) {
    if (!d) return wait("Choose a character in Characters.");
    const span = d.from && d.to ? `Between your saves of ${dateTime(d.from)} and ${dateTime(d.to)}.` : d.to ? `Your newest save: ${dateTime(d.to)}.` : "";
    const facts = d.facts ? [`${d.facts.sessions} play session${d.facts.sessions === 1 ? "" : "s"}`, d.facts.minutes ? `${dur(d.facts.minutes * 60)} seen over the live link` : "", `${d.facts.deaths} death${d.facts.deaths === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : "";
    const tomorrow = `<article class="jx-note jx-note-next" data-coach="tomorrow"><h3>Tomorrow's first step</h3>${d.tomorrow ? `<p class="jx-big" data-no-translate>${esc(d.tomorrow.title)}</p>${d.tomorrow.detail ? `<p data-no-translate>${esc(d.tomorrow.detail)}</p>` : ""}<button type="button" data-nav="now">Open Now</button>` : `<p>${esc(d.noStepReason)}</p>`}</article>`;
    const body = d.status === "ok" ? `<article class="jx-note jx-note-well" data-coach="well"><h3>What went well</h3>${d.wentWell.length ? `<ul>${d.wentWell.map((w) => `<li><span data-no-translate>${esc(w.text)}</span>${w.card ? share(w.card.kind, w.card.data, "Share picture") : ""}</li>`).join("")}</ul>` : `<p>${esc(d.nothingWell)}</p>`}</article>
        <article class="jx-note jx-note-change" data-coach="change"><h3>One thing to change</h3>${d.change ? `<p class="jx-big" data-no-translate>${esc(d.change.text)}</p><p data-no-translate>${esc(d.change.advice)}</p>` : `<p>${esc(d.nothingToChange)}</p>`}</article>`
      : `<article class="jx-note jx-note-wide" data-coach="${esc(d.status)}"><h3>${d.status === "too-little" ? "Too little to go on" : "Not yet"}</h3><p>${esc(d.message)}</p></article>`;
    return `<section class="jr-card jx-coach" data-journey-coach><div class="jx-head"><div><h2>Coach's notes</h2><p class="jx-lead">${esc(span)} ${esc(facts)}</p></div></div>
      <div class="jx-notes">${body}${tomorrow}</div>
      <p class="jx-foot">Built only from what was saved between two saves. Unspent talent points are not in the saved data, so the notes never mention them.</p></section>`;
  }

  // ---- Stream overlay ----
  function overlay(d) {
    if (!d) return wait("Reading the overlay switch…");
    const f = d.facts || {};
    const sample = `<div class="jx-ov-sample" aria-label="What the overlay shows now"><div class="jx-ov-top"><strong>${f.level ? `Level ${f.level}` : "Level"}</strong><span data-no-translate>${esc(f.zone || "")}</span></div>
      ${Number.isFinite(f.xpPercent) ? `<div class="jx-ov-xp"><span class="jx-ov-bar"><span data-w="${Math.round(f.xpPercent)}"></span></span><em>${Math.round(f.xpPercent)}%</em></div>` : ""}
      <div class="jx-ov-row">${Number.isFinite(f.splitSeconds) ? `<div><small data-no-translate>${esc(f.splitLabel)}</small><b>${esc(dur(f.splitSeconds))}</b></div>` : ""}${Number.isFinite(f.deaths) ? `<div><small>Deaths</small><b>${f.deaths}</b></div>` : ""}</div>
      ${f.step ? `<div class="jx-ov-step"><small>Next step</small><p data-no-translate>${esc(f.step)}</p></div>` : ""}</div>`;
    return `<section class="jr-card jx-overlay" data-journey-overlay><div class="jx-head"><div><h2>Stream overlay</h2><p class="jx-lead">A small page for a streaming program such as OBS: level, XP bar, zone, last level time, deaths this session and your next step.</p></div>
        <button type="button" class="jx-switch" data-overlay-toggle aria-pressed="${d.running}"${busy ? " disabled" : ""}>${d.running ? "Switch overlay off" : "Switch overlay on"}</button></div>
      <div class="jx-ov-grid"><div class="jx-panel">
        <h3>${d.running ? "The overlay is on" : "The overlay is off"}</h3>
        ${d.running ? `<label for="jx-ov-url">Address for your streaming program</label><div class="jx-row"><input id="jx-ov-url" type="text" readonly value="${esc(d.url)}" data-no-translate><button type="button" data-overlay-copy>Copy address</button></div>
          <ol class="jx-steps"><li>In OBS, add a <strong>Browser</strong> source.</li><li>Paste the address. Set width 700 and height 300.</li><li>The background is see-through, so place it over your game.</li></ol>`
          : `<p>It is off until you switch it on here. While it is off the app listens to nothing.</p>`}
        <p class="jx-status" role="status" data-overlay-status>${esc(note)}</p>
        <ul class="jx-facts"><li>Only this computer can open it (address 127.0.0.1). Other computers cannot.</li><li>It shows one page and those few facts. It reads no files and takes no input.</li><li>It stops when you switch it off or close the app. It keeps the same port number next time when it can.</li></ul></div>
        <div class="jx-panel"><h3>What it shows now</h3>${sample}<p class="jx-foot">Deaths appear while the live link is on. The time is your last finished level.</p></div></div></section>`;
  }

  // Challenge runs (C12) and the Discord status (S6) are painted by journey-more.js.
  const more = (name) => (d) => window.JourneyMore[name](d, { note, busy, share });
  const PAINT = { story, timeline, races, coach, overlay, ...(window.JourneyMore ? { challenge: more("challenge"), discord: more("discord") } : {}) };
  function load(view, rerender) {
    if (loading[view] || !LOADERS[view]) return;
    const mine = epoch;
    loading[view] = true;
    LOADERS[view]().then((d) => { if (mine !== epoch) return; cache[view] = d ?? null; errors[view] = ""; })
      .catch((e) => { if (mine === epoch) errors[view] = e?.message || "This view is unavailable."; })
      .finally(() => { if (mine !== epoch) return; loading[view] = false; cache[`${view}:loaded`] = true; rerender(); });
  }
  /** HTML for a view; shows a waiting line until its model has arrived. */
  function render(view) {
    if (!PAINT[view]) return "";
    if (errors[view]) return `<p class="jr-empty" role="status">${esc(errors[view])}</p>`;
    if (!cache[`${view}:loaded`]) return wait("Reading what was saved…");
    return PAINT[view](cache[view]);
  }
  const tabs = (active) => `<nav class="jx-views" aria-label="Journey views">${VIEWS.map(([id, label]) => `<button type="button" data-journey-view="${id}" aria-pressed="${active === id}">${label}</button>`).join("")}</nav>`;

  function mounted(root, view, rerender) {
    if (!PAINT[view]) return;
    if (!cache[`${view}:loaded`] && !errors[view]) { load(view, rerender); return; }
    for (const el of root.querySelectorAll(".jx-ov-bar [data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    if (view === "timeline") watchThumbs(root);
    const act = async (work, done) => {
      if (busy) return;
      busy = true; note = "";
      try { const result = await work(); note = typeof done === "function" ? done(result) : done; }
      catch (e) { note = e?.message || "That did not work."; }
      busy = false; rerender();
    };
    if (view === "challenge" || view === "discord") { window.JourneyMore.mounted(root.querySelector("[data-journey-extra]") || root, view, { cache, act, rerender, setNote: (text) => { note = text; } }); return; }
    root.addEventListener("click", (ev) => {
      const show = ev.target.closest("[data-shot-show]"), remove = ev.target.closest("[data-race-remove]");
      if (show) { api.showScreenshot(show.dataset.shotShow).catch((e) => window.toast?.(e.message)); return; }
      if (ev.target.closest("[data-race-copy]")) void act(() => api.copyRaceCode(), "Code copied. Send it to a friend any way you like.");
      else if (ev.target.closest("[data-race-save]")) void act(() => api.saveRaceCode(), (r) => (r?.saved ? "Code saved as a file." : ""));
      else if (ev.target.closest("[data-race-open]")) void act(async () => { const r = await api.openRaceCode(); cache.races = r; return r; }, (r) => (r.added === null ? "" : r.added ? "Friend added to the board." : "That friend is already on the board."));
      else if (remove) void act(async () => { cache.races = await api.removeRaceFriend(remove.dataset.raceRemove); }, "Removed from the board.");
      else if (ev.target.closest("[data-overlay-toggle]")) void act(async () => { const on = !cache.overlay?.running; cache.overlay = await api.setStreamOverlay(on); return on; }, (on) => (on ? "The overlay is on." : "The overlay is off."));
      else if (ev.target.closest("[data-overlay-copy]")) void act(() => api.copyOverlayAddress(), "Address copied.");
    });
    root.querySelector("[data-race-name-form]")?.addEventListener("submit", (ev) => { ev.preventDefault(); const name = ev.currentTarget.elements.name.value; void act(async () => { cache.races = await api.setRaceName(name); }, () => (cache.races?.code ? "Name saved. Your code is ready." : "Name saved.")); });
    root.querySelector("[data-race-add-form]")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const code = ev.currentTarget.elements.code.value;
      if (!code.trim()) { note = "Paste a code first."; rerender(); return; }
      void act(async () => { const r = await api.addRaceCode(code); cache.races = r; return r; }, (r) => (r.added ? "Friend added to the board." : "That friend is already on the board."));
    });
  }
  function invalidate() {
    epoch++; note = ""; busy = false; observer?.disconnect(); thumbQueue = []; window.JourneyMore?.reset();
    for (const k of Object.keys(cache)) delete cache[k];
    for (const k of Object.keys(errors)) delete errors[k];
    for (const k of Object.keys(loading)) delete loading[k];
  }
  return { VIEWS, tabs, render, mounted, invalidate, _paint: PAINT };
})();
