"use strict";
const v = require("./validation.cjs");
const { INSTRUCTION: instruction } = require("./wow-policy.cjs");
function profileContext(state, id, share) {
  if (!share) return "";
  const p = state.profiles.find((p) => p.id === id);
  if (!p) throw new Error("Choose a character before sharing context.");
  return (
    "Optional character context: " +
    JSON.stringify({
      name: p.name,
      className: p.className,
      level: p.level,
      realm: p.realm,
      race: p.race,
      faction: p.faction,
      location: p.location,
      snapshotUpdatedAt: p.source?.updatedAt,
    })
  );
}
async function ask(
  { provider, model, endpoint, apiKey, prompt, context = "" },
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
      signal: AbortSignal.timeout(60000),
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
module.exports = { ask, profileContext };
