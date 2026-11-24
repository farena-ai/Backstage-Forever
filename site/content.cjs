"use strict";
// The words of the website: what each page is called, the feature sections, the pictures with
// their descriptions, the downloads and the questions. scripts/build-site.cjs lays them out;
// site/index.template.html holds the home page's own layout. Plain words, no numbers that the
// repo cannot back, nothing that goes stale with a release (no version numbers).

const BASE = "https://backstagecoding.com/backstage-forever/";
const REPO = "https://github.com/farena-ai/Backstage-Forever";
const RELEASES = `${REPO}/releases`;

// Title at most 60 characters, description at most 155 (a test checks both).
const PAGES = {
  "index.html": {
    nav: "Overview",
    title: "Backstage Forever: free WoW Forever companion app and addon",
    description: "Free desktop companion app and in-game addon for WoW Forever: leveling guide, quest helper, talent planner, dungeon loot, map, professions and gold.",
    h1: "Backstage Forever",
    h1sub: "The free companion app and addon for WoW Forever",
  },
  "tour.html": {
    nav: "Feature tour",
    title: "Feature tour with screenshots | Backstage Forever",
    description: "See Backstage Forever in real screenshots: leveling guide, talent planner, dungeon loot, world map, travel, professions, gold, gear and your journey.",
    h1: "Backstage Forever feature tour",
    lead: "Real screens from the desktop app, grouped by what you want to do. The characters are made up; item and spell pictures come from your own game files, so they look the same on your computer.",
  },
  "download.html": {
    nav: "Download",
    title: "Download Backstage Forever for Windows, Mac and Linux",
    description: "Download the free Backstage Forever desktop app for Windows, macOS or Linux. It installs and updates the WoW Forever addon for you. Signed, open source.",
    h1: "Download Backstage Forever",
    lead: "One free download for Windows, macOS or Linux. The desktop app finds WoW Forever, installs the in-game addon and keeps it up to date.",
  },
  "whats-new.html": {
    nav: "What's new",
    title: "What's new: latest release notes | Backstage Forever",
    description: "What changed in the latest Backstage Forever releases for WoW Forever: new features, improvements and fixes, newest first.",
    h1: "What's new in Backstage Forever",
    lead: "The same list the app shows after an update, newest first.",
  },
  "commands.html": {
    nav: "Commands",
    title: "All /bf commands for WoW Forever | Backstage Forever",
    description: "Every Backstage Forever command you can type in WoW Forever, in plain words: what each /bf command does, when to use it and an example.",
    h1: "Every /bf command, in plain words",
  },
  "coverage.html": {
    nav: "Data coverage",
    title: "Data coverage by zone and faction | Backstage Forever",
    description: "How much Backstage Forever knows about WoW Forever, zone by zone for Alliance and Horde: quest givers, trainers, vendors, flight points and rares.",
    h1: "How much the app knows, zone by zone",
    lead: "Where the app's advice is rich and where it is still thin, for each faction. The same count the app shows under Help → Data coverage.",
  },
};

// The home page's opening picture: the whole app window.
const HERO_SHOT = ["now", "The Now page", "Backstage Forever desktop app on the Now page: a level 16 hunter's next step, the quest The Zhevra with three of four hooves collected, her experience bar and the setup checklist", "The Now page: one clear next step from your last save, with the reason."];

