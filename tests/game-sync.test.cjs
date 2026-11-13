"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const captureVersion = require("../package.json").version;
const { GameSync, parseSavedVariables } = require("../src/core/game-sync.cjs");
const snapshot = () => ({
  schema: 1,
  characters: [
    {
      id: "Player-synthetic-1",
      name: "Example",
      realm: "Example Realm",
      className: "Mage",
      level: 12,
      race: "Human",
      faction: "Alliance",
      location: { zone: "Test Zone", subZone: "", mapId: 1, x: 0.4, y: 0.5 },
      updatedAt: 1700000000,
    },
  ],
  activeId: "Player-synthetic-1",
  observedAt: 1700000000,
});
const saved = (s = snapshot()) =>
  "BackstageForeverExport = " + JSON.stringify(JSON.stringify(s));
test("parses bounded JSON-only quoted/long-string exports and conceals raw local ids", () => {
  const a = parseSavedVariables(saved());
  assert.equal(a.characters[0].name, "Example");
  assert.match(a.activeId, /^[a-f0-9]{64}$/);
  assert.equal(a.activeId, a.characters[0].id);
  assert.equal(a.observedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(
    parseSavedVariables(
      "BackstageForeverExport = [=[" + JSON.stringify(snapshot()) + "]=]",
    ).characters.length,
    1,
  );
});
test("rejects executable Lua, partial exports, invalid schema, controls and oversized data", () => {
  for (const s of [
    "BackstageForeverExport = {}",
    saved() + '; os.execute("bad")',
    'Other = "x"',
    saved().slice(0, -4),
    "x".repeat(1024 * 1024 + 1),
  ])
    assert.throws(() => parseSavedVariables(s));
  const bad = snapshot();
  bad.characters[0].level = 0;
  assert.throws(() => parseSavedVariables(saved(bad)));
});
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "forever-sync-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "client");
  await fs.mkdir(
    path.join(root, "WTF", "Account", "SyntheticAccount", "SavedVariables"),
    { recursive: true },
  );
  await fs.writeFile(path.join(root, ".flavor.info"), "wowf");
  await fs.writeFile(
    path.join(root, ".build.info"),
    "Version!STRING:0\n1.60.1.70862",
  );
  return {
    dir,
    root,
    file: path.join(
      root,
      "WTF",
      "Account",
      "SyntheticAccount",
      "SavedVariables",
      "BackstageForever.lua",
    ),
  };
}
async function withinDeadline(promise, label, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out waiting for ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
test("connect, refresh, partial-write recovery, install ownership and disconnect cancellation", async (t) => {
  const f = await fixture(t),
    events = [];
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: path.join(__dirname, "../addon/BackstageForever"),
    onSnapshot: (s) => events.push(s),
  });
  t.after(() => sync.close());
  assert.equal((await sync.connect(f.root)).connected, true);
  await fs.writeFile(f.file, saved());
  await sync.refresh();
  assert.equal(events.length, 1);
  await fs.writeFile(f.file, 'BackstageForeverExport = "partial');
  await sync.refresh();
  assert.equal(sync.status().characterCount, 1);
  await sync.installAddon();
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.writeFile(path.join(folder, "user.txt"), "keep");
  await sync.installAddon();
  assert.equal(
    await fs.readFile(path.join(folder, "user.txt"), "utf8"),
    "keep",
  );
  assert.ok(!JSON.stringify(sync.status()).includes(f.root));
  const pending = sync.refresh();
  await sync.disconnect();
  await pending;
  assert.equal(sync.status().connected, false);
  assert.equal(events.length, 1);
});
test("refuses a symlink connection and symlink saved exports", async (t) => {
  const f = await fixture(t);
  const link = path.join(f.dir, "link");
  try {
    await fs.symlink(f.root, link, "junction");
  } catch (e) {
    t.skip("symlink permission unavailable");
    return;
  }
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
    onSnapshot: () => assert.fail("unexpected snapshot"),
  });
  t.after(() => sync.close());
  assert.equal((await sync.connect(link)).connected, false);
  await sync.connect(f.root);
  await fs.writeFile(path.join(f.dir, "outside.lua"), saved());
  await fs.symlink(path.join(f.dir, "outside.lua"), f.file);
  await sync.refresh();
  assert.equal(sync.status().characterCount, 0);
});
test("closing before restore resolves prevents saved connection resurrection", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dir, "data"));
  await fs.writeFile(
    path.join(f.dir, "data", "game-connection.private.json"),
    JSON.stringify({ root: f.root }),
  );
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
  });
  sync.close();
  await sync.ready;
  assert.equal(sync.status().connected, false);
});
test("parser accepts WoW decimal byte escapes without running Lua", () => {
  const json = JSON.stringify(snapshot());
  const lua =
    'BackstageForeverExport = "' +
    [...json]
      .map((c) => "\\" + String(c.charCodeAt(0)).padStart(3, "0"))
      .join("") +
    '"';
  assert.equal(parseSavedVariables(lua).characters[0].name, "Example");
});
test("saved game history retains observed completion details without account identifiers", () => {
  const shot = snapshot();
  shot.characters[0].history = {
    completedCount: 5,
    recent: [
      { id: 42, title: "Synthetic completion", completedAt: 1700000000 },
    ],
  };
  const parsed = parseSavedVariables(saved(shot));
  assert.equal(
    parsed.characters[0].history.recent[0].title,
    "Synthetic completion",
  );
  assert.equal(parsed.characters[0].history.completedCount, 5);
  assert.doesNotMatch(JSON.stringify(parsed), /Player-synthetic-1/);
});
test("addon installer refuses symlink owned destination without changing its target", async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.mkdir(folder, { recursive: true });
  const outside = path.join(f.dir, "outside.txt");
  await fs.writeFile(outside, "untouched");
  try {
    await fs.symlink(outside, path.join(folder, "BackstageForever.lua"));
  } catch {
    t.skip("symlink unavailable");
    return;
  }
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: path.join(__dirname, "../addon/BackstageForever"),
  });
  t.after(() => sync.close());
  await sync.connect(f.root);
  assert.equal((await sync.installAddon()).addonInstalled, false);
  assert.equal(await fs.readFile(outside, "utf8"), "untouched");
});
test("disconnect during addon checks cannot rewrite the private connection or restore status", async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.mkdir(folder, { recursive: true });
  for (const file of ["BackstageForever.toc", "BackstageForever.lua"])
    await fs.writeFile(path.join(folder, file), "fixture");
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
  });
  t.after(() => sync.close());
  await sync.ready;
  const original = fs.lstat;
  let release,
    reached,
    paused = false,
    active = true,
    pending;
  const blocked = new Promise((r) => {
    reached = r;
  });
  fs.lstat = async function (file, ...args) {
    if (active && !paused && String(file) === path.join(folder, "BackstageForever.toc")) {
      paused = true;
      reached();
      await new Promise((r) => {
        release = r;
      });
    }
    return original.call(this, file, ...args);
  };
  try {
    pending = sync.connect(f.root);
    await withinDeadline(blocked, "addon-check pause hook");
    await sync.disconnect();
    release();
    await withinDeadline(pending, "cancelled connection to settle");
    assert.equal(sync.status().connected, false);
    assert.equal(sync.status().addonInstalled, false);
    await assert.rejects(
      fs.stat(path.join(f.dir, "data", "game-connection.private.json")),
      { code: "ENOENT" },
    );
  } finally {
    active = false;
    fs.lstat = original;
    release?.();
    sync.close();
    if (pending) await withinDeadline(pending, "connection cleanup");
  }
});
test("failed snapshot consumer is retried instead of acknowledged", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
    onSnapshot: () => {
      if (++calls === 1) throw Error("disk full");
    },
  });
  t.after(() => sync.close());
  await sync.connect(f.root);
  await fs.writeFile(f.file, saved());
  await sync.refresh();
  await sync.refresh();
  assert.equal(calls, 2);
});
test("managed prepare repairs eighteen owned files, keeps extras, and reports snapshot health", async (t) => {
  const f = await fixture(t),
    addon = path.join(f.dir, "source");
  await fs.mkdir(addon);
  const files = [
    "BackstageForever.toc",
    "BackstageForeverReference.lua",
    "BackstageForeverAdvisorData.lua",
    "BackstageForeverPlan.lua",
    "BackstageForeverCoach.lua",
    "BackstageForeverAcquisition.lua",
    "BackstageForeverProfession.lua",
    "BackstageForeverGathering.lua",
    "BackstageForeverMapPlan.lua",
    "BackstageForeverMap.lua",
    "BackstageForeverAdvisorMap.lua",
    "BackstageForeverMap.xml",
    "BackstageForever.lua",
    "BackstageForeverHUD.lua",
    "BackstageForeverLive.lua",
    "BackstageForeverFind.lua",
    "BackstageForeverAssist.lua",
    "BackstageForeverGear.lua",
  ];
  for (const file of files)
    await fs.writeFile(
      path.join(addon, file),
      file.endsWith(".toc") ? "## Version: 0.4.0\n" : "synthetic " + file,
    );
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: addon,
  });
  t.after(() => sync.close());
  let status = await sync.prepare(f.root);
  assert.equal(status.phase, "needs-reload");
  assert.equal(status.addonCurrent, true);
  assert.equal(status.addonVersion, "0.4.0");
  assert.equal(status.checks.length, 3);
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.writeFile(path.join(folder, "custom.txt"), "preserve");
  for (const file of files) assert.equal(await fs.stat(path.join(folder, file)).then(()=>true,()=>false), true, 'Managed resource must be installed: '+file);
  await fs.writeFile(path.join(folder, files[1]), "obsolete");
  await fs.unlink(path.join(folder, files[2]));
  status = await sync.prepare();
  assert.equal(status.addonCurrent, true);
  for (const file of files) assert.equal(await fs.readFile(path.join(folder, file), "utf8"), file.endsWith(".toc") ? "## Version: 0.4.0\n" : "synthetic " + file);
  assert.equal(
    await fs.readFile(path.join(folder, files[1]), "utf8"),
    "synthetic " + files[1],
  );
  assert.equal(
    await fs.readFile(path.join(folder, "custom.txt"), "utf8"),
    "preserve",
  );
  const fresh = snapshot();
  fresh.observedAt = Math.floor(Date.now() / 1000);
  await fs.writeFile(f.file, saved(fresh));
  assert.equal((await sync.refresh()).phase, "synced");
  await fs.writeFile(f.file, "broken");
  status = await sync.refresh();
  assert.equal(status.phase, "invalid-export");
  assert.equal(status.characterCount, 1);
  assert.ok(!JSON.stringify(status).includes("SyntheticAccount"));
  sync.close();
  const restored = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: addon,
  });
  t.after(() => restored.close());
  await fs.unlink(path.join(folder, files[2]));
  await restored.ready;
  assert.equal(restored.status().addonCurrent, true);
  assert.equal(
    await fs.readFile(path.join(folder, files[2]), "utf8"),
    "synthetic " + files[2],
  );
});

