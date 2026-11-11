"use strict";
const v = require("./validation.cjs");
const { INSTRUCTION: instruction } = require("./wow-policy.cjs");
function approvedProfile(p, { knowledge, prompt = "", reportedLocation } = {}) {
  const out = {};
  for (const key of [
    "name",
    "className",
    "level",
    "realm",
    "race",
    "faction",
  ]) {
    if (typeof p[key] === "string") out[key] = p[key].slice(0, 200);
    else if (
      key === "level" &&
      Number.isInteger(p[key]) &&
      p[key] >= 1 &&
      p[key] <= 1000
    )
      out[key] = p[key];
  }
  if (p.location) {
    const location = {};
    for (const key of ["zone", "subZone"])
      if (typeof p.location[key] === "string")
        location[key] = p.location[key].slice(0, 200);
    for (const key of ["mapId", "x", "y"])
      if (
        Number.isFinite(p.location[key]) &&
        p.location[key] >= 0 &&
        (key === "mapId"
          ? Number.isSafeInteger(p.location[key])
          : p.location[key] <= 1)
      )
        location[key] = p.location[key];
    out.location = location;
  }
  require('./companion-location.cjs').applyLocationContext(out,p,reportedLocation);
  const stamp = p.source?.updatedAt ?? p.snapshotUpdatedAt;
  if (typeof stamp === "string" && Number.isFinite(Date.parse(stamp)))
    out.snapshotUpdatedAt = stamp;
  const {
    validateQuestData,
    validateProgress,
    validateHistory,
  } = require("./quest-data.cjs");
  if (p.quests !== undefined)
    out.quests = validateQuestData(p.quests)
      .slice(0, 10)
      .map((q) => ({ ...q, objectives: q.objectives.slice(0, 3) }));
  if (p.progress !== undefined) out.progress = validateProgress(p.progress);
  if (p.history !== undefined) {
    const h = validateHistory(p.history);
    out.history = {
      ...(h.completedCount !== undefined
        ? { completedCount: h.completedCount }
        : {}),
      recent: h.recent.slice(0, 10),
    };
  }
  const { referenceFacts, publicFacts } = require("./knowledge-context.cjs");
  const facts = knowledge
    ? referenceFacts(p, knowledge, prompt)
    : publicFacts(p.knowledge);
  if (facts) out.knowledge = facts;
  // Keep the preview and every transport within the same bounded context budget.
  while (JSON.stringify(out).length > 18000) {
    if (out.quests?.length > 3) out.quests.pop();
    else if (out.history?.recent?.length) out.history.recent.pop();
    else if (out.knowledge?.length > 1) out.knowledge.pop();
    else if (out.quests?.length) out.quests.pop();
    else break;
  }
  return out;
}
function profileContext(state, id, share, options) {
  if (!share) return "";
  const p = state.profiles.find((p) => p.id === id);
  if (!p) throw new Error("Choose a character before sharing context.");
  return (
    "Optional character context: " + JSON.stringify(approvedProfile(p, options))
  );
}
async function ask(
  { provider, model, endpoint, apiKey, prompt, context = "", signal },
  fetcher = fetch,
) {
  v.provider(provider);
  v.str(model, 200, false);
  v.str(prompt, 12000, false);
  const base = v.endpoint(provider, endpoint);
  if (provider !== "ollama" && !apiKey)
    throw new Error("Save an API key for this provider first.");
  const input = [context, prompt].filter(Boolean).join("\n\n");
  const headers = { "Content-Type": "application/json" };
  let route, body;
  if (provider === "openai") {
    route = "/v1/responses";
    headers.Authorization = "Bearer " + apiKey;
    body = {
      model,
      instructions: instruction,
      input,
      store: false,
      max_output_tokens: 2048,
    };
  } else if (provider === "anthropic") {
    route = "/v1/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      system: instruction,
      max_tokens: 2048,
      messages: [{ role: "user", content: input }],
    };
  } else {
    route = ["ollama", "ollama-cloud"].includes(provider)
      ? "/api/chat"
      : "/v1/chat/completions";
    if (["xai", "ollama-cloud"].includes(provider))
      headers.Authorization = "Bearer " + apiKey;
    body = {
      model,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: input },
      ],
      stream: false,
      ...(provider === "xai" ? { max_tokens: 2048 } : {}),
    };
  }
  try {
    const response = await fetcher(base + route, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        [401, 403].includes(response.status)
          ? "Provider authentication failed. Check your API access and key."
          : response.status === 429
            ? "Provider rate or billing limit reached."
            : "Provider request failed. Check the connection and model.",
      );
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 1000000) {
        await response.body.cancel().catch(() => {});
        throw new Error("Provider reply is too large.");
      }
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const out = ["ollama", "ollama-cloud"].includes(provider)
      ? data.message?.content
      : provider === "openai"
        ? data.output
            ?.filter((x) => x.type === "message")
            .flatMap((x) => x.content || [])
            .filter((x) => x.type === "output_text")
            .map((x) => x.text)
            .join("\n")
        : provider === "anthropic"
          ? data.content
              ?.filter((x) => x.type === "text")
              .map((x) => x.text)
              .join("\n")
          : data.choices?.[0]?.message?.content;
    if (typeof out !== "string" || !out.trim())
      throw new Error("Provider returned no text. Check the chosen model.");
    return out;
  } catch (e) {
    if (
      /^(Provider (authentication|rate|request|reply|returned))/.test(e.message)
    )
      throw e;
    throw new Error(
      "Could not reach the provider or read its reply. Check your connection and model.",
    );
  }
}
module.exports = { ask, profileContext, approvedProfile };
