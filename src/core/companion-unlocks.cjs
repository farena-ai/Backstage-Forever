"use strict";
// 1.4 (J15): the companion answers from the 1.3 knowledge: boss tips, class quests and unlocks,
// and reference leads for reputation. Strict patterns keep ordinary questions on their old route.
const { TIPS } = require("./boss-tips.cjs");
const { UNLOCKS } = require("./class-unlocks.cjs");
const { repAdvice } = require("./rep-advice.cjs");
const CITIES = Object.freeze({ 72: "Stormwind", 47: "Ironforge", 69: "Darnassus", 54: "Gnomeregan Exiles", 76: "Orgrimmar", 81: "Thunder Bluff", 68: "Undercity", 530: "Darkspear Trolls" });

const loose = (s) => String(s || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const BOSSES = Object.keys(TIPS).map((name) => ({ name, key: loose(name), short: loose(name).split(" ").filter((w) => w.length >= 5 && !["the", "lord", "lady", "high", "baron", "captain", "commander", "princess", "chief"].includes(w)) }));
const FIGHT = /\b(tips?|tactics?|strateg(?:y|ies)|beat|kill|fight|down|deal with|handle)\b/;
function bossIn(q) {
  const full = BOSSES.filter((b) => q.includes(b.key)).sort((a, b) => b.key.length - a.key.length)[0];
  if (full) return full;
  const hits = BOSSES.filter((b) => b.short.some((w) => new RegExp(`\\b${w}\\b`).test(q)));
  return hits.length === 1 ? hits[0] : null;
}
// Words for each unlock -> [class, unlock name as in UNLOCKS].
const UNLOCK_WORDS = [
  [/\bbear form\b/, "Druid", "Bear Form"], [/\baquatic form\b/, "Druid", "Aquatic Form"], [/\bcat form\b/, "Druid", "Cat Form"], [/\btravel form\b/, "Druid", "Travel Form"],
  [/\bvoid ?walker\b/, "Warlock", "Voidwalker"], [/\bsuccubus\b/, "Warlock", "Succubus"], [/\bfel ?hunter\b/, "Warlock", "Felhunter"], [/\bfel ?steed\b/, "Warlock", "Summon Felsteed"], [/\bdread ?steed\b/, "Warlock", "Summon Dreadsteed"],
  [/\b(?:my |a |hunter )?pet\b|\btame (?:a )?beast\b/, "Hunter", "Your first pet"],
  [/\bearth totem\b/, "Shaman", "Earth Totem"], [/\bfire totem\b/, "Shaman", "Fire Totem"], [/\bwater totem\b/, "Shaman", "Water Totem"], [/\bair totem\b/, "Shaman", "Air Totem"],
  [/\bdefensive stance\b/, "Warrior", "Defensive Stance, Sunder Armor and Taunt"], [/\bberserker stance\b/, "Warrior", "Berserker Stance"],
  [/\bredemption\b/, "Paladin", "Redemption (resurrect)"], [/\bwar ?horse\b/, "Paladin", "Summon Warhorse and plate armor"], [/\bcharger\b/, "Paladin", "Summon Charger"],
  [/\bpoisons?\b/, "Rogue", "Poisons"], [/\bpick ?lock(?:ing)?\b|\blockpick(?:ing)?\b/, "Rogue", "Pick Lock"],
  [/\bteleports?\b/, "Mage", "Teleports"], [/\bportals?\b/, "Mage", "Portals"],
];
const ASK = /\b(how|when|where|what level)\b.*\b(get|learn|unlock|train|quest|tame)\b|\b(quest|level) for\b/;
function unlockIn(q) {
  if (!ASK.test(q)) return null;
  for (const [rx, cls, what] of UNLOCK_WORDS) if (rx.test(q)) { const u = UNLOCKS[cls]?.find((x) => x.what === what); if (u) return { cls, ...u }; }
  return null;
}
const REP = /\b(honou?red|revered|exalted|friendly|reputation|rep)\b/;
function factionIn(q, profile) {
  const known = [...Object.entries(CITIES).map(([id, name]) => ({ id: Number(id), name })),
    ...((Array.isArray(profile?.ledger?.reputations?.factions) ? profile.ledger.reputations.factions : []).map((f) => ({ id: f.id, name: f.name })))];
  return known.filter((f) => q.includes(loose(f.name))).sort((a, b) => b.name.length - a.name.length)[0] || null;
}
/** A special answer for the question, or null. */
function answerSpecial(question, { profile = null, pack = null } = {}) {
  const q = loose(question);
  const boss = FIGHT.test(q) ? bossIn(q) : null;
  if (boss) return { intent: "boss-tip", text: `**${boss.name}:** ${TIPS[boss.name]} (A general tip; Forever may tune the fight.)`, facts: [`Boss tip for ${boss.name}: ${TIPS[boss.name]}`] };
  const u = unlockIn(q);
  if (u) {
    const yours = profile?.className && profile.className !== u.cls ? ` (that's a ${u.cls} unlock; you're playing a ${profile.className})` : "";
    const when = Number.isFinite(profile?.level) && profile.className === u.cls ? (profile.level >= u.level ? " You're there already." : ` That's ${u.level - profile.level} level${u.level - profile.level === 1 ? "" : "s"} away.`) : "";
    return { intent: "class-unlock", text: `**${u.what}** at level ${u.level}${yours}. ${u.how}${when}`, facts: [`${u.cls} unlock: ${u.what} at level ${u.level}. ${u.how}`] };
  }
  if (REP.test(q) && pack) {
    const f = factionIn(q, profile);
    if (f) {
      const mine = (Array.isArray(profile?.ledger?.reputations?.factions) ? profile.ledger.reputations.factions : []).find((x) => x.id === f.id);
      const who = { level: profile?.level, faction: profile?.faction, race: profile?.race, history: profile?.history, quests: profile?.quests,
        ledger: { reputations: { factions: [mine || f] } } };
      const r = repAdvice(who, pack, { perFaction: 3 })?.factions?.[0];
      if (r?.quests?.length) {
        const list = r.quests.map(x => `${x.title}${x.minLevel ? ` (minimum level ${x.minLevel})` : ""}${x.status === "turn-in" ? " — ready in your saved log" : ""}`).join("; ");
        const where = mine ? `Last saved at ${r.standingName}. ` : "";
        const note = `Reference leads: ${list}. Server amounts and unlisted requirements are unknown.`;
        return { intent: "reputation", text: `**${f.name}:** ${where}${note}`, facts: [`${f.name} reputation · ${note}`] };
      }
    }
  }
  return null;
}
module.exports = { answerSpecial };
