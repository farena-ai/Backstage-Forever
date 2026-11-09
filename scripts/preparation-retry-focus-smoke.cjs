"use strict";
// Run the real Electron retry regression without unrelated Preparation scenarios.
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const result=spawnSync(process.execPath,[path.join(__dirname,"preparation-smoke.cjs"),"--read-retry-only",...process.argv.slice(2)],{stdio:"inherit",env:process.env});
if(result.error)throw result.error;
process.exitCode=result.status??1;
