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
    for (const c of Array.isArray(f.chain) ? f.chain.slice(0, 6) : [])
      if (
        id(c.id) &&
        safeText(c.title) &&
        ["active", "completed", "unknown", "missing"].includes(c.status)
      )
        row.chain.push({ id: c.id, title: c.title, status: c.status });
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
function referenceFacts(profile, index, prompt = "") {
  if (!index?.compatible(profile)) return undefined;
  const q = String(prompt).slice(0, 12000).toLowerCase();
  const active = profile.quests || [];
  const activeIds = new Set(active.map((r) => r.id));
  const relevant = Object.values(index.pack.quests)
    .filter(
      (r) =>
        (r.observedInPlay || activeIds.has(r.id)) &&
        (new RegExp(`(?:^|\\D)${r.id}(?:$|\\D)`).test(q) ||
          q.includes(r.title.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(activeIds.has(b.id)) - Number(activeIds.has(a.id)) ||
        a.id - b.id,
    );
  const rows = (relevant.length ? relevant : active)
    .slice(0, 3)
    .map((quest) => {
      const d = index.details(profile, quest.id);
      if (d.status !== "match") return null;
      return {
        questId: quest.id,
        title: quest.title,
        status: d.status,
        ...d.provenance,
        givers: d.givers,
        turnIns: d.turnIns,
        mentions: d.mentions,
        referenceDestination: index.destination(
          profile,
          quest.id,
          active.find(q=>q.id===quest.id)?.complete ? "t" : "o",
        ),
        chain: d.chain,
        rewards: d.rewards,
      };
    })
    .filter(Boolean);
  return publicFacts(rows);
}
module.exports = { referenceFacts, publicFacts };
