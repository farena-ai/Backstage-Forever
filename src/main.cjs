"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  session,
  clipboard,
  nativeImage,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Store, atomic, MAX_BACKUP_BYTES } = require("./core/store.cjs");
const { showStartupFailure } = require("./core/startup-recovery.cjs");
const v = require("./core/validation.cjs");
const ai = require("./core/providers.cjs");
const { ChatGPTAuth } = require("./core/chatgpt.cjs");
const claude = require("./core/claude.cjs");
const { Updater } = require("./core/updater.cjs");
const { GameSync } = require("./core/game-sync.cjs");
const { mergeSnapshot } = require("./core/profile-sync.cjs");
const {
  registerCompanyHandlers,
  mergeOrdinaryState,
} = require("./core/company-ipc.cjs");
const { CatalogCache } = require("./core/catalog-cache.cjs");
const { listModels } = require("./core/model-catalog.cjs");
const { TravelCompanion } = require("./core/travel-companion.cjs");
const { loadTravelReference } = require("./core/travel-data.cjs");
const { CompanionService } = require("./core/companion-service.cjs");
const { buildBrief } = require("./core/adventure.cjs");
const { KnowledgeService } = require("./core/knowledge-cache.cjs");
const { registerKnowledgeHandlers } = require("./core/knowledge-ipc.cjs");
const { loadBundledInsights } = require("./core/insights-data.cjs");
const { registerCharacterGuidanceHandlers } = require("./core/character-guidance-ipc.cjs");
const { registerDirectorHandlers } = require("./core/director-ipc.cjs");
const { registerAdventureCoachHandlers } = require("./core/adventure-coach-ipc.cjs");
const { registerProfessionCoachHandlers } = require("./core/profession-coach-ipc.cjs");
const { registerPreparationHandlers } = require("./core/preparation-ipc.cjs");
const { registerPartyHandlers } = require("./core/party-ipc.cjs");
const { registerGuildRunHandlers } = require("./core/guild-run-ipc.cjs");
const { registerSupplyDesk } = require("./core/supply-desk-ipc.cjs");
const { registerLocalPlanPack, LOCAL_PLAN_MESSAGES } = require("./core/local-plan-pack.cjs");
const { CompanionRequest } = require("./core/companion-request.cjs");
const { CompanionContext } = require("./core/companion-context.cjs");
const { MemoryService } = require("./core/memory.cjs");
const { registerMemoryHandlers } = require("./core/memory-ipc.cjs");
const { preserveMemories } = require("./core/memory-data.cjs");
const { VoiceService } = require("./core/voice.cjs");
const { registerVoiceHandlers } = require("./core/voice-ipc.cjs");
const { registerDiagnosticsHandlers } = require("./core/diagnostics-ipc.cjs");
const { savedBuild } = require("./core/patch-impact.cjs");
const { registerRecoveryHandlers, RECOVERY_MESSAGES } = require("./core/recovery-ipc.cjs");
const { releaseChannel } = require("../package.json");
const { FieldDispatchStore } = require("./core/field-dispatch-desktop.cjs");
const { LiveBridge } = require("./core/live-bridge.cjs");
let handoffUpgrades = () => []; // set once the loot handlers exist (desktop -> game hand-off)
let liveBridge = null;
let radar = null;
let miniNow = null;
let sessionHistory = null;
let economy = null;
let guildStore = null;
let liveClient = null, guildService = null, groupStore = null, guildPanel = null; // Backstage Live (live-client.cjs, guild-service.cjs, group-planner.cjs, guild-panel-window.cjs)
let liveTicketSubs = null; // tells the live stream which reports to listen for, whenever they change
let journeyStore = null;
let routeEditor = null, routeEdits = null; // route variants and edits per character (Q8, Q9)
let challengeRuns = null, discordPresence = null; // challenge runs (C12) and the Discord status (S6)
let streamOverlay = null;
let clearJourneyExtras = null;
let closeAskPanel = null, dropAskPanelWindow = null;
let recentGameAnswers = () => [];
let wishlist = null;
let statWeights = null; // the stat weights each character chose (roadmap C3)
let gearPins = null; // one pinned gear target per slot and character (roadmap C2)
// The weights a character scores gear with; null means the built-in row for the class.
const profileWeights = (p) => { try { return p && statWeights ? require("./core/stat-weights.cjs").scoringWeights(p.className, statWeights.get(p.id)) : null; } catch { return null; } };
let talentBuilds = null; // saved talent builds per character (talent planner)
let shipRides = null; // boats and zeppelins worked out from the game files, for the desktop -> game hand-off (B2)
let forgetGameAnswers = null, clearGameAnswers = null; // kept in-game answers (ask-answers.json)
let gatheringLoops = null; // the gathering loop each character sent to the game
let profileSends = null; // the addon settings profile each character is waiting to be offered in game
let community = null, collectDiagnostics = null;
let desk = null; // Backstage Desk: reports with replies, anonymous statistics, error reports (desk.cjs)
const catalogs = new CatalogCache();
const trusted = pathToFileURL(
  path.join(__dirname, "renderer", "index.html"),
).href;
let win,
  store,
  chatgpt,
  updater,
  game,
  knowledge,
  companionContext,
  companionRequest,
  companionService,
  localAi,
  memory,
  voice,
  diagnostics,
  recovery,
  characterGuidance,
  quitApproved = false,
  quitPending = false,
  subscriptionEpoch = 0,
  resetting = false;
