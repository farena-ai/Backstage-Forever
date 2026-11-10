"use strict";
window.Recovery = (() => {
  let host, guard, generation = 0, loaded = false, pending = false, points = [], selected = "", preview = null;
  let status = { phase: "ready", automatic: true, count: 0, latestAt: null }, message = "Loading local protection…", error = false;
  const active = () => Boolean(host?.active());
  const date = value => value ? new Date(value).toLocaleString() : "No point yet";
  const counts = point => `${point.profileCount} character${point.profileCount === 1 ? "" : "s"} · ${point.journeyCount} journey${point.journeyCount === 1 ? "" : "s"}`;
  const reason = value => ({ startup: "Startup", save: "Saved journal", close: "App closed", manual: "Created by you", import: "Before import", restore: "Before restore" })[value] || "Recovery point";
  function invalidate() { generation++; loaded = false; pending = false; points = []; preview = null; selected = ""; error = false; message = "Loading local protection…"; guard?.invalidate(); }
  function markup() {
    return `<section class="panel recovery-card" data-recovery role="region" aria-labelledby="recovery-title"><div class="recovery-heading"><span class="recovery-seal" aria-hidden="true">◈</span><div><div class="eyebrow">Your journal’s safety net</div><h2 id="recovery-title">Automatic local protection</h2></div><span class="tag">ON THIS COMPUTER</span></div><p>Small, dated recovery points protect your private journal automatically. No account or setup needed.</p><label class="check-label"><input type="checkbox" data-recovery-automatic checked>Automatically protect my journal</label><p class="corner-note">Changed saves are protected at most once every 15 minutes, plus successful startup and ordinary app close. Recent edits may be newer than the last point. Turning this off keeps existing history; Create point now still works.</p><div class="recovery-facts"><div><span>Latest point</span><strong data-recovery-latest>No point yet</strong></div><div><span>Local history</span><strong data-recovery-count>Loading…</strong></div></div><p>Up to 3 points · 64 MiB each · 128 MiB total. Points contain profiles, private notes, goals, journeys and preferences. They exclude credentials and saved conversation memory, and are readable local files, not encrypted backups.</p><div class="button-row"><button type="button" class="primary" data-recovery-create>Create point now</button><button type="button" data-recovery-refresh>Refresh recovery history</button></div><label class="recovery-selection">Choose a dated recovery point<select data-recovery-select aria-label="Recovery point"><option value="">No recovery points</option></select></label><div class="button-row"><button type="button" data-recovery-preview disabled>Preview selected point</button><button type="button" data-recovery-restore disabled>Restore selected point</button><button type="button" class="danger" data-recovery-clear>Clear recovery history</button></div><p data-recovery-preview-text class="recovery-preview">Select a point to review its date and journal counts before restoring.</p><p data-recovery-status class="recovery-status" role="status" aria-live="polite">${host.esc(message)}</p><details><summary>What restore and clearing history do</summary><p>Restore asks for confirmation, protects the current journal even when automatic protection is off, replaces the journal and preferences, clears conversation memory, keeps API keys and disconnects game observation. Reconnect deliberately in Game Connection.</p><p>A startup restore also retains one exact damaged original. That original may contain memory and private text. Clear history, character deletion and Delete all local data remove all managed points and that original. Explicit memory deletion or clearing and external backup import also remove old damaged originals. Clear history keeps your automatic choice; future saves may create new points. Exported backups remain separate.</p></details></section>`;
  }
  function paint() {
    if (!active() || guard.defer(paint)) return;
    const node = host.root.querySelector("[data-recovery]"); if (!node) return;
    const auto = node.querySelector("[data-recovery-automatic]"); auto.checked = status.automatic; auto.disabled = pending;
    for (const attr of ["create", "refresh", "clear"]) node.querySelector(`[data-recovery-${attr}]`).disabled = pending;
    node.querySelector("[data-recovery-preview]").disabled = pending || !selected;
    node.querySelector("[data-recovery-restore]").disabled = pending || !preview;
    node.querySelector("[data-recovery-latest]").textContent = date(status.latestAt);
    node.querySelector("[data-recovery-count]").textContent = `${status.count} of 3 points · ${status.phase === "ready" ? status.automatic ? "Automatic on" : "Automatic off" : status.phase === "limit" ? "Storage limit" : "Protection unavailable"}`;
    const select = node.querySelector("[data-recovery-select]");
    const options = points.map(p => `<option value="${host.esc(p.id)}">${host.esc(date(p.createdAt))} · ${host.esc(reason(p.reason))} · ${counts(p)}</option>`).join("") || '<option value="">No recovery points</option>';
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = selected; select.disabled = pending || !points.length;
    node.querySelector("[data-recovery-preview-text]").textContent = preview ? `${date(preview.createdAt)} · ${reason(preview.reason)} · ${counts(preview)} · ${(preview.bytes / 1024).toFixed(1)} KiB. Restore requires a separate confirmation.` : "Select a point to review its date and journal counts before restoring.";
    const text = node.querySelector("[data-recovery-status]"); text.textContent = message; text.dataset.error = String(error);
  }
  function accept(result) {
    status = result.status; points = result.points;
    if (!points.some(p => p.id === selected)) selected = points[0]?.id || "";
  }
  async function run(kind, value) {
    if (!active() || pending) return;
    const token = ++generation, point = preview; pending = true; error = false;
    if (!["restore", "preview"].includes(kind)) preview = null;
    message = kind === "restore" || kind === "clear" ? "Review the confirmation before continuing…" : "Checking local recovery…"; paint();
    try {
      const result = await (kind === "list" ? host.api.recoveryList() : kind === "automatic" ? host.api.setRecoveryAutomatic(value) : kind === "create" ? host.api.checkpointNow() : kind === "preview" ? host.api.previewCheckpoint(selected) : kind === "restore" ? host.restore({ id: point.id, sha256: point.sha256 }) : host.api.clearCheckpoints());
      if (!active() || token !== generation) return;
      loaded = true;
      if (kind === "preview") { preview = result; message = "Point reviewed. Restore asks for confirmation before changing your journal."; }
      else if (kind === "restore") {
        message = result ? "Journal restored. Game observation is disconnected; existing API keys are preserved." : "Restore cancelled. Your journal is unchanged.";
        if (result) { preview = null; const list = await host.api.recoveryList(); if (!active() || token !== generation) return; accept(list); }
      } else if (result) {
        accept(result); message = kind === "create" ? "Recovery point saved locally." : kind === "clear" ? "Recovery history cleared. Future protection follows your automatic choice." : status.phase === "limit" ? "Protection reached its size limit. Your journal is still saved; no content was trimmed." : status.phase === "unavailable" ? "Protection is unavailable. Your journal is still saved. Check local storage and try again." : kind === "automatic" ? status.automatic ? "Automatic protection is on. Future changes can create points." : "Automatic protection is off. Existing points are retained." : "Local recovery history is ready. Recent edits may be newer than the latest point.";
      } else message = "Clear cancelled. Your recovery history is unchanged.";
    } catch (e) {
      if (!active() || token !== generation) return;
      preview = null; loaded = true; error = true;
      message = /Recovery limit/.test(e.message) ? "Recovery limit reached. No journal content was trimmed. A point must fit within 64 MiB." : /Preview|changed/.test(e.message) ? "Your journal or recovery point changed. Refresh and preview it again." : "Recovery is unavailable. Your journal was not replaced. Check local storage and try again.";
    } finally { if (active() && token === generation) { pending = false; paint(); } }
  }
  function init(value) {
    host = value; guard = InteractionGuard.create({ root: host.root, active });
    host.root.addEventListener("click", event => {
      const button = event.target.closest("button"); if (!button) return;
      for (const kind of ["create", "refresh", "preview", "restore", "clear"]) if (button.hasAttribute(`data-recovery-${kind}`)) { void run(kind === "refresh" ? "list" : kind); return; }
      if (button.dataset.nav || button.dataset.character || ["reset", "import", "delete-character"].includes(button.dataset.command) || button.dataset.command?.startsWith("setup-")) invalidate();
    });
    host.root.addEventListener("change", event => {
      if (event.target.hasAttribute("data-recovery-automatic")) void run("automatic", event.target.checked);
      if (event.target.hasAttribute("data-recovery-select")) { generation++; selected = event.target.value; preview = null; message = "Preview this dated point before restoring."; paint(); }
    });
  }
  return { init, markup, invalidate, sync() { if (!active()) { if (loaded || pending) invalidate(); } else if (!loaded && !pending) void run("list"); }, paint, deferRender: fn => guard?.defer(fn, "root") };
})();
