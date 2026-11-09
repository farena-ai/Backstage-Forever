"use strict";
const v = require("./validation.cjs");
const MESSAGE =
  "Could not refresh models. Check the connection and selected access mode, then retry. Your selected model was preserved.";
function result(models, source, message) {
  return { models, source, checkedAt: Date.now(), message };
}
async function readJson(response) {
  if (!response.ok) throw Error("catalog");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 1000000) throw Error("catalog");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function normalize(items, mode = "api") {
  if (!Array.isArray(items) || items.length > 2000) throw Error("catalog");
  const seen = new Set(),
    models = [];
  for (const item of items) {
    if (!item || typeof item !== "object") throw Error("catalog");
    if (mode === "chatgpt" && item.visibility !== "list") continue;
    const id =
      mode === "chatgpt"
        ? item.slug
        : mode === "ollama"
          ? item.name || item.model
          : item.id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      /[\x00-\x1f\x7f]/.test(id)
    )
      throw Error("catalog");
    const caps = item.capabilities;
    if (
      Array.isArray(caps) &&
      caps.length &&
      !caps.some((x) =>
        ["completion", "chat", "text", "vision", "tools", "thinking"].includes(
          x,
        ),
      )
    )
      continue;
    if (
      /(?:^|[-/:])(?:embedding|embeddings|embed|whisper|tts|audio|transcribe|dall-e|imagen|image|sora)(?:[-/:]|$)/i.test(
        id,
      )
    )
      continue;
    const label = item.display_name || item.displayName || id;
    if (
      typeof label !== "string" ||
      label.length > 300 ||
      /[\x00-\x1f\x7f]/.test(label)
    )
      throw Error("catalog");
    if (!seen.has(id)) {
      seen.add(id);
      models.push({ id, label });
    }
  }
  return models;
}
async function listModels(
  { provider, authMode = "api", endpoint, apiKey, chatgpt, claude },
  fetcher = fetch,
) {
  v.provider(provider);
  const base = v.endpoint(provider, endpoint);
  if (!["api", "subscription"].includes(authMode))
    throw Error("Invalid access mode.");
  const source =
    authMode === "subscription"
      ? provider === "openai"
        ? "chatgpt-account"
        : "claude-code"
      : provider === "ollama"
        ? "ollama-local"
        : provider === "ollama-cloud"
          ? "ollama-cloud"
          : "provider-api";
  try {
    if (authMode === "subscription") {
      const adapter =
        provider === "openai"
          ? chatgpt
          : provider === "anthropic"
            ? claude
            : null;
      if (!adapter?.listModels)
        return result(
          [],
          source,
          "Connect this subscription to refresh models. Manual model entry is available.",
        );
      return await adapter.listModels();
    }
    if (provider !== "ollama" && !apiKey)
      return result(
        [],
        source,
        "Save this provider’s API key to refresh models.",
      );
    const headers = { Accept: "application/json" };
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider !== "ollama")
      headers.Authorization = "Bearer " + apiKey;
    const native = provider === "ollama" || provider === "ollama-cloud";
    let route = native ? "/api/tags" : "/v1/models";
    const models = [],
      seen = new Set();
    let completed = false;
    const signal = AbortSignal.timeout(15000);
    for (let page = 0; page < 5; page++) {
      const data = await readJson(
        await fetcher(base + route, {
          method: "GET",
          headers,
          redirect: "error",
          signal,
        }),
      );
      for (const m of normalize(
        native ? data.models : data.data,
        native ? "ollama" : "api",
      ))
        if (!seen.has(m.id)) {
          seen.add(m.id);
          models.push(m);
        }
      if (models.length > 2000) throw Error("catalog");
      if (!data.has_more) {
        completed = true;
        break;
      }
      if (native) throw Error("catalog");
      const cursor = data.last_id || data.data?.at(-1)?.id;
      if (typeof cursor !== "string" || cursor.length > 200 || !cursor)
        throw Error("catalog");
      route =
        "/v1/models?" +
        new URLSearchParams({
          [provider === "anthropic" ? "after_id" : "after"]: cursor,
          limit: "100",
        });
    }
    if (!completed) throw Error("catalog");
    return result(
      models,
      source,
      native
        ? "Provider model catalog refreshed. Some models may not support text chat."
        : "Provider catalog refreshed; availability and text compatibility depend on your account and model.",
    );
  } catch {
    return result([], source, MESSAGE);
  }
}
module.exports = { listModels, readJson, normalize, result };
