"use strict";
// Quick answers: the most common questions, answered instantly from the app's own data with no AI
// model, no account and no internet. Used when no model is chosen, so every player has a useful
// companion from the first launch. Each answer says where its facts came from.

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9#]+/g, " ").trim();
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) : "?");

const QUEST = /\b(how (do|can|should|would) i( do| finish| complete| get| beat)?|how to (do|finish|complete)|help( me)? (with|on|for)|stuck (on|with)|what do i do (for|in|with|on)|where do i (go|find|get) .*(for|in) (the )?(quest )?)\b/;
const NEXT = /\b(what (should|do|can) i do( next| now)?|what now|what next|where should i (level|go|quest)|next step|what to do next|where (do|should) i level)\b/;
const TRAIN = /\b(what (can|do|should) i (learn|train)|new (spells|skills|abilities)|when do i train|class trainer|where (is|s) my trainer|go train|training)\b/;
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
  const steps = [];
  if (c.dead) steps.push("You're dead: release and run back to your body first.");
  for (const r of (log.ready || []).slice(0, 3)) steps.push(`Hand in “${r.title}”${r.turnIn ? ` to ${r.turnIn.name}${r.turnIn.mapName ? ` (${r.turnIn.mapName} ${pct(r.turnIn.x)}, ${pct(r.turnIn.y)})` : ""}` : ""}.`);
  const t = advice.training;
  if (t?.trainer && t.newNow?.length) steps.push(`Train: ${t.newNow.map((s) => s.name).join(", ")} at ${t.trainer.name}${t.trainer.mapName ? ` (${t.trainer.mapName} ${pct(t.trainer.x)}, ${pct(t.trainer.y)})` : ""}.`);
  for (const a of (log.active || []).slice(0, 2)) steps.push(`Continue “${a.title}”${a.next ? `: ${a.next}` : ""}${a.where ? ` around ${a.where.mapName} ${pct(a.where.x)}, ${pct(a.where.y)}` : ""}.`);
  const n = advice.next;
  if (n) steps.push(`Level in ${n.name} (levels ${n.min}–${n.max})${n.available ? `: ${n.available} quests for you${n.quests?.length ? `, starting with ${n.quests.slice(0, 3).map((q) => q.title).join(", ")}` : ""}` : ""}.`);
  if (!steps.length) return null;
  out.push(lines("Do these in order:", steps));
  out.push(`${c.live ? "Read live from the game." : "From your last save; turn on the live link to keep this current."} The Now page shows each step on the map.`);
  return { text: out.join("\n\n"), kind: "quick", topic: "next" };
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
function quickAnswer(question, { tools = null, advise = null, live = null } = {}) {
  const q = norm(question);
  if (!q) return null;
  try {
    if (TRAIN.test(q) && advise) { const a = trainAnswer(advise()); if (a) return a; }
    if (NEXT.test(q) && advise) { const a = nextAnswer(advise()); if (a) return a; }
    if (tools && (QUEST.test(q) || /["“”]/.test(question) || /\b(this|my|current|tracked) quest\b/.test(q))) { const a = questAnswer(question, { tools, live }); if (a) return a; }
  } catch { return null; }
  return null;
}
const QUICK_HELP = "Without an AI model I can still answer right away: “how do I do <quest name>?”, “what should I do next?”, “what do I train?”, “where is <NPC>?” and “how do I get to <place>?”. For anything else, turn on an AI model in Settings → Connections.";
module.exports = { quickAnswer, questQuery, QUICK_HELP };