let latestObservation = null;
let latestObservationRoot = null;
let gameActionEpoch = 0;
const links = {
  website: "https://www.backstagecoding.com/",
  "forever-class-overview": "https://news.blizzard.com/en-us/article/24304075/create-the-hero-you-want-to-be-in-world-of-warcraft-forever",
  releases: "https://github.com/farena-ai/Backstage-Forever/releases",
  ollama: "https://ollama.com/",
  "ollama-cloud": "https://ollama.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
  "llama-cpp": "https://github.com/ggml-org/llama.cpp",
  anthropic: "https://console.anthropic.com/",
  xai: "https://console.x.ai/",
  "chatgpt-usage": "https://chatgpt.com/settings/usage",
  "chatgpt-subscription": "https://chatgpt.com/",
  "claude-subscription": "https://claude.com/download",
  "xai-subscription": "https://grok.com/",
};
// 0.47 (4.4): read-only page views by name, so the companion's planning tools reuse exactly what the pages show.
const views = Object.create(null);
function handle(name, fn, { privateOnly = false } = {}) {
  if (!privateOnly) views[name] = fn;
  ipcMain.handle("backstage:" + name, async (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== trusted
    )
      throw new Error("This action is unavailable.");
    try {
      if (resetting)
        throw new Error(
          "Local data reset is still in progress. Try again in a moment.",
        );
      return await fn(...args);
    } catch (e) {
      if (["createTravelPlan", "copyTravelGuidance"].includes(name) && e?.message === "This trip choice is no longer current. Ask again.") throw new Error(e.message);
      if (RECOVERY_MESSAGES.includes(e?.message)) throw new Error(e.message);
      if (["diagnosticsPreview", "copyDiagnostics", "exportDiagnostics"].includes(name) && [
        "Report request is invalid.",
        "Prepare a new report and review it before copying or saving.",
        "The report could not be prepared. Try again.",
        "The report could not be copied. Try again.",
        "The report could not be saved. Choose a text file outside the app data folder.",
      ].includes(e?.message)) throw e;
      if (e?.message === "Secure credential storage is unavailable.") throw e;
      if (name.startsWith("community") && e?.name === "CommunityError") throw new Error(e.message);
      if (name.startsWith("desk") && e?.name === "DeskError") throw new Error(e.message);
      // Guild and party features write their own plain sentences ("Your guild rank does not allow this.").
      if (name.startsWith("live") && e?.name === "GuildError") throw new Error(e.message);
      if (["livePlan", "liveRegularNote"].includes(name) && e?.message === "A note cannot hold a web address.") throw new Error(e.message);
      // Journey extras write their own plain sentences for the player (a bad race code, a missing screenshot).
      if (e?.name === "JourneyError") throw new Error(e.message);
      if (["partyBrief", "partyPreview", "createPartyJourney", "commitPartyPlan", "exportPartyPlan", "importPartyPlan"].includes(name) && /^Party plan/.test(e?.message)) throw e;
      if (name === "guildRun" && /^Guild Run Pack/.test(e?.message)) throw e;
      if (name === "supplyDesk" && /^Supply Desk/.test(e?.message)) throw e;
      if (name === "localPlanPack" && LOCAL_PLAN_MESSAGES.includes(e?.message)) throw new Error(e.message);
      if (["ask", "askCompanion", "memoryPreview", "saveMemory", "deleteMemory", "clearMemory"].includes(name) && /^(Memory |Provider response is no longer current|Choose the current character)/.test(e?.message)) throw e;
      if (
        name === "copyQuestWaypoint" &&
        [
          "Update the addon and reload the game before copying a waypoint.",
          "No compatible sourced waypoint for this quest phase.",
          "No compatible reference pack.",
        ].includes(e?.message)
      )
        throw e;
      // An error of a type nobody throws on purpose (TypeError, RangeError…) is unexpected: Desk remembers it,
      // scrubbed, for the report form, and sends it only if the player switched automatic error reports on.
      if (e instanceof Error && ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError", "URIError", "AggregateError"].includes(e.name)) { try { desk?.captureError("main", e); } catch {} }
      throw new Error(
        ["ask", "askCompanion", "connectSubscription", "disconnectSubscription"].includes(
          name,
        ) &&
        /^(Provider |Could not reach|Save an API|Choose a model|Choose a character|ChatGPT |Claude |Grok |Install the official|Connect a supported|Subscription )/.test(
          e?.message,
        )
          ? e.message
          : "The action could not be completed. Check your input or file and try again.",
      );
    }
  });
}
if (!app.isPackaged && process.env.BF_USER_DATA)
  app.setPath("userData", path.resolve(process.env.BF_USER_DATA));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  let fieldDispatch;
  const privateWeekly = new (require("./core/private-weekly.cjs").PrivateWeekly)();
  const privateAfterAction = new (require("./core/private-after-action.cjs").PrivateAfterAction)();
  try {
    const dataDir = app.getPath("userData");
    // Old profiles do not establish a version. Check before startup creates any app-owned files.
    const freshInstall = !["state.json", "credentials.json", "game-connection.private.json", "updates/preferences.json", "Local Storage"]
      .some(name => fs.existsSync(path.join(dataDir, name)));
    store = new Store(app.getPath("userData"), safeStorage);
    companionContext = new CompanionContext(() => store.state);
    companionRequest = new CompanionRequest(companionContext);
    memory = new MemoryService({ store, context: companionContext });
    voice = new VoiceService({
      context: companionContext,
      getState: () => store.state,
      dataDir: app.getPath("userData"),
      inputAllowed: () => !!win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.webContents.isDestroyed() && win.webContents.getURL() === trusted,
    });
    store.onStateChange = () => {
      companionContext.sync(); characterGuidance?.sync();
      privateWeekly.sync(store.state); privateAfterAction.sync(store.state);
      try { economy?.absorb(store.state); } catch { /* History keeping must never block a save. */ }
      try { journeyStore?.absorb(store.state); } catch { /* Neither must the Journey's notes. */ }
      try { routeEdits?.absorb(store.state); challengeRuns?.absorb(store.state); } catch { /* Nor route edits and challenge runs. */ }
      try { forgetGameAnswers?.(store.state.profiles.map((p) => p.id)); } catch { /* Nor the kept in-game answers. */ }
    };
    chatgpt = new ChatGPTAuth(app.getPath("userData"), safeStorage, {
      openExternal: (url) => shell.openExternal(url),
    });
    claude.configure({ dataDir: app.getPath("userData") });
    updater = new Updater({
      dataDir: app.getPath("userData"),
      currentVersion: app.getVersion(),
      publicKey: fs.readFileSync(
        path.join(__dirname, "..", "assets", "update-public-key.pem"),
      ),
      packaged: app.isPackaged,
      channel: releaseChannel,
    });
    fieldDispatch = new FieldDispatchStore({ dir: dataDir, installed: app.isPackaged,
      running: { version: app.getVersion(), channel: releaseChannel }, freshInstall });
    updater.start();
    knowledge = new KnowledgeService({ dataDir: app.getPath("userData") });
    game = new GameSync({
      dataDir: app.getPath("userData"),
      // Desktop -> game hand-off: the wish list of each saved character, read by the game at login or /reload.
      handoff: () => { const profiles = store?.state?.profiles || []; return require("./core/desktop-handoff.cjs").compile({ profiles, reports: desk?.unread() || 0, wishlist: (id) => [...(gearPins?.ids(id) || []), ...(wishlist?.get(id) || [])], upgrades: (id) => handoffUpgrades(profiles.find((p) => p.id === id)), talents: (id) => talentBuilds?.handoff(id, profiles.find((p) => p.id === id)?.className) || null, loops: (id) => gatheringLoops?.get(id) || null, answers: (id) => recentGameAnswers(id), routes: (id) => routeEditor?.handoff(id) || null, ships: () => shipRides?.() || null, sentProfiles: (key) => profileSends?.get(key) || null, live: require("./core/game-guild-feed.cjs").handoff() }); },
      onRootChange: () => { companionContext.invalidate("source-root"); characterGuidance?.clear(); },
      addonDir: app.isPackaged
        ? path.join(process.resourcesPath, "addon", "BackstageForever")
        : path.join(__dirname, "..", "addon", "BackstageForever"),
      onSnapshot: (snapshot) => {
        if (game?.root !== latestObservationRoot) {
          latestObservation = null;
          latestObservationRoot = game?.root;
        }
        if (!resetting && game?.root) {
          let omittedProfileCount = 0;
          const merged = mergeSnapshot(store.state, snapshot, {
            allowActiveSelection: !latestObservation || snapshot.observedAt >= latestObservation,
            onOmitted: (count) => { omittedProfileCount = count; },
          });
          if (
            snapshot.characters.length &&
            merged.profiles.some((p) => p.source?.kind === "wow-addon")
          )
            merged.onboarded = true;
          store.saveState(merged);
          // New gear changes which drops are upgrades: refresh the file the game reads at /reload.
          setImmediate(() => { game?.writeHandoff().catch(() => {}); });
          const selected = merged.profiles.find(
            (p) => p.id === merged.activeProfileId,
          );
          knowledge.setContext(
            selected || {},
            Boolean(game?.status().connected),
          );
          if (!latestObservation || snapshot.observedAt > latestObservation) latestObservation = snapshot.observedAt;
          return { omittedProfileCount };
        }
      },
    });
  } catch (error) {
    try {
      await showStartupFailure({ dialog, shell, dataDir: app.getPath("userData"), error, restart: () => app.relaunch() });
    } catch {
      // Recovery must never turn an initialization error into an unhandled rejection.
    } finally {
      quitApproved = true;
      app.quit();
    }
    return;
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  async function subscriptionStatus() {
    const result = await claude.status();
    const unsupported = (message) => ({
      supported: false,
      connected: false,
      pending: false,
      message,
      account: null,
    });
    return {
      openai: chatgpt.status(),
      anthropic: {
        supported: true,
        connected: result.connected,
        pending: false,
        message: result.message,
        account: null,
      },
      xai: unsupported(
        "Grok subscription is unavailable in this preview: its official CLI cannot yet be verified with all tools, hooks and transcript storage disabled. xAI API mode remains available.",
      ),
      ollama: unsupported(
        "Ollama runs locally and does not need subscription sign-in.",
      ),
    };
  }
  handle("updateStatus", () => updater.status());
  handle("checkForUpdates", () => updater.check());
  handle("setUpdatePreferences", (input) => updater.setPreferences(input));
  handle("installUpdate", async () => {
    const installed = await updater.install();
    if (installed) {
      quitApproved = true;
      app.quit();
    }
    return updater.status();
  });
  handle("subscriptionStatus", subscriptionStatus);
  registerMemoryHandlers({ handle, getState: () => store.state, memory, context: companionContext });
  registerVoiceHandlers({ handle, voice });
  diagnostics = registerDiagnosticsHandlers({
    handle, dialog, clipboard, getWindow: () => win, dataDir: app.getPath("userData"),
    collect: collectDiagnostics = ({ includePatchImpact = true } = {}) => {
      // Read local status only, including bounded recovery metadata. No auth worker, model catalog or network refresh.
      const selected = store.state.provider, gameFacts = game.status();
      const index = knowledge.packs.get(knowledge.build), pack = (index || knowledge.bundled).pack;
      const update = updater.status();
      const selectedProfile = store.state.profiles.find(p => p.id === store.state.activeProfileId);
      return {
        ...(includePatchImpact ? { patchImpact: { savedBuild: savedBuild(selectedProfile, Date.now()), routeBuild: knowledge.bundled?.pack.build } } : {}),
        version: app.getVersion(), channel: releaseChannel,
        platform: process.platform, arch: process.arch,
        secureStorage: safeStorage.isEncryptionAvailable(), profileCount: store.state.profiles.length,
        provider: { id: selected.id, authMode: selected.authMode ?? "api", keyPresent: store.secretStatus()[selected.id] },
        game: { phase: gameFacts.phase, companionState: gameFacts.companionState, coverage: { partial: gameFacts.coverage?.partial, unreadableAccountCount: gameFacts.coverage?.unreadableAccountCount, omittedCharacterCount: gameFacts.coverage?.omittedCharacterCount, omittedProfileCount: gameFacts.coverage?.omittedProfileCount } },
        reference: { phase: knowledge.pending ? "refreshing" : knowledge.build && !index ? "mismatch" : knowledge.phase || (knowledge.build && knowledge.captureObserved ? "ready" : "reference"), packBuild: pack.build, counts: { quests: pack.counts.quests, items: pack.counts.itemNames, npcs: pack.counts.npcs } },
        updater: { phase: update.phase, currentVersion: update.currentVersion, availableVersion: update.availableVersion, readyVersion: update.readyVersion, diagnostic: { code: update.diagnostic?.code } },
        recovery: typeof store.recoveryStatus === "function" ? store.recoveryStatus() : undefined,
      };
    },
  });
  async function replaceJournal(operation, reason = "restore") {
    subscriptionEpoch++;
    characterGuidance?.clear();
    recovery?.clear(); diagnostics.clear(); companionContext.invalidate(reason);
    catalogs.clear(); gameActionEpoch++; knowledge.setContext({}, false);
    resetting = true;
    try {
      await game.disconnect(); latestObservation = null; latestObservationRoot = null;
      // A live disconnect alone cannot prevent the saved source reopening next launch.
      store.recovery.disconnectSavedGame();
      const result = await operation();
      privateWeekly.clear();
      privateAfterAction.clear();
      return result;
    } finally { resetting = false; }
  }
  recovery = registerRecoveryHandlers({ handle, store, context: companionContext, getEpoch: () => subscriptionEpoch, getWindow: () => win, dialog, transaction: replaceJournal });
  registerCompanyHandlers({
    handle,
    getState: () => store.state,
    saveState: (next) => store.saveState(next),
  });
  registerDirectorHandlers({
    handle,
    getState: () => store.state,
    saveState: (next) => store.saveState(next),
    knowledge,
  });
  registerAdventureCoachHandlers({ handle, getState: () => store.state, knowledge });
  registerProfessionCoachHandlers({ handle, getState: () => store.state });
  registerPreparationHandlers({
    handle,
    getState: () => store.state,
    saveState: (next) => store.saveState(next),
  });
  registerPartyHandlers({
    handle,
    getState: () => store.state,
    saveState: (next) => store.saveState(next),
    context: companionContext,
    getEpoch: () => subscriptionEpoch,
    isBlocked: () => resetting,
    dialog,
    getWindow: () => win,
  });
  const guildRuns = registerGuildRunHandlers({ handle, dataDir: app.getPath("userData"),
    context: companionContext, isBlocked: () => resetting, dialog, clipboard, getWindow: () => win });
  const supplyDesk = registerSupplyDesk({ handle, dataDir: app.getPath("userData") });
  const localPlanPack = registerLocalPlanPack({ handle, dataDir: app.getPath("userData") });
  const insights = loadBundledInsights();
  // Creature levels, elite flags and hostility (bundled reference; optional).
  const creaturePack = (() => { try { return require("./core/creature-data.cjs").loadCreaturePack(); } catch { return null; } })();
  characterGuidance = registerCharacterGuidanceHandlers({ handle, getState: () => store.state, saveState: next => store.saveState(next), getInsights: () => insights, getGameData: () => gameData, weightsFor: profileWeights });
  // Item, spell, icon and talent facts from the player's own WoW install, cached locally per game build.
  const gameData = new (require("./core/game-data.cjs").GameData)({ getRoot: () => game?.root || null, cacheDir: path.join(app.getPath("userData"), "game-data") });
  registerKnowledgeHandlers({
    handle,
    knowledge,
    gameData,
    weightsFor: profileWeights,
    getState: () => store.state,
    connected: () => game.status().connected,
    clipboard,
    getInsights: () => insights,
    getCreatures: () => creaturePack,
    getLocationContext: (...args) => companionService?.previewLocation(...args),
  });
  const syncKnowledge = () => {
    if (resetting) return;
    knowledge.setContext(
      store.state.profiles.find((p) => p.id === store.state.activeProfileId) ||
        {},
      game.status().connected,
    );
  };
  const referenceTimer = setInterval(syncKnowledge, 60000);
  referenceTimer.unref();
  app.on("before-quit", () => {
    clearInterval(referenceTimer);
    knowledge.cancel();
  });
  void game.ready.then(syncKnowledge).catch(() => {});
  const enrichedBrief = (profile) =>
    buildBrief(profile, { knowledge: knowledge.index(profile || {}) });
  const gameSnapshot = () => {
    syncKnowledge();
    return {
      state: structuredClone(store.state),
      gameStatus: game.status(),
      brief: enrichedBrief(
        store.state.profiles.find((p) => p.id === store.state.activeProfileId),
      ),
      briefProfileId: store.state.activeProfileId,
      knowledgeStatus: knowledge.status(),
    };
  };
  handle("adventureBrief", (profileId) => {
    if (profileId !== undefined && profileId !== null)
      v.str(profileId, 100, false);
    return enrichedBrief(
      store.state.profiles.find(
        (p) => p.id === (profileId ?? store.state.activeProfileId),
      ),
    );
  });
  handle("guidancePlan", (profileId, options) => {
    v.str(profileId, 100, false);
    const profile = store.state.profiles.find((p) => p.id === profileId);
    if (!profile) throw Error("Choose a character.");
    const {
      buildGuidance,
      validateGuidanceOptions,
    } = require("./core/guidance.cjs");
    const guidance = buildGuidance(profile, {
      ...validateGuidanceOptions(options),
      knowledge: knowledge.index(profile),
    });
    return { ...guidance, director: require("./core/director.cjs").buildDirector(profile, guidance) };
  });
  handle("gameStatus", () => game.status());
  handle("gameSnapshot", gameSnapshot);
  handle("changeObjective", (...args) => {
    if (args.length !== 1) throw Error("Invalid objective request.");
    return store.changeObjective(args[0]);
  });
  handle("discoverGame", () => game.discover());
  handle("cancelCompanion", (...args) => {
    if (args.length) throw Error("Invalid setup request.");
    gameActionEpoch++;
  });
  handle("startCompanion", async (...args) => {
    if (args.length) throw Error("Invalid setup request.");
    const epoch = subscriptionEpoch, actionEpoch = ++gameActionEpoch;
    const cancelled = () => resetting || epoch !== subscriptionEpoch || actionEpoch !== gameActionEpoch;
    await game.ready;
    if (cancelled()) return gameSnapshot();
    if (game.status().connected) {
      await game.prepare(undefined, cancelled);
      return gameSnapshot();
    }
    const candidates = await game.discover();
    if (cancelled()) return gameSnapshot();
    if (candidates.length === 1) {
      await game.prepare(candidates[0].path, cancelled);
      return gameSnapshot();
    }
    return { ...gameSnapshot(), setupCandidates: candidates };
  });
  handle("launchGame", async (...args) => {
    if (args.length) throw Error("Invalid launch request.");
    const epoch = subscriptionEpoch, actionEpoch = gameActionEpoch;
    const cancelled = () => resetting || epoch !== subscriptionEpoch || actionEpoch !== gameActionEpoch;
    await game.ready;
    if (cancelled()) return { ...gameSnapshot(), launchResult: { state: "cancelled", message: "Opening Forever was cancelled." } };
    const launchResult = await game.launch(cancelled);
    return { ...gameSnapshot(), launchResult };
  });
  async function prepareGame(root, automatic) {
    const epoch = subscriptionEpoch;
    const actionEpoch = ++gameActionEpoch;
    await game.ready;
    const cancelled = () =>
      resetting ||
      epoch !== subscriptionEpoch ||
      actionEpoch !== gameActionEpoch;
    if (cancelled()) return gameSnapshot();
    if (root !== undefined) v.str(root, 1000, false);
    else {
      if (automatic && game.status().connected) {
        await game.prepare(undefined, cancelled);
        return gameSnapshot();
      }
      const candidates = automatic ? await game.discover() : [];
      if (cancelled()) return gameSnapshot();
      if (candidates.length === 1) root = candidates[0].path;
      else {
        const result = await dialog.showOpenDialog(win, {
          title: "Choose your World of Warcraft Forever folder (_forever_)",
          properties: ["openDirectory"],
          ...(candidates[0] ? { defaultPath: candidates[0].path } : {}),
        });
        if (result.canceled || cancelled()) return { ...gameSnapshot(), setupCancelled: true };
        root = result.filePaths[0];
      }
    }
    if (cancelled()) return gameSnapshot();
    await game.prepare(root, cancelled);
    return gameSnapshot();
  }
  handle("prepareGame", (root) => prepareGame(root, true));
  handle("connectGame", (root) => prepareGame(root, false));
  handle("installGameAddon", async () => {
    await game.installAddon();
    return gameSnapshot();
  });
  handle("refreshGame", async () => {
    await game.refresh();
    return gameSnapshot();
  });
  handle("disconnectGame", async () => {
    companionContext.invalidate("source-disconnect");
    gameActionEpoch++;
    knowledge.setContext({}, false);
    await game.disconnect();
    return gameSnapshot();
  });
  handle("listModels", async (input) => {
    v.object(input, ["provider", "authMode", "endpoint", "refresh"]);
    v.provider(input.provider);
    const authMode = input.authMode ?? "api";
    if (
      !["api", "subscription"].includes(authMode) ||
      (input.refresh !== undefined && typeof input.refresh !== "boolean")
    )
      throw Error("Invalid model selection.");
    const endpoint = v.endpoint(input.provider, input.endpoint);
    // The built-in engine serves one model; it needs no catalog request.
    if (input.provider === "local") return require("./core/model-catalog.cjs").result([{ id: "local", label: localAi.status().model?.name || "Free AI on this PC" }], "local-engine", "Runs on this PC.");
    const key = JSON.stringify([input.provider, authMode, endpoint]);
    return catalogs.get(
      key,
      () =>
        listModels({
          provider: input.provider,
          authMode,
          endpoint,
          chatgpt,
          claude,
          apiKey: authMode === "api" ? store.getKey(input.provider) : undefined,
        }),
      input.refresh,
    );
  });
  handle("connectSubscription", async (provider) => {
    v.provider(provider);
    companionContext.invalidate("authentication-connect");
    catalogs.clear();
    if (provider === "openai") await chatgpt.connect();
    else if (provider === "anthropic") await claude.login();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
    catalogs.clear();
    companionContext.invalidate("authentication-connected");
    return subscriptionStatus();
  });
  handle("disconnectSubscription", async (provider) => {
    v.provider(provider);
    companionContext.invalidate("authentication-disconnect");
    subscriptionEpoch++;
    catalogs.clear();
    if (provider === "openai") await chatgpt.disconnect();
    else if (provider === "anthropic") await claude.logout();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
    companionContext.invalidate("authentication-disconnected");
    return subscriptionStatus();
  });
  handle("bootstrap", async () => ({
    ...gameSnapshot(),
    desktopRouteBuild: knowledge.bundled?.pack.build ?? null,
    providers: v.providers,
    version: app.getVersion(),
    updateStatus: updater.status(),
    secretStatus: store.secretStatus(),
    subscriptionStatus: await subscriptionStatus(),
  }));
  handle("fieldDispatchHistory", (...args) => {
    if (args.length) throw new Error("Invalid release history request.");
    return fieldDispatch.manual();
  });
  handle("fieldDispatchStartup", (...args) => {
    if (args.length) throw new Error("Invalid release recap request.");
    if (!store.state.onboarded || !win.isVisible() || win.isMinimized() || !win.isFocused()) return null;
    if (liveBridge.enabled && liveBridge.current()?.combat) return null;
    const status = fieldDispatch.start();
    if (status === "unavailable") return { retry: true };
    return { offer: fieldDispatch.offer() };
  });
  handle("fieldDispatchPresented", (id, ...extra) => !extra.length && fieldDispatch.presented(id));
  handle("fieldDispatchAcknowledge", (id, ...extra) => !extra.length && fieldDispatch.acknowledge(id));
  handle("saveState", (state, base) => {
    let next = mergeOrdinaryState(store.state, state, base);
    const previousActive =
      base === undefined
        ? store.state.activeProfileId
        : v.validateState(preserveMemories(store.state, base)).activeProfileId;
    if (game.status().connected && state.activeProfileId !== previousActive)
      next.followGameCharacter = false;
    if (store.state.followGameCharacter === false && next.followGameCharacter === true && game.status().connected && game.lastSnapshot && latestObservationRoot === game.root) {
      next = mergeSnapshot(next, game.lastSnapshot, {
        allowActiveSelection: !latestObservation || game.lastSnapshot.observedAt >= latestObservation,
      });
    }
    return store.saveState(next);
  });
  handle("saveProvider", (input) => {
    v.object(input, ["provider", "model", "endpoint", "apiKey", "authMode"]);
    v.provider(input.provider);
    v.str(input.model, 200);
    const next = v.validateState({
      ...store.state,
      provider: {
        id: input.provider,
        model: input.model,
        endpoint: v.endpoint(input.provider, input.endpoint),
        authMode: input.authMode ?? "api",
      },
    });
    if (
      (input.authMode ?? "api") === "api" &&
      input.apiKey !== undefined &&
      input.apiKey !== ""
    )
      store.saveKey(input.provider, input.apiKey);
    store.saveState(next);
    companionContext.invalidate("provider-save");
    catalogs.clear();
    return {
      state: structuredClone(store.state),
      secretStatus: store.secretStatus(),
    };
  });
  handle("deleteKey", (provider) => {
    companionContext.invalidate("authentication-key-delete");
    catalogs.clear();
    return store.deleteKey(provider);
  });
  handle("cancelAsk", (...args) => {
    if (args.length) throw Error("Invalid cancellation request.");
    companionService?.travel?.clear();
    const stopped = companionRequest.cancel();
    if (stopped) companionContext.invalidate("response-stop");
    // Stop remains visible while the renderer reviews an already completed reply.
    // Retire that draft without cancelling unrelated idle context or voice work.
    else memory.clearDraft();
    return stopped;
  });
  // Opt-in live game link: reads only the addon's status strip from the game window.
  liveBridge = new LiveBridge({ dataDir: app.getPath("userData") });
  const { matchingLiveFrame } = require("./core/character-freshness.cjs");
  const liveForRenderer = (status) => {
    const { activeProfileId, profiles } = store.state;
    const selected = profiles.find((profile) => profile.id === activeProfileId);
    return { ...status, liveProfileId: matchingLiveFrame(selected, status) ? activeProfileId : null };
  };
  liveBridge.subscribe((status) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:liveLink", liveForRenderer(status)); });
  if (liveBridge.enabled) liveBridge.start();
  handle("liveLinkStatus", () => liveForRenderer(liveBridge.status()));
  handle("setLiveLink", (enabled) => liveForRenderer(liveBridge.setEnabled(enabled)));
  let travelReference;
  let worldMap = null;
  try { travelReference = loadTravelReference(fs.readFileSync(path.join(__dirname, "..", "data", "forever-travel", "pack.json"))); } catch { travelReference = null; }
  const travel = new TravelCompanion({store, context: companionContext, reference: travelReference, openExternal: url => shell.openExternal(url), writeClipboard: text => clipboard.writeText(text)});
  handle("copyTravelGuidance", (...args) => travel.copyGuidance(...args));
  handle("createTravelPlan", (...args) => travel.createPlan(...args));
  handle("openTravelSource", (...args) => travel.openSource(...args));
  // Free AI on this PC (0.27): one-click install of a pinned engine and model.
  localAi = new (require("./core/local-ai.cjs").LocalAi)({ dir: path.join(app.getPath("userData"), "local-ai"),
    onChange: (s) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:localAi", s); } });
  app.on("before-quit", () => { void localAi.stop(); });
  handle("localAiStatus", () => localAi.status());
  handle("localAiCancel", () => { localAi.cancel(); return localAi.status(); });
  handle("localAiRemove", async () => {
    const s = await localAi.remove();
    if (store.state.provider.id === "local") { store.saveState(v.validateState({ ...store.state, provider: { id: "ollama", model: "", endpoint: v.providers[0].endpoint, authMode: "api" } })); companionContext.invalidate("provider-save"); }
    return s;
  });
  handle("localAiInstall", async (tier) => {
    if (tier !== undefined && !["standard", "light"].includes(tier)) throw Error("Invalid model choice.");
    const s = await localAi.install(tier);
    // Ready: make it the companion's model so the chat just works.
    store.saveState(v.validateState({ ...store.state, provider: { id: "local", model: "local", endpoint: v.endpoint("local"), authMode: "api" } }));
    companionContext.invalidate("provider-save"); catalogs.clear();
    return { ...s, state: structuredClone(store.state) };
  });
  companionService = new CompanionService({
    localAi,
    store, context: companionContext, requests: companionRequest, memory,
    ai, chatgpt, claude, knowledge, travel,
    npcReference: (()=>{try{return require('./core/npc-location-data.cjs').validateNpcLocationPack(JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','forever-npc-locations','pack.json'),'utf8')));}catch{return null;}})(),
    travelReference,
    live: liveBridge,
    // Quick answers (no model): the same advice as Now. `leveling` is created just below.
    advise: (profileId) => leveling.advise(profileId),
    // Planning tools use these page views, excluding the reference-only Dungeon Atlas.
    planner: Object.fromEntries(["nextStep", "alts", "worldTracker", "characterSheet", "playSession"].map((n) => [n, () => views[n]?.()])),
    // Talent questions use WoW Forever's own trees from the player's game client (read locally, never bundled).
    talents: { trees: (className) => gameData.talents(className), build: () => gameData.build(), ready: () => gameData.cached("talents") },
    vendorPack: (()=>{try{return require('./core/vendor-facts.cjs').loadVendorPack();}catch{return null;}})(),
    acquisitionPack: (()=>{try{return require('./core/acquisition-data.cjs').loadAcquisitionPack();}catch{return null;}})(),
    onReset: (reason) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:conversationReset", reason); },
  });
  // Community sharing (0.34): anonymous finds out (on by default, off switch in Settings), a daily pack in.
  const { CommunityService, BASE_URL, resolveBaseUrl } = require("./core/community.cjs");
  community = new CommunityService({
    dir: app.getPath("userData"), appVersion: app.getVersion(),
    baseUrl: app.isPackaged ? BASE_URL : resolveBaseUrl(), // BF_COMMUNITY_URL is for development and tests only
    getProfiles: () => store.state.profiles,
    // The optional Community attachment retains its existing fields; saved build stays local.
    getSupportText: () => require("./core/diagnostics.cjs").buildDiagnostics(collectDiagnostics({ includePatchImpact: false })).text,
  });
  require("./core/community-ipc.cjs").registerCommunityHandlers({
    handle, community,
    confirmForget: async () => (await dialog.showMessageBox(win, {
      type: "warning", title: "Forget my contributions?",
      message: "Ask the community service to delete everything this install has shared, including problem reports. Facts already published disappear at the next rebuild if fewer than 3 players still report them. Sharing then continues with a new anonymous install id unless you turn it off.",
      buttons: ["Cancel", "Forget my contributions"], defaultId: 0, cancelId: 0, noLink: true,
    })).response === 1,
  });
  community.start();
  // Backstage Desk: reports with replies, anonymous statistics (STATISTICS_DEFAULT in desk.cjs), automatic
  // error reports (off until switched on) and messages from the team, on the same service and install id.
  {
    const os = require("node:os");
    const { DeskService, systemInfo } = require("./core/desk.cjs");
    const { knownNames } = require("./core/desk-scrub.cjs");
    const accountFolders = () => { try { return game?.root ? fs.readdirSync(path.join(game.root, "WTF", "Account"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).slice(0, 50) : []; } catch { return []; } };
    desk = new DeskService({
      dir: app.getPath("userData"), community, appVersion: app.getVersion(), channel: releaseChannel,
      // A development or test run sends nothing by itself unless it was pointed at a test service (BF_COMMUNITY_URL).
      automatic: app.isPackaged || Boolean(process.env.BF_COMMUNITY_URL),
      system: systemInfo({ platform: process.platform, release: os.release(), systemVersion: typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "" }),
      // Local status only. The saved build of the active character, the addon the app installed, three yes/no facts.
      getFacts: () => {
        const status = game?.status?.() || {}, active = store.state.profiles.find((p) => p.id === store.state.activeProfileId);
        return { addonVersion: status.addonVersion || null, build: active?.clientBuild || null, gameConnected: Boolean(status.connected), addonInstalled: Boolean(status.addonInstalled || status.addonCurrent), liveLink: Boolean(liveBridge?.enabled) };
      },
      getNames: () => knownNames(store.state.profiles, [...accountFolders(), (() => { try { return os.userInfo().username; } catch { return ""; } })(), path.basename(os.homedir())]),
      notify: Notification.isSupported() ? (count) => new Notification({ title: "Backstage Forever", body: count === 1 ? "A reply to one of your reports is waiting. Open Help → My reports." : "Replies to your reports are waiting. Open Help → My reports.", silent: false }).show() : null,
      onChange: (unread) => {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:deskChanged", { unread });
        game?.writeHandoff().catch(() => {}); // /bf reports reads the count after the next /reload
        try { liveTicketSubs?.(); } catch {}
      },
    });
    community.onForgot = () => desk.wipe();
    const confirmForgetMe = async () => (await dialog.showMessageBox(win, {
      type: "warning", title: "Forget me?",
      message: "Ask the service to delete everything this install has sent: map discoveries, statistics and your reports with their replies. Your reports are also removed from this computer. The app then continues with a new random install id.",
      buttons: ["Cancel", "Forget me"], defaultId: 0, cancelId: 0, noLink: true,
    })).response === 1;
    require("./core/desk-ipc.cjs").registerDeskHandlers({
      handle, desk, confirmForget: confirmForgetMe, forget: () => community.forget(),
      openExternal: (link) => shell.openExternal(link),
    });
    desk.start();
  }
  // World Map: one zone of pins plus live position, and a cross-zone finder.
  worldMap = new (require("./core/world-map.cjs").WorldMap)({
    getState: () => store.state, knowledge, npcReference: companionService.npcReference, travelReference,
    vendorPack: companionService.vendorPack, insights, acquisitionPack: companionService.acquisitionPack, creaturePack, worldPack: require("./core/world-finds.cjs").loadWorldPack(), live: liveBridge,
    getCommunity: () => community?.index() || null,
    getTransport: () => require("./core/transport-data.cjs").loadTransportPack(),
  });
  handle("worldMap", (input) => worldMap.build(input || {}));
  handle("worldMapSearch", (query) => worldMap.search(query));
  handle("worldMapNpc", (npcId) => worldMap.npc(npcId));
  handle("dataCoverage", () => worldMap.coverage());
  // Scout notes (S1): a count for Help → Data coverage and "Save my scout notes…" to a file the player picks.
  require("./core/scout-ipc.cjs").registerScoutHandlers({ handle, getGame: () => game, dialog, getWindow: () => win });
  // Addon settings profiles (Settings): list what each character kept in game and send one to another character.
  profileSends = new (require("./core/settings-profiles.cjs").ProfileSends)(app.getPath("userData"));
  const settingsProfiles = require("./core/settings-profiles-ipc.cjs").registerSettingsProfiles({ handle, getGame: () => game, getState: () => store.state, sends: profileSends,
    onChange: () => { game?.writeHandoff().catch(() => {}); } });
  // After each read of the saved file: a profile the game has accepted or dismissed stops being sent.
  if (game) game.onSettingsProfiles = (blocks) => { if (settingsProfiles.settle(blocks)) game?.writeHandoff().catch(() => {}); };
  const leveling = new (require("./core/leveling.cjs").LevelingAdvisor)({
    getState: () => store.state, knowledge, insights,
    getLive: () => worldMap.liveFrame(worldMap.profile()),
  });
  handle("levelingAdvice", () => leveling.advise());
  // G10 (0.49): the first-launch tour is for new players only (no characters yet), never in automated tests.
  handle("onboarding", (...args) => { if (args.length) throw Error("Invalid onboarding request."); return { show: process.env.BF_TEST_INACTIVE !== "1" && !(!app.isPackaged && process.env.BF_USER_DATA && process.env.BF_ONBOARDING !== "1") && !(store.state.profiles || []).length }; });
  handle("worldTracker", (...args) => { if (args.length) throw Error("Invalid world tracker request."); return leveling.tracker(); });
  // Guided route (0.50, 4.1): the same routes the addon carries (built once from the bundled data and
  // the hand review), where the active character is on theirs, and how far each race's route reaches.
  // 0.51: the hand review. Bundled review (data/forever-route/reviews.json) plus this computer's edits
  // (route-review.json in the app's data folder); Export review writes the merged file for the next release.
  let guided = null, guidedRaw = null;
  const G = require("./core/guided-route.cjs");
  const desktopRoute = require("./core/desktop-route-recovery.cjs");
  const reviewFile = path.join(app.getPath("userData"), "route-review.json");
  const readJson = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));
  const bundledReview = () => { try { return readJson("data/forever-route/reviews.json"); } catch { return null; } };
  const localReview = () => { try { const v = JSON.parse(fs.readFileSync(reviewFile, "utf8")); return v && typeof v === "object" && v.routes && typeof v.routes === "object" ? v : null; } catch { return null; } };
  // 1.4 (J14): rebuilt when the characters have learned new quest givers.
  let guidedLearnedKey = "";
  const npcLocationsPack = (() => { try { return readJson("data/forever-npc-locations/pack.json"); } catch { return null; } })();
  let desktopGuided = null;
  const ensureGuided = () => {
    const learnedKey = (store.state.profiles || []).map((p) => `${p.id}:${p.journal?.givers?.length || 0}`).join("|");
    if (guided && learnedKey === guidedLearnedKey) return guided;
    guidedLearnedKey = learnedKey;
    guidedRaw = {};
    guided = G.buildGuidedRoutes({ pack: knowledge.bundled?.pack || readJson("data/forever/pack.json"), zones: readJson("data/forever-leveling/pack.json").zones, reviews: G.mergeReviews(bundledReview(), localReview()), raw: guidedRaw, learned: G.learnedGivers(store.state.profiles, npcLocationsPack) });
    return guided;
  };
  handle("routeReview", (...args) => {
    const [input] = args;
    if (args.length !== 1 || !input || typeof input !== "object" || typeof input.race !== "string" || !Number.isSafeInteger(input.page) || input.page < 0) throw Error("Invalid review request.");
    ensureGuided();
    const raw = guidedRaw[input.race];
    if (!raw) throw Error("Unknown race.");
    const { MAP_NAMES } = require("./core/companion-tools.cjs");
    const merged = G.mergeReviews(bundledReview(), localReview());
    const view = G.applyReview(raw, merged.routes[input.race] || null, { keepSkipped: true });
    const PAGE = 40, pages = Math.max(1, Math.ceil(view.steps.length / PAGE)), page = Math.min(input.page, pages - 1);
    return { race: input.race, races: Object.keys(guidedRaw), page, pages, total: view.steps.length, approved: view.steps.filter((s) => s.approved).length, skipped: view.steps.filter((s) => s.skipped).length,
      edits: Boolean(localReview()?.routes?.[input.race]),
      steps: view.steps.slice(page * PAGE, page * PAGE + PAGE).map((s, i) => ({ n: page * PAGE + i + 1, id: s.id, kind: s.kind, text: s.text, level: s.level, mapName: MAP_NAMES[s.mapId] || null, mapId: s.mapId, x: s.x, y: s.y, approved: Boolean(s.approved), skipped: Boolean(s.skipped) })) };
  });
  handle("setRouteReview", (...args) => {
    const [input] = args;
    if (args.length !== 1 || !input || typeof input !== "object" || typeof input.race !== "string" || typeof input.id !== "string" || input.id.length > 400 || !["approve", "skip", "clear", "up", "down"].includes(input.action)) throw Error("Invalid review action.");
    ensureGuided();
    const raw = guidedRaw[input.race];
    if (!raw) throw Error("Unknown race.");
    const current = G.applyReview(raw, G.mergeReviews(bundledReview(), localReview()).routes[input.race] || null, { keepSkipped: true });
    if (!current.steps.some((s) => s.id === input.id)) throw Error("Unknown step.");
    atomic(reviewFile, JSON.stringify(G.reviewAction(localReview(), input.race, input.id, input.action, current)));
    guided = desktopGuided = null; routeEditor?.invalidate();
    return true;
  });
  handle("exportRouteReview", async (...args) => {
    if (args.length) throw Error("Invalid export.");
    const result = await dialog.showSaveDialog(win, { title: "Export the route review (for data/forever-route/reviews.json)", defaultPath: "reviews.json", filters: [{ name: "Route review", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return null;
    atomic(result.filePath, JSON.stringify(G.exportReview(bundledReview(), localReview()), null, 2) + "\n");
    return true;
  });
  handle("guidedRoute", (...args) => {
    const [input] = args;
    if (args.length !== 1 || !input || typeof input !== "object" || Array.isArray(input) ||
      (input.profileId !== null && typeof input.profileId !== "string") || !Array.isArray(input.skips) ||
      input.skips.length > desktopRoute.MAX_SKIPS || input.skips.some((id) => typeof id !== "string" || id.length > 400)) throw Error("Invalid guided route request.");
    const { MAP_NAMES } = require("./core/companion-tools.cjs");
    const p = store.state.profiles.find((x) => x.id === store.state.activeProfileId) || null;
    if (input.profileId !== (p?.id ?? null)) return null;
    const pack = knowledge.bundled?.pack || readJson("data/forever/pack.json");
    // Never use the mixed-character learned giver cache to recommend a route point.
    desktopGuided ||= G.buildGuidedRoutes({ pack, zones: readJson("data/forever-leveling/pack.json").zones, reviews: G.mergeReviews(bundledReview(), localReview()) });
    // Q8/Q9: the character's own route: the variant they chose, with their edits laid over it.
    const mine = routeEditor.routeFor(p);
    const route = mine.route;
    const coverage = desktopGuided.routes.map((r) => ({ race: r.key, faction: r.faction, start: r.startName, from: r.startsLevel, to: r.reachesLevel, steps: r.steps.length, gaps: r.gaps, reviewed: r.reviewed }));
    const recovery = desktopRoute.recover({ route, profile: p, pack, skips: input.skips });
    return { profileId: p?.id ?? null, build: p?.clientBuild ?? null, route: route ? { race: route.key, total: route.steps.length, variant: mine.variant } : null,
      recovery, coverage, skipLimit: desktopRoute.MAX_SKIPS, mapName: MAP_NAMES[recovery.map?.mapId] || null };
  });
  routeEdits = new (require("./core/route-editor.cjs").RouteEdits)({ file: path.join(app.getPath("userData"), "route-edits.json"), write: atomic });
  try { routeEdits.absorb(store.state); } catch {}
  routeEditor = require("./core/route-editor-ipc.cjs").registerRouteEditor({
    handle, getState: () => store.state, edits: routeEdits, getPack: () => knowledge.bundled?.pack || readJson("data/forever/pack.json"),
    getZones: () => readJson("data/forever-leveling/pack.json").zones, getReviews: () => G.mergeReviews(bundledReview(), localReview()),
    getCreatures: () => { try { return readJson("data/forever-creatures/pack.json").creatures; } catch { return []; } },
    getBaseline: () => require("./core/dungeon-atlas.cjs").BASELINE, mapNames: require("./core/companion-tools.cjs").MAP_NAMES,
    dialog, getWindow: () => win, copyText: (text) => clipboard.writeText(text), onChange: () => { game?.writeHandoff().catch(() => {}); } });
  // "You are here": the zone the character is in, for their level and faction.
  handle("zoneBriefing", () => {
    const profile = worldMap.profile();
    if (!profile) return null;
    const build = worldMap.build({});
    const zones = leveling.pack.zones.filter((z) => z.mapId === build.mapId);
    const band = zones.find((z) => z.faction === profile.faction) || zones.find((z) => z.faction === "Contested") || zones[0] || null;
    return require("./core/zone-briefing.cjs").zoneBriefing({ build, profile, band, packs: { knowledge: knowledge.bundled?.pack || null, insights, vendors: companionService.vendorPack } });
  });
  // Live moments (0.33): deaths, notable kills, cleared dungeons, profession milestones, new zones and
  // flight paths, upgrades and finished quest chains, from the strip's moments pages and live frames.
  const momentsLib = require("./core/moments.cjs");
  const moments = new momentsLib.MomentsService({
    dataDir: app.getPath("userData"),
    reference: momentsLib.loadReference({ knowledge: knowledge?.bundled?.pack || null, insights, creatures: creaturePack }),
    getContext: () => {
      const profile = worldMap.profile(), frame = liveBridge.status().frame;
      return { level: frame?.level || profile?.level || null, faction: profile?.faction || null, mapId: frame?.position?.mapId || null };
    },
    zoneBand: (mapId) => {
      const faction = worldMap.profile()?.faction;
      const rows = leveling.pack.zones.filter((z) => z.mapId === mapId);
      const z = rows.find((r) => r.faction === faction) || rows.find((r) => r.faction === "Contested") || rows[0];
      return z ? { min: z.min, max: z.max } : null;
    },
    send: (m) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:moment", m); },
  });
  liveBridge.subscribeMoments((raw) => {
    try {
      const m = moments.observe(raw);
      // The death review names the cause a moment after the death itself was noted (W8, A4).
      if (m?.kind === "death" && raw?.type === 1) journeyStore?.annotateDeath(worldMap.profile()?.id, m.at, { tip: (raw.c >> 1) & 7, killer: m.death?.killer || null });
    } catch {}
  });
  handle("moments", () => moments.status());
  handle("setMomentSettings", (input) => moments.setSettings(input));
  // This play session (memory only): pace, deaths, level-ups and where you walked.
  const playSession = new (require("./core/play-session.cjs").PlaySession)();
  // Past sessions (0.48, 3.1), kept on this computer and shown on Characters → Journey.
  sessionHistory = new (require("./core/session-history.cjs").SessionHistory)({ file: path.join(app.getPath("userData"), "sessions.json") });
  liveBridge.subscribe(() => {
    try {
      const raw = liveBridge.status().frame;
      const mine = worldMap.liveFrame(worldMap.profile());
      // Combat frames carry no position; they still count as play for the same character.
      const frame = mine || (raw && raw.characterHash === playSession.key ? { ...raw, position: undefined } : null);
      for (const e of playSession.observe(frame)) {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:playEvent", e);
        moments.onPlayEvent(e);
        // W8: keep where this character died (zone and time) so the story and the coach can name it.
        if (e.kind === "death" && mine) journeyStore?.recordDeath(worldMap.profile()?.id, { at: e.at, mapId: e.mapId });
      }
      // Unlike ordinary history, a debrief cannot use a position with no saved-source link.
      if (mine) sessionHistory.checkpoint(playSession.summary(), worldMap.profile(), { savedSourceLinked: !!mine.characterHash });
      moments.observeFrame(raw);
    } catch {}
  });
  handle("playSession", () => playSession.summary());
  handle("playTrail", (mapId) => {
    if (!Number.isSafeInteger(mapId) || mapId <= 0) throw Error("Invalid map.");
    return playSession.trail(mapId);
  });
  // Zone art from the player's own WoW install, cached locally per game build.
  const mapArt = new (require("./core/map-art.cjs").MapArt)({ getRoot: () => game?.root || null, cacheDir: path.join(app.getPath("userData"), "map-art") });
  handle("mapArt", (mapId) => {
    if (!Number.isSafeInteger(mapId) || mapId <= 0) throw Error("Invalid map.");
    const r = mapArt.art(mapId);
    return { png: r.png ? new Uint8Array(r.png) : null, source: r.source || null, reason: r.reason || null };
  });
  require("./core/game-data-ipc.cjs").registerGameDataHandlers({ handle, gameData });
  // Talent coach: the player's real trees (from their install) plus a leveling path for their class.
  // Characters → Journey: badges, speed splits and the rested planner.
  handle("journey", () => {
    const s = store.state, p = s.profiles.find((x) => x.id === s.activeProfileId);
    if (!p) return null;
    const { badgesFor, rested } = require("./core/badges.cjs"), { splits, savedDungeonDefeats } = require("./core/journal-data.cjs");
    const others = s.profiles.filter((x) => x.id !== p.id);
    return { id: p.id, name: p.name, className: p.className || null, level: p.level || null, played: p.journal?.played ?? null, hasJournal: Boolean(p.journal),
      splits: splits(p, others), badges: badgesFor(p), rested: rested(p), zones: (p.journal?.zones || []).length, history: sessionHistory ? sessionHistory.view(p.id) : null,
      dungeonDefeats: savedDungeonDefeats(p) };
  });
  // 1.4 (J17, J18): this week's recap and reminders across your characters.
  handle("weekly", (...args) => {
    if (args.length) throw Error("Invalid weekly request.");
    const W = require("./core/weekly.cjs");
    return { recap: W.weeklyRecap(store.state, { history: (id) => (sessionHistory ? sessionHistory.view(id) : null) }), reminders: W.reminders(store.state) };
  });
  const activeSessionHistory = () => sessionHistory?.view(store.state.activeProfileId);
  handle("privateWeekly", (...args) => args.length ? null : privateWeekly.view(store.state, activeSessionHistory()), { privateOnly: true });
  handle("addPrivateWeekly", (input, ...extra) => extra.length ? null : privateWeekly.add(store.state, activeSessionHistory(), input), { privateOnly: true });
  const afterActionHistory = () => sessionHistory?.forAfterAction(worldMap.profile());
  handle("privateAfterAction", (...args) => args.length ? null : privateAfterAction.view(store.state, afterActionHistory()), { privateOnly: true });
  handle("savePrivateAfterAction", (input, ...extra) => extra.length ? null : privateAfterAction.save(store.state, afterActionHistory(), input), { privateOnly: true });
  // J27 (1.6): badge paintings as bytes, so the Badges page can draw its picture without a tainted canvas.
  handle("badgeArt", (...args) => {
    const ids = args[0];
    if (args.length !== 1 || !Array.isArray(ids) || ids.length > 60 || ids.some((id) => typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id))) throw Error("Invalid badge art request.");
    return ids.map((id) => { try { return new Uint8Array(fs.readFileSync(path.join(__dirname, "renderer", "art", "badges", `${id}.png`))); } catch { return null; } });
  });
  // Characters → Badges (1.1): every badge a character has earned, kept to look back on.
  handle("badges", (...args) => {
    if (args.length > 1 || (args.length && args[0] !== null && typeof args[0] !== "string")) throw Error("Invalid badges request.");
    return require("./core/badges.cjs").badgeBook(store.state, args[0] || null);
  });
  // Characters → All characters (0.43, 3.7): every character at a glance and who to play tonight.
  handle("alts", (...args) => {
    if (args.length) throw Error("Invalid characters request.");
    return require("./core/alts.cjs").altsView(store.state);
  });
  // Ledger (0.35): bags, bank, mail, gold, prices, reputations and cooldowns of every character.
  // Read-only; names and qualities come from the player's install, then the reference pack.
  const ledgerFacts = (ids) => {
    let found = [];
    try { found = ids.length ? gameData.items(ids) : []; } catch {}
    let pack = null;
    try { pack = (knowledge.packs.get(knowledge.build) || knowledge.bundled).pack; } catch {}
    return new Map(ids.map((id, i) => [id, { name: found[i]?.name || pack?.items?.[id]?.name || null, quality: Number.isInteger(found[i]?.quality) ? found[i].quality : null }]));
  };
  // Economy and history: the desktop keeps its own long memory of prices, gold and dungeon runs.
  economy = new (require("./core/economy.cjs").EconomyStore)({ file: path.join(app.getPath("userData"), "economy.json") });
  try { economy.absorb(store.state); } catch {}
  // Plans → Guild: guild events, sharing members and lockouts from the saved file, with the desktop's own guild.json.
  guildStore = new (require("./core/guild-events.cjs").GuildStore)({ file: path.join(app.getPath("userData"), "guild.json") });
  const guildPages = require("./core/guild-events-ipc.cjs").registerGuildHandlers({
    handle, getState: () => store.state, getGame: () => game, store: guildStore, economy, gameData, dialog, getWindow: () => win,
    packNames: () => (knowledge.packs.get(knowledge.build) || knowledge.bundled).pack,
  });
  // Backstage Live: one stream from the service (team replies, guild events and sign-ups, the realm party
  // board), the guild service with the game's feed, the group planner with regulars, and the panel.
  // Nothing here connects or sends until something needs it: an open report, a guild the player joined,
  // or the party board the player switched on.
  {
    const { LiveClient } = require("./core/live-client.cjs");
    const { GuildService } = require("./core/guild-service.cjs");
    const { GroupStore } = require("./core/group-planner.cjs");
    const { createLiveGuildHub, registerLiveGuildHandlers } = require("./core/live-guild-ipc.cjs");
    const guildFeed = require("./core/game-guild-feed.cjs"); // the game side: what the addon reports, and what it reads at /reload
    const userData = app.getPath("userData");
    // Like Desk: a development or test run opens no stream by itself unless it was pointed at a test service.
    liveClient = new LiveClient({ baseUrl: community.baseUrl, getInstallId: () => community.settings.installId, enabled: app.isPackaged || Boolean(process.env.BF_COMMUNITY_URL) });
    groupStore = new GroupStore({ file: path.join(userData, "group.json") });
    let hub = null;
    guildService = new GuildService({
      dir: userData, community, live: liveClient, feed: guildFeed,
      // The game reads this at its next /reload; one member reloading passes the news on in game.
      setHandoff: (data) => { guildFeed.setHandoff(data); }, // the feed rewrites the hand-off file when something changed
      getSaved: () => game?.guildCapture?.() || [],
      getPlan: (character) => hub?.handoffPlan(character) || null,
    });
    hub = createLiveGuildHub({
      getState: () => store.state, guildStore, service: guildService, group: groupStore, feed: { real: true }, liveLink: () => Boolean(liveBridge?.enabled),
      attunements: (profile) => require("./core/attunements.cjs").attunementView(profile),
    });
    // The Calendar shows the saved file's guild events together with the live events of guilds the player joined.
    { const savedEntries = guildPages.calendarEntries; guildPages.calendarEntries = () => hub.calendarEntries(savedEntries()); }
    const showApp = (route) => {
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      if (!win.webContents.isDestroyed()) win.webContents.send("backstage:openPage", route);
    };
    guildPanel = require("./core/guild-panel-window.cjs").createGuildPanel({
      BrowserWindow, ipcMain, screen: require("electron").screen, rendererDir: path.join(__dirname, "renderer"), dataDir: userData,
      view: () => hub.panelView(),
      inCombat: () => Boolean(liveBridge?.enabled && liveBridge.current()?.combat),
      gameLocale: () => store.state.profiles.find((p) => p.id === store.state.activeProfileId)?.locale || null,
      actions: {
        answer: (guildId, eventId, answer) => guildService.answer(guildId, eventId, answer),
        board: async (action) => { if (action === "watch") { guildService.watchBoard(true); return true; } if (action === "browse") return guildService.browse(); return action === "renew" ? guildService.renew() : guildService.removeListing(); },
        watch: (on) => guildService.watchBoard(on),
        assign: (slot, member) => hub.changePlan(null, { action: "assign", slot, member }),
        openApp: showApp,
      },
    });
    registerLiveGuildHandlers({ handle, hub, service: guildService, group: groupStore, openExternal: (url) => shell.openExternal(url), copyText: (text) => clipboard.writeText(text), panel: guildPanel });
    // The screens repaint a moment after anything changed, however many changes arrive together.
    let liveNotice = null;
    guildService.on("change", () => {
      if (liveNotice) return;
      liveNotice = setTimeout(() => {
        liveNotice = null;
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:liveGuild", { at: Date.now() });
        guildPanel?.push(false);
      }, 120);
    });
    guildService.on("party", (party) => { try { if (party && groupStore.sawParty(party)) guildPanel?.push(false); } catch {} });
    // Desk rides on the same stream: a team reply shows the moment it is written. The three-hour check stays.
    liveTicketSubs = () => liveClient?.setSubs("tickets", desk ? desk.liveSubs() : []);
    liveClient.on("event", (name, data) => { if (name === "ticket") { try { desk?.liveTicket(data); } catch {} } });
    liveClient.on("refetch", () => { void desk?.sync({ force: true }).catch(() => {}); });
    liveTicketSubs();
    // "Forget me" also leaves every guild on the service; the app forgets its memberships with it.
    const forgot = community.onForgot;
    community.onForgot = () => { try { forgot?.(); } finally { guildService.wipe(); } };
    // After every read of the game's saved file the game holds the last hand-off.
    if (game) {
      const before = game.onSettingsProfiles;
      game.onSettingsProfiles = (blocks) => { try { before?.(blocks); } finally { try { guildPages.refresh(); hub.absorbSaved(); guildService.savedFileRead(); } catch {} } };
    }
    try { hub.absorbSaved(); guildService.updateHandoff(); } catch {}
    const liveTick = setInterval(() => { void guildService?.tick().catch(() => {}); }, 60 * 1000);
    liveTick.unref?.();
    if (guildPanel.openAtStart() && process.env.BF_TEST_INACTIVE !== "1") setTimeout(() => { try { guildPanel?.open(); } catch {} }, 4000).unref?.();
  }
  const economyPages = require("./core/economy-ipc.cjs").registerEconomyHandlers({
    handle, getState: () => store.state, economy, gameData, dialog, getWindow: () => win, guild: guildPages,
    packNames: () => (knowledge.packs.get(knowledge.build) || knowledge.bundled).pack,
    notify: Notification.isSupported() ? (title, body) => new Notification({ title, body, silent: false }).show() : null,
  });
  // Journey extras: the story so far, the screenshot timeline, leveling races, Coach's notes,
  // the stream overlay and share cards. The desktop keeps a small file of its own (journey.json).
  journeyStore = new (require("./core/journey-store.cjs").JourneyStore)({ file: path.join(app.getPath("userData"), "journey.json"), validFriend: require("./core/level-race.cjs").importCode });
  try { journeyStore.absorb(store.state); } catch {}
  const shotThumbs = new (require("./core/screenshot-journal.cjs").ThumbCache)({
    cacheDir: path.join(app.getPath("userData"), "screenshot-previews"),
    render: (file, width) => {
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) return null;
      return image.resize({ width: Math.min(width, image.getSize().width), quality: "good" }).toJPEG(78);
    },
  });
  let overlayCache = null;
  streamOverlay = new (require("./core/stream-overlay.cjs").StreamOverlay)({
    // A streaming program asks every two seconds; the answer is worked out at most once a second.
    getState: () => { if (!overlayCache || Date.now() - overlayCache.at > 1000) overlayCache = { at: Date.now(), facts: journeyExtras.overlayFacts() }; return overlayCache.facts; },
  });
  const journeyExtras = require("./core/journey-extras-ipc.cjs").registerJourneyExtras({
    handle, getState: () => store.state, journey: journeyStore, economy, sessions: (id) => (sessionHistory ? sessionHistory.view(id) : null), leveling,
    chains: () => moments.reference, badgesFor: (p) => require("./core/badges.cjs").badgesFor(p), getRoot: () => game?.root || null, thumbs: shotThumbs, overlay: streamOverlay,
    playSummary: () => playSession.summary(), dialog, getWindow: () => win, showFile: (file) => shell.showItemInFolder(file),
    // Newer Electron takes pictures as clipboard items; older ones have writeImage.
    copyImage: async (png) => {
      if (typeof clipboard.writeImage === "function") return clipboard.writeImage(nativeImage.createFromBuffer(png));
      const { ClipboardItem } = require("electron");
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })]);
    },
    copyText: (text) => clipboard.writeText(text),
  });
  // Challenge runs (C12) and the Discord status (S6, off until an application id is typed in).
  challengeRuns = new (require("./core/challenge-runs.cjs").ChallengeStore)({ file: path.join(app.getPath("userData"), "challenge-runs.json"), write: atomic });
  try { challengeRuns.absorb(store.state); } catch {}
  discordPresence = new (require("./core/discord-presence.cjs").DiscordPresence)({ file: path.join(app.getPath("userData"), "discord-presence.json"), write: atomic });
  // Only while the live link reports: Discord must never show a place from an old save.
  const presenceFacts = () => {
    try {
      const f = journeyExtras.overlayFacts(), p = store.state.profiles.find((x) => x.id === store.state.activeProfileId);
      return f.live && p ? { level: f.level, className: p.className || "", zone: f.zone || "" } : null;
    } catch { return null; }
  };
  require("./core/journey-more-ipc.cjs").registerJourneyMore({ handle, getState: () => store.state, challenges: challengeRuns, journey: journeyStore, presence: discordPresence, presenceFacts });
  const presenceTimer = setInterval(() => { try { if (discordPresence.settings.enabled) discordPresence.update(presenceFacts()); } catch {} }, 20000);
  presenceTimer.unref?.();
  app.on("before-quit", () => { void streamOverlay?.stop(); });
  app.on("before-quit", () => { try { discordPresence?.stop(); } catch {} });
  void journeyExtras.resume();
  clearJourneyExtras = () => { void streamOverlay.stop(); journeyStore.clear(); shotThumbs.clear(); try { challengeRuns.clear(); discordPresence.clear(); } catch {} };
  const economyTimer = setInterval(() => { try { economyPages.tick(); } catch {} }, 60000);
  economyTimer.unref?.();
  handle("ledger", (...args) => {
    if (args.length) throw Error("Invalid ledger request.");
    const L = require("./core/ledger.cjs"), s = store.state;
    const view = L.ledgerView(s, { facts: ledgerFacts(L.itemIds(s.profiles)) });
    // Only an exact pack can associate reference rewards with this character's saved log.
    const { repAdvice } = require("./core/rep-advice.cjs");
    for (const c of view.characters) {
      const p = s.profiles.find((x) => x.id === c.profileId);
      if (!c.reputations || !p) continue;
      try {
        const exact = p.clientBuild ? knowledge.index(p)?.pack : null;
        const pack = exact || knowledge.bundled?.pack;
        c.repAdvice = exact ? repAdvice(p, pack) : repAdvice(p, pack, { browseOnly: true });
        if (c.repAdvice) Object.assign(c.repAdvice, { referenceBuild: pack.build, characterBuild: p.clientBuild ?? null });
      } catch { c.repAdvice = null; }
    }
    let extras = { crafts: [], money: [], vendorPricesSeen: 0 };
    try { extras = economyPages.ledgerExtras(s, view); } catch { /* The Ledger still opens without its history. */ }
    return { ...view, ...extras, goal: require("./core/gold-goal.cjs").goldGoalView(s) };
  });
  // Gold goal (0.36, E4): the player's own target; null clears it. Only this handler writes it.
  handle("setGoldGoal", (...args) => {
    if (args.length < 1 || args.length > 2) throw Error("Invalid gold goal.");
    const GG = require("./core/gold-goal.cjs"), goal = GG.goalFromInput(args[0]);
    const current = store.state;
    if (args.length === 2) {
      v.object(args[1], ["profileId", "expectedGoal"]);
      const { profileId, expectedGoal } = args[1], saved = current.goldGoal;
      v.str(profileId, 100, false);
      if (!goal || expectedGoal === undefined) throw Error("Invalid gold goal.");
      if (expectedGoal !== null) GG.validateGoldGoal(expectedGoal);
      // Compare with committed state: both the picker and review can be stale.
      if (profileId !== current.activeProfileId || expectedGoal?.copper !== saved?.copper ||
          expectedGoal?.label !== saved?.label || expectedGoal?.setAt !== saved?.setAt)
        return { reviewExpired: true };
    }
    const next = structuredClone(current);
    if (goal) next.goldGoal = goal; else delete next.goldGoal;
    store.saveState(v.validateState(next));
    return GG.goldGoalView(store.state);
  });
  // Character sheet (0.36, G5 + A12): the active character's gear by slot, stats and gear sets.
  // Item facts, scores and upgrade verdicts come from the player's own install, as on item cards.
  handle("characterSheet", (...args) => {
    if (args.length) throw Error("Invalid character sheet request.");
    const S = require("./core/sheet.cjs"), s = store.state;
    const profile = s.profiles.find((p) => p.id === s.activeProfileId) || null;
    if (!profile) return null;
    const ids = S.sheetItemIds(profile);
    let found = [];
    try { found = ids.length ? gameData.items(ids) : []; } catch {}
    const facts = new Map();
    ids.forEach((id, i) => { if (found[i]) facts.set(id, found[i]); });
    const weights = profileWeights(profile);
    const ctx = { className: profile.className || undefined, level: Number.isInteger(profile.level) ? profile.level : undefined, ...(weights ? { weights } : {}) };
    const { scoreItem } = require("./core/gear-score.cjs"), loot = require("./core/boss-loot.cjs");
    let worn = null;
    try { worn = loot.equipmentContext(profile, gameData, weights); } catch {}
    return S.sheetView(profile, {
      profiles: s.profiles, facts,
      score: facts.size && ctx.className ? (it) => { try { return scoreItem(it, ctx).score || 0; } catch { return 0; } } : null,
      verdict: worn ? (it) => { try { return loot.upgradeVerdict(it, worn); } catch { return null; } } : null,
    });
  });
  let ledgerPrices = { key: null, index: null };
  const ledgerPrice = (id) => {
    const L = require("./core/ledger.cjs"), profiles = store.state.profiles;
    const key = profiles.map((p) => (p.ledger ? `${p.id}:${p.source?.updatedAt || ""}:${p.ledger.prices.length}` : "")).join("|");
    if (ledgerPrices.key !== key) ledgerPrices = { key, index: L.priceIndex(profiles) };
    return L.priceFor(ledgerPrices.index, id);
  };
  const travelPlanner = require("./core/travel-planner-ipc.cjs").registerTravelPlannerHandlers({ handle, getState: () => store.state, gameData, reference: travelReference });
  shipRides = () => { try { return travelPlanner.rides(); } catch { return null; } };
  handle("talentCoach", (input) => {
    const className = typeof input?.className === "string" ? input.className.slice(0, 20) : null;
    const level = Number.isInteger(input?.level) && input.level >= 1 && input.level <= 100 ? input.level : null;
    if (!className || !level) throw Error("Invalid talent request.");
    const trees = gameData.talents(className);
    // 1.3 (J9): class quests and key unlocks, with or without the talent trees.
    const unlocks = require("./core/class-unlocks.cjs").classUnlocks(className, level);
    // C6: what the class trainer newly teaches at this level and the next two, with costs.
    let training = null;
    try { training = travelPlanner.trainerView(className, level); } catch { training = null; }
    // B3 (roadmap C7): the Hunter pet book, from recorded tames. Ability names come from the game files.
    let petBook = null;
    if (className === "Hunter") {
      try {
        const H = require("./core/hunter-pets.cjs"), pack = H.loadPets();
        const profile = store.state.profiles.find((p) => p.id === store.state.activeProfileId) || null;
        const standing = require("./core/travel-planner-ipc.cjs").buildStanding(pack, profile);
        const { MAP_NAMES } = require("./core/companion-tools.cjs");
        petBook = standing.usable ? H.petBook(pack, { spells: (ids) => gameData.spells(ids), mapName: (m) => MAP_NAMES[m], level: profile?.className === "Hunter" ? profile.level : null, note: standing.note }) : { available: false, reason: standing.note };
      } catch { petBook = null; }
    }
    if (!trees) return { available: false, unlocks, training, petBook, reason: gameData.status().reason || "Talent trees are not available from your game install yet." };
    return { available: true, trees, unlocks, training, petBook, coach: require("./core/talent-coach.cjs").coach(trees, className, level) };
  });
  // Talent planner: click-to-spend on the same trees, saved builds per character, and the build
  // marked "Use in game" rides the desktop -> game hand-off.
  talentBuilds = new (require("./core/talent-builds.cjs").TalentBuilds)(app.getPath("userData"));
  require("./core/talent-planner-ipc.cjs").registerTalentPlanner({ handle, getState: () => store.state, gameData, builds: talentBuilds, onChange: () => { game?.writeHandoff().catch(() => {}); } });
  // Gathering loops (E4): the loop for a zone, and the one each character sends to the game.
  gatheringLoops = new (require("./core/gathering-loop.cjs").GatheringLoops)(app.getPath("userData"));
  require("./core/gathering-loop-ipc.cjs").registerGatheringLoop({ handle, getState: () => store.state, loops: gatheringLoops, getCommunity: () => community?.index() || null,
    worldPack: require("./core/world-finds.cjs").loadWorldPack(), acquisitionPack: companionService.acquisitionPack, getTransport: () => require("./core/transport-data.cjs").loadTransportPack(),
    onChange: () => { game?.writeHandoff().catch(() => {}); } });
  radar = require("./core/radar-window.cjs").createRadar({ BrowserWindow, ipcMain, worldMap, live: liveBridge, rendererDir: path.join(__dirname, "renderer"), mapArt });
  handle("openRadar", () => radar.open());
  handle("setRadarTarget", (pin) => radar.setTarget(pin === undefined ? null : pin));
  // Mini Now (0.44, 3.4): next step, XP and pace in a small always-on-top window beside the game.
  miniNow = require("./core/mini-now-window.cjs").createMiniNow({ BrowserWindow, ipcMain, advise: () => leveling.advise(), session: () => playSession.summary(), live: liveBridge, rendererDir: path.join(__dirname, "renderer") });
  handle("openMiniNow", () => miniNow.open());
  // Spoken next steps (0.45, 3.5): the same one step, with its sentence, for the voice.
  handle("nextStep", (...args) => {
    if (args.length) throw Error("Invalid next step request.");
    return { profileId: store.state.activeProfileId ?? null, step: require("./core/next-step.cjs").nextStep(leveling.advise()) };
  });
  const { buildAtlas, loadEncounters } = require("./core/dungeon-atlas.cjs");
  const { dungeonProgression } = require("./core/dungeon-progression.cjs");
  const encounters = loadEncounters();
  // Loot browser, wish list and item hover cards (boss loot pack + the player's own game data).
  wishlist = new (require("./core/wishlist.cjs").WishList)(app.getPath("userData"));
  statWeights = new (require("./core/stat-weights.cjs").StatWeights)(app.getPath("userData"));
  gearPins = new (require("./core/gear-plan.cjs").GearPins)(app.getPath("userData"));
  require("./core/sheet-comparison.cjs").registerSheetComparison({ handle, getState: () => store.state, gameData, wishlist, weightsFor: profileWeights });
  const bossLoot = require("./core/boss-loot-ipc.cjs").registerBossLootHandlers({ handle, getState: () => store.state, gameData, wishlist, weightsFor: profileWeights, onWishChange: () => { game?.writeHandoff().catch(() => {}); }, getPack: () => require("./core/boss-loot-data.cjs").loadBossLootPack(), getCommunity: () => community?.index() || null, creatureName: (id) => worldMap?.npcName(id) || null, priceFor: (id) => ledgerPrice(id) });
  handoffUpgrades = (profile) => bossLoot.upgrades(profile);
  // Stat weights, gear plan, reputation planner, attunements and collections (roadmap C3, C2, C10, G5, C11).
  let vendorReference; // read once, on first use
  require("./core/gear-planning-ipc.cjs").registerGearPlanning({ handle, getState: () => store.state, gameData, statWeights, gearPins, wishlist,
    questPack: (p) => (p?.clientBuild ? knowledge.index(p)?.pack : null) || knowledge.bundled?.pack || null,
    vendorPack: () => { if (vendorReference === undefined) { try { vendorReference = require("./core/vendor-facts.cjs").loadVendorPack(); } catch { vendorReference = null; } } return vendorReference; },
    bossLootPack: () => require("./core/boss-loot-data.cjs").loadBossLootPack(),
    lootPack: () => require("./core/loot-data.cjs").loadLootPack(),
    onChange: () => { game?.writeHandoff().catch(() => {}); } });
  // Recipe book, computed skill path, who can craft it, cooking from your bags (roadmap E2, E1, E3, E5).
  require("./core/recipe-book-ipc.cjs").registerRecipeBook({ handle, getState: () => store.state, gameData,
    trainerPack: () => require("./core/trainer-data.cjs").loadTrainerPack(),
    vendorPack: () => { if (vendorReference === undefined) { try { vendorReference = require("./core/vendor-facts.cjs").loadVendorPack(); } catch { vendorReference = null; } } return vendorReference; },
    lootPack: () => require("./core/loot-data.cjs").loadLootPack(),
    bossLootPack: () => require("./core/boss-loot-data.cjs").loadBossLootPack(),
    questPack: (p) => (p?.clientBuild ? knowledge.index(p)?.pack : null) || knowledge.bundled?.pack || null,
    instanceNames: () => require("./core/boss-loot.cjs").INSTANCE_NAMES });
  handle("dungeonAtlas", () => {
    const profile = store.state.profiles.find((p) => p.id === store.state.activeProfileId) || null;
    const atlas = buildAtlas({ profile, encounters, knowledgePack: knowledge?.bundled?.pack }), loot = bossLoot.summary(profile);
    for (const e of atlas.entries) if (loot[e.id]) e.loot = loot[e.id];
    atlas.progression = dungeonProgression("dm", profile, wishlist.get(profile?.id));
    return atlas;
  });
  // World search ("Search everything", Ctrl+K): one index over the bundled reference, the player's own game
  // files, the community pack and the app's commands and help. Built on first use, kept per data version.
  let searchSources = null;
  const worldSearch = new (require("./core/world-search.cjs").WorldSearch)({
    gameData, getProfile: () => worldMap.profile(), getCommunity: () => community?.index() || null, getLive: () => worldMap.liveFrame(worldMap.profile()),
    sources: () => (searchSources ||= (() => {
      const optional = (fn) => { try { return fn(); } catch { return null; } };
      const knowledgePack = knowledge?.bundled?.pack || null;
      return {
        knowledgePack, pins: worldMap.static, vendorPack: companionService.vendorPack, insights, worldPack: worldMap.worldPack, creatures: worldMap.creatures,
        transport: optional(() => require("./core/transport-data.cjs").loadTransportPack()),
        trainerPack: optional(() => require("./core/trainer-data.cjs").loadTrainerPack()),
        lootPack: optional(() => require("./core/loot-data.cjs").loadLootPack()),
        bossLootPack: optional(() => require("./core/boss-loot-data.cjs").loadBossLootPack()),
        atlas: optional(() => buildAtlas({ profile: null, encounters, knowledgePack })),
        levelingZones: optional(() => require("./core/leveling.cjs").loadLevelingPack().zones),
        instanceNames: optional(() => require("./core/boss-loot.cjs").INSTANCE_NAMES) || {},
        commands: optional(() => require("./renderer/commands.js")),
      };
    })()),
  });
  handle("worldSearch", (query, options, ...extra) => {
    if (extra.length) throw Error("Invalid search.");
    return worldSearch.search(query, options === undefined ? {} : options);
  });
  handle("worldSearchDetail", (kind, id, ...extra) => {
    if (extra.length) throw Error("Invalid search detail.");
    return worldSearch.detail(kind, id);
  });
  handle("copyWaypoint", (input) => {
    if (!input || typeof input !== "object") throw Error("Invalid waypoint.");
    const { mapId, x, y } = input;
    if (!Number.isSafeInteger(mapId) || mapId <= 0 || ![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw Error("Invalid waypoint.");
    const label = typeof input.label === "string" ? input.label.replace(/[^\p{L}\p{N} '\-.,]/gu, "").slice(0, 60).trim() : "";
    const command = `/bf way ${mapId} ${(x * 100).toFixed(1)} ${(y * 100).toFixed(1)}${label ? " " + label : ""}`;
    clipboard.writeText(command);
    return { command, message: "Waypoint copied. Paste it into WoW chat." };
  });
  // Questions typed in game (0.38, A15): over the live strip, answered like the Companion page,
  // shown in a panel over the game. The Companion page reports its "Use my active character" choice.
  let inGameShare = false;
  let inGameAsk = null;
  const askPanel = require("./core/ask-panel.cjs").createAskPanel({
    BrowserWindow, ipcMain, screen: require("electron").screen, rendererDir: path.join(__dirname, "renderer"), dataDir: app.getPath("userData"),
    gameRect: () => liveBridge.gameWindow(),
    onOpenApp: () => {
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      if (!win.webContents.isDestroyed()) win.webContents.send("backstage:openPage", "assistant");
    },
    // Questions typed in the panel itself go the same way as the ones from the game.
    onAsk: (question) => { void inGameAsk?.askTyped(question); },
  });
  dropAskPanelWindow = () => askPanel.destroyWindow();
  inGameAsk = new (require("./core/ask-in-game.cjs").InGameAsk)({
    companion: companionService, getState: () => store.state, liveKeyFor: require("./core/live-bridge.cjs").liveKeyFor,
    panel: askPanel, getShare: () => inGameShare,
    // The last answers per character are kept in ask-answers.json so /bf answers survives a restart.
    answers: new (require("./core/ask-answers.cjs").AskAnswers)(app.getPath("userData")),
    notify: (exchange) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("backstage:inGameExchange", exchange);
      // Roadmap A1: the answer joins the hand-off file, so /bf answers shows it after the next /reload.
      game?.writeHandoff().catch(() => {});
    },
  });
  recentGameAnswers = (id) => inGameAsk.recent(id);
  // A deleted character takes its kept answers with it; "Delete all local data" clears them all.
  forgetGameAnswers = (ids) => { if (inGameAsk.forget(ids)) game?.writeHandoff().catch(() => {}); };
  clearGameAnswers = () => inGameAsk.clear();
  liveBridge.subscribeQuestions((question) => { void inGameAsk.handle(question); });
  // Backstage Live, game side: guild, party and board signals from the live link and the saved file
  // go to game-guild-feed.cjs (the panel and the service client listen there); what it is given
  // for the game (setHandoff) is written into the hand-off file for the next /reload.
  { const guildFeed = require("./core/game-guild-feed.cjs");
    guildFeed.attach(liveBridge);
    guildFeed.onHandoffChange(() => { game?.writeHandoff().catch(() => {}); });
    if (game) { game.onLiveBlocks = (live, guild) => { guildFeed.ingestSaved(live, guild); }; try { guildFeed.ingestSaved(game.liveCapture(), game.guildCapture()); } catch {} } }
  const stopAskContext = companionContext.subscribe(({ reason }) => {
    if (["source-root", "source-disconnect", "reset", "import", "restore"].includes(reason)) inGameAsk.rememberOrigin(null);
  });
  closeAskPanel = () => { stopAskContext(); askPanel.close(); };
  handle("askInGameSettings", (...args) => { if (args.length) throw Error("Invalid panel settings."); return askPanel.settings(); });
  handle("setAskInGameSettings", (input) => askPanel.setSettings(input));
  handle("setInGameShare", (share) => { if (typeof share !== "boolean") throw Error("Invalid sharing choice."); inGameShare = share; return true; });
  handle("ask", (...args) => companionService.legacy(...args));
  handle("askCompanion", (...args) => companionService.ask(...args));
  handle("clearConversation", (...args) => companionService.clear(...args));
  // Share card (0.46, 3.3): a PNG the World Map drew of your own path, saved where you choose.
  handle("saveSharePicture", async (...args) => {
    const bytes = args[0], kind = args[1] ?? "journey";
    if (args.length < 1 || args.length > 2 || !(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 8 * 1024 * 1024 || !(["journey", "badges"].includes(kind) || require("./core/journey-extras-ipc.cjs").SHARE_KINDS.includes(kind))) throw Error("Invalid picture.");
    if (![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) throw Error("Invalid picture.");
    const result = await dialog.showSaveDialog(win, kind === "badges"
      ? { title: "Save a picture of your badges", defaultPath: "Backstage-Forever-badges.png", filters: [{ name: "PNG picture", extensions: ["png"] }] }
      : { title: kind === "journey" ? "Save a picture of your journey" : "Save this picture", defaultPath: `Backstage-Forever-${kind}.png`, filters: [{ name: "PNG picture", extensions: ["png"] }] });
    if (result.canceled || !result.filePath) return null;
    await require("node:fs/promises").writeFile(result.filePath, bytes);
    return true;
  });
  handle("exportData", async () => {
    const result = await dialog.showSaveDialog(win, {
      title: "Export profiles and plans (keys and memory excluded)",
      defaultPath: "Backstage-Forever-backup.json",
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    atomic(result.filePath, store.exportData());
    return true;
  });
  handle("importData", async () => {
    const epoch = subscriptionEpoch;
    const result = await dialog.showOpenDialog(win, {
      title: "Import a Backstage Forever backup",
      properties: ["openFile"],
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (result.canceled || epoch !== subscriptionEpoch) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > MAX_BACKUP_BYTES)
      throw new Error("Invalid backup.");
    const text = fs.readFileSync(file, "utf8");
    store.validateBackup(text);
    const confirm = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Replace saved profiles?",
      message:
        "Import replaces profiles, notes, goals, plans and preferences, clears saved conversation memory, and disconnects game observation. Existing API keys are preserved. " + (store.recoveryStatus().automatic ? "A local safety point protects your current journal before replacement." : "Automatic protection is off: no automatic safety copy will be made."),
      buttons: ["Cancel", "Import backup"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1 || epoch !== subscriptionEpoch) return null;
    return replaceJournal(() => store.importData(text), "import");
  });
  handle("resetData", async () => {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Delete all local data?",
      message:
        "This deletes all profiles, goals, notes, plans, Supply Desk records, saved conversation memory, recovery points, preserved damaged originals, preferences, API keys and app-owned subscription credentials. Pending sign-ins are cancelled. Other apps and global Claude credentials are unaffected. Exported backups remain separate.",
      buttons: ["Cancel", "Delete all data"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    // A blocked private root stage must reject before this reset changes any other store.
    store.recovery.clearRootStages();
    // If retirement cannot be persisted, leave the journal and its related state untouched.
    fieldDispatch.beginReset();
    resetting = true;
    recovery.clear();
    characterGuidance.clear();
    try { sessionHistory?.clear(); } catch {}
    try { economy?.clear(); } catch {}
    try { guildStore?.clear(); } catch {}
    try { guildService?.reset(); groupStore?.clear(); } catch {} // local memberships (their tokens), the plan and regulars
    try { clearJourneyExtras?.(); } catch {}
    try { fs.rmSync(path.join(app.getPath("userData"), "route-review.json"), { force: true }); guided = desktopGuided = null; } catch {}
    try { fs.rmSync(path.join(app.getPath("userData"), "route-edits.json"), { force: true }); routeEdits.data = {}; routeEditor?.invalidate(); } catch {}
    diagnostics.clear();
    companionContext.invalidate("reset");
    subscriptionEpoch++;
    gameActionEpoch++;
    catalogs.clear();
    try {
      const knowledgeReset = knowledge.reset();
      await game.reset();
      store.recovery.disconnectSavedGame();
      latestObservation = null;
      const updateReset = updater.reset();
      chatgpt.reset();
      await updateReset;
      await knowledgeReset;
      await claude.clearCredentials();
      guildRuns.reset();
      localPlanPack.reset();
      const fresh = store.reset();
      privateAfterAction.clear();
      wishlist?.clear(); // starred loot belongs to the characters just deleted
      statWeights?.clear(); gearPins?.clear(); // and so do their stat weights and pinned gear targets
      talentBuilds?.clear(); // and so do their talent builds
      try { clearGameAnswers?.(); } catch {} // and the answers kept for /bf answers
      gatheringLoops?.clear(); // and the gathering loops sent to the game
      profileSends?.clear(); // and the settings profiles waiting to be offered in game
      community?.reset(); // local install id, sent marks and pack; shared facts stay on the server
      desk?.reset(); // local reports, their keys and the privacy switches
      fieldDispatch.finishReset();
      supplyDesk.reset();
      return fresh;
    } finally {
      resetting = false;
    }
  });
  handle("openLink", async (id) => {
    if (!Object.hasOwn(links, id)) throw new Error("Unknown link.");
    await shell.openExternal(links[id]);
    return true;
  });
  function createWindow() {
    // Unpackaged test runs only: open behind other windows without taking keyboard focus,
    // so automated checks never capture keys meant for a game the developer is playing.
    const testInactive = !app.isPackaged && process.env.BF_TEST_INACTIVE === "1";
    win = new BrowserWindow({
      ...(testInactive ? { show: false } : {}),
      width: 1440,
      height: 960,
      minWidth: 1000,
      minHeight: 700,
      title: "Backstage Forever",
      backgroundColor: "#0b1420",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    if (testInactive) win.once("ready-to-show", () => win.showInactive());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("blur", () => voice.blur());
    // A hidden answer panel must not keep the app running once the main window is closed.
    win.on("closed", () => dropAskPanelWindow?.());
    win.on("hide", () => voice.blur());
    win.on("minimize", () => voice.blur());
    win.webContents.on("destroyed", () => companionContext.invalidate("renderer-destroyed"));
    win.webContents.on("render-process-gone", () => companionContext.invalidate("renderer-gone"));
    win.webContents.on("did-start-navigation", () => companionContext.invalidate("renderer-navigation"));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== trusted) event.preventDefault();
    });
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    win.webContents.on("will-redirect", (event) => event.preventDefault());
    win.loadURL(trusted);
  }
  createWindow();
  store.startRecovery();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  radar?.close();
  miniNow?.close();
  sessionHistory?.flush();
  closeAskPanel?.();
  community?.stop();
  desk?.stop();
  guildPanel?.close();
  guildService?.stop();
  liveClient?.stop();
  liveBridge?.stop();
  store?.closeRecovery();
  voice?.close();
  companionContext?.invalidate("quit");
  subscriptionEpoch++;
  chatgpt?.close();
  game?.close();
  catalogs.clear();
  if (quitApproved || !updater) {
    updater?.close();
    return;
  }
  if (
    updater.status().phase === "ready" &&
    updater.status().installOnQuit &&
    updater.status().automatic
  ) {
    event.preventDefault();
    if (quitPending) return;
    quitPending = true;
    updater
      .install({ onQuit: true })
      .catch(() => false)
      .finally(() => {
        quitApproved = true;
        updater.close();
        app.quit();
      });
  } else updater.close();
});
