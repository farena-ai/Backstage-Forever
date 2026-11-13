"use strict";
// Application code: MIT. Compiled publisher facts: CC BY 4.0 (see data/forever/NOTICE).
const { createHash } = require("node:crypto");
const FILES = Object.freeze([
  "quests.enUS.json",
  "npcs.json",
  "creature_details.enUS.json",
  "item_hotfixes.enUS.json",
  "turn_ins.json",
  "objectives.json",
]);
const BUILD = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ATTRIBUTION =
  "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
// Per-file download/compile guard. The current client build's quest file is ~5.2 MB;
// each build's six files and the compiled pack keep their separate 12 MB bound.
const LIMIT = 8 * 1024 * 1024;
const TOTAL = 12 * 1024 * 1024;
const MAX_BUILDS = 12;
const id = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const number = (v, max = 2147483647) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v, max = 200) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f\x7f]/.test(v);
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(v) &&
  new Date(v).toISOString().slice(0, 10) === v;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const observedBuild = (p) =>
  p?.source?.kind === "wow-addon" &&
  typeof p.source.updatedAt === "string" &&
  Number.isFinite(Date.parse(p.source.updatedAt)) &&
  BUILD.test(p.clientBuild);
function fail() {
  throw Error("Invalid Forever reference data.");
}
function checkKeys(value, allowed) {
  if (!object(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    fail();
}
function entries(v, max = 30000) {
  if (!object(v) || Object.keys(v).length > max) fail();
  return Object.entries(v);
}
function position(v) {
  if (
    !object(v) ||
    !id(v.uiMap) ||
    !["mapX", "mapY"].every(
      (k) =>
        typeof v[k] === "number" &&
        Number.isFinite(v[k]) &&
        v[k] >= 0 &&
        v[k] <= 1,
    )
  )
    return null;
  return { mapId: v.uiMap, x: v.mapX, y: v.mapY };
}
function normalizeData(inputs, { commit, build } = {}) {
  if (!COMMIT.test(commit) || !BUILD.test(build)) fail();
  let total = 0,
    dropped = 0;
  const raw = {},
    files = {};
  const optional = (fn) => {
    try {
      return fn();
    } catch {
      dropped++;
      return null;
    }
  };
  for (const name of FILES) {
    let input = inputs[name];
    const bytes =
      typeof input === "string" || Buffer.isBuffer(input)
        ? Buffer.from(input)
        : Buffer.from(JSON.stringify(input));
    if (bytes.length > LIMIT || (total += bytes.length) > TOTAL)
      fail();
    const d =
      typeof input === "string" || Buffer.isBuffer(input)
        ? JSON.parse(bytes.toString("utf8"))
        : input;
    const m = d?.meta,
      dataset = name.split(".")[0];
    if (
      !object(m) ||
      m.dataset !== dataset ||
      m.product !== "wowf" ||
      m.clientBuild !== build ||
      m.schemaVersion !== 1 ||
      m.license !== "CC BY 4.0" ||
      m.attribution !== ATTRIBUTION ||
      !id(m.sources) ||
      !day(m.collectedOn?.first) ||
      !day(m.collectedOn?.last) ||
      m.collectedOn.first > m.collectedOn.last ||
      (name.includes(".enUS.")
        ? m.locale !== "enUS"
        : m.locale !== undefined && m.locale !== "enUS")
    )
      fail();
    raw[dataset] = d;
    files[name] = {
      sha256: hash(bytes),
      bytes: bytes.length,
      sources: m.sources,
      collectedOn: { first: m.collectedOn.first, last: m.collectedOn.last },
      url: `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${name}`,
    };
  }
  const dates = Object.values(files).map((f) => f.collectedOn.last);
  const pack = {
    schemaVersion: 1,
    product: "wowf",
    build,
    locale: "enUS",
    sourceCommit: commit,
    license: "CC BY 4.0",
    attribution: ATTRIBUTION,
    observedThrough: dates.sort().at(-1),
    files,
    quests: {},
    npcs: {},
    creatures: {},
    items: {},
    counts: { dropped: 0 },
  };
  const names = {};
  for (const [key, r] of entries(raw.item_hotfixes.items))
    if (id(+key) && r?.status === "valid" && text(r.name) && id(r.sources)) {
      names[key] = r.name;
      pack.items[key] = { id: +key, name: r.name, sources: r.sources };
    }
  const creatures = {};
  for (const [key, r] of entries(raw.creature_details.creatures))
    if (id(+key) && text(r?.name) && id(r.sources)) {
      creatures[key] = r.name;
      pack.creatures[key] = { id: +key, name: r.name, sources: r.sources };
    }
  for (const [key, q] of entries(raw.quests.quests))
    optional(() => {
      if (!id(+key) || !object(q) || !text(q.title) || !id(q.sources)) fail();
      const record = {
        id: +key,
        title: q.title,
        sources: q.sources,
        observedInPlay: false,
        givers: [],
        turnIns: [],
        objectiveLocations: [],
        mentions: [],
        rewards: { items: [], choices: [] },
      };
      for (const k of ["level", "minLevel"])
        if (q[k] !== undefined) {
          if (!number(q[k], 1000)) fail();
          record[k] = q[k];
        }
      if (id(q.nextQuestId)) record.nextQuestId = q.nextQuestId;
      if (typeof q.raceMask === "string" && /^[a-f0-9]{16}$/.test(q.raceMask))
        record.raceMask = q.raceMask;
      // Short delivery evidence only; narrative descriptions are deliberately never copied.
      if (text(q.objectivesText, 500))
        record.objectiveEvidence = q.objectivesText;
      record.objectives = [];
      if (Array.isArray(q.objectives))
        for (const o of q.objectives.slice(0, 10))
          optional(() => {
            if (
              !object(o) ||
              !number(o.storageIndex, 9) ||
              !text(o.type, 40) ||
              !number(o.amount, 100000)
            )
              fail();
            record.objectives.push({
              index: o.storageIndex + 1,
              type: o.type,
              required: o.amount,
              ...(id(o.objectId) ? { objectId: o.objectId } : {}),
              ...(text(o.text) ? { text: o.text } : {}),
            });
            return true;
          });
      for (const kind of ["items", "choices"])
        if (Array.isArray(q.rewards?.[kind]))
          for (const r of q.rewards[kind].slice(0, 12))
            optional(() => {
              if (!id(r.itemId) || !id(r.count)) fail();
              record.rewards[kind].push({
                itemId: r.itemId,
                count: r.count,
                name: names[r.itemId] || `Item #${r.itemId}`,
              });
              return true;
            });
      if (number(q.rewards?.money))
        record.rewards.moneyCopper = q.rewards.money;
      pack.quests[key] = record;
      return true;
    });
  for (const [collection, kind] of [
    ["npcs", "npc"],
    ["objects", "object"],
  ])
    for (const [key, n] of entries(raw.npcs[collection]))
      optional(() => {
        if (!id(+key) || !object(n) || !text(n.name) || !id(n.sources)) fail();
        const npc = {
          id: +key,
          kind,
          name: n.name,
          sources: n.sources,
          positions: [],
          ...(day(n.lastSeen) ? { lastSeen: n.lastSeen } : {}),
          ...(n.side === "Horde" || n.side === "Alliance"
            ? { side: n.side }
            : {}),
        };
        for (const p of Array.isArray(n.positions)
          ? n.positions.slice(0, 100)
          : []) {
          const pos = position(p);
          if (pos) npc.positions.push(pos);
          else dropped++;
        }
        pack.npcs[`${kind}:${key}`] = npc;
        for (const [field, out] of [
          ["offers", "givers"],
          ["takes", "turnIns"],
        ])
          for (const [questId, observation] of n[field] === undefined
            ? []
            : optional(() => entries(n[field], 5000)) || []) {
            optional(() => {
              checkKeys(
                observation,
                field === "offers"
                  ? [
                      "title",
                      "level",
                      "frequency",
                      "repeatable",
                      "legendary",
                      "important",
                      "meta",
                      "infoId",
                    ]
                  : ["title", "level"],
              );
              if (
                !id(+questId) ||
                !text(observation.title) ||
                !observation.title.trim() ||
                (observation.level !== undefined &&
                  !number(observation.level, 1000))
              )
                fail();
              for (const k of ["repeatable", "legendary", "important", "meta"])
                if (
                  observation[k] !== undefined &&
                  typeof observation[k] !== "boolean"
                )
                  fail();
              for (const k of ["frequency", "infoId"])
                if (observation[k] !== undefined && !number(observation[k]))
                  fail();
              const q = pack.quests[questId];
              if (!q) return true;
              q[out].push({ id: npc.id, kind });
              q.observedInPlay = true;
              if (npc.side) {
                q.sides ||= [];
                if (!q.sides.includes(npc.side)) q.sides.push(npc.side);
              }
              return true;
            });
          }
        return true;
      });
  for (const [key, objectives] of entries(raw.objectives.quests)) {
    const q = pack.quests[key];
    if (!q) continue;
    for (const [index, o] of entries(objectives, 20))
      optional(() => {
        if (
          !id(+index) ||
          +index > 10 ||
          !text(o?.type, 40) ||
          !number(o.required, 100000) ||
          !id(o.gains) ||
          !id(o.sources)
        )
          fail();
        const positions = [];
        for (const p of Array.isArray(o.positions)
          ? o.positions.slice(0, 100)
          : []) {
          const pos = position(p);
          if (pos) positions.push(pos);
          else dropped++;
        }
        q.objectiveLocations.push({
          index: +index,
          type: o.type,
          required: o.required,
          gains: o.gains,
          sources: o.sources,
          positions,
        });
        q.observedInPlay = true;
        return true;
      });
  }
  for (const [key, observations] of entries(raw.turn_ins.quests)) {
    const q = pack.quests[key];
    if (!q || !Array.isArray(observations)) continue;
    q.observedXP = [];
    for (const r of observations.slice(0, 50))
      optional(() => {
        if (!number(r?.level, 1000) || !number(r.xp) || !id(r.sources)) fail();
        q.observedXP.push({ level: r.level, xp: r.xp, sources: r.sources });
        q.observedInPlay = true;
        return true;
      });
  }
  for (const q of Object.values(pack.quests)) {
    const evidence = q.objectiveEvidence;
    if (
      !evidence ||
      !/^\s*(speak (?:to|with)|report to|deliver|bring|return to|meet)\b/i.test(
        evidence,
      )
    )
      continue;
    for (const n of Object.values(pack.npcs)) {
      if (n.kind !== "npc") continue;
      const escaped = n.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp(
          `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
          "iu",
        ).test(evidence)
      )
        q.mentions.push({
          id: n.id,
          kind: "npc",
          relationship: "mentioned-in-objective",
        });
      if (q.mentions.length >= 10) break;
    }
  }
  pack.counts = {
    quests: Object.keys(pack.quests).length,
    observedQuests: Object.values(pack.quests).filter((q) => q.observedInPlay)
      .length,
    npcs: Object.values(pack.npcs).filter((n) => n.kind === "npc").length,
    objects: Object.values(pack.npcs).filter((n) => n.kind === "object").length,
    approachedObjects: Object.keys(raw.npcs.approached || {}).length,
    creatureNames: Object.keys(creatures).length,
    itemNames: Object.keys(names).length,
    turnInQuests: Object.keys(raw.turn_ins.quests).length,
    objectiveQuests: Object.keys(raw.objectives.quests).length,
    dropped,
  };
  return pack;
}
function validateFiles(files, commit, build) {
  if (!object(files) || Object.keys(files).length !== FILES.length) fail();
  for (const n of FILES) {
    const f = files[n];
    checkKeys(f, ["sha256", "bytes", "sources", "collectedOn", "url"]);
    if (
      !/^([a-f0-9]{64})$/.test(f.sha256) ||
      !number(f.bytes, LIMIT) ||
      !id(f.sources) ||
      !day(f.collectedOn?.first) ||
      !day(f.collectedOn?.last) ||
      f.url !==
        `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${n}`
    )
      fail();
  }
}
function validatePack(p) {
  if (
    !object(p) ||
    Buffer.byteLength(JSON.stringify(p)) > TOTAL ||
    p.schemaVersion !== 1 ||
    p.product !== "wowf" ||
    !BUILD.test(p.build) ||
    p.locale !== "enUS" ||
    !COMMIT.test(p.sourceCommit) ||
    p.license !== "CC BY 4.0" ||
    p.attribution !== ATTRIBUTION ||
    !day(p.observedThrough)
  )
    fail();
  const allowed = new Set([
    "schemaVersion",
    "product",
    "build",
    "locale",
    "sourceCommit",
    "license",
    "attribution",
    "observedThrough",
    "files",
    "quests",
    "npcs",
    "counts",
    "creatures",
    "items",
    "builds",
  ]);
  if (Object.keys(p).some((k) => !allowed.has(k))) fail();
  for (const collection of ["creatures", "items"])
    for (const [key, row] of entries(p[collection])) {
      checkKeys(row, ["id", "name", "sources"]);
      if (!id(+key) || row.id !== +key || !text(row.name) || !id(row.sources))
        fail();
    }
  validateFiles(p.files, p.sourceCommit, p.build);
  // Multi-build packs list every merged build newest-first; the first entry is the
  // pack's own build/commit/files, so single-build consumers stay unchanged.
  if (p.builds !== undefined) {
    if (
      !Array.isArray(p.builds) ||
      p.builds.length < 1 ||
      p.builds.length > MAX_BUILDS
    )
      fail();
    const seen = new Set();
    p.builds.forEach((b, i) => {
      checkKeys(b, ["build", "sourceCommit", "observedThrough", "files"]);
      const key = `${b.build}@${b.sourceCommit}`;
      if (
        !BUILD.test(b.build) ||
        !COMMIT.test(b.sourceCommit) ||
        !day(b.observedThrough) ||
        b.observedThrough > p.observedThrough ||
        seen.has(key)
      )
        fail();
      seen.add(key);
      validateFiles(b.files, b.sourceCommit, b.build);
      if (
        i === 0 &&
        (b.build !== p.build ||
          b.sourceCommit !== p.sourceCommit ||
          JSON.stringify(b.files) !== JSON.stringify(p.files))
      )
        fail();
    });
  }
  for (const [key, q] of entries(p.quests)) {
    checkKeys(q, [
      "id",
      "title",
      "sources",
      "observedInPlay",
      "givers",
      "turnIns",
      "objectiveLocations",
      "mentions",
      "rewards",
      "level",
      "minLevel",
      "nextQuestId",
      "raceMask",
      "objectiveEvidence",
      "objectives",
      "sides",
      "observedXP",
    ]);
    checkKeys(q.rewards, ["items", "choices", "moneyCopper"]);
    if (
      !id(+key) ||
      q?.id !== +key ||
      !text(q.title) ||
      !id(q.sources) ||
      typeof q.observedInPlay !== "boolean"
    )
      fail();
    for (const k of [
      "givers",
      "turnIns",
      "mentions",
      "objectiveLocations",
      "objectives",
    ])
      if (!Array.isArray(q[k]) || q[k].length > 100) fail();
    if (q.nextQuestId !== undefined && !id(q.nextQuestId)) fail();
    if (q.objectiveEvidence !== undefined && !text(q.objectiveEvidence, 500))
      fail();
    for (const k of ["level", "minLevel"])
      if (q[k] !== undefined && !number(q[k], 1000)) fail();
    if (
      q.raceMask !== undefined &&
      (typeof q.raceMask !== "string" || !/^[a-f0-9]{16}$/.test(q.raceMask))
    )
      fail();
    if (
      q.sides !== undefined &&
      (!Array.isArray(q.sides) ||
        q.sides.length > 2 ||
        q.sides.some((s) => !["Horde", "Alliance"].includes(s)))
    )
      fail();
    for (const k of ["givers", "turnIns", "mentions"])
      for (const r of q[k]) {
        checkKeys(
          r,
          k === "mentions" ? ["id", "kind", "relationship"] : ["id", "kind"],
        );
        if (
          !id(r?.id) ||
          !["npc", "object"].includes(r.kind) ||
          !p.npcs[`${r.kind}:${r.id}`] ||
          (k === "mentions" && r.relationship !== "mentioned-in-objective")
        )
          fail();
      }
    for (const o of q.objectives)
      if (
        !id(o?.index) ||
        o.index > 10 ||
        !text(o.type, 40) ||
        !number(o.required, 100000) ||
        (o.objectId !== undefined && !id(o.objectId)) ||
        (o.text !== undefined && !text(o.text))
      )
        fail();
    for (const o of q.objectiveLocations)
      if (
        !id(o?.index) ||
        o.index > 10 ||
        !text(o.type, 40) ||
        !number(o.required, 100000) ||
        !id(o.gains) ||
        !id(o.sources) ||
        !Array.isArray(o.positions) ||
        o.positions.length > 100 ||
        o.positions.some(
          (pos) => !position({ uiMap: pos.mapId, mapX: pos.x, mapY: pos.y }),
        )
      )
        fail();
    if (q.rewards?.moneyCopper !== undefined && !number(q.rewards.moneyCopper))
      fail();
    if (
      q.observedXP !== undefined &&
      (!Array.isArray(q.observedXP) ||
        q.observedXP.length > 50 ||
        q.observedXP.some(
          (o) => !number(o.level, 1000) || !number(o.xp) || !id(o.sources),
        ))
    )
      fail();
    for (const k of ["items", "choices"])
      if (
        !Array.isArray(q.rewards?.[k]) ||
        q.rewards[k].length > 12 ||
        q.rewards[k].some((r) => !id(r.itemId) || !id(r.count) || !text(r.name))
      )
        fail();
  }
  for (const [key, n] of entries(p.npcs)) {
    checkKeys(n, [
      "id",
      "kind",
      "name",
      "sources",
      "positions",
      "lastSeen",
      "side",
    ]);
    if (
      !id(n?.id) ||
      !["npc", "object"].includes(n.kind) ||
      key !== `${n.kind}:${n.id}` ||
      !text(n.name) ||
      !id(n.sources) ||
      !Array.isArray(n.positions) ||
      n.positions.length > 100 ||
      n.positions.some(
        (pos) => !position({ uiMap: pos.mapId, mapX: pos.x, mapY: pos.y }),
      )
    )
      fail();
  }
  for (const n of Object.values(p.npcs))
    if (
      (n.lastSeen !== undefined && !day(n.lastSeen)) ||
      (n.side !== undefined && !["Horde", "Alliance"].includes(n.side))
    )
      fail();
  for (const [key, count] of entries(p.counts, 20))
    if (!number(count, 1000000)) fail();
  // Reject arbitrary cached fields, including private/narrative values, recursively.
  const keys = new Set([
    ...allowed,
    "id",
    "title",
    "sources",
    "observedInPlay",
    "givers",
    "turnIns",
    "objectiveLocations",
    "mentions",
    "rewards",
    "level",
    "minLevel",
    "nextQuestId",
    "raceMask",
    "objectiveEvidence",
    "objectives",
    "sides",
    "observedXP",
    "items",
    "choices",
    "moneyCopper",
    "itemId",
    "count",
    "name",
    "index",
    "type",
    "required",
    "objectId",
    "text",
    "kind",
    "relationship",
    "gains",
    "positions",
    "lastSeen",
    "side",
    "mapId",
    "x",
    "y",
    "xp",
    "sha256",
    "bytes",
    "collectedOn",
    "first",
    "last",
    "url",
    ...FILES,
    "builds",
    "observedQuests",
    "objects",
    "approachedObjects",
    "creatureNames",
    "itemNames",
    "turnInQuests",
    "objectiveQuests",
    "dropped",
  ]);
  function walk(v, depth = 0) {
    if (depth > 10) fail();
    if (typeof v === "string" && !text(v, 700)) fail();
    if (typeof v === "number" && !Number.isFinite(v)) fail();
    if (v === null) fail();
    if (Array.isArray(v)) {
      if (v.length > 30000) fail();
      v.forEach((x) => walk(x, depth + 1));
    } else if (object(v))
      for (const [k, x] of Object.entries(v)) {
        if (!keys.has(k) && !/^\d+$/.test(k) && !/^(npc|object):\d+$/.test(k))
          fail();
        walk(x, depth + 1);
      }
  }
  walk(p);
  return p;
}
// Bounded caps for unions; they never exceed the validator's own array limits.
const MERGE_CAPS = Object.freeze({
  positions: 100,
  refs: 100,
  mentions: 10,
  objectivePositions: 100,
  observedXP: 50,
});
const pointKey = (p) => `${p.mapId}:${p.x}:${p.y}`;
function union(lists, key, cap) {
  const seen = new Set(),
    out = [];
  for (const list of lists)
    for (const row of list || []) {
      const k = key(row);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(structuredClone(row));
      if (out.length >= cap) return out;
    }
  return out;
}
const newest = (rows, field) => rows.find((r) => r[field] !== undefined)?.[field];
const latestDay = (values) =>
  values.filter((v) => v !== undefined).sort().at(-1);
const hasRewards = (r) =>
  r.items.length > 0 || r.choices.length > 0 || r.moneyCopper !== undefined;
function mergeQuest(rows) {
  const [head] = rows;
  const q = {
    id: head.id,
    title: head.title,
    // Per-build sources count saved files; the maximum is a lower bound, never a sum.
    sources: Math.max(...rows.map((r) => r.sources)),
    observedInPlay: rows.some((r) => r.observedInPlay),
    givers: union(rows.map((r) => r.givers), (r) => `${r.kind}:${r.id}`, MERGE_CAPS.refs),
    turnIns: union(rows.map((r) => r.turnIns), (r) => `${r.kind}:${r.id}`, MERGE_CAPS.refs),
    objectiveLocations: [],
    mentions: union(rows.map((r) => r.mentions), (r) => `${r.kind}:${r.id}`, MERGE_CAPS.mentions),
    rewards: structuredClone(rows.find((r) => hasRewards(r.rewards))?.rewards || head.rewards),
  };
  for (const k of ["level", "minLevel", "nextQuestId", "raceMask", "objectiveEvidence"]) {
    const v = newest(rows, k);
    if (v !== undefined) q[k] = v;
  }
  q.objectives = structuredClone(rows.find((r) => r.objectives.length)?.objectives || []);
  const sides = [...new Set(rows.flatMap((r) => r.sides || []))];
  if (sides.length) q.sides = sides;
  // The newest build defines each objective slot; older rows only add positions to the same slot.
  const slots = new Map();
  for (const r of rows)
    for (const o of r.objectiveLocations) {
      const slot = slots.get(o.index);
      if (!slot) slots.set(o.index, { head: o, rows: [o] });
      else if (slot.head.type === o.type && slot.head.required === o.required)
        slot.rows.push(o);
    }
  q.objectiveLocations = [...slots.values()].map(({ head: o, rows: same }) => ({
    index: o.index,
    type: o.type,
    required: o.required,
    gains: Math.max(...same.map((s) => s.gains)),
    sources: Math.max(...same.map((s) => s.sources)),
    positions: union(same.map((s) => s.positions), pointKey, MERGE_CAPS.objectivePositions),
  }));
  if (rows.some((r) => r.observedXP)) {
    const xp = new Map();
    for (const r of rows)
      for (const o of r.observedXP || []) {
        const k = `${o.level}:${o.xp}`;
        if (!xp.has(k)) xp.set(k, { ...o });
        else xp.get(k).sources = Math.max(xp.get(k).sources, o.sources);
      }
    q.observedXP = [...xp.values()].slice(0, MERGE_CAPS.observedXP);
  }
  return q;
}
function mergeNpc(rows) {
  const [head] = rows;
  const n = {
    id: head.id,
    kind: head.kind,
    name: head.name,
    sources: Math.max(...rows.map((r) => r.sources)),
    positions: union(rows.map((r) => r.positions), pointKey, MERGE_CAPS.positions),
  };
  const lastSeen = latestDay(rows.map((r) => r.lastSeen));
  if (lastSeen) n.lastSeen = lastSeen;
  const side = newest(rows, "side");
  if (side) n.side = side;
  return n;
}
function mergeNamed(rows) {
  return {
    id: rows[0].id,
    name: rows[0].name,
    sources: Math.max(...rows.map((r) => r.sources)),
  };
}
function gather(packs, collection) {
  const rows = new Map();
  for (const p of packs)
    for (const [key, row] of Object.entries(p[collection])) {
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(row);
    }
  return rows;
}
/**
 * Merge validated packs given newest-first. Records are unioned with bounded caps and
 * exact dedupe; scalar facts come from the newest build that reports them. The result
 * keeps the newest pack's build/commit/files and lists every merged build in `builds`.
 */
function mergePacks(packs) {
  if (!Array.isArray(packs) || !packs.length || packs.length > MAX_BUILDS) fail();
  const valid = packs.map((p) => validatePack(p));
  const [head] = valid;
  const builds = union(
    valid.map((p) =>
      p.builds || [
        {
          build: p.build,
          sourceCommit: p.sourceCommit,
          observedThrough: p.observedThrough,
          files: p.files,
        },
      ],
    ),
    (b) => `${b.build}@${b.sourceCommit}`,
    MAX_BUILDS,
  );
  const pack = {
    schemaVersion: 1,
    product: head.product,
    build: head.build,
    locale: head.locale,
    sourceCommit: head.sourceCommit,
    license: head.license,
    attribution: head.attribution,
    observedThrough: latestDay(valid.map((p) => p.observedThrough)),
    files: structuredClone(head.files),
    builds,
    quests: {},
    npcs: {},
    creatures: {},
    items: {},
    counts: {},
  };
  for (const [key, rows] of gather(valid, "creatures")) pack.creatures[key] = mergeNamed(rows);
  for (const [key, rows] of gather(valid, "items")) pack.items[key] = mergeNamed(rows);
  for (const [key, rows] of gather(valid, "npcs")) pack.npcs[key] = mergeNpc(rows);
  for (const [key, rows] of gather(valid, "quests")) pack.quests[key] = mergeQuest(rows);
  const max = (k) => Math.max(...valid.map((p) => p.counts[k] || 0));
  const npcs = Object.values(pack.npcs);
  pack.counts = {
    quests: Object.keys(pack.quests).length,
    observedQuests: Object.values(pack.quests).filter((q) => q.observedInPlay).length,
    npcs: npcs.filter((n) => n.kind === "npc").length,
    objects: npcs.filter((n) => n.kind === "object").length,
    // Raw-file coverage indicators: the best single build, not a cross-build sum.
    approachedObjects: max("approachedObjects"),
    creatureNames: Object.keys(pack.creatures).length,
    itemNames: Object.keys(pack.items).length,
    turnInQuests: max("turnInQuests"),
    objectiveQuests: max("objectiveQuests"),
    dropped: valid.reduce((n, p) => n + (p.counts.dropped || 0), 0),
  };
  return validatePack(pack);
}
class KnowledgeIndex {
  constructor(pack) {
    this.pack = validatePack(pack);
    this.reverse = new Map();
    for (const q of Object.values(pack.quests))
      if (q.nextQuestId) {
        const a = this.reverse.get(q.nextQuestId) || [];
        a.push(q.id);
        this.reverse.set(q.nextQuestId, a);
      }
  }
  compatible(p) {
    return Boolean(observedBuild(p) && p.clientBuild === this.pack.build);
  }
  details(p = {}, questId) {
    if (!id(questId)) fail();
    const q = this.pack.quests[questId];
    const active = p.quests?.find((q) => q.id === questId);
    const mismatch = p.clientBuild && p.clientBuild !== this.pack.build;
    const conflict =
      active && (!p.locale || p.locale === "enUS") && active.title !== q?.title;
    const status =
      !q || mismatch
        ? "missing"
        : conflict
          ? "conflict"
          : this.compatible(p)
            ? "match"
            : "reference";
    const warnings = [];
    if (mismatch)
      warnings.push("No reference pack matches this character build.");
    if (conflict)
      warnings.push(
        "Game title differs from the English reference; current game data wins.",
      );
    if (p.locale && p.locale !== "enUS")
      warnings.push("English reference names; game text may be translated.");
    const provenance = {
      build: this.pack.build,
      sourceCommit: this.pack.sourceCommit,
      observedThrough: this.pack.observedThrough,
      attribution: this.pack.attribution,
      url: `https://github.com/JIVESCORP/eg-link-output-wowf/tree/${this.pack.sourceCommit}/data/wowf/${this.pack.build}`,
    };
    if (status === "missing")
      return {
        status,
        questId,
        record: null,
        chain: [],
        givers: [],
        turnIns: [],
        objectiveLocations: [],
        mentions: [],
        rewards: null,
        provenance,
        warnings,
      };
    const resolve = (r) => ({
      ...this.pack.npcs[`${r.kind}:${r.id}`],
      ...r,
      approximate: true,
      evidence: r.relationship || "observed-npc-window",
    });
    const completed = new Set(
      p.history?.completedIdsKnown === true ? p.history.completedIds : [],
    );
    const seen = new Set();
    const activeQuests = new Map((p.quests || []).map((q) => [q.id, q]));
    const chain = [];
    const queue = [questId];
    while (queue.length && chain.length < 12) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      const row = this.pack.quests[current];
      const game = activeQuests.get(current);
      const titleConflict = Boolean(
        row && game && (!p.locale || p.locale === "enUS") && game.title !== row.title,
      );
      chain.push({
        id: current,
        title: game?.title || row?.title || `Quest #${current}`,
        referenceStatus: !row
          ? "missing"
          : titleConflict ? "conflict" : status === "reference" ? "reference" : "match",
        ...(row && game && game.title !== row.title
          ? { referenceTitle: row.title } : {}),
        status: !row
          ? "missing"
          : game
            ? "active"
            : completed.has(current)
              ? "completed"
              : "unknown",
        ...(row?.nextQuestId ? { nextQuestId: row.nextQuestId } : {}),
      });
      if (!row) continue;
      if (row.nextQuestId && !seen.has(row.nextQuestId))
        queue.push(row.nextQuestId);
      for (const previous of this.reverse.get(current) || [])
        if (!seen.has(previous)) queue.push(previous);
    }
    for (const node of chain) {
      const path = new Set();
      let current = node.id;
      for (let i = 0; i < 12 && current; i++) {
        if (path.has(current)) {
          warnings.push("Reported chain cycle detected.");
          break;
        }
        path.add(current);
        current = this.pack.quests[current]?.nextQuestId;
      }
    }
    if (queue.length) warnings.push("Chain display limited to 12 nodes.");
    return {
      status,
      questId,
      record: q,
      chain,
      givers: q.givers.map(resolve),
      turnIns: q.turnIns.map(resolve),
      objectiveLocations: q.objectiveLocations,
      mentions: q.mentions.map(resolve),
      rewards: q.rewards,
      provenance,
      warnings: [...new Set(warnings)],
    };
  }
  search(query, p = {}, options = {}) {
    if (
      typeof query !== "string" ||
      query.length > 120 ||
      /[\x00-\x1f\x7f]/.test(query) ||
      !object(options) ||
      Object.keys(options).some((k) => k !== "includeReferenceOnly") ||
      (options.includeReferenceOnly !== undefined &&
        typeof options.includeReferenceOnly !== "boolean")
    )
      fail();
    if (p.clientBuild && p.clientBuild !== this.pack.build) return [];
    const active = new Map(p.quests?.map((q) => [q.id, q]) || []),
      needle = query.trim().toLocaleLowerCase("en-US");
    const currentTitle = (q) => active.get(q.id)?.title || q.title;
    const score = (q) =>
      Number(active.has(q.id)) * 4 +
      Number(String(q.id) === needle) * 2 +
      Number(currentTitle(q).toLowerCase() === needle);
    return Object.values(this.pack.quests)
      .filter(
        (q) =>
          (q.observedInPlay ||
            active.has(q.id) ||
            options.includeReferenceOnly) &&
          (!needle ||
            String(q.id) === needle ||
            currentTitle(q).toLowerCase().includes(needle) ||
            q.title.toLowerCase().includes(needle)),
      )
      .sort((a, b) => score(b) - score(a) || a.id - b.id)
      .slice(0, 30)
      .map((q) => ({
        id: q.id,
        title: currentTitle(q),
        ...(currentTitle(q) !== q.title ? { referenceTitle: q.title } : {}),
        level: q.level ?? null,
        minLevel: q.minLevel ?? null,
        observedInPlay: q.observedInPlay,
        active: active.has(q.id),
        status: this.details(p, q.id).status,
        build: this.pack.build,
      }));
  }
  destination(p, questId, phase) {
    const d = this.details(p, questId);
    if (d.status !== "match" || !["t", "o", "r"].includes(phase)) return null;
    const active = p.quests?.find((q) => q.id === questId);
    if (phase !== "r" && (!active || (phase === "t") !== active.complete))
      return null;
    const first = (rows, evidence) => {
      for (const n of rows) {
        if (n.positions?.[0])
          return {
            ...n.positions[0],
            kind: n.kind,
            id: n.id,
            name: n.name,
            approximate: true,
            evidence,
            sources: n.sources,
            observedThrough: n.lastSeen || d.provenance.observedThrough,
          };
      }
      return null;
    };
    if (phase === "r" && !active) {
      const giver = first(d.givers, "observed-quest-giver");
      if (giver) return giver;
    }
    if (phase === "t" || phase === "r") {
      const dest = first(d.turnIns, "observed-turn-in-npc");
      if (dest) return dest;
    }
    if (phase === "o")
      for (const loc of d.objectiveLocations) {
        const o = active.objectives?.[loc.index - 1];
        if (
          o &&
          !o.done &&
          o.type === loc.type &&
          o.required === loc.required &&
          loc.positions[0]
        )
          return {
            ...loc.positions[0],
            objectiveIndex: loc.index,
            approximate: true,
            evidence: "observed-objective-gain",
            sources: loc.sources,
            observedThrough: d.provenance.observedThrough,
          };
      }
    if (
      d.mentions.length === 1 &&
      !d.record.objectives.some((o) =>
        ["monster", "item", "gameObject"].includes(o.type),
      )
    )
      return first(d.mentions, "mentioned-in-objective");
    return phase === "r" ? first(d.givers, "observed-quest-giver") : null;
  }
  followUps(p = {}) {
    if (!this.compatible(p) || p.history?.completedIdsKnown !== true) return [];
    const completed = new Set(p.history.completedIds),
      active = new Set(p.quests?.map((q) => q.id) || []),
      found = new Set(),
      out = [];
    for (const previous of [...completed].sort((a, b) => a - b)) {
      const next = this.pack.quests[previous]?.nextQuestId,
        q = this.pack.quests[next];
      if (
        !q ||
        !q.observedInPlay ||
        found.has(next) ||
        completed.has(next) ||
        active.has(next) ||
        (q.minLevel && p.level < q.minLevel) ||
        (p.faction && q.sides?.length && !q.sides.includes(p.faction))
      )
        continue;
      found.add(next);
      out.push({
        questId: next,
        title: q.title,
        previousQuestId: previous,
        label: "Check availability",
        reason:
          "Reported next quest link; race, class and reputation requirements remain unknown.",
        knowledge: this.details(p, next),
      });
      if (out.length === 3) break;
    }
    return out;
  }
  resolveWaypoint(p, questId, phase) {
    const descriptor = {
      phase: ["t", "o", "r"].includes(phase) ? phase : null,
      source: null,
      destination: null,
      canCopy: false,
      reason: "No compatible sourced waypoint for this quest phase.",
    };
    if (!id(questId) || !descriptor.phase) return descriptor;
    if (!this.compatible(p)) return descriptor;
    if (
      typeof p?.captureVersion !== "string" ||
      !/^0\.(?:[6-9]|[1-9]\d+)\./.test(p.captureVersion)
    ) {
      descriptor.reason =
        "Update the addon and reload the game before copying a waypoint.";
      return descriptor;
    }
    const active = p.quests?.find((q) => q.id === questId);
    if (
      phase !== "r" &&
      (!active ||
        typeof active.complete !== "boolean" ||
        (phase === "t") !== active.complete)
    )
      return descriptor;
    let destination,
      source = "reference";
    // Game-reported points remain authoritative even without a matching reference row.
    if (phase !== "r" && active.destination !== undefined) {
      const actual = active.destination;
      const point =
        object(actual) &&
        position({ uiMap: actual.mapId, mapX: actual.x, mapY: actual.y });
      if (
        !point ||
        (actual.text !== undefined && actual.text !== "" && !text(actual.text))
      )
        return descriptor;
      destination = {
        ...point,
        ...(actual.text !== undefined ? { text: actual.text } : {}),
      };
      source = "game";
    } else destination = this.destination(p, questId, phase);
    if (!destination) return descriptor;
    return {
      ...descriptor,
      source,
      destination: {
        ...destination,
        // Preview and clipboard describe the exact same command precision.
        x: Number(destination.x.toFixed(4)),
        y: Number(destination.y.toFixed(4)),
      },
      canCopy: true,
      reason:
        source === "game"
          ? "Game-reported quest waypoint from the saved snapshot."
          : phase === "r"
            ? "Approximate reference marker; check availability."
            : "Approximate community observation for this quest phase.",
    };
  }
  waypoint(p, questId, phase) {
    const resolved = this.resolveWaypoint(p, questId, phase);
    if (!resolved.canCopy) throw Error(resolved.reason);
    const d = resolved.destination;
    return `/bf guide ${questId} ${phase} ${d.mapId} ${d.x.toFixed(4)} ${d.y.toFixed(4)} ${this.pack.build}`;
  }
}
module.exports = {
  FILES,
  BUILD,
  COMMIT,
  ATTRIBUTION,
  LIMIT,
  TOTAL,
  MAX_BUILDS,
  MERGE_CAPS,
  normalizeData,
  validatePack,
  mergePacks,
  KnowledgeIndex,
  hash,
  observedBuild,
};
