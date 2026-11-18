"use strict";
// Boss tips (1.3, J13): a short plain-words tip for dungeon bosses, shown on the Instance Atlas and
// in game when you target the boss. Text only: no timers. These are general tips from how the
// classic encounters work; Forever may tune a fight, so each tip says what to watch for, not when.
// The addon gets the same tips from scripts/build-boss-tips.cjs (BackstageForeverBossTips.lua).
// J31 review and scope: docs/raid-boss-tip-review.md.
const REVIEWED_RAID_TIPS = Object.freeze({
  Lucifron: { instanceMap: 409, npcId: 12118, advice: "Dispel Impending Doom as magic and remove Lucifron's Curse separately." },
  Magmadar: { instanceMap: 409, npcId: 11982, advice: "Have hunters use Tranquilizing Shot to remove Frenzy; plan fear protection for the tank." },
  Gehennas: { instanceMap: 409, npcId: 12259, advice: "Step out of Rain of Fire and remove the curse that cuts healing." },
  Garr: { instanceMap: 409, npcId: 12057, advice: "Banish or tank the Firesworn and back away before they die: they explode." },
  Shazzrah: { instanceMap: 409, npcId: 12264, advice: "Remove Shazzrah's Curse and back away from his Arcane Explosion after he teleports." },
  "Baron Geddon": { instanceMap: 409, npcId: 12056, advice: "If you get Living Bomb, move away from the raid. Dispel Ignite Mana as magic." },
  "Golemagg the Incinerator": { instanceMap: 409, npcId: 11988, advice: "Off-tank the Core Ragers and swap Golemagg's tanks as Magma Splash stacks build." },
  "Sulfuron Harbinger": { instanceMap: 409, npcId: 12098, advice: "Kill the Flamewaker Priests first and interrupt their heals." },
  "Majordomo Executus": { instanceMap: 409, npcId: 12018, advice: "Defeat the Flamewaker adds so Majordomo surrenders; don't cast into Magic Reflection." },
});
const TIPS = Object.freeze({
  // Ragefire Chasm
  "Taragaman the Hungerer": "Fire Nova burns everyone close to him: healers and casters stay at range.",
  "Jergosh the Invoker": "Interrupt his Immolate and remove Curse of Weakness from the tank if you can.",
  "Bazzalan": "His strikes poison: cure poison on the tank.",
  // Wailing Caverns
  "Lady Anacondra": "Interrupt her Healing Touch and wake anyone she puts to Sleep.",
  "Lord Cobrahn": "Interrupt his heals; he turns into a serpent near the end and hits harder.",
  "Lord Pythas": "Interrupt Healing Touch; Thunderclap slows everyone close.",
  "Lord Serpentis": "Interrupt his heals and keep the tank topped up through his Lightning Bolts.",
  "Skum": "Chained Bolt jumps between players: don't stand together.",
  "Verdan the Everliving": "Grasping Vines knocks down everyone near him: ranged stay back.",
  "Mutanus the Devourer": "Naralex's Nightmare sleeps a player: the healer stays out of it if possible; kill him fast.",
  // The Deadmines
  "Rhahk'Zor": "A plain hard hitter: tank him by the door and burn him down.",
  "Sneed": "Kill Sneed's Shredder first; Sneed jumps out and is easy after.",
  "Gilnid": "Clear the smelters' workers around him first, then pull him alone.",
  "Mr. Smite": "He stuns everyone and swaps weapons at two health marks: save cooldowns for after the stun.",
  "Captain Greenskin": "Cleave: only the tank stands in front of him.",
  "Edwin VanCleef": "He calls Blackguard helpers when hurt: burn him or have someone hold the adds.",
  // Shadowfang Keep
  "Razorclaw the Butcher": "Cleaves: only the tank stands in front.",
  "Baron Silverlaine": "Veil of Shadow cuts healing on the tank: remove the curse if your group can.",
  "Commander Springvale": "Interrupt his Holy Light; he hits hard with Hammer of Justice stuns.",
  "Odo the Blindwatcher": "He grows stronger the longer you fight: kill him quickly.",
  "Fenrus the Devourer": "Toxic Saliva poisons: cure poison on the tank.",
  "Wolf Master Nandos": "He calls wolves: tank them together and keep healers safe.",
  "Archmage Arugal": "He teleports around the room; Arugal's Curse turns a player into a worgen (remove the curse), and Void Bolt hits hard.",
  // Blackfathom Deeps
  "Ghamoo-ra": "A slow turtle with a hard bite: tank and burn.",
  "Lady Sarevess": "Forked Lightning hits in front of her: only the tank stands there.",
  "Twilight Lord Kelris": "Interrupt Mind Blast and wake players he puts to Sleep.",
  "Aku'mai": "Poison Cloud on the ground: step out of it; she frenzies near the end.",
  // The Stockade
  "Bazil Thredd": "Pulls several prisoners with him: clear the cells around him first.",
  // Gnomeregan
  "Viscous Fallout": "Its strikes poison and it can disarm: cure poison on the tank.",
  "Electrocutioner 6000": "Chain Lightning jumps between players: spread out.",
  "Crowd Pummeler 9-60": "Trample hits everyone near: ranged stay out of melee.",
  "Mekgineer Thermaplugg": "Bombs walk out of the faces on the walls: one player presses the button by the active face to stop them.",
  // Razorfen Kraul
  "Agathelos the Raging": "Knocks the tank back: tank him with your back to a wall.",
  "Charlga Razorflank": "Interrupt her heals; she heals her guards too.",
  // Scarlet Monastery
  "Bloodmage Thalnos": "Fire Nova around him: casters and healers stay at range.",
  "Houndmaster Loksey": "His dogs come with him: tank everything together.",
  "Arcanist Doan": "At half health he shields himself and casts Arcane Explosion: run out of melee range.",
  "Herod": "When he spins (Whirlwind) everyone but the tank runs away; trainees rush in when he dies.",
  "Scarlet Commander Mograine": "High Inquisitor Whitemane comes in and raises him: kill Mograine, then Whitemane.",
  "High Inquisitor Whitemane": "Interrupt her Heal; she puts players to Deep Sleep and raises Mograine.",
  // Razorfen Downs
  "Mordresh Fire Eye": "Interrupt his Fireball; Fire Nova hits everyone close.",
  "Glutton": "He enrages near the end: save your cooldowns.",
  "Amnennar the Coldbringer": "Frost Nova roots everyone; Frozen Spectres appear at half health: kill or hold them.",
  // Uldaman
  "Ironaya": "Knock Away and Arcing Smash: only the tank in front.",
  "Obsidian Sentinel": "Breaks into shards as it takes damage: kill the shards.",
  "Archaedas": "Wakes Earthen Guardians and Vault Warders around the room: someone holds the adds while you burn him.",
  // Zul'Farrak
  "Antu'sul": "Summons basilisks and drops a healing ward near the end: kill the ward.",
  "Witch Doctor Zum'rah": "Raises zombies from the graves around him: fight him away from the graves.",
  "Hydromancer Velratha": "Interrupt her Healing Wave.",
  "Sergeant Bly": "After the prisoners are freed, hold the top of the stairs against the waves before fighting Bly.",
  "Chief Ukorz Sandscalp": "Cleaves and enrages: only the tank in front, cooldowns at the end.",
  // Maraudon
  "Noxxion": "Splits into spawns: kill the little ones, then him.",
  "Celebras the Cursed": "Interrupt Wrath; Entangling Roots holds players in place.",
  "Landslide": "Knock Away throws the tank: tank him with your back to a wall.",
  "Rotgrip": "A hard bite: keep the tank's health high.",
  "Princess Theradras": "Knock Away and Dust Field around her: ranged stay out, healers watch the tank's swaps.",
  // Sunken Temple
  "Jammal'an the Prophet": "Hex turns players into frogs (dispel it); kill Ogom the Wretched after him.",
  "Shade of Eranikus": "Deep Slumber sleeps the whole group: wake the healer first.",
  // Scholomance
  "Jandice Barov": "She splits into illusions: the illusions die in one hit, find and kill the real one.",
  "Ras Frostwhisper": "Frost damage and freezes: frost resistance helps.",
  "Darkmaster Gandling": "Shadow Portal sends a player into a side room full of risen guards: fight your way out and back.",
  // Stratholme
  "Baroness Anastari": "Possess takes over a player: kill her fast and don't hit your possessed friend hard.",
  "Balnazzar": "Mind Control and Psychic Scream fears: fear protection helps.",
  "Ramstein the Gorger": "Knockout stuns and Trample: only the tank in front.",
  "Baron Rivendare": "Death Pact and skeleton helpers: kill the skeletons quickly.",
  // Raids (one line each)
  "Onyxia": "When she flies, never stand under her sides or in the line of her Deep Breath; when she lands again, Bellowing Roar fears.",
  "Ragnaros": "Wrath of Ragnaros knocks melee back; when he submerges, Sons of Flame rush the raid.",
  ...Object.fromEntries(Object.entries(REVIEWED_RAID_TIPS).map(([name, { advice }]) => [name, `Classic reference: ${advice}`])),
});
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘']/g, "'").trim();
const BY = new Map(Object.entries(TIPS).map(([k, v]) => [norm(k), v]));
const tipFor = (name) => BY.get(norm(name)) || null;
module.exports = { TIPS, tipFor, REVIEWED_RAID_TIPS };
