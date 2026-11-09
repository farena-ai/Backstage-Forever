"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Store, atomic } = require("./core/store.cjs");
const v = require("./core/validation.cjs");
const ai = require("./core/providers.cjs");
const { ChatGPTAuth } = require("./core/chatgpt.cjs");
const claude = require("./core/claude.cjs");
const trusted = pathToFileURL(
  path.join(__dirname, "renderer", "index.html"),
).href;
let win,
  store,
  chatgpt,
  subscriptionEpoch = 0,
  resetting = false,
  busy = false;
const links = {
  ollama: "https://ollama.com/",
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
  handle("subscriptionStatus", subscriptionStatus);
  handle("connectSubscription", async (provider) => {
    v.provider(provider);
    if (provider === "openai") await chatgpt.connect();
    else if (provider === "anthropic") await claude.login();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
    return subscriptionStatus();
  });
  handle("disconnectSubscription", async (provider) => {
    v.provider(provider);
    subscriptionEpoch++;
    if (provider === "openai") await chatgpt.disconnect();
    else if (provider === "anthropic") await claude.logout();
    else
      throw new Error(
        "Subscription sign-in is unavailable for this provider in this preview.",
      );
    return subscriptionStatus();
  });
  handle("bootstrap", async () => ({
    state: structuredClone(store.state),
    providers: v.providers,
    version: app.getVersion(),
    secretStatus: store.secretStatus(),
    subscriptionStatus: await subscriptionStatus(),
  }));
  handle("saveState", (state) => store.saveState(state));
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
    return {
      state: structuredClone(store.state),
      secretStatus: store.secretStatus(),
    };
  });
  handle("deleteKey", (provider) => store.deleteKey(provider));
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
    const context = ai.profileContext(
      store.state,
      input.profileId,
      input.shareProfile,
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
            ? {
                name: profile.name,
                realm: profile.realm,
                className: profile.className,
                level: profile.level,
              }
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
    const result = await dialog.showOpenDialog(win, {
      title: "Import a Backstage Forever backup",
      properties: ["openFile"],
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 4000000) throw new Error("Invalid backup.");
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
    if (confirm.response !== 1) return null;
    subscriptionEpoch++;
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
    try {
      chatgpt.reset();
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

app.on("before-quit", () => {
  subscriptionEpoch++;
  chatgpt?.close();
});
