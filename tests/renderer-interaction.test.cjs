"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
function fixture() {
  const target=()=>({listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},emit(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}});
  const root=target(),document=target(),window=target(),timers=[];document.activeElement=null;document.body={};let active=true;
  root.contains=()=>true;root.querySelectorAll=()=>[];
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/renderer/interaction.js"),"utf8"),{window,document,setTimeout:fn=>timers.push(fn)});
  const guard=window.InteractionGuard.create({root,active:()=>active,painting:()=>false});
  const button={closest:()=>null};return {root,document,window,guard,button,setActive:value=>active=value,flush:()=>{while(timers.length)timers.shift()();}};
}
test("whole-root deferral survives later regional paints",()=>{
  const f=fixture(),calls=[];f.root.emit("pointerdown",{button:0,target:f.button});
  assert.equal(f.guard.defer(()=>calls.push("root"),"root"),true);
  assert.equal(f.guard.defer(()=>calls.push("region")),true);
  f.document.emit("pointerup");assert.deepEqual(calls,[]);f.flush();assert.deepEqual(calls,["root"]);
});
test("obsolete release cannot end a new gesture after invalidation",()=>{
  const f=fixture(),calls=[];f.root.emit("pointerdown",{button:0,target:f.button});f.document.emit("pointerup");
  f.guard.invalidate();f.root.emit("pointerdown",{button:0,target:f.button});f.guard.defer(()=>calls.push("new"),"root");
  f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
  f.document.emit("pointerup");f.flush();assert.deepEqual(calls,["new"]);
});
test("native select remains intact through pointer release and keyboard cancellation",()=>{
  const f=fixture(),calls=[],select={tagName:"SELECT",isConnected:true,closest:()=>select};f.document.activeElement=select;
  f.root.emit("pointerdown",{button:0,target:select});f.guard.defer(()=>calls.push("paint"));f.document.emit("pointerup");f.flush();assert.deepEqual(calls,[]);
  f.root.emit("keydown",{target:select,key:"Escape"});f.flush();assert.deepEqual(calls,["paint"]);
});
test("focus transfer waits for the browser default focus action",()=>{
  const f=fixture(),calls=[];f.root.emit("focusout");f.guard.defer(()=>calls.push("paint"));assert.deepEqual(calls,[]);f.flush();assert.deepEqual(calls,["paint"]);
});
test("different regional channels both settle while a root render still supersedes them",()=>{
  const f=fixture(),calls=[];f.root.emit("pointerdown",{button:0,target:f.button});
  f.guard.defer(()=>calls.push("director"));f.guard.defer(()=>calls.push("guidance"),"guidance");
  f.document.emit("pointerup");f.flush();assert.deepEqual(calls,["director","guidance"]);
});
test("keyboard Space activation keeps its real button until keyup default dispatch",()=>{
  const f=fixture(),calls=[],button={tagName:"BUTTON",closest:()=>null};
  f.root.emit("keydown",{target:button,key:" "});
  assert.equal(f.guard.defer(()=>calls.push("paint"),"root"),true);
  assert.deepEqual(calls,[]);f.document.emit("keyup",{key:" "});f.flush();assert.deepEqual(calls,["paint"]);
});
test("native Space activation is guarded for disclosures, checks, radio and input buttons",()=>{
  for(const [tagName,type] of [["SUMMARY",undefined],["INPUT","checkbox"],["INPUT","radio"],["INPUT","button"],["INPUT","submit"],["INPUT","reset"]]){
    const f=fixture(),node={tagName,type,closest:()=>null};f.root.emit("keydown",{target:node,key:" "});
    assert.equal(f.guard.defer(()=>{},"root"),true,`${tagName}/${type}: protect keyup default activation`);
    f.document.emit("keyup",{key:" "});f.flush();assert.equal(f.guard.interacting(),false);
  }
});
test("Enter protects native button/disclosure activation without intercepting text and checkbox typing",()=>{
  for(const [tagName,type,expected] of [["SUMMARY",undefined,true],["BUTTON",undefined,true],["INPUT","button",true],["INPUT","submit",true],["INPUT","text",false],["TEXTAREA",undefined,false],["INPUT","checkbox",false],["INPUT","radio",false]]){
    const f=fixture(),node={tagName,type,closest:()=>null};f.root.emit("keydown",{target:node,key:"Enter"});
    assert.equal(f.guard.defer(()=>{},"root"),expected,`${tagName}/${type}: native Enter semantics`);
  }
});
test("text editing Space is not treated as native activation",()=>{
  for(const [tagName,type] of [["INPUT","text"],["INPUT","search"],["TEXTAREA",undefined]]){
    const f=fixture();f.root.emit("keydown",{target:{tagName,type},key:" "});assert.equal(f.guard.defer(()=>{}),false);
  }
});
test("older keyboard release cannot end a newer keyboard gesture",()=>{
  const f=fixture(),calls=[],node={tagName:"BUTTON",closest:()=>null};
  f.root.emit("keydown",{target:node,key:" "});f.document.emit("keyup",{key:" "});
  f.root.emit("keydown",{target:node,key:" "});f.guard.defer(()=>calls.push("paint"),"root");
  f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
  f.document.emit("keyup",{key:" "});f.flush();assert.deepEqual(calls,["paint"]);
});
function disclosure(f,key,open=false){const node={tagName:"SUMMARY",isConnected:true,dataset:{interactionKey:key},parentElement:{tagName:"DETAILS",open},focus(){f.document.activeElement=node;}};node.closest=selector=>selector==="summary"?node:null;return node;}
test("held summary restores default open/focus by stable identity after reordered deferred paints",()=>{
  for(const keyboard of [true,false]){
    const f=fixture(),old=disclosure(f,'["p","quest-1","evidence"]'),replacement=disclosure(f,old.dataset.interactionKey),other=disclosure(f,'["p","quest-2","evidence"]');
    f.document.activeElement=old;
    if(keyboard)f.root.emit("keydown",{target:old,key:" "});else f.root.emit("pointerdown",{target:old,button:0});
    assert.equal(f.guard.defer(()=>{old.isConnected=false;f.document.activeElement=f.document.body;f.root.querySelectorAll=()=>[other,replacement];},"root"),true);
    if(keyboard)f.document.emit("keyup",{key:" "});else f.document.emit("pointerup");
    old.parentElement.open=true;f.flush();
    assert.equal(replacement.parentElement.open,true);assert.equal(other.parentElement.open,false);assert.equal(f.document.activeElement,replacement);
  }
});
test("deleted, inactive, invalidated and intentionally refocused disclosures cannot steal open/focus",()=>{
  for(const boundary of ["deleted","view","generation","refocused"]){
    const f=fixture(),old=disclosure(f,"original"),other=disclosure(f,boundary==="deleted"?"different":"original"),intentional={isConnected:true};f.document.activeElement=old;
    f.root.emit("keydown",{target:old,key:" "});f.guard.defer(()=>{
      old.isConnected=false;f.document.activeElement=boundary==="refocused"?intentional:f.document.body;f.root.querySelectorAll=()=>[other];
      if(boundary==="generation")f.guard.invalidate();if(boundary==="view")f.setActive(false);
    },"root");
    f.document.emit("keyup",{key:" "});old.parentElement.open=true;f.flush();
    assert.equal(other.parentElement.open,false,boundary);assert.notEqual(f.document.activeElement,other,boundary);
  }
});
test("unrelated key release cannot settle Space and default blur/window cancellation releases it",()=>{
  for(const boundary of ["focusout","window"]){
    const f=fixture(),node={tagName:"INPUT",type:"checkbox"},calls=[];
    f.root.emit("keydown",{target:node,key:" "});f.guard.defer(()=>calls.push("paint"),"root");
    f.document.emit("keyup",{key:"Enter"});f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
    if(boundary==="focusout")f.root.emit("focusout",{target:node});else f.window.emit("blur");
    f.flush();assert.deepEqual(calls,["paint"]);assert.equal(f.guard.interacting(),false);
  }
});
test("pointerup followed by keydown completes the pointer without ending the newer held key",()=>{
  const f=fixture(),calls=[],node={tagName:"BUTTON",closest:()=>null};
  f.root.emit("pointerdown",{button:0,target:node});f.document.emit("pointerup");
  f.root.emit("keydown",{target:node,key:" "});f.guard.defer(()=>calls.push("root"),"root");f.guard.defer(()=>calls.push("region"));
  f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
  f.document.emit("keyup",{key:" "});f.flush();assert.equal(f.guard.interacting(),false);assert.deepEqual(calls,["root"]);
});
test("keyup followed by pointerdown completes the key without ending the newer held pointer",()=>{
  const f=fixture(),calls=[],node={tagName:"BUTTON",closest:()=>null};
  f.root.emit("keydown",{target:node,key:" "});f.document.emit("keyup",{key:" "});
  f.root.emit("pointerdown",{button:0,target:node});f.guard.defer(()=>calls.push("paint"),"root");
  f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
  f.document.emit("pointerup");f.flush();assert.equal(f.guard.interacting(),false);assert.deepEqual(calls,["paint"]);
});
test("old pointer release cannot clear a newer same-kind pointer press",()=>{
  const f=fixture(),calls=[];f.root.emit("pointerdown",{button:0,target:f.button});f.document.emit("pointerup");
  f.root.emit("pointerdown",{button:0,target:f.button});f.guard.defer(()=>calls.push("paint"),"root");f.flush();
  assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);f.document.emit("pointerup");f.flush();assert.deepEqual(calls,["paint"]);
});
test("overlapping Space and Enter keep independent native activation lifetimes",()=>{
  for(const first of [" ","Enter"]){
    const f=fixture(),calls=[],node={tagName:"BUTTON",closest:()=>null},second=first===" "?"Enter":" ";
    f.root.emit("keydown",{target:node,key:first});f.root.emit("keydown",{target:node,key:second});f.guard.defer(()=>calls.push("paint"),"root");
    f.document.emit("keyup",{key:second});f.flush();assert.equal(f.guard.interacting(),true);assert.deepEqual(calls,[]);
    f.document.emit("keyup",{key:first});f.flush();assert.equal(f.guard.interacting(),false);assert.deepEqual(calls,["paint"]);
  }
});
test("mixed held inputs settle after cancellation and invalidation does not flush stale work",()=>{
  for(const boundary of ["blur","cancel","invalidate"]){
    const f=fixture(),calls=[],node={tagName:"BUTTON",closest:()=>null};
    f.root.emit("pointerdown",{button:0,target:node});f.document.emit("pointerup");f.root.emit("keydown",{target:node,key:" "});f.root.emit("keydown",{target:node,key:"Enter"});f.guard.defer(()=>calls.push("old"),"root");
    if(boundary==="blur")f.window.emit("blur");else if(boundary==="cancel")f.document.emit("pointercancel");else f.guard.invalidate();
    f.flush();assert.equal(f.guard.interacting(),false);assert.deepEqual(calls,boundary==="invalidate"?[]:["old"]);
    f.root.emit("pointerdown",{button:0,target:node});f.guard.defer(()=>calls.push("new"),"root");f.document.emit("pointerup");f.flush();assert.equal(calls.at(-1),"new");
  }
});
