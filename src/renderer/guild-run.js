"use strict";
// A local event sheet within Plans → Party. The main process owns reviewed snapshots and writes.
window.GuildRun = (() => {
  const roles = { all: "Everyone", tank: "Tank", healer: "Healer", damage: "Damage" };
  const outcomes = {
    imported: "New run. Adding it starts a private, unchecked prep list.",
    updated: "Newer revision. Only checks for unchanged prep actions carry forward.",
    duplicate: "This revision is already saved.",
    stale: "A newer revision is already saved. This copy cannot replace it.",
    conflict: "This copy conflicts with the saved run. Nothing will be replaced.",
  };
  let host, generation = 0, panel = null, draft = null, base = null, busy = false, notice = "", error = "";
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
    return `${heading(base ? "Write the next revision" : "Write a run pack")}
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
    return `${heading("Reviewed run · ready to export")}${textPreview(value, true)}${actions(`${button("export", "Export JSON", "json", true)}${button("export", "Export plain text", "text")}${pack.status === "scheduled" ? button("edit", "Edit next revision") + button("cancelRun", "Review cancellation") : ""}${button("close", "Close run panel")}`)}`;
  }
  function member(value) {
    const { pack, completedPrepIds } = value;
    return `${heading("Received run on this installation")}${textPreview(value)}
      ${pack.status === "scheduled" && pack.prep.length ? `<fieldset><legend>Private prep checklist</legend><p>Checks stay on this installation. They are not shared or sent to the organizer.</p>${pack.prep.map(p => `<label class="guild-run-check"><input type="checkbox" ${control("check-" + e(p.id))} data-guild-check="${e(p.id)}" ${completedPrepIds.includes(p.id) ? "checked" : ""} ${busy ? "disabled" : ""}><span>${e(p.text)}</span></label>`).join("")}</fieldset>` : ""}
      ${actions(button("close", "Close run panel"))}`;
  }
  function page() {
    const body = !panel ? "" : panel.kind === "form" ? editor() : panel.kind === "list" ? savedList(panel.value) : panel.kind === "member" ? member(panel.value) : reviewView(panel);
    return `<section class="guild-run" data-guild-run="${generation}" aria-labelledby="guild-run-title">
      <span class="eyebrow">Manual event sharing</span><h2 id="guild-run-title">Guild Run Pack</h2>
      <p>Plan a dated run with role duties and prep steps. Save a file and send it yourself. This is separate from Party's checklist and is not live sync.</p>
      ${actions(button("create", "Create run") + button("list", "Saved runs") + button("import", "Import run pack"))}
      <div class="guild-run-feedback" ${control("feedback")} tabindex="-1">${error ? `<p role="alert">${e(error)}</p>` : ""}<p role="status">${e(busy ? "Working on the run…" : notice)}</p></div>
      ${body ? `<div class="guild-run-panel">${body}</div>` : ""}</section>`;
  }
  function set(kind, value) { panel = { kind, value }; }
  function invalidate() {
    const wasOpen = Boolean(panel || busy);
    generation++; panel = draft = base = null; busy = false; notice = error = "";
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
        case "create": case "list": {
          await call("close");
          if (!current()) break;
          const value = await call(op === "create" ? "defaults" : "list");
          if (!current()) break;
          base = draft = null;
          if (op === "create") form(value); else set("list", value);
          break;
        }
        case "close": case "back": {
          await call("close");
          if (!current()) break;
          if (op === "close") { panel = draft = base = null; focus = "create"; } else set("form");
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
    host.root.addEventListener("input", ({ target }) => {
      if (host.active() && panel?.kind === "form" && Object.hasOwn(draft, target.dataset.guildField)) draft[target.dataset.guildField] = target.value;
    });
    host.root.addEventListener("submit", event => {
      if (!event.target.matches("[data-guild-form]")) return;
      event.preventDefault();
      operate("preview", null, event.target);
    });
    host.root.addEventListener("change", ({ target }) => {
      if (!target.hasAttribute("data-guild-check") || target.disabled) return;
      operate("check", { actionId: target.dataset.guildCheck, done: target.checked }, target);
    });
  }
  return { page, init, invalidate };
})();
