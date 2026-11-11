"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');

async function checkedPackagedRoot(temp,runRoot){
 const canonicalTemp=await fs.realpath(temp),resolved=await fs.realpath(runRoot);
 assert.equal(resolved,path.resolve(runRoot),'Disposable packaged root was substituted or resolved elsewhere');
 assert.equal(path.dirname(resolved),canonicalTemp,'Disposable packaged root must be directly contained in TEMP');
 assert.ok(/^backstage-packaged-[A-Za-z0-9]+$/.test(path.basename(resolved)),'Unowned disposable packaged basename');
 return resolved;
}

async function closePackagedApp(app,{timeoutMs=10000}={}){
 if(!app)return;
 const child=app.process();
 assert.ok(child&&typeof child.once==='function','Packaged shutdown requires its exact launched child process');
 let timer,onClose,onError;
 // Register before requesting protocol shutdown so a fast native close cannot
 // be missed. Playwright's application acknowledgement is not our fs barrier.
 const closed=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise((resolve,reject)=>{
  onClose=resolve;onError=reject;child.once('close',onClose);child.once('error',onError);
 });
 try{
  await Promise.race([
   Promise.all([Promise.resolve().then(()=>app.close()),closed]),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Packaged application process close timed out after ${timeoutMs} ms`)),timeoutMs);}),
  ]);
 }finally{
  clearTimeout(timer);if(onClose)child.removeListener('close',onClose);if(onError)child.removeListener('error',onError);
 }
}

async function cleanupPackagedRun({app,temp,runRoot}){
 await checkedPackagedRoot(temp,runRoot);
 await closePackagedApp(app);
 // Windows sharing/executable locks can outlive process close briefly. Keep a
 // single outer retry budget; recursive native retries can multiply by depth.
 for(let attempt=0;;attempt++){
  const resolved=await checkedPackagedRoot(temp,runRoot);
  try{await fs.rm(resolved,{recursive:true,force:true,maxRetries:0});return;}
  catch(error){if(!['EBUSY','EPERM'].includes(error.code)||attempt===6)throw error;}
  await delay(100*(attempt+1));
 }
}
module.exports={checkedPackagedRoot,closePackagedApp,cleanupPackagedRun};
