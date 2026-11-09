"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
function fixture() {
  const target=()=>({listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},emit(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}});
  const root=target(),document=target(),window=target(),timers=[];document.activeElement=null;
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/renderer/interaction.js"),"utf8"),{window,document,setTimeout:fn=>timers.push(fn)});
  const guard=window.InteractionGuard.create({root,active:()=>true,painting:()=>false});
  const button={closest:()=>null};return {root,document,window,guard,button,flush:()=>{while(timers.length)timers.shift()();}};
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
