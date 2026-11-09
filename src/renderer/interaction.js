"use strict";
// Preserve physical controls until browser pointer/focus/default dispatch completes.
window.InteractionGuard = (() => {
  function create({root, active, painting = () => false}) {
    let generation=0, gesture=0, pointer=false, transfer=false, select=null, keyboard=false;
    let rootPending=null;const regions=new Map();
    const interacting=()=>active() && (pointer || keyboard || transfer || (select?.isConnected && document.activeElement===select));
    function release(pointerUp=false, selectClosed=false, keyUp=false) {
      const token=generation, current=gesture;
      setTimeout(()=>{
        if(token!==generation || current!==gesture)return;
        transfer=false;
        if(pointerUp)pointer=false;
        if(keyUp)keyboard=false;
        if(selectClosed || document.activeElement!==select)select=null;
        if(interacting())return;
        const callbacks=rootPending?[rootPending]:[...regions.values()];
        rootPending=null;regions.clear();
        for(const callback of callbacks)callback();
      },0);
    }
    root.addEventListener("pointerdown",event=>{
      if(active() && event.button===0){gesture++;pointer=true;select=event.target.closest("select");}
    },true);
    document.addEventListener("pointerup",()=>release(true));
    document.addEventListener("pointercancel",()=>release(true,true,true));
    document.addEventListener("keyup",event=>{if(event.key===" "||event.key==="Enter")release(false,false,true);});
    root.addEventListener("focusout",()=>{if(active()&&!painting()){transfer=true;release();}});
    root.addEventListener("change",event=>{if(event.target===select)release(false,true);});
    root.addEventListener("keydown",event=>{
      if(!active())return;
      if((event.key===" "||event.key==="Enter")&&event.target.tagName==="BUTTON")keyboard=true;
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
      invalidate() {generation++;gesture++;pointer=false;transfer=false;select=null;keyboard=false;rootPending=null;regions.clear();},
    };
  }
  return {create};
})();