// One section per thing players look for. `home` is the picture the home page shows; `shots`
// are all of the section's pictures for the tour: [file name, title, alt text, caption].
const FEATURES = [
  { id: "leveling-guide", short: "Leveling and quests", kicker: "Leveling guide and quest helper",
    h2: "A leveling guide that always knows your next step",
    text: [
      "Open the app and the Now page names one next step from your last save, with the reason: a quest to hand in, a quest to pick up or a trainer to visit.",
      "The guided route goes step by step for every race, Horde and Alliance alike, and shows how far each route reaches. The quest log explains every quest you carry: what is left, where to go and who to hand it in to.",
      "In the game, the addon puts the game's own arrow on the next step and shows quest pins on your map.",
    ],
    commands: ["/bf next", "/bf route guide", "/bf chain"], home: "guided-route",
    shots: [
      ["guided-route", "Guided route", "Guided route page: the next pick-up on a level 16 Tauren hunter's route in The Barrens, with a plan B from her quest log, and a table of how far each race's route reaches", "A step-by-step leveling route. It finds your place from your save and says what is missing."],
      ["quest-log", "Quest log", "Quests page: the hunter's quest log on the left and the chosen quest The Zhevra with its waypoint, how to do it, where to pick it up and hand it in, and its rewards", "Every quest you carry: what is left, how to do it and where to go."],
      ["zones", "Zones", "Zones page: every zone of Kalimdor and the Eastern Kingdoms with its level range and how many of its quests the character has done", "Every zone for your faction with your quest progress, and the next zone to clear."],
    ] },
  { id: "talent-planner", short: "Talents", kicker: "Talent planner and talent calculator",
    h2: "A talent planner with a level-up order",
    text: [
      "Click talents to build a plan from your class's trees, which the app reads from your own game files. You get the order to take them in as you level, a share code to pass the build to a friend, and the respec cost.",
      "The planner knows the talents you have already spent, so you can start from them or compare them with a plan. In the game, the addon names your next point. It never spends one for you.",
    ],
    commands: ["/bf talents"], home: "talents-plan",
    shots: [
      ["talents-plan", "Talents: My plan", "Talent planner for a level 60 mage: the Arcane, Fire and Frost trees with 51 points placed, the talents she has already spent in game, and the level-up order", "Build a plan and see the order to take the points in as you level."],
    ] },
  { id: "dungeon-atlas", short: "Dungeons and raids", kicker: "Dungeon and raid atlas",
    h2: "Dungeon and raid loot, with your upgrades marked",
    text: [
      "The atlas lists every dungeon and raid by level with its bosses in order and, where players have recorded it, the loot each boss dropped and how often.",
      "Items that would be an upgrade for your character are marked, and you can star the ones you want for a wish list the addon watches for. Run history keeps your times and loot, and Keys & attunements shows the step you are on.",
    ],
    commands: ["/bf atlas", "/bf wish", "/bf run"], home: "dungeons-loot",
    shots: [
      ["dungeons-loot", "Boss loot and upgrades", "Dungeons and raids page: Scarlet Monastery's bosses with the loot players saw each one drop, the drop chance, and a mark on each item that is an upgrade for this warrior", "Each boss lists the loot players saw, how often, and whether it is an upgrade for you."],
      ["run-history", "Run history", "Run history page: personal best time and most bosses defeated for nine dungeons and raids, and every run below", "Every run with its time, bosses, deaths and your loot, and your best time in each dungeon."],
      ["attunements", "Keys & attunements", "Keys and attunements page: the Onyxia's Lair chain with four steps done and the current step marked, beside the dungeon keys", "The classic key and attunement chains with the step your character is on."],
    ] },
  { id: "world-map", short: "World map", kicker: "World map, gathering routes and rare finder",
    h2: "A world map with gathering routes and a rare finder",
    text: [
      "One map shows quest givers, objectives, trainers, vendors, flight masters and rare enemies, drawn over your game's own map art.",
      "Pick Herbalism or Mining and the app draws a round trip through spots you and other players found, then sends it to the game. There, one command puts the arrow on a rare enemy, an NPC, a herb or an ore vein by name. These are past sightings, not live nodes.",
    ],
    commands: ["/bf find NAME", "/bf loop", "/bf rares"], home: "world-map-loop",
    shots: [
      ["world-map-loop", "World Map with a gathering loop", "World Map of The Barrens with quest pins, flight masters and a numbered herb gathering loop around the Crossroads, and the list of map layers", "Quest, service and gathering layers on one map, and a numbered loop you can send to the game."],
    ] },
  { id: "travel-planner", short: "Travel", kicker: "Travel planner and flight paths",
    h2: "A travel planner that compares flight paths, walking and your Hearthstone",
    text: [
      "Say where you want to go and the planner compares going on foot, flying and using your Hearthstone, with the time and the price of each, fastest first.",
      "It uses the flight paths your character has learned. Flight times and prices are the ones players recorded, and a connection without a recorded time says so.",
    ],
    commands: ["/bf fly PLACE", "/bf flights", "/bf hearth"], home: "travel",
    shots: [
      ["travel", "Travel planner", "Travel planner: three ways from The Barrens to Thunder Bluff, by flight, on foot and by Hearthstone, each with its time and price", "On foot, by flight or by Hearthstone: the time and the price of each, fastest first."],
    ] },
  { id: "professions", short: "Professions", kicker: "Profession guide",
    h2: "Professions: recipe book, skill path and craft profit",
    text: [
      "The recipe book lists every recipe your game files define for a profession: known or missing, when it turns yellow, green and grey, what it needs, and where to learn it when that is recorded.",
      "The skill path works out the cheapest recipe for each skill range, and craft profit sets the material cost against what the result sold for. Both use only prices you have seen. A price you never saw stays unknown; nothing is guessed.",
    ],
    commands: ["/bf prof"], home: "recipe-book",
    shots: [
      ["recipe-book", "Recipe book", "Recipe book for Alchemy: each recipe with its materials, the skill levels where it changes colour, whether the character knows it, and where it comes from", "Every recipe of a profession: known or missing, the skill colours and where to learn it."],
      ["skill-path", "Skill path", "Skill path for Alchemy from 1 to 300: the cheapest recipe for each skill range with the number of crafts and the material cost", "The cheapest way through each skill range, from your game files and the prices you saw."],
      ["craft-profit", "Craft profit", "Craft profit page: material cost, selling price and profit for six tailoring and alchemy recipes", "What your recipes cost to make and what the result sold for."],
    ] },
  { id: "auction-prices", short: "Gold and prices", kicker: "Auction price history and gold tracking",
    h2: "Auction price history and gold on every character",
    text: [
      "The addon remembers the lowest buyout on Auction House pages you open yourself. It never searches, bids or buys.",
      "The app shows the usual price and a short history line for each item, your gold on every character, and bags, bank and mail in one searchable list. In the game, one command goes through your bags and says what is worth more at auction than at a vendor.",
    ],
    commands: ["/bf prices", "/bf sell", "/bf ledger"], home: "price-history",
    shots: [
      ["price-history", "Gold and prices", "Gold and prices page: gold on three characters and a table of remembered auction prices with the usual price and a small history chart for each item", "The prices you saw, the usual price and a short history for each item."],
      ["bags-bank", "Bags and bank", "Bags and bank page: one list of every item with how many each character holds in bags, bank and mail", "Bags, bank and mail of every character in one searchable list."],
    ] },
  { id: "gear-planner", short: "Gear", kicker: "Gear planner and stat weights",
    h2: "A gear planner that follows your stat weights",
    text: [
      "Choose a stat-weight preset for your class and role, or set the weight of each stat yourself. Every upgrade mark in the app and in the game follows it.",
      "For each slot the gear plan shows what you wear and up to three upgrades you can reach, best first, with the quest, vendor or boss they come from. Pin one target per slot, and save gear sets in the game.",
    ],
    commands: ["/bf gear", "/bf set save NAME"], home: "gear-plan",
    shots: [
      ["gear-plan", "Gear plan", "Gear plan: for the head, neck and shoulder slots the worn item and three upgrades each, with their score and the quest, vendor or boss they come from", "What you wear and up to three upgrades per slot, with where each comes from."],
      ["stat-weights", "Stat weights", "Stat weights card on the gear plan: a preset for the class and a slider for each stat's weight", "A preset for your class and role, or your own weight for each stat."],
      ["character-sheet", "Character sheet", "Character sheet for a level 60 mage: each equipped item with its item level, the average item level and the character's stats", "Your gear and stats, with the pieces that are due for replacement."],
    ] },
  { id: "group-tools", short: "Groups", kicker: "Group tools",
    h2: "Group tools: an LFG board and a readiness check",
    text: [
      "In the game, the group finder board collects looking-for-group lines from the chat channels you joined and sorts them by dungeon. Click a row to start a whisper.",
      "A readiness check asks party members who also run the addon for the dungeon's key, worn gear, free bag slots and the quests each still needs. In the app you pick your role and make a short checklist to share. Nothing is ever sent or joined for you.",
    ],
    commands: ["/bf lfg", "/bf check DUNGEON", "/bf party"], home: "party",
    shots: [
      ["party", "Party", "Party page: choose tank, healer or damage, create a dungeon checklist, and see the character's saved gear and bag space", "Pick your role, make the group checklist and check your gear and bags before you go."],
    ] },
  { id: "journey", short: "Your journey", kicker: "Journey, story and share cards",
    h2: "Your journey: the story so far, a timeline and share cards",
    text: [
      "The app keeps a record of each character on your computer: level-ups, firsts, dungeon runs and badges.",
      "Story so far writes it out in plain sentences, only from what was saved, and the timeline shows it day by day. A painted share card turns a level-up, a badge or a dungeon run into a picture. Your name is on it only if you tick the box.",
    ],
    commands: ["/bf badges"], home: "share-card",
    shots: [
      ["share-card", "Share picture", "Share picture for a Molten Core raid run: ten of ten bosses, the time and the deaths on a painted card, with the switches for name and realm", "A painted card for a run, a level-up or a badge."],
      ["journey-story", "Story so far", "Story so far: a level 60 mage's levels, firsts, dungeon runs and deaths written as short chapters", "Your character's story in plain sentences, written only from what was saved."],
      ["journey-timeline", "Timeline", "Timeline: level-ups and dungeon runs listed day by day, newest first", "Level-ups, firsts and dungeon runs, day by day."],
      ["badges", "Badges", "Badge case for a level 60 mage: how many badges she has earned, the most recent ones and the three closest to earning", "Milestones from your saved journal, with the ones you are closest to."],
    ] },
];

