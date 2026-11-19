"use strict";
// The companion panel over the game (0.38, A15; one window since 0.39.1): your questions and the
// answers (formatted and escaped like the companion chat), a question box (Enter asks, Esc closes),
// close and "Open in app". Hovering keeps it from hiding by itself.
(() => {
  const api = window.askPanel, root = document.querySelector("[data-ask-panel]");
  if (!api || !root) return;
  const $ = (sel) => root.querySelector(sel);
  const SOURCE = { travel: "Forever travel reference · offline", npc: "Forever NPC reference · offline", quick: "Companion · offline answer", scope: "Companion", ai: "Companion · AI suggestion" };
  const input = $("[data-ap-input]"), form = $("[data-ap-form]"), list = $("[data-ap-log]"), body = $("[data-ap-body]");
  let typing = 0, sending = false, revision = -1;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  function entry(s) {
    const item = el("article", "ap-item");
    item.dataset.status = s.status;
    const q = el("p", "ap-question"); q.append(el("span", "ap-label", "You asked"), document.createTextNode(" " + (s.question || ""))); item.append(q);
    const a = el("div", "ap-answer companion-reply");
    if (s.status === "answer") a.innerHTML = window.CompanionReply.render(s.answer?.text || "");
    else if (s.status === "error") a.append(el("p", "ap-error", s.message || ""));
    else a.append(el("p", "ap-thinking", "Thinking…"));
    item.append(a);
    if (s.note) item.append(el("p", "ap-note", s.note));
    if (s.status === "answer") item.append(el("p", "ap-kind", SOURCE[s.answer?.kind] || SOURCE.ai));
    return item;
  }
  function paint(v) {
    if (!v || !Array.isArray(v.log) || !Number.isSafeInteger(v.revision) || v.revision < revision) return;
    revision = v.revision;
    list.replaceChildren(...v.log.map(entry));
    $("[data-ap-empty]").hidden = v.log.length > 0;
    const last = v.log.at(-1), at = last && Number.isFinite(last.at) ? new Date(last.at) : null;
    $("[data-ap-when]").textContent = at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    root.dataset.status = last ? last.status : "empty";
    body.scrollTop = body.scrollHeight;
    // Opened from the game (owl, /bf ask): the cursor goes straight into the question box.
    if (Number.isInteger(v.typing) && v.typing !== typing) { typing = v.typing; input.focus(); }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (!q || sending) return;
    sending = true;
    api.ask(q).then(() => { input.value = ""; }).catch(() => {}).finally(() => { sending = false; input.focus(); });
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); api.close().catch(() => {}); } });
  // Act on the press itself (pointerdown), so a real click always lands even if the window is
  // still becoming active; the click that follows is ignored.
  let acted = 0;
  const act = (event) => {
    const b = event.target.closest("[data-ap]");
    if (!b) return;
    if (event.type === "click" && Date.now() - acted < 800) return;
    if (event.type === "pointerdown") { if (event.button !== 0) return; acted = Date.now(); event.preventDefault(); }
    if (b.dataset.ap === "close") api.close().catch(() => {});
    if (b.dataset.ap === "open") api.openApp().catch(() => {});
  };
  root.addEventListener("pointerdown", act);
  root.addEventListener("click", act);
  root.addEventListener("mouseenter", () => api.hold(true).catch(() => {}));
  root.addEventListener("mouseleave", () => api.hold(false).catch(() => {}));
  api.onState(paint);
  api.state().then(paint).catch(() => {});
})();
