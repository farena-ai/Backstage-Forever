"use strict";
// Settings → Addon settings profiles: the profiles each character kept in game (/bf profile save
// NAME, with /bf profile share on) and a button to send one to another character. The game offers
// a sent profile at the next login or /reload; it is applied there only on /bf profile accept.
window.SettingsProfiles = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const t = (text) => esc(window.I18n?.tr(text) ?? text);
  let view = null, loadedAt = 0, note = "", bad = false, busy = false, target = "";

  const who = (c) => [c.name, c.realm].filter(Boolean).join(" · ");
  const day = (seconds) => (seconds ? window.I18n?.when(seconds * 1000, "date") || "" : "");
  const WHY = { sum: "damaged", read: "damaged", form: "damaged", big: "too long", version: "from a newer addon", empty: "empty", data: "holds data" };

  function inner() {
    if (!view) return `<p class="sp-muted">${t("Reading your saved file…")}</p>`;
    const targets = view.targets || [];
    if (!targets.some((c) => c.id === target)) target = "";
    const chosen = targets.find((c) => c.id === target) || null;
    const steps = `<ol class="sp-steps"><li>${t("In game, on the character whose settings you like, type")} <code>/bf profile save main</code></li><li>${t("Then type")} <code>/bf profile share on</code> ${t("and")} <code>/reload</code></li><li>${t("Pick the other character here and press Send. In game on that character, type")} <code>/bf profile accept</code></li></ol>`;
    const waiting = (view.waiting || []).map((w) => `<li><span><strong>${esc(w.key)}</strong> ${t("is waiting for")} <b>${esc(w.name)}</b> ${t("from")} ${esc(w.from)}</span><button type="button" class="subtle" data-sp-cancel="${esc(w.key)}" ${busy ? "disabled" : ""}>${t("Take back")}</button></li>`).join("");
    const sources = (view.sources || []).map((s) => {
      const rows = s.profiles.map((p) => {
        const same = chosen && chosen.key === s.key;
        const can = p.ok && chosen && !same && !busy;
        const label = chosen ? `${t("Send to")} ${esc(chosen.name)}` : t("Send");
        const facts = p.ok ? `${p.settings} ${t("settings")}${p.at ? ` · ${t("kept")} ${esc(day(p.at))}` : ""}` : `<span class="sp-bad">${t("Cannot be sent:")} ${t(WHY[p.reason] || "damaged")}</span>`;
        return `<tr><th scope="row">${esc(p.name)}</th><td>${facts}</td><td class="sp-act"><button type="button" class="primary" data-sp-send="${esc(s.id)}" data-sp-name="${esc(p.name)}" ${can ? "" : "disabled"}>${label}</button></td></tr>`;
      }).join("");
      return `<div class="sp-source"><h4>${esc(who(s))}</h4><table class="sp-table"><tbody>${rows}</tbody></table></div>`;
    }).join("");
    const picker = targets.length ? `<label class="sp-pick" for="sp-target">${t("Send to")}<select id="sp-target" data-sp-target><option value="">${t("Choose a character")}</option>${targets.map((c) => `<option value="${esc(c.id)}"${c.id === target ? " selected" : ""}>${esc(who(c))}</option>`).join("")}</select></label>` : "";
    return `${sources ? `${picker}<div class="sp-sources">${sources}</div>` : `<p class="sp-empty">${t("No kept profile in your saved file yet.")}</p>`}
      ${waiting ? `<h4 class="sp-waiting-title">${t("Waiting to be offered in game")}</h4><ul class="sp-waiting">${waiting}</ul><p class="sp-muted">${t("Offered at the next login or /reload of that character. Nothing changes there until you type")} <code>/bf profile accept</code>.</p>` : ""}
      ${note ? `<p class="sp-note${bad ? " bad" : ""}" role="status">${esc(note)}</p>` : ""}
      <details class="sp-how"${sources ? "" : " open"}><summary>${t("How to copy settings to another character")}</summary>${steps}<p class="sp-muted">${t("A profile holds the addon's switches and window positions, not your notes or records. It stays on this computer.")}</p></details>`;
  }
  function markup() {
    if (!view || Date.now() - loadedAt > 15000) queueMicrotask(load);
    return `<section class="panel sp-card" data-settings-profiles aria-labelledby="sp-title">
      <div class="sp-heading"><div><div class="eyebrow">${t("In-game addon")}</div><h2 id="sp-title">${t("Addon settings profiles")}</h2></div><button type="button" class="subtle" data-sp-refresh>${t("Read again")}</button></div>
      <p>${t("Copy your Backstage Forever addon settings from one character to another.")}</p>
      <div data-sp-body>${inner()}</div></section>`;
  }
  function paint() { const el = document.querySelector("[data-sp-body]"); if (el) el.innerHTML = inner(); }
  async function load() {
    if (!api?.settingsProfiles) { view = { sources: [], targets: [], waiting: [] }; paint(); return; }
    loadedAt = Date.now();
    try { view = await api.settingsProfiles(); } catch { view = view || { sources: [], targets: [], waiting: [] }; }
    paint();
  }
  async function act(fn, done) {
    if (busy) return;
    busy = true; note = ""; bad = false; paint();
    try { view = await fn(); note = done; } catch (e) { note = String(e?.message || "That did not work.").replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); bad = true; }
    busy = false; paint();
  }
  document.addEventListener("change", (e) => { if (e.target?.matches?.("[data-sp-target]")) { target = e.target.value; note = ""; paint(); } });
  document.addEventListener("click", (e) => {
    const send = e.target.closest?.("[data-sp-send]"), cancel = e.target.closest?.("[data-sp-cancel]");
    if (send && target) {
      const to = (view?.targets || []).find((c) => c.id === target);
      act(() => api.sendSettingsProfile(send.dataset.spSend, send.dataset.spName, target), `${window.I18n?.tr("Sent. It is offered in game at the next login or /reload of") ?? "Sent. It is offered in game at the next login or /reload of"} ${to ? to.name : ""}.`);
    } else if (cancel) act(() => api.cancelSettingsProfile(cancel.dataset.spCancel), window.I18n?.tr("Taken back.") ?? "Taken back.");
    else if (e.target.closest?.("[data-sp-refresh]")) { note = ""; load(); }
  });
  return { markup, load, _state: () => ({ view, target, note }) };
})();
