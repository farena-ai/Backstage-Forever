"use strict";
// Reuse the actual synthetic Electron fixture and its exact chain assertions.
process.argv.push("--detail-completion-only");
require("./knowledge-smoke.cjs");
