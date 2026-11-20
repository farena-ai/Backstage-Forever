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
  const modes = [["", "Leave unchanged"], ["on", "Turn on"], ["off", "Turn off"]];
  function command(choices) {
    const args = rows.flatMap(([key]) => ["on", "off"].includes(choices.get(key)) ? [`${key}=${choices.get(key)}`] : []);
    return args.length ? `/bf helpers apply ${args.join(" ")} commit` : "";
  }
  function read(batch) {
    return new Map(Array.from(batch?.querySelectorAll("select[data-helper-choice]") || [], el => [el.dataset.helperChoice, el.value]));
  }
  function owner(character) {
    return character && JSON.stringify([character.id, character.name, character.realm, character.source?.kind, character.source?.id, character.clientBuild]);
  }
  function markup(esc, character, previous) {
    const t = text => esc(window.I18n?.tr(text) ?? text);
    const identity = owner(character);
    const choices = read(identity && previous?.dataset.helperOwner === identity ? previous : null);
    const preview = command(choices);
    return `<section class="ingame-helpers" aria-labelledby="helper-preferences-title">
      <h3 id="helper-preferences-title">${t("In-Game Helpers")}</h3>
      <p>${t("Not sent. Review a command below, then enter it in WoW chat while playing the character you want to change.")}</p>
      <p>${t("Desktop cannot verify these settings. The addon confirms On or Off in chat. If the command is unavailable, update and load the companion addon. Helpers with no saved choice start on.")}</p>
      <p>${t("Open the checkboxes in WoW chat:")} <code>/bf helpers panel</code></p>
      ${identity ? `<details data-living-disclosure="helper-batch" data-helper-owner="${esc(identity)}">
        <summary>${t("Prepare changes for WoW")}</summary>
        <p>${t("Draft for:")} <strong>${esc([character.name, character.realm].filter(Boolean).join(" · "))}</strong></p>
        <p>${t("Choose only the settings to change. Leave unchanged does not mean On or Off.")}</p>
        <div class="helper-choice-grid">${rows.map(([key, label]) => `<div><label for="helper-choice-${key}">${t(label)}</label>
          <select id="helper-choice-${key}" data-helper-choice="${key}">${modes.map(([value, name]) => `<option value="${value}"${choices.get(key) === value ? " selected" : ""}>${t(name)}</option>`).join("")}</select></div>`).join("")}</div>
        <div data-helper-preview ${preview ? "" : "hidden"}>
          <p>${t("Confirm the character in WoW before pasting. The command changes whoever you are playing, not the selected desktop character. Apply it outside combat with the updated addon.")}</p>
          <label for="helper-batch-command">${t("Command to paste in WoW")}</label>
          <textarea id="helper-batch-command" rows="3" readonly spellcheck="false">${esc(preview)}</textarea>
          <button id="helper-select-command" type="button">${t("Select command")}</button>
          <p>${t("Copy the selected line yourself, paste it into WoW chat, and press Enter. Check the addon's reply in WoW.")}</p>
        </div>
      </details>` : `<p>${t("Select a desktop character to prepare a batch, or change settings directly in WoW.")}</p>`}
      ${rows.map(([key, label]) => `<details data-living-disclosure="helper-${key}"><summary>${t(label)}</summary>
        <dl><dt>${t("Turn on")}</dt><dd><code>/bf helpers ${key} on</code></dd>
        <dt>${t("Turn off")}</dt><dd><code>/bf helpers ${key} off</code></dd>
        <dt>${t("Check in WoW")}</dt><dd><code>/bf helpers ${key}</code></dd></dl></details>`).join("")}
      <p><button type="button" class="subtle" data-nav="commands">${t("All commands →")}</button></p>
    </section>`;
  }
  function mount(batch) {
    if (!batch) return;
    const preview = batch.querySelector("[data-helper-preview]");
    const text = batch.querySelector("textarea");
    batch.addEventListener("change", event => {
      if (!event.target.matches("select[data-helper-choice]")) return;
      text.value = command(read(batch));
      preview.hidden = !text.value;
    });
    batch.querySelector("#helper-select-command").addEventListener("click", () => {
      text.focus();
      text.select();
    });
  }
  window.HelperPreferences = { markup, mount, owner };
})();
