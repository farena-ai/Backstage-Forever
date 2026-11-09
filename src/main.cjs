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
  quitApproved = false,
  quitPending = false,
  subscriptionEpoch = 0,
  resetting = false,
  busy = false;
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
      if (e?.message === "Secure credential storage is unavailable.") throw e;
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
app.whenReady().then(() => {
  if (!ownsInstance) return;
  try {
    store = new Store(app.getPath("userData"), safeStorage);
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
    dialog.showErrorBox(
      "Backstage Forever",
      "Saved data could not be read safely. Your files were preserved. Restore a valid backup or move the data folder before restarting.",
    );
    app.quit();
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
    catalogs.clear();
    if (provider === "openai") await chatgpt.connect();
    else if (provider === "anthropic") await claude.login();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
    catalogs.clear();
    return subscriptionStatus();
  });
  handle("disconnectSubscription", async (provider) => {
    v.provider(provider);
    subscriptionEpoch++;
    catalogs.clear();
    if (provider === "openai") await chatgpt.disconnect();
    else if (provider === "anthropic") await claude.logout();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
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
        : v.validateState(base).activeProfileId;
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
    catalogs.clear();
    return {
      state: structuredClone(store.state),
      secretStatus: store.secretStatus(),
    };
  });
  handle("deleteKey", (provider) => {
    catalogs.clear();
    return store.deleteKey(provider);
  });
  handle("ask", async (input) => {
    v.object(input, ["provider", "prompt", "profileId", "shareProfile"]);
    v.provider(input.provider);
    v.str(input.prompt, 12000, false);
    if (
      typeof input.shareProfile !== "boolean" ||
      input.provider !== store.state.provider.id
    )
      throw new Error("Invalid provider selection.");
    if (busy) throw new Error("Provider request already in progress.");
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
    busy = true;
    const epoch = subscriptionEpoch;
    const selected = { ...store.state.provider };
    try {
      let reply;
      if (selected.authMode === "subscription" && input.provider !== "ollama") {
        if (input.provider === "openai")
          reply = await chatgpt.ask({
            model: selected.model,
            prompt: input.prompt,
            context,
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
            prompt: input.prompt,
            context: shared,
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
          prompt: input.prompt,
          context,
        });
      if (epoch !== subscriptionEpoch)
        throw new Error(
          "Provider request was cancelled because local data or authentication changed.",
        );
      return reply;
    } finally {
      busy = false;
    }
  });
  handle("exportData", async () => {
    const result = await dialog.showSaveDialog(win, {
      title: "Export profiles and preferences (keys excluded)",
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
        "Import replaces all profiles and preferences. Existing API keys are preserved.",
      buttons: ["Cancel", "Import backup"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1 || epoch !== subscriptionEpoch) return null;
    subscriptionEpoch++;
    catalogs.clear();
    gameActionEpoch++;
    knowledge.setContext({}, false);
    await game.disconnect();
    latestObservation = null;
    return store.importData(text);
  });
  handle("resetData", async () => {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Delete all local data?",
      message:
        "This deletes every profile, goal, note, preference, API key and app-owned subscription credential. Pending sign-ins are cancelled. Other apps and global Claude credentials are unaffected. Export a backup first if needed; backups exclude credentials.",
      buttons: ["Cancel", "Delete all data"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    resetting = true;
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
