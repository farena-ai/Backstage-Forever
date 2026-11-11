"use strict";
// Bounded model ↔ local-tool conversation for one companion question.
// `post(route, body)` sends one request and resolves to parsed JSON; tools come from
// companion-tools.cjs. The last round always forbids tools so a text answer arrives.
const MAX_ROUNDS = 5;

const anthropicTools = (defs) => defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
const responsesTools = (defs) => defs.map((d) => ({ type: "function", name: d.name, description: d.description, parameters: d.parameters, strict: false }));
const chatTools = (defs) => defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.parameters } }));

async function anthropicLoop({ post, model, system, input, tools, maxTokens = 2048 }) {
  const messages = [{ role: "user", content: input }];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const data = await post({ model, system, max_tokens: maxTokens, messages, tools: anthropicTools(tools.definitions), ...(last ? { tool_choice: { type: "none" } } : {}) });
    const uses = (data.content || []).filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || !uses.length || last)
      return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    messages.push({ role: "assistant", content: data.content });
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await tools.call(u.name, u.input) });
    messages.push({ role: "user", content: results });
  }
  return "";
}

function responsesText(output) {
  return (output || []).filter((x) => x.type === "message").flatMap((x) => x.content || []).filter((x) => x.type === "output_text").map((x) => x.text).join("\n");
}
// OpenAI Responses API (also used by ChatGPT plan transport). Stateless (store:false),
// so prior function calls are replayed without server item ids.
async function responsesLoop({ post, model, instructions, input, tools, extra = {} }) {
  const items = [{ role: "user", content: input }];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const data = await post({ model, instructions, input: items, store: false, tools: responsesTools(tools.definitions), tool_choice: last ? "none" : "auto", ...extra });
    const calls = (data.output || []).filter((x) => x.type === "function_call");
    if (!calls.length || last) return responsesText(data.output);
    for (const c of calls) {
      items.push({ type: "function_call", call_id: c.call_id, name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}) });
      items.push({ type: "function_call_output", call_id: c.call_id, output: await tools.call(c.name, c.arguments) });
    }
  }
  return "";
}

// OpenAI-compatible chat completions (xAI) and Ollama /api/chat.
async function chatLoop({ post, model, system, input, tools, ollama = false, extra = {} }) {
  const messages = [{ role: "system", content: system }, { role: "user", content: input }];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const toolFields = last ? (ollama ? {} : { tools: chatTools(tools.definitions), tool_choice: "none" }) : { tools: chatTools(tools.definitions) };
    const data = await post({ model, messages, stream: false, ...toolFields, ...extra });
    const message = ollama ? data.message : data.choices?.[0]?.message;
    const calls = message?.tool_calls || [];
    if (!calls.length || last) return message?.content;
    messages.push({ role: "assistant", content: message.content || "", tool_calls: calls });
    for (const [i, c] of calls.entries()) {
      const output = await tools.call(c.function?.name, c.function?.arguments);
      messages.push(ollama ? { role: "tool", content: output, tool_name: c.function?.name } : { role: "tool", tool_call_id: c.id || `call_${round}_${i}`, content: output });
    }
  }
  return "";
}
module.exports = { anthropicLoop, responsesLoop, chatLoop, responsesText, MAX_ROUNDS, anthropicTools, responsesTools, chatTools };
