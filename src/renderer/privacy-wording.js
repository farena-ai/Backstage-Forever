"use strict";
// The privacy wording, in one place. The app (Settings → Privacy & sharing, Help → Report a
// problem), the website generator (scripts/build-site.cjs: the privacy page, the trust card and
// the FAQ) and the tests all read these sentences from here, so a change after review is a
// one-line edit. English is the reviewed text; data/i18n/*.json follows it.
// README.md, SECURITY.md and docs/PRIVACY.md repeat SUMMARY by hand (a test keeps them in step).
(() => {
  const SERVICE = "bf.backstagecoding.com";
  // Approved by the owner on 2026-11-24. Change these sentences only with the owner.
  // The short, true statement that replaces every "nothing leaves your computer" style claim.
  const SUMMARY = "Your characters stay on your computer. The app shares only what the live map needs and anonymous statistics that help improve it, with no account, character or realm names and no files. Reports are sent only when you write one. Each of these has its own off switch.";
  // What never leaves, wherever a list is shown.
  const NEVER = Object.freeze([
    "Account, character, realm or guild names",
    "Chat, mail or anything you type outside a report",
    "Files, file paths, screenshots or your game folder",
    "Your location in the game right now, exact positions or times of day",
    "Hardware ids; IP addresses are not stored",
  ]);
  // The four facts the privacy page must state plainly about the install number.
  const INSTALL_ID = Object.freeze([
    "The install number is made at random the first time the app runs. It is not built from your account, your characters or your computer.",
    "The server keeps only a scrambled form of it, so an install is counted once.",
    "IP addresses are not stored.",
    "Forget me deletes it: everything this install has sent is removed and the app starts over with a new random number.",
  ]);
  // The three switches of Settings → Privacy & sharing: the label and the sentence beside it.
  const SWITCHES = Object.freeze({
    share: Object.freeze({
      label: "Share map discoveries",
      text: "Herb and ore spots, NPC places, vendor stock and drops you come across are added to the shared map. They carry no account, character or realm name.",
    }),
    statistics: Object.freeze({
      label: "Send anonymous usage statistics",
      text: "Once a day the app sends its version, your operating system family, your language, the game build, and which main areas you opened. Nothing about your account or your game is included: no account, character, realm or guild names, no files, no chat. It is only counted with other installs to improve the software, and it cannot be tied back to you.",
    }),
    errors: Object.freeze({
      label: "Send automatic error reports",
      text: "When something breaks, send the error message with file paths removed, so it can be fixed.",
    }),
  });
  const BUTTONS = Object.freeze({ see: "See exactly what is sent", forget: "Forget me" });
  const REPORTS = "A report you send from Help → Report a problem contains what you typed and a short diagnostics block. You see all of it before it is sent, and you can leave the diagnostics out.";

  // Every field that can be sent, in plain words: [field as it is sent, plain label, what it is].
  const FIELDS = Object.freeze({
    statistics: Object.freeze([
      ["installId", "Install number", "A random number made on first run. The service stores only a scrambled form of it."],
      ["appVersion", "App version", "The version of the desktop app."],
      ["addonVersion", "Addon version", "The version of the in-game addon the app installed, if any."],
      ["channel", "Release channel", "Stable, beta or development build."],
      ["os", "System", "Windows, macOS or Linux."],
      ["osMajor", "System version", "Only the major number, for example 11."],
      ["lang", "Language", "The app's language: English, German, French or Spanish."],
      ["build", "Game build", "The build number of WoW Forever your saved character came from."],
      ["firstSeenWeek", "First week", "The calendar week the app first ran, for example 2026-W48."],
      ["flags.gameConnected", "Game folder connected", "Yes or no."],
      ["flags.addonInstalled", "Addon installed", "Yes or no."],
      ["flags.liveLink", "Live link in use", "Yes or no."],
      ["flags.sharing", "Sharing map discoveries", "Yes or no."],
      ["areas", "Pages opened today", "Which of these nine pages were opened: Now, Route, Map, Dungeons, Professions, Ledger, Talents, Journey, Companion. No counts and no times."],
    ]),
    report: Object.freeze([
      ["installId", "Install number", "The same random number as above."],
      ["appVersion", "App version", ""],
      ["addonVersion", "Addon version", ""],
      ["os", "System", "Windows, macOS or Linux."],
      ["osMajor", "System version", "Only the major number."],
      ["lang", "Language", ""],
      ["build", "Game build", ""],
      ["kind", "Kind of report", "Something is broken, wrong data, a translation, an idea or something else."],
      ["area", "Where", "The page or part of the app you picked from a list."],
      ["frequency", "How often", "Once, sometimes or always, if you said so."],
      ["summary", "Summary", "The one line you typed."],
      ["details", "What happened", "The text you typed."],
      ["expected", "What you expected", "The text you typed, if any."],
      ["diagnostics.screen", "Page you were on", "The name of the app page that was open."],
      ["diagnostics.lastError", "Last error message", "The last error the app showed, with file paths and names removed."],
      ["diagnostics.gameConnected", "Game folder connected", "Yes or no."],
      ["diagnostics.addonInstalled", "Addon installed", "Yes or no."],
    ]),
    replies: Object.freeze([
      ["text", "Your reply", "The text you typed in My reports."],
      ["ticket", "Report number", "For example BF-1042, so the service knows which report you mean."],
      ["key", "Report key", "A secret made by the service when you sent the report and kept on your computer. It is what lets your app, and nobody else, read the replies."],
      ["since", "Last message read", "The number of the last message you have seen, so only newer ones come back."],
    ]),
    errors: Object.freeze([
      ["installId", "Install number", "The same random number as above."],
      ["appVersion", "App version", ""],
      ["os", "System", "Windows, macOS or Linux."],
      ["osMajor", "System version", "Only the major number."],
      ["lang", "Language", ""],
      ["where", "Part of the app", "The background part or the window."],
      ["name", "Error type", "For example TypeError."],
      ["message", "Error message", "With file paths, names, e-mail addresses and long codes removed. At most 300 characters."],
      ["stack", "Where in the code", "Up to 12 lines naming the app's own code files and line numbers. File names only, no folders."],
    ]),
    discoveries: Object.freeze([
      ["installId", "Install number", "The same random number as above."],
      ["appVersion", "App version", ""],
      ["build", "Game build", ""],
      ["observations.nodes", "Gathering spots", "Herb, ore or chest, the object's number, the zone map, the position rounded to 0.5% of the map, and the item numbers it gave."],
      ["observations.npcs", "NPC places", "The creature's number, the zone map and the rounded position where you looted it."],
      ["observations.vendors", "Vendor stock", "A vendor's number and the item numbers it sells. The service accepts this; the app does not send it yet."],
      ["observations.drops", "Drops", "A creature's number, how many times it was looted and which item numbers dropped. The service accepts this; the app does not send it yet."],
      ["observations.recipes", "Recipe sources", "A trainer's or vendor's number and the recipe it teaches or sells. The service accepts this; the app does not send it yet."],
    ]),
    messages: Object.freeze([
      ["appVersion", "App version", "So you only get messages meant for your version."],
      ["os", "System", "Windows, macOS or Linux."],
      ["lang", "Language", ""],
    ]),
  });

  const api = { SERVICE, SUMMARY, NEVER, INSTALL_ID, SWITCHES, BUTTONS, REPORTS, FIELDS };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PrivacyWording = api;
})();
