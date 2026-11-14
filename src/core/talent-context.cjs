"use strict";
// Talent questions for the AI Companion. Every fact comes from WoW Forever's own talent trees,
// read from the player's game client (game-data.cjs, never bundled). Pure: callers pass
// `source = { trees(className) -> trees|null, build() -> string|null }`.
//
// resolveTalentQuestion() decides whether a question is about talents and for which class;
// talentBlock() is the bounded context sent to an AI model; talentQuickAnswer() answers the
// common questions offline. Class-based and faction-neutral: Alliance and Horde alike.
const { coach, plan, maxPoints, BUILDS } = require("./talent-coach.cjs");

const CLASS_NAMES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const CLASS_WORDS = [
  ["Warrior", /\bwarriors?\b|\bwarr\b/],
  ["Paladin", /\bpaladins?\b|\bpall?ys?\b|\bpallies\b/],
  ["Hunter", /\bhunters?\b/],
  ["Rogue", /\brogues?\b/],
  ["Priest", /\bpriests?\b/],
  ["Shaman", /\bshamans?\b|\bshamm(?:y|ies)\b/],
  ["Mage", /\bmages?\b/],
  ["Warlock", /\bwarlocks?\b/],
  ["Druid", /\bdruids?\b/],
];
const TALENT_MAX = 12000; // characters; one class is ~3 trees x ~17 talents
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9/]+/g, " ").trim();
const has = (q, phrase) => phrase && (" " + q + " ").includes(" " + phrase + " ");

const STRONG = /\b(talents?|spec|specs|specc?ed|speccing|speciali[sz](?:e|ed|ing|ation)|respec\w*|skill tree)\b/;
const WEAK = /\b(builds?|points?|tiers?|ranks?|first \d{1,2}|\d{1,2} ?\/ ?\d{1,2}|max(?:ed|es)?|trees?)\b/;
const DESCRIBE = /\b(what (?:does|do|is|s|are)|explain|tell me about|describe|how does|is .+ (?:good|worth|any good))\b/;
const POINTS_Q = /\bhow many (?:talent )?points\b|\b(?:talent )?points (?:do|will|would|should) i (?:have|get)\b|\b(?:talent )?points (?:at|by|for) (?:level|lvl)\b/;
const RECOMMEND = /\b(?:what|which) (?:talents?|spec)\b|\btalents? (?:should|do|to|for|first)\b|\b(?:best|first \d{1,2}|next|good) (?:talents?|points?)\b|\bfirst \d{1,2}\b|\bwhere should\b|\b(?:talent|spec) build\b|\bhow (?:should|do) i spec\b|\bwhat (?:should|do) i spec\b|\b(?:recommend|suggest)\w*\b/;

const tierOf = (t) => t.row + 1;
const gateOf = (t) => t.row * 5;
const displayName = (t) => t.name || "(unnamed talent in the game data)";
const descOf = (t) => (t.descriptions || []).find((d) => typeof d === "string" && d.trim()) || null;
const maxDescOf = (t) => {
  const d = t.descriptions?.[t.maxRank - 1];
  return typeof d === "string" && d.trim() && d !== descOf(t) ? d : null;
};
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + "…" : s);

function namedClass(q) {
  let best = null;
  for (const [name, re] of CLASS_WORDS) {
    const m = re.exec(q);
    if (m && (!best || m.index < best.index)) best = { name, index: m.index };
  }
  return best?.name || null;
}
function levelIn(q) {
  const m = /\b(?:level|lvl|lv|at) ?(\d{1,3})\b/.exec(q);
  const n = m ? Number(m[1]) : null;
  return n >= 1 && n <= 100 ? n : null;
}
function safeTrees(source, className) {
  try { const t = source?.trees?.(className); return t?.tabs?.length ? t : null; } catch { return null; }
}
function safeBuild(source) {
  try { const b = typeof source?.build === "function" ? source.build() : source?.build; return typeof b === "string" && b ? b : null; } catch { return null; }
}

