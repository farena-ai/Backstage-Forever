"use strict";
const { createHash } = require("node:crypto");
const { validateState, str } = require("./validation.cjs");
const { buildGuidance, snapshotFreshness } = require("./guidance.cjs");
const { validateGatheringProfile } = require("./gathering-data.cjs");
const {
  buildProfessionCoach,
  validateProfessionOptions,
} = require("./profession-coach.cjs");
const {
  validateAcquisitionPack,
  acquisitionFacts,
} = require("./acquisition-data.cjs");
const { sellerFacts, validateVendorPack } = require("./vendor-facts.cjs");
const LAYERS = [
  "quest",
  "herbs",
  "ore",
  "supplies",
  "finds",
  "olderReferences",
];
const positive = (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const coordinate = (n) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const point = (p) => positive(p?.mapId) && coordinate(p.x) && coordinate(p.y);
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some((k) => !keys.includes(k))
  )
    throw Error("Invalid adventure map request.");
}
function validateAdventureMapOptions(value = {}) {
  object(value, ["mapId", "layers", "goal"]);
  const out = {};
  if (value.mapId !== undefined) {
    if (!positive(value.mapId)) throw Error("Invalid adventure map request.");
    out.mapId = value.mapId;
  }
  if (value.layers !== undefined) {
    object(value.layers, LAYERS);
    out.layers = {};
    for (const key of Object.keys(value.layers)) {
      if (typeof value.layers[key] !== "boolean")
        throw Error("Invalid adventure map request.");
      out.layers[key] = value.layers[key];
    }
  }
  if (value.goal !== undefined)
    out.goal = validateProfessionOptions(value.goal);
  return out;
}
const stableId = (parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
/** Local display projection only. All inputs remain detached; no navigation commands are returned. */
function buildAdventureMap(state, profileId, options = {}, dependencies = {}) {
  if (profileId !== null) str(profileId, 100, false);
  const settings = validateAdventureMapOptions(options),
    copy = structuredClone(state),
    invalidHistory = new Set();
  // Optional damaged history cannot blank valid quest observations, or retain prior geometry.
  for (const p of copy.profiles || [])
    try {
      validateGatheringProfile(p.gathering);
      if (p.source && p.gathering?.observedAt > p.source.updatedAt)
        throw Error();
    } catch {
      invalidHistory.add(p.id);
      delete p.gathering;
    }
  const valid = validateState(copy),
    p = valid.profiles.find((p) => p.id === profileId),
    saved = p?.source?.kind === "wow-addon",
    now = dependencies.now ?? Date.now();
  const fresh = snapshotFreshness(p, now),
    history = saved ? p.gathering : undefined;
  let pack = null;
  try {
    pack = validateAcquisitionPack(dependencies.acquisitionPack);
  } catch {}
  let vendorPack = null;
  try {
    vendorPack = validateVendorPack(dependencies.vendorPack);
  } catch {}
  const coach = buildProfessionCoach(valid, profileId, settings.goal || {}, {
    acquisitionPack: pack,
    vendorPack,
  });
  const owned = p?.readiness?.workshop?.professions?.items || [],
    methods = new Set(owned.map((p) => p.skillLineId));
  const needed = new Set(coach.shoppingRows.map((r) => r.itemId));
  const relevant =
    pack?.rows.filter(
      (r) =>
        needed.has(r.itemId) ||
        (r.gatherSpellId === 2368 && methods.has(182)) ||
        (r.gatherSpellId === 2576 && methods.has(186)),
    ) || [];
  const layers = {
    quest: true,
    herbs: methods.has(182) || relevant.some((r) => r.gatherSpellId === 2368),
    ore: methods.has(186) || relevant.some((r) => r.gatherSpellId === 2576),
    supplies: true,
    finds: true,
    olderReferences: false,
    ...settings.layers,
  };
  const all = [];
  function add(
    kind,
    pos,
    title,
    detail,
    evidence,
    precision,
    qualification,
    layer,
    itemIds,
    sources,
    identity,
  ) {
    if (!point(pos)) return;
    all.push({
      id: stableId([kind, ...identity, pos.mapId, pos.x, pos.y]),
      kind,
      mapId: pos.mapId,
      x: pos.x,
      y: pos.y,
      title,
      detail,
      evidence,
      precision,
      qualification,
      layer,
      itemIds: [...new Set(itemIds)].sort((a, b) => a - b),
      sources,
    });
  }
  if (saved) {
    let guide;
    try {
      guide = buildGuidance(p, { now, knowledge: dependencies.knowledge });
    } catch {
      guide = buildGuidance(p, { now });
    }
    for (const q of guide.candidates) {
      const pos = q.destination || q.referenceDestination;
      if (!pos) continue;
      const game = Boolean(q.destination);
      add(
        "quest",
        pos,
        q.title,
        game
          ? "Game quest marker from your saved snapshot."
          : "Approximate matching-build quest reference; check in game.",
        game ? "game-snapshot" : pos.evidence,
        game ? "game-marker" : "approximate-reference",
        game ? "game" : "qualified-historical",
        "quest",
        [],
        [
          {
            authority: game ? "saved-game" : "quest-reference",
            build: p.clientBuild || null,
            observedAt: game ? p.source.updatedAt : pos.observedThrough || null,
            qualification: game ? "game" : "qualified-historical",
          },
        ],
        [q.questId, q.kind],
      );
    }
    for (const r of history?.records || [])
      add(
        "find",
        r,
        r.name || "Your recorded find",
        "Your recorded standing interaction, not an exact node or a currently spawned resource.",
        r.evidence,
        r.precision,
        "own-recorded",
        "finds",
        r.itemIds,
        [
          {
            authority: "personal-journal",
            build: r.clientBuild,
            observedAt: r.observedAt,
            qualification: "own-recorded",
            method: r.method,
          },
        ],
        [r.method, r.entityId, r.clientBuild],
      );
  }
  // Requested non-default layers browse the bounded approved catalog, never a new datasource.
  const ids = [
    ...new Set([
      ...needed,
      ...(pack?.rows
        .filter(
          (r) =>
            (r.gatherSpellId === 2368 && layers.herbs) ||
            (r.gatherSpellId === 2576 && layers.ore),
        )
        .map((r) => r.itemId) || []),
    ]),
  ].slice(0, 40);
  const acq = acquisitionFacts(pack, p, ids);
  for (const row of acq.rows)
    for (const r of row.sources) {
      const layer =
        r.gatherSpellId === 2368
          ? "herbs"
          : r.gatherSpellId === 2576
            ? "ore"
            : "supplies";
      for (const pos of r.positions)
        add(
          "material",
          pos,
          r.referenceName,
          r.reason,
          r.positionEvidence,
          "approximate-reference",
          r.qualification,
          layer,
          [row.itemId],
          [
            {
              authority: "acquisition-reference",
              itemIds: [row.itemId],
              build: r.clientBuild,
              observedAt: r.observedOn,
              qualification: r.qualification,
              context: [...r.context],
              limitedStock: r.limitedStock,
              contributorFiles: r.contributingFiles,
              reason: r.reason,
            },
          ],
          [r.kind, r.entityId, r.clientBuild],
        );
    }
  let sellers = null;
  try {
    sellers = sellerFacts(dependencies.vendorPack, p, [...needed].slice(0, 20));
  } catch {}
  for (const row of sellers?.rows || [])
    for (const r of [...row.suggestions, ...row.browse])
      for (const pos of r.positions.slice(0, 3))
        add(
          "material",
          pos,
          r.name,
          r.qualification,
          "historical-player-standing-interaction-point",
          "approximate-reference",
          r.suggested ? "qualified-historical" : "browse-only",
          "supplies",
          [row.itemId],
          [
            {
              authority: "seller-reference",
              itemIds: [row.itemId],
              build: sellers.source.build,
              observedAt: r.lastSeen,
              qualification: r.suggested
                ? "qualified-historical"
                : "browse-only",
              context: [],
              limitedStock: null,
              contributorFiles: r.sources,
              reason: r.qualification,
            },
          ],
          ["historical-vendor-listing", r.id, sellers.source.build],
        );
  const merged = new Map();
  for (const entry of all) {
    const old = merged.get(entry.id);
    if (!old) {
      merged.set(entry.id, entry);
      continue;
    }
    old.itemIds = [...new Set([...old.itemIds, ...entry.itemIds])].sort(
      (a, b) => a - b,
    );
    for (const source of entry.sources)
      if (
        !old.sources.some((s) => JSON.stringify(s) === JSON.stringify(source))
      )
        old.sources.push(source);
    if (entry.qualification === "browse-only")
      old.qualification = "browse-only";
  }
  const savedMap =
    saved && positive(p.location?.mapId) ? p.location.mapId : null;
  const maps = [
    ...new Set(
      [savedMap, ...[...merged.values()].map((r) => r.mapId)].filter(Boolean),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 128);
  const mapId = settings.mapId ?? savedMap ?? maps[0] ?? null;
  if (mapId && !maps.includes(mapId)) {
    maps.unshift(mapId);
    maps.splice(128);
  }
  const label = (id) =>
    id === savedMap && p.location.zone ? p.location.zone : `Map ${id}`;
  const visible = [...merged.values()].filter(
    (r) =>
      r.mapId === mapId &&
      layers[r.layer] &&
      (r.qualification !== "browse-only" || layers.olderReferences),
  );
  const points = visible.slice(0, 128),
    playerPosition =
      saved && mapId === savedMap && point(p.location)
        ? {
            mapId,
            x: p.location.x,
            y: p.location.y,
            label: "Last-saved position",
          }
        : null;
  return structuredClone({
    version: 1,
    status: !p ? "no-character" : mapId ? "available" : "no-location",
    character: p
      ? {
          id: p.id,
          name: p.name,
          className: p.className,
          faction: p.faction || null,
          level: p.level,
        }
      : null,
    source: {
      kind: saved ? "saved-addon" : "manual",
      build: saved ? p.clientBuild || null : null,
      savedAt: saved ? p.source.updatedAt : null,
      freshness: fresh.status,
      live: false,
    },
    view: {
      mapId,
      label: mapId ? label(mapId) : "No saved area",
      kind: mapId === savedMap && savedMap ? "saved" : "reference",
      maps: maps.map((id) => ({ mapId: id, label: label(id) })),
    },
    playerPosition,
    points,
    counts: {
      quest: points.filter((p) => p.kind === "quest").length,
      material: points.filter((p) => p.kind === "material").length,
      find: points.filter((p) => p.kind === "find").length,
      total: points.length,
      omitted: Math.max(0, visible.length - points.length),
    },
    layers,
    goal: coach.selection,
    references: {
      acquisition: {
        status: acq.status,
        relations: pack?.rows.length || 0,
        build: pack?.clientBuild || null,
        attribution: pack ? "Efficient Games · CC BY 4.0" : null,
      },
      sellers: {
        status: sellers ? "available" : "unavailable",
        scope:
          "Broader desktop seller catalog; native map uses seven selected acquisition relations.",
        build: sellers?.source.build || null,
      },
    },
    gathering: {
      status: invalidHistory.has(profileId)
        ? "invalid"
        : history?.status || "missing",
      recording: history?.recording ?? false,
      limited: history?.limited ?? false,
      totalRecords: history?.totalRecords ?? 0,
      shown: points.filter((p) => p.kind === "find").length,
      formatReceived: dependencies.formatReceived === true,
    },
    limitations: [
      "Last-saved location view; full live map in WoW.",
      playerPosition
        ? "Your marker is a saved standing point, never live."
        : savedMap && mapId !== savedMap
          ? "Your saved position is in another area."
          : "Position not recorded; no character marker is shown.",
      "Reference points are historical approximate standing observations. Presence, access, rank, stock and prices remain unknown.",
      "No terrain, roads, safe routes, respawn times or exact nodes are established. Missing references do not mean unobtainable.",
      "Your finds stay in your private local journal; they are not automatically shared with AI or support.",
    ],
  });
}
module.exports = { validateAdventureMapOptions, buildAdventureMap };
