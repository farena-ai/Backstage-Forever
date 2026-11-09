"use strict";
const { validateJourneys } = require("./journeys.cjs");
const {
  validateQuestData,
  validateProgress,
  validateHistory,
} = require("./quest-data.cjs");
const providers = [
  {
    id: "ollama",
    name: "Ollama",
    endpoint: "http://127.0.0.1:11434",
    help: "Run Ollama locally and enter an installed model name.",
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    endpoint: "https://ollama.com",
    help: "Use an Ollama Cloud API key; models run in the cloud.",
  },
  {
    id: "openai",
    name: "OpenAI API",
    endpoint: "https://api.openai.com",
    help: "Requires separate API access and billing.",
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    endpoint: "https://api.anthropic.com",
    help: "Requires separate API access and billing.",
  },
  {
    id: "xai",
    name: "xAI API",
    endpoint: "https://api.x.ai",
    help: "Requires separate API access and billing.",
  },
];
function fail() {
  throw new Error("Invalid data. Please check the selected fields or backup.");
}
function object(x, keys) {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).some((k) => !keys.includes(k))
  )
    fail();
}
function str(x, max = 200, empty = true) {
  if (
    typeof x !== "string" ||
    x.length > max ||
    (!empty && !x.trim()) ||
    x.includes("\0")
  )
    fail();
  return x;
}
function provider(id) {
  if (!providers.some((p) => p.id === id)) fail();
  return id;
}
function endpoint(id, value) {
  provider(id);
  const fixed = providers.find((p) => p.id === id).endpoint;
  value = value || fixed;
  if (id !== "ollama") {
    if (value !== fixed) fail();
    return fixed;
  }
  let u;
  try {
    u = new URL(value);
  } catch {
    fail();
  }
  if (
    u.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    fail();
  return u.origin;
}
function defaultState() {
  return {
    schemaVersion: 1,
    onboarded: false,
    profiles: [],
    journeys: [],
    activeProfileId: null,
    provider: { id: "ollama", model: "", endpoint: providers[0].endpoint },
  };
}
function validateState(s) {
  object(s, [
    "schemaVersion",
    "onboarded",
    "profiles",
    "activeProfileId",
    "provider",
    "followGameCharacter",
    "journeys",
  ]);
  if (
    s.schemaVersion !== 1 ||
    typeof s.onboarded !== "boolean" ||
    !Array.isArray(s.profiles) ||
    s.profiles.length > 100
  )
    fail();
  if (
    s.followGameCharacter !== undefined &&
    typeof s.followGameCharacter !== "boolean"
  )
    fail();
  const ids = new Set();
  for (const p of s.profiles) {
    object(p, [
      "id",
      "name",
      "realm",
      "className",
      "level",
      "notes",
      "goals",
      "race",
      "faction",
      "source",
      "location",
      "quests",
      "progress",
      "history",
      "readiness",
      "clientBuild",
      "locale",
      "captureVersion",
    ]);
    require("./quest-data.cjs").validateCapture(p);
    validateQuestData(p.quests);
    validateProgress(p.progress);
    validateHistory(p.history);
    require("./readiness.cjs").validateReadiness(p.readiness);
    str(p.id, 100, false);
    if (ids.has(p.id)) fail();
    ids.add(p.id);
    str(p.name, 100, false);
    str(p.realm, 100);
    str(p.className, 100);
    str(p.notes, 20000);
    for (const key of ["race", "faction"])
      if (p[key] !== undefined) str(p[key], 100);
    if (p.source !== undefined) {
      object(p.source, ["kind", "id", "updatedAt"]);
      if (p.source.kind !== "wow-addon") fail();
      str(p.source.id, 200, false);
      if (
        typeof p.source.updatedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          p.source.updatedAt,
        ) ||
        !Number.isFinite(Date.parse(p.source.updatedAt)) ||
        new Date(p.source.updatedAt).toISOString() !== p.source.updatedAt
      )
        fail();
    }
    if (
      p.source && p.readiness?.workshop &&
      Object.values(p.readiness.workshop).some(collection =>
        collection !== undefined && collection.observedAt > p.source.updatedAt)
    ) fail();
    if (p.location !== undefined) {
      object(p.location, ["zone", "subZone", "mapId", "x", "y"]);
      for (const key of ["zone", "subZone"])
        if (p.location[key] !== undefined) str(p.location[key], 200);
      if (
        p.location.mapId !== undefined &&
        (!Number.isSafeInteger(p.location.mapId) || p.location.mapId < 0)
      )
        fail();
      for (const key of ["x", "y"])
        if (
          p.location[key] !== undefined &&
          (typeof p.location[key] !== "number" ||
            !Number.isFinite(p.location[key]) ||
            p.location[key] < 0 ||
            p.location[key] > 1)
        )
          fail();
    }
    if (
      !Number.isInteger(p.level) ||
      p.level < 1 ||
      p.level > 1000 ||
      !Array.isArray(p.goals) ||
      p.goals.length > 200
    )
      fail();
    const gs = new Set();
    for (const g of p.goals) {
      object(g, ["id", "text", "done"]);
      str(g.id, 100, false);
      str(g.text, 1000, false);
      if (gs.has(g.id) || typeof g.done !== "boolean") fail();
      gs.add(g.id);
    }
  }
  if (s.activeProfileId !== null && !ids.has(s.activeProfileId)) fail();
  object(s.provider, ["id", "model", "endpoint", "authMode"]);
  if (
    s.provider.authMode !== undefined &&
    !["api", "subscription"].includes(s.provider.authMode)
  )
    fail();
  provider(s.provider.id);
  str(s.provider.model, 200);
  str(s.provider.endpoint, 500, false);
  endpoint(s.provider.id, s.provider.endpoint);
  const valid = JSON.parse(JSON.stringify(s));
  valid.journeys = validateJourneys(s.journeys);
  if (valid.activeProfileId === null && valid.profiles.length)
    valid.activeProfileId = valid.profiles[0].id;
  return valid;
}
module.exports = {
  providers,
  defaultState,
  validateState,
  endpoint,
  provider,
  str,
  object,
};