// Every named talent across the classes whose trees the game client gave us.
function talentIndex(source) {
  const out = [];
  for (const className of CLASS_NAMES) {
    const trees = safeTrees(source, className);
    for (const tab of trees?.tabs || []) for (const t of tab.talents || []) if (t.name) out.push({ className, tab: tab.name, talent: t, key: norm(t.name) });
  }
  return out;
}
// Full talent names written in the question, longest first, without overlaps.
function mentionedTalents(q, index) {
  const hits = index.filter((e) => e.key.length >= 4 && has(q, e.key)).sort((a, b) => b.key.length - a.key.length);
  const keys = [];
  const kept = hits.filter((e) => {
    if (keys.some((k) => k !== e.key && k.includes(e.key))) return false;
    if (!keys.includes(e.key)) keys.push(e.key);
    return true;
  });
  // Question order, so answers follow what the player wrote.
  return kept.sort((a, b) => (" " + q + " ").indexOf(" " + a.key + " ") - (" " + q + " ").indexOf(" " + b.key + " "));
}
function levenshtein(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return d[b.length];
}
// "what does <x> do": the phrase between the question words, matched loosely (typos, missing words).
function fuzzyTalents(q, index, className) {
  const m = /\b(?:what (?:does|do|is|s)|explain|tell me about|describe|how does|is)\s+(?:the\s+)?(?:talent\s+)?(.+?)(?:\s+talent)?(?:\s+(?:do|does|work|mean|good|worth|any good|for me))*\s*$/.exec(q);
  const phrase = m?.[1]?.replace(/\b(?:the|a|an|my)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!phrase || phrase.length < 4) return [];
  const scored = index.map((e) => {
    const dist = levenshtein(phrase, e.key), ratio = 1 - dist / Math.max(phrase.length, e.key.length);
    const prefix = e.key.startsWith(phrase) || phrase.startsWith(e.key);
    return { e, score: prefix ? Math.max(ratio, 0.85) : ratio };
  }).filter((x) => x.score >= 0.75);
  scored.sort((a, b) => b.score - a.score || Number(b.e.className === className) - Number(a.e.className === className));
  const top = scored[0]?.score;
  return scored.filter((x) => x.score === top).map((x) => x.e);
}
function namedTabs(q, source) {
  const out = [];
  for (const className of CLASS_NAMES) for (const tab of safeTrees(source, className)?.tabs || []) if (tab.name && has(q, norm(tab.name))) out.push({ className, tab: tab.name });
  return out;
}
function intentOf(q, { talents, tabs }) {
  if (POINTS_Q.test(q) || STRONG.test(q)) return "strong";
  if (talents.length && DESCRIBE.test(q)) return "strong";
  if (talents.length || tabs.length || WEAK.test(q)) return "weak";
  return null;
}

/**
 * -> null (not about talents) | { status: "ask" | "points" | "unavailable" | "ok", ... }
 * Class: a class named in the question, else the shared active character's class, else (clear
 * talent questions only) the one class whose tree or talent the question names. Without one, ask.
 */
