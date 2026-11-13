"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { isDeepStrictEqual } = require("node:util");
const { COMMIT, BUILD, BUILDS, SOURCES } = require("./insights-sources.cjs");
const ATTRIBUTION =
  "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
// Per-file and per-build input bounds (the current build's quest file is ~5.2 MB);
// the merged multi-build pack has its own bound. Row caps cover the merged union.
const INPUT_BYTES = 8 * 1024 * 1024,
  TOTAL_BYTES = 12 * 1024 * 1024,
  PACK_BYTES = 2 * 1024 * 1024;
const MAX = Object.freeze({
  quests: 10000,
  trainers: 300,
  services: 20000,
  items: 20000,
  sources: 100,
  builds: 12,
});
const FILES = Object.freeze([...new Set(SOURCES.map((s) => s.name))]);
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const sourcesFor = (build) => SOURCES.filter((s) => s.build === build);
const lastDay = (sources) =>
  sources.map((s) => s.meta.collectedOn.last).sort().at(-1);
const plain = (v) =>
  !!v &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const integer = (v, max = 2147483647, min = 1) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max = 200) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f\x7f-\x9f]/.test(v);
const date = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
function invalid() {
  throw Error("Invalid offline Forever insights data.");
}
function keys(o, required, optional = []) {
  if (
    !plain(o) ||
    required.some((k) => !Object.hasOwn(o, k)) ||
    Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))
  )
    invalid();
}
function list(v, max) {
  if (!Array.isArray(v) || v.length > max || Object.keys(v).length !== v.length)
    invalid();
}
const count = (v) => integer(v, 1000000, 0);
function position(p) {
  keys(p, ["mapId", "x", "y"]);
  if (
    !integer(p.mapId) ||
    ![p.x, p.y].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
    )
  )
    invalid();
}
function reactions(r) {
  keys(r, [], ["Alliance", "Horde"]);
  for (const a of Object.values(r)) {
    list(a, 8);
    if (a.some((n) => !integer(n, 8)) || new Set(a).size !== a.length)
      invalid();
  }
}
function unique(rows, max) {
  list(rows, max);
  const ids = new Set();
  for (const r of rows) {
    if (!plain(r) || !integer(r.id) || ids.has(r.id)) invalid();
    ids.add(r.id);
  }
}
function coverage(p) {
  return {
    quests: p.quests.length,
    sharing: p.quests.filter(
      (q) =>
        q.sharing && q.sharing.supportedCount + q.sharing.unsupportedCount > 0,
    ).length,
    durations: p.quests.filter((q) => q.timeLimitSeconds).length,
    startItems: p.quests.filter((q) => q.startItemId).length,
    dropLists: p.quests.filter((q) => q.itemDrops?.length).length,
    trainers: p.trainers.length,
    services: p.trainers.reduce((n, t) => n + t.services.length, 0),
    uniqueSpells: new Set(
      p.trainers.flatMap((t) => t.services.map((s) => s.spellId)),
    ).size,
    items: p.items.length,
  };
}
/** Strict detached reference facts. Unknown and zero observations are not eligibility. */
function checkSources(sources, commit) {
  list(sources, MAX.builds * FILES.length);
  if (!sources.length) invalid();
  const seen = new Set();
  for (const s of sources) {
    keys(s, ["name", "build", "bytes", "sha256", "url", "meta"]);
    const key = `${s.build}/${s.name}`;
    if (
      !FILES.includes(s.name) ||
      !BUILD_RE.test(s.build) ||
      seen.has(key) ||
      !integer(s.bytes, INPUT_BYTES) ||
      !/^[a-f0-9]{64}$/.test(s.sha256) ||
      s.url !==
        `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${key}` ||
      !plain(s.meta) ||
      s.meta.clientBuild !== s.build ||
      s.meta.dataset !== s.name.split(".")[0] ||
      s.meta.product !== "wowf" ||
      s.meta.license !== "CC BY 4.0" ||
      s.meta.attribution !== ATTRIBUTION ||
      s.meta.schemaVersion !== 1 ||
      !integer(s.meta.sources, MAX.sources) ||
      !date(s.meta.collectedOn?.first) ||
      !date(s.meta.collectedOn?.last)
    )
      invalid();
    seen.add(key);
  }
  const builds = [...new Set(sources.map((s) => s.build))];
  if (
    builds.length > MAX.builds ||
    builds.some(
      (b) => sources.filter((s) => s.build === b).length !== FILES.length,
    )
  )
    invalid();
  return builds;
}
/**
 * Strict detached reference facts. Unknown and zero observations are not eligibility.
 * pinned (default) also requires the exact bundled multi-build provenance.
 */
