"use strict";
// Preserve physical controls until browser pointer/focus/default dispatch completes.
window.InteractionGuard = (() => {
  function create({root, active, painting = () => false}) {
    let generation=0, gesture=0, pointer=null, transfer=null, select=null;
    const keyboard=new Map();
    let rootPending=null;const regions=new Map();
    const interacting=()=>active() && Boolean(pointer || keyboard.size || transfer || (select?.node.isConnected && document.activeElement===select.node));
    function release(pointerUp=false, selectClosed=false, keys=[]) {
      const token=generation, current=gesture, endedPointer=pointerUp?pointer:null, endedSelect=select, endedTransfer=transfer;
      setTimeout(()=>{
        if(token!==generation)return;
        // Each physical press completes independently of newer input modalities.
        const endedKeys=keys.filter(entry=>keyboard.get(entry.key)===entry);
        const held=current===gesture ? endedKeys.at(-1)?.node || (pointer===endedPointer?endedPointer?.summary:null) : null;
        const key=held?.dataset?.interactionKey;
        const disclosure=key && held.tagName==="SUMMARY" && held.isConnected && root.contains(held) && document.activeElement===held && held.parentElement?.tagName==="DETAILS"
          ? {key,open:held.parentElement.open,node:held} : null;
        if(transfer===endedTransfer)transfer=null;
        if(endedPointer && pointer===endedPointer)pointer=null;
        for(const entry of endedKeys)keyboard.delete(entry.key);
        if(select===endedSelect && (selectClosed || document.activeElement!==select?.node))select=null;
        if(interacting())return;
        const callbacks=rootPending?[rootPending]:[...regions.values()];
        rootPending=null;regions.clear();
        for(const callback of callbacks)callback();
        // Only mirror the just-activated disclosure, never saved state or checks.
        if(disclosure && callbacks.length && token===generation && current===gesture && active()){
          const replacement=[...root.querySelectorAll("summary[data-interaction-key]")].find(node=>node.dataset.interactionKey===disclosure.key);
          const focused=document.activeElement;
          if(replacement?.isConnected && replacement.parentElement?.tagName==="DETAILS" &&
            (focused===document.body || focused===disclosure.node || focused===replacement)){
            replacement.parentElement.open=disclosure.open;
            replacement.focus({preventScroll:true});
          }
        }
      },0);
    }
    root.addEventListener("pointerdown",event=>{
      if(active() && event.button===0){
        gesture++;pointer={summary:event.target.closest("summary")};
        const node=event.target.closest("select");select=node?{node}:null;
      }
    },true);
    document.addEventListener("pointerup",()=>release(true));
    document.addEventListener("pointercancel",()=>release(true,true,[...keyboard.values()]));
    document.addEventListener("keyup",event=>{const entry=keyboard.get(event.key);if(entry)release(false,false,[entry]);});
    root.addEventListener("focusout",event=>{
      if(active()&&!painting()){transfer={};release(false,false,[...keyboard.values()].filter(entry=>entry.node===event.target));}
    });
    root.addEventListener("change",event=>{if(event.target===select?.node)release(false,true);});
    root.addEventListener("keydown",event=>{
      if(!active())return;
      const node=event.target,button=node.tagName==="BUTTON" || (node.tagName==="INPUT"&&["button","submit","reset","image"].includes(node.type));
      const disclosure=node.tagName==="SUMMARY",check=node.tagName==="INPUT"&&["checkbox","radio"].includes(node.type);
      if((event.key===" "&&(button||disclosure||check)) || (event.key==="Enter"&&(button||disclosure))){
        if(!event.repeat){gesture++;keyboard.set(event.key,{node,key:event.key});}
      }
      if(event.target.tagName!=="SELECT")return;
      if(event.key==="Escape"||event.key==="Enter")release(false,true);
      else select={node:event.target};
    });
    window.addEventListener?.("blur",()=>release(true,true,[...keyboard.values()]));
    return {
      interacting,
      defer(callback,kind="region") {
        if(!interacting())return false;
        if(kind==="root")rootPending=callback;else regions.set(kind,callback);
        return true;
      },
      invalidate() {generation++;gesture++;pointer=null;transfer=null;select=null;keyboard.clear();rootPending=null;regions.clear();},
    };
  }
  return {create};
})();
