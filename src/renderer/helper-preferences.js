"use strict";
(() => {
  const rows = [
    ["questTracker", "Quest tracker"],
    ["objectiveHints", "Objective hints"],
    ["questDetours", "Quest detours"],
    ["beforeLeaving", "Before leaving reminders"],
    ["rewardReasons", "Quest reward reasons"],
    ["questBlockers", "Quest blockers"],
    ["gatheringMarks", "Gathering marks"],
    ["sharedObjectives", "Shared objectives"],
    ["keepQuestItems", "Keep quest items"],
    ["questItemCue", "Quest item cue"],
    ["spellRankReminder", "Spell rank reminder"],
  ];
  function markup(esc) {
    const t = text => esc(window.I18n?.tr(text) ?? text);
    return `<section class="ingame-helpers" aria-labelledby="helper-preferences-title">
      <h3 id="helper-preferences-title">${t("In-Game Helpers")}</h3>
      <p>${t("Not sent. Review a command below, then enter it in WoW chat while playing the character you want to change.")}</p>
      <p>${t("Desktop cannot verify these settings. The addon confirms On or Off in chat. If the command is unavailable, update and load the companion addon. Helpers with no saved choice start on.")}</p>
      <p>${t("Open the checkboxes in WoW chat:")} <code>/bf helpers panel</code></p>
      ${rows.map(([key, label]) => `<details data-living-disclosure="helper-${key}"><summary>${t(label)}</summary>
        <dl><dt>${t("Turn on")}</dt><dd><code>/bf helpers ${key} on</code></dd>
        <dt>${t("Turn off")}</dt><dd><code>/bf helpers ${key} off</code></dd>
        <dt>${t("Check in WoW")}</dt><dd><code>/bf helpers ${key}</code></dd></dl></details>`).join("")}
      <p><button type="button" class="subtle" data-nav="commands">${t("All commands →")}</button></p>
    </section>`;
  }
  window.HelperPreferences = { markup };
})();
