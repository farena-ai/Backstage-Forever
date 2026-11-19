"use strict";
window.FieldDispatchDesktop = (() => {
  const destinations = {
    companion: ["assistant", "Open Companion", "Begleiter öffnen"],
    workshop: ["preparation", "Open Workshop", "Werkstatt öffnen"],
    ledger: ["ledger", "Open Ledger", "Inventarbuch öffnen"],
    badges: ["badges", "Open Badges", "Abzeichen öffnen"],
    now: ["now", "Open Now", "Jetzt öffnen"],
    "guided-route": ["guided-route", "Open Guided Route", "Geführte Route öffnen"],
    atlas: ["dungeons", "Open Instance Atlas", "Instanzatlas öffnen"],
  };
  const german = () => document.documentElement.lang === "de";
  const button = () => `<button type="button" data-command="field-dispatch" data-no-translate>${german() ? "Was ist neu?" : "What’s New"}</button>`;
  function create({ api, root, ready, navigate, notify }) {
    let requesting = false, settled = false, manualRequest = false, presentation;
    let generation = 0;
    let liveCombat, combatEpoch = 0, recheckAfterCombat = false;
    const host = document.getElementById("field-dispatch-host");
    const blocked = () => !ready() || document.querySelector(".bf-onboarding, dialog[open]");
    const eligible = () => !blocked() && !document.hidden && document.hasFocus() && !manualRequest;
    const dispatch = FieldDispatch.create({
      host, illustration: "art/heroes/whats-new.webp",
      actions: Object.fromEntries(Object.entries(destinations).map(([id, [page, en, de]]) => [id, {
        get label() { return german() ? de : en; }, run: () => navigate(page),
      }])),
      onDismiss(reason) {
        const current = presentation;
        presentation = null;
        const dismissedAt = generation;
        if (reason === "acknowledged" && current) void current.saved.then(async valid => {
          if (dismissedAt !== generation) return;
          if (!valid || !await api.fieldDispatchAcknowledge(current.id)) throw new Error();
        }).catch(() => {
          if (dismissedAt === generation) notify(german() ? "Die Bestätigung konnte nicht gespeichert werden." : "Could not save the acknowledgement. The recap may return next time.");
        });
      },
    });
    const main = () => root.querySelector("#main-content");
    async function startup() {
      if (settled || requesting || !eligible()) return;
      requesting = true;
      const requestedAt = generation;
      const requestedBeforeCombat = combatEpoch;
      try {
        const response = await api.fieldDispatchStartup();
        // A failed write is not an empty recap. Retry only on a later readiness event.
        if (!response || response.retry || requestedAt !== generation || combatEpoch !== requestedBeforeCombat || !eligible()) return;
        if (!response.offer) { settled = true; return; }
        const { id, model } = response.offer;
        const target = document.activeElement;
        if (dispatch.openRecap(model, () => target !== document.body && target?.isConnected ? target : main())) {
          settled = true; // Includes deferral, Escape and navigation; restart may offer it again.
          presentation = { id, saved: api.fieldDispatchPresented(id).catch(() => false) };
        }
      } catch { /* The journal must remain usable if release state is unavailable. */ }
      finally {
        if (requestedAt === generation) {
          requesting = false;
          if (recheckAfterCombat) { recheckAfterCombat = false; void startup(); }
        }
      }
    }
    async function history(invoker) {
      if (manualRequest || blocked()) return;
      manualRequest = true;
      const requestedAt = generation;
      try {
        const model = await api.fieldDispatchHistory();
        const current = root.querySelector('[data-command="field-dispatch"]');
        if (requestedAt === generation && !blocked() && current) dispatch.openHistory(model, () => invoker.isConnected ? invoker : root.querySelector('[data-command="field-dispatch"]') || main());
      } finally { if (requestedAt === generation) manualRequest = false; }
    }
    window.addEventListener("focus", startup);
    document.addEventListener("visibilitychange", startup);
    api.onLiveLink(status => {
      const combat = Boolean(status.enabled && status.signal === "live" && status.frame?.combat);
      if (combat === liveCombat) return;
      liveCombat = combat;
      // Main uses the current bridge frame. The event also invalidates any offer
      // that crossed a new combat observation on its way back to this renderer.
      if (combat) { combatEpoch++; recheckAfterCombat = false; }
      else if (requesting) recheckAfterCombat = true;
      else void startup();
    });
    // Closing a welcome tour or an intervening modal does not repaint the journal.
    new MutationObserver(startup).observe(document.body, { childList: true });
    host.querySelector("dialog").addEventListener("close", startup);
    function reset() {
      generation++;
      settled = requesting = manualRequest = recheckAfterCombat = false;
      presentation = null;
      dispatch.reset();
    }
    return { startup, history, reset };
  }
  return { button, create };
})();
