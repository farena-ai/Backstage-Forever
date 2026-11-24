"use strict";
// Adventure → Guided route: project the next step from the last save, not from live guesses.
window.GuidedRouteView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { pickup: "Pick up", class: "Class quest", objective: "Objectives", turnin: "Hand in", travel: "Travel", dungeon: "Dungeon", custom: "Your step" };
  const VARIANT = { solo: "Solo", duo: "Duo", dungeons: "Dungeon-heavy", trips: "Fewest trips", careful: "Careful" };
  const REASON = {
    "no-character": "Import an addon save or choose a saved character.",
    build: "No matching reference for this saved build. Browse only.",
    "route-side": "This route does not match your saved faction.",
    "no-route": "No bundled route for this race.",
    end: "No remaining step in this part of the route.",
    travel: "The last save does not confirm this route transition.",
    reference: "The quest reference does not match the saved evidence.",
    "quest-side": "This quest does not match your faction or race.",
    "missing-location": "No verified route point for this step. The giver or objective location may be missing.",
    level: "This step is above your saved level.",
    "unknown-history": "Saved quest history is unavailable; eligibility is unknown.",
    prerequisite: "A possible prerequisite is not confirmed by the last save.",
    "unconfirmed-pickup": "Quest availability at the giver is not confirmed. Check in game.",
    "not-in-log": "This quest is not in your saved log. That does not mean you finished it.",
    "not-ready": "Your last save does not show this quest ready to hand in.",
    "stale-save": "The last save is too old to recommend a route step. Save again in WoW to refresh the evidence.",
    "unknown-save-time": "The save time is unknown. No route step can be recommended from this save.",
  };
  let mountedFor = null, request = 0, expiryTimer;
  const skipPrefix = "bf-desktop-route-skips-v1:";
  const keyFor = (p) => skipPrefix + JSON.stringify([p.id, p.source?.id, p.clientBuild]);
  function removeSkips(profileId = null) {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(skipPrefix)) continue;
        if (profileId !== null) {
          // A character may have stored skips under more than one source or build.
          let scope;
          try { scope = JSON.parse(key.slice(skipPrefix.length)); } catch { continue; }
          if (!Array.isArray(scope) || scope.length !== 3 || scope[0] !== profileId) continue;
        }
        localStorage.removeItem(key);
      }
    } catch {}
  }
  function readSkips(p) {
    if (!p) return [];
    try {
      const list = JSON.parse(localStorage.getItem(keyFor(p)));
      return Array.isArray(list) ? list.filter((id) => typeof id === "string" && id.length <= 400).slice(0, 512) : [];
    } catch { return []; }
  }
  // 0.51: the hand review. review = { race, page, data } while the review panel is open.
  let review = null, reviewBusy = false, reviewNote = "";
  const gapText = (g) => g.map((x) => `${x.from}–${x.to}`).join(", ");
  function coverage(rows) {
    return `<table class="gr-cov"><thead><tr><th>Race</th><th>Starts in</th><th>Levels covered</th><th>Steps</th><th>Not covered yet</th><th>Reviewed</th></tr></thead><tbody>${rows.map((r) => `<tr class="gr-${esc(r.faction.toLowerCase())}"><td>${esc(r.race)}</td><td>${esc(r.start)}</td><td>${r.from ?? "–"}–${r.to}</td><td>${r.steps}</td><td>${r.gaps.length || r.to < 60 ? esc([gapText(r.gaps), r.to < 60 ? `${r.to + 1}–60` : ""].filter(Boolean).join(", ")) : "–"}</td><td>${r.reviewed} of ${r.steps}</td></tr>`).join("")}</tbody></table>`;
  }
  function body(d, owner) {
    const { step, reason, map, quest, fallback, skipped } = d.recovery;
    // A dungeon visit or a step of your own has a map point but no quest behind it.
    const focus = map && (quest ? { ...map, routeBuild: d.build, routeSource: owner.source.id, kind: step.kind === "turnin" ? "quest-turnin" : "quest-objective", label: quest.title,
      source: "Approximate route reference", goal: { title: quest.title, questId: quest.id } }
      : { mapId: map.mapId, x: map.x, y: map.y, label: step.text.slice(0, 80), source: step.kind === "custom" ? "Your own route step" : "Classic-era baseline (approximate entrance)" });
    const primary = focus ? `<button type="button" class="gr-map" data-map-focus="${esc(JSON.stringify(focus))}">Show on Map</button>`
      : fallback ? `<button type="button" class="gr-map" data-quest-open="${fallback.id}" data-ledger-quest-profile="${esc(d.profileId)}">Open saved quest</button>`
      : "";
    return `<section class="gr-card" data-gr-recovery aria-labelledby="gr-heading"><h2 id="gr-heading" tabindex="-1">Resume your route</h2>
      ${owner ? `<p class="gr-note"><b>${esc(owner.name)}</b>${owner.source?.updatedAt ? ` · ${esc(new Date(owner.source.updatedAt).toLocaleString())} · <span>Last saved · not live</span>` : ""}</p>` : ""}
      ${step ? `<p class="gr-note"><span>${esc(KIND[step.kind] || step.kind)}</span> · ${step.index + 1} / ${d.route.total}${d.route.variant && d.route.variant !== "solo" ? ` · <span>${esc(VARIANT[d.route.variant] || "")}</span>` : ""}</p><p><strong data-no-translate>${esc(step.text)}</strong></p>` : ""}
      ${step?.note ? `<p class="gr-step-note"><b>Your note:</b> <span data-no-translate>${esc(step.note)}</span></p>` : ""}
      ${reason ? `<p>${esc(REASON[reason])}</p>` : map ? `<p class="gr-note">${esc(d.mapName || `Map ${map.mapId}`)} · <span>${step.kind === "custom" ? "Your own map point" : "Approximate route reference"}</span></p>` : `<p class="gr-note">${step.kind === "custom" ? "A step you wrote. It has no map point. Skip it when you are done." : "No map point is known for this step."}</p>`}
      ${reason ? `<p class="gr-note"><strong>Plan B:</strong> ${fallback ? `<span>In your saved quest log</span> · ${esc(fallback.title)}` : "No supported alternative in the last save."}</p>` : ""}
      <div class="gr-recovery-actions">${primary}${step && skipped.length < d.skipLimit ? `<button type="button" class="gr-ghost" data-gr-player="skip">Skip this step</button>` : ""}${skipped.length ? `<button type="button" class="gr-ghost" data-gr-player="restore">Restore skipped steps</button>` : ""}</div>
      ${skipped.length ? `<p class="gr-note">${skipped.length} · <span>Skipped here, not completed in game.</span></p>` : ""}
    </section>
    <details class="gr-card gr-coverage"><summary>How far each route reaches</summary><div>${coverage(d.coverage)}</div><p class="gr-note">Level ranges are reference coverage, not a continuous guide. Missing givers may leave quests out.</p></details>
    <p class="gr-how"><span>Desktop skips stay here. In WoW, use</span> <code>/bf route guide</code>.</p>`;
  }
  function reviewPanel() {
    if (!review) return `<section class="gr-card gr-review-closed"><h2>Review the routes</h2><p>Go through any race's route step by step: ✓ keeps a step, ✗ leaves it out, ↑ ↓ move it. Your review shows here at once; <strong>Export review</strong> saves it as <code>reviews.json</code>, and the next release builds it into the addon.</p><button type="button" class="gr-map" data-gr-review="open">Start reviewing</button></section>`;
    const r = review.data;
    if (!r) return `<section class="gr-card"><h2>Review the routes</h2><p>${reviewBusy ? "Reading the route…" : esc(reviewNote || "Choose a race.")}</p></section>`;
    const pager = `<span class="gr-pager"><button type="button" class="gr-map" data-gr-page="${r.page - 1}"${r.page ? "" : " disabled"}>‹ Earlier</button> page ${r.page + 1} of ${r.pages} <button type="button" class="gr-map" data-gr-page="${r.page + 1}"${r.page + 1 < r.pages ? "" : " disabled"}>Later ›</button></span>`;
    return `<section class="gr-card gr-review"><h2>Review the routes</h2>
      <div class="gr-review-bar"><label>Race <select data-gr-race>${r.races.map((x) => `<option${x === r.race ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      <span>${r.approved} kept · ${r.skipped} left out · ${r.total} steps</span>${pager}
      <button type="button" class="gr-map" data-gr-review="export">Export review</button><button type="button" class="gr-ghost" data-gr-review="close">Close</button></div>
      ${reviewNote ? `<p class="gr-note">${esc(reviewNote)}</p>` : ""}
      <ol class="gr-steps gr-review-list" start="${r.steps[0]?.n || 1}">${r.steps.map((s) => `<li class="gr-step gr-${esc(s.kind)}${s.approved ? " ok" : ""}${s.skipped ? " out" : ""}" data-gr-id="${esc(s.id)}"><span class="gr-kind">${esc(KIND[s.kind] || s.kind)} · level ${s.level}${s.approved ? " · ✓ kept" : ""}${s.skipped ? " · ✗ left out" : ""}</span><strong>${esc(s.text)}</strong>${s.mapName ? `<small>${esc(s.mapName)}${Number.isFinite(s.x) ? ` · ${(s.x * 100).toFixed(1)}, ${(s.y * 100).toFixed(1)}` : ""}</small>` : ""}
        <span class="gr-acts"><button type="button" title="Keep this step" aria-label="Keep step ${s.n}" data-gr-act="approve">✓</button><button type="button" title="Leave this step out" aria-label="Leave out step ${s.n}" data-gr-act="skip">✗</button><button type="button" title="Move up" aria-label="Move step ${s.n} up" data-gr-act="up">↑</button><button type="button" title="Move down" aria-label="Move step ${s.n} down" data-gr-act="down">↓</button>${s.approved || s.skipped ? `<button type="button" title="Undo" aria-label="Undo step ${s.n}" data-gr-act="clear">↺</button>` : ""}</span></li>`).join("")}</ol>${pager}</section>`;
  }
  async function loadReview(race, pageNo) {
    reviewBusy = true; paintReview();
    try { const d = await api.routeReview({ race, page: pageNo }); review = { race: d?.race || race, page: d?.page ?? pageNo, data: d }; } catch (e) { reviewNote = e.message || "The review is unavailable."; }
    reviewBusy = false; paintReview();
  }
  function paintReview() { const el = document.querySelector("[data-gr-review-slot]"); if (el) el.innerHTML = reviewPanel(); }
  const reading = '<p class="gr-empty" role="status">Reading the route…</p>';
  function retireRecovery() {
    request++;
    clearTimeout(expiryTimer);
    const slot = document.querySelector("[data-guided-route-body]");
    if (slot) {
      slot.innerHTML = reading;
      window.I18n?.apply(slot);
    }
  }
  function page() {
    return `<section class="guided-route-page" data-guided-route>${PageHero.render({ art: "quests", eyebrow: "Adventure · Guided route", title: "Your route, step by step", subtitle: "Find your place from your last save, or see what is missing." })}
      <div data-guided-route-body>${reading}</div><div class="re-slot" data-route-editor-slot></div><div data-gr-review-slot>${reviewPanel()}</div></section>`;
  }
  function mounted() {
    const root = document.querySelector("[data-guided-route]");
    if (mountedFor === root) return;
    clearTimeout(expiryTimer);
    mountedFor = root;
    if (!root) return;
    const owner = profile(), slot = root.querySelector("[data-guided-route-body]");
    let data = null, busy = false;
    const current = () => !characterSelectionPending() && root.isConnected && mountedFor === root && profile() === owner;
    function expire() {
      if (!Number.isFinite(data?.recovery.freshUntil) || Date.now() < data.recovery.freshUntil) return false;
      data = { ...data, recovery: { reason: "stale-save", skipped: data.recovery.skipped } };
      slot.innerHTML = body(data, owner); // body() escapes dynamic text and JSON attributes.
      window.I18n?.apply(slot);
      return true;
    }
    async function load(skips = readSkips(owner), save = false) {
      const id = ++request;
      clearTimeout(expiryTimer);
      busy = true;
      try {
        const next = await api.guidedRoute({ profileId: owner?.id ?? null, skips });
        if (!current() || id !== request) return;
        if (!next || next.profileId !== (owner?.id ?? null) || next.build !== (owner?.clientBuild ?? null)) throw Error();
        if (save) localStorage.setItem(keyFor(owner), JSON.stringify(next.recovery.skipped));
        data = next;
        if (!expire()) {
          slot.innerHTML = body(data, owner);
          window.I18n?.apply(slot);
          if (Number.isFinite(data.recovery.freshUntil)) expiryTimer = setTimeout(() => {
            if (id === request && current()) expire();
          }, Math.max(0, data.recovery.freshUntil - Date.now()));
        }
        if (save) slot.querySelector("#gr-heading").focus();
      } catch {
        if (!current() || id !== request) return;
        data = null;
        slot.innerHTML = `<p class="gr-empty">The guided route is unavailable.</p><button type="button" class="gr-map" data-gr-player="retry">Try again</button>`;
        window.I18n?.apply(slot);
      } finally { if (id === request) busy = false; }
    }
    root.addEventListener("click", async (e) => {
      if (slot.contains(e.target) && (!current() || busy)) { e.stopPropagation(); return; }
      // Timers may be suspended or the wall clock may jump while the desktop sleeps.
      if (slot.contains(e.target) && expire()) { e.stopPropagation(); slot.querySelector("#gr-heading")?.focus(); return; }
      const player = e.target.closest?.("[data-gr-player]")?.dataset.grPlayer;
      if (player === "retry") return load();
      if (player === "skip" && data?.recovery.step) return load([...data.recovery.skipped, data.recovery.step.id], true);
      if (player === "restore" && data?.recovery.skipped.length) return load([], true);
      const open = e.target.closest?.("[data-gr-review]")?.dataset.grReview;
      if (open === "open") { reviewNote = ""; return loadReview(data?.route?.race || "Human", 0); }
      if (open === "close") { review = null; reviewNote = ""; return paintReview(); }
      if (open === "export") { try { const ok = await api.exportRouteReview(); reviewNote = ok ? "Review exported. Put the file in data/forever-route/reviews.json for the next release." : ""; } catch (err) { reviewNote = err.message || "Export failed."; } return paintReview(); }
      const pg = e.target.closest?.("[data-gr-page]")?.dataset.grPage;
      if (pg !== undefined && review) return loadReview(review.race, Number(pg));
      const act = e.target.closest?.("[data-gr-act]")?.dataset.grAct, id = e.target.closest?.("[data-gr-id]")?.dataset.grId;
      if (act && id && review && !reviewBusy) {
        try { await api.setRouteReview({ race: review.race, id, action: act }); reviewNote = ""; if (current()) void load(); } catch (err) { reviewNote = err.message || "That change could not be saved."; }
        return loadReview(review.race, review.page);
      }
    });
    root.addEventListener("change", (e) => { if (e.target.matches?.("[data-gr-race]")) loadReview(e.target.value, 0); });
    if (current()) void load();
    // Q8/Q9: the route choice and the editor; an edit there refreshes the step above.
    if (current()) window.RouteEditorView?.mount(root, owner, () => { if (current()) void load(); });
  }
  return { page, mounted, retireRecovery, removeSkips };
})();
