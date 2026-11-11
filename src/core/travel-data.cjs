"use strict";
const { isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");
const {
  COMMIT,
  BUILD,
  INPUTS,
  SOURCES,
  CITIES,
  ENDPOINTS,
  MASTERS,
  FLIGHTS,
  TRANSPORTS,
  ROAD_STEPS,
} = require("./travel-sources.cjs");
const PACK_BYTES = 256 * 1024,
  INPUT_BYTES = 4 * 1024 * 1024,
  TOTAL_BYTES = 5 * 1024 * 1024;
// Updating evidence requires deliberate review of this canonical compiled identity.
const PINNED_PACK = {
  bytes: 12514,
  sha256: "6c9f49c58cad59056243fa4f8ffdab3a034504735143601f58b22c90127a6dbe",
};
const fail = (reason) => {
  throw Error("Travel reference: " + reason);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function record(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("invalid record");
  if (
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => ![...required, ...optional].includes(k))
  )
    fail("unexpected or missing fields");
}
function text(value, max = 400) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f<>]/.test(value)
  )
    fail("invalid text");
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value) ||
    ["constructor", "prototype"].includes(value)
  )
    fail("invalid ID");
}
function list(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail("array bounds");
}
function unique(values) {
  if (new Set(values).size !== values.length) fail("duplicate identity");
}
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("invalid date");
}
function position(p) {
  record(p, ["uiMap", "mapX", "mapY"]);
  if (
    !Number.isSafeInteger(p.uiMap) ||
    p.uiMap < 1 ||
    p.uiMap > 2147483647 ||
    !Number.isFinite(p.mapX) ||
    !Number.isFinite(p.mapY) ||
    p.mapX < 0 ||
    p.mapX > 1 ||
    p.mapY < 0 ||
    p.mapY > 1
  )
    fail("invalid position");
}
function normalizeAlias(s) {
  return s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ").trim();
}
function validateTravelReference(p) {
  record(p, [
    "schemaVersion",
    "kind",
    "product",
    "build",
    "commit",
    "reviewedOn",
    "sources",
    "nodes",
    "edges",
    "negatives",
    "itineraries",
  ]);
  if (
    p.schemaVersion !== 1 ||
    p.kind !== "forever-travel" ||
    p.product !== "wowf" ||
    p.build !== BUILD ||
    p.commit !== COMMIT ||
    p.reviewedOn !== "2026-11-10"
  )
    fail("schema/provenance mismatch");
  date(p.reviewedOn);
  list(p.sources, 32, 1);
  for (const s of p.sources) {
    const known = SOURCES.find((k) => k.id === s.id);
    if (!known || !isDeepStrictEqual(s, known))
      fail("source provenance mismatch");
    date(s.reviewedOn);
    date(s.publishedOn || s.observedOn);
  }
  unique(p.sources.map((s) => s.id));
  const refs = (ids) => {
    list(ids, 8, 1);
    unique(ids);
    if (ids.some((id) => !p.sources.some((s) => s.id === id)))
      fail("unknown source");
  };
  list(p.nodes, 64, 1);
  unique(p.nodes.map((n) => n.id));
  const aliases = [];
  for (const n of p.nodes) {
    record(
      n,
      ["id", "label", "kind", "aliases", "sourceIds"],
      ["cityId", "flightMaster", "position"],
    );
    id(n.id);
    text(n.label, 100);
    if (!["city", "transport-endpoint"].includes(n.kind)) fail("node kind");
    list(n.aliases, 4, 1);
    refs(n.sourceIds);
    for (const a of n.aliases) {
      text(a, 100);
      if (!/^[a-z][a-z '\-]*$/.test(normalizeAlias(a))) fail("invalid alias");
      aliases.push(normalizeAlias(a));
    }
    if (
      n.kind === "transport-endpoint" &&
      (!n.cityId ||
        !p.nodes.some((c) => c.id === n.cityId && c.kind === "city"))
    )
      fail("unknown endpoint city");
    if (n.kind === "city" && n.cityId) fail("unexpected city reference");
    if (n.position) position(n.position);
    if (n.flightMaster) {
      record(n.flightMaster, ["npcId", "taxiNode", "name", "questId"]);
      const expected = MASTERS.find((m) => m.city === n.id);
      if (
        !expected ||
        !isDeepStrictEqual(
          n.flightMaster,
          (({ city, ...rest }) => rest)(expected),
        )
      )
        fail("flight master mapping");
    }
  }
  unique(aliases);
  const fact = (e, fields, optional = []) => {
    record(
      e,
      ["id", "from", "to", "mode", "faction", "scope", "sourceIds", ...fields],
      optional,
    );
    id(e.id);
    if (
      !p.nodes.some((n) => n.id === e.from) ||
      !p.nodes.some((n) => n.id === e.to) ||
      e.from === e.to
    )
      fail("unknown or identical endpoints");
    if (
      !["flight", "zeppelin", "boat", "tram", "road"].includes(e.mode) ||
      !["Horde", "Alliance", "neutral"].includes(e.faction)
    )
      fail("mode/faction");
    refs(e.sourceIds);
    if (
      !["exact-build-observation", "published-forever-guidance"].includes(
        e.scope,
      )
    )
      fail("fact scope");
    if (
      e.scope === "exact-build-observation"
        ? e.sourceIds.some((s) => s !== "E1") ||
          e.build !== BUILD ||
          e.observedOn !== "2026-11-09"
        : e.build !== undefined ||
          e.observedOn !== undefined ||
          e.sourceIds.includes("E1")
    )
      fail("fact provenance scope");
    if (e.observedOn) date(e.observedOn);
  };
  list(p.edges, 128);
  unique(p.edges.map((e) => e.id));
  unique(p.edges.map((e) => [e.from, e.to, e.mode].join("|")));
  for (const e of p.edges) {
    fact(e, ["conditional", "steps"], ["build", "observedOn", "rawKey"]);
    if (e.conditional !== true)
      fail("transport availability must remain conditional");
    list(e.steps, 12, 1);
    e.steps.forEach((s) => text(s));
    if (e.mode === "flight") {
      const from = p.nodes.find((n) => n.id === e.from),
        to = p.nodes.find((n) => n.id === e.to);
      if (
        e.scope !== "exact-build-observation" ||
        !from.flightMaster ||
        !to.flightMaster ||
        e.rawKey !==
          from.flightMaster.taxiNode + ">" + to.flightMaster.taxiNode ||
        !FLIGHTS.includes(e.rawKey)
      )
        fail("flight evidence");
    } else if (
      e.scope !== "published-forever-guidance" ||
      e.rawKey !== undefined ||
      !TRANSPORTS.some(
        ([from, to, mode, faction]) =>
          e.from === from &&
          e.to === to &&
          e.mode === mode &&
          e.faction === faction,
      )
    )
      fail("unsupported directed transport");
  }
  list(p.negatives, 16);
  unique(p.negatives.map((n) => n.id));
  for (const n of p.negatives) {
    fact(n, ["text"]);
    text(n.text);
    if (
      n.from !== "orgrimmar" ||
      n.to !== "thunder-bluff" ||
      n.mode !== "zeppelin" ||
      n.scope !== "published-forever-guidance" ||
      !isDeepStrictEqual(n.sourceIds, ["E2", "E3"])
    )
      fail("unsupported negative");
    if (
      p.edges.some(
        (e) => e.from === n.from && e.to === n.to && e.mode === n.mode,
      )
    )
      fail("contradictory negative");
  }
  list(p.itineraries, 16);
  unique(p.itineraries.map((i) => i.id));
  for (const i of p.itineraries) {
    fact(i, ["steps"]);
    list(i.steps, 12, 1);
    i.steps.forEach((s) => text(s));
    if (
      i.mode !== "road" ||
      i.from !== "orgrimmar" ||
      i.to !== "thunder-bluff" ||
      i.scope !== "published-forever-guidance"
    )
      fail("unsupported itinerary");
  }
  unique([...p.edges, ...p.negatives, ...p.itineraries].map((f) => f.id));
  const canonical = JSON.stringify(p) + "\n";
  if (
    Buffer.byteLength(canonical) !== PINNED_PACK.bytes ||
    hash(canonical) !== PINNED_PACK.sha256
  )
    fail("immutable compiled factual provenance mismatch");
  return p;
}
function loadTravelReference(bytes) {
  if (
    !(typeof bytes === "string" || Buffer.isBuffer(bytes)) ||
    Buffer.byteLength(bytes) > PACK_BYTES
  )
    fail("compiled byte limit");
  try {
    return validateTravelReference(JSON.parse(bytes));
  } catch (error) {
    fail(error.message);
  }
}
function compileTravelReference(inputs) {
  record(
    inputs,
    INPUTS.map((s) => s.name),
  );
  const raw = {};
  let total = 0;
  for (const s of INPUTS) {
    const bytes = inputs[s.name];
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > INPUT_BYTES ||
      (total += bytes.length) > TOTAL_BYTES ||
      bytes.length !== s.bytes
    )
      fail("source bytes mismatch: " + s.name);
    if (hash(bytes) !== s.sha256) fail("source hash mismatch: " + s.name);
    raw[s.name] = JSON.parse(bytes);
    if (!isDeepStrictEqual(raw[s.name].meta, s.meta))
      fail("source metadata mismatch: " + s.name);
  }
  const f = raw["flights.json"],
    npcs = raw["npcs.json"].npcs,
    quests = raw["quests.enUS.json"].quests;
  const nodes = CITIES.map(([id, label, aliases]) => ({
    id,
    label,
    kind: "city",
    aliases: [...aliases],
    sourceIds: ["E4"],
  }));
  for (const m of MASTERS) {
    const fm = f.masters[m.npcId],
      npc = npcs[m.npcId],
      quest = quests[m.questId],
      city = nodes.find((n) => n.id === m.city);
    if (
      fm?.name !== m.name ||
      fm?.node !== m.taxiNode ||
      npc?.name !== m.name ||
      npc?.side !== "Horde" ||
      !npc.interactions.includes("TaxiNode") ||
      !quest?.objectivesText?.includes(m.name) ||
      !quest.objectivesText.includes(city.label)
    )
      fail("raw locality/master mapping");
    const { city: unused, ...master } = m;
    city.flightMaster = { ...master };
    city.sourceIds = ["E1"];
    const { uiMap, mapX, mapY } = npc.positions[0];
    city.position = { uiMap, mapX, mapY };
  }
  nodes.push(
    ...ENDPOINTS.map(([id, label, cityId]) => ({
      id,
      label,
      cityId,
      kind: "transport-endpoint",
      aliases: [normalizeAlias(label)],
      sourceIds: ["E4"],
    })),
  );
  const edges = FLIGHTS.map((rawKey) => {
    const [a, b] = rawKey.split(">").map(Number),
      r = f.routes[rawKey],
      from = MASTERS.find((m) => m.taxiNode === a),
      to = MASTERS.find((m) => m.taxiNode === b);
    if (
      !r ||
      !isDeepStrictEqual(r.hops, [a, b]) ||
      !Number.isSafeInteger(r.sources) ||
      r.sources < 1
    )
      fail("raw directed flight");
    return {
      id: "flight-" + from.city + "-" + to.city,
      from: from.city,
      to: to.city,
      mode: "flight",
      faction: "Horde",
      scope: "exact-build-observation",
      sourceIds: ["E1"],
      build: BUILD,
      observedOn: "2026-11-09",
      rawKey,
      conditional: true,
      steps: [
        "Check " +
          from.name +
          " for " +
          nodes.find((n) => n.id === to.city).label +
          ". If that destination is offered, take the flight. Your unlocked routes are unknown.",
      ],
    };
  });
  for (const [from, to, mode, faction] of TRANSPORTS) {
    const label = (id) => nodes.find((n) => n.id === id).label;
    const access =
      from === "orgrimmar-zeppelin-tower"
        ? "The Orgrimmar tower is outside the main gate."
        : from === "tirisfal-zeppelin-tower"
          ? "The Tirisfal tower is north of Undercity; boarding is outside the city."
          : "This covered segment starts at " +
            label(from) +
            "; the approach from elsewhere in the city is not mapped here.";
    edges.push({
      id: mode + "-" + from + "-" + to,
      from,
      to,
      mode,
      faction,
      scope: "published-forever-guidance",
      sourceIds: ["E4"],
      conditional: true,
      steps: [
        access,
        "At " +
          label(from) +
          ", confirm the " +
          mode +
          " is operating to " +
          label(to) +
          " before boarding.",
        "The documented segment ends at " +
          label(to) +
          "; onward travel is not covered.",
      ],
    });
  }
  const pack = {
    schemaVersion: 1,
    kind: "forever-travel",
    product: "wowf",
    build: BUILD,
    commit: COMMIT,
    reviewedOn: "2026-11-10",
    sources: structuredClone(SOURCES),
    nodes,
    edges,
    negatives: [
      {
        id: "no-direct-org-tb-zeppelin",
        from: "orgrimmar",
        to: "thunder-bluff",
        mode: "zeppelin",
        faction: "Horde",
        scope: "published-forever-guidance",
        sourceIds: ["E2", "E3"],
        text: "The published Forever guides state there is no direct Orgrimmar to Thunder Bluff zeppelin. Other Horde zeppelin routes are documented.",
      },
    ],
    itineraries: [
      {
        id: "org-tb-road",
        from: "orgrimmar",
        to: "thunder-bluff",
        mode: "road",
        faction: "Horde",
        scope: "published-forever-guidance",
        sourceIds: ["E2", "E3"],
        steps: [...ROAD_STEPS],
      },
    ],
  };
  const bytes = JSON.stringify(pack) + "\n";
  loadTravelReference(bytes);
  return bytes;
}
module.exports = {
  PACK_BYTES,
  INPUT_BYTES,
  TOTAL_BYTES,
  loadTravelReference,
  validateTravelReference,
  compileTravelReference,
};