function resolveTalentQuestion(question, { profile = null, shareProfile = false, source = null, previousQuestion = null } = {}) {
  const q = norm(question).slice(0, 2000);
  if (!q) return null;
  // Spotting talent names needs every class's trees: only when they're ready without reading the
  // game (or the question clearly is about talents), so unrelated questions never wait on extraction.
  const hinted = STRONG.test(q) || WEAK.test(q) || DESCRIBE.test(q) || (previousQuestion ? STRONG.test(norm(previousQuestion)) : false);
  const index = hinted || typeof source?.ready !== "function" || source.ready() ? talentIndex(source) : [];
  let talents = mentionedTalents(q, index), tabs = namedTabs(q, source);
  let intent = intentOf(q, { talents, tabs });
  if (!talents.length && DESCRIBE.test(q)) {
    const fuzzy = fuzzyTalents(q, index, null);
    if (fuzzy.length && (intent || /\b(?:what (?:does|do)|how does)\b/.test(q))) { talents = fuzzy; intent = "strong"; }
  }
  // A follow-up ("so in those where should the first 7 go") keeps the talent topic of the question before.
  const pq = previousQuestion ? norm(previousQuestion).slice(0, 2000) : "";
  const prev = pq ? { talents: mentionedTalents(pq, index), tabs: namedTabs(pq, source) } : null;
  const prevIntent = prev ? intentOf(pq, prev) : null;
  if (!intent && prevIntent && (prevIntent === "strong" || prev.talents.length || prev.tabs.length) && /\b(?:those|these|them|it|that|first \d{1,2}|which|where|order|instead|next|go|put)\b/.test(q)) intent = "weak";
  if (!intent) return null;
  const shared = shareProfile && CLASS_NAMES.includes(profile?.className) ? profile : null;
  let className = namedClass(q), classFrom = className ? "question" : null;
  if (!className && shared) { className = shared.className; classFrom = "character"; }
  // "first 12 arms talents" on a priest: a tree only another class has names that class.
  if (classFrom === "character" && tabs.length && !tabs.some((t) => t.className === className)) {
    const owners = new Set(tabs.map((t) => t.className));
    if (owners.size === 1) { className = [...owners][0]; classFrom = "tree"; }
  }
  if (!className && intent === "strong") {
    const owners = new Set([...tabs.map((t) => t.className), ...talents.map((t) => t.className)]);
    if (owners.size === 1) { className = [...owners][0]; classFrom = "talent"; }
  }
  if (!className && prevIntent) { className = namedClass(pq); classFrom = className ? "question" : null; }
  const level = levelIn(q) || (shared && Number.isInteger(shared.level) && shared.level >= 1 && shared.level <= 100 ? shared.level : null);
  const levelFrom = levelIn(q) ? "question" : level ? "character" : null;
  const firstN = /\bfirst (\d{1,2})\b/.exec(q);
  const asked = { points: POINTS_Q.test(q), describe: DESCRIBE.test(q) && talents.length > 0, recommend: RECOMMEND.test(q), firstN: firstN ? Math.min(51, Number(firstN[1])) : null };
  if (!className) {
    if (asked.points) return { status: "points", intent, level, levelFrom, asked };
    if (asked.describe && talents.length) return { status: "ok", intent, className: null, trees: null, talents, tabName: null, level, levelFrom, asked, build: safeBuild(source) };
    if (intent !== "strong") return null;
    return { status: "ask", intent, asked, text: "Which class are these talents for? Name it in your question (for example “Holy priest talents at level 16” or “warrior talents”), or turn on “Use my active character” so I can use your character's class. I answer talent questions only from WoW Forever's own talent trees." };
  }
  const trees = safeTrees(source, className);
  if (!trees) return { status: "unavailable", intent, className, classFrom, level, levelFrom, asked, text: `I can't read the ${className} talent trees from your game yet. Connect your WoW Forever folder in Settings and open the Talents page once; I only answer talent questions from the game's own talent data, never from other versions of WoW.` };
  const own = (list) => list.filter((x) => x.className === className);
  let tabName = own(tabs)[0]?.tab || null;
  const mine = own(talents).length ? own(talents) : talents;
  if (!tabName) { const t = new Set(own(talents).map((x) => x.tab)); if (t.size === 1) tabName = [...t][0]; }
  if (!tabName && prev) { tabName = own(prev.tabs)[0]?.tab || null; if (!tabName) { const t = new Set(own(prev.talents).map((x) => x.tab)); if (t.size === 1) tabName = [...t][0]; } }
  if (prev && !firstN) { const pf = /\bfirst (\d{1,2})\b/.exec(pq); if (pf && /\b(?:those|these|them|where|order|go|put)\b/.test(q)) asked.firstN = Math.min(51, Number(pf[1])); }
  return { status: "ok", intent, className, classFrom, trees, tabName, talents: mine, level, levelFrom, asked, build: safeBuild(source) };
}

// "Twilight Focus 2/2 (Holy tier 1)" runs from a list of single plan points.
function groupPoints(points) {
  const out = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last.talentId === p.talentId) { last.to = p.rank; continue; }
    out.push({ talentId: p.talentId, name: p.name, tab: p.tab, row: p.row, from: p.rank, to: p.rank, maxRank: p.maxRank });
  }
  return out.map((g) => `${g.name} ${g.from === g.to ? g.to : `${g.from}-${g.to}`}/${g.maxRank} (${g.tab} tier ${g.row + 1})`);
}
function prereqText(t, byId) {
  return (t.prerequisites || []).map((p) => { const r = byId.get(p.talentId); return `${r ? displayName(r) : `talent ${p.talentId}`} ${p.rank || 1}/${r?.maxRank ?? "?"}`; }).join(", ");
}
function tierLine(points) {
  if (!Number.isInteger(points) || points <= 0) return "";
  const open = Math.min(7, Math.floor((points - 1) / 5) + 1);
  return `with ${points} point${points === 1 ? "" : "s"} all in one tree, tiers 1-${open} can be reached` + (open > 1 ? ` (tier ${open} from point ${(open - 1) * 5 + 1})` : " (tier 2 needs 5 points spent first)");
}

