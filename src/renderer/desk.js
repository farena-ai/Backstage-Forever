"use strict";
// Backstage Desk in the app: Help → Report a problem (a form with "What will be sent" shown in
// full), Help → My reports (replies from the team), Settings → Privacy & sharing (three switches,
// "See exactly what is sent", "Forget me"), the unread dot on Help, "Report this" on error
// messages and the slim card for a message from the team. All sentences about privacy come from
// privacy-wording.js. Everything the player typed is shown as plain text, never as markup.
window.DeskView = (() => {
  const api = window.backstage, W = window.PrivacyWording;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KINDS = [["bug", "Something is broken"], ["data", "Wrong map or game data"], ["translation", "A translation is wrong"], ["idea", "An idea or a wish"], ["other", "Something else"]];
  const AREAS = [["now", "Now"], ["route", "Next step and guided route"], ["map", "World Map"], ["quests", "Quests"], ["dungeons", "Dungeons & raids"], ["professions", "Professions"], ["ledger", "Ledger"], ["talents", "Talents"],
    ["gear", "Gear and character sheet"], ["journey", "Journey and badges"], ["companion", "Companion"], ["travel", "Travel"], ["settings", "Settings"], ["addon-ingame", "In the game (the addon, slash commands)"],
    ["install-update", "Installing or updating"], ["website", "Website"], ["other", "Somewhere else"]];
  const FREQUENCIES = [["", "Not sure"], ["once", "It happened once"], ["sometimes", "Sometimes"], ["always", "Every time"]];
  const STATUS = { new: "Received", looking: "Looking into it", question: "Question for you", fixed: "Fixed", closed: "Closed" };
  const SYSTEMS = { windows: "Windows", macos: "macOS", linux: "Linux" }, LANGS = { en: "English", de: "Deutsch", fr: "Français", es: "Español" };
  const CHANNELS = { stable: "Stable", beta: "Beta", dev: "Development build" };
  const PAGES = { now: "Now", route: "Route", map: "Map", dungeons: "Dungeons", professions: "Professions", ledger: "Ledger", talents: "Talents", journey: "Journey", companion: "Companion" };
  // The app page a report most likely belongs to; the player can change it.
  const ROUTE_AREA = { now: "now", adventure: "route", "guided-route": "route", "world-map": "map", zones: "map", "quest-guide": "quests", dungeons: "dungeons", "run-history": "dungeons", attunements: "dungeons", "practice-lab": "dungeons",
    preparation: "professions", ledger: "ledger", "ledger-gold": "ledger", "ledger-crafts": "ledger", "ledger-reputation": "ledger", "ledger-cooldowns": "ledger", talents: "talents", sheet: "gear",
    journey: "journey", badges: "journey", characters: "journey", alts: "journey", assistant: "companion", travel: "travel", game: "settings", connections: "settings", privacy: "settings", updates: "install-update" };
  const label = (list, v) => (list.find(([k]) => k === v) || [])[1] || "";
  const yesNo = (v) => (v ? "Yes" : "No");
  const when = (iso) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { dateStyle: "medium" }) : ""; };
  const whenTime = (iso) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; };
  const lang = () => (["en", "de", "fr", "es"].includes(window.I18n?.lang) ? window.I18n.lang : "en");
  // Text the player or the team wrote: shown as it is, never translated, never markup.
  const said = (v) => `<span data-no-translate>${esc(v)}</span>`;

  let host = { navigate: () => {}, page: () => "", toast: () => {} };
  let unread = 0, lastArea = "other";

  // ---------------------------------------------------------------- Help → Report a problem
  const blank = () => ({ kind: "bug", area: "other", frequency: "", summary: "", details: "", expected: "", diagnostics: true, scrub: true });
  let form = blank(), preview = null, previewTimer = null, previewToken = 0, sending = false, formNote = null, sentResult = null, caret = null;
  const input = () => ({ kind: form.kind, area: form.area, frequency: form.frequency || null, summary: form.summary, details: form.details, expected: form.expected, diagnostics: form.diagnostics, scrub: form.scrub });
  const select = (id, name, list, value, text) => `<label for="${id}">${text}<select id="${id}" name="${name}" data-desk-field="${name}" ${sending ? "disabled" : ""}>${list.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  function row(name, value, raw = false) { return `<div><dt>${esc(name)}</dt><dd>${raw ? value : esc(value)}</dd></div>`; }
  function previewInner() {
    if (!preview) return `<p class="desk-muted">Start typing and the exact content of your report appears here.</p>`;
    const b = preview.body, d = b.diagnostics;
    const none = `<em>Nothing yet</em>`;
    const text = (v) => (v ? said(v) : none);
    return `<dl class="desk-sent">
        ${row("Kind", label(KINDS, b.kind))}${row("Where", label(AREAS, b.area))}${row("How often", b.frequency ? label(FREQUENCIES, b.frequency) : "Not said")}
        ${row("Summary", text(b.summary), true)}${row("What happened", text(b.details), true)}${row("What you expected", text(b.expected), true)}
      </dl>
      ${preview.removed ? `<p class="desk-removed" role="status">${preview.removed === 1 ? "We removed 1 thing that looked private." : `We removed ${preview.removed} things that looked private.`} <span>It shows as [path], [name], [email], [token] or [address] above.</span></p>` : ""}
      <h4>With every report</h4>
      <dl class="desk-sent desk-sent-facts">
        ${row("App version", said(b.appVersion), true)}${row("Addon version", b.addonVersion ? said(b.addonVersion) : "Not installed", !!b.addonVersion)}
        ${row("System", `${SYSTEMS[b.os] || ""}${b.osMajor ? " " + b.osMajor : ""}`)}${row("Language", said(LANGS[b.lang] || b.lang), true)}
        ${row("Game build", b.build ? said(b.build) : "Not known", !!b.build)}${row("Install number", `<code>${esc(String(b.installId).slice(0, 8))}…</code>`, true)}
      </dl>
      <h4>Diagnostics</h4>
      ${d ? `<dl class="desk-sent desk-sent-facts">
        ${row("Page you were on", said(d.screen), true)}${row("Game folder connected", yesNo(d.gameConnected))}${row("Addon installed", yesNo(d.addonInstalled))}
        ${row("Last error message", d.lastError ? said(d.lastError) : "None", !!d.lastError)}
      </dl>` : `<p class="desk-muted">Left out. Only your text and the six lines above are sent.</p>`}
      <p class="desk-muted">That is all. No account, character or realm names, no files, no screenshots.</p>`;
  }
  function reportPage() {
    // Until the player picks one, "Where" follows the page they came from.
    if (!form.areaChosen && !form.summary && !form.details) form.area = lastArea || "other";
    const hero = PageHero.render({ art: "field-guide", compact: true, eyebrow: "Help · Report a problem", title: "Tell us what went wrong", subtitle: "A person reads every report. The answer appears under My reports." });
    if (sentResult) {
      const queued = sentResult.queued;
      return `<section class="desk-page bf-parchment" data-desk="report">${hero}
        <section class="panel desk-done" role="status"><span class="desk-seal" aria-hidden="true">✓</span>
          <div><h2>${queued ? "Saved. It will be sent when you are online." : "Thank you. Your report was sent."}</h2>
          ${queued ? `<p>The service could not be reached, so your report waits on this computer. The app sends it by itself later; you can see it under My reports.</p>`
            : `<p><span>Your report number is</span> <strong class="desk-number" data-no-translate>${esc(sentResult.ticket)}</strong><span>.</span> <span>When someone answers, a dot appears on Help and the reply is under My reports.</span></p>`}
          <div class="button-row"><button type="button" class="primary" data-nav="reports">Open My reports</button><button type="button" data-desk-again>Write another report</button></div></div>
        </section></section>`;
    }
    return `<section class="desk-page bf-parchment" data-desk="report">${hero}
      <div class="desk-columns">
        <form class="panel desk-form" data-desk-form novalidate>
          <div class="desk-pair">${select("desk-kind", "kind", KINDS, form.kind, "What kind of report is this?")}${select("desk-area", "area", AREAS, form.area, "Where did it happen?")}</div>
          <label for="desk-summary">Summary<input id="desk-summary" name="summary" data-desk-field="summary" type="text" maxlength="140" value="${esc(form.summary)}" placeholder="One line, for example: The talent planner shows the wrong tree" ${sending ? "disabled" : ""}></label>
          <label for="desk-details">What happened?<textarea id="desk-details" name="details" data-desk-field="details" maxlength="4000" placeholder="What you did, step by step, and what you saw." ${sending ? "disabled" : ""}>${esc(form.details)}</textarea></label>
          <label for="desk-expected">What did you expect instead? <small>(you can leave this empty)</small><textarea id="desk-expected" class="desk-short" name="expected" data-desk-field="expected" maxlength="1000" ${sending ? "disabled" : ""}>${esc(form.expected)}</textarea></label>
          ${select("desk-frequency", "frequency", FREQUENCIES, form.frequency, "How often does it happen?")}
          <label class="check-label" for="desk-diagnostics"><input id="desk-diagnostics" type="checkbox" value="on" data-desk-field="diagnostics" ${form.diagnostics ? "checked" : ""} ${sending ? "disabled" : ""}>Include the diagnostics shown under “What will be sent”</label>
          <label class="check-label" for="desk-scrub"><input id="desk-scrub" type="checkbox" value="on" data-desk-field="scrub" ${form.scrub ? "checked" : ""} ${sending ? "disabled" : ""}>Remove things that look private from my text (file paths, names, e-mail addresses)</label>
          <div class="button-row"><button type="submit" class="primary" data-desk-send ${sending ? "disabled" : ""}>${sending ? "Sending…" : "Send report"}</button><button type="button" data-nav="reports">My reports</button></div>
          <p class="desk-note${formNote?.bad ? " bad" : ""}" data-desk-form-note role="status"${formNote ? "" : " hidden"}>${esc(formNote?.text || "")}</p>
        </form>
        <aside class="panel desk-preview" aria-labelledby="desk-preview-title">
          <div class="eyebrow">Before you send</div><h2 id="desk-preview-title">What will be sent</h2>
          <div data-desk-preview aria-live="polite">${previewInner()}</div>
        </aside>
      </div></section>`;
  }
  function paintPreview() { const el = document.querySelector("[data-desk-preview]"); if (el) el.innerHTML = previewInner(); }
  function paintFormNote() {
    const el = document.querySelector("[data-desk-form-note]"); if (!el) return;
    el.hidden = !formNote; el.textContent = formNote?.text || ""; el.classList.toggle("bad", Boolean(formNote?.bad));
    window.I18n?.apply?.(el);
  }
  async function refreshPreview() {
    if (!api?.deskReportPreview) return;
    const token = ++previewToken;
    try { const p = await api.deskReportPreview(input()); if (token === previewToken) { preview = p; paintPreview(); } } catch { /* the form still works without the preview */ }
  }
  function schedulePreview(now = false) { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, now ? 0 : 250); }
  function problem() {
    const n = (s) => Array.from(s.trim()).length;
    if (n(form.summary) < 5) return ["desk-summary", "Write a short summary first, at least 5 characters."];
    if (n(form.details) < 10) return ["desk-details", "Tell us what happened, in at least 10 characters."];
    return null;
  }
  async function send() {
    if (sending) return;
    const bad = problem();
    if (bad) { formNote = { bad: true, text: bad[1] }; paintFormNote(); document.getElementById(bad[0])?.focus(); return; }
    sending = true; formNote = null; repaint("report");
    try {
      const r = await api.deskReportSend(input());
      sentResult = r?.sent ? { ticket: r.ticket } : { queued: true };
      form = blank(); preview = null; inbox = null;
    } catch (e) { formNote = { bad: true, text: e?.message || "The report could not be sent. Try again later." }; }
    sending = false; repaint("report");
  }
  /** Opens the form with what the app already knows: used by "Report this" on an error message. */
  function prefill({ message = "", route = "" } = {}) {
    sentResult = null; formNote = null;
    form = { ...blank(), area: ROUTE_AREA[route] || "other", areaChosen: true, summary: form.summary, details: form.details || (message ? `I saw this message: “${String(message).slice(0, 400)}”\n\nWhat I was doing: ` : ""), expected: form.expected };
    host.navigate("report");
  }

  // ---------------------------------------------------------------- Help → My reports
  let inbox = null, inboxError = "", selected = null, conversation = null, conversationError = "", loading = false, replyText = "", replying = false, replyNote = null, confirmDelete = null, deleting = false, checking = false;
  function chip(t) {
    const text = t.status === "fixed" && t.fixedIn ? `<span>Fixed in</span> <span data-no-translate>${esc(t.fixedIn)}</span>` : esc(STATUS[t.status] || STATUS.new);
    return `<span class="desk-chip desk-chip-${esc(t.status)}">${text}</span>`;
  }
  function listInner() {
    if (inboxError) return `<p class="desk-note bad" role="status">${esc(inboxError)}</p>`;
    if (!inbox) return `<p class="desk-muted">Loading your reports…</p>`;
    const waiting = inbox.waiting.filter((w) => w.type === "ticket");
    if (!inbox.tickets.length && !waiting.length) return `<div class="desk-empty"><p>You have not sent a report yet.</p><p class="desk-muted">Found something wrong, or have an idea? Tell us and the answer shows up here.</p><button type="button" class="primary" data-nav="report">Report a problem</button></div>`;
    return `<ul class="desk-list">${waiting.map((w) => `<li class="desk-item desk-item-waiting"><div class="desk-item-top"><span class="desk-chip desk-chip-waiting">Waiting to be sent</span><button type="button" class="desk-link" data-desk-discard="${esc(w.id)}">Discard</button></div><strong>${said(w.summary)}</strong></li>`).join("")}
      ${inbox.tickets.map((t) => `<li><button type="button" class="desk-item${t.ticket === selected ? " active" : ""}" data-desk-open="${esc(t.ticket)}" ${t.ticket === selected ? 'aria-current="true"' : ""}>
        <span class="desk-item-top"><span class="desk-number" data-no-translate>${esc(t.ticket)}</span>${chip(t)}${t.unread ? `<i class="desk-dot" title="New reply"></i><span class="sr-only">New reply</span>` : ""}</span>
        <strong>${said(t.summary)}</strong><small data-no-translate>${esc(when(t.createdAt))}</small></button></li>`).join("")}</ul>`;
  }
  function threadInner() {
    if (!selected) return `<div class="desk-empty"><p class="desk-muted">${inbox?.tickets.length ? "Choose a report on the left to read the conversation." : "Replies from the team appear here."}</p></div>`;
    if (conversationError) return `<p class="desk-note bad" role="status">${esc(conversationError)}</p><div class="button-row"><button type="button" data-desk-open="${esc(selected)}">Try again</button></div>`;
    if (loading || !conversation) return `<p class="desk-muted">Loading the conversation…</p>`;
    const c = conversation;
    const fixed = c.status === "fixed" ? (c.fixedHere ? `<p class="desk-fixed here" role="status">This is fixed in the version you are running.</p>`
      : c.fixedIn ? `<p class="desk-fixed" role="status"><span>Fixed in version</span> <strong data-no-translate>${esc(c.fixedIn)}</strong><span>.</span> <span>Update the app under Settings → Updates to get it.</span></p>` : "") : "";
    const closed = c.status === "closed" ? `<p class="desk-muted">This report is closed. A reply opens it again.</p>` : "";
    return `<header class="desk-thread-head"><div><span class="desk-number" data-no-translate>${esc(c.ticket)}</span>${chip(c)}</div><h2>${said(c.summary)}</h2>
        <small><span>${esc(label(KINDS, c.kind))}</span> · <span>${esc(label(AREAS, c.area))}</span> · <span data-no-translate>${esc(when(c.createdAt))}</span></small></header>
      ${fixed}
      <ol class="desk-messages">${c.messages.map((m) => `<li class="desk-message desk-from-${m.from}"><div class="desk-who"><strong>${m.from === "team" ? "Backstage team" : "You"}</strong><small data-no-translate>${esc(whenTime(m.at))}</small></div><p data-no-translate>${esc(m.text)}</p></li>`).join("")}
        ${c.waiting.map((w) => `<li class="desk-message desk-from-player desk-pending"><div class="desk-who"><strong>You</strong><small>Waiting to be sent</small></div><p data-no-translate>${esc(w.text)}</p></li>`).join("")}</ol>
      ${closed}
      <form class="desk-reply" data-desk-reply>
        <label for="desk-reply-text">Your reply<textarea id="desk-reply-text" class="desk-short" maxlength="4000" data-desk-reply-text ${replying ? "disabled" : ""}>${esc(replyText)}</textarea></label>
        <div class="button-row"><button type="submit" class="primary" ${replying ? "disabled" : ""}>${replying ? "Sending…" : "Send reply"}</button>
          <button type="button" class="danger desk-delete" data-desk-delete="${esc(c.ticket)}" ${deleting ? "disabled" : ""}>${confirmDelete === c.ticket ? "Click again to delete" : "Delete this report"}</button></div>
        <p class="desk-note${replyNote?.bad ? " bad" : ""}" role="status"${replyNote ? "" : " hidden"}>${esc(replyNote?.text || "")}</p>
        <p class="desk-muted">Deleting removes the report and its replies from the service and from this computer.</p>
      </form>`;
  }
  function inboxPage() {
    return `<section class="desk-page bf-parchment" data-desk="reports">${PageHero.render({ art: "field-guide", compact: true, eyebrow: "Help · My reports", title: "Your reports and our replies", subtitle: "Only this app can read them. The app looks for replies when it starts and every few hours.",
      aside: `<div class="desk-hero-acts"><button type="button" data-desk-check ${checking ? "disabled" : ""}>${checking ? "Checking…" : "Check for replies"}</button><button type="button" class="primary" data-nav="report">Report a problem</button></div>` })}
      <div class="desk-columns desk-inbox"><section class="panel desk-list-panel" aria-label="Your reports" data-desk-list>${listInner()}</section>
      <section class="panel desk-thread" aria-label="Conversation" data-desk-thread>${threadInner()}</section></div></section>`;
  }
  function paintInbox() {
    const l = document.querySelector("[data-desk-list]"), t = document.querySelector("[data-desk-thread]");
    if (l) l.innerHTML = listInner();
    if (t) { const focused = document.activeElement?.id === "desk-reply-text"; t.innerHTML = threadInner(); if (focused) document.getElementById("desk-reply-text")?.focus(); }
    decorate();
  }
  async function loadInbox() {
    if (!api?.deskTickets) return;
    try { inbox = await api.deskTickets(); inboxError = ""; unread = inbox.unread || 0; if (selected && !inbox.tickets.some((t) => t.ticket === selected)) { selected = null; conversation = null; } }
    catch (e) { inboxError = e?.message || "Your reports could not be loaded."; }
    paintInbox();
  }
  async function open(ticket) {
    selected = ticket; conversation = null; conversationError = ""; loading = true; replyText = ""; replyNote = null; confirmDelete = null; paintInbox();
    try { const c = await api.deskTicket(ticket); if (selected === ticket) conversation = c; }
    catch (e) { if (selected === ticket) conversationError = e?.message || "The conversation could not be loaded. Try again later."; }
    if (selected === ticket) loading = false;
    await loadInbox();
  }
  async function reply() {
    if (replying || !conversation) return;
    if (!replyText.trim()) { replyNote = { bad: true, text: "Write your reply first." }; paintInbox(); return; }
    replying = true; replyNote = null; paintInbox();
    try {
      const r = await api.deskReply({ ticket: conversation.ticket, text: replyText });
      replyText = "";
      replyNote = { text: r?.queued ? "Saved. It will be sent when you are online." : "Your reply was sent." };
      replying = false;
      const ticket = conversation.ticket;
      try { conversation = await api.deskTicket(ticket); } catch { /* the queued reply shows after the next check */ }
    } catch (e) { replyNote = { bad: true, text: e?.message || "The reply could not be sent. Try again later." }; }
    replying = false; await loadInbox();
  }
  async function remove(ticket) {
    if (confirmDelete !== ticket) { confirmDelete = ticket; paintInbox(); return; } // the second click confirms
    deleting = true; paintInbox();
    try { await api.deskDelete(ticket); selected = null; conversation = null; replyNote = null; }
    catch (e) { replyNote = { bad: true, text: e?.message || "The report could not be deleted. Try again later." }; }
    deleting = false; confirmDelete = null; await loadInbox();
  }

  // ---------------------------------------------------------------- Settings → Privacy & sharing
  let status = null, statusAt = 0, privacyNote = null, forgetting = false;
  function heartbeatRows(h) {
    const value = {
      installId: `<code>${esc(String(h.installId).slice(0, 8))}…</code>`, appVersion: said(h.appVersion), addonVersion: h.addonVersion ? said(h.addonVersion) : "Not installed",
      channel: esc(CHANNELS[h.channel] || h.channel), os: esc(SYSTEMS[h.os] || h.os), osMajor: h.osMajor ? said(h.osMajor) : "Not known", lang: said(LANGS[h.lang] || h.lang),
      build: h.build ? said(h.build) : "Not known", firstSeenWeek: said(h.firstSeenWeek),
      "flags.gameConnected": yesNo(h.flags.gameConnected), "flags.addonInstalled": yesNo(h.flags.addonInstalled), "flags.liveLink": yesNo(h.flags.liveLink), "flags.sharing": yesNo(h.flags.sharing),
      areas: h.areas.length ? h.areas.map((a) => `<span>${esc(PAGES[a] || a)}</span>`).join(", ") : "None yet today",
    };
    return W.FIELDS.statistics.map(([key, name]) => row(name, value[key] ?? "", true)).join("");
  }
  function switchRow(key, checked, disabled, extra = "") {
    const s = W.SWITCHES[key];
    return `<div class="desk-switch"><label class="check-label" for="desk-switch-${key}"><input id="desk-switch-${key}" type="checkbox" value="on" data-desk-switch="${key}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><strong>${esc(s.label)}</strong></label><p>${esc(s.text)}</p>${extra}</div>`;
  }
  // The discovery fields in plain words. This list stands first on the screen, so the three shared
  // fields are described in full here instead of "as above".
  function discoveryRows() {
    const full = Object.fromEntries(W.FIELDS.statistics.map(([key, , what]) => [key, what]));
    return W.FIELDS.discoveries.map(([key, name, what]) => row(name, full[key] || what)).join("");
  }
  function privacyInner() {
    if (!status) return `<p class="desk-muted">Loading your privacy settings…</p>`;
    const s = status;
    return `${s.blocked ? `<p class="desk-note bad" role="status">The service stopped accepting data from this install. Nothing is sent.</p>` : ""}
      <div class="desk-switches">
        ${switchRow("share", s.share, s.blocked, `<details class="desk-see-share" data-desk-see-share data-player-tool="desk-see-share"><summary>${esc(W.BUTTONS.see)}</summary>
          <p class="desk-muted">${s.share ? "These are all the fields a shared discovery can hold. A spot reaches other players only once at least three installs reported it." : "Sharing is off, so nothing is sent. This is what would be sent if you switched it on."}</p>
          <dl class="desk-sent desk-sent-share">${discoveryRows()}</dl>
          <p class="desk-muted"><strong>Which spots are yours.</strong> <span>${esc(W.FIELDS.contributions[0][2])}</span></p>
          <p class="desk-muted"><strong>What comes back.</strong> ${W.FIELDS.pack.map(([, name, what]) => `<span>${esc(name)}</span>: <span>${esc(what)}</span>`).join(" ")}</p></details>`)}
        ${switchRow("statistics", s.statistics, false, `<details class="desk-see" data-player-tool="desk-see"><summary>${esc(W.BUTTONS.see)}</summary>
          <p class="desk-muted">${s.statistics ? (s.lastHeartbeatDay ? "This is the whole of the next daily message. Today's was already sent." : "This is the whole of the next daily message.") : "Statistics are off, so nothing is sent. This is what would be sent if you switched them on."}</p>
          <dl class="desk-sent desk-sent-facts">${heartbeatRows(s.heartbeat)}</dl>
          <p class="desk-muted">${W.INSTALL_ID.slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join(" ")}</p></details>`)}
        ${switchRow("errors", s.errors, false)}
      </div>
      <div class="desk-extra">
        <label class="check-label" for="desk-switch-notify"><input id="desk-switch-notify" type="checkbox" value="on" data-desk-switch="notify" ${s.notify ? "checked" : ""}>Show a desktop notification when a reply to one of my reports arrives</label>
        <p class="desk-muted">${esc(W.REPORTS)}</p>
      </div>
      ${window.LiveGuild?.privacyHtml() || ""}
      <div class="desk-never"><h3>Never sent</h3><ul>${W.NEVER.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${W.GUILD ? `<p class="desk-muted" data-desk-exception>${esc(W.GUILD.exception)}</p>` : ""}</div>
      <div class="desk-forget"><div><h3>${esc(W.BUTTONS.forget)}</h3><p>${esc(W.INSTALL_ID[3])}</p><p class="desk-muted"><span>Your install number starts with</span> <code>${esc(s.installId)}</code><span>. The service is at</span> <span data-no-translate>${esc(s.host)}</span><span>.</span></p></div>
        <button type="button" class="danger" data-desk-forget ${forgetting ? "disabled" : ""}>${esc(W.BUTTONS.forget)}</button></div>
      <p class="desk-note${privacyNote?.bad ? " bad" : ""}" role="status"${privacyNote ? "" : " hidden"}>${esc(privacyNote?.text || "")}</p>`;
  }
  function privacyPage() {
    return `<section class="desk-page bf-parchment" data-desk="privacy">${PageHero.render({ art: "settings", compact: true, eyebrow: "Settings · Privacy & sharing", title: "What this app shares", subtitle: "Three switches. Each one works on its own." })}
      <section class="panel desk-privacy"><p class="desk-lead">${esc(W.SUMMARY)}</p><div data-desk-privacy>${privacyInner()}</div></section></section>`;
  }
  function paintPrivacy() {
    const el = document.querySelector("[data-desk-privacy]"); if (!el) return;
    const open = el.querySelector("details.desk-see:not(.lg-see)")?.open, openShare = el.querySelector("details[data-desk-see-share]")?.open, openGuild = el.querySelector("details.lg-see")?.open;
    el.innerHTML = privacyInner();
    if (openGuild) { const d = el.querySelector("details.lg-see"); if (d) d.open = true; }
    if (open) { const d = el.querySelector("details.desk-see:not(.lg-see)"); if (d) d.open = true; }
    if (openShare) { const d = el.querySelector("details[data-desk-see-share]"); if (d) d.open = true; }
  }
  async function loadStatus() {
    if (!api?.deskStatus) return;
    try { status = await api.deskStatus(); statusAt = Date.now(); unread = status.unread || 0; } catch { /* keep what is shown */ }
    paintPrivacy(); decorate();
  }
  async function setSwitch(key, checked, box) {
    try {
      if (key === "share") { await api.setCommunitySettings({ share: checked }); status = await api.deskStatus(); window.CommunityView?.refresh?.(); }
      else status = await api.deskSetSettings({ [key]: checked });
      privacyNote = null;
    } catch { box.checked = !checked; privacyNote = { bad: true, text: "The setting could not be changed. Try again." }; }
    paintPrivacy();
  }
  async function forget() {
    if (forgetting) return;
    forgetting = true; privacyNote = { text: "Asking the service to forget this install…" }; paintPrivacy();
    try {
      const r = await api.deskForget();
      privacyNote = r?.cancelled ? null : { text: "Done. Everything this install sent was deleted, and the app has a new random install number." };
      status = r?.status || status; if (!r?.cancelled) { inbox = null; selected = null; conversation = null; unread = 0; }
    } catch (e) { privacyNote = { bad: true, text: e?.message || "The service could not be reached. Try again later." }; }
    forgetting = false; paintPrivacy(); decorate();
  }

  // ---------------------------------------------------------------- shared wiring
  function repaint(which) {
    const el = document.querySelector(`[data-desk="${which}"]`); if (!el) return;
    el.outerHTML = which === "report" ? reportPage() : which === "reports" ? inboxPage() : privacyPage();
    mounted();
  }
  /** The unread dot on Help in the rail and on the My reports tab. */
  function decorate() {
    for (const [sel, where] of [['[data-shell-control="nav:guide"]', "rail"], ['[data-shell-control="subtab:reports"]', "tab"]]) {
      const b = document.querySelector(sel); if (!b) continue;
      const dot = b.querySelector(".desk-dot");
      if (unread > 0 && !dot) b.insertAdjacentHTML("beforeend", `<i class="desk-dot desk-dot-${where}" title="A reply is waiting in My reports"></i>`);
      else if (unread <= 0 && dot) dot.remove();
    }
  }
  let mountedReport = null, mountedInbox = null, mountedPrivacy = null, visited = "";
  /** Called after every paint of the app. */
  function mounted() {
    decorate();
    const page = host.page(), route = `${page}|${lang()}`;
    if (page && route !== visited && api?.deskVisit && /^[a-z][a-z-]{0,31}$/.test(page)) { visited = route; api.deskVisit({ route: page, lang: lang() }).catch(() => {}); }
    if (page && !["report", "reports", "guide", "commands", "coverage"].includes(page)) lastArea = ROUTE_AREA[page] || "other"; // Help is only the way to the form
    const report = document.querySelector('[data-desk="report"]'), reports = document.querySelector('[data-desk="reports"]'), privacy = document.querySelector('[data-desk="privacy"]');
    if (report && report !== mountedReport) {
      mountedReport = report;
      if (!preview && !sentResult) schedulePreview(true);
      if (caret) { const el = document.getElementById(caret.id); if (el && (document.activeElement === el || document.activeElement === document.body)) { el.focus({ preventScroll: true }); try { el.setSelectionRange(caret.start, caret.end); } catch {} } }
    }
    if (reports && reports !== mountedInbox) { mountedInbox = reports; if (!inbox) void loadInbox(); }
    if (privacy && privacy !== mountedPrivacy) { mountedPrivacy = privacy; if (!status || Date.now() - statusAt > 5000) void loadStatus(); }
  }
  const inDesk = (t) => t?.closest?.("[data-desk]");
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches?.("[data-desk-field]") && t.type !== "checkbox" && t.tagName !== "SELECT") {
      form[t.dataset.deskField] = t.value; caret = { id: t.id, start: t.selectionStart, end: t.selectionEnd };
      if (formNote) { formNote = null; paintFormNote(); }
      schedulePreview();
    } else if (t.matches?.("[data-desk-reply-text]")) replyText = t.value.slice(0, 4000);
  });
  document.addEventListener("focusout", (e) => { if (e.target.matches?.("[data-desk-field]") && caret?.id === e.target.id && e.relatedTarget) caret = null; });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches?.("[data-desk-field]") && (t.type === "checkbox" || t.tagName === "SELECT")) { form[t.dataset.deskField] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.deskField === "area") form.areaChosen = true; schedulePreview(true); }
    else if (t.matches?.("[data-desk-switch]")) void setSwitch(t.dataset.deskSwitch, t.checked, t);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.matches?.("[data-desk-form]")) { e.preventDefault(); void send(); }
    else if (e.target.matches?.("[data-desk-reply]")) { e.preventDefault(); void reply(); }
  });
  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest?.("[data-desk-report-this]")) { const el = t.closest("[data-desk-report-this]"); prefill({ message: el.dataset.deskReportThis, route: host.page() }); return; }
    if (t.closest?.("[data-desk-notice-close]")) { closeNotice(); return; }
    if (t.closest?.("[data-desk-notice-link]")) { const id = Number(t.closest("[data-desk-notice-link]").dataset.deskNoticeLink); api.deskAnnouncementOpen(id).catch(() => {}); return; }
    if (!inDesk(t)) return;
    if (t.closest("[data-desk-again]")) { sentResult = null; form = blank(); preview = null; repaint("report"); return; }
    const openBtn = t.closest("[data-desk-open]"); if (openBtn) { void open(openBtn.dataset.deskOpen); return; }
    const del = t.closest("[data-desk-delete]"); if (del) { void remove(del.dataset.deskDelete); return; }
    if (confirmDelete && !t.closest("[data-desk-delete]")) { confirmDelete = null; paintInbox(); }
    const discard = t.closest("[data-desk-discard]"); if (discard) { try { await api.deskCancelWaiting(discard.dataset.deskDiscard); } catch {} await loadInbox(); return; }
    if (t.closest("[data-desk-check]")) {
      if (checking) return;
      checking = true; repaint("reports");
      try { inbox = await api.deskSync(); unread = inbox.unread || 0; inboxError = ""; } catch (err) { inboxError = err?.message || "The service could not be reached. Try again later."; }
      checking = false; repaint("reports"); if (selected && !conversationError) void open(selected);
      return;
    }
    if (t.closest("[data-desk-forget]")) void forget();
  });

  // ---------------------------------------------------------------- a message from the team
  let notice = null, noticeBusy = false;
  function closeNotice() { notice = null; const dock = document.getElementById("desk-dock"); if (dock) dock.innerHTML = ""; setTimeout(checkNotices, 400); }
  async function checkNotices() {
    const dock = document.getElementById("desk-dock");
    if (!dock || notice || noticeBusy || !api?.deskAnnouncements || document.visibilityState !== "visible" || !document.querySelector(".shell") || document.querySelector("dialog[open]")) return;
    noticeBusy = true;
    try {
      const list = await api.deskAnnouncements();
      const a = Array.isArray(list) ? list[0] : null;
      if (a && !notice) {
        notice = a;
        dock.innerHTML = `<section class="desk-notice desk-notice-${a.level === "warning" ? "warning" : "info"}" role="status" aria-label="Message from the Backstage team">
          <div class="eyebrow">${a.level === "warning" ? "Please read · from the Backstage team" : "From the Backstage team"}</div>
          <strong data-no-translate>${esc(a.title)}</strong><p data-no-translate>${esc(a.text)}</p>
          <div class="button-row">${a.link ? `<button type="button" data-desk-notice-link="${a.id}">Read more ↗</button>` : ""}<button type="button" class="primary" data-desk-notice-close>Got it</button></div></section>`;
        await api.deskAnnouncementSeen(a.id); // each message is shown once
      }
    } catch { /* messages are a nicety; the app works without them */ }
    noticeBusy = false;
  }

  // ---------------------------------------------------------------- errors the app shows
  /** An error the app just showed in its message box. Unexpected ones (not a plain Error) may be reported automatically. */
  function caught(error, shownMessage) {
    if (!api?.deskRendererError) return;
    const unexpected = error instanceof Error && error.name !== "Error";
    try {
      if (unexpected) api.deskRendererError({ name: String(error.name).slice(0, 100), message: String(error.message || "").slice(0, 4000), stack: String(error.stack || "").slice(0, 20000) }).catch(() => {});
      else if (shownMessage) api.deskRendererError({ message: String(shownMessage).slice(0, 4000), shown: true }).catch(() => {});
    } catch { /* never let reporting an error cause one */ }
  }
  /** The "Report this" link for an error message. */
  const reportThis = (message) => `<button type="button" class="desk-report-this" data-desk-report-this="${esc(String(message).slice(0, 400))}">Report this</button>`;

  function init(value) {
    host = { ...host, ...value };
    api?.onDeskChanged?.((v) => { unread = Number(v?.unread) || 0; decorate(); if (document.querySelector('[data-desk="reports"]')) void loadInbox(); });
    api?.deskStatus?.().then((s) => { status = s; statusAt = Date.now(); unread = s.unread || 0; decorate(); }).catch(() => {});
    setTimeout(checkNotices, 4000);
    setInterval(checkNotices, 5 * 60 * 1000);
    window.addEventListener("focus", () => setTimeout(checkNotices, 500));
  }
  return { init, mounted, reportPage, inboxPage, privacyPage, prefill, caught, reportThis, checkNotices, KINDS, AREAS, FREQUENCIES, STATUS,
    _state: () => ({ form: { ...form }, preview, inbox, selected, conversation, status, unread, sentResult, notice }) };
})();