test("installer stages all resources, commits TOC last and rolls back a failed commit", async (t) => {
  const f = await fixture(t), addon = path.join(f.dir, "source");
  const files = ['BackstageForever.toc','BackstageForeverReference.lua','BackstageForeverAdvisorData.lua','BackstageForeverPlan.lua','BackstageForeverCoach.lua','BackstageForeverAcquisition.lua','BackstageForeverProfession.lua','BackstageForeverGathering.lua','BackstageForeverMapPlan.lua','BackstageForeverMap.lua','BackstageForeverAdvisorMap.lua','BackstageForeverMap.xml','BackstageForever.lua','BackstageForeverHUD.lua','BackstageForeverLive.lua','BackstageForeverFind.lua','BackstageForeverAssist.lua','BackstageForeverGear.lua'];
  await fs.mkdir(addon);
  for (const file of files) await fs.writeFile(path.join(addon,file), file.endsWith('.toc')?'## Version: old\n':'old '+file);
  const sync = new GameSync({dataDir:path.join(f.dir,'data'),addonDir:addon}); t.after(()=>sync.close());
  await sync.prepare(f.root);
  const folder=path.join(f.root,'Interface','AddOns','BackstageForever');
  for(const file of files) await fs.writeFile(path.join(addon,file),'new '+file);
  const native=require('node:fs'),rename=native.renameSync,committed=[];
  let failed=false;
  native.renameSync=function(from,to){
    if(path.dirname(to)===folder){
      committed.push(path.basename(to));
      if(path.basename(to)==='BackstageForeverHUD.lua'&&!failed){failed=true;throw Error('synthetic commit failure');}
    }
    return rename(from,to);
  };
  try {assert.equal((await sync.prepare()).addonCurrent,false);}finally{native.renameSync=rename;}
  for(const file of files)assert.equal(await fs.readFile(path.join(folder,file),'utf8'),file.endsWith('.toc')?'## Version: old\n':'old '+file,'Failed transaction must restore '+file);
  committed.length=0;
  native.renameSync=function(from,to){if(path.dirname(to)===folder)committed.push(path.basename(to));return rename(from,to);};
  try {assert.equal((await sync.prepare()).addonCurrent,true);}finally{native.renameSync=rename;}
  assert.equal(committed.at(-1),'BackstageForever.toc','Loader is committed after all modules');
  assert.deepEqual((await fs.readdir(folder)).sort(),files.sort(),'No staging leftovers');
});

