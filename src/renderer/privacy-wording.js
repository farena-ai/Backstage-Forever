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
      ["observations.nodes", "Gathering spots", "Herb, ore, chest or another object you looted a quest item from, the object's number, the zone map, the position rounded to 0.5% of the map, and the item numbers it gave."],
      ["observations.npcs", "NPC places", "The creature's number, the zone map and the rounded position where you looted it. For a vendor, the rounded position where you stood when you opened its window."],
      ["observations.npcs.name", "NPC name", "The name the game shows for that creature. Sent only from English game clients. Other players see it only after three installs sent the same name. Nothing you type is ever sent here."],
      ["observations.vendors", "Vendor stock", "A vendor's number and the item numbers it sells, from vendor windows you opened. No prices."],
      ["observations.vendors.name", "Vendor name", "The name the game shows for that vendor, under the same rules as the NPC name."],
      ["observations.drops", "Drops", "A creature's number, how many times it was looted and which item numbers dropped. The service accepts this; the app does not send it yet."],
      ["observations.recipes", "Recipe sources", "A trainer's or vendor's number and the recipe it teaches or sells. The service accepts this; the app does not send it yet."],
    ]),
    // POST /v1/mine: how the map knows which shared spots are yours.
    contributions: Object.freeze([
      ["installId", "Install number", "Your install number, and nothing else. The service answers with the spots, NPC places and vendor stock this install shared, so the map can mark them as yours. Asked a few times a day at most, and only while sharing is on."],
    ]),
    // What comes back for everyone in the daily pack, beside the spots themselves.
    pack: Object.freeze([
      ["firstSeen", "First seen", "The day a spot, NPC place or vendor item was first reported by anyone. A day, never a time."],
      ["lastSeen", "Last seen", "The day it was last reported by anyone. A day, never a time. The map uses it to say how fresh a spot is."],
      ["npcNames", "NPC names", "A name at least three installs sent for the same NPC."],
    ]),
    messages: Object.freeze([
      ["appVersion", "App version", "So you only get messages meant for your version."],
      ["os", "System", "Windows, macOS or Linux."],
      ["lang", "Language", ""],
    ]),
  });

  // Guild and party features (Backstage Live). A separate, opt-in category: nothing of it is sent
  // until the player joins a guild in the app or switches the realm party board on. It is the one
  // place where a character's name leaves the computer, so every screen that asks says so first.
  const GUILD = Object.freeze({
    label: "Guild and party features (only if you join)",
    text: "Off until you join. If you join your guild in the app, your character's name and realm and your answers to guild events are kept on the Backstage service for the members of your guild who joined, and are posted to the guild's Discord if its leader connected one. If you post on the realm party board, your listing is shown to other users on your realm and faction for 30 minutes. Leaving or removing deletes them.",
    // The join card. The guild's name stands between the two parts.
    join: Object.freeze(["Your guild", "uses Backstage Forever events. Joining shares your character's name and your sign-ups with your guild's members and its Discord. It never shares your account, files or chat."]),
    // The card before the first party board listing.
    board: "This shows your character's name, level and role to other Backstage Forever users on your realm and faction for 30 minutes.",
    boardHolds: "A listing holds your character's name and realm, level, class and role, the dungeon and the note you type.",
    boardOn: "Switching the board on asks the service for the listings of your realm and faction. It sends your realm and your faction, and nothing about your character until you post.",
    // The card a guild leader or officer sees before connecting the guild.
    leader: "Connecting your guild keeps on the Backstage service: the guild's name, realm and faction, your character's name, and the names and sign-ups of members who choose to join. Nothing is kept about anyone who does not join.",
    who: Object.freeze([
      "Members of your guild who joined in the app",
      "Your guild's Discord channel, if the guild leader connected one",
      "For a party board listing: other Backstage Forever users on your realm and faction",
    ]),
    leave: Object.freeze([
      "Leave (Plans → Guild) removes your character's name and your sign-ups from the service.",
      "Remove (Plans → Party) takes your listing off the board at once. It also disappears by itself after 30 minutes.",
      "A guild leader can delete everything the service holds about the guild with “Delete our guild's data”.",
      "Forget me also leaves every guild and removes your listing.",
    ]),
    never: "Even then, never sent: your account name, chat, mail, files, your position in the game, or anything about a character that did not join.",
    // Shown under "Never sent": the list above holds for everything else.
    exception: "One exception, and only if you choose it: guild and party features share the name and realm of a character you join with.",
    planner: "The group planner, your notes and “people you have run with” stay on this computer. A plan reaches your group only through the game, after your next /reload.",
  });
  // Field by field, as for the other categories. Keys are the fields as they are sent.
  const GUILD_FIELDS = Object.freeze({
    // POST /v1/guilds/join: a member joins.
    guildJoin: Object.freeze([
      ["installId", "Install number", "So the service can limit how often one install joins. Stored only in scrambled form."],
      ["linkCode", "Guild link code", "The code your guild leader typed in game. Your game heard it on the guild channel."],
      ["character.name", "Character name", "Exactly as the game shows it."],
      ["character.realm", "Realm", "Exactly as the game shows it."],
      ["rankIndex", "Guild rank number", "0 is the guild leader. It decides whether you count as an officer. It is what your game reports."],
      ["consent", "Your agreement", "Always “true”: the app sends nothing until you chose Join."],
    ]),
    // POST /v1/guilds: a leader or officer connects the guild.
    guildCreate: Object.freeze([
      ["installId", "Install number", "As above."],
      ["realm", "Realm", ""],
      ["faction", "Faction", "Horde or Alliance."],
      ["guildName", "Guild name", "As the game shows it."],
      ["character.name", "Character name", "Of the leader or officer who connects the guild."],
      ["character.realm", "Realm", ""],
      ["rankIndex", "Guild rank number", "0 for the guild leader, 1 for an officer."],
    ]),
    // PUT …/events/{id}/signups/{name}: an answer to an event.
    guildSignup: Object.freeze([
      ["who.name", "Character name", "Whose answer it is."],
      ["who.realm", "Realm", ""],
      ["answer", "Answer", "Tank, healer, damage, maybe or no."],
      ["version", "Answer number", "A counter, so the newest answer wins everywhere."],
      ["via", "Where it was given", "In game, in the desktop app or with a Discord button."],
    ]),
    // PUT …/events/{id}: an event (members whose guild rank allows it).
    guildEvent: Object.freeze([
      ["id", "Event number", "Made by the game when the event was proposed."],
      ["version", "Change number", "A counter, so the newest change wins everywhere."],
      ["creator.name", "Who proposed it", "Character name."],
      ["creator.realm", "Realm", ""],
      ["editor.name", "Who changed it last", "Character name."],
      ["editor.realm", "Realm", ""],
      ["at", "When", "Date and time of the event."],
      ["place", "Where", "The dungeon or raid, or “other”."],
      ["title", "Title", "Up to 40 characters, as typed. No web addresses."],
      ["note", "Note", "Up to 80 characters, as typed. No web addresses."],
      ["roles.tank", "Tanks wanted", "A number."],
      ["roles.healer", "Healers wanted", "A number."],
      ["roles.damage", "Damage wanted", "A number."],
      ["cancelled", "Called off", "Yes or no."],
    ]),
    // Header X-BF-Member and POST …/discord/link.
    guildMember: Object.freeze([
      ["X-BF-Member", "Member key", "A secret the service made when you joined, kept on your computer and never shown. It is what lets your app, and nobody else, act as your character in the guild."],
      ["code", "Discord link code", "Only if you use “Link my Discord”: the one-time code Discord showed you. The service then keeps your Discord user number and display name, and nothing else from Discord."],
    ]),
    // PUT /v1/lfg/{id}: a party board listing.
    board: Object.freeze([
      ["installId", "Install number", "So one install has one listing at a time. Stored only in scrambled form."],
      ["realm", "Realm", "Which board the listing is on."],
      ["faction", "Faction", "Horde or Alliance."],
      ["listing.id", "Listing number", "Made at random by the app."],
      ["listing.kind", "Kind", "Looking for a group, or looking for more players."],
      ["listing.who.name", "Character name", ""],
      ["listing.who.realm", "Realm", ""],
      ["listing.level", "Level", ""],
      ["listing.class", "Class", "From your saved character."],
      ["listing.roles", "Your role", "Tank, healer or damage."],
      ["listing.place", "Dungeon", "The dungeon or raid you picked."],
      ["listing.note", "Note", "Up to 60 characters, as typed. No web addresses."],
      ["listing.need", "Open places", "For “looking for more”: how many tanks, healers and damage you still need."],
      ["listing.at", "Posted at", "Date and time. The listing ends 30 minutes later."],
      ["consent", "Your agreement", "Always “true”: nothing is posted until you agreed."],
    ]),
    // GET /v1/lfg: reading the board.
    boardRead: Object.freeze([
      ["realm", "Realm", "Sent to read the board. No install number and nothing about your character."],
      ["faction", "Faction", ""],
    ]),
    // POST /v1/live/session: the live connection.
    live: Object.freeze([
      ["installId", "Install number", "At most two live connections per install."],
      ["subs.tickets", "Your open reports", "Report numbers and their keys, so a reply from the team shows at once. Only while you have a report that is not closed."],
      ["subs.guild", "Your guild", "The guild's number and your member key. Only while you are a member."],
      ["subs.lfg", "The party board", "Your realm and faction. Only while the board is switched on and on screen, or while your listing is up."],
    ]),
  });

  const api = { SERVICE, SUMMARY, NEVER, INSTALL_ID, SWITCHES, BUTTONS, REPORTS, FIELDS: Object.freeze({ ...FIELDS, ...GUILD_FIELDS }), GUILD };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PrivacyWording = api;
})();
