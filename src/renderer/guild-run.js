"use strict";
// A local event sheet within Plans → Party. The main process owns reviewed snapshots and writes.
window.GuildRun = (() => {
  const roles = { all: "Everyone", tank: "Tank", healer: "Healer", damage: "Damage" };
  const boardRoles = { tank: roles.tank, healer: roles.healer, damage: roles.damage };
  const rsvps = { yes: "Yes", maybe: "Maybe", no: "No" };
  const slots = { assigned: "Assigned", bench: "Bench", backup: "Backup" };
  const debriefFields = {
    attendance: ["Confirmed attendance", 64, 80], progression: ["Progression", 16, 240],
    assignments: ["Assignments", 16, 240], followUps: ["Follow-ups", 16, 240],
  };
  const outcomes = {
    imported: "New run. Adding it starts a private, unchecked prep list.",
    updated: "Newer revision. Only checks for unchanged prep actions carry forward.",
    duplicate: "This revision is already saved.",
    stale: "A newer revision is already saved. This copy cannot replace it.",
    conflict: "This copy conflicts with the saved run. Nothing will be replaced.",
  };
  let host, generation = 0, panel = null, draft = null, base = null, starter = "create", busy = false, notice = "", error = "";
  const e = value => host.esc(value);
  const call = (...args) => host.api.guildRun(...args);
  const control = key => `data-party-control="guild-${key}"`;
  const button = (op, label, arg = "", primary = false) => `<button type="button" ${control(op + (arg ? "-" + e(arg) : ""))} data-guild-action="${op}" data-guild-arg="${e(arg)}" ${primary ? 'class="primary"' : ""} ${busy ? "disabled" : ""}>${e(label)}</button>`;
  const heading = text => `<h3 id="guild-run-panel-title" tabindex="-1" ${control("panel")}>${e(text)}</h3>`;
  const actions = content => `<div class="guild-run-actions">${content}</div>`;
  const textPreview = ({ text, viewerTime }, sharing = false) => `<p data-guild-viewer-time>Viewer time (only shown here): ${e(viewerTime)}</p>${sharing ? '<p id="guild-run-share-label">Shareable plain text</p>' : ""}<pre class="guild-run-copy" ${sharing ? 'aria-labelledby="guild-run-share-label"' : ""}>${e(text)}</pre>`;
  const key = pack => ({ eventId: pack.eventId, revision: pack.revision });
  const lines = text => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  function form(value = {}) {
    draft = { title: "", destination: "", meetingPoint: "", local: "", timeZone: "", offset: "", ...value,
      prep: (value.prep || []).join("\n") };
    for (const role of Object.keys(roles)) draft[role] = (value.duties || []).filter(d => d.role === role).map(d => d.text).join("\n");
    panel = { kind: "form" };
  }
  function field(name, label, options) {
    return `<label>${label}<input ${control(name)} data-guild-field="${name}" value="${e(draft[name])}" ${options} required></label>`;
  }
  function textarea(name, label) {
    return `<label><span id="guild-field-${name}">${label}</span><textarea aria-labelledby="guild-field-${name}" ${name === "prep" ? 'aria-describedby="guild-prep-help"' : ""} ${control(name)} data-guild-field="${name}" rows="2" maxlength="${name === "prep" ? 7712 : 3856}">${e(draft[name])}</textarea></label>`;
  }
  function editor() {
    return `${heading(base ? "Write the next revision" : starter === "template" ? "Plan a newcomer dungeon run" : "Write a run pack")}
      <p>Enter only what you intend to share. Character facts and private completion are not included; any personal wording you type is retained.</p>
      <form data-guild-form>
        <div class="guild-run-grid">${field("title", "Run title", 'maxlength="100"')}${field("destination", "Destination", 'maxlength="120"')}${field("meetingPoint", "Meeting point", 'maxlength="160"')}
        ${field("local", "Organizer date and time", 'type="datetime-local"')}${field("timeZone", "Named time zone", 'maxlength="80" placeholder="America/New_York"')}${field("offset", "UTC offset at start", 'maxlength="6" placeholder="-05:00" aria-describedby="guild-time-help"')}</div>
        <p id="guild-time-help">Use the UTC offset at the run date, such as −05:00 (type a regular minus). If the clocks go back, the offset chooses which occurrence you mean. Skipped times are not valid.</p>
        <fieldset><legend>Role duties · optional, one per line (up to 16 total)</legend><div class="guild-run-grid">${Object.entries(roles).map(([role, label]) => textarea(role, `${label} duties`)).join("")}</div></fieldset>
        <p id="guild-prep-help">One per line, up to 32. Each duty or action can use up to 240 characters.</p>
        ${textarea("prep", "Prep actions")}
        ${actions(`<button type="submit" class="primary" ${control("preview")} ${busy ? "disabled" : ""}>Preview run</button>${button("close", "Close run panel")}`)}
      </form>`;
  }
  function savedList({ organized, received }) {
    const list = (op, records) => records.length ? `<ul>${records.map(p => `<li>${button(op, `${p.title} · revision ${p.revision} · ${p.status === "cancelled" ? "Cancelled" : "Scheduled"}`, p.eventId)}</li>`).join("")}</ul>` : "<p>None yet.</p>";
    return `${heading("Saved runs on this installation")}
      <div class="guild-run-grid"><section><h4>Organized runs</h4>${list("organized", organized)}</section><section><h4>Received runs</h4>${list("received", received)}</section></div>
      ${actions(button("close", "Close run panel"))}`;
  }
  function reviewView({ kind, value }) {
    const { pack, outcome } = value;
    if (kind === "incoming") {
      const confirm = outcome === "imported" ? "Add received run" : outcome === "updated" ? "Apply received revision" : "";
      return `${heading("Review the received run")}<p>${outcomes[outcome]}</p>${textPreview(value)}${actions(`${confirm ? button("accept", confirm, "", true) : ""}${button("close", "Close run panel")}`)}`;
    }
    if (kind === "unsaved") return `${heading("Review the run before sharing")}
      <p>${pack.status === "cancelled" ? "Save this cancellation as the next revision, then share it manually. You cannot reopen a cancelled run; create a new one if needed." : "Check the start time and every line for private wording. Only this reviewed run will be exported; saving it locally does not share it."}</p>
      ${textPreview(value, true)}${actions(`${button("save", "Save run locally", "", true)}${draft && pack.status === "scheduled" ? button("back", "Back to edit") : ""}${button("close", "Close run panel")}`)}`;
    const scheduled = pack.status === "scheduled";
    return `${heading("Reviewed run · ready to export")}
      <div class="guild-run-groups">
        <section aria-labelledby="guild-local-actions"><h4 id="guild-local-actions">Local organizer work</h4>
          ${actions(button("board", "Open organizer board") + button("debrief", "Open officer debrief") + button("officerLog", "Open private officer log"))}</section>
        <section aria-labelledby="guild-share-actions"><h4 id="guild-share-actions">Files to share yourself</h4>
          ${actions(button("export", "Export JSON", "json", true) + button("export", "Export plain text", "text") + (scheduled ? button("welcomeWrite", "Write public welcome copy") : ""))}</section>
      </div>
      ${actions((scheduled ? button("edit", "Edit next revision") + button("cancelRun", "Review cancellation") : "") + button("close", "Close run panel"))}
      ${textPreview(value, true)}`;
  }
  const entryLabel = entry => `${entry.name} · ${boardRoles[entry.role]} · ${rsvps[entry.rsvp]} · ${slots[entry.slot]}`;
  const targetLabel = value => Object.entries(boardRoles).map(([role, label]) => `${label} ${value[role]}`).join(", ");
  function organizerView({ value: { pack }, board, entry, targets }) {
    const locked = busy ? "disabled" : "";
    const submit = (name, label) => `<button type="submit" ${control(name)} ${locked}>${label}</button>`;
    const select = (name, label, choices) => `<label for="guild-board-${name}"><span id="guild-board-label-${name}">${label}</span><select id="guild-board-${name}" aria-labelledby="guild-board-label-${name}" ${control("board-" + name)} data-board-field="${name}">${Object.entries(choices).map(([key, title]) => `<option value="${key}" ${entry[name] === key ? "selected" : ""}>${title}</option>`).join("")}</select></label>`;
    const editor = entry && !board.readOnly ? `<form data-board-form="entry"><fieldset ${locked}><legend>${entry.id ? "Edit RSVP entry" : "New RSVP entry"}</legend><div class="guild-run-grid">
      <label>Name or label<input required maxlength="80" ${control("board-name")} data-board-field="name" value="${e(entry.name)}"></label>
      ${select("role", "Role", boardRoles)}${select("rsvp", "RSVP", rsvps)}${select("slot", "Placement", slots)}</div>
      ${actions(submit("board-save", "Save entry") + (entry.id ? button("boardRemove", "Remove entry from this run", entry.id) : "") + button("boardDiscard", "Discard entry edits"))}</fieldset></form>` : "";
    const targetForm = board.readOnly ? "" : `<form data-board-form="targets"><fieldset ${locked}><legend>Coverage targets</legend><div class="guild-run-grid">${Object.entries(boardRoles).map(([role, label]) => `<label>${label} target<input type="number" required min="0" max="64" step="1" ${control("board-target-" + role)} data-board-target="${role}" value="${e(targets[role])}"></label>`).join("")}</div>
      ${actions(submit("board-target-save", "Save coverage targets"))}</fieldset></form>`;
    return `${heading("Local organizer board")}<p>${e(pack.title)} · Run Pack revision ${pack.revision}</p>
      <p>Manual RSVPs and assignments for this run only. They stay on this installation and do not indicate attendance or guild membership. Nothing is sent, and no one is invited or promoted.</p>
      ${actions(button("boardBack", "Back to run pack") + (board.readOnly ? "" : button("boardEntry", "Add RSVP entry")))}
      ${board.readOnly ? "<p>Cancelled run: this board is read-only.</p>" : ""}${editor}
      <h4>Role coverage</h4><p>Only assigned Yes responses fill targets. Maybes are tentative; bench and backup are not counted.</p>
      <ul>${Object.entries(board.coverage).map(([role, c]) => `<li>${boardRoles[role]}: ${c.yes} yes, ${c.maybe} maybe · target ${c.target} · ${c.gap} open</li>`).join("")}</ul>${targetForm}
      <h4>Manual RSVP entries</h4>${board.entries.length ? `<ul>${board.entries.map(row => `<li>${e(entryLabel(row))} ${board.readOnly ? "" : button("boardEntry", `Edit ${row.name}`, row.id)}</li>`).join("")}</ul>` : "<p>No entries yet.</p>"}
      <h4>Recent board changes</h4><p>Up to 50 saved changes, newest first.</p>${board.history.length ? `<ol>${[...board.history].reverse().map(row => `<li><time datetime="${e(row.at)}">${e(new Date(row.at).toLocaleString())}</time> · ${row.type === "targets" ? `Targets: ${e(targetLabel(row.before))} → ${e(targetLabel(row.after))}` : `${e(row.before ? entryLabel(row.before) : "Added")} → ${e(row.after ? entryLabel(row.after) : "Removed")}`}</li>`).join("")}</ol>` : "<p>No changes yet.</p>"}`;
  }
  function debriefView({ kind, value: { pack }, debrief: { facts, readOnly }, entry, copy }) {
    if (kind === "next-run") return `${heading("Review next-run copy")}
      <p>Check the exact text below before copying it. Private notes, RSVP records and loot are not included. You decide where to paste it.</p>
      <pre class="guild-run-copy" aria-label="Text to copy">${e(copy.text)}</pre>
      ${actions(button("nextRunCopy", "Copy reviewed text", "", true) + button("nextRunBack", "Back to debrief"))}`;
    if (kind === "debrief-edit") {
      const field = (name, label, maxLength, help) => `<label for="guild-debrief-${name}">${label}<textarea id="guild-debrief-${name}" ${control("debrief-" + name)} data-debrief-field="${name}" rows="3" maxlength="${maxLength}" ${help ? `aria-describedby="guild-debrief-help-${name}"` : ""}>${e(entry[name])}</textarea></label>${help ? `<small id="guild-debrief-help-${name}">${help}</small>` : ""}`;
      return `${heading("Edit officer debrief")}<p>Enter only confirmed facts you would share. Leave unknown facts blank. Use the private note for anything that should stay here.</p>
        <form data-debrief-form><fieldset ${busy ? "disabled" : ""}><legend>Manual debrief</legend>
        <div class="guild-run-grid">${Object.entries(debriefFields).map(([name, [label, count, length]]) => `<div>${field(name, label, count * (length + 1) - 1, `One per line. Up to ${count} lines, ${length} characters each.`)}</div>`).join("")}</div>
        ${field("privateNote", "Private officer note", 1000)}
        ${actions(`<button type="submit" class="primary" ${control("debrief-save")}>Save confirmed debrief</button>${button("debriefDiscard", "Discard edits")}`)}</fieldset></form>`;
    }
    const hasFacts = Object.keys(debriefFields).some(name => facts[name].length);
    return `${heading("Local officer debrief")}<p>${e(pack.title)}</p>
      <p>Record who actually attended and what you confirmed after the run. RSVPs and placements do not count as attendance. The debrief stays on this installation.</p>
      ${readOnly ? "<p>Cancelled run: this debrief is read-only.</p>" : ""}
      ${actions((readOnly ? "" : button("debriefEdit", "Edit debrief") + (hasFacts ? button("nextRunPreview", "Review next-run copy", "", true) : "")) + button("debriefBack", "Back to run pack"))}
      ${hasFacts ? `<div class="guild-run-grid">${Object.entries(debriefFields).map(([name, [label]]) => facts[name].length ? `<section><h4>${label}</h4><ul>${facts[name].map(line => `<li>${e(line)}</li>`).join("")}</ul></section>` : "").join("")}</div>` : "<p>No confirmed facts recorded.</p>"}
      ${facts.privateNote ? `<h4>Private officer note</h4><p class="guild-run-private-note">${e(facts.privateNote)}</p>` : ""}`;
  }
  function member(value) {
    const { pack, completedPrepIds } = value;
    return `${heading("Received run on this installation")}${textPreview(value)}
      ${pack.status === "scheduled" && pack.prep.length ? `<fieldset><legend>Private prep checklist</legend><p>Checks stay on this installation. They are not shared or sent to the organizer.</p>${pack.prep.map(p => `<label class="guild-run-check"><input type="checkbox" ${control("check-" + e(p.id))} data-guild-check="${e(p.id)}" ${completedPrepIds.includes(p.id) ? "checked" : ""} ${busy ? "disabled" : ""}><span>${e(p.text)}</span></label>`).join("")}</fieldset>` : ""}
      ${actions(button("close", "Close run panel"))}`;
  }
  const blankDecision = (corrects = null) => ({ corrects, by: "", decision: "", reason: "" });
  const blankWelcome = () => ({ guild: "", greeting: "", recruiting: "", contact: "" });
  const handoffField = (name, label, value, max, required) => `<label>${label}<input ${control("handoff-" + name)} data-guild-handoff="${name}" value="${e(value)}" maxlength="${max}" ${required ? "required" : ""}></label>`;
  const handoffSubmit = (op, label) => `<button type="submit" class="primary" ${control(op)}>${label}</button>`;
  function officerView({ value: { pack }, log, working }) {
    const { rows, readOnly } = log;
    const correcting = working.corrects !== null;
    const number = id => rows.findIndex(row => row.id === id) + 1;
    const corrected = new Set(rows.map(row => row.corrects));
    const full = rows.length >= 64;
    return `${heading("Private officer decisions")}<p>${e(pack.title)}</p>
      <p>Local to this installation, not an access-controlled officer account. Recorder labels are entered by hand. The log records decisions; it does not award loot, determine membership, rank or promote anyone.</p>
      ${actions(button("handoffBack", "Back to run pack"))}
      ${readOnly ? "<p>Cancelled run: the decision history is read-only.</p>" : full ? "<p>The log is full. All existing entries are kept.</p>" :
        `<form data-handoff-form="officerAppend"><fieldset ${busy ? "disabled" : ""}><legend>${correcting ? `Correct entry ${number(working.corrects)} · original kept` : "Record a manual decision"}</legend>
        <div class="guild-run-grid">${handoffField("by", "Recorded by (local label)", working.by, 80, true)}${handoffField("decision", "Decision", working.decision, 400, true)}${handoffField("reason", correcting ? "Reason for correction" : "Private reason or trial note", working.reason, 400, correcting)}</div>
        ${actions(handoffSubmit("officerAppend", correcting ? "Append correction" : "Record decision") + (correcting ? button("officerDiscard", "Discard correction") : ""))}</fieldset></form>`}
      <h4>Local history</h4>${rows.length ? `<ol>${rows.map((row, index) => `<li><p>Entry ${index + 1}${row.corrects ? ` · corrects entry ${number(row.corrects)}` : ""}${corrected.has(row.id) ? " · superseded" : ""} · ${e(row.by)} · <time datetime="${e(row.at)}">${e(new Date(row.at).toLocaleString())}</time></p><p>${e(row.decision)}</p>${row.reason ? `<p>${e(row.reason)}</p>` : ""}${!readOnly && !full && !corrected.has(row.id) ? button("officerCorrect", `Correct entry ${index + 1}`, row.id) : ""}</li>`).join("")}</ol>` : "<p>No decisions yet.</p>"}`;
  }
  function welcomeView({ kind, working, preview }) {
    if (kind === "welcomeReview") return `${heading("Review public welcome copy")}
      <p id="guild-welcome-label">Only the text below is exported. Officer decisions, trial notes and run details are not included. Check your wording before sharing the file yourself.</p>
      <pre class="guild-run-copy" aria-labelledby="guild-welcome-label">${e(preview.text)}</pre>
      ${actions(button("welcomeExport", "Export reviewed welcome text", "", true) + button("welcomeEdit", "Edit welcome copy") + button("handoffBack", "Back to run pack"))}`;
    return `${heading("Write public welcome copy")}<p>Start with blank public fields. Do not type private names, trial notes or decisions here. Nothing is posted or sent.</p>
      <form data-handoff-form="welcomePreview"><fieldset ${busy ? "disabled" : ""}><legend>Public wording</legend><div class="guild-run-grid">
      ${handoffField("guild", "Guild name", working.guild, 100, true)}${handoffField("greeting", "Welcome message", working.greeting, 400, true)}
      ${handoffField("recruiting", "Recruiting needs (optional)", working.recruiting, 240, false)}${handoffField("contact", "Public contact (optional)", working.contact, 160, false)}</div>
      ${actions(handoffSubmit("welcomePreview", "Review welcome copy") + button("handoffBack", "Back to run pack"))}</fieldset></form>`;
  }
  function page() {
    const body = !panel ? "" : panel.kind === "form" ? editor() : panel.kind === "list" ? savedList(panel.value) : panel.kind === "member" ? member(panel.value) : panel.kind === "board" ? organizerView(panel) :
      panel.debrief ? debriefView(panel) : panel.kind === "officer" ? officerView(panel) : panel.kind === "welcomeWrite" || panel.kind === "welcomeReview" ? welcomeView(panel) : reviewView(panel);
    return `<section class="guild-run" data-guild-run="${generation}" aria-labelledby="guild-run-title">
      <span class="eyebrow">Manual event sharing</span><h2 id="guild-run-title">Guild Run Pack</h2>
      <p>Plan a dated run with role duties and prep steps. Save a file and send it yourself. This is separate from Party's checklist and is not live sync.</p>
      ${actions(button("create", "Create run") + button("template", "Use newcomer/mentor template") + button("list", "Saved runs") + button("import", "Import run pack"))}
      <div class="guild-run-feedback" ${control("feedback")} tabindex="-1">${error ? `<p role="alert">${e(error)}</p>` : ""}<p role="status">${e(busy ? "Working on the run…" : notice)}</p></div>
      ${body ? `<div class="guild-run-panel">${body}</div>` : ""}</section>`;
  }
  function set(kind, value) { panel = { kind, value }; }
  function invalidate() {
    const wasOpen = Boolean(panel || busy);
    generation++; panel = draft = base = null; starter = "create"; busy = false; notice = error = "";
    if (wasOpen) call("close").catch(() => {});
  }
  async function operate(op, arg, target) {
    if (busy || !host.active() || target.closest("[data-guild-run]")?.dataset.guildRun !== String(generation)) return;
    const stamp = generation, intentFocus = host.focusVersion();
    const current = () => host.active() && stamp === generation;
    let focus = "panel";
    busy = true; error = notice = "";
    host.paint();
    try {
      await host.ready();
      if (!current()) return;
      switch (op) {
        case "create": case "template": case "list": {
          await call("close");
          if (!current()) break;
          const value = await (op === "template" ? call("template", "newcomer-mentor") : call(op === "create" ? "defaults" : "list"));
          if (!current()) break;
          base = draft = null;
          starter = op === "template" ? "template" : "create";
          if (op === "list") set("list", value); else form(value);
          break;
        }
        case "close": case "back": {
          await call("close");
          if (!current()) break;
          if (op === "close") { panel = draft = base = null; focus = starter; } else set("form");
          break;
        }
        case "board": {
          const value = panel.value, board = await call("board", value.token);
          if (current()) panel = { kind: "board", value, board, entry: null, targets: { ...board.targets } };
          break;
        }
        case "boardBack":
          set("saved", panel.value);
          focus = "board";
          break;
        case "debrief": {
          const value = panel.value, debrief = await call("debrief", value.token);
          if (current()) panel = { kind: "debrief", value, debrief };
          break;
        }
        case "debriefBack":
          set("saved", panel.value);
          focus = "debrief";
          break;
        case "debriefEdit": {
          const { facts } = panel.debrief;
          const entry = Object.fromEntries(Object.keys(debriefFields).map(name => [name, facts[name].join("\n")]));
          panel = { ...panel, kind: "debrief-edit", entry: { ...entry, privateNote: facts.privateNote } };
          break;
        }
        case "debriefDiscard": {
          const { value, debrief } = panel;
          panel = { kind: "debrief", value, debrief };
          focus = "debriefEdit";
          break;
        }
        case "debriefSave": {
          const { value, debrief: { revision }, entry } = panel;
          const facts = Object.fromEntries(Object.keys(debriefFields).map(name => [name, lines(entry[name])]));
          const debrief = await call("debriefSave", value.token, revision, { ...facts, privateNote: entry.privateNote.trim() });
          if (current()) {
            panel = { kind: "debrief", value, debrief };
            notice = "Debrief saved locally. Nothing was shared.";
          }
          break;
        }
        case "nextRunPreview": {
          const copy = await call("nextRunPreview", panel.value.token, panel.debrief.revision);
          if (current()) panel = { ...panel, kind: "next-run", copy };
          break;
        }
        case "nextRunBack": {
          const { value, debrief } = panel;
          await call("nextRunDiscard", value.token);
          if (current()) panel = { kind: "debrief", value, debrief };
          focus = "nextRunPreview";
          break;
        }
        case "nextRunCopy":
          await call("nextRunCopy", panel.value.token, panel.copy.token);
          if (current()) notice = "Reviewed text copied. Nothing was sent.";
          focus = null;
          break;
        case "officerLog": {
          const value = panel.value, log = await call("officerLog", value.token);
          if (current()) panel = { kind: "officer", value, log, working: blankDecision() };
          break;
        }
        case "officerCorrect": case "officerDiscard":
          panel.working = blankDecision(op === "officerCorrect" ? arg : null);
          focus = "handoff-by";
          break;
        case "officerAppend": {
          const { value, log, working } = panel;
          const next = await call("officerAppend", value.token, log.revision, { ...working, by: working.by.trim(), decision: working.decision.trim(), reason: working.reason.trim() });
          if (current()) {
            panel.log = next;
            panel.working = blankDecision();
            notice = working.corrects ? "Correction recorded locally. The original is kept." : "Decision recorded locally.";
          }
          break;
        }
        case "welcomeWrite":
          panel = { kind: "welcomeWrite", value: panel.value, working: blankWelcome() };
          break;
        case "welcomePreview": {
          const { value, working } = panel;
          const preview = await call("welcomePreview", value.token, Object.fromEntries(Object.entries(working).map(([name, text]) => [name, text.trim()])));
          if (current()) panel = { kind: "welcomeReview", value, working, preview };
          break;
        }
        case "welcomeExport": {
          const saved = await call("welcomeExport", panel.preview.token);
          if (current()) notice = saved ? "Welcome text exported. Share the file yourself." : "No file exported.";
          focus = null;
          break;
        }
        case "welcomeEdit": case "handoffBack": {
          const { value, working, preview, kind } = panel;
          if (preview) await call("welcomeClose", preview.token);
          if (!current()) break;
          if (op === "welcomeEdit") panel = { kind: "welcomeWrite", value, working };
          else { set("saved", value); focus = kind === "officer" ? "officerLog" : "welcomeWrite"; }
          break;
        }
        case "boardEntry": {
          const entry = arg ? panel.board.entries.find(row => row.id === arg) : { id: null, name: "", role: "damage", rsvp: "maybe", slot: "assigned" };
          if (!panel.board.readOnly && entry) { panel.entry = { ...entry }; focus = "board-name"; }
          break;
        }
        case "boardDiscard":
          focus = panel.entry?.id ? "boardEntry-" + panel.entry.id : "boardEntry";
          panel.entry = null;
          break;
        case "boardTargets": case "boardSave": case "boardRemove": {
          const { value, board, entry, targets } = panel;
          const change = op === "boardTargets" ? { type: "targets", targets: Object.fromEntries(Object.entries(targets).map(([role, n]) => [role, n === "" ? null : Number(n)])) } :
            op === "boardSave" ? { type: "entry", ...entry, name: entry.name.trim() } : { type: "remove", id: arg };
          const next = await call("boardChange", value.token, board.revision, change);
          if (current()) {
            panel.board = next;
            if (op === "boardTargets") panel.targets = { ...next.targets };
            else panel.entry = null;
            notice = next.revision === board.revision ? "No board changes." : "Organizer board saved locally.";
            focus = op === "boardTargets" ? "board-target-save" : op === "boardSave" && entry.id ? "boardEntry-" + entry.id : "boardEntry";
          }
          break;
        }
        case "preview": {
          const { title, destination, meetingPoint, local, timeZone, offset } = draft;
          const value = await call("preview", { base, draft: { title: title.trim(), destination: destination.trim(), meetingPoint: meetingPoint.trim(), local, timeZone: timeZone.trim(), offset: offset.trim(),
            duties: Object.keys(roles).flatMap(role => lines(draft[role]).map(text => ({ role, text }))), prep: lines(draft.prep) } });
          if (current()) set("unsaved", value);
          break;
        }
        case "organized": case "received": {
          const value = await call(op, arg);
          if (current()) { draft = base = null; set(op === "organized" ? "saved" : "member", value); }
          break;
        }
        case "edit": case "cancelRun": {
          const from = key(panel.value.pack), value = await call(op, from);
          if (!current()) break;
          if (op === "edit") { base = from; form(value); } else { draft = null; set("unsaved", value); }
          break;
        }
        case "save": {
          const value = panel.value;
          await call("save", value.token);
          if (current()) { draft = base = null; set("saved", value); notice = "Run saved locally. Nothing was shared."; }
          break;
        }
        case "export": {
          const result = await call("export", panel.value.token, arg);
          if (current()) notice = result ? (arg === "json" ? "Run pack exported. Share the file yourself." : "Plain-text copy exported. Share the file yourself.") : "No file exported.";
          focus = null;
          break;
        }
        case "import": {
          const value = await call("import");
          if (!current()) break;
          if (value) { draft = base = null; set("incoming", value); }
          else { notice = "No file opened."; focus = null; }
          break;
        }
        case "accept": {
          const value = await call("accept", panel.value.token);
          if (current()) set("member", value);
          break;
        }
        case "check": {
          const value = await call("check", { ...key(panel.value.pack), ...arg });
          if (current()) set("member", value);
          focus = null;
          break;
        }
      }
    } catch (err) {
      if (current()) {
        error = /^Guild Run Pack/.test(err.message) ? err.message : "The run could not be opened or saved. Try again.";
        focus = "feedback";
      }
    } finally {
      if (current()) {
        busy = false;
        if (focus && intentFocus === host.focusVersion()) host.requestFocus("guild-" + focus, "start");
        host.paint();
      }
    }
  }
  function init(value) {
    host = value;
    host.root.addEventListener("click", event => {
      const target = event.target.closest("button[data-guild-action]");
      if (target && !target.disabled) operate(target.dataset.guildAction, target.dataset.guildArg, target);
    });
    const updateDraft = ({ target }) => {
      if (!host.active() || busy) return;
      if (panel?.kind === "form" && Object.hasOwn(draft, target.dataset.guildField)) draft[target.dataset.guildField] = target.value;
      if (panel?.kind === "debrief-edit" && Object.hasOwn(panel.entry, target.dataset.debriefField)) panel.entry[target.dataset.debriefField] = target.value;
      const handoff = target.dataset.guildHandoff;
      if ((panel?.kind === "officer" || panel?.kind === "welcomeWrite") && handoff !== "corrects" && Object.hasOwn(panel.working, handoff)) panel.working[handoff] = target.value;
      if (panel?.kind === "board") {
        if (panel.entry && ["name", "role", "rsvp", "slot"].includes(target.dataset.boardField)) panel.entry[target.dataset.boardField] = target.value;
        if (Object.hasOwn(boardRoles, target.dataset.boardTarget)) panel.targets[target.dataset.boardTarget] = target.value;
      }
    };
    host.root.addEventListener("input", updateDraft);
    host.root.addEventListener("change", updateDraft);
    host.root.addEventListener("submit", event => {
      if (event.target.matches("[data-debrief-form]")) {
        event.preventDefault();
        if (panel?.kind === "debrief-edit") operate("debriefSave", null, event.target);
        return;
      }
      if (event.target.matches("[data-handoff-form]")) {
        event.preventDefault();
        const op = panel?.kind === "officer" ? "officerAppend" : panel?.kind === "welcomeWrite" ? "welcomePreview" : null;
        if (op === event.target.dataset.handoffForm) operate(op, null, event.target);
        return;
      }
      if (event.target.matches("[data-board-form]")) {
        event.preventDefault();
        if (panel?.kind === "board") operate(event.target.dataset.boardForm === "entry" ? "boardSave" : "boardTargets", null, event.target);
        return;
      }
      if (!event.target.matches("[data-guild-form]")) return;
      event.preventDefault();
      operate("preview", null, event.target);
    });
    host.root.addEventListener("change", ({ target }) => {
      if (!target.hasAttribute("data-guild-check") || target.disabled) return;
      operate("check", { actionId: target.dataset.guildCheck, done: target.checked }, target);
    });
  }
  function openTemplate() {
    const button = host.root.querySelector('[data-guild-action="template"]');
    if (button && !button.disabled) operate("template", "", button);
  }
  return { page, init, invalidate, openTemplate };
})();
