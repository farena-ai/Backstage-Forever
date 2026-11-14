"use strict";
// In-game answer panel (0.38, A15): question, answer (formatted and escaped like the companion
// chat), close and "Open in app". Hovering keeps it from hiding by itself.
(() => {
  const api = window.askPanel, root = document.querySelector("[data-ask-panel]");
  if (!api || !root) return;
  const $ = (sel) => root.querySelector(sel);
  const SOURCE = { travel: "Forever travel reference · offline", npc: "Forever NPC reference · offline", quick: "Bundled reference · offline", scope: "Companion", ai: "Companion · AI suggestion" };
  function paint(s) {
    if (!s) return;
    root.dataset.status = s.status;
    $("[data-ap-question]").textContent = s.question || "";
    const at = Number.isFinite(s.at) ? new Date(s.at) : null;
    $("[data-ap-when]").textContent = at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const answer = $("[data-ap-answer]");
    if (s.status === "answer") answer.innerHTML = window.CompanionReply.render(s.answer?.text || "");
    else if (s.status === "error") { answer.textContent = ""; const p = document.createElement("p"); p.className = "ap-error"; p.textContent = s.message || ""; answer.append(p); }
    else { answer.textContent = ""; const p = document.createElement("p"); p.className = "ap-thinking"; p.textContent = "Thinking…"; answer.append(p); }
    const note = $("[data-ap-note]");
    note.textContent = s.note || ""; note.hidden = !s.note;
    $("[data-ap-source]").textContent = s.status === "answer" ? SOURCE[s.answer?.kind] || SOURCE.ai : s.status === "thinking" ? "Question received from the game" : "";
    $("[data-ap-body]").scrollTop = 0;
  }
  root.addEventListener("click", (event) => {
    const b = event.target.closest("[data-ap]");
    if (!b) return;
    if (b.dataset.ap === "close") api.close().catch(() => {});
    if (b.dataset.ap === "open") api.openApp().catch(() => {});
  });
  root.addEventListener("mouseenter", () => api.hold(true).catch(() => {}));
  root.addEventListener("mouseleave", () => api.hold(false).catch(() => {}));
  api.onState(paint);
  api.state().then(paint).catch(() => {});
})();
