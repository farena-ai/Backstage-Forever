"use strict";
// Entry point: node --env-file=<secrets env> server.js
const { loadConfig } = require("./lib/config");
const { Store } = require("./lib/store");
const { createApp } = require("./lib/app");

function main() {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const { server } = createApp({ store, config });
  server.listen(config.port, config.host, () => {
    const a = server.address();
    console.log(`${new Date().toISOString()} bf-community listening on ${a.address}:${a.port}`);
  });
  const stop = (sig) => {
    console.log(`${new Date().toISOString()} ${sig} received, shutting down`);
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
