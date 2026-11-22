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
    { group: "Finding your way", command: "/bf nodes [herb|ore|chest|all]", word: "nodes", what: "The nearest herbs, ore and chests you gathered or opened in this zone, with distance and direction; the arrow goes on the closest. Skips nodes above your skill. The World Map's BF Guide shows them as a Gathering spots layer. Past spots, not live nodes.", when: "Out gathering, or hunting chests in a zone you have been before.", example: "/bf nodes herb" },
    { group: "Finding your way", command: "/bf how [quest]", word: "how", what: "Explains how to do your tracked quest (or the one you name): what is left, where you looted its items so far (dropped by which enemy, or picked up from objects, and near which coordinates) and the line of the quest text that says where to go.", when: "When you're stuck on a quest and not sure where the items come from.", example: "/bf how" },
    { group: "Finding your way", command: "/bf party [way|go|on|off]", word: "party", what: "With party members who also run Backstage Forever: their quests next to yours (who is how far on each shared quest, and quests only they have). way shares your waypoint; go puts the arrow on the last one shared with you.", when: "When you group up for quests.", example: "/bf party" },
    { group: "Finding your way", command: "/bf route [guide|zone|next|back|skip|arrow]", word: "route", what: "Shows the next quest step in a small scroll; the game's arrow follows it and it moves on as you accept and hand in quests. guide follows the full route for your race from level 1; zone shows only the quests here; skip skips a guided step.", when: "Whenever you'd rather just follow the next step. next/back browse the steps; arrow turns the arrow on or off.", example: "/bf route" },
    { group: "Your character", command: "/bf stats", word: "stats", what: "Your solo fights this session: damage, damage per second on average, your best fight and your last one. Measured from your target's health, since the game no longer lets addons read the combat log.", when: "After a few fights, to see how you're doing or whether new gear or talents helped.", example: "/bf stats" },
    { group: "Your character", command: "/bf supplies [on|off]", word: "supplies", what: "Shows your ammo, food and drink, pet happiness (hunters) and soul shards (warlocks), and what to restock. Reminders pop up by themselves when you run low; off silences them.", when: "Before heading out of town, or when a reminder pops up.", example: "/bf supplies" },
    { group: "Finding your way", command: "/bf way MapID X Y [name]", word: "way", what: "Puts the arrow on exact map coordinates. The app's World Map gives you this line ready to paste.", when: "When the app or a guide gives you coordinates.", example: "/bf way 1413 51.5 30.4 Crossroads" },
    { group: "Finding your way", command: "/bf hearth", word: "hearth", what: "Tells you where your Hearthstone takes you and, if you're questing in another zone, which inn to make your home instead.", when: "Before a long trip, or when you start questing somewhere new.", example: "/bf hearth" },
    { group: "Your character", command: "/bf prof", word: "prof", what: "Your profession at a glance: skill, the colour of the recipe you planned (orange always skills up, yellow usually, green rarely, grey never), the best next recipe, roughly how many crafts to your cap, and what you still need.", when: "Before a crafting session, or when a recipe turns green.", example: "/bf prof" },
    { group: "Your character", command: "/bf xp", word: "xp", what: "Shows your experience per hour this session, roughly how long until your next level, and any rested bonus.", when: "To see how fast you're leveling.", example: "/bf xp" },
    { group: "Your character", command: "/bf badges", word: "badges", what: "How many badges this character has earned and the three closest to earning, with progress. /bf badges all lists every earned badge by group. A new badge also gets a small banner in game. The app's Characters → Badges page shows them all with dates.", when: "After a level, a new zone or a profession rank, to see what's next.", example: "/bf badges all" },
    { group: "Your character", command: "/bf sell", word: "sell", what: "Goes through your bags: what is worth more at the Auction House than at a vendor (after the auction house's 5% cut), from prices you have seen, and what a vendor should get, with totals. It never sells or posts anything.", when: "Before a trip to a vendor or the Auction House.", example: "/bf sell" },
    { group: "Your character", command: "/bf ledger", word: "ledger", what: "Your gold across every character the addon knows, and when it last saw this character's bank and mailbox. The app's Ledger pages show bags, bank, mail, reputations and cooldowns for all of them.", when: "Any time you wonder where your gold or an item went.", example: "/bf ledger" },
    { group: "Your character", command: "/bf prices [on|off|status|tips]", word: "prices", what: "Remembers the lowest buyout on Auction House pages you open yourself; never searches, bids or buys. Item tooltips show that price and the vendor price, and say when auction pays more. Off stops remembering; tips hides the tooltip lines.", when: "Leave it on and browse as usual; the app's Gold & prices page lists what you saw.", example: "/bf prices status" },
    { group: "Your character", command: "/bf set save NAME", word: "set", what: "Saves the gear you are wearing now as a set with that name, such as leveling, gathering or dungeon. Saving again under the same name updates it. Up to 20 sets per character.", when: "Once your gear for an activity is on.", example: "/bf set save dungeon" },
    { group: "Your character", command: "/bf set wear NAME", word: "set", what: "Puts a saved set back on: each piece in your bags goes to its slot. Only when you type it and never in combat. Pieces in the bank, mail or on another character are named so you can fetch them.", when: "Before a dungeon, or when you go gathering.", example: "/bf set wear dungeon" },
    { group: "Your character", command: "/bf set list", word: "set", what: "Lists your gear sets and, for each, how many pieces you wear now, carry in your bags or have elsewhere. The app's Characters → Sheet page shows every set and where each missing piece is.", when: "When you forget what you saved.", example: "/bf set list" },
    { group: "Your character", command: "/bf set delete NAME", word: "set", what: "Forgets a saved gear set. Your items stay where they are.", when: "When you no longer need a set.", example: "/bf set delete dungeon" },
    { group: "Your character", command: "/bf talents | /bf talents levelup on|off", word: "talents", what: "Names the next point of the talent build you marked Use in game on the desktop (Characters, Talents): the talent, its tree and the rank. It reads your real talents, so it stays right if you spent points elsewhere. It never spends a point.", when: "When you have a talent point and want to know where your plan puts it. The second form switches the level-up chat line.", example: "/bf talents" },
    { group: "Your character", command: "/bf help", word: "help", what: "Lists the main commands in your chat window.", when: "Whenever you forget a command.", example: "/bf help" },
    { group: "Adventure Compass", command: "/bf", word: "", what: "Shows or hides the Adventure Compass, the small panel with your next step.", when: "To bring the panel back or tidy it away.", example: "/bf" },
    { group: "Adventure Compass", command: "/bf show", word: "show", what: "Shows the Adventure Compass.", when: "After hiding it with X.", example: "/bf show" },
    { group: "Adventure Compass", command: "/bf hide", word: "hide", what: "Hides the Adventure Compass.", when: "When you want a clean screen.", example: "/bf hide" },
    { group: "Adventure Compass", command: "/bf compass track QuestID | /bf compass track clear | /bf compass missing | /bf compass review", word: "compass", what: "Track an exact quest in your log, return to the game watch, explain the current blocker, or review one nearby ready hand-in.", when: "When deciding what to do next.", example: "/bf compass missing" },
    { group: "Adventure Compass", command: "/bf status", word: "status", what: "Says whether the addon is ready, which game build you are on, and whether the quest data was checked on it.", when: "If something seems off, or after a game patch.", example: "/bf status" },
    { group: "Finding your way", command: "/bf atlas [dungeon]", word: "atlas", what: "Opens the Instance Atlas in game: every dungeon and raid with its level band, entrance, bosses in order, the loot players have seen each boss drop, and a short tip per boss. Coloured by how each fits your level.", when: "Before a dungeon run, or to see what is coming up at your level. Add a short name to open one directly.", example: "/bf atlas dm" },
    { group: "Finding your way", command: "/bf chain", word: "chain", what: "For each quest in your log that is part of a longer chain: which step you are on, how many steps the chain has, and the name of the next quest.", when: "Before you drop a quest, or to see how much of a chain is left.", example: "/bf chain" },
    { group: "Finding your way", command: "/bf available", word: "available", what: "Lists the quests you can pick up on the map you are on, nearest first, with the giver, the quest level, the distance and the direction.", when: "When you arrive somewhere new and want to collect every quest before heading out.", example: "/bf available" },
    { group: "Helpers on or off", command: "/bf minimap [on|off]", word: "minimap", what: "Shows nearby quests to pick up, hand-ins, your class trainer, profession trainers and flight masters on the minimap, with the same icons as the world map. A hand-in that is further away sits on the minimap's edge, in the direction to walk.", when: "On by default. Switch it off if another addon already draws quest pins on your minimap.", example: "/bf minimap off" },
    { group: "Helpers on or off", command: "/bf options", word: "options", what: "Opens one painted settings window with a switch for every in-game helper, in three pages (Quests, Alerts, Comfort), and three starting points: Quiet, Leveling and Veteran.", when: "The easy way to switch helpers on or off. You can also right-click the owl on the minimap, bind a key, or find Backstage Forever in the game's own options.", example: "/bf options" },
    { group: "Adventure Compass", command: "/bf perf", word: "perf", what: "Says how much memory Backstage Forever is using in game, and how that changed since you last asked.", when: "If the game feels slow and you want to rule the addon in or out.", example: "/bf perf" },
    { group: "Your character", command: "/bf welcome", word: "welcome", what: "Shows the welcome card again: what the Compass does, what the owl on the minimap does, and where to get the free desktop app.", when: "If you closed it too fast on your first login.", example: "/bf welcome" },
    { group: "Helpers on or off", command: "/bf settings", word: "settings", what: "The same settings window as /bf options.", when: "If that is the word you remember.", example: "/bf settings" },
    { group: "Helpers on or off", command: "/bf helpers [key [on|off]]", word: "helpers", what: "Lists helper settings for the character you are playing. Add a key to check one setting, or a key and on or off to change it.", when: "To manage individual helpers, even with the desktop app closed.", example: "/bf helpers questTracker off" },
    { group: "Helpers on or off", command: "/bf helpers apply key=on|off … commit", word: "helpers", what: "Applies only the listed helper changes to the character you are playing. Check the addon's chat reply.", when: "After preparing changes in desktop Settings, while logged in to the intended character and outside combat.", example: "/bf helpers apply questTracker=off commit" },
    { group: "Helpers on or off", command: "/bf helpers panel", word: "helpers", what: "Opens the in-game helper checkboxes for your current character.", when: "To manage individual helpers, even with the desktop app closed.", example: "/bf helpers panel" },
    { group: "Helpers on or off", command: "/bf toasts [on|off]", word: "toasts", what: "Turns the pop-up tips on or off: level-ups, finished quests, deaths and the welcome. Chat still gets the message.", when: "If you prefer a quieter screen.", example: "/bf toasts off" },
    { group: "Helpers on or off", command: "/bf moments [on|off|status]", word: "moments", what: "Turns the short in-game messages for moments on or off: elite, rare and boss kills and profession milestones, shown after combat. The desktop app shows every moment either way.", when: "If you want a quieter game screen but still want the moment cards in the app.", example: "/bf moments off" },
    { group: "Helpers on or off", command: "/bf danger [on|off]", word: "danger", what: "Turns the warning above dangerous targets on or off (elites, skulls, much higher levels, enemies too low to give experience).", when: "Once you can judge enemies yourself.", example: "/bf danger off" },
    { group: "Helpers on or off", command: "/bf qol [coords|loot|dismount|questtext] [on|off]", word: "qol", what: "Small helpers, each off until you switch it on: coords (your map coordinates under the minimap), loot (faster auto-loot), dismount (off your mount at flight masters) and questtext (quest text shows instantly). /bf qol lists them.", when: "Turn on the ones you like.", example: "/bf qol coords on" },
    { group: "Helpers on or off", command: "/bf enemy [on|off|sound on|sound off|clear]", word: "enemy", what: "Lists the enemy players you saw recently: faction, level, class, name, zone and when. Alerts like \"Alliance level 32 Rogue nearby\" pop up by themselves; off silences them, sound on adds a warning sound, clear empties the list.", when: "On contested ground, or to check who has been around.", example: "/bf enemy" },
    { group: "Helpers on or off", command: "/bf boss [on|off]", word: "boss", what: "Repeats the short tip for a supported dungeon or raid boss you target. Reviewed raid tips are marked Classic reference. The first tip per boss each session also pops up; off stops that. Text only, no timers.", when: "Before a pull, or to switch the pop-ups off.", example: "/bf boss" },
    { group: "Helpers on or off", command: "/bf plates [on|off]", word: "plates", what: "Turns the quest icon over enemies on or off: a small ! above the nameplate of any enemy a quest in your log still needs. Nameplates must be showing (V key).", when: "If you'd rather not see the icons.", example: "/bf plates off" },
    { group: "Helpers on or off", command: "/bf junk [on|off]", word: "junk", what: "Turns the Sell junk button on vendor windows on or off.", when: "If you'd rather sell by hand.", example: "/bf junk off" },
    { group: "Helpers on or off", command: "/bf gear [on|off]", word: "gear", what: "Turns the gear hints on or off: the gold glow on the quest reward that suits your class best, and the line on item tooltips that says whether something is an upgrade for you.", when: "If you'd rather judge gear yourself.", example: "/bf gear off" },
    { group: "Live link", command: "/bf live [on|off|status]", word: "live", what: "Turns on or off the live link: a thin dark line along the top edge of the game that lets the desktop app follow you, even behind other windows (not while WoW is minimized). Status reports what it is doing.", when: "Turn it off for screenshots or streaming; turn it back on for live help in the app.", example: "/bf live status" },
    { group: "Live link", command: "/bf live pos topleft|topright|bottomleft|bottomright", word: "live", what: "Moves the compact or safe strip to another corner of the game window. The app finds it in any corner by itself; the choice is saved. The hairline always runs along the top edge.", when: "If the compact or safe strip sits on top of something you want to see.", example: "/bf live pos topright" },
    { group: "Live link", command: "/bf live hairline|compact|safe", word: "live", what: "Hairline (the default) is the thin dark line along the top edge. Safe is a larger corner strip in plain on/off colours that survives remote desktop, HDR and colour filters. Compact is a small 84×4 corner strip. The choice is saved.", when: "Type /bf live safe when the app says it can't read the live line (often over remote desktop); /bf live hairline to go back.", example: "/bf live safe" },
    { group: "Ask the companion", command: "/bf ask", word: "ask", what: "Opens the companion panel over your game, ready to type (the owl on the minimap does the same). Press Enter: the answer appears under your question; follow-ups go in the same box. Esc closes it.", when: "When you want help without leaving WoW. Keep the app open and the live link on.", example: "/bf ask" },
    { group: "Ask the companion", command: "/bf ask QUESTION", word: "ask", what: "Sends a question from the chat line (up to 200 characters); the answer appears in the panel over your game. In combat it waits until combat ends; /bf ask cancel drops it. Where and how questions are answered offline; others use your AI.", when: "Quick questions from the chat line.", example: "/bf ask where is the flight master in Crossroads?" },
    { group: "Ask the companion", command: "/bf ask hide|show", word: "ask", what: "Hides or shows the owl button on the minimap. Drag the button to move it around the minimap edge; its place is saved per character.", when: "If the button is in the way, or to bring it back.", example: "/bf ask hide" },
    { group: "Advanced", command: "/bf guide …", word: "guide", what: "A waypoint line the app's Quests page prepares for a specific quest step. Copy it in the app and paste it into chat; you never need to type it yourself.", when: "Only when the app hands you one.", example: "/bf guide 840 t 1411 52.0 43.2 1.60.1.70888" },
  ]);
  const FEATURES = Object.freeze([
    { name: "Instance Atlas in game", where: "Type /bf atlas", what: "A painted window listing all 27 dungeons and raids, coloured by how each fits your level. Pick one for its painting, level band, side, entrance button, bosses in order, each boss's observed loot with drop chances (hover an item for its tooltip) and a short tip. Items you starred on the desktop are marked Wish, and drops that beat what you wear are marked Upgrade, after a /reload. WoW Forever has no dungeon journal of its own." },
    { name: "Quest pins on the minimap", where: "On your minimap in game", what: "Nearby quests to pick up, hand-ins, your class trainer, profession trainers and flight masters, with the same icons as the world map. A hand-in that is further away sits on the edge of the minimap, in the direction to walk. Point at a pin for its name and distance. Hidden in combat; /bf minimap switches it." },
    { name: "Where items come from", where: "Hover an item in game", what: "Item tooltips say which enemies drop a quest item and how often, which objects hold it, and who sells an item, with the zone. Sellers for the other faction are left out. From bundled community observations, so a missing line does not mean it cannot be found." },
    { name: "/way from guides and chat", where: "Type /way X Y [name] in game", what: "The waypoint line players paste from guides, for example /way 51.5 30.9 Thork, puts an arrow on the map you are on. If another waypoint addon already answers /way, Backstage Forever leaves it alone." },
    { name: "Settings window", where: "Type /bf options, or right-click the owl on the minimap", what: "One painted window with a switch for every helper, in three pages: Quests, Alerts and Comfort. Point at a switch to read what it does. Quiet, Leveling and Veteran set a group of switches at once and say how many changed. It is also listed in the game's own options, and the game's Key Bindings list has four Backstage Forever keys: Compass, next quest stop, ask the companion and settings." },
    { name: "Adventure Compass", where: "A small movable panel in game", what: "Your character, XP and the next step. The - button turns it into a compact summary: level and zone, an XP bar with rested XP, your XP per hour and time to the next level, quests ready to hand in and your next step. Drag the title to move it; X hides it. It hides itself in combat." },
    { name: "BF Guide on the world map", where: "Press M in game", what: "Shows quests you can pick up (checked against your level and faction), hand-ins, your class trainer, profession trainers and flight masters. Click a marker for an arrow. The BF Layers panel turns each kind on or off." },
    { name: "Death review", where: "Pops up after you die", what: "What killed you, how much of the damage it did, its level and whether it was elite, and one plain tip for next time." },
    { name: "Quest progress in tooltips", where: "Hover an enemy in game", what: "If an enemy counts for one of your quests, its tooltip says which quest and how far along you are, like “Raptor Thieves: Raptor Head 3/12”. Drops count once you've looted that item from them." },
    { name: "Zone arrival banner", where: "Top of the screen", what: "When you enter a new zone: a painting of that zone with its name, its level range and how many quests there are for your level (capital cities just say so). Never in combat; /bf toasts turns it off with the other pop-ups." },
    { name: "Enemy player alerts", where: "Top of the screen and chat", what: "When an enemy player who can attack you becomes your target, passes under your mouse or shows a nameplate: \"Alliance level 32 Rogue nearby\" (or Horde), with their name and zone in chat. Once per player every 5 minutes, never in battlegrounds or arenas. /bf enemy lists who you saw." },
    { name: "Quality of life helpers", where: "Switched on with /bf qol", what: "Coordinates under the minimap; faster auto-loot that empties the loot window at once when the game is auto-looting anyway; getting off your mount when you open a flight master's map (out of combat); and instant quest text. All off until you turn them on." },
    { name: "Party sync", where: "Your party, with /bf party", what: "Party members running Backstage Forever quietly swap quest progress (quest numbers and counts only, to your party only) so /bf party can show who needs what. Shared waypoints arrive as a chat line. /bf party off stops it." },
    { name: "Danger warning", where: "Above your target's portrait", what: "Plain words about risky enemies: elite, skull, world boss, several levels above you, rare, or too low to give experience." },
    { name: "Pop-up tips", where: "Top of the screen", what: "Level-ups (with your nearest trainer), finished quests (with how many more you need to level) and deaths (with what to do). A one-time welcome too." },
    { name: "Arrow back to your body", where: "Minimap and screen arrow", what: "After you die and release your spirit, the arrow points to your body. Walk over it and click Resurrect." },
    { name: "Repair reminder", where: "Top of the screen", what: "A pop-up when your gear drops to a quarter of its durability, and again if something breaks. /bf repair shows the way." },
    { name: "Flight path reminder", where: "Top of the screen", what: "When you pass close to a flight master you haven't talked to, a pop-up suggests learning that flight path." },
    { name: "Hearthstone tip", where: "Top of the screen", what: "When you pick up quests in a zone while your Hearthstone still points somewhere else, a tip names the inn to switch to (once per zone)." },
    { name: "Sell junk button", where: "On every vendor window", what: "Lists your grey items and what they're worth. Sells them only when you click it, and never in combat." },
    { name: "Reward picker", where: "On the quest reward window", what: "When a quest lets you choose a reward, a gold glow marks the one that suits your class best and chat says why (for example +3 Agility, +12 armor) compared with what you wear. You still pick it yourself." },
    { name: "Quest icons over enemies", where: "Above enemy nameplates", what: "A small ! over any enemy a quest in your log still needs, kills or drops you have looted from them. /bf plates off hides them." },
    { name: "Prices and quest use on items", where: "On item tooltips", what: "What you saw the item sell for at auction and what a vendor pays, green when the Auction House pays clearly more, and which quest in your log needs it, like Needed for Rites of the Earthmother: 3/8. /bf prices tips hides the price line." },
    { name: "Gear sets button", where: "Beside your character window (C)", what: "Lists your saved gear sets; click one to wear it from your bags. Never in combat. Save a set with /bf set save NAME." },
    { name: "Gathering spots on the world map", where: "Press M, BF Guide layers", what: "Herbs, ore and chests you gathered before, as small icons; greyed when the node needs more skill than you have. Past spots, not live nodes." },
    { name: "Boss tips", where: "Top of the screen, the first time you target a supported dungeon or raid boss", what: "One short tip. Reviewed raid tips are marked Classic reference, not verified Forever mechanics. The Instance Atlas in the app shows the same tips. /bf boss off stops the pop-ups." },
    { name: "Trainer, riding and mount prices", where: "Quietly, when you open a trainer or vendor window", what: "Remembers what your class trainer, the riding trainer and mount vendors charge, so the app can say what the next training costs and add up a riding-and-mount gold goal." },
    { name: "Upgrade hints", where: "On item tooltips", what: "One line under each piece of gear: green Upgrade for you with what you gain, red Not for you with the reason (like Priests cannot wear mail), or grey Not an upgrade. /bf gear off hides them." },
    { name: "Learns where quest items come from", where: "Quietly, whenever you loot", what: "When you loot an item a quest in your log asks for, the addon remembers whether an enemy dropped it or you picked it up from an object, and where you were. /bf how and the app use it to explain the quest." },
    { name: "Moments", where: "Top of the screen, after combat", what: "A short message when you defeat an elite, a rare or a boss, or reach a profession milestone (every 25 points, and the rank limit). Each moment also reaches the desktop app over the live strip. /bf moments off silences the in-game ones." },
    { name: "Ask button on the minimap", where: "The owl crest on the edge of your minimap", what: "Click it to open the companion panel over your game and type your question there; the answer appears under it. Drag the button around the minimap edge to move it. /bf ask hide hides it." },
    { name: "Live line", where: "A thin dark line along the top edge of the game (or a small strip in a corner with /bf live safe or compact)", what: "How the desktop app knows where you are. It contains no personal data. /bf live off hides it." },
  ]);
  const APP = Object.freeze([
    { name: "Now", what: "What to do next, where to level, your training, quest log and this session's pace. With the live link on, quests you hand in show as Completed straight away, no /reload needed. Start here." },
    { name: "Answers over the game", what: "Questions you type in game (the owl button on the minimap or /bf ask) are answered here: offline from the bundled reference for where and how questions, otherwise by the AI you chose. The panel over the top-right of your game holds the question box and the answers in one window: the owl opens it ready to type, Esc closes it, and Open in app shows the whole conversation. Switch the panel off or choose when it hides under Settings → Game connection." },
    { name: "Moments", what: "With the live link on, the app answers what just happened in game: a painted card for elite, rare and boss kills, cleared dungeons, profession milestones (and where to train the next rank), new zones and flight paths, gear upgrades and finished quest chains. A death opens a death screen: who did the damage, the way back to your body and one thing to change. Recent moments are listed on Now; switch them off, or pick which kinds, under Settings → Game connection." },
    { name: "World Map", what: "Zone maps with quest givers, hand-ins, trainers, flight masters, herbs and ore. Click anyone for details. Your path this session is drawn on it." },
    { name: "Quests", what: "Look up any quest: who gives it, where it goes, rewards. Copies a /bf guide line for the game." },
    { name: "Adventure", what: "Your next step in more depth, dungeons for your level, and profession plans." },
    { name: "Instance Atlas: loot", what: "Every dungeon and raid card has a Loot button: each boss with what it drops, as item tiles with icons, quality colours, slot and how often it drops. Green Upgrade for you marks gear better than what you wear; the card says how many upgrades are inside. Star items for your wish list and they show on that dungeon's card." },
    { name: "Hover cards", what: "Rest the mouse on a quest, an item or an NPC anywhere in the app for a card. Quests: level, how to do it, rewards. Items: icon, stats, whether it's an upgrade for you, and which boss drops it. NPCs: what they train or sell and where they are." },
    { name: "Companion", what: "Ask in plain words. With no AI set up it still answers right away: “how do I do <quest>?”, “what should I do next?”, “what do I train?”, “where is <NPC>?” and “how do I get to <place>?”. An AI model (Settings) answers everything else." },
    { name: "Characters", what: "Each character's journal, gear and training review, talents, and Journey: your badges, how fast each level went, and your rested bonus." },
    { name: "Journey replay and picture", what: "World Map: ▶ replays your path this session on the shown zone, with deaths and level-ups appearing as they happened; 🖼 saves a hand-drawn-style picture of that path (PNG) wherever you choose, ready to share." },
    { name: "Plan tonight with the companion", what: "Ask the companion \"what should I do tonight?\" or \"who should I play?\" and it answers with an ordered plan from your next step, rested XP, the zone to clear, dungeons for your level, gear and your other characters. Works without an AI model too; needs your character shared with the companion." },
    { name: "Language", what: "The app and the addon's messages follow your game's language. German is available, machine-translated with a local model and marked as such; anything not translated stays English. Help → Field guide → Language picks one yourself." },
    { name: "Accessibility", what: "Every button and field has a name for screen readers, the keyboard focus always shows, the World Map moves with the arrow keys (+ and - zoom, 0 resets), item cards name the quality in words, animations stop when Windows is set to show less motion, and Windows high-contrast mode keeps controls visible." },
    { name: "Guided route", what: "Adventure → Guided route: your race's step-by-step route from level 1 (pick up, do, hand in, next zone), where you are on it and how far every race's route reaches. In game, /bf route guide follows it with the arrow. Review the routes: keep, leave out or move steps, then export the review." },
    { name: "Zones", what: "Adventure → Zones: every zone for your faction from level 1 to 60, coloured by level band, with how many of its quests you've done (\"Durotar 18/22\"), a star for zones you've finished and the next zone worth clearing. Click a zone to open it on the World Map." },
    { name: "Spoken steps", what: "Now → Speak steps reads your next step aloud with the local Windows voice whenever it changes, like \"Hand in Call of Water to Islen Waterseer, south-east.\" Say again repeats it. Off until you switch it on; nothing leaves this computer." },
    { name: "Mini Now", what: "Now → Mini Now opens a small window that stays on top beside your game: your next step (hand-in, objective or quest to pick up, with the direction), your experience and rested bar, and your pace this session. Drag it by its top bar; it never takes your keyboard." },
    { name: "Faction themes and welcome tour", what: "The app takes on your character's side: a Horde or Alliance crest beside the name and on every page banner, with matching colours. New players get a short painted welcome tour; Help → Field guide → Replay the welcome tour shows it again." },
    { name: "Past sessions", what: "Characters → Journey keeps each play session (with the live link on): when, how long, levels gained, deaths and zones, and a two-week chart of levels per day. A 30-minute break starts a new session. Stays on this computer." },
    { name: "All characters", what: "Characters → All characters: every character at a glance (level, experience, rested XP grown since you logged out, gold, bag space and professions) and who to play tonight, with the reason. Switch to one with a click." },
    { name: "Character sheet", what: "Characters → Sheet: your gear slot by slot with quality colours and item level, empty slots, pieces to replace, upgrades already in your bags or bank, your stats, and your gear sets (/bf set) with where each missing piece is. Sets are worn only when you type /bf set wear." },
    { name: "Ledger", what: "Bags & bank: every character's bags, bank and mail, searchable. Gold & prices: gold per character and the Auction House prices you saw yourself (/bf prices). Reputation and Cooldowns for every character. A gold goal you set yourself (for example riding and your first mount) with progress across characters and the days left at your recent pace. Stays on this computer." },
    { name: "Plans", what: "Checklists and party plans you write yourself." },
    { name: "Community", what: "Herb, ore and chest spots you gather, and where you looted quest creatures, are shared anonymously so other players can find them, and theirs show on your World Map (teal Community finds layer), NPC cards and in the loot browser, always labelled Community with how many players reported them. No names, realm, account or chat are ever sent. Turn it off under Settings → Game connection → Community, where you can also forget your contributions or report a problem." },
    { name: "Settings", what: "Game connection (folder, addon, live link, community sharing), AI connection and updates." },
  ]);
  // Local navigation descriptor, not a slash command or a second action catalog.
  const markerKind = "saved-quest-marker";
  const fields = ["kind", "questId", "profileId", "sourceId", "build", "phase", "mapId", "x", "y"];
  const positiveId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
  const present = (v) => typeof v === "string" && v.length > 0;
  const coordinate = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
  function resolveMarker(a, p) {
    if (!a || Object.keys(a).length !== fields.length || !fields.every((key) => Object.hasOwn(a, key)) ||
        a.kind !== markerKind || !positiveId(a.questId) || !positiveId(a.mapId) || !coordinate(a.x) || !coordinate(a.y) ||
        !present(a.profileId) || !present(a.sourceId) || typeof a.build !== "string" ||
        !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/.test(a.build) ||
        p?.id !== a.profileId || p.source?.kind !== "wow-addon" || p.source.id !== a.sourceId || p.clientBuild !== a.build) return null;
    const quest = p.quests?.find((q) => q.id === a.questId);
    const point = quest?.destination;
    // Match the Guide's server-approved clipboard precision, not map/reference points.
    return typeof quest?.complete === "boolean" && a.phase === (quest.complete ? "t" : "o") &&
      point?.mapId === a.mapId && coordinate(point.x) && coordinate(point.y) &&
      Number(point.x.toFixed(4)) === a.x && Number(point.y.toFixed(4)) === a.y ? quest : null;
  }
  const scopedQuest = Object.freeze({
    create(p, questId, w) {
      if (w?.source !== "game" || w.canCopy !== true || !w.destination) return null;
      const { mapId, x, y } = w.destination;
      const a = { kind: markerKind, questId, profileId: p?.id, sourceId: p?.source?.id, build: p?.clientBuild, phase: w.phase, mapId, x, y };
      return resolveMarker(a, p) ? a : null;
    },
    mapTarget(a, p) {
      const q = resolveMarker(a, p);
      if (!q) return null;
      return { mapId: a.mapId, x: a.x, y: a.y, questId: a.questId, profileId: a.profileId,
        routeBuild: a.build, routeSource: a.sourceId, kind: a.phase === "t" ? "quest-turnin" : "quest-objective",
        label: q.title || `Quest #${a.questId}`, scopedQuest: a };
    },
    returnQuestId(a, p) { return resolveMarker(a, p)?.id ?? null; },
  });
  // A public fictional drill does not require a game save. Even a null/manual
  // context must match on return; a build here is identity, not evidence.
  const practiceIdentity = p => ({ profileId: p?.id ?? null, sourceKind: p?.source?.kind ?? null,
    sourceId: p?.source?.id ?? null, build: p?.clientBuild ?? null });
  const scopedPractice = Object.freeze({
    create(p, instanceId, drillId, mode) {
      if (instanceId !== "dm" || drillId !== "opener" || !["full", "compact"].includes(mode) ||
          (p && !present(p.id))) return null;
      return Object.freeze({ kind: "fieldbook-practice", instanceId, drillId, mode, ...practiceIdentity(p) });
    },
    resolve(action, p, instanceId, drillId) {
      const expected = scopedPractice.create(p, instanceId, drillId, action?.mode);
      return expected && Object.keys(action).length === Object.keys(expected).length &&
        Object.keys(expected).every(key => Object.hasOwn(action, key) && action[key] === expected[key]) ? expected.mode : null;
    },
  });
  if (typeof module === "object" && module.exports) { module.exports = { CATALOG, FEATURES, APP, scopedQuest, scopedPractice }; return; }
  const ICONS = Object.freeze({ "Finding your way": "finding-your-way", "Your character": "your-character", "Adventure Compass": "adventure-compass", "Helpers on or off": "helpers", "Live link": "live-link", "Ask the companion": "live-link", "Advanced": "advanced" });
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
      ${PageHero.render({ art: "commands", eyebrow: "Help · Commands", title: "Everything you can type in game", subtitle: "Press Enter in WoW, type the command, press Enter again. Commands only show you things or put an arrow on your map; nothing plays for you.",
        aside: `<label class="cmd-search"><span class="sr-only">Search commands</span><input type="search" data-cmd-filter placeholder="Search: trainer, arrow, junk, live…" value="${esc(filter)}"></label>` })}
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
  window.CommandsView = { page, mounted, CATALOG, FEATURES, APP, scopedQuest, scopedPractice };
})();