// The tour's last group: parts of the app that have no section of their own on the home page.
const MORE = { id: "more", short: "More in the app", kicker: "More in the app", h2: "Reputation, cooldowns and all your characters",
  shots: [
    ["reputation", "Reputation planner", "Reputation page: a mage's standing with six factions and a plan to reach the next standing with Stormwind", "Where each character stands with every faction, and what it takes to reach a standing."],
    ["calendar", "Cooldown calendar", "Cooldown calendar for one month with a transmute, a Mooncloth cooldown and three mailboxes about to expire", "Every character's profession cooldowns and mail expiry on one calendar."],
    ["all-characters", "All characters", "All characters page: three characters with level, gold, bag space and professions side by side", "Everyone at a glance: level, rested experience, gold and professions."],
    ["commands", "Help → Commands", "Help, Commands page in the desktop app: every command with what it does and when to use it", "Everything you can type in game, explained in plain words."],
    ["coverage", "Help → Data coverage", "Help, Data coverage page in the desktop app: how much is known for each zone", "How much the app knows about each zone, shown honestly."],
  ] };

// Things the app also does, as one short list on the home page.
const ALSO = [
  "A companion that answers where and how questions from the bundled reference, offline. You can connect an AI service of your choice, but nothing needs one.",
  "A reputation planner: the points to the next standing, hand-ins and quests that pay reputation.",
  "A calendar with every character's profession cooldowns and mail about to expire.",
  "All your characters side by side, with rested experience, gold and bag space.",
];