test("disconnect during staging commits no resources and removes staging files", async (t) => {
  const f=await fixture(t),addon=path.join(__dirname,'../addon/BackstageForever');
  const sync=new GameSync({dataDir:path.join(f.dir,'data'),addonDir:addon});t.after(()=>sync.close());
  await sync.prepare(f.root);
  const folder=path.join(f.root,'Interface','AddOns','BackstageForever');
  await fs.writeFile(path.join(folder,'BackstageForeverPlan.lua'),'old planner');
  const write=fs.writeFile;let paused=false;
  fs.writeFile=async function(file,...args){const result=await write(file,...args);if(!paused&&path.dirname(file)===folder&&path.basename(file).startsWith('.backstage-')){paused=true;await sync.disconnect();}return result;};
  try{assert.equal((await sync.prepare()).connected,false);}finally{fs.writeFile=write;}
  assert.equal(paused,true);
  assert.equal(await fs.readFile(path.join(folder,'BackstageForeverPlan.lua'),'utf8'),'old planner');
  assert.equal((await fs.readdir(folder)).some(name=>name.startsWith('.backstage-')),false);
});
test("prepare accepts installation parent and missing account exports are needs-reload", async (t) => {
  const f = await fixture(t),
    parent = path.join(f.dir, "game");
  await fs.mkdir(parent);
  const root = path.join(parent, "_forever_");
  await fs.rename(f.root, root);
  const addon = path.join(f.dir, "source");
  await fs.mkdir(addon);
  for (const file of [
    "BackstageForever.toc",
    "BackstageForeverReference.lua",
    "BackstageForeverAdvisorData.lua",
    "BackstageForeverPlan.lua",
    "BackstageForeverCoach.lua",
    "BackstageForeverAcquisition.lua",
    "BackstageForeverProfession.lua",
    "BackstageForeverGathering.lua",
    "BackstageForeverMapPlan.lua",
    "BackstageForeverMap.lua",
    "BackstageForeverAdvisorMap.lua",
    "BackstageForeverMap.xml",
    "BackstageForever.lua",
    "BackstageForeverHUD.lua",
    "BackstageForeverLive.lua",
    "BackstageForeverFind.lua",
    "BackstageForeverAssist.lua",
    "BackstageForeverGear.lua",
  ])
    await fs.writeFile(path.join(addon, file), "fixture");
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: addon,
  });
  t.after(() => sync.close());
  assert.equal((await sync.prepare(parent)).phase, "needs-reload");
});
test("changing the game folder requires its own snapshot and clears connection counters", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  const sync = new GameSync({
    dataDir: path.join(a.dir, "data"),
    addonDir: path.join(__dirname, "../addon/BackstageForever"),
  });
  t.after(() => sync.close());
  await fs.writeFile(a.file, saved());
  await sync.prepare(a.root);
  assert.equal(sync.status().characterCount, 1);
  const status = await sync.prepare(b.root);
  assert.equal(status.phase, "needs-reload");
  assert.equal(status.characterCount, 0);
  assert.equal(status.lastSync, null);
});
test("logical JSON payload remains bounded even when the Lua transport has a larger escape budget", () => {
  const json = JSON.stringify({ ...snapshot(), padding: "x".repeat(1048576) });
  assert.throws(() =>
    parseSavedVariables("BackstageForeverExport = [=[" + json + "]=]"),
  );
});

