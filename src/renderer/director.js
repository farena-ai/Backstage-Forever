"use strict";
window.Director = (() => {
  let host,guard,generation=0,pending=false,error="",painting=false,view=null,focusRevision=0;
  const active=()=>host?.active();
  const esc=value=>host.esc(value);
  const controls=()=>[...host.root.querySelectorAll('[data-director] summary[data-interaction-key],[data-director] [data-plan-option],[data-director] [data-director-start],[data-director] [data-nav]')];
  const controlKey=n=>n?.dataset.interactionKey?"summary:"+n.dataset.interactionKey:n?.dataset.planOption?"option:"+n.dataset.planOption:n?.dataset.directorControl?"action:"+n.dataset.directorControl:n?.dataset.nav?"nav:"+n.dataset.nav:null;
  function beginRender(){
    const node=host.root.querySelector("[data-director]");
    view=null;
    if(active()&&node?.dataset.directorContext===JSON.stringify([host.profileId()??null,generation])){
      const nodes=controls(),focused=nodes.find(n=>n===document.activeElement);
      view={generation,profileId:host.profileId(),revision:focusRevision,key:controlKey(focused),disclosures:new Map(nodes.filter(n=>n.tagName==="SUMMARY").map(n=>[controlKey(n),n.parentElement.open]))};
    }
    painting=true;
  }
  function mounted(){
    if(!active()||!view||view.generation!==generation||view.profileId!==host.profileId())return;
    const nodes=controls();
    for(const n of nodes)if(n.tagName==="SUMMARY"&&view.disclosures.has(controlKey(n)))n.parentElement.open=view.disclosures.get(controlKey(n));
    if(view.revision!==focusRevision||!view.key)return;
    const node=nodes.find(n=>controlKey(n)===view.key);
    if(node&&!node.disabled&&(document.activeElement===document.body||!document.activeElement?.isConnected||document.activeElement===node))node.focus({preventScroll:true});
  }
  function endRender(){painting=false;view=null;}
  function invalidate(){generation++;pending=false;error="";view=null;guard?.invalidate();}
  function paint(){
    if(!active()||guard.defer(paint))return;
    const node=host.root.querySelector("[data-director]");
    if(node){beginRender();try{node.outerHTML=panel(host.model());mounted();}finally{endRender();}}
  }
  function destination(choice) {
    if(choice.sourceKind==="reference-clue" && !choice.destination)return "Public NPC mention · location clue only; no destination confirmed.";
    const point=choice.destination || choice.referenceDestination;
    if(!point)return choice.sourceKind==="reference-clue" ? "Public NPC mention · location clue only; no destination confirmed." : "Destination unknown · check your in-game quest log.";
    return `${choice.destination?"Saved game destination":"Approximate community location"} · ${point.name||point.text||"Quest position"} · map ${point.mapId} · ${(point.x*100).toFixed(1)}%, ${(point.y*100).toFixed(1)}%`;
  }
  function referenceEvidence(choice) {
    const point=!choice.destination && choice.referenceDestination;
    const labels={"observed-objective-gain":"Observed objective progress location","observed-turn-in-npc":"Observed turn-in NPC","observed-quest-giver":"Observed quest giver","mentioned-in-objective":"NPC mentioned in objective · clue only"};
    const provenance=choice.knowledge?.provenance;
    return `${point?`<p>${esc(labels[point.evidence]||"Qualified public observation")} · observed through ${esc(point.observedThrough||"unknown date")}</p>`:""}${provenance?`<p>Public reference · build ${esc(provenance.build)} · ${esc(provenance.attribution)}</p>`:""}`;
  }
  function choiceCard(choice,primary=false,index=0) {
    return `<article class="director-choice ${primary?"director-primary":"director-alternative"}" data-director-choice ${primary?"data-director-primary":""}><span class="director-priority">${primary?"01 · YOUR NEXT ACTION":`${String(index+2).padStart(2,"0")} · ANOTHER PATH`}</span><h3>${esc(choice.title)}</h3><p class="director-reason">${esc(choice.reason)}</p><div class="director-source">${choice.kind==="turn-in"?"◆ Ready to turn in":"◇ Saved objectives"} · ${choice.sourceKind==="game-snapshot"?"Game snapshot":choice.sourceKind==="reference"?"Qualified public reference":"Public reference clue"}</div><details><summary data-interaction-key="${esc(JSON.stringify([host.profileId(),choice.questId,"quest-evidence"]))}">Destination & saved evidence</summary><p>${esc(destination(choice))}</p>${referenceEvidence(choice)}<p>Saved ${esc(CommandCenter.savedTime(choice.source?.observedAt))}. ${choice.kind==="turn-in"?"Ready is not turned in.":"Continue the objectives reported in this saved log."}</p>${choice.knowledge?.status==="conflict"?'<p>The reference differs from the current game title. Saved game observations take priority.</p>':""}</details></article>`;
  }
  function panel(model) {
    const selected=host.options(),available=Boolean(model?.session?.available),primary=model?.primary;
    const session=`<div class="director-session">${CommandCenter.controls(selected,esc)}<div class="director-action"><button class="primary" data-director-start data-director-control="start" ${available&&!pending?"":"disabled"}>${pending?"Saving quest session…":"Start quest session"}</button><small>${available?`Tracks up to ${{15:1,30:2,60:3}[selected.minutes]} saved quest choices · opens Plans` : "Saved actionable addon quests required"}</small></div></div>`;
    return `<section class="director" data-director data-director-context="${esc(JSON.stringify([host.profileId()??null,generation]))}" aria-label="Adventure Director"><header class="director-heading"><div><span class="eyebrow">Quest session</span><h2>${primary?"Pick quests for this session":model?.status==="empty"?"No quest choices yet":"Quest choices appear after your first save"}</h2></div><span class="director-compass" aria-hidden="true">✧</span></header>${primary?`<div class="director-choices"><div class="director-main">${choiceCard(primary,true)}${session}</div><div class="director-alternatives">${(model.alternatives||[]).map((c,i)=>choiceCard(c,false,i)).join("")}</div></div>`:`<div class="director-empty"><p>${esc(model?.headline||"Open a character or connect a saved game snapshot to see your next quest choices.")}</p><p>Quest choices come from your saved quest log. You can still write your own checklist in Plans.</p><button data-nav="company">Plan it yourself in Plans →</button></div>${session}`}${error?`<div class="director-error" role="alert"><p>${esc(error)}</p><button data-director-start data-director-control="retry">Retry quest session</button></div>`:""}${model?.preparation?`<p class="director-preparation">◈ ${esc(model.preparation.message)}</p>`:""}${model?.privateGoals?.length?`<details class="director-private"><summary data-interaction-key="${esc(JSON.stringify([host.profileId(),"private-goals"]))}">${model.privateGoals.length} private ${model.privateGoals.length===1?"goal":"goals"} · only on this computer</summary><ul>${model.privateGoals.map(g=>`<li>${esc(g.text)}</li>`).join("")}</ul><p>These previews are never added to Explain my plan or tracked quest steps.</p></details>`:""}<p class="director-footnote">${esc(model?.freshness?.message||"Desktop choices reflect your last saved game snapshot.")} You choose every action; session length is a choice limit, not a time estimate.</p></section>`;
  }
  async function start() {
    if(pending||!active()||!host.model()?.session?.available)return;
    const token=generation,id=host.profileId(),options={...host.options()};
    const valid=()=>token===generation&&active()&&id===host.profileId();
    pending=true;error="";
    // Disable the actual pressed node; defer replacement until physical dispatch ends.
    host.root.querySelectorAll("[data-director-start]").forEach(node=>{node.disabled=true;node.textContent="Saving quest session…";});
    try {
      const result=await host.mutate(id,options,valid);
      if(result&&valid())host.open(result);
    }catch{
      if(valid())error="This quest session could not be saved. Your existing plans are safe. Try again.";
    }finally{if(valid()){pending=false;paint();}}
  }
  function init(options) {
    host=options;guard=InteractionGuard.create({root:host.root,active,painting:()=>painting});
    document.addEventListener("focusin",event=>{if(active()&&!painting&&event.target!==document.body)focusRevision++;});
    document.addEventListener("pointerdown",()=>{if(active()&&!painting)focusRevision++;},true);
    document.addEventListener("keydown",event=>{if(active()&&!painting&&event.key==="Tab")focusRevision++;},true);
    host.root.addEventListener("click",event=>{if(event.target.closest("[data-director-start]"))start();});
  }
  return {init,panel,paint,invalidate,beginRender,mounted,endRender,deferRender:callback=>guard?.defer(callback,"root")||false,deferPaint:callback=>guard?.defer(callback,"guidance")||false};
})();