const STEPS = [
  ["Download the desktop app", "Windows gets a signed installer; macOS a zip with the app; Linux an AppImage. It is free and needs no account."],
  ["The app finds the game", "Click Set it all up. The app finds your WoW Forever folder, or you choose it once. On Linux you always choose it yourself."],
  ["It installs the addon", "The app puts its addon into the game's AddOns folder and updates it whenever the app updates. There is nothing to unzip."],
  ["Log in and type /reload", "Tick Backstage Forever under AddOns on the character screen and play. The app reads your character when the game saves: at /reload or when you log out."],
];

const TRUST = [
  ["Your characters stay on your computer", "Characters, gold, notes and plans are kept in the app's own folder and are never uploaded. No account, no telemetry, no ads. The few things that can leave are listed under “Where is my data?” below."],
  ["It never plays for you", "The addon sends no input to the game and automates nothing: no auto-accepting, no movement, nothing in combat. An arrow appears only when you click or type a command."],
  ["Open source", `Free under the MIT licence. Read the code, the release notes and the privacy notes on <a href="${REPO}">GitHub</a>.`],
  ["Signed installer", "The Windows installer is signed by its publisher, Frank Arena. Every release also lists SHA-256 checksums for all downloads."],
];

// The downloads. `key` is what the site's download script recognises (windows, arm, intel, addon);
// every link starts on the latest-release page and works without JavaScript.
const DOWNLOADS = [
  { key: "windows", id: "windows", title: "Windows", button: "Download for Windows", main: true,
    text: "Windows 10 and 11, 64-bit. An installer signed by Frank Arena. Follows you live while you play and updates itself." },
  { key: "arm", id: "mac-apple-silicon", title: "macOS, Apple silicon", button: "Download for Mac (Apple silicon)",
    text: "For Macs with an M1 chip or newer. A zip with the app; works from the data the game saves." },
  { key: "intel", id: "mac-intel", title: "macOS, Intel", button: "Download for Mac (Intel)",
    text: "For older Macs with an Intel processor. A zip with the app; works from the data the game saves." },
  { key: "linux", id: "linux", title: "Linux", button: "Get the Linux AppImage",
    text: "A 64-bit AppImage for players who run the game through Wine, Lutris or Bottles. Works from saved data; newer and less tested." },
  { key: "addon", id: "addon-only", title: "Addon only", button: "Get the addon zip",
    text: "The in-game addon as a zip, for installing by hand. You do not need it with the desktop app, which installs the addon for you." },
];

