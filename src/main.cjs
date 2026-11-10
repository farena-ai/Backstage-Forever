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
const { scopeResponse } = require("./core/wow-policy.cjs");
const { buildBrief } = require("./core/adventure.cjs");
const { KnowledgeService } = require("./core/knowledge-cache.cjs");
const { registerKnowledgeHandlers } = require("./core/knowledge-ipc.cjs");
const { registerDirectorHandlers } = require("./core/director-ipc.cjs");
const { registerPreparationHandlers } = require("./core/preparation-ipc.cjs");
const { registerPartyHandlers } = require("./core/party-ipc.cjs");
const { CompanionRequest } = require("./core/companion-request.cjs");
const { CompanionContext } = require("./core/companion-context.cjs");
const { MemoryService, buildMemoryPrompt } = require("./core/memory.cjs");
const { registerMemoryHandlers } = require("./core/memory-ipc.cjs");
const { preserveMemories } = require("./core/memory-data.cjs");
const { VoiceService } = require("./core/voice.cjs");
const { registerVoiceHandlers } = require("./core/voice-ipc.cjs");
const { registerDiagnosticsHandlers } = require("./core/diagnostics-ipc.cjs");
const { releaseChannel } = require("../package.json");
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
  memory,
  voice,
  diagnostics,
  quitApproved = false,
  quitPending = false,
  subscriptionEpoch = 0,
  resetting = false;
