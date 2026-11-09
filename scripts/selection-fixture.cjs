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

module.exports={selectCurrentText};
