"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), { EventEmitter } = require("node:events");
const { GameRuntime } = require("../src/core/game-runtime.cjs");
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "forever-runtime-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "WTF")); await fs.writeFile(path.join(root, ".flavor.info"), "wowf");
  await fs.writeFile(path.join(root, "Wow.exe"), "synthetic-never-execute"); return root;
}
const runner = (rows, calls = []) => (exe, args, options, callback) => { calls.push({exe,args,options}); callback(null, JSON.stringify(rows)); };
test("runtime queries only bounded hidden executable paths, caches successes and failures for 15 seconds", async t => {
  const root = await fixture(t), calls = []; let now = 1700000000000;
  const runtime = new GameRuntime({ platform: "win32", execFile: runner([path.join(root,"Wow.exe")],calls), now:()=>now });
  assert.deepEqual(await runtime.probe(root), {state:"running", checkedAt:new Date(now).toISOString(),launchAvailable:true});
  await runtime.probe(root); now+=14999; await runtime.probe(root); assert.equal(calls.length,1);
  now++; await runtime.probe(root); assert.equal(calls.length,2);
  assert.equal(calls[0].options.windowsHide,true); assert.ok(calls[0].options.timeout<=5000); assert.ok(calls[0].options.maxBuffer<=32768);
  assert.ok(calls[0].args.includes("-NoProfile")); assert.ok(calls[0].args.includes("-NonInteractive"));
  assert.doesNotMatch(calls[0].args.join(" "), /CommandLine|GetOwner|EnableAllPrivileges/); assert.ok(!calls[0].args.join(" ").includes(root));
  let attempts=0; const failed=new GameRuntime({platform:"win32",execFile:(_e,_a,_o,cb)=>{attempts++;cb(Error("denied"));},now:()=>now});
  assert.equal((await failed.probe(root)).state,"unknown"); await failed.probe(root); assert.equal(attempts,1);
});
test("runtime distinguishes no matching process, inaccessible paths, other installations and unsupported systems",async t=>{
  const root=await fixture(t),other=await fixture(t);
  for(const [rows,expected] of [[[],"not-running"],[[null],"unknown"],[["not absolute"],"unknown"],[[path.join(other,"Wow.exe")],"not-running"],[[path.join(root,"Wow.exe"),null],"running"]]){
    assert.equal((await new GameRuntime({platform:"win32",execFile:runner(rows)}).probe(root)).state,expected);
  }
  const unsupported=new GameRuntime({platform:"linux",execFile:()=>assert.fail("no probe")});
  assert.deepEqual(await unsupported.probe(root),{state:"unknown",checkedAt:null,launchAvailable:false});
});
test("explicit launch uses only validated literal executable, deduplicates, and reports request rather than load",async t=>{
  const root=await fixture(t),calls=[];
  const runtime=new GameRuntime({platform:"win32",execFile:runner([]),spawn:(exe,args,options)=>{calls.push({exe,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit("spawn"));return child;}});
  const [a,b]=await Promise.all([runtime.launch(root),runtime.launch(root)]);
  assert.equal(a.state,"requested");assert.equal(b.state,"requested");assert.equal(calls.length,1);
  assert.equal(calls[0].exe,await fs.realpath(path.join(root,"Wow.exe")));assert.deepEqual(calls[0].args,[]);assert.equal(calls[0].options.shell,false);
  await runtime.launch(root);assert.equal(calls.length,1);
});
test("launch refuses running, unsafe and missing executables and checks cancellation after asynchronous validation",async t=>{
  const root=await fixture(t);let cancelled=false;
  const running=new GameRuntime({platform:"win32",execFile:runner([path.join(root,"Wow.exe")]),spawn:()=>assert.fail("running launch")});
  assert.equal((await running.launch(root)).state,"already-running");
  const runtime=new GameRuntime({platform:"win32",execFile:runner([]),spawn:()=>assert.fail("cancelled launch")});
  runtime.probe=async()=>{cancelled=true;return {state:"not-running",launchAvailable:true};};
  assert.equal((await runtime.launch(root,()=>cancelled)).state,"cancelled");
  await fs.unlink(path.join(root,"Wow.exe"));
  assert.equal((await new GameRuntime({platform:"win32",execFile:runner([])}).launch(root)).state,"unavailable");
  const other=await fixture(t);await fs.symlink(path.join(other,"Wow.exe"),path.join(root,"Wow.exe"));
  assert.equal((await new GameRuntime({platform:"win32",execFile:runner([])}).launch(root)).state,"unavailable");
});

test("launch cancellation is checked again after the final asynchronous path validation",async t=>{
  const root=await fixture(t);let cancelled=false,checks=0;const original=fs.realpath;
  const runtime=new GameRuntime({platform:"win32",spawn:()=>assert.fail("cancelled before spawn")});
  runtime.probe=async()=>({state:"not-running",launchAvailable:true});
  fs.realpath=async function(candidate,...args){const result=await original(candidate,...args);if(candidate===path.join(root,"Wow.exe")&&++checks===2)cancelled=true;return result;};
  try{assert.equal((await runtime.launch(root,()=>cancelled)).state,"cancelled");assert.equal(checks,2);}finally{fs.realpath=original;}
});

test("cache interval starts when a bounded probe completes",async t=>{
  const root=await fixture(t);let now=1700000000000,calls=0;
  const runtime=new GameRuntime({platform:"win32",now:()=>now,execFile:(_exe,_args,_options,callback)=>{calls++;now+=2000;callback(null,"[]");}});
  await runtime.probe(root);now+=14999;await runtime.probe(root);assert.equal(calls,1);
});

test("probe canonicalizes short-path aliases/case and never accepts missing executable paths as closed",async t=>{
  const root=await fixture(t),original=fs.realpath;
  const alias=path.join(root,"SHORT~1","Wow.exe");
  fs.realpath=async function(candidate,...args){if(String(candidate).toLowerCase()===alias.toLowerCase())return original(path.join(root,"Wow.exe"));return original(candidate,...args);};
  try{assert.equal((await new GameRuntime({platform:"win32",execFile:runner([alias])}).probe(root)).state,"running");}finally{fs.realpath=original;}
  assert.equal((await new GameRuntime({platform:"win32",execFile:runner([path.join(root,"missing","Wow.exe")])}).probe(root)).state,"unknown");
});