test("all accounts merge newest per-character records and retain good data through partial files", async t => {
  const f=await fixture(t),events=[];
  const other=path.join(f.root,"WTF","Account","OtherSynthetic","SavedVariables","BackstageForever.lua");
  await fs.mkdir(path.dirname(other),{recursive:true});
  const a=snapshot(),b=snapshot();
  a.observedAt=1700000300;a.characters[0].updatedAt=1700000200;a.characters[0].captureVersion="0.6.1";
  b.observedAt=1700000400;b.activeId="Player-two";b.characters=[{...b.characters[0],id:"Player-two",name:"Second",captureVersion,updatedAt:1700000100},{...a.characters[0],level:13,updatedAt:1700000300}];
  a.characters.push({...a.characters[0],id:"Player-first-account-only",name:"Only first account"});
  await fs.writeFile(f.file,saved(a));await fs.writeFile(other,saved(b));
  const sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever"),onSnapshot:s=>events.push(s),runtime:{probe:async()=>({state:"running",checkedAt:"2026-01-01T00:00:00.000Z",launchAvailable:true})}});t.after(()=>sync.close());
  await sync.prepare(f.root);
  assert.equal(events.length,1);assert.equal(events[0].characters.length,3);assert.equal(events[0].characters.find(c=>c.name==="Example").level,13);
  assert.equal(sync.status().loadedCaptureVersion,captureVersion);assert.equal(sync.status().runtime.state,"running");assert.equal(sync.status().companionState,"saved");
  await sync.refresh();assert.equal(events.length,1);
  await fs.writeFile(other,"partial");await sync.refresh();
  assert.equal(sync.status().characterCount,3);assert.equal(sync.status().coverage.partial,true);assert.equal(sync.status().coverage.unreadableAccountCount,1);assert.equal(events.length,1);
  assert.doesNotMatch(JSON.stringify(sync.status()),/OtherSynthetic|SyntheticAccount|Player-two/);
});