function validateInsights(p, { pinned = true } = {}) {
  keys(p, [
    "schemaVersion",
    "kind",
    "product",
    "build",
    "builds",
    "sourceCommit",
    "license",
    "attribution",
    "observedThrough",
    "textLocale",
    "observationNamesLocale",
    "sources",
    "coverage",
    "dropped",
    "quests",
    "trainers",
    "items",
  ]);
  if (
    p.schemaVersion !== 1 ||
    p.kind !== "forever-insights" ||
    p.product !== "wowf" ||
    typeof p.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(p.sourceCommit) ||
    p.license !== "CC BY 4.0" ||
    p.attribution !== ATTRIBUTION ||
    p.textLocale !== "enUS" ||
    p.observationNamesLocale !== "unspecified" ||
    Buffer.byteLength(JSON.stringify(p)) > PACK_BYTES
  )
    invalid();
  const builds = checkSources(p.sources, p.sourceCommit);
  if (
    !isDeepStrictEqual(p.builds, builds) ||
    p.build !== builds[0] ||
    p.observedThrough !== lastDay(p.sources) ||
    // Pinned provenance: every listed source is one of the immutable bundled sources,
    // in bundled newest-first order (a single pinned build is also valid).
    (pinned &&
      (p.sourceCommit !== COMMIT ||
        !isDeepStrictEqual(
          p.builds,
          BUILDS.filter((b) => p.builds.includes(b)),
        ) ||
        !isDeepStrictEqual(
          p.sources,
          SOURCES.filter((s) => p.builds.includes(s.build)),
        )))
  )
    invalid();
  keys(p.dropped, [
    "questRows",
    "sharingRows",
    "questFields",
    "itemDrops",
    "trainerRows",
    "services",
    "positions",
    "items",
  ]);
  if (Object.values(p.dropped).some((n) => !count(n))) invalid();
  unique(p.quests, MAX.quests);
  unique(p.trainers, MAX.trainers);
  unique(p.items, MAX.items);
  for (const q of p.quests) {
    keys(
      q,
      ["id", "title", "sources"],
      ["startItemId", "timeLimitSeconds", "itemDrops", "sharing"],
    );
    if (
      !text(q.title) ||
      !integer(q.sources, MAX.sources) ||
      (q.startItemId !== undefined && !integer(q.startItemId)) ||
      (q.timeLimitSeconds !== undefined && !integer(q.timeLimitSeconds, 604800))
    )
      invalid();
    if (q.itemDrops !== undefined) {
      list(q.itemDrops, 10);
      const ids = new Set();
      for (const d of q.itemDrops) {
        keys(d, ["itemId", "count"]);
        if (
          !integer(d.itemId) ||
          !integer(d.count, 1000000) ||
          ids.has(d.itemId)
        )
          invalid();
        ids.add(d.itemId);
      }
    }
    if (Object.hasOwn(q, "sharing")) {
      keys(q.sharing, ["supportedCount", "unsupportedCount", "scanSources"]);
      if (
        !integer(q.sharing.scanSources, MAX.sources) ||
        !integer(q.sharing.supportedCount, MAX.sources, 0) ||
        !integer(q.sharing.unsupportedCount, MAX.sources, 0) ||
        q.sharing.supportedCount + q.sharing.unsupportedCount >
          q.sharing.scanSources
      )
        invalid();
    }
  }
  for (const t of p.trainers) {
    keys(t, [
      "id",
      "name",
      "title",
      "trainerType",
      "sources",
      "npcSources",
      "creatureSources",
      "titleSources",
      "lastSeen",
      "positions",
      "observedReactionsByFaction",
      "services",
    ]);
    if (
      !text(t.name) ||
      !text(t.title) ||
      ![0, 2].includes(t.trainerType) ||
      !date(t.lastSeen) ||
      t.lastSeen > p.observedThrough ||
      [t.sources, t.npcSources, t.creatureSources, t.titleSources].some(
        (n) => !integer(n, MAX.sources),
      )
    )
      invalid();
    list(t.positions, 20);
    if (!t.positions.length) invalid();
    const positions = new Set();
    for (const pos of t.positions) {
      position(pos);
      const key = JSON.stringify([pos.mapId, pos.x, pos.y]);
      if (positions.has(key)) invalid();
      positions.add(key);
    }
    reactions(t.observedReactionsByFaction);
    list(t.services, 500);
    if (!t.services.length) invalid();
    const spells = new Set();
    for (const s of t.services) {
      keys(
        s,
        ["spellId", "name", "observedLevel", "skillRank", "sources"],
        ["rankText", "skill"],
      );
      if (
        !integer(s.spellId) ||
        spells.has(s.spellId) ||
        !text(s.name) ||
        !integer(s.observedLevel, 1000, 0) ||
        !integer(s.skillRank, 10000, 0) ||
        !integer(s.sources, MAX.sources) ||
        (s.rankText !== undefined && !text(s.rankText, 100)) ||
        (s.skill !== undefined && !text(s.skill, 100))
      )
        invalid();
      spells.add(s.spellId);
    }
  }
  for (const i of p.items) {
    keys(i, ["id", "name", "sources"]);
    if (!text(i.name) || !integer(i.sources, MAX.sources)) invalid();
  }
  const expected = coverage(p);
  keys(p.coverage, Object.keys(expected));
  // Dropped counts are summed across merged builds, so their bounds scale with them.
  const k = p.builds.length;
  if (
    !isDeepStrictEqual(p.coverage, expected) ||
    p.coverage.services > MAX.services ||
    p.dropped.questRows + p.coverage.quests > MAX.quests * k ||
    p.dropped.trainerRows + p.coverage.trainers > MAX.trainers * k ||
    p.dropped.services + p.coverage.services > MAX.services * k ||
    p.dropped.items + p.coverage.items > MAX.items * k ||
    p.dropped.positions > 2000 * k ||
    p.dropped.itemDrops > 50000 * k ||
    p.dropped.questFields > 10000 * k ||
    p.dropped.sharingRows > 10000 * k
  )
    invalid();
  return structuredClone(p);
}
// One build's seven files, checked against that build's pinned source entries.
function parseInputs(inputs, { commit, build, sources = sourcesFor(build) }) {
  keys(inputs, FILES);
  if (
    typeof commit !== "string" ||
    (commit === COMMIT && !isDeepStrictEqual(sources, sourcesFor(build))) ||
    !isDeepStrictEqual(checkSources(sources, commit), [build])
  )
    invalid();
  const raw = {};
  let total = 0;
  for (const source of sources) {
    const input = inputs[source.name],
      bytes = Buffer.isBuffer(input)
        ? input
        : Buffer.from(
            typeof input === "string" ? input : JSON.stringify(input),
          );
    if (bytes.length > INPUT_BYTES || (total += bytes.length) > TOTAL_BYTES)
      throw Error("Insights source exceeds bounded size limit.");
    const d = JSON.parse(bytes);
    if (!plain(d) || !isDeepStrictEqual(d.meta, source.meta))
      throw Error("Insights source metadata mismatch.");
    raw[source.name] = d;
  }
  for (const [file, key, max] of [
    [FILES[0], "quests", MAX.quests],
    [FILES[1], "described", MAX.quests],
    [FILES[1], "pushable", MAX.quests],
    [FILES[2], "trainers", MAX.trainers],
    [FILES[3], "npcs", 10000],
    [FILES[4], "creatures", 10000],
    [FILES[5], "creatures", 10000],
    [FILES[6], "items", MAX.items],
  ])
    if (!plain(raw[file][key]) || Object.keys(raw[file][key]).length > max)
      invalid();
  return raw;
}
const entries = (o) =>
  Object.entries(o).sort((a, b) => Number(a[0]) - Number(b[0]));
