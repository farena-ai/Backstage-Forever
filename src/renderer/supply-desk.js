"use strict";
window.SupplyDesk = (() => {
  const states = { pledged: "Pledged", reserved: "Reserved", delivered: "Delivered", available: "Available" };
  const labels = { request: "request", commitment: "commitment", capability: "capability" };
  const button = (kind, label, id = "") => `<button type="button" data-supply-action="${kind}" data-supply-id="${id}">${label}</button>`;
  const amount = r => `<dl class="supply-counts">${Object.entries(states).map(([key, label]) => `<div><dt>${label}</dt><dd>${r.totals[key]}</dd></div>`).join("")}</dl><p>${r.remaining} still requested after recorded deliveries.</p>`;

  function mount({ root, page, previous, focus, api, esc }) {
    const content = root.querySelector(".content");
    if (previous?.dataset.supplyDesk === page) {
      content.append(previous);
      focus?.focus({ preventScroll: true });
      return;
    }
    const reference = page === "preparation";
    const box = document.createElement("details");
    box.className = "panel supply-desk";
    box.dataset.supplyDesk = page;
    box.id = "supply-desk";
    // The shell interpolates only fixed labels and routes; record text is escaped below.
    box.innerHTML = `<summary>${reference ? "Supply Desk · read-only reference" : "Local Supply Desk"}</summary><p>${reference ? "These manual records are not used in Workshop estimates." : "Record requests and voluntary offers only with permission."} Records are kept for this app session and cleared when you quit. No game stock is read or moved, and nothing is sent or shared.</p><div class="actions"><button type="button" data-nav="${reference ? "company" : "preparation"}">${reference ? "Open Plans to manage records" : "Open Professions Workshop"}</button></div><p data-supply-message role="status"></p><div data-supply-body></div>`;
    content.append(box);
    const body = box.querySelector("[data-supply-body]");
    const summary = box.querySelector("summary");
    const message = box.querySelector("[data-supply-message]");
    let model, editor, busy = false;
    const field = (key, label, value = "", max = 80) => `<label>${label}<input name="${key}" required maxlength="${max}" value="${esc(value)}"></label>`;
    const number = value => `<label>Quantity<input name="quantity" required type="number" min="1" max="99999" step="1" value="${value ?? ""}"></label>`;
    const status = value => `<label for="supply-state">Commitment state</label><select id="supply-state" name="status">${Object.entries(states).map(([id, label]) => `<option value="${id}" ${id === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
    const describe = (type, row) => !row ? "—" : type === "request" ? `${row.quantity} × ${row.item}` :
      type === "commitment" ? `${row.volunteer}: ${row.quantity} ${states[row.status]} for ${model.requests.find(r => r.id === row.requestId)?.item ?? "a removed request"}` : `${row.volunteer}: ${row.offer}`;
    function editorView() {
      const { type, row, remove } = editor;
      const action = remove ? "Remove" : row ? "Correct" : "Add";
      const fields = remove ? `<p>${esc(describe(type, row))}</p>` : type === "request" ? field("item", "Requested item", row?.item) + number(row?.quantity) :
        type === "commitment" ? field("volunteer", "Volunteer label", row?.volunteer) + number(row?.quantity) + status(row?.status) :
        field("volunteer", "Volunteer label", row?.volunteer) + field("offer", "Volunteered capability", row?.offer, 120);
      return `<form class="supply-editor" aria-labelledby="supply-editor-title"><h3 id="supply-editor-title" tabindex="-1">${action} ${labels[type]}</h3>${fields}${row ? field("reason", "Reason for change", "", 160) : ""}<div class="actions"><button type="submit" class="primary">${remove ? "Confirm removal" : "Save locally"}</button>${button("cancel", "Cancel")}</div></form>`;
    }
    const rowActions = (type, id, removable = true) => `<div class="actions">${button(`edit-${type}`, `Correct ${labels[type]}`, id)}${removable ? button(`remove-${type}`, `Remove ${labels[type]}`, id) : ""}</div>`;
    // Templates interpolate escaped text, validated numeric counts/UUIDs, or fixed labels only.
    function paint() {
      if (!model) { body.innerHTML = button("read", "Retry Supply Desk"); return; }
      if (editor) { body.innerHTML = editorView(); return; }
      const requests = model.requests.map(r => {
        const entries = model.commitments?.filter(entry => entry.requestId === r.id) ?? [];
        return `<article class="supply-row"><h4>${esc(r.item)} · ${r.quantity} requested</h4>${amount(r)}${reference ? "" :
          `${rowActions("request", r.id, !entries.length)}${button("add-commitment", "Add commitment", r.id)}${entries.length ? `<ul>${entries.map(entry => `<li>${esc(entry.volunteer)} · ${entry.quantity} ${states[entry.status]}${rowActions("commitment", entry.id)}</li>`).join("")}</ul>` : "<p>No commitments recorded.</p>"}`}</article>`;
      }).join("") || "<p>No requests recorded.</p>";
      body.innerHTML = `<h3 tabindex="-1" data-supply-heading>Supply requests</h3><p>Each commitment has one recorded state. Only recorded deliveries reduce what is still requested. Available is a voluntary report, not verified stock.</p>${reference ? "" : button("add-request", "Add request")}${requests}${reference ? "" :
        `<h3>Voluntary capability directory</h3>${button("add-capability", "Add capability")}${model.capabilities.length ? `<ul>${model.capabilities.map(row => `<li>${esc(row.volunteer)} · ${esc(row.offer)}${rowActions("capability", row.id)}</li>`).join("")}</ul>` : "<p>No capabilities volunteered.</p>"}<details><summary>Change history (${model.history.length}; latest 100)</summary><ol>${[...model.history].reverse().map(row => `<li><time datetime="${esc(row.at)}">${esc(new Date(row.at).toLocaleString())}</time> · ${labels[row.type]}: ${esc(describe(row.type, row.before))} → ${esc(describe(row.type, row.after))}${row.reason ? ` · ${esc(row.reason)}` : ""}</li>`).join("")}</ol></details>`}`;
    }
    async function read() {
      if (busy) return;
      busy = true;
      message.textContent = "Opening Supply Desk…";
      try { model = await api.supplyDesk(reference ? "reference" : "read"); message.textContent = ""; }
      catch { model = null; message.textContent = "Supply Desk could not be opened. Try again."; }
      finally { busy = false; paint(); }
    }
    summary.addEventListener("click", () => { if (!box.open) void read(); });
    box.addEventListener("toggle", () => {
      if (!box.open && !busy) { model = editor = null; body.replaceChildren(); message.textContent = ""; }
      else if (box.open && !model && !busy && !message.textContent) void read();
    });
    function focusControl(action, id) {
      const control = [...body.querySelectorAll("[data-supply-action]")].find(el => el.dataset.supplyAction === action && el.dataset.supplyId === id);
      (control || body.querySelector("[data-supply-heading]") || summary).focus();
    }
    box.addEventListener("click", event => {
      const control = event.target.closest("[data-supply-action]");
      if (!control || busy) return;
      const { supplyAction: action, supplyId: id } = control.dataset;
      if (action === "read") { read(); return; }
      if (reference || !model) return;
      if (action === "cancel" && editor) {
        const { action, id } = editor;
        editor = null; message.textContent = ""; paint(); focusControl(action, id); return;
      }
      const [verb, type] = action.split("-");
      if (!Object.hasOwn(labels, type) || !["add", "edit", "remove"].includes(verb)) return;
      const rows = type === "capability" ? model.capabilities : model[`${type}s`];
      const row = verb === "add" ? null : rows.find(row => row.id === id);
      if ((verb !== "add" && !row) || (type === "commitment" && verb === "add" && !model.requests.some(r => r.id === id))) return;
      editor = { type, row, action, id, remove: verb === "remove" };
      message.textContent = "";
      paint();
      const heading = box.querySelector("#supply-editor-title");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start" });
    });
    box.addEventListener("submit", async event => {
      event.preventDefault();
      if (reference || busy || !editor || !box.isConnected) return;
      const { type, row, remove, action, id } = editor;
      const values = Object.fromEntries([...new FormData(event.target)].map(([key, value]) => [key, value.trim()]));
      if (Object.hasOwn(values, "quantity")) values.quantity = Number(values.quantity);
      const edit = { type, ...values, ...(row && { id: row.id }), ...(remove && { remove: true }),
        ...(!remove && type === "commitment" && { requestId: row?.requestId ?? id }) };
      busy = true;
      const submit = event.submitter;
      if (submit) submit.disabled = true;
      try {
        model = await api.supplyDesk("change", { token: model.token, revision: model.revision, edit });
        editor = null; message.textContent = "Saved on this installation."; paint();
        if (box.open && box.isConnected) focusControl(action, id);
      } catch (error) {
        const detail = /Supply Desk[^\n]*/.exec(error.message)?.[0];
        message.textContent = detail ?? "Supply Desk records could not be saved. Try again.";
        if (detail?.includes("no longer current")) { model = editor = null; paint(); focusControl("read", ""); }
        else if (submit && box.isConnected && box.open) { submit.disabled = false; submit.focus(); }
      } finally { busy = false; }
    });
  }
  return { mount };
})();