test("prepared status permits play without an export and runtime does not prove capture load", async t=>{
  const f=await fixture(t);
  const runtime={probe:async()=>({state:"running",checkedAt:"2026-01-01T00:00:00.000Z",launchAvailable:true})};
  const sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever"),runtime});t.after(()=>sync.close());
  await sync.prepare(f.root);assert.equal(sync.status().companionState,"update-next-launch");assert.equal(sync.status().loadedCaptureVersion,null);assert.equal(sync.status().nextAction.id,"play");assert.doesNotMatch(sync.status().message,/use \/reload/i);
  const old=snapshot();old.characters[0].captureVersion="0.6.1";await fs.writeFile(f.file,saved(old));await sync.refresh();
  assert.equal(sync.status().loadedCaptureVersion,"0.6.1");assert.equal(sync.status().companionState,"update-next-launch");
  runtime.probe=async()=>({state:"not-running",checkedAt:"2026-01-01T00:01:00.000Z",launchAvailable:true});
  await sync.refresh();assert.equal(sync.status().companionState,"prepared");
  await sync.disconnect();assert.equal(sync.status().runtime.launchAvailable,false);assert.equal(sync.lastSnapshot,null);
});

test("unavailable folder disables launch and cannot claim prepared play-now status",async t=>{
  const f=await fixture(t),sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever"),runtime:{probe:async()=>({state:"running",checkedAt:"2026-01-01T00:00:00.000Z",launchAvailable:true})}});t.after(()=>sync.close());
  await sync.prepare(f.root);await fs.rename(f.root,path.join(f.dir,"moved-client"));await sync.refresh();
  assert.equal(sync.status().companionState,"unavailable");assert.equal(sync.status().runtime.launchAvailable,false);assert.match(sync.status().companionMessage,/unavailable|reconnect/i);
});

test("overlapping refresh cannot publish an earlier read after a later refresh",async t=>{
  const f=await fixture(t),events=[];
  const sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:"unused",onSnapshot:s=>events.push(s)});t.after(()=>sync.close());
  await sync.prepare(f.root);await fs.writeFile(f.file,saved());
  const original=fs.open;let reached,release,paused=false,active=true,pending;const blocked=new Promise(r=>reached=r);
  fs.open=async function(file,...args){const h=await original.call(this,file,...args);if(active&&file===f.file&&!paused){paused=true;const read=h.read.bind(h);h.read=async(...readArgs)=>{const result=await read(...readArgs);if(!active)return result;reached();await new Promise(r=>release=r);return result;};}return h;};
  try{pending=sync.refresh();await withinDeadline(blocked,"saved-export read pause hook");const fresh=snapshot();fresh.characters[0].level=30;fresh.characters[0].updatedAt=1700000500;fresh.observedAt=1700000500;await fs.writeFile(f.file,saved(fresh));await withinDeadline(sync.refresh(),"newer refresh to settle");release();await withinDeadline(pending,"older refresh to settle");assert.equal(events.length,1);assert.equal(events[0].characters[0].level,30);}finally{active=false;fs.open=original;release?.();sync.close();if(pending)await withinDeadline(pending,"refresh cleanup");}
});

