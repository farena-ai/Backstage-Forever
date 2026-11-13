"use strict";
// Commands: every in-game command and helper in plain English, in one place.
// The catalog is the single source of truth: tests/commands-catalog.test.cjs fails when the
// addon gains a /bf command that is not listed here (or this lists one the addon lacks).
(() => {
  const CATALOG = Object.freeze([
    { group: "Finding your way", command: "/bf next", word: "next", what: "Puts WoW's own arrow on the nearest thing to do: a finished quest to hand in first, otherwise the nearest quest you can pick up.", when: "Any time you're not sure what to do next.", example: "/bf next" },
    { group: "Finding your way", command: "/bf train", word: "train", what: "Puts the arrow on your class trainer: the nearest one in this zone, otherwise in your faction's cities.", when: "After you level up. New skills usually arrive every two levels.", example: "/bf train" },
    { group: "Finding your way", command: "/bf repair", word: "repair", what: "Puts the arrow on the nearest vendor who can repair your gear. The addon also remembers every repair vendor you open.", when: "When the game or Backstage Forever says your gear is wearing out.", example: "/bf repair" },
    { group: "Finding your way", command: "/bf flights", word: "flights", what: "Lists the flight masters in this zone and whether you've learned each flight path yet.", when: "When you arrive somewhere new. Learning a flight path lets you fly back later instead of running.", example: "/bf flights" },
    { group: "Finding your way", command: "/bf find NAME", word: "find", what: "Finds a person, a kind of person or a gathering spot by name and puts the arrow on the nearest match. Lists a few others too.", when: "Looking for a flight master, an innkeeper, a trainer, a vendor or a quest NPC.", example: "/bf find flight master" },
    { group: "Finding your way", command: "/bf how [quest]", word: "how", what: "Explains how to do your tracked quest (or the one you name): what is left, where you looted its items so far (dropped by which enemy, or picked up from objects, and near which coordinates) and the line of the quest text that says where to go.", when: "When you're stuck on a quest and not sure where the items come from.", example: "/bf how" },
    { group: "Finding your way", command: "/bf route [next|back|arrow]", word: "route", what: "Shows a small step-by-step guide for the zone you're in: pick up, do objectives, hand in, in the order that walks least. The game's arrow follows the current step and it moves on by itself as you accept and hand in quests.", when: "Whenever you'd rather just follow the next step. next/back browse the steps; arrow turns the arrow on or off.", example: "/bf route" },
    { group: "Finding your way", command: "/bf way MapID X Y [name]", word: "way", what: "Puts the arrow on exact map coordinates. The app's World Map gives you this line ready to paste.", when: "When the app or a guide gives you coordinates.", example: "/bf way 1413 51.5 30.4 Crossroads" },
    { group: "Finding your way", command: "/bf hearth", word: "hearth", what: "Tells you where your Hearthstone takes you and, if you're questing in another zone, which inn to make your home instead.", when: "Before a long trip, or when you start questing somewhere new.", example: "/bf hearth" },
    { group: "Your character", command: "/bf xp", word: "xp", what: "Shows your experience per hour this session, roughly how long until your next level, and any rested bonus.", when: "To see how fast you're leveling.", example: "/bf xp" },
    { group: "Your character", command: "/bf help", word: "help", what: "Lists the main commands in your chat window.", when: "Whenever you forget a command.", example: "/bf help" },
    { group: "Adventure Compass", command: "/bf", word: "", what: "Shows or hides the Adventure Compass, the small panel with your next step.", when: "To bring the panel back or tidy it away.", example: "/bf" },
    { group: "Adventure Compass", command: "/bf show", word: "show", what: "Shows the Adventure Compass.", when: "After hiding it with X.", example: "/bf show" },
    { group: "Adventure Compass", command: "/bf hide", word: "hide", what: "Hides the Adventure Compass.", when: "When you want a clean screen.", example: "/bf hide" },
    { group: "Adventure Compass", command: "/bf status", word: "status", what: "Says whether the addon is ready and reading your character.", when: "If something seems off.", example: "/bf status" },
    { group: "Helpers on or off", command: "/bf toasts [on|off]", word: "toasts", what: "Turns the pop-up tips on or off: level-ups, finished quests, deaths and the welcome. Chat still gets the message.", when: "If you prefer a quieter screen.", example: "/bf toasts off" },
    { group: "Helpers on or off", command: "/bf danger [on|off]", word: "danger", what: "Turns the warning above dangerous targets on or off (elites, skulls, much higher levels, enemies too low to give experience).", when: "Once you can judge enemies yourself.", example: "/bf danger off" },
    { group: "Helpers on or off", command: "/bf junk [on|off]", word: "junk", what: "Turns the Sell junk button on vendor windows on or off.", when: "If you'd rather sell by hand.", example: "/bf junk off" },
    { group: "Helpers on or off", command: "/bf gear [on|off]", word: "gear", what: "Turns the gear hints on or off: the gold glow on the quest reward that suits your class best, and the line on item tooltips that says whether something is an upgrade for you.", when: "If you'd rather judge gear yourself.", example: "/bf gear off" },
    { group: "Live link", command: "/bf live [on|off|status]", word: "live", what: "Turns on or off the tiny strip in the top-left corner that lets the desktop app follow you while you play. Status reports what the strip is doing.", when: "Turn it off for screenshots or streaming; turn it back on for live help in the app.", example: "/bf live status" },
    { group: "Advanced", command: "/bf guide …", word: "guide", what: "A waypoint line the app's Quests page prepares for a specific quest step. Copy it in the app and paste it into chat; you never need to type it yourself.", when: "Only when the app hands you one.", example: "/bf guide 840 t 1411 52.0 43.2 1.60.1.70888" },
  ]);
  const FEATURES = Object.freeze([
    { name: "Adventure Compass", where: "A small movable panel in game", what: "Your character, XP and the next step. Drag the title to move it; X hides it, - shrinks it. It hides itself in combat." },
    { name: "BF Guide on the world map", where: "Press M in game", what: "Shows quests you can pick up (checked against your level and faction), hand-ins, your class trainer, profession trainers and flight masters. Click a marker for an arrow. The BF Layers panel turns each kind on or off." },
    { name: "Quest progress in tooltips", where: "Hover an enemy in game", what: "If an enemy counts for one of your quests, its tooltip says which quest and how far along you are, like “Raptor Thieves: Raptor Head 3/12”. Drops count once you've looted that item from them." },
    { name: "Zone arrival banner", where: "Top of the screen", what: "When you enter a new zone: its name, its level range and how many quests there are for your level." },
    { name: "Danger warning", where: "Above your target's portrait", what: "Plain words about risky enemies: elite, skull, world boss, several levels above you, rare, or too low to give experience." },
    { name: "Pop-up tips", where: "Top of the screen", what: "Level-ups (with your nearest trainer), finished quests (with how many more you need to level) and deaths (with what to do). A one-time welcome too." },
    { name: "Arrow back to your body", where: "Minimap and screen arrow", what: "After you die and release your spirit, the arrow points to your body. Walk over it and click Resurrect." },
    { name: "Repair reminder", where: "Top of the screen", what: "A pop-up when your gear drops to a quarter of its durability, and again if something breaks. /bf repair shows the way." },
    { name: "Flight path reminder", where: "Top of the screen", what: "When you pass close to a flight master you haven't talked to, a pop-up suggests learning that flight path." },
    { name: "Hearthstone tip", where: "Top of the screen", what: "When you pick up quests in a zone while your Hearthstone still points somewhere else, a tip names the inn to switch to (once per zone)." },
    { name: "Sell junk button", where: "On every vendor window", what: "Lists your grey items and what they're worth. Sells them only when you click it, and never in combat." },
    { name: "Reward picker", where: "On the quest reward window", what: "When a quest lets you choose a reward, a gold glow marks the one that suits your class best and chat says why (for example +3 Agility, +12 armor) compared with what you wear. You still pick it yourself." },
    { name: "Upgrade hints", where: "On item tooltips", what: "One line under each piece of gear: green Upgrade for you with what you gain, red Not for you with the reason (like Priests cannot wear mail), or grey Not an upgrade. /bf gear off hides them." },
    { name: "Learns where quest items come from", where: "Quietly, whenever you loot", what: "When you loot an item a quest in your log asks for, the addon remembers whether an enemy dropped it or you picked it up from an object, and where you were. /bf how and the app use it to explain the quest." },
    { name: "Live strip", where: "A thin coloured line, top-left corner", what: "How the desktop app knows where you are. It contains no personal data. /bf live off hides it." },
  ]);
  const APP = Object.freeze([
    { name: "Now", what: "What to do next, where to level, your training, quest log and this session's pace. With the live link on, quests you hand in show as Completed straight away, no /reload needed. Start here." },
    { name: "World Map", what: "Zone maps with quest givers, hand-ins, trainers, flight masters, herbs and ore. Click anyone for details. Your path this session is drawn on it." },
    { name: "Quests", what: "Look up any quest: who gives it, where it goes, rewards. Copies a /bf guide line for the game." },
    { name: "Adventure", what: "Your next step in more depth, dungeons for your level, and profession plans." },
    { name: "Companion", what: "Ask in plain words. With no AI set up it still answers right away: “how do I do <quest>?”, “what should I do next?”, “what do I train?”, “where is <NPC>?” and “how do I get to <place>?”. An AI model (Settings) answers everything else." },
    { name: "Characters", what: "Each character's journal, gear and training review, and private notes." },
    { name: "Plans", what: "Checklists and party plans you write yourself." },
    { name: "Settings", what: "Game connection (folder, addon, live link), AI connection and updates." },
  ]);
  if (typeof module === "object" && module.exports) { module.exports = { CATALOG, FEATURES, APP }; return; }
  const ICONS = Object.freeze({ "Finding your way": "finding-your-way", "Your character": "your-character", "Adventure Compass": "adventure-compass", "Helpers on or off": "helpers", "Live link": "live-link", "Advanced": "advanced" });
  const icon = (name) => `<img class="cmd-ico" src="art/icons/${name}.png" alt="" width="40" height="40">`;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let filter = "";
  function rows() {
    const q = filter.trim().toLowerCase();
    const hit = (c) => !q || [c.command, c.what, c.when, c.group].join(" ").toLowerCase().includes(q);
    const groups = [...new Set(CATALOG.map((c) => c.group))];
    const html = groups.map((g) => {
      const list = CATALOG.filter((c) => c.group === g && hit(c));
      if (!list.length) return "";
      return `<section class="cmd-group"><h2>${ICONS[g] ? icon(ICONS[g]) : ""}${esc(g)}</h2><ul>${list.map((c) => `<li class="cmd-row">
        <div class="cmd-head"><code class="cmd-name">${esc(c.command)}</code><button type="button" class="cmd-copy" data-cmd-copy="${esc(c.example)}" aria-label="Copy ${esc(c.example)}">Copy</button></div>
        <p>${esc(c.what)}</p><p class="cmd-when"><strong>Use it:</strong> ${esc(c.when)}</p>${c.example !== c.command ? `<p class="cmd-eg">Example: <code>${esc(c.example)}</code></p>` : ""}</li>`).join("")}</ul></section>`;
    }).join("");
    return html || `<p class="cmd-empty">No command matches “${esc(filter)}”.</p>`;
  }
  function page() {
    return `<section class="commands-page" data-commands>
      <header class="cmd-hero"><span class="cmd-eyebrow">Help · Commands</span><h1>Everything you can type in game</h1>
        <p>Type these in WoW's chat box (press Enter, type the command, press Enter again). They only show you things or put an arrow on your map; nothing ever plays for you.</p>
        <label class="cmd-search"><span class="sr-only">Search commands</span><input type="search" data-cmd-filter placeholder="Search: trainer, arrow, junk, live…" value="${esc(filter)}"></label></header>
      <div class="cmd-list" data-cmd-list>${rows()}</div>
      <section class="cmd-group cmd-features"><h2>${icon("in-game")}Things you'll see in game</h2><ul>${FEATURES.map((f) => `<li class="cmd-row"><div class="cmd-head"><strong>${esc(f.name)}</strong><small>${esc(f.where)}</small></div><p>${esc(f.what)}</p></li>`).join("")}</ul></section>
      <section class="cmd-group cmd-app"><h2>${icon("around-the-app")}Around this app</h2><ul>${APP.map((a) => `<li class="cmd-row"><div class="cmd-head"><strong>${esc(a.name)}</strong></div><p>${esc(a.what)}</p></li>`).join("")}</ul></section>
      <p class="cmd-foot">After installing or updating, type <code>/reload</code> in game once. New to WoW? The Field guide explains words like rested, hand in and elite.</p>
    </section>`;
  }
  let bound = null;
  function mounted() {
    const root = document.querySelector("[data-commands]");
    if (!root || bound === root) return;
    bound = root;
    root.addEventListener("input", (e) => {
      if (!e.target.matches("[data-cmd-filter]")) return;
      filter = e.target.value.slice(0, 60);
      const list = root.querySelector("[data-cmd-list]"); if (list) list.innerHTML = rows();
    });
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cmd-copy]"); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.cmdCopy); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
      setTimeout(() => { b.textContent = "Copy"; }, 1500);
    });
  }
  window.CommandsView = { page, mounted, CATALOG, FEATURES, APP };
})();
