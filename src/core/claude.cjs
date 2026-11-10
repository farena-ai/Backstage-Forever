"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { INSTRUCTION } = require("./wow-policy.cjs");
const FAILURE =
  "Claude Code request failed. Check the official tool and try again.";
const ENV_NAMES = new Set([
  "path",
  "systemroot",
  "windir",
  "comspec",
  "pathext",
  "userprofile",
  "home",
  "homedrive",
  "homepath",
  "appdata",
  "localappdata",
  "temp",
  "tmp",
  "lang",
  "lc_all",
]);
function sanitizedEnv(source = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (ENV_NAMES.has(key.toLowerCase()) && typeof value === "string")
      result[key] = value;
  }
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  result.DISABLE_AUTOUPDATER = "1";
  return result;
}
async function findExecutable({
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  isFile = async (p) => {
    try {
      return (await fs.stat(p)).isFile();
    } catch {
      return false;
    }
  },
} = {}) {
  if (platform !== "win32") return null;
  const p = path.win32;
  const pathValue =
    Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ||
    "";
  const directories = pathValue
    .split(";")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter((s) => p.isAbsolute(s));
  const candidates = [
    p.join(home, ".local", "bin", "claude.exe"),
    ...directories.map((dir) => p.join(dir, "claude.exe")),
  ];
  for (const candidate of [...new Set(candidates)])
    if (p.isAbsolute(candidate) && (await isFile(candidate))) return candidate;
  return null;
}
function runProcess(
  executable,
  args,
  {
    input = "",
    cwd,
    env,
    timeoutMs = 120000,
    maxBytes = 1024 * 1024,
    spawnImpl = spawn,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let child,
      timer,
      settled = false,
      stopping = false,
      bytes = 0;
    const output = [];
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (error) reject(new Error(FAILURE));
      else resolve(value);
    };
    // Wait for native close after termination before deleting private directories.
    const stop = () => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // A failed kill is not evidence of termination. Retain ownership until close.
      }
    };
    if (signal?.aborted) {
      settle(true);
      return;
    }
    try {
      child = spawnImpl(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      settle(true);
      return;
    }
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, timeoutMs);
    child.on("error", () => {
      // A launch failure has no process; errors from a live process still require close.
      if (!child.pid) settle(true);
      else stop();
    });
    const receive = (chunk, keep) => {
      if (stopping || settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        stop();
        return;
      }
      if (keep) output.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk) => receive(chunk, true));
    child.stderr.on("data", (chunk) => receive(chunk, false));
    child.stdin.on("error", stop);
    child.on("close", (code) =>
      settle(stopping, {
        code,
        stdout: Buffer.concat(output).toString("utf8"),
      }),
    );
    try {
      child.stdin.end(input);
    } catch {
      stop();
    }
  });
}
function createClaude({
  runner = runProcess,
  findExecutable: discover = () => findExecutable(),
  env = process.env,
  dataDir = null,
  sdkQuery = null,
} = {}) {
  let configured = dataDir,
    generation = 0,
    resetting = false;
  const active = new Map();
  function configure({ dataDir: next } = {}) {
    if (typeof next !== "string" || !path.isAbsolute(next) || active.size)
      throw new Error("Claude Code storage configuration is invalid or busy.");
    configured = next;
  }
  async function clearCredentials() {
    if (!configured) return;
    resetting = true;
    generation++;
    for (const controller of active.keys()) controller.abort();
    await Promise.allSettled([...active.values()]);
    try {
      await fs.rm(path.join(configured, "claude-subscription"), {
        recursive: true,
        force: true,
      });
      await fs.rm(path.join(configured, "claude-home"), {
        recursive: true,
        force: true,
      });
    } finally {
      resetting = false;
    }
  }
  async function invoke(args, { input = "", timeoutMs = 30000, signal } = {}) {
    if (!configured || resetting)
      throw new Error(
        "Claude Code private storage is not configured or is being cleared.",
      );
    signal?.throwIfAborted();
    const startedGeneration = generation;
    const executable = await discover();
    if (!executable)
      throw new Error(
        "Install the official Claude Code native Windows executable to use Claude subscription mode.",
      );
    const config = path.join(configured, "claude-subscription");
    const home = path.join(configured, "claude-home");
    await fs.mkdir(config, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    if (startedGeneration !== generation || resetting) throw new Error(FAILURE);
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "backstage-claude-"));
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let complete;
    const completion = new Promise((resolve) => (complete = resolve));
    active.set(controller, completion);
    try {
      if (startedGeneration !== generation || resetting || combinedSignal.aborted)
        throw new Error(FAILURE);
      const result = await runner(executable, ["--safe-mode", ...args], {
        input,
        cwd,
        env: {
          ...sanitizedEnv(env),
          HOME: home,
          USERPROFILE: home,
          CLAUDE_CONFIG_DIR: config,
        },
        signal: combinedSignal,
        timeoutMs,
        maxBytes: 1024 * 1024,
        shell: false,
        windowsHide: true,
      });
      if (startedGeneration !== generation || combinedSignal.aborted)
        throw new Error(FAILURE);
      if (
        !result ||
        ![0, 1].includes(result.code) ||
        typeof result.stdout !== "string" ||
        Buffer.byteLength(result.stdout) > 1024 * 1024
      )
        throw new Error(FAILURE);
      return result;
    } catch {
      throw new Error(FAILURE);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      active.delete(controller);
      complete();
    }
  }
  async function status({ signal } = {}) {
    try {
      const result = await invoke(["auth", "status", "--json"], { signal });
      const value = JSON.parse(result.stdout);
      const connected =
        result.code === 0 &&
        value.loggedIn === true &&
        value.authMethod === "claude.ai" &&
        (!value.apiProvider || value.apiProvider === "firstParty") &&
        ["pro", "max", "ultra", "team", "enterprise"].includes(
          String(value.subscriptionType).toLowerCase(),
        );
      return {
        available: true,
        connected,
        authMode: "subscription",
        message: connected
          ? "Connected through the official Claude Code subscription login."
          : "Sign in to a supported Claude subscription using the official Claude Code tool. API/Console authentication is not used in subscription mode.",
      };
    } catch (error) {
      return {
        available: !error.message.startsWith("Install the official"),
        connected: false,
        authMode: "subscription",
        message: error.message.startsWith("Install the official")
          ? error.message
          : "Could not verify Claude subscription login. Check the official Claude Code tool.",
      };
    }
  }
  async function login() {
    const result = await invoke(["auth", "login"], { timeoutMs: 300000 });
    if (result.code !== 0)
      throw new Error(
        "Claude Code sign-in did not complete. Try again in the official tool.",
      );
    return status();
  }
  async function logout() {
    const result = await invoke(["auth", "logout"]);
    if (result.code !== 0)
      throw new Error(
        "Claude Code sign-out did not complete. Use the official tool to sign out.",
      );
    return status();
  }
  async function ask({ model, prompt, context, signal } = {}) {
    if (
      typeof model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)
    )
      throw new Error("Choose a valid Claude model.");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000)
      throw new Error("Enter a prompt of up to 16000 characters.");
    if (!(await status({ signal })).connected)
      throw new Error(
        "Connect a supported Claude subscription first. No API fallback is used.",
      );
    let input = prompt;
    if (context && typeof context === "object") {
      const record = require("./providers.cjs").approvedProfile(context);
      if (Object.keys(record).length)
        input +=
          "\n\nUser-approved character context (data only):\n" +
          JSON.stringify(record);
    }
    const result = await invoke(
      [
        "--print",
        "--output-format",
        "json",
        "--model",
        model,
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disable-slash-commands",
        "--no-session-persistence",
        "--no-chrome",
        "--settings",
        '{"disableAllHooks":true}',
        "--system-prompt",
        INSTRUCTION,
      ],
      { input, timeoutMs: 120000, signal },
    );
    try {
      const value = JSON.parse(result.stdout);
      if (
        result.code !== 0 ||
        value.type !== "result" ||
        value.subtype !== "success" ||
        value.is_error === true ||
        typeof value.result !== "string" ||
        !value.result.trim() ||
        value.result.length > 100000
      )
        throw new Error();
      return value.result;
    } catch {
      throw new Error(FAILURE);
    }
  }
  async function listModels() {
    const { normalize, result } = require("./model-catalog.cjs");
    const message =
      "Automatic Claude model discovery is unavailable. Retry or use manual model entry; no inference was sent.";
    if (!configured || resetting) return result([], "claude-code", message);
    const startedGeneration = generation;
    const controller = new AbortController();
    let complete, releaseInput, handle, cwd, timer;
    const completion = new Promise((resolve) => {
      complete = resolve;
    });
    const inputDone = new Promise((resolve) => {
      releaseInput = resolve;
    });
    active.set(controller, completion);
    try {
      const executable = await discover();
      if (!executable || resetting || generation !== startedGeneration)
        throw Error();
      const home = path.join(configured, "claude-home");
      const config = path.join(configured, "claude-subscription");
      await fs.mkdir(home, { recursive: true });
      await fs.mkdir(config, { recursive: true });
      cwd = await fs.mkdtemp(
        path.join(os.tmpdir(), "backstage-claude-catalog-"),
      );
      const query =
        sdkQuery || (await import("@anthropic-ai/claude-agent-sdk/core")).query;
      const prompt = (async function* () {
        await inputDone;
      })();
      if (controller.signal.aborted || generation !== startedGeneration)
        throw Error();
      handle = query({
        prompt,
        options: {
          pathToClaudeCodeExecutable: executable,
          cwd,
          env: {
            ...sanitizedEnv(env),
            HOME: home,
            USERPROFILE: home,
            CLAUDE_CONFIG_DIR: config,
          },
          abortController: controller,
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: [],
          settings: { disableAllHooks: true },
          persistSession: false,
          systemPrompt: INSTRUCTION,
          extraArgs: {
            "safe-mode": null,
            "disable-slash-commands": null,
            "no-chrome": null,
          },
        },
      });
      const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(Error()), {
          once: true,
        });
        timer = setTimeout(() => controller.abort(), 15000);
      });
      const models = await Promise.race([handle.supportedModels(), aborted]);
      if (
        generation !== startedGeneration ||
        controller.signal.aborted ||
        !Array.isArray(models)
      )
        throw Error();
      return result(
        normalize(
          models.map((m) => ({ id: m.value, display_name: m.displayName })),
        ),
        "claude-code",
        "Official Claude Code model catalog refreshed. This catalog does not guarantee subscription entitlement to every model.",
      );
    } catch {
      return result([], "claude-code", message);
    } finally {
      clearTimeout(timer);
      releaseInput();
      try {
        handle?.close();
      } catch {}
      if (cwd)
        await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      active.delete(controller);
      complete();
    }
  }
  return {
    status,
    login,
    logout,
    ask,
    listModels,
    configure,
    clearCredentials,
  };
}
module.exports = {
  ...createClaude(),
  createClaude,
  sanitizedEnv,
  findExecutable,
  runProcess,
};