let latestObservation = null;
let latestObservationRoot = null;
let gameActionEpoch = 0;
const links = {
  releases: "https://github.com/farena-ai/Backstage-Forever/releases",
  ollama: "https://ollama.com/",
  "ollama-cloud": "https://ollama.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/",
  xai: "https://console.x.ai/",
  "chatgpt-usage": "https://chatgpt.com/settings/usage",
  "chatgpt-subscription": "https://chatgpt.com/",
  "claude-subscription": "https://claude.com/download",
  "xai-subscription": "https://grok.com/",
};
function handle(name, fn) {
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
      if (["diagnosticsPreview", "copyDiagnostics", "exportDiagnostics"].includes(name) && [
        "Report request is invalid.",
        "Prepare a new report and review it before copying or saving.",
        "The report could not be prepared. Try again.",
        "The report could not be copied. Try again.",
        "The report could not be saved. Choose a text file outside the app data folder.",
      ].includes(e?.message)) throw e;
      if (e?.message === "Secure credential storage is unavailable.") throw e;
      if (["partyBrief", "partyPreview", "createPartyJourney", "commitPartyPlan", "exportPartyPlan", "importPartyPlan"].includes(name) && /^Party plan/.test(e?.message)) throw e;
      if (["ask", "memoryPreview", "saveMemory", "deleteMemory", "clearMemory"].includes(name) && /^(Memory |Provider response is no longer current|Choose the current character)/.test(e?.message)) throw e;
      if (
        name === "copyQuestWaypoint" &&
        [
          "Update the addon and reload the game before copying a waypoint.",
          "No compatible sourced waypoint for this quest phase.",
          "No compatible reference pack.",
        ].includes(e?.message)
      )
        throw e;
      throw new Error(
        ["ask", "connectSubscription", "disconnectSubscription"].includes(
          name,
        ) &&
        /^(Provider |Could not reach|Save an API|Choose a character|ChatGPT |Claude |Grok |Install the official|Connect a supported|Subscription )/.test(
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
  try {
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
    store.onStateChange = () => companionContext.sync();
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
    });
    updater.start();
    knowledge = new KnowledgeService({ dataDir: app.getPath("userData") });
    game = new GameSync({
      dataDir: app.getPath("userData"),
      onRootChange: () => companionContext.invalidate("source-root"),
      addonDir: app.isPackaged
        ? path.join(process.resourcesPath, "addon", "BackstageForever")
        : path.join(__dirname, "..", "addon", "BackstageForever"),
      onSnapshot: (snapshot) => {
        if (game?.root !== latestObservationRoot) {
          latestObservation = null;
          latestObservationRoot = game?.root;
        }
        if (!resetting) {
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
  } catch {
    try {
      await showStartupFailure({ dialog, shell, dataDir: app.getPath("userData") });
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
    collect: () => {
      // Read already-held local facts only. No auth worker, model catalog, disk scan or refresh.
      const selected = store.state.provider, gameFacts = game.status();
      const index = knowledge.packs.get(knowledge.build), pack = (index || knowledge.bundled).pack;
      const update = updater.status();
      return {
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
  registerKnowledgeHandlers({
    handle,
    knowledge,
    getState: () => store.state,
    connected: () => game.status().connected,
    clipboard,
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
  handle("discoverGame", () => game.discover());
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
        if (result.canceled || cancelled()) return gameSnapshot();
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
    providers: v.providers,
    version: app.getVersion(),
    updateStatus: updater.status(),
    secretStatus: store.secretStatus(),
    subscriptionStatus: await subscriptionStatus(),
  }));
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
    const stopped = companionRequest.cancel();
    if (stopped) companionContext.invalidate("response-stop");
    // Stop remains visible while the renderer reviews an already completed reply.
    // Retire that draft without cancelling unrelated idle context or voice work.
    else memory.clearDraft();
    return stopped;
  });
  handle("ask", async (...args) => {
    memory.clearDraft();
    if (args.length !== 1) throw Error("Invalid provider request.");
    const input = args[0];
    v.object(input, ["provider", "prompt", "profileId", "shareProfile", "memoryIds"]);
    v.provider(input.provider);
    v.str(input.prompt, 12000, false);
    if (
      typeof input.shareProfile !== "boolean" ||
      input.provider !== store.state.provider.id
    )
      throw new Error("Invalid provider selection.");
    const profileId = input.profileId === undefined ? store.state.activeProfileId : input.profileId;
    const token = memory.begin(profileId);
    const augmented = buildMemoryPrompt(store.state, { profileId, prompt: input.prompt, memoryIds: input.memoryIds === undefined ? [] : input.memoryIds });
    const refusal = scopeResponse(input.prompt);
    if (refusal) return refusal;
    const context = ai.profileContext(
      store.state,
      input.profileId,
      input.shareProfile,
      {
        knowledge: knowledge.index(
          store.state.profiles.find((p) => p.id === input.profileId) || {},
        ),
        prompt: input.prompt,
      },
    );
    const epoch = subscriptionEpoch;
    const selected = { ...store.state.provider };
    const reply = await companionRequest.run(async signal => {
      let reply;
      if (selected.authMode === "subscription" && input.provider !== "ollama") {
        if (input.provider === "openai")
          reply = await chatgpt.ask({
            model: selected.model,
            prompt: augmented.prompt,
            context,
            signal,
          });
        else if (input.provider === "anthropic") {
          const profile = store.state.profiles.find(
            (p) => p.id === input.profileId,
          );
          const shared = input.shareProfile
            ? ai.approvedProfile(profile, {
                knowledge: knowledge.index(profile || {}),
                prompt: input.prompt,
              })
            : undefined;
          reply = await claude.ask({
            model: selected.model,
            prompt: augmented.prompt,
            context: shared,
            signal,
          });
        } else
          throw new Error(
            "Subscription inference is unavailable for this provider. Choose API mode explicitly if desired.",
          );
      } else
        reply = await ai.ask({
          provider: input.provider,
          ...selected,
          apiKey: store.getKey(input.provider),
          prompt: augmented.prompt,
          context,
          signal,
        });
      if (epoch !== subscriptionEpoch)
        throw new Error(
          "Provider response is no longer current because local data or authentication changed.",
        );
      return reply;
    }, { waitForSettlement: selected.authMode === "subscription" && input.provider === "anthropic" });
    memory.complete(token, input.prompt, reply);
    return reply;
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
    v.validateState(JSON.parse(text));
    const confirm = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Replace saved profiles?",
      message:
        "Import replaces profiles, notes, goals, plans and preferences, and clears saved conversation memory. Existing API keys are preserved.",
      buttons: ["Cancel", "Import backup"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1 || epoch !== subscriptionEpoch) return null;
    subscriptionEpoch++;
    companionContext.invalidate("import");
    catalogs.clear();
    gameActionEpoch++;
    knowledge.setContext({}, false);
    resetting = true;
    try {
      await game.disconnect();
      latestObservation = null;
      return store.importData(text);
    } finally {
      resetting = false;
    }
  });
  handle("resetData", async () => {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Delete all local data?",
      message:
        "This deletes all profiles, goals, notes, plans, saved conversation memory, preferences, API keys and app-owned subscription credentials. Pending sign-ins are cancelled. Other apps and global Claude credentials are unaffected. Profile backups exclude credentials and conversation memory.",
      buttons: ["Cancel", "Delete all data"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    resetting = true;
    diagnostics.clear();
    companionContext.invalidate("reset");
    subscriptionEpoch++;
    gameActionEpoch++;
    catalogs.clear();
    try {
      const knowledgeReset = knowledge.reset();
      await game.reset();
      latestObservation = null;
      const updateReset = updater.reset();
      chatgpt.reset();
      await updateReset;
      await knowledgeReset;
      await claude.clearCredentials();
      return store.reset();
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
    win = new BrowserWindow({
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
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("blur", () => voice.blur());
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
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
