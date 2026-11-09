"use strict";
// The app owns saved state and its mutation queue; this module owns local UI drafts.
window.Company = (() => {
  let host, model = null, signature = "", generation = 0, read = 0, loading = false;
  let error = "", errorKind = "", retry = null, creating = false, focus = null, painting = false;
  let guard, requestedFocus = null, requestedJourney = null;
  const drafts = new Map(), pending = new Map();
  const saving = (type, journeyId) => [...pending.values()].some(action=>action.type===type&&action.journeyId===journeyId);
  const key = (...parts) => JSON.stringify(parts);
  const date = value => value ? new Date(value).toLocaleString() : "No saved capture";
  const active = () => host?.active();
  const fieldKey = (kind, journey = "", step = "") => key(kind, journey, step);
  const value = (kind, journey, step, fallback = "") => drafts.get(fieldKey(kind, journey, step)) ?? fallback;
  const esc = value => host.esc(value);
  const field = (kind, journey = "", step = "") => `data-company-field="${esc(fieldKey(kind, journey, step))}"`;

  function remember() {
    const node = document.activeElement;
    const focusedKey = node?.dataset.companyField || node?.dataset.companyFocus;
    focus = focusedKey && node.closest("[data-company]")
      ? {key:focusedKey,start:node.selectionStart,end:node.selectionEnd} : null;
    if(requestedFocus){focus={key:requestedFocus};requestedFocus=null;}
  }
  function mounted() {
    if (!active()) return;
    const region = host.root.querySelector("[data-company]");
    if (!region) return;
    if (focus) {
      // Backup IDs are arbitrary text: compare keys rather than interpolating selectors.
      const node = [...region.querySelectorAll("[data-company-field],[data-company-focus]")].find(n=>(n.dataset.companyField||n.dataset.companyFocus)===focus.key);
      if (node) {
        node.focus({preventScroll:true});
        if(typeof focus.start === "number" && node.setSelectionRange) {
          try {node.setSelectionRange(focus.start,focus.end);} catch {}
        }
      }
    }
    if(requestedJourney && model) {
      const journey=[...region.querySelectorAll("[data-company-journey]")].find(node=>node.dataset.companyJourney===requestedJourney);
      if(journey){requestedJourney=null;journey.scrollIntoView({block:"center"});journey.querySelector('[aria-label="Plan title"]')?.focus({preventScroll:true});}
    }
    if (!model && !loading && !error) refresh();
  }
  function deferRender(render) { return guard?.defer(render, "root") || false; }
  function paint() {
    if(!active())return;
    if(guard.defer(paint))return;
    const region=host.root.querySelector("[data-company]");
    if(!region)return;
    remember();
    // Replacing a focused control can emit blur; only the player's blur should save.
    painting=true;
    try {region.outerHTML=page();mounted();} finally {painting=false;}
  }
  function beginRender() { remember(); painting=true; }
  function endRender() { painting=false; }
  function invalidate(clear=false) {
    guard?.invalidate();requestedFocus=null;requestedJourney=null;
    generation++;read++;loading=false;pending.clear();model=null;signature="";error="";errorKind="";retry=null;focus=null;
    if(clear){drafts.clear();creating=false;}
  }
  async function refresh() {
    if(!active()||loading)return;
    const request=++read,token=generation,epoch=host.epoch();loading=true;
    try {
      const result=await host.api.companyBrief();
      if(!active()||token!==generation||request!==read||epoch!==host.epoch())return;
      const next=JSON.stringify(result),changed=next!==signature || errorKind==="read";
      model=result;signature=next;
      if(errorKind!=="mutation"){error="";errorKind="";retry=null;}
      if(changed)paint();
    } catch {
      if(!active()||token!==generation||request!==read)return;
      if(errorKind!=="mutation") {
        error="Your company could not be opened. Your plans are still saved locally.";errorKind="read";retry=()=>refresh();paint();
      }
    } finally {
      if(request===read&&token===generation){loading=false;if(!model&&!error&&active())refresh();}
    }
  }
  async function perform(action,submitted=[],onSaved) {
    const token=generation,actionKey=JSON.stringify(action);
    if(pending.has(actionKey))return;
    pending.set(actionKey,action);error="";errorKind="";retry=null;read++;loading=false;paint();
    try {
      const result=await host.mutate(action,()=>token===generation&&active());
      if(!result||token!==generation||!active())return;
      model=result;signature=JSON.stringify(result);
      for(const [name,sent] of submitted)if(drafts.get(name)===sent)drafts.delete(name);
      onSaved?.();
    } catch {
      if(token!==generation||!active())return;
      error="This edit could not be saved. Your draft is here; check it and try again.";
      errorKind="mutation";
      retry=()=>perform(action,submitted,onSaved);
    } finally {
      if(token===generation){pending.delete(actionKey);paint();}
    }
  }
  function characterOptions(selected,missing=false) {
    return `<option value="" ${!selected?"selected":""}>Unassigned · anyone</option>${missing?`<option value="${esc(selected)}" selected>Missing character · keep assignment</option>`:""}${(model?.characters||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===selected?"selected":""}>${esc(c.name)} · ${esc(c.className)}</option>`).join("")}`;
  }
  function stepRow(journey,step) {
    const warning=({orphan:"Assigned character is missing. Keep this history, or choose a character to make this a manual step.",unknown:"Saved tracking source is unavailable. Keep the step until a matching saved capture returns.","identity-mismatch":"The saved character identity changed. This quest is not tracking the current character.","build-mismatch":"The saved game build changed. This quest is not tracking the current build."})[step.tracking];
    return `<li class="company-step" data-company-step="${esc(step.id)}" data-journey-id="${esc(journey.id)}">
      <div class="company-step-main"><label class="company-tick"><input type="checkbox" data-company-done data-company-focus="${esc(fieldKey("done",journey.id,step.id))}" ${step.done?"checked":""} ${step.completion==="observed"?"disabled":""} aria-label="Manually complete ${esc(step.text)}"><span class="sr-only">Manual completion</span></label>
      <div class="company-step-copy">${step.quest?`<strong>${esc(step.text)}</strong>`:`<input aria-label="Step text" maxlength="300" value="${esc(value("text",journey.id,step.id,step.text))}" ${field("text",journey.id,step.id)} data-company-edit="text">`}
        <span class="company-source ${step.completion==="observed"?"observed":""}">${esc(step.sourceLabel)}</span>
        ${step.baselineSavedAt?`<small>Tracking starts from the saved capture · ${esc(date(step.baselineSavedAt))}</small>`:""}
        ${step.observed?`<small>${step.observed.historical?"Historical proof":"Saved completion"} · ${esc(date(step.observed.at))} · ${step.observed.via==="turn-in"?"saved turn-in":"saved completed quest history"} · build ${esc(step.observed.build)}</small>`:""}
        ${warning?`<p class="company-warning">${esc(warning)}</p>`:""}</div></div>
      <div class="company-step-tools"><label><span class="sr-only">Assigned character</span><select aria-label="Assigned character" data-company-assign data-company-focus="${esc(fieldKey("assignment",journey.id,step.id))}">${characterOptions(step.profileId,step.tracking==="orphan")}</select></label><button class="subtle company-remove" data-company-command="remove-step" aria-label="Remove ${esc(step.text)}">×</button></div>
      ${step.quest?'<small class="company-conversion">Changing character clears quest proof and makes this an unchecked manual step. To track another saved quest, remove this step and add that quest.</small>':""}</li>`;
  }
  function journeyCard(journey) {
    const selected=value("picker",journey.id,"",""),character=model.characters.find(c=>c.id===selected);
    const quests=character?.quests.items.filter(q=>q.trackable)||[],quest=value("quest",journey.id,"","");
    return `<article class="company-plan" data-company-journey="${esc(journey.id)}">
      <header><div><span class="eyebrow">SHARED JOURNEY · ${journey.steps.length} STEPS</span><input aria-label="Plan title" maxlength="100" value="${esc(value("title",journey.id,"",journey.title))}" ${field("title",journey.id)} data-company-edit="title"></div><button class="subtle" data-company-command="remove" data-company-focus="${esc(fieldKey("remove",journey.id))}" aria-label="Delete plan ${esc(journey.title)}">Delete plan</button><button class="subtle" data-company-share="${esc(journey.id)}" data-company-focus="${esc(fieldKey("share",journey.id))}" ${journey.steps.length?"":"disabled"}>Share plan</button></header>
      <ol class="company-checklist">${journey.steps.map(s=>stepRow(journey,s)).join("")||'<li class="company-empty-step">A clear page. Add your first note or saved quest below.</li>'}</ol>
      <div class="company-add"><form data-company-form="note"><label>Note step<input name="note" maxlength="300" required placeholder="A small next step…" value="${esc(value("note",journey.id,"",""))}" ${field("note",journey.id)}></label><button type="submit" ${saving("add-note",journey.id)?"disabled":""}>Add note</button></form>
      <form data-company-form="quest"><label>Saved character<select aria-label="Saved character" name="character" ${field("picker",journey.id)}>${characterOptions(selected)}</select></label><label>Saved quest<select aria-label="Saved quest" name="quest" ${field("quest",journey.id)} ${quests.length?"":"disabled"}><option value="">${quests.length?"Choose a saved quest":"No trackable saved quests"}</option>${quests.map(q=>`<option value="${q.id}" ${String(q.id)===quest?"selected":""}>${esc(q.title)}${q.ready?" · Ready to turn in":""}</option>`).join("")}</select></label><button type="submit" ${saving("add-quest",journey.id)||!quests.some(q=>String(q.id)===quest)?"disabled":""}>Track saved quest</button></form>
      <p>Quest tracking begins at the selected character’s saved capture. Newer saved evidence can confirm a turn-in. Ready means ready to turn in, not turned in.</p></div></article>`;
  }
  function characterCard(c) {
    return `<article class="company-character" data-faction="${esc((c.faction||"neutral").toLowerCase())}"><div class="company-character-art"><img src="${host.portrait(c.className)}" alt="">${["Alliance","Horde"].includes(c.faction)?`<img class="company-faction" src="../../assets/faction-${c.faction.toLowerCase()}.png" alt="${esc(c.faction)}">`:""}</div>
      <div class="company-character-body"><div class="eyebrow">LEVEL ${c.level} · ${esc(c.className)}</div><h3>${esc(c.name)}</h3><p>${esc(c.realm||"Realm not set")} · ${esc(c.faction||"Faction unknown")}</p>
      <div class="company-character-counts"><span><b>${c.quests.count??"—"}</b> Saved quests</span><span><b>${c.quests.ready??"—"}</b> Ready to turn in</span><span><b>${c.goals.pending}</b> Private goals</span></div>
      <div class="company-capture"><strong>${esc(c.source.label)}</strong><small>${esc(c.source.savedAt?date(c.source.savedAt):"No addon snapshot · manual planning available")}${c.source.freshness==="old"?" · Older than a day":c.source.freshness==="future"?" · Saved clock is ahead":""}</small><small>${c.quests.known?"Counts reflect this saved log.":"Quest log unknown · excluded from totals."}${c.bags?` · ${c.bags.free}/${c.bags.total} bag slots free`:""}${c.equipment?` · ${c.equipment.length} equipment slots observed`:""}</small></div>
      ${c.goals.previews.length?`<ul class="company-goals">${c.goals.previews.map(g=>`<li>${esc(g)}</li>`).join("")}</ul>`:""}
      <button data-company-open="${esc(c.id)}" aria-label="Open ${esc(c.name)} Adventure">Open Adventure <span aria-hidden="true">↗</span></button></div></article>`;
  }
  function roster() {
    if(!model)return "";
    const recommendation=model.recommendation;
    return `<section class="company-roster"><div class="company-section-head"><div><span class="eyebrow">EVERY CHARACTER HAS A STORY</span><h2>Your collected characters</h2></div><button class="subtle" data-nav="characters">Manage roster →</button></div>
      ${recommendation?`<p class="company-recommendation"><span>Worth a look</span> ${esc(model.characters.find(c=>c.id===recommendation.profileId)?.name||"Character")} · ${esc(recommendation.text)} Choose Open Adventure when you’re ready.</p>`:""}
      <div class="company-roster-grid">${model.characters.map(characterCard).join("")}</div>
      ${!model.characters.length?'<div class="company-empty"><div><h3>A company begins with one adventurer.</h3><p>Your shared plans work now. Add a manual character, or connect your game for saved quest choices.</p></div><button data-nav="characters">Add a character</button><button data-nav="game">Connect game</button></div>':""}
      <p class="company-footnote">Saved snapshots describe the last game save. Recommendations never change your active character or follow setting. You choose every action.</p></section>`;
  }
  function journeys() {
    return `<section class="company-journeys"><div class="company-section-head"><div><span class="eyebrow">MAKE ROOM FOR THE ADVENTURE</span><h2>Shared journeys</h2></div><span>Notes and checklists stay private.</span></div>${model?.journeys.length?model.journeys.map(journeyCard).join(""):'<div class="company-empty"><span aria-hidden="true">◇</span><div><h3>Your next adventure starts with a plan.</h3><p>Pick a checklist or write one small step. No game connection needed.</p></div><button data-company-command="create">Create your first plan</button></div>'}</section>`;
  }
  function createForm() {
    if(!creating)return "";
    return `<form class="company-create" data-company-form="create"><div><span class="eyebrow">YOUR NEXT CHAPTER</span><h2>A simple plan. Your pace.</h2><p>Start with a checklist, then make it your own.</p></div><label>Plan name<input name="title" maxlength="100" required placeholder="Tonight’s adventure" value="${esc(value("create-title","","",""))}" ${field("create-title")}></label><label>Starting checklist<select aria-label="Starting checklist" name="template" ${field("create-template")}><option value="blank" ${value("create-template","","","blank")==="blank"?"selected":""}>Blank plan</option><option value="quest-session" ${value("create-template","","","")==="quest-session"?"selected":""}>Quest session</option><option value="dungeon-prep" ${value("create-template","","","")==="dungeon-prep"?"selected":""}>Dungeon preparation</option></select></label><div class="actions"><button class="primary" type="submit" ${saving("create")?"disabled":""}>Save plan</button><button type="button" data-company-command="cancel">Cancel</button></div></form>`;
  }
  function page() {
    const totals=model?.totals,recommendation=model?.recommendation;
    const name=model?.characters.find(c=>c.id===recommendation?.profileId)?.name||"Character";
    return `<section data-company class="company-page"><header class="company-hero"><div class="company-hero-copy"><span class="eyebrow">ONE COMPANY. MANY ADVENTURES.</span><h1>Your adventure company.</h1><p>Keep your characters together.<br>Make a plan for the road ahead.</p><div class="actions"><button class="primary" data-company-command="create">Create plan <span aria-hidden="true">＋</span></button><span class="company-local">◈ Private · saved on this computer</span>${recommendation?`<button class="company-recommended-open" data-company-open="${esc(recommendation.profileId)}" aria-label="Open recommended ${esc(name)} Adventure">Worth a look · ${esc(name)} · Open Adventure ↗</button>`:""}</div></div><div class="company-hero-seal" aria-hidden="true"><img src="../../assets/crest.svg" alt=""><span>THE ROAD IS YOURS</span></div></header>
      ${error?`<div class="company-error" role="alert"><p>${esc(error)}</p><button data-company-command="retry">Retry</button></div>`:""}${createForm()}
      ${totals?`<div class="company-totals" aria-label="Collected character totals"><div><b>${totals.characters}</b><span>Collected characters</span></div><div><b>${totals.questLogsKnown ? totals.quests : "—"}</b><span>Quests in saved logs</span></div><div><b>${totals.questLogsKnown ? totals.ready : "—"}</b><span>Ready to turn in</span></div><div><b>${totals.goalsPending}</b><span>Private goals</span></div></div><p class="company-coverage">${totals.questLogsKnown} saved quest ${totals.questLogsKnown===1?"log":"logs"} observed · ${totals.questLogsUnknown} unknown/manual · collected characters only, never your full account.</p>`:`<p class="company-coverage">${error?"Offline planning is available. Create a plan or retry loading your company.":"Opening your saved company…"}</p>`}
      ${roster()}${journeys()}</section>`;
  }
  function context(node) {
    return {journeyId:node.closest("[data-company-journey]")?.dataset.companyJourney,stepId:node.closest("[data-company-step]")?.dataset.companyStep};
  }
  function init(options) {
    host=options;
    guard=InteractionGuard.create({root:host.root,active,painting:()=>painting});
    host.root.addEventListener("input",event=>{
      const node=event.target;if(node.dataset.companyField)drafts.set(node.dataset.companyField,node.value);
    });
    host.root.addEventListener("change",event=>{
      const node=event.target;if(!node.closest("[data-company]"))return;
      if(node.dataset.companyField)drafts.set(node.dataset.companyField,node.value);
      const {journeyId,stepId}=context(node);
      if(node.hasAttribute("data-company-done"))perform({type:"set-done",journeyId,stepId,done:node.checked});
      if(node.hasAttribute("data-company-assign"))perform({type:"edit-step",journeyId,stepId,profileId:node.value||null});
      if(node.name==="character"){drafts.delete(fieldKey("quest",journeyId));paint();}
      else if(node.name==="quest")paint();
    });
    host.root.addEventListener("focusout",event=>{
      const node=event.target;if(painting||!node.isConnected||!node.dataset.companyEdit)return;
      const {journeyId,stepId}=context(node),kind=node.dataset.companyEdit;
      const original=kind==="title"?model?.journeys.find(j=>j.id===journeyId)?.title:model?.journeys.find(j=>j.id===journeyId)?.steps.find(s=>s.id===stepId)?.text;
      if(node.value===original)return;
      const action=kind==="title"?{type:"rename",journeyId,title:node.value}:{type:"edit-step",journeyId,stepId,text:node.value};
      perform(action,[[node.dataset.companyField,node.value]]);
    });
    host.root.addEventListener("click",event=>{
      const button=event.target.closest("button");if(!button?.closest("[data-company]"))return;
      if(button.hasAttribute("data-company-open")){host.open(button.dataset.companyOpen);return;}
      const {journeyId,stepId}=context(button);
      switch(button.dataset.companyCommand){
        case "create":creating=true;requestedFocus=fieldKey("create-title");paint();break;
        case "cancel":creating=false;paint();break;
        case "retry":retry?.();break;
        case "remove":if(confirm("Delete this shared plan and all its steps?"))perform({type:"remove",journeyId});break;
        case "remove-step":perform({type:"remove-step",journeyId,stepId});break;
      }
    });
    host.root.addEventListener("submit",event=>{
      const form=event.target;if(!form.dataset.companyForm)return;event.preventDefault();
      const {journeyId}=context(form),data=new FormData(form);
      if(form.dataset.companyForm==="create"){
        const title=data.get("title"),template=data.get("template");
        perform({type:"create",title,template},[[fieldKey("create-title"),title],[fieldKey("create-template"),template]],()=>{creating=false;});
      }else if(form.dataset.companyForm==="note"){
        const text=data.get("note");perform({type:"add-note",journeyId,text},[[fieldKey("note",journeyId),text]]);
      }else if(form.dataset.companyForm==="quest"){
        const profileId=data.get("character"),questId=Number(data.get("quest"));
        perform({type:"add-quest",journeyId,profileId,questId},[[fieldKey("quest",journeyId),String(questId)]]);
      }
    });
  }
  return {init,page,mounted,beginRender,endRender,deferRender,invalidate,refresh,showJourney(id){invalidate();requestedJourney=id;}};
})();
