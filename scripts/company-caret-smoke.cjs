"use strict";
// Run the actual synthetic main/preload Company fixture through the caret probe.
process.argv.push("--caret-only","--setup-races");
require("./company-smoke.cjs");
