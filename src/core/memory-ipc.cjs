"use strict";
const { buildMemoryPrompt } = require("./memory.cjs");
function registerMemoryHandlers({ handle, getState, memory, context }) {
  const one = fn => (...args) => { if (args.length !== 1) throw Error("Invalid memory request."); return fn(args[0]); };
  handle("companionContext", one(input => context.notify(input)));
  handle("memoryList", one(profileId => memory.list(profileId)));
  handle("memoryDraft", one(profileId => memory.draft(profileId)));
  handle("memoryPreview", one(input => buildMemoryPrompt(getState(), input)));
  handle("saveMemory", one(input => memory.save(input)));
  handle("deleteMemory", one(input => memory.remove(input)));
  handle("clearMemory", one(profileId => memory.clear(profileId)));
}
module.exports = { registerMemoryHandlers };
