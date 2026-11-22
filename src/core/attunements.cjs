"use strict";
// Attunements and keys (roadmap G5): the classic keys and attunement chains, one list per
// character, with the step the character is on.
//
// The chains below are a classic-era reference written by hand. A step is shown as confirmed only
// when its quest (id and title) is in the bundled quest reference, or its item (id and name) is in
// the bundled item list or the player's own game files. Anything else is marked "not confirmed in
// WoW Forever" and never counts as progress. Where a step is, who gives it and how it is done is
// reference text: WoW Forever may differ. Progress comes only from the saved character: finished
// quests, the quest log, and key items seen in bags, bank or worn. Pure.
// Several ids are either one quest in versions (any one counts) or, with `sequence`, parts done in a row.
const q = (ids, title, how, sequence = false) => ({ type: "quest", ids: Array.isArray(ids) ? ids : [ids], title, how, sequence });
const item = (id, name, how) => ({ type: "item", id, name, how });

const CHAINS = Object.freeze([
  { id: "mc", name: "Molten Core", kind: "Attunement", instanceId: "mc", side: null, levels: "60",
    opens: "Lets you step into Molten Core from Blackrock Mountain without walking through Blackrock Depths.",
    steps: [
      item(18412, "Core Fragment", "Pick it up beside the Molten Core portal at the far end of Blackrock Depths."),
      q([7848, 7487], "Attunement to the Core", "Lothos Riftwaker in Blackrock Mountain gives the quest and takes the fragment."),
    ] },
  { id: "ony-alliance", name: "Onyxia's Lair", kind: "Attunement", instanceId: "ony", side: "Alliance", levels: "50-60", key: item(16309, "Drakefire Amulet"),
    opens: "The Drakefire Amulet in your bags lets you enter Onyxia's Lair.",
    steps: [
      q(4182, "Dragonkin Menace", "Helendis Riverhorn at Morgan's Vigil, Burning Steppes."),
      q([4183, 4184, 4185, 4186, 4223, 4224], "The True Masters", "A run of errands between Burning Steppes, Lakeshire and Stormwind.", true),
      q(4241, "Marshal Windsor", "Sends you into Blackrock Depths to find Marshal Windsor."),
      q(4242, "Abandoned Hope", "Report back to Marshal Maxwell."),
      q(4264, "A Crumpled Up Note", "The note drops from creatures in Blackrock Depths."),
      q(4282, "A Shred of Hope", "Two tablets from General Angerforge and Golem Lord Argelmach."),
      q(4322, "Jail Break!", "Escort Marshal Windsor out of the prison in Blackrock Depths."),
      q(6402, "Stormwind Rendezvous", "Meet Windsor at the gates of Stormwind."),
      q(6403, "The Great Masquerade", "Walk with Windsor to Stormwind Keep."),
      q(6501, "The Dragon's Eye", "Take the fragment to Haleh in Winterspring."),
      q(6502, "Drakefire Amulet", "Blood of the Black Dragon Champion from General Drakkisath, Upper Blackrock Spire."),
    ] },
  { id: "ony-horde", name: "Onyxia's Lair", kind: "Attunement", instanceId: "ony", side: "Horde", levels: "55-60", key: item(16309, "Drakefire Amulet"),
    opens: "The Drakefire Amulet in your bags lets you enter Onyxia's Lair.",
    steps: [
      q(4903, "Warlord's Command", "Warlord Goretooth in Kargath, Badlands: three bosses in Lower Blackrock Spire."),
      q(4941, "Eitrigg's Wisdom", "Speak with Eitrigg, then Thrall, in Orgrimmar."),
      q(4974, "For The Horde!", "Warchief Rend Blackhand in Upper Blackrock Spire."),
      q(6566, "What the Wind Carries", "Listen to Thrall in Orgrimmar."),
      q(6567, "The Champion of the Horde", "Find Rexxar wandering in Desolace."),
      q(6568, "The Testament of Rexxar", "Carry the letter to Myranda the Hag, Western Plaguelands."),
      q(6569, "Oculus Illusions", "Black Dragonspawn Eyes from Upper Blackrock Spire."),
      q(6570, "Emberstrife", "Speak with Emberstrife in Dustwallow Marsh, wearing the disguise."),
      q(6582, "The Test of Skulls, Scryer", "A dragon in Winterspring."),
      q(6583, "The Test of Skulls, Somnus", "A dragon in Swamp of Sorrows."),
      q(6584, "The Test of Skulls, Chronalis", "A dragon in Tanaris."),
      q(6585, "The Test of Skulls, Axtroz", "A dragon in Wetlands."),
      q(6601, "Ascension...", "Return to Rexxar."),
      q(6602, "Blood of the Black Dragon Champion", "Blood from General Drakkisath, Upper Blackrock Spire."),
    ] },
  { id: "bwl", name: "Blackwing Lair", kind: "Attunement", instanceId: "bwl", side: null, levels: "60",
    opens: "After the quest, touch the orb behind General Drakkisath in Upper Blackrock Spire once. From then on the orb in Blackrock Mountain takes you in.",
    steps: [q(7761, "Blackhand's Command", "Starts from a letter the Scarshield Quartermaster drops, just outside the Blackrock Spire entrance.")] },
  { id: "ubrs", name: "Upper Blackrock Spire", kind: "Key", instanceId: "ubrs", side: null, levels: "57-60", key: item(12344, "Seal of Ascension"),
    opens: "The Seal of Ascension opens the door to Upper Blackrock Spire. One holder is enough for the group.",
    steps: [
      item(12219, "Unadorned Seal of Ascension", "A rare drop from creatures in Lower Blackrock Spire."),
      q(4742, "Seal of Ascension", "Vaelan in Lower Blackrock Spire: three gemstones from Highlord Omokk, War Master Voone and Overlord Wyrmthalak."),
      q(4743, "Seal of Ascension", "Have Emberstrand in Dustwallow Marsh forge the seal, then return to Vaelan."),
    ] },
  { id: "dm", name: "Dire Maul", kind: "Key", instanceId: "dme", side: null, levels: "55-60", key: item(18249, "Crescent Key"),
    opens: "The Crescent Key opens the north and west wings of Dire Maul.",
    steps: [item(18249, "Crescent Key", "Chase Pusillin the imp through the east wing of Dire Maul until he fights; he drops the key.")] },
  { id: "scholo-alliance", name: "Scholomance", kind: "Key", instanceId: "scholo", side: "Alliance", levels: "55-60", key: item(13704, "Skeleton Key"),
    opens: "The Skeleton Key opens the door of Scholomance. One holder is enough for the group.",
    steps: [
      q(5533, "Scholomance", "Starts at Chillwind Camp, Western Plaguelands."),
      q(5537, "Skeletal Fragments", "Fifteen fragments from skeletons in Andorhal."),
      q(5538, "Mold Rhymes With...", "Take the fragments and gold to Gadgetzan."),
      q(5801, "Fire Plume Forged", "Dip the key mold in the lava of Fire Plume Ridge, Un'Goro Crater."),
      q(5803, "Araj's Scarab", "Araj the Summoner in the middle of Andorhal."),
      q(5505, "The Key to Scholomance", "Return for the finished key."),
    ] },
  { id: "scholo-horde", name: "Scholomance", kind: "Key", instanceId: "scholo", side: "Horde", levels: "55-60", key: item(13704, "Skeleton Key"),
    opens: "The Skeleton Key opens the door of Scholomance. One holder is enough for the group.",
    steps: [
      q(838, "Scholomance", "Starts at the Bulwark, Tirisfal Glades."),
      q(964, "Skeletal Fragments", "Fifteen fragments from skeletons in Andorhal."),
      q(5514, "Mold Rhymes With...", "Take the fragments and gold to Gadgetzan."),
      q(5802, "Fire Plume Forged", "Dip the key mold in the lava of Fire Plume Ridge, Un'Goro Crater."),
      q(5804, "Araj's Scarab", "Araj the Summoner in the middle of Andorhal."),
      q(5511, "The Key to Scholomance", "Return for the finished key."),
    ] },
  { id: "strat", name: "Stratholme", kind: "Key", instanceId: "strat", side: null, levels: "58-60", key: item(12382, "Key to the City"),
    opens: "The Key to the City opens the gates inside Stratholme and the back entrance.",
    steps: [item(12382, "Key to the City", "Magistrate Barthilas in the undead side of Stratholme drops it.")] },
  { id: "brd", name: "Blackrock Depths", kind: "Key", instanceId: "brd", side: null, levels: "48-60", key: item(11000, "Shadowforge Key"),
    opens: "The Shadowforge Key opens the locked doors and shortcuts of Blackrock Depths.",
    steps: [
      q(3801, "Dark Iron Legacy", "Speak with the ghost of Franclorn Forgewright in Blackrock Mountain. He only shows himself to the dead."),
      q(3802, "Dark Iron Legacy", "Take the hammer Ironfel from Fineous Darkvire in Blackrock Depths and set it in the shrine."),
    ] },
  { id: "sm", name: "Scarlet Monastery", kind: "Key", instanceId: "sm", side: null, levels: "34-45", key: item(7146, "The Scarlet Key"),
    opens: "The Scarlet Key opens the Armory and the Cathedral of the Scarlet Monastery.",
    steps: [item(7146, "The Scarlet Key", "From the strongbox behind Arcanist Doan at the end of the Library.")] },
  { id: "gnomer", name: "Gnomeregan", kind: "Key", instanceId: "gnomer", side: null, levels: "29-38", key: item(6893, "Workshop Key"),
    opens: "The Workshop Key opens the back door of Gnomeregan, a shorter way to the last bosses.",
    steps: [item(6893, "Workshop Key", "A boss inside Gnomeregan drops it.")] },
  { id: "zf", name: "Zul'Farrak", kind: "Key", instanceId: "zf", side: null, levels: "44-54", key: item(9240, "Mallet of Zul'Farrak"),
    opens: "The Mallet of Zul'Farrak rings the gong that calls Gahz'rilla.",
    steps: [
      item(9241, "Sacred Mallet", "Qiaga the Keeper at the Altar of Zul, The Hinterlands, drops it."),
      item(9240, "Mallet of Zul'Farrak", "Use the Sacred Mallet at the altar on top of Jintha'Alor, The Hinterlands."),
    ] },
  { id: "naxx", name: "Naxxramas", kind: "Attunement", instanceId: "naxx", side: null, levels: "60",
    opens: "One of three versions of the quest, by your standing with the Argent Dawn: materials at Honored, fewer at Revered, none at Exalted.",
    steps: [q([9121, 9122, 9123], "The Dread Citadel - Naxxramas", "Archmage Angela Dosantos at Light's Hope Chapel, Eastern Plaguelands.")] },
]);

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which steps the data confirms. pack: bundled quest reference; itemName(id) -> the name in the
 * player's own game files (or null). Returns the chains with `confirmed` on every step and key.
 */