test("external cancellation while staging prevents resource commit without requiring disconnect",async t=>{
  const f=await fixture(t),sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever")});t.after(()=>sync.close());
  await sync.prepare(f.root);const folder=path.join(f.root,"Interface","AddOns","BackstageForever");await fs.writeFile(path.join(folder,"BackstageForeverPlan.lua"),"old planner");
  const original=fs.writeFile;let cancelled=false;
  fs.writeFile=async function(file,...args){const result=await original.call(this,file,...args);if(path.basename(file).startsWith(".backstage-"))cancelled=true;return result;};
  try{await sync.prepare(undefined,()=>cancelled);}finally{fs.writeFile=original;}
  assert.equal(cancelled,true);assert.equal(await fs.readFile(path.join(folder,"BackstageForeverPlan.lua"),"utf8"),"old planner");
});

test("a missing formerly valid account export is reported as partial while preserving saved profiles",async t=>{
  const f=await fixture(t),sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:"unused"});t.after(()=>sync.close());
  await fs.writeFile(f.file,saved());await sync.prepare(f.root);await fs.unlink(f.file);await sync.refresh();
  assert.equal(sync.status().characterCount,1);assert.equal(sync.status().coverage.partial,true);assert.equal(sync.status().coverage.unreadableAccountCount,1);
});

test("store capacity omissions remain visible and friendly on unchanged subsequent reads",async t=>{
  const f=await fixture(t),sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:"unused",onSnapshot:()=>({omittedProfileCount:2})});t.after(()=>sync.close());
  await fs.writeFile(f.file,saved());await sync.prepare(f.root);await sync.refresh();
  assert.equal(sync.status().coverage.partial,true);assert.equal(sync.status().coverage.omittedProfileCount,2);assert.match(sync.status().coverage.message,/100|capacity|space/i);
});

test("removed account directories cannot grow the private source cache across refreshes",async t=>{
  const f=await fixture(t),sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:"unused"});t.after(()=>sync.close());
  await fs.writeFile(f.file,saved());await sync.prepare(f.root);
  await fs.rm(path.join(f.root,"WTF","Account","SyntheticAccount"),{recursive:true});
  const next=path.join(f.root,"WTF","Account","OtherSynthetic","SavedVariables","BackstageForever.lua");await fs.mkdir(path.dirname(next),{recursive:true});await fs.writeFile(next,saved());await sync.refresh();
  assert.equal(sync.accountSnapshots.size,1);assert.equal(sync.status().coverage.partial,true);
  await sync.reset();assert.equal(sync.status().coverage.partial,false);assert.equal(sync.status().coverage.omittedProfileCount,0);
});

test("account-directory bound reports partial coverage and preserves previously saved data",async t=>{
  const f=await fixture(t),events=[],sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:"unused",onSnapshot:s=>events.push(s)});t.after(()=>sync.close());
  await fs.writeFile(f.file,saved());await sync.prepare(f.root);
  for(let i=0;i<256;i++)await fs.mkdir(path.join(f.root,"WTF","Account",`EmptySynthetic${i}`));
  await sync.refresh();assert.equal(events.length,1);assert.equal(sync.status().characterCount,1);assert.equal(sync.status().coverage.partial,true);
});

test("missing previously populated Account directory reports partial and recovers without losing characters or notes",async t=>{
  const f=await fixture(t),{mergeSnapshot}=require("../src/core/profile-sync.cjs"),{defaultState}=require("../src/core/validation.cjs");
  let state=defaultState(),calls=0;
  const sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever"),onSnapshot:s=>{state=mergeSnapshot(state,s);calls++;}});t.after(()=>sync.close());
  const first=snapshot(),second=snapshot();
  second.characters[0]={...second.characters[0],id:"Player-second",name:"Second"};second.activeId="Player-second";
  const other=path.join(f.root,"WTF","Account","OtherSynthetic","SavedVariables","BackstageForever.lua");
  await fs.mkdir(path.dirname(other),{recursive:true});await fs.writeFile(f.file,saved(first));await fs.writeFile(other,saved(second));
  await sync.prepare(f.root);assert.equal(state.profiles.length,2);assert.equal(calls,1);
  state.profiles[0].notes="Keep private journal";
  const before=structuredClone(state),lastSync=sync.status().lastSync,account=path.join(f.root,"WTF","Account"),away=path.join(f.root,"WTF","Account-away");
  await fs.rename(account,away);let status=await sync.refresh();
  assert.equal(status.coverage.partial,true);assert.equal(status.coverage.unreadableAccountCount,2);assert.match(status.coverage.message,/unavailable|preserved/i);assert.doesNotMatch(status.coverage.message,/characters imported within/i);
  assert.equal(status.characterCount,2);assert.equal(status.lastSync,lastSync);assert.equal(sync.accountSnapshots.size,2);assert.deepEqual(state,before);assert.equal(calls,1);
  await fs.rename(away,account);first.characters[0].level=13;first.characters[0].updatedAt=1700000100;first.observedAt=1700000100;await fs.writeFile(f.file,saved(first));status=await sync.refresh();
  assert.equal(status.coverage.partial,false);assert.equal(status.coverage.unreadableAccountCount,0);assert.equal(state.profiles.length,2);assert.equal(state.profiles.find(p=>p.name==="Example").level,13);assert.equal(state.profiles[0].notes,"Keep private journal");assert.equal(calls,2);
});

