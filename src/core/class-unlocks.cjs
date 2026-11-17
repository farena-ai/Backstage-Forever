"use strict";
// Class quests and key unlocks (1.3, J9). The bundled quest data has no class restrictions, so
// these are short hand-written notes per class: at which level something important opens, what
// it gives, and who starts it (your class trainer in most cases). Wording stays general where
// Forever may differ; the trainer always knows the details. Alliance and Horde are both covered.
const U = (level, what, how, kind = "quest") => ({ level, what, how, kind });
const UNLOCKS = Object.freeze({
  Warrior: [
    U(10, "Defensive Stance, Sunder Armor and Taunt", "A quest from your warrior trainer at level 10 opens Defensive Stance; you need it to tank."),
    U(30, "Berserker Stance", "A quest from your warrior trainer at level 30 opens Berserker Stance, with Intercept and Whirlwind to follow."),
    U(40, "Plate armor", "Warriors can wear plate from level 40: check your trainer.", "train"),
  ],
  Paladin: [
    U(12, "Redemption (resurrect)", "A quest from your paladin trainer around level 12 teaches Redemption."),
    U(40, "Summon Warhorse and plate armor", "Your own warhorse comes from your paladin trainer at level 40, and plate armor opens then too.", "train"),
    U(60, "Summon Charger", "The epic charger is a long quest chain at level 60, started with your paladin trainer."),
  ],
  Hunter: [
    U(10, "Your first pet", "Taming quests from your hunter trainer at level 10 teach Tame Beast, Feed Pet and Call Pet."),
    U(10, "Pet training", "Your pet learns new skills from beasts you tame; a pet trainer in your capital teaches the rest.", "train"),
    U(40, "Mail armor", "Hunters can wear mail from level 40.", "train"),
  ],
  Rogue: [
    U(16, "Pick Lock", "Your rogue trainer teaches Pick Lock at level 16; practise on lockboxes to raise it.", "train"),
    U(20, "Poisons", "A quest from your rogue trainer at level 20 opens Poisons; buy the reagents from poison vendors."),
  ],
  Priest: [
    U(10, "Your race's own priest spells", "Each race's priests learn one or two spells of their own at the trainer around levels 10 and 20.", "train"),
    U(10, "Shackle Undead and more", "Your priest trainer teaches new spells every two levels: visit often.", "train"),
  ],
  Shaman: [
    U(4, "Earth Totem", "The Call of Earth quest from your shaman trainer at level 4 gives your Earth Totem."),
    U(10, "Fire Totem", "The Call of Fire quest at level 10 gives your Fire Totem."),
    U(20, "Water Totem", "The Call of Water quest at level 20 gives your Water Totem."),
    U(30, "Air Totem", "The Call of Air quest at level 30 gives your Air Totem."),
    U(40, "Mail armor", "Shamans can wear mail from level 40.", "train"),
  ],
  Mage: [
    U(20, "Teleports", "Teleport spells to your capitals are taught by your mage trainer from level 20 (they use Runes of Teleportation).", "train"),
    U(40, "Portals", "From level 40 your trainer teaches Portals, so you can take your group with you (Runes of Portals).", "train"),
  ],
  Warlock: [
    U(1, "Imp", "Your first demon, the Imp, comes early from your warlock trainer.", "train"),
    U(10, "Voidwalker", "A quest from your warlock trainer at level 10 gives the Voidwalker, a demon that tanks for you."),
    U(20, "Succubus", "A quest from your warlock trainer at level 20 gives the Succubus."),
    U(30, "Felhunter", "A quest from your warlock trainer at level 30 gives the Felhunter, good against casters."),
    U(40, "Summon Felsteed", "Your own mount comes from your warlock trainer at level 40.", "train"),
    U(60, "Summon Dreadsteed", "The epic Dreadsteed is a long quest chain at level 60."),
  ],
  Druid: [
    U(10, "Bear Form", "A quest from your druid trainer at level 10 sends you to Moonglade and back for Bear Form."),
    U(16, "Aquatic Form", "A quest at level 16 gives Aquatic Form, for fast swimming and breathing under water."),
    U(20, "Cat Form", "Your druid trainer teaches Cat Form at level 20.", "train"),
    U(30, "Travel Form", "Your druid trainer teaches Travel Form at level 30.", "train"),
  ],
});
const ALL_CLASSES = Object.keys(UNLOCKS);
/** The unlocks for one class at one level: done, now (this level or the next two), and later. */
function classUnlocks(className, level) {
  const list = UNLOCKS[className];
  if (!list || !Number.isInteger(level)) return null;
  const tag = (u) => ({ ...u, state: u.level <= level - 3 ? "past" : u.level <= level + 2 ? "now" : "later" });
  const rows = list.map(tag);
  return { className, level, rows, now: rows.filter((r) => r.state === "now"), next: rows.find((r) => r.level > level) || null };
}
module.exports = { classUnlocks, UNLOCKS, ALL_CLASSES };
