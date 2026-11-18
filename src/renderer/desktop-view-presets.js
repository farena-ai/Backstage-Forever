"use strict";
window.DesktopViewPresets = (() => {
  const model = window.DesktopViewPresetModel;
  const prefix = "bf-desktop-view-prefs:";
  const names = { compact: "Compact", guided: "Guided", planner: "Planner" };
  const labels = { nowMoreSuggestions: "Now: More suggestions", preparationSources: "Professions: Where this comes from" };
  let owner = null, choice = "compact", preview = null, message = "";

  const read = id => {
    const raw = localStorage.getItem(prefix + id);
    // A stored JSON null is not an absent record; do not overwrite malformed data.
    const record = raw === null ? null : JSON.parse(raw) ?? false;
    return { raw, record };
  };
  function defaults(id) {
    try { return model.resolveViewPreferences(id ? read(id).record : null); }
    catch { return model.resolveViewPreferences(null); }
  }
  function sync(id) {
    if (owner === id) return;
    owner = id;
    preview = null;
    message = "";
    choice = "compact";
    if (id) {
      try {
        const { record } = read(id);
        model.resetViewPreferences(record); // Validate without mutating storage.
        choice = record?.preset ?? "compact";
      } catch { /* markup reports unavailable preferences */ }
    }
  }
  function remove(id) {
    sync(null);
    try {
      if (id) localStorage.removeItem(prefix + id);
      else for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    } catch { /* journal cleanup does not depend on optional view storage */ }
  }
  const control = (key) => `data-shell-control="view-preset:${key}"`;
  const button = (key, text, attrs = "") => `<button type="button" ${control(key)} data-view-preset-action="${key}" ${attrs}>${text}</button>`;
  const options = (entries, selected) => Object.entries(entries).map(([key, label]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${label}</option>`).join("");
  function markup(id, esc) {
    sync(id);
    let body = "<p>Select a saved character to change its desktop view.</p>";
    if (id) {
      try {
        const { raw, record } = read(id);
        model.resetViewPreferences(record);
        if (preview && preview.raw !== raw) {
          preview = null;
          message = "View preferences changed. Preview the preset again.";
        }
        const saved = record?.preset ? names[record.preset] : "Default view";
        body = `<p>Changes only which sections start open in this desktop journal for the selected character.</p>
          <p><strong>Current preset:</strong> <span>${saved}</span></p>
          <label><span>View preset</span><select data-view-preset-choice ${control("choice")}>${options(names, choice)}</select></label>
          <div class="actions">${preview ? "" : button("preview", "Preview preset")}</div>
          ${preview ? `<div class="callout" data-view-preset-preview><p><strong>Preset preview</strong> · <span>${names[preview.preset]}</span></p>
            ${preview.changes.length ? `<ul>${preview.changes.map(({ key, to }) => `<li><span>${labels[key]}</span> · <span>${to ? "Starts open" : "Starts closed"}</span></li>`).join("")}</ul>` : "<p>No change to which sections start open.</p>"}
            <div class="actions">${button("apply", "Apply preset", 'class="primary"')}${button("cancel", "Cancel preview")}</div></div>` : ""}
          <p>Overrides are saved immediately and take precedence over presets.</p>
          <div class="form-grid">${Object.entries(labels).map(([key, label]) => `<label><span>${label}</span><select data-view-override="${key}" ${control(key)}>${options({ inherit: "Use preset default", open: "Start open", closed: "Start closed" }, Object.hasOwn(record?.overrides ?? {}, key) ? record.overrides[key] ? "open" : "closed" : "inherit")}</select></label>`).join("")}</div>
          <div class="actions">${button("reset", "Reset view preferences", raw === null ? "disabled" : "")}</div>`;
      } catch {
        preview = null;
        body = "<p>Saved view preferences are unavailable. Using the default view without replacing them.</p>";
      }
    }
    return `<details data-view-presets="${esc(id)}" data-living-disclosure="view-presets"><summary>Desktop view presets</summary><div data-view-preset-body>${body}</div><p data-view-preset-status role="status">${esc(message)}</p></details>`;
  }
  function init({ root, activeId, esc }) {
    function handle(event) {
      const target = event.target;
      const panel = target.closest?.("[data-view-presets]");
      const id = activeId();
      if (!panel || !id || id !== owner || panel.dataset.viewPresets !== id || root.querySelector("#active-character")?.value !== id) return;
      const action = event.type === "click" ? target.dataset.viewPresetAction : null;
      const override = event.type === "change" ? target.dataset.viewOverride : null;
      const selection = event.type === "change" && target.hasAttribute("data-view-preset-choice");
      if (!action && !override && !selection) return;
      let focus = action ?? (override || "choice");
      message = "";
      try {
        const { raw, record } = read(id);
        if (selection) {
          choice = target.value;
          preview = null;
        } else if (override) {
          if (!["inherit", "open", "closed"].includes(target.value)) return;
          const value = target.value === "inherit" ? null : target.value === "open";
          localStorage.setItem(prefix + id, JSON.stringify(model.setViewOverride(record, override, value)));
          preview = null;
          message = "View override saved.";
        } else if (action === "preview") {
          preview = { ...model.previewViewPreset(record, choice), raw };
          focus = "apply";
        } else if (action === "cancel") {
          preview = null;
          focus = "preview";
        } else if (action === "apply") {
          if (preview && preview.raw === raw) {
            localStorage.setItem(prefix + id, JSON.stringify(model.applyViewPreset(record, preview.preset)));
            message = "View preset applied.";
          } else message = "View preferences changed. Preview the preset again.";
          preview = null;
          focus = "preview";
        } else if (action === "reset") {
          model.resetViewPreferences(record);
          localStorage.removeItem(prefix + id);
          preview = null;
          choice = "compact";
          message = "Default view restored.";
          focus = "preview";
        }
      } catch {
        preview = null;
        message = "Could not save desktop view preferences.";
      }
      // Keep the native disclosure and its scroll position while replacing its controls.
      const template = document.createElement("template");
      // The markup escapes the scope and status; all other content comes from fixed labels.
      template.innerHTML = markup(id, esc);
      panel.querySelector("[data-view-preset-body]").replaceWith(template.content.querySelector("[data-view-preset-body]"));
      panel.querySelector("[data-view-preset-status]").textContent = message;
      const next = panel.querySelector(`[${control(focus)}]`) || panel.querySelector("summary");
      next.focus({ preventScroll: true });
      if (focus === "apply") panel.querySelector("[data-view-preset-preview]")?.scrollIntoView({ block: "center" });
      else next.scrollIntoView({ block: "nearest" });
    }
    root.addEventListener("click", handle);
    root.addEventListener("change", handle);
  }
  return { defaults, sync, remove, markup, init };
})();