test("never-saved client without an Account directory remains quietly prepared",async t=>{
  const f=await fixture(t);await fs.rm(path.join(f.root,"WTF","Account"),{recursive:true});
  const sync=new GameSync({dataDir:path.join(f.dir,"data"),addonDir:path.join(__dirname,"../addon/BackstageForever"),onSnapshot:()=>assert.fail("unexpected snapshot")});t.after(()=>sync.close());
  const status=await sync.prepare(f.root);
  assert.equal(status.addonCurrent,true);assert.equal(status.companionState,"prepared");assert.equal(status.nextAction.id,"play");assert.equal(status.coverage.partial,false);assert.equal(status.coverage.unreadableAccountCount,0);assert.equal(status.characterCount,0);
});

test("connected startup repairs the actual sixth coach module and preserves foreign addon content", async t => {
 const f=await fixture(t),addon=path.join(__dirname,"../addon/BackstageForever"),dataDir=path.join(f.dir,"data");
 const initial=new GameSync({dataDir,addonDir:addon});await initial.prepare(f.root);initial.close();
 const folder=path.join(f.root,"Interface/AddOns/BackstageForever");
 await fs.writeFile(path.join(folder,"foreign-owner.lua"),"owner data");await fs.unlink(path.join(folder,"BackstageForeverCoach.lua"));
 const restored=new GameSync({dataDir,addonDir:addon});t.after(()=>restored.close());await restored.ready;
 assert.equal(restored.status().addonCurrent,true);
 assert.equal(await fs.readFile(path.join(folder,"BackstageForeverCoach.lua"),"utf8"),await fs.readFile(path.join(addon,"BackstageForeverCoach.lua"),"utf8"));
 assert.equal(await fs.readFile(path.join(folder,"foreign-owner.lua"),"utf8"),"owner data");
});

test("connected startup repairs actual acquisition and profession modules with foreign files intact",async t=>{
 const f=await fixture(t),game=f.root,data=path.join(f.dir,'data'),addon=path.join(__dirname,'../addon/BackstageForever');
 const sync=new GameSync({dataDir:data,addonDir:addon});await sync.prepare(game);sync.close();const folder=path.join(game,'Interface/AddOns/BackstageForever');await fs.writeFile(path.join(folder,'foreign.lua'),'preserve');for(const name of ['BackstageForeverAcquisition.lua','BackstageForeverProfession.lua'])await fs.unlink(path.join(folder,name));
 const restored=new GameSync({dataDir:data,addonDir:addon});t.after(()=>restored.close());await restored.ready;for(const name of ['BackstageForeverAcquisition.lua','BackstageForeverProfession.lua'])assert.equal(await fs.readFile(path.join(folder,name),'utf8'),await fs.readFile(path.join(addon,name),'utf8'));assert.equal(await fs.readFile(path.join(folder,'foreign.lua'),'utf8'),'preserve');
});

test("reading SavedVariables teaches the live link which frames belong to the stored character", () => {
  const { identityHash, liveKeyFor } = require("../src/core/live-bridge.cjs");
  const parsed = parseSavedVariables(saved());
  const stored = parsed.characters[0].id;
  assert.notEqual(stored, "Player-synthetic-1", "profiles keep only a digest of the GUID");
  assert.equal(liveKeyFor(stored), identityHash("Player-synthetic-1"), "live frames carry the addon's hash of the raw GUID");
});