/** Bounded text for the AI request. */
function talentBlock(res, { maxChars = TALENT_MAX } = {}) {
  if (!res) return "";
  const rules = "Answer talent questions only from this data. If a talent, rank or value is not in it, say WoW Forever's game data doesn't show it. Never use retail, Classic, Season of Discovery or any other version's talent knowledge, and never invent talents, ranks or numbers.";
  if (res.status === "unavailable") return `WoW Forever talent data for ${res.className} is not available from the player's game client right now. Tell the player you can't check WoW Forever's talents yet and suggest connecting the game folder in Settings, then the Talents page. ${rules}`;
  if (res.status !== "ok" || !res.trees) return "";
  const { className, trees, level, tabName } = res;
  const points = level ? maxPoints(level) : null;
  const byId = new Map(trees.tabs.flatMap((t) => t.talents.map((x) => [x.id, x])));
  const head = [
    `WoW Forever talents for ${className} (read from the player's own game client${res.build ? `, build ${res.build}` : ""}). These are WoW Forever's actual talent trees. ${rules}`,
    "Rules: one talent point per level from level 10 (51 at level 60). Tier N of a tree opens once (N-1)*5 points are spent in that tree (tier 1: 0, tier 2: 5, tier 3: 10 ...). A talent can't go above its max rank; prerequisites must be complete. Descriptions are exactly as given in the game data (values may be for one rank, some are blank or odd); never compute per-rank or total values from them.",
  ];
  if (level) head.push(`Character: level ${level} (${res.levelFrom === "question" ? "from the question" : "the player's character"}), ${points} talent point${points === 1 ? "" : "s"} available${points ? "; " + tierLine(points) : " (the first point comes at level 10)"}.`);
  if (res.asked?.firstN) head.push(`The player asks about the first ${res.asked.firstN} points: ${tierLine(res.asked.firstN)}.`);
  if (tabName) head.push(`The question is about the ${tabName} tree.`);
  const render = ({ descMax, otherDesc, planMax }) => {
    const lines = [...head];
    const tabs = [...trees.tabs].sort((a, b) => Number(b.name === tabName) - Number(a.name === tabName) || (a.order ?? 0) - (b.order ?? 0));
    for (const tab of tabs) {
      const focus = !tabName || tab.name === tabName;
      lines.push(`${tab.name} tree:`);
      const tiers = new Map();
      for (const t of tab.talents || []) { if (!tiers.has(t.row)) tiers.set(t.row, []); tiers.get(t.row).push(t); }
      for (const [row, list] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(` Tier ${row + 1} (needs ${row * 5} points in ${tab.name}):`);
        for (const t of list.sort((a, b) => a.column - b.column)) {
          const n = focus ? descMax : otherDesc;
          const d = descOf(t), dm = maxDescOf(t), pre = prereqText(t, byId);
          let line = `  - ${displayName(t)} (max rank ${t.maxRank}${pre ? `; requires ${pre}` : ""})`;
          if (n > 0) line += d ? `: ${clip(d, n)}` : ": no description in the game data";
          if (n > 0 && dm) line += ` | rank ${t.maxRank} text: ${clip(dm, n)}`;
          lines.push(line);
        }
      }
    }
    const c = coach(trees, className, level || 60);
    if (c && planMax > 0) {
      lines.push(`Backstage Coding's own solo leveling path for ${className} (advice, not game data; placed on these trees): ${c.tree}. ${c.why}`);
      if (level) {
        if (c.spentByNow.length) lines.push(`By level ${level}: ${groupPoints(c.spentByNow).join(", ")}.`);
        if (c.next.length) lines.push(`Next points: ${groupPoints(c.next).join(", ")}.`);
      } else lines.push(`Order: ${groupPoints(c.order.slice(0, planMax)).join(", ")}.`);
      if (tabName && tabName !== c.tree) lines.push(`This path is for ${c.tree}; it has no order for ${tabName}, so for ${tabName} only list legal options from the tree above.`);
    }
    return lines.join("\n");
  };
  const steps = [
    { descMax: 240, otherDesc: 240, planMax: 51 }, { descMax: 240, otherDesc: 120, planMax: 30 }, { descMax: 160, otherDesc: 80, planMax: 20 },
    { descMax: 120, otherDesc: 0, planMax: 15 }, { descMax: 80, otherDesc: 0, planMax: 10 }, { descMax: 0, otherDesc: 0, planMax: 10 }, { descMax: 0, otherDesc: 0, planMax: 0 },
  ];
  let text = "";
  for (const s of steps) { text = render(s); if (text.length <= maxChars) return text; }
  const cut = text.slice(0, Math.max(0, maxChars - 40)); // last resort: whole lines only
  return cut.slice(0, cut.lastIndexOf("\n")) + "\n(talent list shortened)";
}

