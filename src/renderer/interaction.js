"use strict";
// Preserve physical controls until browser pointer/focus/default dispatch completes.
window.InteractionGuard = (() => {
  function create({root, active, painting = () => false}) {
    let generation=0, gesture=0, pointer=false, transfer=false, select=null, keyboard=null;
    let rootPending=null;const regions=new Map();
    let pointerSummary=null;
    const interacting=()=>active() && (pointer || Boolean(keyboard) || transfer || Boolean(select?.isConnected && document.activeElement===select));
    function release(pointerUp=false, selectClosed=false, keyUp=false) {
      const token=generation, current=gesture;
      setTimeout(()=>{
        if(token!==generation || current!==gesture)return;
        const held=keyUp?keyboard?.node:pointerUp?pointerSummary:null;
        const key=held?.dataset?.interactionKey;
        const disclosure=key && held.tagName==="SUMMARY" && held.isConnected && root.contains(held) && document.activeElement===held && held.parentElement?.tagName==="DETAILS"
          ? {key,open:held.parentElement.open,node:held} : null;
        transfer=false;
        if(pointerUp){pointer=false;pointerSummary=null;}
        if(keyUp)keyboard=null;
        if(selectClosed || document.activeElement!==select)select=null;
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
      if(active() && event.button===0){gesture++;pointer=true;select=event.target.closest("select");pointerSummary=event.target.closest("summary");}
    },true);
    document.addEventListener("pointerup",()=>release(true));
    document.addEventListener("pointercancel",()=>release(true,true,true));
    document.addEventListener("keyup",event=>{if(event.key===keyboard?.key)release(false,false,true);});
    root.addEventListener("focusout",event=>{if(active()&&!painting()){transfer=true;release(false,false,event.target===keyboard?.node);}});
    root.addEventListener("change",event=>{if(event.target===select)release(false,true);});
    root.addEventListener("keydown",event=>{
      if(!active())return;
      const node=event.target,button=node.tagName==="BUTTON" || (node.tagName==="INPUT"&&["button","submit","reset","image"].includes(node.type));
      const disclosure=node.tagName==="SUMMARY",check=node.tagName==="INPUT"&&["checkbox","radio"].includes(node.type);
      if((event.key===" "&&(button||disclosure||check)) || (event.key==="Enter"&&(button||disclosure))){
        if(!event.repeat){gesture++;keyboard={node,key:event.key};}
      }
      if(event.target.tagName!=="SELECT")return;
      if(event.key==="Escape"||event.key==="Enter")release(false,true);
      else select=event.target;
    });
    window.addEventListener?.("blur",()=>release(true,true,true));
    return {
      interacting,
      defer(callback,kind="region") {
        if(!interacting())return false;
        if(kind==="root")rootPending=callback;else regions.set(kind,callback);
        return true;
      },
      invalidate() {generation++;gesture++;pointer=false;transfer=false;select=null;keyboard=null;pointerSummary=null;rootPending=null;regions.clear();},
    };
  }
  return {create};
})();
