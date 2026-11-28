"use strict";
// Quick answers: the most common questions, answered instantly from the app's own data with no AI
// model, no account and no internet. Used when no model is chosen, so every player has a useful
// companion from the first launch. Each answer says where its facts came from.

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9#]+/g, " ").trim();
const { talentQuickAnswer } = require("./talent-context.cjs");
const { recommendSteps } = require("./next-step.cjs");
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) : "?");

const QUEST = /\b(how (do|can|should|would) i( do| finish| complete| get| beat)?|how to (do|finish|complete)|help( me)? (with|on|for)|stuck (on|with)|what do i do (for|in|with|on)|where do i (go|find|get) .*(for|in) (the )?(quest )?)\b/;
const NEXT = /\b(what (should|do|can) i do( next| now)?|what now|what next|where should i (level|go|quest)|next step|what to do next|where (do|should) i level)\b/;
const isNextQuestion = (question) => /^(?:what (?:(?:quest|quests) )?should i do (?:next|now)|what next|what now|where should i (?:level|quest)(?: next)?)(?: in wow forever)?$/.test(norm(question));
const TRAIN = /\b(what (can|do|should) i (learn|train)|new (spells|skills|abilities)|when do i train|class trainer|where (is|s) my trainer|go train|training)\b/;
const TONIGHT = /\b(tonight|this evening|plan (my|a|the|this) (session|night|evening|evening s play)|what should i play|who should i play|which (character|alt|toon) (should i|to) play|plan my play)\b/;
// Words that are question scaffolding, not part of a quest title.
const FILLER = new Set("how do can should would i to finish complete get beat help me with on for stuck what in where go find the quest quests this that my a an do please".split(" "));

function questQuery(text) {
  const quoted = /["“”]([^"“”]{3,80})["“”]/.exec(text);
  if (quoted) return quoted[1];
  return norm(text).split(" ").filter((w) => !FILLER.has(w)).join(" ");
}
function lines(title, items) { return items.length ? `${title}\n${items.map((t) => `• ${t}`).join("\n")}` : ""; }

function questAnswer(question, { tools, live }) {
  const q = norm(question);
  const thisQuest = /\b(this|my|current|tracked) quest\b/.test(q);
  let id = null, title = null;
  if (thisQuest && live?.quest?.id) id = live.quest.id;
  const query = questQuery(question);
  if (!id && query.length >= 3) {
    const found = tools.lookup("search_quests", { query });
    const rows = found?.quests || [];
    // Prefer a quest in the player's log, then an exact title, then the best match.
    const exact = rows.find((r) => norm(r.title) === norm(query));
    const pick = rows.find((r) => r.inPlayersQuestLog && (norm(r.title).includes(norm(query)) || norm(query).includes(norm(r.title)))) || exact || (rows.length === 1 ? rows[0] : null) || rows.find((r) => r.inPlayersQuestLog);
    if (pick) { id = pick.id; title = pick.title; }
    else if (rows.length > 1) return { text: `I found several quests matching “${query}”:\n${rows.slice(0, 5).map((r) => `• ${r.title} (level ${r.questLevel ?? "?"})`).join("\n")}\nAsk again with the exact title, for example: how do I do “${rows[0].title}”?`, kind: "quick", topic: "quest-choices" };
  }
  if (!id) return null;
  const d = tools.lookup("get_quest", { quest_id: id });
  if (!d || d.status === "not-found" || d.status === "invalid" || d.status === "unavailable") return null;
  title = d.title || title || `Quest ${id}`;
  const out = [`**${title}**${d.questLevel ? ` (level ${d.questLevel})` : ""}`];
  if (d.playerProgress?.readyToTurnIn) out.push(`It's complete: ${d.playerProgress.nextStep || "hand it in to the quest giver."}`);
  const how = d.howToDoIt || [];
  if (how.length) out.push(lines("How to do it:", how));
  else if (d.objectiveText) out.push(`Objective: ${d.objectiveText}`);
  if (d.questSays?.length) out.push(`The quest says: “${d.questSays.join(" ")}”`);
  const giver = d.givers?.[0], loc = giver?.locations?.[0];
  if (!d.playerProgress?.inQuestLog && giver) out.push(`Pick it up from ${giver.name}${loc ? ` in ${loc.zone || "the zone"} around ${loc.x ?? "?"}, ${loc.y ?? "?"}` : ""}.`);
  if (d.howToBasis?.length) out.push(`Based on ${d.howToBasis.join(", ")}.`);
  out.push("Open it on the Quests page for the map, rewards and the best pick for your class.");
  return { text: out.filter(Boolean).join("\n\n"), kind: "quick", topic: "quest", questId: id };
}