const cite = (res) => `From WoW Forever's talent data in your game client${res.build ? ` (build ${res.build})` : ""}.`;
function pointsAnswer(res) {
  const level = res.level;
  if (!level) return { text: "You get one talent point per level from level 10: level N gives N − 9 points, up to 51 at level 60. Tell me your level (or turn on “Use my active character”) for your exact number.\n\nTalent rules as used by the Talents page.", kind: "quick", topic: "talent-points" };
  const p = maxPoints(level);
  const tail = level < 10 ? "Your first talent point comes at level 10." : level < 60 ? `Your next point comes at level ${level + 1}.` : "That's the maximum.";
  return { text: `**${p} talent point${p === 1 ? "" : "s"} at level ${level}**\n\nOne point per level from level 10 (51 at level 60). ${tail}${p ? ` ${tierLine(p).replace(/^w/, "W")}.` : ""}\n\nTalent rules as used by the Talents page with your game's talent trees.`, kind: "quick", topic: "talent-points" };
}
function describeAnswer(res) {
  // One class's talents read as a short list; a name shared by several classes shows each.
  const many = res.talents.length > 3;
  const list = res.talents.slice(0, many ? 8 : 3);
  const out = [];
  if (many) {
    out.push(list.map((e) => { const t = e.talent, d = descOf(t); return `• **${displayName(t)}** (${e.className} ${e.tab}, tier ${tierOf(t)}, max ${t.maxRank})${d ? `: ${clip(d, 140)}` : ": no description in the game data"}`; }).join("\n"));
    if (res.talents.length > 8) out.push(`And ${res.talents.length - 8} more.`);
    out.push(`${cite(res)} Descriptions are exactly as the game gives them (values may be for one rank).`);
    return { text: out.join("\n\n"), kind: "quick", topic: "talent" };
  }
  for (const e of list) {
    const t = e.talent, trees = res.trees && res.className === e.className ? res.trees : null;
    const byId = new Map((trees?.tabs || []).flatMap((x) => x.talents.map((y) => [y.id, y])));
    const pre = trees ? prereqText(t, byId) : "";
    const d = descOf(t), dm = maxDescOf(t);
    out.push(`**${displayName(t)}**: ${e.className}, ${e.tab} tree, tier ${tierOf(t)} (needs ${gateOf(t)} points in ${e.tab}), max rank ${t.maxRank}${pre ? `, requires ${pre}` : ""}.\n${d ? `“${d}”` : "The game data has no description for it."}${dm ? `\nAt rank ${t.maxRank}: “${dm}”` : ""}`);
  }
  out.push(`${cite(res)} Descriptions are exactly as the game gives them (values may be for one rank).`);
  return { text: out.join("\n\n"), kind: "quick", topic: "talent" };
}
// Legal options for the first N points in a tree that has no Backstage path: tiers and max ranks only.
function treeOptionsAnswer(res, n) {
  const tab = res.trees.tabs.find((t) => t.name === res.tabName);
  const out = [`**First ${n} point${n === 1 ? "" : "s"} in ${tab.name} (${res.className})**${res.level ? `: at level ${res.level} you have ${maxPoints(res.level)}.` : ""}`];
  const open = Math.min(7, Math.floor((n - 1) / 5) + 1);
  const byId = new Map(tab.talents.map((x) => [x.id, x]));
  for (let tier = 1; tier <= open; tier++) {
    const from = (tier - 1) * 5 + 1;
    const list = tab.talents.filter((t) => t.row === tier - 1 && t.name).sort((a, b) => a.column - b.column);
    if (!list.length) continue;
    const upTo = tier < open ? from + 4 : n;
    const span = upTo > from ? `Points ${from}-${upTo}` : `Point ${from}`;
    const head = tier === 1 ? (open === 1 ? `All ${n} point${n === 1 ? "" : "s"} go in tier 1:` : `Points 1-5 can only go in tier 1:`) : `${span} can also go in tier ${tier} (it opens after ${(tier - 1) * 5} points in ${tab.name}):`;
    out.push(head + "\n" + list.map((t) => { const d = descOf(t), pre = prereqText(t, byId); return `• ${t.name} (max ${t.maxRank}${pre ? `; requires ${pre}` : ""})${d ? `: ${clip(d, 140)}` : ""}`; }).join("\n"));
  }
  const tier1 = tab.talents.filter((t) => t.row === 0 && t.name).reduce((s, t) => s + t.maxRank, 0);
  if (n > 5 && tier1) out.push(`Tier 1 holds ${tier1} ranks in total, so your first 5 points always fit there.`);
  const build = BUILDS[res.className];
  out.push(build && build.tree !== tab.name ? `Backstage's own leveling path for ${res.className} is ${build.tree}; it has no set order for ${tab.name}, so choose from the options above. Ask with an AI model on for a recommendation.` : "");
  out.push(cite(res));
  return { text: out.filter(Boolean).join("\n\n"), kind: "quick", topic: "talent-tree" };
}
function coachAnswer(res, n) {
  const c = coach(res.trees, res.className, res.level || 60);
  if (!c) return null;
  const out = [`**${res.className} talents${res.level ? ` at level ${res.level}` : ""}**: Backstage path ${c.tree}. ${c.why}`];
  if (n) out.push(`First ${n} points:\n${groupPoints(c.order.slice(0, n)).map((s) => `• ${s}`).join("\n")}`);
  else if (res.level) {
    out.push(`You have ${c.points} point${c.points === 1 ? "" : "s"} at level ${res.level}${c.points ? "" : " (the first comes at level 10)"}.`);
    if (c.spentByNow.length) out.push(`By now:\n${groupPoints(c.spentByNow).map((s) => `• ${s}`).join("\n")}`);
    if (c.next.length) out.push(`Next:\n${groupPoints(c.next).map((s) => `• ${s}`).join("\n")}`);
  } else out.push(`First 10 points:\n${groupPoints(c.order.slice(0, 10)).map((s) => `• ${s}`).join("\n")}\nTell me your level for the exact next picks.`);
  if (c.missing.length) out.push(`These path talents don't exist in your game's trees and were skipped: ${c.missing.slice(0, 6).join(", ")}.`);
  out.push(`${cite(res)} The order is Backstage Coding's own advice; the Talents page shows the full plan.`);
  return { text: out.join("\n\n"), kind: "quick", topic: "talent-plan" };
}
function overviewAnswer(res) {
  const lines = res.trees.tabs.map((t) => `• ${t.name}: ${t.talents.filter((x) => x.name).length} talents, top tier ${Math.max(...t.talents.map(tierOf))}`);
  const a = coachAnswer(res, null);
  return { text: `**${res.className} talent trees**\n${lines.join("\n")}\n\n${a ? a.text : cite(res)}`, kind: "quick", topic: "talent-plan" };
}

/** Offline answer for a resolved talent question, or null. */
function talentQuickAnswer(res) {
  if (!res) return null;
  if (res.status === "ask" || res.status === "unavailable") return { text: res.text, kind: "quick", topic: res.status === "ask" ? "talent-class" : "talent-unavailable" };
  if (res.status === "points") return pointsAnswer(res);
  if (res.status !== "ok") return null;
  if (res.asked.points) return pointsAnswer(res);
  if (res.asked.describe && res.talents.length) return describeAnswer(res);
  if (!res.trees) return null;
  const n = res.asked.firstN;
  const build = BUILDS[res.className];
  if (res.tabName && (!build || build.tree !== res.tabName) && (res.asked.recommend || n)) return treeOptionsAnswer(res, n || Math.max(1, maxPoints(res.level || 0)) || 5);
  if (res.asked.recommend || n) return coachAnswer(res, n);
  if (res.talents.length) return describeAnswer(res);
  return res.intent === "strong" ? overviewAnswer(res) : null;
}

module.exports = { resolveTalentQuestion, talentBlock, talentQuickAnswer, talentIndex, namedClass, TALENT_MAX, CLASS_NAMES };
