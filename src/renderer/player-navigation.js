"use strict";
window.PlayerNavigation = (() => {
  const primary = Object.freeze([
    ["now", "➶", "Now"],
    ["adventure", "◈", "Adventure"],
    ["world-map", "✥", "World Map"],
    ["quest-guide", "⌖", "Quests"],
    ["assistant", "✧", "Companion"],
    ["characters", "♙", "Characters"],
    ["ledger", "⚖", "Ledger"],
    ["company", "♜", "Plans"],
  ]);
  const groups = {
    adventure: {label:"Adventure",routes:[["adventure","Next step"],["guided-route","Guided route"],["zones","Zones"],["travel","Travel"],["dungeons","Dungeons & raids"],["preparation","Professions"],["practice-lab","Practice Lab"]],description:"Your next step, every zone, a travel planner, dungeons with run history and keys, and professions with a recipe book."},
    company: {
      label: "Plans",
      routes: [
        ["company", "My plans"],
        ["party", "Party"],
        ["guild", "Guild"],
        ["calendar", "Calendar"],
      ],
      description:
        "Checklists for a session, a profession or a dungeon run, party plans to share, a guild page with events, and a cooldown calendar.",
    },
    characters: {
      label: "Characters",
      routes: [["characters", "Journal"], ["alts", "All characters"], ["sheet", "Sheet"], ["talents", "Talents"], ["journey", "Journey"], ["badges", "Badges"]],
      description: "Your characters at a glance, their journals, gear and a gear plan, talents and trainer costs, the story so far, and every badge.",
    },
    ledger: {
      label: "Ledger",
      routes: [["ledger", "Bags & bank"], ["ledger-gold", "Gold & prices"], ["ledger-crafts", "Craft profit"], ["ledger-reputation", "Reputation"], ["ledger-cooldowns", "Cooldowns"]],
      description: "What every character carries, their gold and the prices you saw, craft profit, a reputation planner and cooldowns.",
    },
    game: {
      label: "Settings",
      routes: [
        ["game", "Game connection"],
        ["connections", "AI connection"],
        ["updates", "Updates"],
        ["privacy", "Privacy & sharing"],
      ],
      description:
        "Your game folder, the AI the companion uses, app updates, and what the app shares.",
    },
    guide: {
      label: "Help",
      routes: [["guide", "Field guide"], ["commands", "Commands"], ["coverage", "Data coverage"], ["report", "Report a problem"], ["reports", "My reports"]],
      description:
        "Learn the basics, look up every command, see how much the app knows zone by zone, report a problem and read the reply, or recover your local journal below.",
    },
  };
  // Pages opened from inside another page keep that page highlighted in the tab row.
  const nested = { "run-history": ["dungeons", "Run history"], attunements: ["dungeons", "Keys & attunements"] };
  function group(route) {
    if (nested[route]) route = nested[route][0];
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
        nested[route]?.[1] ||
        section?.routes.find(([id]) => id === route)?.[1] ||
        primary.find(([id]) => id === route)?.[2] ||
        "Adventure",
    };
  }
  function button(route, glyph, label, selected, kind) {
    return `<button type="button" aria-label="${label}" data-shell-control="${kind}:${route}" data-nav="${route}" class="${selected ? "active" : ""}" ${selected ? 'aria-current="page"' : ""}><span class="glyph" aria-hidden="true">${glyph}</span><span>${label}</span></button>`;
  }
  function main(route) {
    return `<nav class="primary-navigation" aria-label="Main navigation">${primary.map(([id, glyph, label]) => button(id, glyph, label, group(route) === id, "nav")).join("")}</nav>`;
  }
  function secondary(route) {
    return `<nav class="secondary-navigation" aria-label="Settings and help">${button("game", "⚙", "Settings", group(route) === "game", "nav")}${button("guide", "▤", "Help", group(route) === "guide", "nav")}</nav><small class="settings-update-status" data-update-label>Updates</small>`;
  }
  function subtabs(route) {
    const section = groups[group(route)];
    if (!section) return "";
    return `<section class="player-section" aria-label="${section.label} sections"><div class="player-section-heading"><span class="player-seal" aria-hidden="true">${group(route) === "company" ? "♜" : group(route) === "game" ? "⚙" : group(route) === "ledger" ? "⚖" : "▤"}</span><p>${section.description}</p></div><nav class="player-subtabs" aria-label="${section.label} navigation">${section.routes.map(([id, label]) => button(id, "", label, (nested[route]?.[0] || route) === id, "subtab")).join("")}</nav>${group(route)==="company"?'<button class="professions-shortcut" data-professions-shortcut data-nav="preparation" data-shell-control="professions-shortcut">Professions workshop →</button>':""}</section>`;
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
