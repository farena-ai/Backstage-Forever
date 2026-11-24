"use strict";
// Entry point: node --env-file=<secrets env> server.js
const { loadConfig } = require("./lib/config");
const { Store } = require("./lib/store");
const { createApp } = require("./lib/app");
const { startMaintenance } = require("./lib/maintenance");
const { DownloadsFetcher, startDownloads } = require("./lib/downloads");

function main() {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const log = (line) => console.log(line);
  const { server, auth, notifier } = createApp({ store, config, log });
  const stopMaintenance = startMaintenance({ store, auth, config, log });
  const stopDownloads = startDownloads(new DownloadsFetcher({ store, config, log }));
  server.listen(config.port, config.host, () => {
    const a = server.address(), n = notifier.channels();
    console.log(`${new Date().toISOString()} bf-community listening on ${a.address}:${a.port}`);
    // States only what is switched on; never an address or a webhook URL.
    console.log(`${new Date().toISOString()} desk: admin area ${config.adminEnabled ? "on" : "off"}, e-mail alerts ${n.email ? "on" : "off"}, discord alerts ${n.discord ? "on" : "off"}, nightly backups ${config.backupDir ? "on" : "off"}, download counts ${config.downloads.enabled ? "on" : "off"}`);
  });
  const stop = (sig) => {
    console.log(`${new Date().toISOString()} ${sig} received, shutting down`);
    stopMaintenance();
    stopDownloads();
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

try {
  main();
} catch (e) {
  console.error(`${new Date().toISOString()} startup failed: ${e.message}`);
  process.exit(1);
}
