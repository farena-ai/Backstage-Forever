"use strict";
window.AdventureCoach = (() => {
  let host,
    guard,
    context = "",
    generation = 0,
    model = null,
    loading = false,
    error = "",
    painting = false,
    retained = null;
  const modes = ["adventure", "questing", "professions"],
    labels = {
      adventure: "Adventure",
      questing: "Quests",
      professions: "Professions",
    };
  const active = () => Boolean(host?.active());
  const esc = (value) => host.esc(value);
  function preference() {
    let value;
    try {
      value = localStorage.getItem("bf-coach-mode:" + host.profile()?.id);
    } catch {}
    return modes.includes(value) ? value : "adventure";
  }
  function identity() {
    const p = host.profile();
    return JSON.stringify([
      p?.id,
      p?.source,
      p?.clientBuild,
      p?.quests,
      p?.readiness,
      preference(),
    ]);
  }
  function clear() {
    generation++;
    context = "";
    model = null;
    loading = false;
    error = "";
    retained = null;
    guard?.invalidate();
  }
  function sync() {
    if (!active()) {
      if (context) clear();
      return;
    }
    const key = identity();
    if (key === context) return;
    context = key;
    model = null;
    error = "";
    loading = false;
    const token = ++generation,
      p = host.profile();
    if (p?.source?.kind !== "wow-addon" || !p.clientBuild) return;
    loading = true;
    const valid = () =>
      active() && token === generation && context === key && identity() === key;
    host.api
      .adventureCoach(p.id, { mode: preference() })
      .then((value) => {
        if (valid()) {
          model = value;
          loading = false;
          paint();
        }
      })
      .catch(() => {
        if (valid()) {
          loading = false;
          error = "Saved coaching could not be read. Try again.";
          paint();
        }
      });
  }
  function content() {
    const primary = model?.recommendation,
      alternatives = model?.alternatives || [];
    if (!primary)
      return `<div class="coach-empty"><h2>${loading ? "Reading your saved trail…" : error ? "Your saved trail is still safe." : "A useful next step starts with an observation."}</h2><p>${esc(error || "Play normally to observe quests. Open your own profession normally to observe learned recipes and carried materials.")}</p>${error ? "<button data-coach-retry>Try saved coaching again</button>" : '<button data-coach-action data-nav="game">Review game connection →</button>'}</div>`;
    const glyph = {
      bags: "◈",
      quest: "✧",
      "craft-ready": "⚒",
      "profession-cap": "❧",
    }[primary.kind];
    return `<div class="coach-path"><article data-coach-primary><div class="coach-title"><span class="coach-sigil" aria-hidden="true">${glyph}</span><div><span class="eyebrow">YOUR NEXT STEP</span><h2>${esc(primary.title)}</h2></div></div><p class="coach-reason">${esc(primary.reason)}</p><p class="coach-detail">${esc(primary.detail)}</p><div class="coach-bottom"><span class="coach-evidence">${esc(primary.kind === "craft-ready" ? "Saved recipes and bags" : primary.evidence)}</span><button data-coach-action ${primary.kind === "quest" ? "data-coach-director" : 'data-nav="preparation"'}>${primary.kind === "quest" ? "Review quest choices" : "Open Professions"} →</button></div></article>${alternatives.length ? `<aside class="coach-alternatives" aria-label="Other useful paths">${alternatives.map((a) => `<div><span class="eyebrow">ANOTHER PATH</span><h3>${esc(a.title)}</h3><p>${esc(a.reason)}</p></div>`).join("")}</aside>` : ""}</div>`;
  }
  function render() {
    return `<section class="adventure-coach" data-adventure-coach aria-label="Proactive adventure coach"><header><span class="eyebrow">COMPASS · WORKS OFFLINE · NO AI</span><label>Desktop goal<select data-coach-mode aria-label="Desktop coach goal">${modes.map((m) => `<option value="${m}" ${m === preference() ? "selected" : ""}>${labels[m]}</option>`).join("")}</select></label></header><div data-coach-content>${content()}</div><footer><span data-coach-saved>Last saved · ${esc(model?.source?.updatedAt ? CommandCenter.savedTime(model.source.updatedAt) : "No saved observation")}${model?.freshness?.status === "stale" ? " · Older than 15 minutes" : ""}</span><small>Native Compass uses current observations. Goals here and in WoW are independent.</small></footer></section>`;
  }
  function paint() {
    if (!active() || guard.defer(paint)) return;
    const node = host.root.querySelector("[data-coach-content]");
    if (node) {
      node.innerHTML = content();
      host.root.querySelector("[data-coach-saved]").textContent =
        "Last saved · " +
        (model?.source?.updatedAt
          ? CommandCenter.savedTime(model.source.updatedAt)
          : "No saved observation") +
        (model?.freshness?.status === "stale"
          ? " · Older than 15 minutes"
          : "");
    }
  }
  function beginRender() {
    painting = true;
    const node = host.root.querySelector("[data-coach-mode]");
    retained =
      active() && node
        ? { node, context, focused: document.activeElement === node }
        : null;
  }
  function mounted() {
    const replacement = host.root.querySelector("[data-coach-mode]");
    if (replacement && retained && retained.context === context) {
      replacement.replaceWith(retained.node);
      retained.node.value = preference();
      if (retained.focused) retained.node.focus({ preventScroll: true });
    }
  }
  function endRender() {
    painting = false;
    retained = null;
  }
  function init(options) {
    host = options;
    guard = InteractionGuard.create({
      root: host.root,
      active,
      painting: () => painting,
    });
    host.root.addEventListener("change", (event) => {
      if (!event.target.matches("[data-coach-mode]") || !active()) return;
      const mode = event.target.value;
      if (!modes.includes(mode)) return;
      try {
        localStorage.setItem("bf-coach-mode:" + host.profile()?.id, mode);
      } catch {}
      sync();
      paint();
    });
    host.root.addEventListener("click", (event) => {
      if (event.target.closest("[data-coach-retry]")) {
        context = "";
        sync();
        paint();
      }
      if (event.target.closest("[data-coach-director]")) {
        PlayerNavigation.reveal(host.root, "coach-quest-plan");
        const node = host.root.querySelector("[data-director]");
        node?.scrollIntoView({ block: "start" });
        node?.querySelector("summary")?.focus({ preventScroll: true });
      }
    });
  }
  return {
    init,
    render,
    sync,
    clear,
    mounted,
    beginRender,
    endRender,
    deferRender: (callback) => guard?.defer(callback, "root") || false,
  };
})();