const INSTALL = [
  ["Windows", ["Download the file ending in Windows-x64-Setup.exe and run it. The signature should name Frank Arena.", "Open Backstage Forever and click Set it all up.", "Start WoW Forever, tick Backstage Forever under AddOns and log in. The app updates itself from then on."]],
  ["macOS", ["Download the arm64 zip (Apple silicon) or the x64 zip (Intel), unzip it and move Backstage Forever to Applications.", "The app is not notarized yet. The first time, macOS will not open it: go to System Settings → Privacy & Security and click Open Anyway.", "Click Set it all up, then play. Type /reload or log out to bring your character into the app. New versions are downloaded from the release page."]],
  ["Linux", ["Download the AppImage, make it runnable (chmod +x) and start it.", "Under Settings → Game connection, choose the _forever_ folder inside your game install, usually under your Wine prefix.", "Play, then type /reload or log out. To update, download the new AppImage and replace the old file."]],
];

const FAQ = [
  ["Is Backstage Forever free?", "Yes. The desktop app and the addon are free and open source under the MIT licence. There is no account, no subscription and no advertising. The companion can use an AI service you choose and pay for yourself, but everything else works without one."],
  ["Is it allowed? Does it automate anything?", "It automates nothing. The addon uses only the game's public addon interface, sends no input to the game, never reads the game's memory and never plays for you. Arrows and waypoints appear only when you click or type a command. Backstage Forever is an independent fan project and is not affiliated with or endorsed by Blizzard Entertainment."],
  ["Which game versions does it work with?", "Backstage Forever is made for WoW Forever (World of Warcraft: Forever), currently game version 1.60. It is not built for other versions of World of Warcraft. When the game changes, an update follows; data checked on an earlier build of the same patch is still used and labelled as such."],
  ["Do I need the desktop app?", "The desktop app is Backstage Forever. It installs the in-game addon, keeps it up to date and shows everything the addon saves: your next step, the map, talents, gear, professions and gold. The release page also has the addon as a zip for installing by hand, but then you update it yourself and go without the app's pages."],
  ["Does it work on Mac and Linux?", "Yes, from saved data. There are zips for macOS on Apple silicon and on Intel, and an AppImage for Linux. They read what the addon saved after you type /reload or log out. The live link, which follows you while you play, is on Windows only. The Linux build is new and less tested."],
  ["Which languages does it speak?", "English, German, French and Spanish, in the app and in the game. German, French and Spanish are first translations that still await a native review, and text added since can show in English."],
  ["How do updates work?", "On Windows the app updates itself and then brings the addon in your game folder up to date; type /reload once. On a Mac the app tells you when a new version is out, and on Mac and Linux you download it from the release page. The What's new page lists what changed."],
  ["Where is my data, and does anything leave my computer?", "Your data is in the app's own folder: %APPDATA%\\Backstage Forever on Windows, ~/Library/Application Support/Backstage Forever on a Mac and ~/.config/Backstage Forever on Linux. Characters, gold, notes and plans are never uploaded. A few things can leave, and each can be switched off: anonymous, rounded gathering spots shared with other players, the update check, a question you send to a cloud AI you connected, and quest progress shared with party members who run the addon. The privacy notes on GitHub list every one."],
];

module.exports = { BASE, REPO, RELEASES, PAGES, HERO_SHOT, FEATURES, MORE, ALSO, STEPS, TRUST, DOWNLOADS, INSTALL, FAQ };
