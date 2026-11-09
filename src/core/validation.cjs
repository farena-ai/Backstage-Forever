"use strict";
const providers = [
  {
    id: "ollama",
    name: "Ollama",
    endpoint: "http://127.0.0.1:11434",
    help: "Run Ollama locally and enter an installed model name.",
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
  ]);
  if (
    s.schemaVersion !== 1 ||
    typeof s.onboarded !== "boolean" ||
    !Array.isArray(s.profiles) ||
    s.profiles.length > 100
  )
    fail();
  const ids = new Set();
  for (const p of s.profiles) {
    object(p, ["id", "name", "realm", "className", "level", "notes", "goals"]);
    str(p.id, 100, false);
    if (ids.has(p.id)) fail();
    ids.add(p.id);
    str(p.name, 100, false);
    str(p.realm, 100);
    str(p.className, 100);
    str(p.notes, 20000);
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
  return JSON.parse(JSON.stringify(s));
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
