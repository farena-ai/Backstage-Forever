"use strict";
// Uses the installed Electron runtime and public release bytes; never launches an installer.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const data = await fs.mkdtemp(path.join(tempRoot, "bf-update-runtime-"));
  let instance;
  try {
    await fs.mkdir(path.join(data, "updates"));
    await fs.writeFile(
      path.join(data, "updates/preferences.json"),
      JSON.stringify({ automatic: false, installOnQuit: false }),
    );
    instance = await electron.launch({
      executablePath:
        "C:/Program Files/Backstage Forever/Backstage Forever.exe",
      args: ["--user-data-dir=" + data],
    });
    const result = await instance.evaluate(
      async ({ app }, options) => {
        const fs = process.getBuiltinModule("node:fs");
        const path = process.getBuiltinModule("node:path");
        const createRequire =
          process.getBuiltinModule("node:module").createRequire;
        const load = createRequire(path.join(app.getAppPath(), "package.json"));
        if (
          path.resolve(app.getPath("userData")) !== path.resolve(options.data)
        )
          throw Error("Isolation failed");
        const u = load(
          options.source
            ? path.join(options.root, "src/core/updater.cjs")
            : "./src/core/updater.cjs",
        );
        const events = [];
        let interrupted = false;
        const fetch = async (url, signal, limit, chunk, api) => {
          const stage = api ? "discovery" : chunk ? "download" : "manifest";
          let bytes = 0;
          try {
            const result = await u.request(
              url,
              signal,
              limit,
              chunk
                ? (value, count) => {
                    bytes = count;
                    chunk(value, count);
                    if (
                      options.interrupt &&
                      !interrupted &&
                      count > 1024 * 1024
                    ) {
                      interrupted = true;
                      throw Object.assign(
                        Error("Synthetic recovery fixture interruption"),
                        { code: "ECONNRESET" },
                      );
                    }
                  }
                : null,
              api,
            );
            events.push({
              stage,
              code: "OK",
              bytes: chunk ? bytes : result.length,
            });
            return result;
          } catch (e) {
            const legacy = {
              "Update request timed out": "TIMEOUT",
              "Update unavailable": "HTTP",
              "Update too large": "SIZE",
              "Unsafe update URL": "URL",
            };
            const known = new Set([
              "ECONNRESET",
              "ETIMEDOUT",
              "ENOTFOUND",
              "EAI_AGAIN",
              "ECONNREFUSED",
              "CERT_HAS_EXPIRED",
              "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
              "ABORT_ERR",
            ]);
            events.push({
              stage,
              code: /^[A-Z_]{2,32}$/.test(e.updateCode || "")
                ? e.updateCode
                : known.has(e.code)
                  ? e.code
                  : legacy[e.message] || "UNKNOWN",
              ...(Number.isInteger(e.httpStatus)
                ? { httpStatus: e.httpStatus }
                : {}),
              bytes,
            });
            throw e;
          }
        };
        const updater = new u.Updater({
          dataDir: options.data,
          currentVersion: "0.4.0",
          publicKey: fs.readFileSync(
            path.join(
              options.source ? options.root : app.getAppPath(),
              "assets/update-public-key.pem",
            ),
          ),
          packaged: true,
          platform: "win32",
          fetch,
          installRunner: () => {
            throw Error("Installer execution forbidden in fixture");
          },
        });
        const status = await updater.check();
        let cachedVerified = false;
        if (status.phase === "ready") {
          const cached = JSON.parse(
            fs.readFileSync(
              path.join(options.data, "updates/ready.json"),
              "utf8",
            ),
          );
          const manifest = u.verifyManifest(cached, updater.publicKey, "0.4.0");
          updater.verifyFile(manifest);
          cachedVerified = true;
        }
        updater.close();
        return {
          installedVersion: app.getVersion(),
          electron: process.versions.electron,
          source: options.source,
          status,
          cachedVerified,
          interruptionInjected: interrupted,
          events,
        };
      },
      {
        data,
        root: path.resolve(__dirname, ".."),
        source: process.argv.includes("--source"),
        interrupt: process.argv.includes("--interrupt-first"),
      },
    );
    console.log(JSON.stringify(result));
    if (process.argv.includes("--expect-ready"))
      assert.equal(result.status.phase, "ready");
    if (process.argv.includes("--interrupt-first")) {
      const downloads = result.events.filter(
        (event) => event.stage === "download",
      );
      assert.equal(result.interruptionInjected, true);
      assert.ok(downloads.length >= 2 && downloads.length <= 3);
      assert.ok(downloads.some((event) => event.code === "NETWORK"));
    }
  } finally {
    if (instance) await instance.close();
    const resolved = await fs.realpath(data);
    if (
      path.dirname(resolved) !== tempRoot ||
      !path.basename(resolved).startsWith("bf-update-runtime-")
    )
      throw Error("Unsafe fixture cleanup");
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(() => {
  console.error("Isolated updater runtime check failed");
  process.exitCode = 1;
});