function nextAnswer(advice) {
  if (!advice || advice.status !== "ok") return null;
  const c = advice.character, log = advice.log || {}, out = [`**Next for ${c.name}** (level ${c.level}${c.className ? ` ${c.className}` : ""})`];
  const steps = recommendSteps(advice).filter(step => step.kind !== "zone").slice(0, 3).map(step => {
    const point = step.where && step.kind !== "turnin" ? ` · ${step.where.mapName || "Map " + step.where.mapId} ${pct(step.where.x)}, ${pct(step.where.y)}` : "";
    return `${step.title} · ${step.detail}${point}`;
  });
  const n = advice.next;
  if (n && !c.dead) steps.push(`Level in ${n.name} (levels ${n.min}–${n.max})${n.available ? `: ${n.available} quests for you${n.quests?.length ? `, starting with ${n.quests.slice(0, 3).map((q) => q.title).join(", ")}` : ""}` : ""}.`);
  if (!steps.length) return null;
  out.push(lines("Suggested next steps", steps));
  out.push(`${c.live ? "Live position" : "Saved position when available"} · ${log.live ? "Live quest log" : log.known === false ? "Quest log unavailable" : "Last saved quest log"}. Open Now for destination evidence and maps.`);
  return { text: out.join("\n\n"), kind: "quick", topic: "next" };
}

// 1.4 (J16): "I have 90 minutes", "an hour", "2 hours", "half an hour" -> minutes (10 to 600).
function minutesIn(q) {
  const s = String(q || "").toLowerCase();
  let m = s.match(/\b(\d{1,3}(?:\.\d)?)\s*(?:hours?|hrs?|h)\b/);
  if (m) return Math.min(600, Math.max(10, Math.round(Number(m[1]) * 60)));
  m = s.match(/\b(\d{1,3})\s*(?:minutes?|mins?|m)\b/);
  if (m) return Math.min(600, Math.max(10, Number(m[1])));
  if (/\bhalf an hour\b/.test(s)) return 30;
  if (/\ban hour and a half\b/.test(s)) return 90;
  if (/\b(?:an|one) hour\b/.test(s)) return 60;
  if (/\bcouple (?:of )?hours\b/.test(s)) return 120;
  return null;
}
// Rough minutes per kind of step, for fitting a plan into the time you have.
const COST = { bags: 5, next: 10, train: 5, zone: 6, dungeon: 60, gear: 2 };
function budgeted(plan, minutes) {
  const c = plan.character, out = [];
  let left = minutes;
  const take = (min, text) => { if (min <= left) { out.push(`${text} (about ${min} min)`); left -= min; return true; } return false; };
  if (c.freeBagSlots !== null && c.freeBagSlots <= 3) take(COST.bags, `Empty your bags: only ${c.freeBagSlots} free slot${c.freeBagSlots === 1 ? "" : "s"}`);
  if (plan.gear?.upgradesInBags?.length) take(COST.gear, `Put on ${plan.gear.upgradesInBags.map((u) => u.item).filter(Boolean).join(", ")}`);
  if (plan.nextStep) take(COST.next, `${plan.nextStep.what}${plan.nextStep.detail ? `: ${plan.nextStep.detail}` : ""}${plan.nextStep.direction ? ` (${plan.nextStep.direction})` : ""}`);
  const d = plan.dungeonsForYou?.[0];
  if (d && left >= COST.dungeon + 10) take(COST.dungeon, `With a group: ${d.name} (levels ${d.levels})`);
  if (plan.zoneToClear && left >= COST.zone * 2) {
    const n = Math.min(plan.zoneToClear.left, Math.floor(left / COST.zone));
    take(n * COST.zone, `Quest in ${plan.zoneToClear.name}: about ${n} of the ${plan.zoneToClear.left} quests left there`);
  }
  return { steps: out, left };
}
// 0.47 (4.4): "what should I do tonight?" from the same plan the companion's plan_tonight tool returns.
function tonightAnswer(plan, { minutes = null } = {}) {
  if (!plan || plan.status !== "ok" || !plan.character) return null;
  const c = plan.character, steps = [];
  if (minutes) {
    const b = budgeted(plan, minutes);
    if (b.steps.length) {
      const pace = plan.session?.levelsPerHour;
      const out = [`**${minutes} minutes for ${c.name}** (level ${c.level}${c.restedPercent ? `, ${c.restedPercent}% of a level rested` : ""})`, lines("In this order:", b.steps)];
      if (pace > 0) out.push(`At this session's pace (${pace} levels an hour) that's about ${Math.round(pace * minutes / 6) / 10} level${Math.round(pace * minutes / 6) / 10 === 1 ? "" : "s"}.`);
      if (b.left >= 10) out.push(`About ${b.left} minutes spare: pick up whatever the Now page shows next.`);
      out.push("Times are rough guesses; the Now page keeps the next step current.");
      return { text: out.join("\n\n"), kind: "quick", topic: "tonight" };
    }
  }
  const head = `**Tonight for ${c.name}** (level ${c.level}${c.levelPercent !== null ? `, ${c.levelPercent}% through` : ""}${c.restedPercent ? `, ${c.restedPercent}% of a level rested` : ""})`;
  if (c.freeBagSlots !== null && c.freeBagSlots <= 3) steps.push(`Empty your bags first: only ${c.freeBagSlots} free slot${c.freeBagSlots === 1 ? "" : "s"} (Sell junk at any vendor).`);
  if (plan.nextStep) steps.push(`${plan.nextStep.what}${plan.nextStep.detail ? `: ${plan.nextStep.detail}` : ""}${plan.nextStep.direction ? ` (${plan.nextStep.direction})` : ""}.`);
  if (plan.zoneToClear) steps.push(`Then clear ${plan.zoneToClear.name}: ${plan.zoneToClear.left} quests left there at your level.`);
  const d = plan.dungeonsForYou?.[0];
  if (d) steps.push(`If you find a group: ${d.name} (levels ${d.levels}, ${d.difficulty === "right" ? "right for your level" : "easy for you"})${d.pickUpFirst?.length ? `; pick up ${d.pickUpFirst.slice(0, 2).join(" and ")} first` : ""}.`);
  if (plan.gear?.upgradesInBags?.length) steps.push(`Put on the upgrade${plan.gear.upgradesInBags.length > 1 ? "s" : ""} you already carry: ${plan.gear.upgradesInBags.map((u) => u.item).filter(Boolean).join(", ")}.`);
  else if (plan.gear?.emptySlots?.length) steps.push(`Fill your empty gear slots: ${plan.gear.emptySlots.join(", ")}.`);
  if (!steps.length) return null;
  const out = [head, lines("Do these in order:", steps)];
  if (c.restedFull) out.push("Your rested XP is full: kills give double experience until it runs out, so tonight is a good night to play this character.");
  if (plan.otherCharacters?.length) out.push(lines("Your other characters:", plan.otherCharacters.slice(0, 2).map((o) => `${o.name}: ${o.reasons.join("; ")}.`)));
  out.push("From the Now, Zones, Sheet and All characters pages.");
  return { text: out.join("\n\n"), kind: "quick", topic: "tonight" };
}