function verifyChains({ pack = null, itemName = () => null, bossLoot = null } = {}) {
  const gameName = (id) => { try { return itemName(id) || null; } catch { return null; } };
  const checkItem = (it) => {
    if (!it) return null;
    const bundled = pack?.items?.[it.id]?.name, own = gameName(it.id);
    const by = same(own, it.name) ? "your game files" : same(bundled, it.name) ? "bundled item data" : null;
    // A boss the bundled loot data has seen dropping this item (Forever data, not classic memory).
    let seenFrom = null;
    for (const [instanceId, inst] of Object.entries(bossLoot?.instances || {})) for (const b of inst.bosses || [])
      if (!seenFrom && (b.items || []).some((x) => x.itemId === it.id)) seenFrom = { instanceId, boss: b.name };
    return { ...it, confirmed: Boolean(by), confirmedBy: by, seenFrom };
  };
  return CHAINS.map((c) => ({
    ...c, key: checkItem(c.key),
    steps: c.steps.map((s) => {
      if (s.type === "item") return checkItem(s);
      const found = s.ids.filter((id) => same(pack?.quests?.[id]?.title, s.title));
      return { ...s, confirmedIds: found, confirmed: found.length > 0, confirmedBy: found.length ? "bundled quest data" : null };
    }),
  }));
}

