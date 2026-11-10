"use strict";
const assert=require("node:assert/strict");

// Resolve and prepare an idle text control in one renderer task. Locator.evaluate
// first resolves a handle, which an ordinary intervening paint can disconnect.
async function selectCurrentText(page,{selector,value,start,end,focus=false,capture}) {
 const prepared=await page.evaluate(({selector,value,start,end,focus,capture})=>{
  const matches=document.querySelectorAll(selector);
  if(matches.length!==1)throw Error(`Expected one selection target: ${selector}`);
  const node=matches[0];
  if(!node.isConnected||node.value!==value)throw Error(`Selection target is not the intended draft: ${selector}`);
  if(focus)node.focus();
  if(document.activeElement!==node)throw Error(`Selection target does not own focus: ${selector}`);
  node.setSelectionRange(start,end);
  if(capture)window[capture]=node;
  return {connected:node.isConnected,value:node.value,focused:document.activeElement===node,start:node.selectionStart,end:node.selectionEnd};
 },{selector,value,start,end,focus,capture});
 assert.deepEqual(prepared,{connected:true,value,focused:true,start,end},"Current draft owns the exact selection before the tested update");
}

// Current semantic ownership is one snapshot, not an element handle followed by
// a later focus read. Explicit captured-original-node assertions stay separate.
async function currentControlState(page,target,{selection=false,disclosure=false}={}) {
 return page.evaluate(({target,selection,disclosure})=>{
  const {selector,scope}=typeof target==="string"?{selector:target}:target;
  let root=document;
  if(scope){
   const scopes=[...document.querySelectorAll(scope.selector)].filter(n=>n.getAttribute(scope.attribute)===scope.value);
   if(scopes.length!==1)throw Error(`Expected one current control scope: ${scope.selector}`);
   root=scopes[0];
  }
  const matches=root.querySelectorAll(selector);
  if(matches.length!==1||!matches[0].isConnected)throw Error(`Expected one connected current control: ${selector}`);
  const node=matches[0],result={focused:node===document.activeElement};
  if(selection)Object.assign(result,{value:node.value,start:node.selectionStart,end:node.selectionEnd});
  if(disclosure){
   if(node.tagName!=="SUMMARY"||node.parentElement?.tagName!=="DETAILS")throw Error(`Expected a native disclosure: ${selector}`);
   result.open=node.parentElement.open;
  }
  return result;
 },{target,selection,disclosure});
}

module.exports={selectCurrentText,currentControlState};
