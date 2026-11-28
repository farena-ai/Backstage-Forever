(function (root) {
  "use strict";

  const STALE_MINUTES = 15;
  const minutesOld = ({ checkedAt, savedAt }) => Math.max(0, Math.floor((checkedAt - savedAt) / 60000));
  function savedLabel(context) {
    const minutes = minutesOld(context);
    if (minutes < 1) return "Last saved just now";
    if (minutes < 60) return `Last saved ${minutes} min ago`;
    if (minutes < 1440) return `Last saved ${Math.floor(minutes / 60)} hr ago`;
    return `Last saved ${Math.floor(minutes / 1440)} days ago`;
  }

  function header(context) {
    if (context.kind === "live") return { text: "Live", repair: false };
    if (context.kind === "saved") return { text: savedLabel(context), repair: minutesOld(context) >= STALE_MINUTES };
    return { text: context.kind === "manual" ? "No game save yet" : "", repair: false };
  }

  function answer(context) {
    if (!context || context.kind === "none") return "";
    const parts = ["Character data at reply"];
    if (context.kind === "manual") parts.push("Manual profile");
    if (context.kind === "live") parts.push("Live game link");
    if (context.savedAt !== null) parts.push(savedLabel(context));
    return parts.map((part) => root.I18n?.tr(part) || part).join(" · ");
  }

  function recovery(status) {
    switch (status?.signal) {
      case "minimized": return "Restore the WoW window to resume live updates.";
      case "nogame": return "Open WoW Forever and enter the world on this character.";
      case "other-character": return "Select the character you are playing, or log into this character in WoW.";
      case "no-signal": return "Type /bf live on in WoW to resume live updates.";
      case "compact-unreadable":
      case "hairline-unreadable": return "Type /bf live safe in WoW to use the more readable live strip.";
      default: return "In WoW, type /reload on this character to save your progress. BF will pick it up automatically.";
    }
  }

  const api = { header, answer, recovery };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CharacterFreshness = api;
})(globalThis);
