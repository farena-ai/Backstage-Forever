"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
let ConversationSession;
try { ({ConversationSession} = require('../src/core/companion-conversation.cjs')); } catch (e) { if(e.code !== 'MODULE_NOT_FOUND') throw e; }
const owner = {profileId:'Alpha',provider:{id:'ollama',model:'fixture'},source:['wow-addon','opaque'],rootEpoch:0};
const input = (prompt='Where should I level?',extra={}) => ({owner,shareProfile:true,memoryIds:[],prompt,...extra});
const complete = (s,prompt,answer='Unverified previous suggestion',extra={}) => {const p=s.prepare(input(prompt,extra)); assert.equal(s.commit(p.token,{question:prompt,answer,kind:'ai'}),true);return p;};
test('session interface is available',()=>assert.equal(typeof ConversationSession,'function'));
test('Org to TB original question accompanies an explicit Forever correction as untrusted history',()=>{
 const s=new ConversationSession(); complete(s,'what is the fastest way from org to tb');
 const p=s.prepare(input('This is for wow forever, not retail'));
 assert.match(p.composedPrompt,/fastest way from org to tb/);assert.match(p.composedPrompt,/untrusted/i);
 assert.equal(p.questionForEvidence,'what is the fastest way from org to tb');assert.equal(p.meta.usedTurns,1);
 assert.equal(s.prepare(input('What professions fit a mage?')).questionForEvidence,'What professions fit a mage?');
});
test('latest original and explicit memory are verbatim inside total cap, including full 12000 character current input',()=>{
 const s=new ConversationSession();complete(s,'Prior quest?','A'.repeat(100000));
 const original='Q'.repeat(12000),p=s.prepare(input(original));assert.equal(p.composedPrompt,original);assert.equal(p.meta.usedTurns,0);assert.equal(p.meta.omittedTurns,1);
 const augmented='Explicit selected memory\nCurrent original question:\nWhere now?';
 const m=s.prepare(input('Where now?',{memoryIds:['chosen'],currentPrompt:augmented}));assert.ok(m.composedPrompt.endsWith(augmented));assert.ok(m.composedPrompt.length<=12000);
});
test('keeps six completed pairs and clips oversized historical text with valid JSON and explicit marker',()=>{
 const s=new ConversationSession();for(let i=0;i<8;i++)complete(s,'Question '+i,'A'.repeat(i===7?100000:50));
 assert.equal(s.status().turns,6);const p=s.prepare(input('Latest'));
 assert.ok(p.composedPrompt.length<=12000);assert.ok(p.composedPrompt.length-'Latest'.length<=6000);assert.match(p.composedPrompt,/omitted|truncated/i);assert.ok(p.meta.omittedTurns>=2);
 const serialized=p.composedPrompt.split('\n').find(line=>line.startsWith('[{'));assert.ok(Array.isArray(JSON.parse(serialized)));
});
test('scope boundaries clear prior answers, including selected memory deselection and sharing changes',()=>{
 for(const extra of [{memoryIds:[]},{shareProfile:false,memoryIds:['saved']},{owner:{...owner,profileId:'Beta'},memoryIds:['saved']},{owner:{...owner,provider:{id:'openai'}},memoryIds:['saved']},{owner:{...owner,rootEpoch:1},memoryIds:['saved']}]){
  const s=new ConversationSession();complete(s,'Private question','MEMORY_CANARY',{memoryIds:['saved']});const p=s.prepare(input('Next',extra));assert.doesNotMatch(p.composedPrompt,/MEMORY_CANARY/);assert.equal(p.meta.usedTurns,0);assert.equal(p.meta.resetReason,'scope-change');
 }
});
test('same explicitly reselected memory set continues, sorted independently of order and caller mutation',()=>{
 const s=new ConversationSession(),ids=['b','a'],owned=structuredClone(owner);complete(s,'Prior','Answer',{memoryIds:ids,owner:owned});ids.push('c');owned.profileId='Mutated';
 assert.equal(s.prepare(input('Next',{memoryIds:['a','b']})).meta.usedTurns,1);
});
test('clear invalidates prepared commits and never stores refused or invalid replies',()=>{
 for(const reason of ['clear','renderer-navigation','source-root','import','reset','recovery-restore']){
  const s=new ConversationSession();const p=s.prepare(input());s.clear(reason);assert.equal(s.commit(p.token,{question:'Old',answer:'Late',kind:'ai'}),false);assert.equal(s.status().turns,0);assert.equal(s.prepare(input()).meta.resetReason,reason);
 }
 const s=new ConversationSession();const p=s.prepare(input());assert.equal(s.commit(p.token,{question:'Wrong',answer:'A',kind:'ai'}),false);assert.equal(s.commit(p.token,{question:'Where should I level?',answer:'scope',kind:'scope'}),false);assert.equal(s.status().turns,0);
});
