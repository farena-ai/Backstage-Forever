"use strict";
// Shared isolation for covering UI gates. All substitutes are installed before app bootstrap.
const fs = require("node:fs/promises"),
  path = require("node:path");
async function syntheticLaunch(data) {
  await fs.mkdir(path.join(data, "updates"), { recursive: true });
  await fs.writeFile(
    path.join(data, "updates/preferences.json"),
    JSON.stringify({ automatic: false, installOnQuit: false }),
  );
  await fs.mkdir(path.join(data, "knowledge-v1"), { recursive: true });
  await fs.writeFile(
    path.join(data, "knowledge-v1/preferences.json"),
    JSON.stringify({ automatic: false, checked: {} }),
  );
  const repo = path.resolve(__dirname, ".."),
    dir = path.join(data, "coach-ui-bootstrap");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "synthetic-covering-ui",
      version: require("../package.json").version,
      main: "main.cjs",
    }),
  );
  await fs.writeFile(
    path.join(dir, "main.cjs"),
    `
 const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
 const electron=load('electron');electron.app.getAppPath=()=>${JSON.stringify(repo)};
 let clipboard='';electron.clipboard.writeText=value=>{clipboard=String(value);};electron.clipboard.readText=()=>clipboard;electron.shell.openExternal=async()=>{};
 load('./src/core/store.cjs').Store.prototype.getKey=function(){return '';};
 load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'Synthetic fixture'});
 load('./src/core/claude.cjs').status=async()=>({available:false,connected:false,installed:false,loggedIn:false});
 load('./src/core/providers.cjs').ask=async()=>{throw Error('Synthetic gate blocks external inference');};
 load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
 load('./src/core/game-runtime.cjs').GameRuntime.prototype.launch=async()=>{throw Error('Synthetic gate blocks game launch');};
 load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
 load('./src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]}});
 load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
 load('./src/core/updater.cjs').Updater.prototype.start=function(){};
 load('./src/main.cjs');
 `,
  );
  return dir;
}
module.exports = { syntheticLaunch };
