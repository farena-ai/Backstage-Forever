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
  // Painted crest and the page each kind of advice belongs to: bag advice goes to a vendor, craft advice to Professions.
  const KIND = {
    bags: { art: "art/pins/vendor.png", label: "Find a vendor on the map", nav: "world-map", extra: '<button type="button" data-nav="commands">How /bf junk sells greys</button>' },
    quest: { art: "art/steps/quest.png", label: "Review quest choices", director: true, extra: '<button type="button" data-nav="quest-guide">Open Quests</button>' },
    "craft-ready": { art: "art/pins/profession-trainer.png", label: "Open Professions", nav: "preparation" },
    "profession-cap": { art: "art/steps/train.png", label: "Open Professions", nav: "preparation", extra: '<button type="button" data-nav="world-map">Find a profession trainer</button>' },
    "materials-needed": { art: "art/pins/herb.png", label: "Open Professions", nav: "preparation", extra: '<button type="button" data-nav="world-map">Find herbs and ore on the map</button>' },
  };
  const kindOf = (kind) => KIND[kind] || { art: "art/steps/quest.png", label: "Open Quests", nav: "quest-guide" };
  function content() {
    const primary = model?.recommendation,
      alternatives = model?.alternatives || [];
    if (!primary)
      return `<div class="coach-empty bf-row"><img class="coach-crest" src="art/steps/quest.png" alt="" width="52" height="52"><div><h3>${loading ? "Reading your saved trail…" : error ? "Your coaching could not be read." : "Your next step appears after your first save."}</h3><p>${esc(error || "Log in with the addon on and type /reload once (or log out). Quests you carry and professions you open in game then turn into advice here.")}</p><div class="bf-actions">${error ? "<button data-coach-retry>Try again</button>" : '<button data-coach-action data-nav="game">Open Game connection</button>'}</div></div></div>`;
    const k = kindOf(primary.kind);
    const action = k.director ? `<button data-coach-action data-coach-director>${k.label}</button>` : `<button data-coach-action data-nav="${k.nav}">${k.label}</button>`;
    return `<div class="coach-path"><article class="bf-row first" data-coach-primary data-coach-kind="${esc(primary.kind)}"><img class="coach-crest" src="${k.art}" alt="" width="52" height="52"><div><span class="eyebrow">Your next step</span><h3>${esc(primary.title)}</h3><p class="coach-reason">${esc(primary.reason)}</p>${primary.detail ? `<p class="coach-detail">${esc(primary.detail)}</p>` : ""}<div class="bf-actions">${action}${k.extra || ""}</div></div></article>${alternatives.length ? `<div class="coach-alternatives" aria-label="Other useful paths">${alternatives.map((a) => `<div class="bf-row"><img class="coach-crest" src="${kindOf(a.kind).art}" alt="" width="40" height="40"><div><span class="eyebrow">Also worth doing</span><h3>${esc(a.title)}</h3><p>${esc(a.reason)}</p></div></div>`).join("")}</div>` : ""}</div>`;
  }
  const savedLine = () => (model?.source?.updatedAt ? "From your save · " + CommandCenter.savedTime(model.source.updatedAt) : "No save read yet") + (model?.freshness?.status === "stale" ? " · older than 15 minutes" : "");
  function render() {
    return `<section class="adventure-coach bf-card lead" data-adventure-coach aria-label="Adventure coach"><header class="coach-head"><h2>Coach <small>works offline, no AI</small></h2><label>Focus on<select data-coach-mode aria-label="Desktop coach goal">${modes.map((m) => `<option value="${m}" ${m === preference() ? "selected" : ""}>${labels[m]}</option>`).join("")}</select></label></header><div data-coach-content>${content()}</div><footer><small data-coach-saved>${esc(savedLine())}</small></footer></section>`;
  }
  function paint() {
    if (!active() || guard.defer(paint)) return;
    const node = host.root.querySelector("[data-coach-content]");
    if (node) {
      node.innerHTML = content();
      host.root.querySelector("[data-coach-saved]").textContent = savedLine();
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
