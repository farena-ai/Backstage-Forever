"use strict";
// Adventure → Guided route: the route choice (Q8) and the route editor with its share code (Q9).
// The main process builds every route and checks every edit; this file paints the model it
// returns and sends one action per click. Notes and step text are always written as escaped
// text, never as HTML.
window.RouteEditorView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { pickup: "Pick up", class: "Class quest", objective: "Objectives", turnin: "Hand in", travel: "Travel", dungeon: "Dungeon", custom: "Your step" };
  let data = null, note = "", busy = false, open = null, confirmReset = false, failed = false, request = 0;

  function numbers(v) {
    const n = v.numbers;
    if (!n) return "No route for this race.";
    return [`${n.steps} steps`, `${n.quests} quests`, n.reachesLevel ? `to level ${n.reachesLevel}` : "", v.id === "dungeons" ? `${n.dungeonVisits} dungeon visits` : "",
      v.id === "duo" || v.id === "solo" ? `${n.eliteQuests} with elite targets` : "", v.id === "trips" ? `${n.stops} stops at people` : ""].filter(Boolean).join(" · ");
  }
  function chooser(d) {
    return `<section class="gr-card re-card" data-route-choice aria-labelledby="re-choice-h"><h2 id="re-choice-h">Route choice</h2>
      <p class="re-lead">Pick how this character's route is built. Each choice says what it changes and what it cannot know. Your edits stay when you switch.</p>
      <div class="re-variants" role="group" aria-label="Route choice">${d.variants.map((v) => `<button type="button" class="re-variant" data-re-variant="${esc(v.id)}" aria-pressed="${v.id === d.variant}"${busy || !d.profileId ? " disabled" : ""}>
        <strong>${esc(v.name)}</strong><span class="re-chg">${esc(v.changes)}</span><span class="re-cannot"><b>Cannot know:</b> <span>${esc(v.cannot)}</span></span><small data-no-translate>${esc(numbers(v))}</small></button>`).join("")}</div></section>`;
  }
  const editCount = (e) => [[e.notes, "note", "notes"], [e.skipped, "skipped step", "skipped steps"], [e.moved, "move", "moves"], [e.custom, "step of your own", "steps of your own"]]
    .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(" · ");
  function noteForm(s, limits) {
    return `<form class="re-form" data-re-note-form="${esc(s.id)}"><label for="re-note-input">Note for this step</label><div class="re-form-row"><input id="re-note-input" name="note" type="text" maxlength="${limits.note}" value="${esc(s.note)}" autocomplete="off" data-no-translate>
      <button type="submit" class="gr-map">Save note</button>${s.note ? `<button type="button" class="gr-ghost" data-re-clear-note="${esc(s.id)}">Remove note</button>` : ""}<button type="button" class="gr-ghost" data-re-cancel>Cancel</button></div></form>`;
  }
  function addForm(after, r) {
    return `<form class="re-form" data-re-add-form="${esc(after ?? "")}"><label for="re-add-text">${after === null ? "Your own step, at the start of the route" : "Your own step, after this one"}</label>
      <div class="re-form-row"><input id="re-add-text" name="text" type="text" maxlength="${r.limits.customText}" required autocomplete="off" placeholder="Train First Aid in town" data-no-translate></div>
      <div class="re-form-row re-point"><label for="re-add-zone">Map point (optional)</label><select id="re-add-zone" name="zone"><option value="">No map point</option>${r.zones.map((z) => `<option value="${z.mapId}">${esc(z.name)}</option>`).join("")}</select>
        <span class="re-pair"><label for="re-add-x">X</label><input id="re-add-x" name="x" type="number" min="0" max="100" step="0.1" inputmode="decimal"></span><span class="re-pair"><label for="re-add-y">Y</label><input id="re-add-y" name="y" type="number" min="0" max="100" step="0.1" inputmode="decimal"></span>
        <button type="submit" class="gr-map">Add step</button><button type="button" class="gr-ghost" data-re-cancel>Cancel</button></div></form>`;
  }
  function row(s, r) {
    const where = s.mapName ? `${s.mapName}${s.x !== null ? ` · ${(s.x * 100).toFixed(1)}, ${(s.y * 100).toFixed(1)}` : ""}` : s.custom ? "No map point" : "";
    const here = s.id === r.here;
    return `<li class="gr-step re-step gr-${esc(s.kind)}${s.skipped ? " out" : ""}${here ? " here" : ""}" data-re-id="${esc(s.id)}" draggable="${busy ? "false" : "true"}">
      <span class="re-grip" aria-hidden="true" title="Drag to move">⠿</span>
      <span class="gr-kind"><span>${esc(KIND[s.kind] || s.kind)}</span> · <span data-no-translate>${s.level}</span>${here ? ' · <em>You are here</em>' : ""}${s.skipped ? ' · <span class="re-flag">Skipped</span>' : ""}</span>
      <strong data-no-translate>${esc(s.text)}</strong>${where ? `<small data-no-translate>${esc(where)}</small>` : ""}
      ${s.note ? `<p class="re-note"><b>Your note:</b> <span data-no-translate>${esc(s.note)}</span></p>` : ""}
      <span class="gr-acts re-acts"><button type="button" title="Move up" aria-label="Move step ${s.n} up" data-re-act="up">↑</button><button type="button" title="Move down" aria-label="Move step ${s.n} down" data-re-act="down">↓</button>
        <button type="button" title="${s.skipped ? "Put this step back" : "Skip this step"}" aria-label="${s.skipped ? `Put step ${s.n} back` : `Skip step ${s.n}`}" data-re-act="${s.skipped ? "unskip" : "skip"}">${s.skipped ? "↺" : "✗"}</button>
        <button type="button" title="${s.note ? "Change the note" : "Add a note"}" aria-label="Note for step ${s.n}" data-re-open="note">✎</button><button type="button" title="Add your own step after this one" aria-label="Add your own step after step ${s.n}" data-re-open="add">＋</button>
        ${s.custom ? `<button type="button" title="Remove your step" aria-label="Remove step ${s.n}" data-re-act="remove">−</button>` : ""}</span>
      ${open?.id === s.id ? (open.kind === "note" ? noteForm(s, r.limits) : addForm(s.id, r)) : ""}</li>`;
  }
  function editor(d) {
    const r = d.route;
    if (!d.profileId) return "";
    if (!r) return `<section class="gr-card re-card" data-route-editor><h2>Edit your route</h2><p class="re-lead">There is no bundled route for this character's race, so there is nothing to edit.</p></section>`;
    const e = r.edits, count = editCount(e);
    const pager = `<span class="gr-pager"><button type="button" class="gr-map" data-re-page="${r.page - 1}"${r.page && !busy ? "" : " disabled"}>‹ Earlier</button><span data-no-translate>${r.page + 1} / ${r.pages}</span><button type="button" class="gr-map" data-re-page="${r.page + 1}"${r.page + 1 < r.pages && !busy ? "" : " disabled"}>Later ›</button></span>`;
    return `<section class="gr-card re-card" data-route-editor aria-labelledby="re-edit-h"><div class="re-head"><h2 id="re-edit-h">Edit your route</h2>${pager}</div>
      <p class="re-lead">Move steps with the arrows or by dragging, skip steps, write a note on a step or add steps of your own. Edits belong to this character and stay when the route is rebuilt, as long as the step still exists.</p>
      <p class="re-count" data-re-count><b>Your edits:</b> <span data-no-translate>${esc(count || "none yet")}</span>${e.lost ? ` · <span data-no-translate>${e.lost}</span> <span>wait for steps this route does not have</span>` : ""}${r.hereNumber ? ` · <span>You are at step</span> <span data-no-translate>${r.hereNumber} / ${r.total}</span>` : ""}</p>
      <div class="re-tools"><button type="button" class="gr-map" data-re-code="copy"${r.canShare && !busy ? "" : " disabled"}>Copy share code</button><button type="button" class="gr-map" data-re-code="save"${r.canShare && !busy ? "" : " disabled"}>Save as file</button>
        <button type="button" class="gr-map" data-re-code="open"${busy ? " disabled" : ""}>Open a code file</button>${r.page === 0 ? `<button type="button" class="gr-ghost" data-re-open-top="add"${busy ? " disabled" : ""}>Add a step at the start</button>` : ""}
        ${count ? `<button type="button" class="gr-ghost" data-re-reset${busy ? " disabled" : ""}>${confirmReset ? "Really remove every edit?" : "Remove all edits"}</button>` : ""}</div>
      <form class="re-form re-import" data-re-import-form><label for="re-code">Paste a route code from someone else</label><div class="re-form-row"><input id="re-code" name="code" type="text" autocomplete="off" spellcheck="false" placeholder="BFROUTE1…" data-no-translate><button type="submit" class="gr-map"${busy ? " disabled" : ""}>Import code</button></div>
        <small>Importing replaces this character's edits. Only codes made by this app are read; anything else is refused whole.</small></form>
      <p class="re-status" role="status" data-re-status>${esc(note)}</p>
      ${open?.id === null && open.kind === "add" ? addForm(null, r) : ""}
      <ol class="gr-steps re-list" start="${r.steps[0]?.n || 1}">${r.steps.map((s) => row(s, r)).join("")}</ol>
      <div class="re-foot">${pager}</div>
      <p class="re-lead re-game"><b>In WoW:</b> <span>${r.inGame ? "After the addon is prepared again, /reload shows the next steps of this route in /bf route guide, with your notes. When they are done the built-in route takes over until your next save." : "This route is the one the addon already carries, so nothing extra is sent to the game."}</span>${r.inGame ? ` <span data-no-translate>(${r.inGame})</span>` : ""}</p>
    </section>`;
  }
  function html() {
    if (failed) return `<section class="gr-card re-card"><h2>Route choice</h2><p class="re-lead">The route choice is unavailable.</p><button type="button" class="gr-map" data-re-retry>Try again</button></section>`;
    if (!data) return "";
    return chooser(data) + editor(data);
  }

  /** root: the guided-route page; owner: the selected profile (or null); changed: called after an edit. */
  function mount(root, owner, changed) {
    const slot = root.querySelector("[data-route-editor-slot]");
    if (!slot) return;
    data = null; note = ""; busy = false; open = null; confirmReset = false; failed = false;
    const mine = ++request;
    const current = () => mine === request && slot.isConnected;
    const paint = (focus = null) => {
      if (!current()) return;
      slot.innerHTML = html(); // html() escapes every value it places.
      window.I18n?.apply(slot);
      if (focus) slot.querySelector(focus)?.focus();
    };
    const profileId = owner?.id ?? null;
    async function load(page = null) {
      try { const next = await api.routeEditor({ profileId, page }); if (!current()) return; data = next; failed = !next; }
      catch { if (!current()) return; failed = true; }
      paint();
    }
    async function act(work, done = "", focus = null) {
      if (busy || !current()) return;
      busy = true; note = "";
      try {
        const next = await work();
        if (!current()) return;
        if (next && typeof next === "object" && "variants" in next) { data = next; note = next.note || (typeof done === "function" ? done(next) : done); changed(); }
        else note = typeof done === "function" ? done(next) : done;
      } catch (e) { if (!current()) return; note = e?.message || "That did not work."; }
      busy = false; paint(focus);
    }
    const edit = (action, done, focus) => act(() => api.routeEdit({ profileId, action, page: data?.route?.page ?? null }), done, focus);
    slot.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t.closest("[data-re-retry]")) return void load();
      if (!data || busy) return;
      const variant = t.closest("[data-re-variant]")?.dataset.reVariant;
      if (variant) { if (variant !== data.variant) { open = null; void edit({ type: "variant", variant }, "Route choice saved.", `[data-re-variant="${variant}"]`); } return; }
      const pg = t.closest("[data-re-page]")?.dataset.rePage;
      if (pg !== undefined) { open = null; busy = true; void load(Number(pg)).finally(() => { busy = false; paint(); }); return; }
      const code = t.closest("[data-re-code]")?.dataset.reCode;
      if (code === "copy") return void act(() => api.copyRouteCode({ profileId }), "Code copied. Send it any way you like.");
      if (code === "save") return void act(() => api.saveRouteCode({ profileId }), (r) => (r?.saved ? "Code saved as a file." : ""));
      if (code === "open") return void act(() => api.openRouteCode({ profileId }), "");
      if (t.closest("[data-re-reset]")) { if (!confirmReset) { confirmReset = true; return paint("[data-re-reset]"); } confirmReset = false; open = null; return void edit({ type: "reset" }, "All edits removed."); }
      if (confirmReset) { confirmReset = false; }
      if (t.closest("[data-re-cancel]")) { open = null; return paint(); }
      if (t.closest("[data-re-open-top]")) { open = { kind: "add", id: null }; return paint("#re-add-text"); }
      const id = t.closest("[data-re-id]")?.dataset.reId;
      const clear = t.closest("[data-re-clear-note]")?.dataset.reClearNote;
      if (clear) { open = null; return void edit({ type: "note", id: clear, text: "" }, "Note removed."); }
      const opens = t.closest("[data-re-open]")?.dataset.reOpen;
      if (opens && id) { open = open?.id === id && open.kind === opens ? null : { kind: opens, id }; return paint(opens === "note" ? "#re-note-input" : "#re-add-text"); }
      const what = t.closest("[data-re-act]")?.dataset.reAct;
      if (what && id) { open = null; return void edit({ type: what, id }, { skip: "Step skipped here. It is not marked as done in the game.", unskip: "Step put back.", remove: "Your step was removed." }[what] || ""); }
    });
    slot.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!data || busy) return;
      const f = ev.target;
      if (f.matches("[data-re-note-form]")) { const id = f.dataset.reNoteForm, text = f.elements.note.value.trim(); open = null; void edit({ type: "note", id, text }, text ? "Note saved." : "Note removed."); }
      else if (f.matches("[data-re-add-form]")) {
        const zone = f.elements.zone.value, x = f.elements.x.value, y = f.elements.y.value;
        const point = zone || x || y ? { mapId: Number(zone) || 0, x: x === "" ? -1 : Number(x) / 100, y: y === "" ? -1 : Number(y) / 100 } : {};
        const action = { type: "add", text: f.elements.text.value, after: f.dataset.reAddForm || null, ...point };
        open = null; void edit(action, "Your step was added.");
      } else if (f.matches("[data-re-import-form]")) {
        const code = f.elements.code.value.trim();
        if (!code) { note = "Paste a code first."; return paint("#re-code"); }
        open = null; void act(() => api.importRouteCode({ profileId, code }), "");
      }
    });
    // Drag a step onto another: it lands after that step when dragged down, before it when dragged up.
    let dragged = null;
    slot.addEventListener("dragstart", (ev) => {
      const li = ev.target.closest?.("[data-re-id]");
      if (!li || busy || ev.target.closest("input, select, button, form")) { ev.preventDefault(); return; }
      dragged = li.dataset.reId; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", dragged); li.classList.add("dragging");
    });
    slot.addEventListener("dragend", () => { dragged = null; for (const el of slot.querySelectorAll(".dragging, .drop")) el.classList.remove("dragging", "drop"); });
    slot.addEventListener("dragover", (ev) => {
      const li = ev.target.closest?.("[data-re-id]");
      if (!dragged || !li || li.dataset.reId === dragged) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
      for (const el of slot.querySelectorAll(".drop")) if (el !== li) el.classList.remove("drop");
      li.classList.add("drop");
    });
    slot.addEventListener("drop", (ev) => {
      const li = ev.target.closest?.("[data-re-id]"), id = dragged;
      dragged = null;
      if (!id || !li || !data?.route || li.dataset.reId === id) return;
      ev.preventDefault();
      const ids = data.route.steps.map((s) => s.id), from = ids.indexOf(id), to = ids.indexOf(li.dataset.reId);
      if (from < 0 || to < 0) return;
      // The first row of a later page follows a step on the page before, which this page does not know.
      if (from > to && to === 0 && data.route.page) { note = "To move a step to an earlier page, use the up arrow."; return paint(); }
      const after = from < to ? ids[to] : to > 0 ? ids[to - 1] : null;
      open = null; void edit({ type: "move", id, after }, "Step moved.");
    });
    void load();
  }
  return { mount, _html: (d) => { data = d; failed = false; return html(); } };
})();
