"use strict";
const v = require("./validation.cjs"),
  ai = require("./providers.cjs");
const { questInsights } = require("./insights-data.cjs");
function registerKnowledgeHandlers({
  handle,
  knowledge,
  getState,
  connected,
  clipboard,
  getInsights = () => null,
}) {
  const sync = () => {
    const s = getState();
    knowledge.setContext(
      s.profiles.find((p) => p.id === s.activeProfileId) || {},
      connected(),
    );
  };
  const profile = (profileId) => {
    const s = getState();
    if (profileId !== null && profileId !== undefined)
      v.str(profileId, 100, false);
    const p = s.profiles.find((p) => p.id === (profileId ?? s.activeProfileId));
    if (!p && profileId) throw Error("Choose a character.");
    return p || {};
  };
  const count = (args, min, max = min) => {
    if (args.length < min || args.length > max)
      throw Error("Invalid reference request.");
  };
  handle("knowledgeStatus", (...args) => {
    count(args, 0);
    sync();
    return knowledge.status();
  });
  handle("refreshKnowledge", (...args) => {
    count(args, 0);
    sync();
    return knowledge.refresh();
  });
  handle("setKnowledgeAutomatic", (...args) => {
    count(args, 1);
    if (typeof args[0] !== "boolean")
      throw Error("Invalid reference preference.");
    const status = knowledge.setAutomatic(args[0]);
    sync();
    return status;
  });
  handle("searchQuests", (...args) => {
    count(args, 1, 3);
    sync();
    const [query, profileId, options = {}] = args,
      p = profile(profileId);
    const index = knowledge.index(p) || knowledge.bundled;
    return index.search(query, p, options);
  });
  handle("questDetails", (...args) => {
    count(args, 2);
    sync();
    const [profileId, questId] = args,
      p = profile(profileId);
    if (!Number.isSafeInteger(questId) || questId < 1 || questId > 2147483647)
      throw Error("Invalid quest ID.");
    const index = knowledge.index(p) || knowledge.bundled;
    const active = p.quests?.find((q) => q.id === questId);
    const result = {
      ...index.details(p, questId),
      waypoint: index.resolveWaypoint(
        p,
        questId,
        active ? (active.complete ? "t" : "o") : "r",
      ),
    };
    const insights = getInsights();
    if (insights) {
      result.insights =
        result.provenance?.build !== insights.build ||
        result.provenance?.sourceCommit !== insights.sourceCommit
          ? {
              status: "unavailable",
              reason: "The selected quest reference source differs from the bundled supplementary reference.",
            }
          : questInsights(insights, {
              id: questId,
              title: active?.title || result.record?.title,
              build: p.clientBuild,
              locale: p.locale,
            });
    }
    return result;
  });
  handle("copyQuestWaypoint", (...args) => {
    count(args, 3);
    sync();
    const [profileId, questId, phase] = args,
      p = profile(profileId);
    if (
      !Number.isSafeInteger(questId) ||
      questId < 1 ||
      questId > 2147483647 ||
      !["t", "o", "r"].includes(phase)
    )
      throw Error("Invalid waypoint request.");
    const index = knowledge.index(p);
    if (!index) throw Error("No compatible reference pack.");
    const command = index.waypoint(p, questId, phase);
    clipboard.writeText(command);
    return {
      command,
      message:
        phase === "r"
          ? "Paste in the game chat and press Enter to set a reference marker; check quest availability."
          : "Paste in the game chat and press Enter to set a quest waypoint.",
    };
  });
  handle("contextPreview", (...args) => {
    count(args, 2, 3);
    const [profileId, share, prompt = ""] = args;
    if (typeof share !== "boolean") throw Error("Invalid context choice.");
    v.str(prompt, 12000);
    if (!share) return null;
    const p = profile(profileId);
    if (!p.id) throw Error("Choose a character.");
    return ai.approvedProfile(p, { knowledge: knowledge.index(p), prompt });
  });
}
module.exports = { registerKnowledgeHandlers };