const canonical = (key) => /^[1-9]\d*$/.test(key) && integer(Number(key));
/**
 * One build. Input hash verification belongs to the compiler; this normalizer also
 * verifies exact metadata against options.sources (default: that build's pinned sources).
 */
function normalizeInsights(inputs, options = {}) {
  const sources = options.sources || sourcesFor(options.build),
    observedThrough = sources.length ? lastDay(sources) : null;
  const r = parseInputs(inputs, { ...options, sources }),
    qs = r[FILES[0]].quests,
    scan = r[FILES[1]],
    ts = r[FILES[2]].trainers,
    ns = r[FILES[3]].npcs,
    cs = r[FILES[4]].creatures,
    ds = r[FILES[5]].creatures;
  const dropped = {
      questRows: 0,
      sharingRows: 0,
      questFields: 0,
      itemDrops: 0,
      trainerRows: 0,
      services: 0,
      positions: 0,
      items: 0,
    },
    quests = [],
    trainers = [],
    items = [];
  for (const [key, q] of entries(qs)) {
    if (
      !canonical(key) ||
      !plain(q) ||
      !text(q.title) ||
      !integer(q.sources, MAX.sources)
    ) {
      dropped.questRows++;
      continue;
    }
    const row = { id: Number(key), title: q.title, sources: q.sources };
    for (const [field, max] of [
      ["startItemId", 2147483647],
      ["timeLimitSeconds", 604800],
    ])
      if (q[field] !== undefined) {
        if (integer(q[field], max)) row[field] = q[field];
        else dropped.questFields++;
      }
    if (q.itemDrops !== undefined) {
      list(q.itemDrops, 10);
      const seen = new Set();
      const drops = [];
      for (const d of q.itemDrops) {
        if (
          !plain(d) ||
          !integer(d.itemId) ||
          !integer(d.count, 1000000) ||
          seen.has(d.itemId)
        ) {
          dropped.itemDrops++;
          continue;
        }
        drops.push({ itemId: d.itemId, count: d.count });
        seen.add(d.itemId);
      }
      if (drops.length)
        row.itemDrops = drops.sort((a, b) => a.itemId - b.itemId);
    }
    const d = scan.described[key],
      s = scan.pushable[key],
      supportedCount = plain(s) && Object.hasOwn(s, "true") ? s.true : 0,
      unsupportedCount = plain(s) && Object.hasOwn(s, "false") ? s.false : 0;
    if (s !== undefined) {
      if (
        plain(d) &&
        d.title === q.title &&
        integer(d.sources, MAX.sources) &&
        plain(s) &&
        Object.keys(s).every((k) => ["true", "false"].includes(k)) &&
        [supportedCount, unsupportedCount].every((n) => integer(n, MAX.sources, 0)) &&
        supportedCount + unsupportedCount <= d.sources
      )
        row.sharing = {
          supportedCount,
          unsupportedCount,
          scanSources: d.sources,
        };
      else dropped.sharingRows++;
    }
    quests.push(row);
  }
  const retainedQuestIds = new Set(quests.map((q) => String(q.id)));
  for (const id of Object.keys(scan.pushable))
    if (!retainedQuestIds.has(id)) dropped.sharingRows++;
  let servicesRead = 0;
  for (const [key, t] of entries(ts)) {
    if (!plain(t)) {
      dropped.trainerRows++;
      continue;
    }
    if (t.services !== undefined && !plain(t.services)) invalid();
    const servicesRaw = Object.entries(t.services || {});
    if (
      servicesRaw.length > 500 ||
      (servicesRead += servicesRaw.length) > MAX.services
    )
      invalid();
    // A trainer's enUS title is a static creature fact. When this build's cache lacks the
    // creature, an exact-ID record from another pinned build may supply it (name must match).
    const fallback = options.fallbackDetails,
      n = ns[key],
      c = cs[key],
      d =
        ds[key] ??
        (plain(fallback) && Object.hasOwn(fallback, key) ? fallback[key] : undefined);
    if (
      !canonical(key) ||
      !text(t.name) ||
      !plain(n) ||
      !plain(c) ||
      !plain(d) ||
      n.name !== t.name ||
      c.name !== t.name ||
      d.name !== t.name ||
      !Array.isArray(n.interactions) ||
      !n.interactions.includes("Trainer") ||
      !text(d.title) ||
      ![0, 2].includes(t.trainerType) ||
      !date(t.lastSeen) ||
      t.lastSeen > observedThrough ||
      [t.sources, n.sources, c.sources, d.sources].some(
        (v) => !integer(v, MAX.sources),
      )
    ) {
      dropped.trainerRows++;
      dropped.services += servicesRaw.length;
      continue;
    }
    list(t.positions, 20);
    const positions = [],
      seen = new Set();
    for (const p of t.positions) {
      const pos = { mapId: p?.uiMap, x: p?.mapX, y: p?.mapY };
      try {
        position(pos);
      } catch {
        dropped.positions++;
        continue;
      }
      const k = JSON.stringify(pos);
      if (!seen.has(k)) {
        positions.push(pos);
        seen.add(k);
      }
    }
    const services = [];
    for (const [id, s] of servicesRaw) {
      if (
        !canonical(id) ||
        !plain(s) ||
        s.spellId !== Number(id) ||
        !text(s.name) ||
        !integer(s.level, 1000, 0) ||
        !integer(s.skillRank, 10000, 0) ||
        !integer(s.sources, MAX.sources) ||
        (s.rankText !== undefined && !text(s.rankText, 100)) ||
        (s.skill !== undefined && !text(s.skill, 100))
      ) {
        dropped.services++;
        continue;
      }
      services.push({
        spellId: s.spellId,
        name: s.name,
        ...(s.rankText !== undefined ? { rankText: s.rankText } : {}),
        observedLevel: s.level,
        ...(s.skill !== undefined ? { skill: s.skill } : {}),
        skillRank: s.skillRank,
        sources: s.sources,
      });
    }
    let observedReactionsByFaction = {};
    try {
      reactions(c.reactions ?? {});
      observedReactionsByFaction = structuredClone(c.reactions ?? {});
      for (const a of Object.values(observedReactionsByFaction))
        a.sort((a, b) => a - b);
    } catch {
      dropped.trainerRows++;
      dropped.services += services.length;
      continue;
    }
    if (!positions.length || !services.length) {
      dropped.trainerRows++;
      dropped.services += services.length;
      continue;
    }
    trainers.push({
      id: Number(key),
      name: t.name,
      title: d.title,
      trainerType: t.trainerType,
      sources: t.sources,
      npcSources: n.sources,
      creatureSources: c.sources,
      titleSources: d.sources,
      lastSeen: t.lastSeen,
      positions: positions.sort(
        (a, b) => a.mapId - b.mapId || a.x - b.x || a.y - b.y,
      ),
      observedReactionsByFaction,
      services: services.sort((a, b) => a.spellId - b.spellId),
    });
  }
  for (const [key, i] of entries(r[FILES[6]].items)) {
    if (
      !canonical(key) ||
      !plain(i) ||
      i.status !== "valid" ||
      !text(i.name) ||
      !integer(i.sources, MAX.sources)
    ) {
      dropped.items++;
      continue;
    }
    items.push({ id: Number(key), name: i.name, sources: i.sources });
  }
  const p = {
    schemaVersion: 1,
    kind: "forever-insights",
    product: "wowf",
    build: options.build,
    builds: [options.build],
    sourceCommit: options.commit,
    license: "CC BY 4.0",
    attribution: ATTRIBUTION,
    observedThrough,
    textLocale: "enUS",
    observationNamesLocale: "unspecified",
    sources: structuredClone(sources),
    coverage: {},
    dropped,
    quests,
    trainers,
    items,
  };
  p.coverage = coverage(p);
  return validateInsights(p, { pinned: false });
}
const firstDefined = (rows, k) => rows.find((r) => r[k] !== undefined)?.[k];
function mergeQuestRows(rows) {
  const [head] = rows,
    q = {
      id: head.id,
      title: head.title,
      sources: Math.max(...rows.map((r) => r.sources)),
    };
  for (const k of ["startItemId", "timeLimitSeconds"]) {
    const v = firstDefined(rows, k);
    if (v !== undefined) q[k] = v;
  }
  const drops = new Map();
  for (const r of rows)
    for (const d of r.itemDrops || [])
      if (!drops.has(d.itemId) && drops.size < 10) drops.set(d.itemId, { ...d });
  if (drops.size) q.itemDrops = [...drops.values()].sort((a, b) => a.itemId - b.itemId);
  // Sharing answers come from one scan; the newest build that scanned the quest wins.
  const sharing = firstDefined(rows, "sharing");
  if (sharing) q.sharing = { ...sharing };
  return q;
}
function mergeTrainerRows(rows) {
  const [head] = rows,
    max = (k) => Math.max(...rows.map((r) => r[k]));
  const positions = [],
    seen = new Set();
  for (const r of rows)
    for (const p of r.positions) {
      const k = JSON.stringify([p.mapId, p.x, p.y]);
      if (!seen.has(k) && positions.length < 20) {
        seen.add(k);
        positions.push({ ...p });
      }
    }
  const reactions = {};
  for (const r of rows)
    for (const [faction, values] of Object.entries(r.observedReactionsByFaction))
      reactions[faction] = [...new Set([...(reactions[faction] || []), ...values])]
        .sort((a, b) => a - b)
        .slice(0, 8);
  // Newest listing wins per spell, but a reported level beats an unknown (zero) one.
  const services = new Map();
  for (const r of rows)
    for (const sv of r.services) {
      const m = services.get(sv.spellId);
      if (!m) {
        if (services.size < 500) services.set(sv.spellId, { ...sv });
        continue;
      }
      m.sources = Math.max(m.sources, sv.sources);
      if (!m.observedLevel && sv.observedLevel) m.observedLevel = sv.observedLevel;
    }
  return {
    id: head.id,
    name: head.name,
    title: head.title,
    trainerType: head.trainerType,
    sources: max("sources"),
    npcSources: max("npcSources"),
    creatureSources: max("creatureSources"),
    titleSources: max("titleSources"),
    lastSeen: rows.map((r) => r.lastSeen).sort().at(-1),
    positions,
    observedReactionsByFaction: Object.fromEntries(
      ["Alliance", "Horde"].filter((f) => reactions[f]).map((f) => [f, reactions[f]]),
    ),
    services: [...services.values()].sort((a, b) => a.spellId - b.spellId),
  };
}
function mergeRows(packs, collection, merge) {
  const byId = new Map();
  for (const p of packs)
    for (const row of p[collection]) {
      if (!byId.has(row.id)) byId.set(row.id, []);
      byId.get(row.id).push(row);
    }
  return [...byId.values()].map(merge).sort((a, b) => a.id - b.id);
}
/**
 * Merge per-build insights packs given newest-first (same commit). Rows are unioned by ID;
 * scalar facts come from the newest build; positions/reactions/services are unioned with caps.
 */
