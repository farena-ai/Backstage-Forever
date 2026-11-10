const test = require('node:test');
const assert = require('node:assert/strict');
const { CompanionContext } = require('../src/core/companion-context.cjs');
const { CompanionRequest } = require('../src/core/companion-request.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const fixture = () => { const state={profiles:[],activeProfileId:null,provider:{id:'ollama'}}; const context=new CompanionContext(()=>state); return {context, requests:new CompanionRequest(context)}; };
test('hung request Stop is idempotent; next request owns completion despite late old fulfillment', {timeout:2000}, async()=>{
 const {requests}=fixture(), old=deferred(), next=deferred(); let signal;
 const first=requests.run(s=>{signal=s;return old.promise;}); const rejected=assert.rejects(first,/stopped/);
 assert.equal(requests.cancel(),true); assert.equal(signal.aborted,true); assert.equal(requests.cancel(),false); await rejected;
 const second=requests.run(()=>next.promise); old.resolve('old'); await Promise.resolve();
 await assert.rejects(requests.run(()=>Promise.resolve('overlap')),/in progress/);
 next.resolve('new'); assert.equal(await second,'new');
});
test('context cancellation rejects late errors and never completes a memory draft',{timeout:2000},async()=>{
 const {context,requests}=fixture(), old=deferred();let completed=false;
 const first=requests.run(()=>old.promise).then(()=>{completed=true;});const rejected=assert.rejects(first,/no longer current/);
 context.invalidate('character');await rejected;old.reject(Error('private failure'));await new Promise(r=>setImmediate(r));assert.equal(completed,false);
 assert.equal(await requests.run(()=>Promise.resolve('next')),'next');
});
test('CLI ownership survives Stop until transport confirms termination',{timeout:2000},async()=>{
 const {requests}=fixture(), old=deferred();const first=requests.run(()=>old.promise,{waitForSettlement:true});const rejected=assert.rejects(first,/stopped/);
 requests.cancel();await rejected;await assert.rejects(requests.run(()=>Promise.resolve('unsafe')),/still stopping/);
 old.reject(Error('closed'));await new Promise(r=>setImmediate(r));assert.equal(await requests.run(()=>Promise.resolve('safe')),'safe');
});
test('API fetch cancellation reaches a stalled body after headers',{timeout:2000},async()=>{
 const {ask}=require('../src/core/providers.cjs'), controller=new AbortController();let reached;const started=new Promise(r=>reached=r);let observed;
 const result=ask({provider:'ollama',model:'fixture',endpoint:'http://127.0.0.1:11434',prompt:'quest',signal:controller.signal},async(_url,{signal})=>{observed=signal;return {ok:true,body:{async *[Symbol.asyncIterator](){reached();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}};});
 await started;controller.abort();assert.equal(observed.aborted,true);await assert.rejects(result);
});
