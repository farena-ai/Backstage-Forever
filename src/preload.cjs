"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, ...args) =>
  ipcRenderer.invoke("backstage:" + name, ...args).catch((error) => {
    const message = String(error.message || "Action failed.").replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
    throw new Error(message);
  });
contextBridge.exposeInMainWorld(
  "backstage",
  Object.freeze({
    bootstrap: () => invoke("bootstrap"),
    gameStatus: () => invoke("gameStatus"),
    guidancePlan: (profileId, options) =>
      invoke("guidancePlan", profileId, options),
    adventureBrief: (profileId) => invoke("adventureBrief", profileId),
    companyBrief: () => invoke("companyBrief"),
    startDirectorSession: (...args) => invoke("startDirectorSession", ...args),
    adventureMap: (...args) => invoke("adventureMap", ...args),
    professionCoach: (...args) => invoke("professionCoach", ...args),
    adventureCoach: (...args) => invoke("adventureCoach", ...args),
    preparationBrief: (...args) => invoke("preparationBrief", ...args),
    createPreparationJourney: (...args) => invoke("createPreparationJourney", ...args),
    partyBrief: (...args) => invoke("partyBrief", ...args),
    partyPreview: (...args) => invoke("partyPreview", ...args),
    createPartyJourney: (...args) => invoke("createPartyJourney", ...args),
    exportPartyPlan: (...args) => invoke("exportPartyPlan", ...args),
    importPartyPlan: (...args) => invoke("importPartyPlan", ...args),
    commitPartyPlan: (...args) => invoke("commitPartyPlan", ...args),
    journeyAction: (action) => invoke("journeyAction", action),
    knowledgeStatus: () => invoke("knowledgeStatus"),
    refreshKnowledge: () => invoke("refreshKnowledge"),
    setKnowledgeAutomatic: (automatic) =>
      invoke("setKnowledgeAutomatic", automatic),
    searchQuests: (query, profileId, options) =>
      invoke("searchQuests", query, profileId, options),
    questDetails: (profileId, questId) =>
      invoke("questDetails", profileId, questId),
    copyQuestWaypoint: (profileId, questId, phase) =>
      invoke("copyQuestWaypoint", profileId, questId, phase),
    contextPreview: (profileId, share, prompt, memoryIds = []) =>
      invoke("contextPreview", profileId, share, prompt, memoryIds),
    prepareGame: (root) => invoke("prepareGame", root),
    startCompanion: () => invoke("startCompanion"),
    launchGame: () => invoke("launchGame"),
    gameSnapshot: () => invoke("gameSnapshot"),
    discoverGame: () => invoke("discoverGame"),
    connectGame: (root) => invoke("connectGame", root),
    installGameAddon: () => invoke("installGameAddon"),
    refreshGame: () => invoke("refreshGame"),
    disconnectGame: () => invoke("disconnectGame"),
    listModels: (options) => invoke("listModels", options),
    updateStatus: () => invoke("updateStatus"),
    checkForUpdates: () => invoke("checkForUpdates"),
    setUpdatePreferences: (preferences) =>
      invoke("setUpdatePreferences", preferences),
    installUpdate: () => invoke("installUpdate"),
    subscriptionStatus: () => invoke("subscriptionStatus"),
    connectSubscription: (provider) => invoke("connectSubscription", provider),
    disconnectSubscription: (provider) =>
      invoke("disconnectSubscription", provider),
    saveState: (state, base) => invoke("saveState", state, base),
    saveProvider: (settings) => invoke("saveProvider", settings),
    deleteKey: (provider) => invoke("deleteKey", provider),
    ask: (request) => invoke("ask", request),
    copyTravelGuidance: (...args) => invoke("copyTravelGuidance", ...args),
    createTravelPlan: (...args) => invoke("createTravelPlan", ...args),
    openTravelSource: (...args) => invoke("openTravelSource", ...args),
    askCompanion: (...args) => invoke("askCompanion", ...args),
    clearConversation: (...args) => invoke("clearConversation", ...args),
    onConversationReset: (listener) => {
      if (typeof listener !== "function") throw new Error("Invalid conversation listener.");
      const handler = (_event, reason) => listener(reason);
      ipcRenderer.on("backstage:conversationReset", handler);
      return () => ipcRenderer.removeListener("backstage:conversationReset", handler);
    },
    worldMap: (input) => invoke("worldMap", input),
    worldMapSearch: (query) => invoke("worldMapSearch", query),
    copyWaypoint: (input) => invoke("copyWaypoint", input),
    liveLinkStatus: () => invoke("liveLinkStatus"),
    setLiveLink: (enabled) => invoke("setLiveLink", enabled),
    onLiveLink: (listener) => {
      if (typeof listener !== "function") throw new Error("Invalid live link listener.");
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("backstage:liveLink", handler);
      return () => ipcRenderer.removeListener("backstage:liveLink", handler);
    },
    cancelAsk: () => invoke("cancelAsk"),
    companionContext: (...args) => invoke("companionContext", ...args),
    memoryList: (...args) => invoke("memoryList", ...args),
    memoryDraft: (...args) => invoke("memoryDraft", ...args),
    memoryPreview: (...args) => invoke("memoryPreview", ...args),
    saveMemory: (...args) => invoke("saveMemory", ...args),
    deleteMemory: (...args) => invoke("deleteMemory", ...args),
    clearMemory: (...args) => invoke("clearMemory", ...args),
    voiceCapabilities: (...args) => invoke("voiceCapabilities", ...args),
    voiceStart: (...args) => invoke("voiceStart", ...args),
    voiceStatus: (...args) => invoke("voiceStatus", ...args),
    voiceStop: (...args) => invoke("voiceStop", ...args),
    voiceSpeak: (...args) => invoke("voiceSpeak", ...args),
    voiceCancel: (...args) => invoke("voiceCancel", ...args),
    exportData: () => invoke("exportData"),
    importData: () => invoke("importData"),
    resetData: () => invoke("resetData"),
    recoveryList: (...args) => invoke("recoveryList", ...args),
    setRecoveryAutomatic: (...args) => invoke("setRecoveryAutomatic", ...args),
    checkpointNow: (...args) => invoke("checkpointNow", ...args),
    previewCheckpoint: (...args) => invoke("previewCheckpoint", ...args),
    restoreCheckpoint: (...args) => invoke("restoreCheckpoint", ...args),
    clearCheckpoints: (...args) => invoke("clearCheckpoints", ...args),
    diagnosticsPreview: (...args) => invoke("diagnosticsPreview", ...args),
    copyDiagnostics: (...args) => invoke("copyDiagnostics", ...args),
    exportDiagnostics: (...args) => invoke("exportDiagnostics", ...args),
    openLink: (id) => invoke("openLink", id),
    characterGuidance: (...args) => invoke("characterGuidance", ...args),
    searchGuidanceTrainers: (...args) => invoke("searchGuidanceTrainers", ...args),
    createCharacterChecklist: (...args) => invoke("createCharacterChecklist", ...args),
    characterGuidancePrompt: (...args) => invoke("characterGuidancePrompt", ...args),
  }),
);