function mergeInsights(packs, { pinned = false } = {}) {
  if (!Array.isArray(packs) || !packs.length || packs.length > MAX.builds) invalid();
  const valid = packs.map((p) => validateInsights(p, { pinned: false }));
  if (valid.some((p) => p.sourceCommit !== valid[0].sourceCommit)) invalid();
  const sources = [],
    seen = new Set();
  for (const p of valid)
    for (const s of p.sources)
      if (!seen.has(`${s.build}/${s.name}`)) {
        seen.add(`${s.build}/${s.name}`);
        sources.push(structuredClone(s));
      }
  const builds = [...new Set(sources.map((s) => s.build))];
  const dropped = Object.fromEntries(
    Object.keys(valid[0].dropped).map((k) => [k, valid.reduce((n, p) => n + p.dropped[k], 0)]),
  );
  const p = {
    schemaVersion: 1,
    kind: "forever-insights",
    product: "wowf",
    build: builds[0],
    builds,
    sourceCommit: valid[0].sourceCommit,
    license: "CC BY 4.0",
    attribution: ATTRIBUTION,
    observedThrough: lastDay(sources),
    textLocale: "enUS",
    observationNamesLocale: "unspecified",
    sources,
    coverage: {},
    dropped,
    quests: mergeRows(valid, "quests", mergeQuestRows),
    trainers: mergeRows(valid, "trainers", mergeTrainerRows),
    items: mergeRows(valid, "items", (rows) => ({
      id: rows[0].id,
      name: rows[0].name,
      sources: Math.max(...rows.map((r) => r.sources)),
    })),
  };
  p.coverage = coverage(p);
  return validateInsights(p, { pinned });
}
function loadBundledInsights(
  file = path.join(__dirname, "../../data/forever-insights/pack.json"),
) {
  try {
    if (fs.statSync(file).size > PACK_BYTES) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.length > PACK_BYTES) return null;
    return validateInsights(JSON.parse(bytes));
  } catch {
    return null;
  }
}
const source = (p) => ({
  publisher: "Efficient Games",
  build: p.build,
  sourceCommit: p.sourceCommit,
  observedThrough: p.observedThrough,
  attribution: p.attribution,
  textLocale: p.textLocale,
  observationNamesLocale: p.observationNamesLocale,
});
function itemInsights(pack, ids) {
  if (!pack) return [];
  if (!Array.isArray(ids) || ids.length > 20 || ids.some((id) => !integer(id)))
    invalid();
  return [...new Set(ids)].map((id) => {
    const item = pack.items.find((i) => i.id === id);
    return {
      id,
      name: item?.name || `Item #${id}`,
      named: Boolean(item),
      ...(item ? { sources: item.sources } : {}),
    };
  });
}
function questInsights(pack, { id, title, build, locale } = {}) {
  if (!pack) return null;
  const unavailable = (reason) => ({
    status: "unavailable",
    reason,
    source: source(pack),
  });
  if (build && build !== pack.build)
    return unavailable(
      "Saved game build differs from the bundled supplementary reference.",
    );
  if (locale && locale !== pack.textLocale)
    return unavailable(
      "Saved game locale differs from the English supplementary reference.",
    );
  const q = pack.quests.find((q) => q.id === id);
  if (!q)
    return unavailable("No supplementary record for this exact quest ID.");
  if (q.title !== title)
    return unavailable(
      "Quest title differs from the supplementary reference; exact ID and title are required.",
    );
  const s = q.sharing,
    supported = s?.supportedCount ?? 0,
    unsupported = s?.unsupportedCount ?? 0;
  return structuredClone({
    status: "available",
    id: q.id,
    title: q.title,
    sources: q.sources,
    source: source(pack),
    sharing: {
      status:
        supported && unsupported
          ? "mixed"
          : supported
            ? "supported"
            : unsupported
              ? "unsupported"
              : "unknown",
      supportedCount: supported,
      unsupportedCount: unsupported,
      scanSources: s?.scanSources ?? 0,
    },
    ...(q.startItemId
      ? { startItem: itemInsights(pack, [q.startItemId])[0] }
      : {}),
    ...(q.timeLimitSeconds ? { timeLimitSeconds: q.timeLimitSeconds } : {}),
    itemDrops: (q.itemDrops || []).map((d) => ({
      ...d,
      name: itemInsights(pack, [d.itemId])[0].name,
    })),
  });
}
/** Bounded historical browsing; class/faction/eligibility decisions belong to the guidance engine. */
function trainerInsights(
  pack,
  { query = "", limit = 3, serviceLimit = 6 } = {},
) {
  if (!pack) return [];
  if (
    typeof query !== "string" ||
    query.length > 100 ||
    !integer(limit, 100) ||
    !integer(serviceLimit, 500)
  )
    invalid();
  const term = query.toLowerCase();
  return structuredClone(
    pack.trainers
      .filter((t) => `${t.name} ${t.title}`.toLowerCase().includes(term))
      .slice(0, limit)
      .map((t) => ({ ...t, services: t.services.slice(0, serviceLimit) })),
  );
}
module.exports = {
  FILES,
  INPUT_BYTES,
  TOTAL_BYTES,
  PACK_BYTES,
  MAX,
  normalizeInsights,
  mergeInsights,
  validateInsights,
  loadBundledInsights,
  questInsights,
  itemInsights,
  trainerInsights,
};
