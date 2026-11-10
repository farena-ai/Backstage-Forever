"use strict";
window.Support = (() => {
  let host, guard, generation = 0, report = null, pending = false, message = "Prepare a report to review exactly what you can share.", error = false, expiry;
  const active = () => Boolean(host?.active());
  function invalidate() {
    generation++; report = null; pending = false; error = false;
    message = "Prepare a report to review exactly what you can share.";
    clearTimeout(expiry); guard?.invalidate();
  }
  function markup() {
    return `<section class="panel support-card" data-support role="region" aria-labelledby="support-title"><div class="support-heading"><span class="support-seal" aria-hidden="true">✚</span><div><div class="eyebrow">07 · Help without oversharing</div><h2 id="support-title">Support &amp; Recovery</h2></div><span class="tag">LOCAL ONLY</span></div><p>A small status report can help explain a connection or update problem. Prepare it here, review every line, then choose whether to share it.</p><p class="support-scope">Includes app versions, connection states and counts. Excludes characters, private journals, conversations, model names, paths and credentials. Preparing this report never contacts a provider.</p><div class="button-row support-actions"><button type="button" class="primary" data-support-prepare ${pending ? "disabled" : ""}>Prepare report</button><button type="button" data-support-copy ${pending || !report ? "disabled" : ""}>Copy report</button><button type="button" data-support-save ${pending || !report ? "disabled" : ""}>Save report</button></div><p class="support-status" data-support-status role="status" aria-live="polite" ${error ? 'data-error="true"' : ""}>${host.esc(message)}</p><div class="support-preview"><h3 id="support-preview-title">Reviewed report snapshot</h3><p>Copy and Save use these exact lines. Reports expire after five minutes; prepare a fresh one if needed. Nothing is uploaded.</p><pre data-support-preview tabindex="0" aria-labelledby="support-preview-title">${host.esc(report?.text || "")}</pre></div><p class="corner-note">For a journal that will not open, preserve its files and use the startup recovery instructions. Private backups and Delete all local data remain in “Protect your journal” above.</p></section>`;
  }
  function paint() {
    if (!active() || guard.defer(paint)) return;
    const node = host.root.querySelector("[data-support]"); if (!node) return;
    // Update only report-owned text/properties; controls and surrounding guide nodes retain identity.
    node.querySelector("[data-support-prepare]").disabled = pending;
    node.querySelector("[data-support-copy]").disabled = pending || !report;
    node.querySelector("[data-support-save]").disabled = pending || !report;
    const status = node.querySelector("[data-support-status]"); status.textContent = message; status.dataset.error = String(error);
    node.querySelector("[data-support-preview]").textContent = report?.text || "";
  }
  async function run(kind) {
    if (!active() || pending || kind !== "prepare" && !report) return;
    const token = ++generation, id = report?.id; pending = true; error = false;
    if (kind === "prepare") { report = null; clearTimeout(expiry); }
    message = kind === "prepare" ? "Preparing a local report…" : kind === "copy" ? "Copying the reviewed report…" : "Choose where to save the reviewed report…"; paint();
    try {
      const result = await (kind === "prepare" ? host.api.diagnosticsPreview() : kind === "copy" ? host.api.copyDiagnostics(id) : host.api.exportDiagnostics(id));
      if (!active() || token !== generation) return;
      if (kind === "prepare") {
        if (!result || !/^[a-f0-9]{32}$/.test(result.id) || typeof result.text !== "string" || result.text.length > 8192) throw Error("Invalid report");
        report = Object.freeze({ id: result.id, text: result.text }); message = "Report ready. Review the exact snapshot below before sharing.";
        expiry = setTimeout(() => { if (report?.id !== result.id) return; generation++; pending = false; report = null; message = "This report expired. Prepare a new report to continue."; paint(); }, 300000);
      } else message = kind === "copy" ? "Report copied. Share it only where you choose." : result?.status === "cancelled" ? "Save cancelled. Your reviewed report is still available." : "Report saved. Nothing was uploaded.";
    } catch {
      if (!active() || token !== generation) return;
      report = null; clearTimeout(expiry); error = true;
      message = kind === "prepare" ? "The report could not be prepared. Try again." : kind === "copy" ? "The report could not be copied. Prepare a report and try again." : "The report could not be saved. Prepare a report and try again.";
    } finally { if (active() && token === generation) { pending = false; paint(); } }
  }
  function init(value) {
    host = value; guard = InteractionGuard.create({ root: host.root, active });
    host.root.addEventListener("click", event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-support-prepare")) void run("prepare");
      else if (button.hasAttribute("data-support-copy")) void run("copy");
      else if (button.hasAttribute("data-support-save")) void run("save");
      else if (button.dataset.nav || ["reset", "import"].includes(button.dataset.command) || button.dataset.command?.startsWith("setup-")) invalidate();
    });
  }
  return { init, markup, invalidate, sync() { if (!active()) invalidate(); }, deferRender: fn => guard?.defer(fn, "root") };
})();
