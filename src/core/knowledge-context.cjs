"use strict";
const { BUILD, COMMIT } = require("./knowledge.cjs");
const safeText = (v, max = 200) =>
  typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const id = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
// Both preview and every transport use these exact public fields. No full history.
function publicFacts(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const f of value.slice(0, 3)) {
    if (
      !id(f?.questId) ||
      !safeText(f.title) ||
      !BUILD.test(f.build) ||
      !COMMIT.test(f.sourceCommit) ||
      !/^\d{4}-\d\d-\d\d$/.test(f.observedThrough) ||
      !["match"].includes(f.status)
    )
      continue;
    const row = {
      questId: f.questId,
      title: f.title,
      status: "match",
      build: f.build,
      sourceCommit: f.sourceCommit,
      observedThrough: f.observedThrough,
      sourceUrl: `https://github.com/JIVESCORP/eg-link-output-wowf/tree/${f.sourceCommit}/data/wowf/${f.build}`,
      chain: [],
      rewards: { items: [], choices: [] },
    };
    for (const kind of ["givers", "turnIns", "mentions"]) {
      row[kind] = [];
      for (const n of Array.isArray(f[kind]) ? f[kind].slice(0, 2) : []) {
        if (
          !id(n.id) ||
          !["npc", "object"].includes(n.kind) ||
          !safeText(n.name) ||
          !id(n.sources)
        )
          continue;
        const npc = {
          id: n.id,
          kind: n.kind,
          name: n.name,
          sources: n.sources,
          approximate: true,
          evidence:
            kind === "mentions"
              ? "mentioned-in-objective"
              : "observed-npc-window",
          observedThrough: /^\d{4}-\d\d-\d\d$/.test(
            n.lastSeen || n.observedThrough,
          )
            ? n.lastSeen || n.observedThrough
            : f.observedThrough,
          positions: [],
        };
        const pos = n.positions?.[0];
        if (
          pos &&
          id(pos.mapId) &&
          ["x", "y"].every(
            (k) => Number.isFinite(pos[k]) && pos[k] >= 0 && pos[k] <= 1,
          )
        )
          npc.positions.push({ mapId: pos.mapId, x: pos.x, y: pos.y });
        row[kind].push(npc);
      }
    }
    // Nodes describe a bounded graph neighborhood. Only nextQuestId proves a link.
    for (const c of Array.isArray(f.chain) ? f.chain.slice(0, 6) : [])
      if (
        id(c.id) &&
        safeText(c.title) &&
        ["active", "completed", "unknown", "missing"].includes(c.status)
      )
        row.chain.push({
          id: c.id,
          title: c.title,
          status: c.status,
          ...(id(c.nextQuestId) ? { nextQuestId: c.nextQuestId } : {}),
          ...(["match", "conflict", "reference", "missing"].includes(
            c.referenceStatus,
          )
            ? { referenceStatus: c.referenceStatus } : {}),
          ...(safeText(c.referenceTitle) ? { referenceTitle: c.referenceTitle } : {}),
        });
    const d = f.referenceDestination;
    if (
      d &&
      id(d.mapId) &&
      ["x", "y"].every(
        (k) => Number.isFinite(d[k]) && d[k] >= 0 && d[k] <= 1,
      ) &&
      safeText(d.evidence, 80)
    )
      row.referenceDestination = {
        mapId: d.mapId,
        x: d.x,
        y: d.y,
        evidence: d.evidence,
        approximate: true,
        ...(id(d.sources) ? { sources: d.sources } : {}),
        ...(safeText(d.name) ? { name: d.name } : {}),
      };
    for (const kind of ["items", "choices"])
      for (const r of Array.isArray(f.rewards?.[kind])
        ? f.rewards[kind].slice(0, 4)
        : [])
        if (id(r.itemId) && id(r.count) && safeText(r.name))
          row.rewards[kind].push({
            itemId: r.itemId,
            count: r.count,
            name: r.name,
          });
    if (
      Number.isSafeInteger(f.rewards?.moneyCopper) &&
      f.rewards.moneyCopper >= 0
    )
      row.rewards.moneyCopper = f.rewards.moneyCopper;
    out.push(row);
  }
  return out.length ? out : undefined;
}
// Literal full names only: publisher punctuation is data, never a regular expression.
function mentionsName(question, name) {
  if (!name) return false;
  const needle = name.toLowerCase();
  let start = question.indexOf(needle);
  const word = (c) => Boolean(c && /[\p{L}\p{N}_]/u.test(c));
  while (start !== -1) {
    if (!word(question[start - 1]) && !word(question[start + needle.length]))
      return true;
    start = question.indexOf(needle, start + 1);
  }
  return false;
}
function referenceFacts(profile, index, prompt = "") {
  if (!index?.compatible(profile)) return undefined;
  const q = String(prompt).slice(0, 12000).toLowerCase();
  const active = profile.quests || [];
  const current = new Map(active.map((r) => [r.id, r]));
  const requested = new Set();
  // Bare numbers in levels, money or coordinates are not quest identities.
  if (/^\s*[1-9]\d*\s*$/.test(q)) requested.add(Number(q.trim()));
  for (const match of q.matchAll(
    /(?:^|[^\p{L}\p{N}_])(?:#\s*|quest\s*(?:id\s*)?[:#]?\s*)([1-9]\d*)(?![\p{L}\p{N}_])/gu,
  ))
    requested.add(Number(match[1]));
  const relevant = [];
  for (const r of Object.values(index.pack.quests)) {
    const titleMatch =
      mentionsName(q, current.get(r.id)?.title) || mentionsName(q, r.title);
    const npcMatch = ["givers", "turnIns", "mentions"].some((kind) =>
      r[kind].some((n) => mentionsName(q, index.pack.npcs[`${n.kind}:${n.id}`]?.name)),
    );
    const rank = requested.size
      ? (requested.has(r.id) ? 3 : 0)
      : titleMatch ? 2 : npcMatch ? 1 : 0;
    if (rank) relevant.push({ ...r, rank });
  }
  for (const r of active)
    if (!index.pack.quests[r.id] && !requested.size && mentionsName(q, r.title))
      relevant.push({ ...r, rank: 2 });
  // An explicit but unavailable/conflicting reference must not fall back to unrelated quests.
  relevant.sort((a, b) =>
    b.rank - a.rank ||
    Number(current.has(b.id)) - Number(current.has(a.id)) || a.id - b.id,
  );
  const candidates = requested.size || relevant.length ? relevant : active;
  const relevantNpcs = (list) => [...list].sort((a, b) =>
    Number(mentionsName(q, b.name)) - Number(mentionsName(q, a.name)),
  );
  const rows = [];
  for (const quest of candidates) {
    const reference = index.pack.quests[quest.id];
    if (!reference || (!reference.observedInPlay && !current.has(quest.id))) continue;
    const d = index.details(profile, quest.id);
    if (d.status !== "match") continue;
    rows.push({
      questId: quest.id,
      title: current.get(quest.id)?.title || reference.title,
      status: d.status,
      ...d.provenance,
      givers: relevantNpcs(d.givers),
      turnIns: relevantNpcs(d.turnIns),
      mentions: relevantNpcs(d.mentions),
      referenceDestination: index.destination(
        profile,
        quest.id,
        current.get(quest.id)?.complete ? "t" : "o",
      ),
      chain: d.chain,
      rewards: d.rewards,
    });
    if (rows.length === 3) break;
  }
  return publicFacts(rows);
}
module.exports = { referenceFacts, publicFacts };
