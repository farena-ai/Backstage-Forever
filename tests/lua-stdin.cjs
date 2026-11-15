"use strict";
// Runs a Lua chunk given on stdin through Fengari, the way `lua-cli.js -` does on Windows. On macOS the
// CLI cannot read a pipe (ESPIPE), so the tests use this: read stdin as a stream, write a temporary
// file, and run the CLI on that file (same output, same exit code).
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bf-lua-")), "chunk.lua");
  fs.writeFileSync(file, Buffer.concat(chunks));
  process.on("exit", () => { try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch {} });
  process.argv = [process.argv[0], require.resolve("fengari-node-cli/src/lua-cli.js"), file];
  require("fengari-node-cli/src/lua-cli.js");
});
