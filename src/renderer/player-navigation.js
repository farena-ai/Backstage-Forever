"use strict";
window.PlayerNavigation = (() => {
  const primary = Object.freeze([
    ["now", "➶", "Now"],
    ["adventure", "◈", "Adventure"],
    ["world-map", "✥", "World Map"],
    ["quest-guide", "⌖", "Quests"],
    ["assistant", "✧", "Companion"],
    ["characters", "♙", "Characters"],
    ["company", "♜", "Plans"],
  ]);
  const groups = {
    adventure: {label:"Adventure",routes:[["adventure","Next step"],["dungeons","Dungeons & raids"],["preparation","Professions"]],description:"Your next step, dungeons and profession plans."},
    company: {
      label: "Plans",
      routes: [
        ["company", "My plans"],
        ["party", "Party"],
      ],
      description:
        "Choose a checklist or plan together. Every step stays yours.",
    },
    game: {
      label: "Settings",
      routes: [
        ["game", "Game connection"],
        ["connections", "AI connection"],
        ["updates", "Updates"],
      ],
      description:
        "Connect on your terms. Your journal works without an account or AI.",
    },
    guide: {
      label: "Help",
      routes: [["guide", "Field guide"], ["commands", "Commands"]],
      description:
        "Learn the basics, review a support report, or recover your local journal below.",
    },
  };
  function group(route) {
    return (
      Object.keys(groups).find((key) =>
        groups[key].routes.some(([id]) => id === route),
      ) || route
    );
  }
  function current(route) {
    const key = group(route),
      section = groups[key];
    return {
      group: key,
      label:
        section?.label ||
        primary.find(([id]) => id === route)?.[2] ||
        "Adventure",
      pageLabel:
        section?.routes.find(([id]) => id === route)?.[1] ||
        primary.find(([id]) => id === route)?.[2] ||
        "Adventure",
    };
  }
  function button(route, glyph, label, selected, kind) {
    return `<button type="button" aria-label="${label}" data-shell-control="${kind}:${route}" data-nav="${route}" class="${selected ? "active" : ""}" ${selected ? 'aria-current="page"' : ""}><span class="glyph" aria-hidden="true">${glyph}</span><span>${label}</span></button>`;
  }
  function main(route) {
    return `<nav aria-label="Main navigation">${primary.map(([id, glyph, label]) => button(id, glyph, label, group(route) === id, "nav")).join("")}</nav>`;
  }
  function secondary(route) {
    return `<nav class="secondary-navigation" aria-label="Settings and help">${button("game", "⚙", "Settings", group(route) === "game", "nav")}${button("guide", "▤", "Help", group(route) === "guide", "nav")}</nav><small class="settings-update-status" data-update-label>Updates</small>`;
  }
  function subtabs(route) {
    const section = groups[group(route)];
    if (!section) return "";
    return `<section class="player-section" aria-label="${section.label} sections"><div class="player-section-heading"><span class="player-seal" aria-hidden="true">${group(route) === "company" ? "♜" : group(route) === "game" ? "⚙" : "▤"}</span><p>${section.description}</p></div><nav class="player-subtabs" aria-label="${section.label} navigation">${section.routes.map(([id, label]) => button(id, "", label, route === id, "subtab")).join("")}</nav>${group(route)==="company"?'<button class="professions-shortcut" data-professions-shortcut data-nav="preparation" data-shell-control="professions-shortcut">Professions workshop →</button>':""}</section>`;
  }
  const tools = new Map();
  function remember(container) {
    container.querySelectorAll("[data-player-tool]").forEach((n) => {
      // Native toggle events are queued; a paint must not strand active audio.
      if (n.dataset.playerTool === "voice" && tools.get("voice") && !n.open)
        void Voice.close();
      tools.set(n.dataset.playerTool, n.open);
    });
  }
  function disclosure(tool, label, content) {
    return `<details class="player-tool" data-player-tool="${tool}" ${tools.get(tool) ? "open" : ""}><summary data-interaction-key="tool:${tool}">${label}</summary>${content}</details>`;
  }
  function reveal(container, tool) {
    tools.set(tool, true);
    const panel = container.querySelector(`[data-player-tool="${tool}"]`);
    if (panel) panel.open = true;
  }
  const mountedPanels = new WeakSet();
  function mounted(container) {
    container.querySelectorAll("[data-player-tool]").forEach((panel) => {
      if (mountedPanels.has(panel)) return;
      mountedPanels.add(panel);
      panel.addEventListener("toggle", () => {
        if (!panel.isConnected) return;
        tools.set(panel.dataset.playerTool, panel.open);
        if (panel.dataset.playerTool === "voice" && !panel.open) {
          void Voice.close();
        }
      });
    });
  }
  return {
    primary,
    group,
    current,
    main,
    secondary,
    subtabs,
    remember,
    disclosure,
    reveal,
    mounted,
  };
})();