function trainAnswer(advice) {
  const t = advice?.training;
  if (!t) return null;
  if (!t.trainer) return { text: `No ${t.className} trainer is recorded for your faction yet.`, kind: "quick", topic: "train" };
  const where = t.trainer.mapName ? `${t.trainer.mapName} around ${pct(t.trainer.x)}, ${pct(t.trainer.y)}` : "location unknown";
  const out = [`**${t.className} training**`, `Nearest trainer: ${t.trainer.name}, ${where}.`];
  out.push(t.newNow.length ? `Ready to learn now: ${t.newNow.map((s) => s.name + (s.rank ? ` (${s.rank})` : "")).join(", ")}.` : `Nothing new at level ${advice.character.level}.`);
  if (t.nextAt) out.push(`Next spells at level ${t.nextAt}: ${t.nextSpells.slice(0, 6).map((s) => s.name).join(", ")}.`);
  out.push("Training costs a little money; drag new abilities onto your action bar.");
  return { text: out.join("\n\n"), kind: "quick", topic: "train" };
}

/** Returns { text, kind: "quick", topic } or null when the question isn't one we can answer locally. */
function quickAnswer(question, { tools = null, advise = null, live = null, talent = null } = {}) {
  const q = norm(question);
  if (!q) return null;
  try {
    // Talents first: resolved by talent-context.cjs from the game client's own talent trees.
    if (talent) { const a = talentQuickAnswer(talent); if (a) return a; }
    const minutes = minutesIn(q);
    if ((TONIGHT.test(q) || (minutes && /\b(i have|i've got|ive got|got|only have|plan|what (?:can|should) i do)\b/.test(q))) && tools) { const a = tonightAnswer(tools.lookup("plan_tonight", {}), { minutes }); if (a) return a; }
    if (TRAIN.test(q) && advise) { const a = trainAnswer(advise()); if (a) return a; }
    if ((isNextQuestion(question) || NEXT.test(q)) && advise) { const a = nextAnswer(advise()); if (a) return a; }
    if (tools && (QUEST.test(q) || /["“”]/.test(question) || /\b(this|my|current|tracked) quest\b/.test(q))) { const a = questAnswer(question, { tools, live }); if (a) return a; }
  } catch { return null; }
  return null;
}
const QUICK_HELP = "Without an AI model I can still answer right away: “how do I do <quest name>?”, “what should I do next?”, “what should I do tonight?”, “what do I train?”, “what does <talent> do?”, “what talents should I take?”, “how many talent points at level 20?”, “where is <NPC>?” and “how do I get to <place>?”. For anything else, turn on an AI model in Settings → Connections.";
module.exports = { quickAnswer, isNextQuestion, questQuery, tonightAnswer, QUICK_HELP, minutesIn };
