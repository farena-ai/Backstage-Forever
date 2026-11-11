"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter,once}=require('node:events'),{spawn}=require('node:child_process');
let helper;try{helper=require('../scripts/packaged-cleanup.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const need=()=>{assert.ok(helper,'packaged teardown must explicitly own process shutdown and bounded cleanup');return helper;};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){
 const temp=await fs.realpath(os.tmpdir()),runRoot=await fs.mkdtemp(path.join(temp,'backstage-packaged-'));
 return {temp,runRoot,async verify(){const resolved=await fs.realpath(runRoot);assert.equal(resolved,runRoot);assert.equal(path.dirname(resolved),temp);assert.ok(path.basename(resolved).startsWith('backstage-packaged-'));return resolved;},async dispose(){await fs.rm(await this.verify(),{recursive:true,force:true,maxRetries:6,retryDelay:100});}};
}
async function lock(file){
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$fixtureHandle=[IO.File]::Open($env:BF_HELD_FIXTURE,'Open','ReadWrite','None'); [Console]::WriteLine('ready'); [Console]::Out.Flush(); [void][Console]::ReadLine(); $fixtureHandle.Dispose();"],{windowsHide:true,env:{...process.env,BF_HELD_FIXTURE:file},stdio:['pipe','pipe','pipe']});
 const ready=await once(child.stdout,'data');assert.match(String(ready[0]),/ready/);return child;
}
async function release(child){if(child&&child.exitCode===null){const closed=once(child,'close');child.stdin.end('exit\n');await closed;}}
test('shutdown waits for actual owned process close after both protocol acknowledgement and exit',async()=>{
 const {closePackagedApp}=need(),child=new EventEmitter();child.exitCode=null;child.signalCode=null;
 const acknowledged=deferred(),app={process:()=>child,close:async()=>{acknowledged.resolve();}};
 let settled=false;const closing=closePackagedApp(app).then(()=>{settled=true;});await acknowledged.promise;
 assert.equal(settled,false);assert.equal(child.listenerCount('close'),1);
 child.exitCode=0;child.emit('exit',0,null);await Promise.resolve();assert.equal(settled,false,'native close, not merely exit or protocol close, completes shutdown');
 child.emit('close',0,null);await closing;assert.equal(settled,true);assert.equal(child.listenerCount('close'),0);
});
test('shutdown timeout is bounded and removes its process listeners without claiming success',async()=>{
 const {closePackagedApp}=need(),child=new EventEmitter();child.exitCode=null;child.signalCode=null;
 await assert.rejects(closePackagedApp({process:()=>child,close:async()=>{}},{timeoutMs:25}),/process.*close.*timed out/i);
 assert.equal(child.listenerCount('close'),0);assert.equal(child.listenerCount('error'),0);
});
test('fast native close still awaits its protocol promise and already exited children do not hang',async()=>{
 const {closePackagedApp}=need(),child=new EventEmitter();child.exitCode=null;child.signalCode=null;
 const admitted=deferred(),protocol=deferred();let settled=false;
 const closing=closePackagedApp({process:()=>child,close:async()=>{child.exitCode=0;child.emit('close',0,null);admitted.resolve();await protocol.promise;}}).then(()=>{settled=true;});
 await admitted.promise;assert.equal(settled,false);protocol.resolve();await closing;
 let calls=0;await closePackagedApp({process:()=>child,close:async()=>{calls++;}});assert.equal(calls,1);assert.equal(child.listenerCount('close'),0);
});
test('failed app close preserves the owned disposable tree and propagates the failure',async()=>{
 const {cleanupPackagedRun}=need(),f=await fixture(),child=new EventEmitter();child.exitCode=null;child.signalCode=null;
 try{await assert.rejects(cleanupPackagedRun({...f,app:{process:()=>child,close:async()=>{throw Error('fixture shutdown refused');}}}),/fixture shutdown refused/);assert.equal(await fs.realpath(f.runRoot),f.runRoot);}finally{await f.dispose();}
});
test('packaged cleanup rejects TEMP itself, an unowned basename and a substituted junction',async()=>{
 const {checkedPackagedRoot,cleanupPackagedRun}=need(),f=await fixture(),unowned=await fs.mkdtemp(path.join(f.temp,'unowned-packaged-'));let junction;
 try{
  await assert.rejects(cleanupPackagedRun({temp:f.temp,runRoot:f.temp}),/disposable|TEMP|contained/i);
  await assert.rejects(cleanupPackagedRun({temp:f.temp,runRoot:unowned}),/disposable|basename/i);
  junction=path.join(f.temp,'backstage-packaged-junction-'+path.basename(f.runRoot));await fs.symlink(f.runRoot,junction,'junction');
  await assert.rejects(checkedPackagedRoot(f.temp,junction),/resolved|substitut/i);
  assert.equal(await fs.realpath(unowned),unowned);assert.equal(await fs.realpath(f.runRoot),f.runRoot);
 }finally{
  if(junction)await fs.unlink(junction);
  const real=await fs.realpath(unowned);assert.equal(path.dirname(real),f.temp);assert.ok(path.basename(real).startsWith('unowned-packaged-'));await fs.rm(real,{recursive:true,force:true});await f.dispose();
 }
});
test('actual Windows file lock survives a protocol close until the exact fixture process closes',{skip:process.platform!=='win32'},async()=>{
 const {cleanupPackagedRun}=need(),f=await fixture();let child,removed=false;
 try{
  const file=path.join(await f.verify(),'held-fixture.exe');await fs.writeFile(file,'fictional executable bytes');child=await lock(file);
  await assert.rejects(fs.rm(file),{code:'EBUSY'});
  const acknowledged=deferred(),app={process:()=>child,close:async()=>{acknowledged.resolve();}};
  const cleanup=cleanupPackagedRun({...f,app});await acknowledged.promise;assert.equal(child.exitCode,null);assert.equal(await fs.realpath(f.runRoot),f.runRoot);
  await release(child);await cleanup;removed=true;await assert.rejects(fs.stat(f.runRoot),{code:'ENOENT'});
 }finally{await release(child);if(!removed)await f.dispose();}
});
test('transient Windows EBUSY is retried after shutdown, while stubborn EBUSY remains a failed cleanup',{skip:process.platform!=='win32'},async()=>{
 const {cleanupPackagedRun}=need();
 for(const stubborn of [false,true]){
  const f=await fixture();let child,timer,removed=false;
  try{
   const file=path.join(await f.verify(),'held-fixture.exe');await fs.writeFile(file,'fictional remaining resource lock');child=await lock(file);await assert.rejects(fs.rm(file),{code:'EBUSY'});
   if(stubborn){await assert.rejects(cleanupPackagedRun({...f,app:null}),{code:'EBUSY'});assert.equal(await fs.realpath(f.runRoot),f.runRoot);assert.equal(child.exitCode,null);}
   else{timer=setTimeout(()=>child.stdin.end('exit\n'),250);await cleanupPackagedRun({...f,app:null});removed=true;await assert.rejects(fs.stat(f.runRoot),{code:'ENOENT'});}
  }finally{clearTimeout(timer);await release(child);if(!removed)await f.dispose();}
 }
});
test('smoke owns restart shutdown, validates before copy, and prints PASS only after successful teardown',async()=>{
 need();const source=await fs.readFile('scripts/packaged-smoke.cjs','utf8');
 const checked=source.indexOf('await checkedPackagedRoot(temp, runRoot)'),copy=source.indexOf('await fs.cp(');assert.ok(checked>=0&&copy>checked);
 assert.match(source,/await closePackagedApp\(app\);\s+app = null/);
 assert.match(source,/finally \{\s+await cleanupPackagedRun\(\{ app, temp, runRoot \}\);\s+\}\s+console\.log\(successMessage\)/);
 assert.doesNotMatch(source,/if \(app\) await app\.close\(\)/);
});
