"use strict";
// Questions from the game (0.38, A15): the Settings -> Game connection switch for the answer panel
// over the game, and the Companion page's "Use my active character" choice, which in-game
// questions follow exactly (reported to the main process; never widened).
(() => {
  const api = window.backstage;
  let settings = { enabled: true, hideAfterS: 45, moved: false, choices: [0, 20, 45, 90, 180] };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const label = (s) => (s ? `after ${s} seconds` : "only when I close it");
  function markup() {
    return `<hr class="rule"><h3>Questions from the game <span class="tag">New</span></h3><label class="check-label"><input type="checkbox" id="ask-panel-toggle" ${settings.enabled ? "checked" : ""}>Answer in-game questions in a panel over the game</label><p>Click the owl button on the minimap in WoW (or type <code>/bf ask</code>): the companion panel opens over the top-right of your game, ready to type. Press Enter to ask; the answer appears under your question, follow-ups go in the same box, and Esc closes it. Answers to <code>/bf ask QUESTION</code> from the chat line show there too, without taking your keyboard. Where and how questions are answered offline; others go to the AI you chose. Only what you typed is used, plus your active character when “Use my active character” is on in Companion. Every exchange also lands in the Companion conversation.</p><label class="ask-panel-hide">Hide the panel <select id="ask-panel-hide">${settings.choices.map((s) => `<option value="${s}" ${s === settings.hideAfterS ? "selected" : ""}>${esc(label(s))}</option>`).join("")}</select></label>${settings.moved ? ' <button type="button" class="subtle" data-ask-panel-reset>Put the panel back over the game</button>' : ""}`;
  }
  function paint() {
    for (const n of document.querySelectorAll("#ask-panel-toggle")) n.checked = settings.enabled;
    for (const n of document.querySelectorAll("#ask-panel-hide")) n.value = String(settings.hideAfterS);
    for (const n of document.querySelectorAll("[data-ask-panel-reset]")) n.hidden = !settings.moved;
  }
  // The Companion page keeps this choice in local storage (on unless the player turned it off).
  function share() { try { return localStorage.getItem("bf-share-character") !== "false"; } catch { return true; } }
  function report(value = share()) { api?.setInGameShare?.(value).catch(() => {}); }
  window.AskInGame = { markup, settings: () => settings, report };
  if (!api?.askInGameSettings) return;
  api.askInGameSettings().then((s) => { settings = s; paint(); }).catch(() => {});
  report();
  document.addEventListener("change", (event) => {
    const t = event.target;
    if (t?.id === "share-profile") report(t.checked === true);
    if (t?.id === "ask-panel-toggle") {
      const wanted = t.checked;
      api.setAskInGameSettings({ enabled: wanted }).then((s) => { settings = s; paint(); }).catch(() => { t.checked = !wanted; });
    }
    if (t?.id === "ask-panel-hide") {
      const value = Number(t.value);
      api.setAskInGameSettings({ hideAfterS: value }).then((s) => { settings = s; paint(); }).catch(() => paint());
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.("[data-ask-panel-reset]")) return;
    api.setAskInGameSettings({ resetPosition: true }).then((s) => { settings = s; paint(); }).catch(() => {});
  });
})();
