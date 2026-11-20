"use strict";
(() => {
  const MAX_BYTES = 4096;
  const sizeError = "Plan pack exceeds the 4 KiB limit.";
  const dialog = document.createElement("dialog");
  dialog.id = "local-plan-pack";
  dialog.className = "panel";
  dialog.setAttribute("aria-labelledby", "local-plan-title");
  // No maxlength: native editing can truncate an oversized paste into valid JSON.
  // Static markup only; every imported value is rendered as text below.
  dialog.innerHTML = `
    <h2 id="local-plan-title">Local plan pack</h2>
    <p>WoW Forever · The Deadmines · Preparation only. This checklist stays on this computer and does not change the journal or the game.</p>
    <h3 data-plan-active>Active plan</h3><ol data-plan-active-steps></ol>
    <button type="button" data-plan-rollback hidden>Preview previous plan</button>
    <label for="local-plan-file">Preview a local JSON file (up to 4 KiB)</label>
    <input type="file" id="local-plan-file" accept=".json,application/json">
    <label for="local-plan-source">Or paste plan pack JSON (up to 4 KiB)</label>
    <textarea id="local-plan-source" rows="4" spellcheck="false"></textarea>
    <div class="actions"><button type="button" data-plan-example>Load example</button><button type="button" data-plan-preview>Preview import</button></div>
    <section data-plan-review hidden aria-labelledby="local-plan-review-title">
      <h3 id="local-plan-review-title" tabindex="-1"></h3><ol data-plan-review-steps></ol>
      <p data-plan-effect></p><div class="actions"><button type="button" data-plan-discard>Cancel preview</button><button type="button" class="primary" data-plan-apply>Import reviewed plan</button></div>
    </section>
    <p data-plan-status role="status"></p>
    <button type="button" data-plan-close autofocus>Close</button>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const source = find("textarea"), file = find("#local-plan-file"), active = find("[data-plan-active]"), rollback = find("[data-plan-rollback]");
  const review = find("[data-plan-review]"), heading = find("#local-plan-review-title"), apply = find("[data-plan-apply]");
  const preview = find("[data-plan-preview]"), example = find("[data-plan-example]"), status = find("[data-plan-status]");
  let generation = 0, token = null, current = null, triggeringButton = null, reviewOrigin = null;
  const invoke = (...args) => window.backstage.localPlanPack(...args);
  const cancel = () => { invoke("cancel").catch(() => {}); };
  function steps(selector, pack, labels) {
    find(selector).replaceChildren(...(pack?.steps || []).map(id => {
      const li = document.createElement("li");
      li.textContent = labels[id];
      return li;
    }));
  }
  function showActive(model) {
    current = model;
    active.textContent = model.active ? `Active plan · revision ${model.active.revision}` : "No active plan";
    steps("[data-plan-active-steps]", model.active, model.labels);
    rollback.hidden = model.previousRevision === null;
  }
  function clearReview() { token = reviewOrigin = null; review.hidden = true; steps("[data-plan-review-steps]", null); }
  function busy(value) {
    for (const control of [preview, example, rollback, apply, source, file]) control.disabled = value;
  }
  async function run(args, success, { lock = false } = {}) {
    const request = ++generation;
    status.textContent = "";
    busy(true);
    if (!lock) source.disabled = false;
    let succeeded = false;
    try {
      const result = await invoke(...args);
      if (!dialog.open || request !== generation) return;
      success(result);
      succeeded = true;
    } catch (error) {
      if (dialog.open && request === generation) status.textContent = error.message;
    } finally {
      if (dialog.open && request === generation) busy(args[0] === "status" && !succeeded);
    }
  }
  function beginReview(origin, action, ...args) {
    clearReview();
    run([action, ...args], model => {
      const restoring = action === "previewRollback";
      showActive(model);
      heading.textContent = `${restoring ? "Previous" : "Proposed"} plan · revision ${model.proposed.revision}`;
      steps("[data-plan-review-steps]", model.proposed, model.labels);
      find("[data-plan-effect]").textContent = restoring
        ? "This replaces the active plan with the previous revision and uses up this rollback."
        : model.active ? "This replaces the active plan and keeps it as the one rollback copy." : "This installs the first plan. There is no earlier revision to restore.";
      apply.textContent = restoring ? "Restore previous plan" : "Import reviewed plan";
      token = model.token;
      reviewOrigin = origin;
      review.hidden = false;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  function discard() {
    ++generation;
    clearReview();
    cancel();
    busy(!current);
    status.textContent = "";
  }
  document.addEventListener("click", event => {
    const opener = event.target.closest("[data-open-local-plan-pack]");
    if (!opener || dialog.open) return;
    triggeringButton = opener;
    current = null;
    source.value = "";
    rollback.hidden = true;
    active.textContent = "Loading active plan…";
    steps("[data-plan-active-steps]", null);
    clearReview();
    dialog.showModal();
    run(["status"], showActive, { lock: true });
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    ++generation;
    clearReview();
    source.value = "";
    cancel();
    if (triggeringButton?.isConnected) triggeringButton.focus();
    else document.querySelector("[data-open-local-plan-pack]")?.focus();
  });
  find("[data-plan-close]").addEventListener("click", () => dialog.close());
  find("[data-plan-discard]").addEventListener("click", () => {
    const origin = reviewOrigin;
    discard();
    (origin || preview).focus();
  });
  source.addEventListener("input", discard);
  file.addEventListener("change", async () => {
    const selected = file.files[0];
    file.value = "";
    if (!selected) return;
    discard();
    const request = generation;
    if (selected.size > MAX_BYTES) { status.textContent = sizeError; return; }
    busy(true);
    try {
      const bytes = await selected.slice(0, MAX_BYTES + 1).arrayBuffer();
      if (request !== generation || !dialog.open) return;
      if (bytes.byteLength > MAX_BYTES) throw Error(sizeError);
      beginReview(file, "preview", new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch (error) {
      if (request !== generation || !dialog.open) return;
      busy(false);
      status.textContent = "Choose a readable UTF-8 plan pack JSON file up to 4 KiB.";
    }
  });
  example.addEventListener("click", () => {
    discard();
    source.value = JSON.stringify({ format: "backstage-forever-plan-pack", version: 1,
      scope: "forever:deadmines:preparation", revision: 1, steps: ["check-supplies", "agree-meeting-point"] }, null, 2);
    source.focus();
  });
  preview.addEventListener("click", () => {
    const raw = source.value;
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
      discard();
      status.textContent = sizeError;
      return;
    }
    beginReview(preview, "preview", raw);
  });
  rollback.addEventListener("click", () => beginReview(rollback, "previewRollback"));
  apply.addEventListener("click", () => {
    if (!token) return;
    const approved = token, restoring = apply.textContent === "Restore previous plan";
    clearReview();
    run(["apply", approved], model => {
      showActive(model);
      status.textContent = restoring ? "Previous plan restored locally." : "Reviewed plan imported locally.";
    }, { lock: true });
    find("[data-plan-close]").focus();
  });
})();