/** Everything the page shows for one character. */
function attunementView(profile, { pack = null, itemName = () => null, bossLoot = null, instanceNames = {} } = {}) {
  const side = profile?.faction === "Alliance" || profile?.faction === "Horde" ? profile.faction : null;
  const historyKnown = profile?.history?.completedIdsKnown === true;
  const done = new Set(historyKnown ? profile.history.completedIds : []);
  for (const e of profile?.history?.recent || []) done.add(e.id);
  const log = new Map((profile?.quests || []).map((x) => [x.id, x]));
  const where = (id) => {
    if ((profile?.readiness?.equipment || []).some((e) => e.itemId === id)) return "worn";
    for (const key of ["bags", "bank"]) if ((profile?.ledger?.[key]?.items || []).some((e) => e.id === id)) return key;
    return null;
  };
  const bagsKnown = Boolean(profile?.ledger?.bags), bankKnown = Boolean(profile?.ledger?.bank);
  const chains = verifyChains({ pack, itemName, bossLoot }).filter((c) => !side || !c.side || c.side === side).map((c) => {
    const keyHeld = c.key?.confirmed ? where(c.key.id) : null;
    const steps = c.steps.map((s) => {
      let state = "todo", detail = null;
      if (!s.confirmed) state = "unconfirmed";
      else if (s.type === "item") { const at = where(s.id); if (at) { state = "done"; detail = at; } }
      else {
        const finished = s.confirmedIds.filter((id) => done.has(id)).length, inLog = s.confirmedIds.map((id) => log.get(id)).find(Boolean);
        // Parts done in a row are finished with the last of them; of versions, any one counts.
        if (s.sequence ? done.has(s.confirmedIds[s.confirmedIds.length - 1]) : finished > 0) state = "done";
        else if (inLog) { state = "in-log"; detail = inLog.complete ? "ready to hand in" : null; }
        else if (finished > 0) { state = "in-progress"; detail = `${finished} of ${s.confirmedIds.length} parts finished`; }
      }
      return { type: s.type, title: s.type === "item" ? s.name : s.title, how: s.how, confirmed: s.confirmed, confirmedBy: s.confirmedBy, seenFrom: s.seenFrom || null,
        questIds: s.type === "quest" ? s.confirmedIds : [], itemId: s.type === "item" ? s.id : null, state, detail };
    });
    // Proof further along the chain settles the steps before it.
    let last = -1;
    steps.forEach((s, i) => { if (s.state === "done" || s.state === "in-log" || s.state === "in-progress") last = i; });
    if (keyHeld) last = steps.length;
    steps.forEach((s, i) => { if (i < last && (s.state === "todo" || s.state === "in-progress")) { s.state = "done"; s.detail = "a later step is saved"; } });
    if (keyHeld) steps.forEach((s) => { if (s.state !== "unconfirmed" && s.state !== "done") { s.state = "done"; s.detail = "you hold the key"; } });
    const countable = steps.filter((s) => s.state !== "unconfirmed");
    const finishedSteps = countable.filter((s) => s.state === "done").length;
    const current = steps.find((s) => s.state === "in-log" || s.state === "in-progress") || steps.find((s) => s.state === "todo") || null;
    const questSteps = countable.some((s) => s.type === "quest");
    let status;
    if (!countable.length) status = "unconfirmed";
    else if (keyHeld || finishedSteps === countable.length) status = "done";
    else if (finishedSteps > 0 || steps.some((s) => s.state === "in-log" || s.state === "in-progress")) status = "started";
    else if (questSteps && !historyKnown) status = "unknown";
    else status = "not-started";
    return { id: c.id, name: c.name, kind: c.kind, side: c.side, levels: c.levels, opens: c.opens, instanceId: c.instanceId, instance: instanceNames[c.instanceId] || c.name,
      key: c.key ? { itemId: c.key.id, name: c.key.name, confirmed: c.key.confirmed, held: keyHeld } : null,
      steps, status, finishedSteps, totalSteps: countable.length, unconfirmedSteps: steps.length - countable.length, current: status === "done" ? null : current,
      currentIndex: status === "done" || !current ? -1 : steps.indexOf(current) };
  });
  const notes = ["Taken from the classic game. WoW Forever may differ; steps the data does not hold are marked."];
  if (!profile) notes.push("Pick a character to see its progress.");
  else {
    if (!historyKnown) notes.push("Finished quests are not known for this character yet, so quest steps cannot be ticked. Log in with the addon on, then type /reload once.");
    if (!bagsKnown) notes.push("Bags are not saved for this character yet, so held keys cannot be seen.");
    else notes.push(`Keys are looked for in your saved bags${bankKnown ? " and bank" : " (the bank was not seen yet)"} and in what you wear. A key kept on the key ring is not saved; its finished quest still counts.`);
  }
  const order = { started: 0, "not-started": 1, unknown: 1, done: 2, unconfirmed: 3 };
  return { profileId: profile?.id ?? null, side, historyKnown, bagsKnown, bankKnown, referenceBuild: pack?.build ?? null, notes,
    chains: chains.map((c, i) => ({ c, i })).sort((a, b) => order[a.c.status] - order[b.c.status] || a.i - b.i).map((x) => x.c),
    counts: { done: chains.filter((c) => c.status === "done").length, started: chains.filter((c) => c.status === "started").length, total: chains.length } };
}

module.exports = { CHAINS, verifyChains, attunementView };
