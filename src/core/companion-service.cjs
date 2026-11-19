"use strict";
const v=require('./validation.cjs');
const {buildMemoryPrompt}=require('./memory.cjs');
const {scopeResponse}=require('./wow-policy.cjs');
const {ConversationSession}=require('./companion-conversation.cjs');
const {resolveNpcLocation}=require('./npc-location.cjs');
const {uuid}=require('./memory-data.cjs');
const {createCompanionTools}=require('./companion-tools.cjs');
const {quickAnswer}=require('./quick-answers.cjs');
const {workshopQuestion,workshopAnswer}=require('./companion-workshop.cjs');
const {resolve:resolveIntent}=require('./companion-intents.cjs');
const {resolveTalentQuestion,talentBlock,talentQuickAnswer,TALENT_MAX}=require('./talent-context.cjs');
// Providers accept at most this much context text (ChatGPT subscription limit).
const CONTEXT_LIMIT=20000;
// These events cancel work/drafts without changing completed conversation ownership.
const SOFT_REASONS=new Set(['renderer-context','response-stop','memory-save']);
class CompanionService {
  constructor({store,context,requests,memory,ai,chatgpt,claude,knowledge,travel,npcReference,travelReference=null,vendorPack=null,acquisitionPack=null,lookups=true,live=null,advise=null,localAi=null,talents=null,planner=null,onReset=()=>{}}){
    // talents: { trees(className), build() } read from the player's own game client (never bundled).
    Object.assign(this,{store,context,requests,memory,ai,chatgpt,claude,knowledge,travel,npcReference,travelReference,vendorPack,acquisitionPack,lookups,live,advise,localAi,talents,planner,onReset});
    this.session=new ConversationSession();this.rootEpoch=0;
    context.subscribe(({reason})=>{
      if(SOFT_REASONS.has(reason))return;
      this.rootEpoch++;this.session.clear(reason);onReset(reason);
    });
  }
  clear(...args){
    if(args.length)throw Error('Invalid conversation clear request.');
    this.context.invalidate('clear');this.memory.clearDraft();
    return {usedTurns:0,omittedTurns:0,resetReason:'clear'};
  }
  async legacy(...args){return (await this.ask(...args)).text;}
  owner(profileId){const s=this.store.state,p=s.profiles.find(p=>p.id===profileId);return {profileId,provider:{...s.provider},source:[p?.source?.kind,p?.source?.id],rootEpoch:this.rootEpoch};}
  previewLocation(profileId,shareProfile,prompt,memoryIds=[]){
    if(typeof shareProfile!=='boolean'||typeof prompt!=='string'||prompt.length>12000||!Array.isArray(memoryIds)||memoryIds.length>5||new Set(memoryIds).size!==memoryIds.length)throw Error('Invalid location preview.');
    memoryIds.forEach(uuid);if(profileId!==this.store.state.activeProfileId)throw Error('Choose the current character.');
    return shareProfile?this.session.previewLocation({owner:this.owner(profileId),shareProfile,memoryIds,prompt}):null;
  }
  async ask(...args){
    if(args.length!==1)throw Error('Invalid provider request.');
    const input=args[0];v.object(input,['provider','prompt','profileId','shareProfile','memoryIds']);v.provider(input.provider);v.str(input.prompt,12000,false);
    if(typeof input.shareProfile!=='boolean'||input.provider!==this.store.state.provider.id)throw Error('Invalid provider selection.');
    const selected={...this.store.state.provider};
    return this.requests.run(async signal=>{
      const state=this.store.state,profileId=input.profileId===undefined?state.activeProfileId:input.profileId;
      const token=this.memory.begin(profileId),memoryIds=input.memoryIds===undefined?[]:input.memoryIds;
      const augmented=buildMemoryPrompt(state,{profileId,prompt:input.prompt,memoryIds});
      const profile=state.profiles.find(p=>p.id===profileId);
      const scope={owner:this.owner(profileId),shareProfile:input.shareProfile,memoryIds};
      const refusal=scopeResponse(input.prompt);
      // Saved Workshop questions stay local even with a model configured.
      const workshop=!refusal&&workshopQuestion(input.prompt);
      if(workshop){
        const conversation=this.session.skip(scope);
        const text=workshopAnswer(workshop,{state,profile,shareProfile:input.shareProfile,acquisitionPack:this.acquisitionPack});
        if(signal.aborted)throw signal.reason;
        // Do not make saved Workshop evidence eligible for later sharing via Memory.
        this.travel?.clear();return {text,kind:'quick',topic:'profession-materials',conversation};
      }
      const prepared=this.session.prepare({...scope,prompt:input.prompt,currentPrompt:augmented.prompt});
      if(prepared.meta.resetReason==='scope-change')this.travel?.clear();
      if(refusal){this.travel?.clear();return {text:refusal,kind:'scope',conversation:prepared.meta};}
      const finishQuick=({text,topic})=>{
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,text);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:text,kind:'quick'}))throw Error('Provider response is no longer current.');
        this.travel?.clear();return {text,kind:'quick',topic,conversation:prepared.meta};
      };
      // Talent questions: WoW Forever's own trees from the game client. A clear talent question wins over
      // NPC and travel matching ("Improved Renew only goes to 3/3" is not a trip).
      let talent=null;
      try{talent=this.talents?resolveTalentQuestion(prepared.questionForEvidence,{profile,shareProfile:input.shareProfile,source:this.talents,previousQuestion:this.session.turns.at(-1)?.question}):null;}catch{talent=null;}
      const talentFirst=Boolean(talent&&(talent.intent==='strong'||talent.talents?.length||talent.tabName||/\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(input.prompt)));
      if(talent&&(talent.status==='ask'||talent.status==='points')){
        // No class to answer for (ask, no AI call) or a pure points-per-level question: answered here.
        return finishQuick(talentQuickAnswer(talent));
      }
      // 0.58: understand the request and answer from WoW Forever's own data. With no model the answer
      // is returned as is; with a model its verified facts go into the model's context instead.
      let intents=null;
      if(!talentFirst){try{intents=resolveIntent(prepared.questionForEvidence,{profile,shareProfile:input.shareProfile});}catch{intents=null;}}
      const verified=intents&&(intents.answer||intents.facts?.length)&&intents.intent!=='quest-next'?intents:null;
      // The NPC answer wins when it finds the person; otherwise a better understood answer wins.
      const npcAll=talentFirst?null:resolveNpcLocation(prepared.questionForEvidence,{profile,shareProfile:input.shareProfile,currentIndex:input.shareProfile?this.knowledge.index(profile||{}):null,historicalPack:this.npcReference});
      const npc=npcAll&&(npcAll.dto?.status==='found'||!verified?.answer||['npc-location','lore','rp'].includes(verified.intent))?npcAll:null;
      if(npc){
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,npc.text);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:npc.text,kind:'npc'}))throw Error('Provider response is no longer current.');
        this.travel?.clear();return {text:npc.text,kind:'npc',npc:npc.dto,conversation:prepared.meta};
      }
      // A travel route or a follow-up to an open trip stays with the travel planner.
      const tripOpen=Boolean(this.travel?.trip?.pending);
      const localAll=talentFirst?null:this.travel?.resolve(input.prompt,{profileId,shareProfile:input.shareProfile});
      // The new answer only replaces a "where are you starting?" kind of clarification, or a trip
      // the planner misread (a flight master in a town is a person, not a trip).
      // A trip the planner fully recognized stays with it, even when it must ask (your faction, say).
      const kept=['route','unavailable','same-place'].includes(localAll?.dto?.status)||Boolean(localAll?.dto?.status==='clarify'&&localAll?.dto?.origin&&localAll?.dto?.destination);
      const local=localAll&&(kept||tripOpen||!verified?.answer)?localAll:null;
      if(local){
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,local.text);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:local.text,kind:'travel'}))throw Error('Provider response is no longer current.');
        return {text:local.text,kind:'travel',conversation:prepared.meta,travel:this.travel.commit(local)};
      }
      if(verified?.answer&&!selected.model){
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,verified.answer);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:verified.answer,kind:'intent'}))throw Error('Provider response is no longer current.');
        this.travel?.clear();return {text:verified.answer,kind:'intent',intent:verified.intent,conversation:prepared.meta};
      }
      const options={knowledge:this.knowledge.index(profile||{}),prompt:prepared.questionForEvidence,reportedLocation:prepared.reportedLocation};
      // Live frames count only when they carry the selected character's identity.
      const {liveKeyFor}=require('./live-bridge.cjs');
      const bound=profile?.source?.kind==='wow-addon',expected=bound?liveKeyFor(profile.source.id):null; // null: GUID not read yet, never matches
      const liveStatusNow=()=>{if(!input.shareProfile||!this.live?.status)return null;const s=this.live.status();if(s?.frame&&bound&&s.frame.characterHash&&s.frame.characterHash!==expected)return {...s,signal:'other-character',frame:null};if(s?.frame&&bound&&!s.frame.characterHash)return {...s,frame:{...s.frame,identityUnverified:true}};return s;};
      const liveNow=()=>liveStatusNow()?.frame||null;
      const liveStatus=liveStatusNow(),liveFrame=liveStatus?.frame||null;
      // No model chosen: answer the common questions locally (quest how-to, next steps, training).
      if(!selected.model){
        const tools=createCompanionTools({profile,shareProfile:input.shareProfile,knowledgeIndex:options.knowledge||this.knowledge.bundled||null,npcReference:this.npcReference,travelReference:this.travelReference,vendorPack:this.vendorPack,acquisitionPack:this.acquisitionPack,contextOptions:options,live:liveNow,liveStatus:liveStatusNow,planner:this.planner});
        const quick=quickAnswer(input.prompt,{tools,live:liveFrame,talent,advise:input.shareProfile&&this.advise?()=>this.advise(profileId):null});
        if(quick)return finishQuick(quick);
        throw Error('Choose a model in Connections for AI questions. Local NPC locations, travel, quest how-to, next steps, training and talents need no model.');
      }
      let context=this.ai.profileContext(state,profileId,input.shareProfile,options);
      // The live link is a current game reading; it outranks the saved snapshot for position.
      if(liveFrame&&context)context+='\n\nLive game link (read from the game screen '+Math.round((liveFrame.ageMs||0)/1000)+'s ago; current, overrides savedLocation for position/level/target): '+JSON.stringify(require('./companion-tools.cjs').liveSummary(liveFrame));
      // Bounded talent facts for this class, within what every transport accepts. The Claude
      // subscription transport takes them separately (its context is the approved profile record).
      const talentText=talent?talentBlock(talent,{maxChars:Math.max(1500,Math.min(TALENT_MAX,CONTEXT_LIMIT-(context||'').length-2))}):'';
      const claudeSubscription=selected.authMode==='subscription'&&input.provider==='anthropic';
      if(talentText&&!claudeSubscription)context=[context,talentText].filter(Boolean).join('\n\n');
      // Sharing off sends the model only the player's own text, so the facts stay out too.
      const factsText=input.shareProfile&&verified?.facts?.length?'Verified WoW Forever facts for this question:\n'+verified.facts.slice(0,8).map(f=>'- '+String(f).slice(0,400)).join('\n'):'';
      if(factsText&&!claudeSubscription)context=[factsText,context].filter(Boolean).join('\n\n');
      // Read-only local lookups (NPCs, quests, items, travel, character) the model may call.
      const tools=this.lookups?createCompanionTools({profile,shareProfile:input.shareProfile,knowledgeIndex:options.knowledge||this.knowledge.bundled||null,npcReference:this.npcReference,travelReference:this.travelReference,vendorPack:this.vendorPack,acquisitionPack:this.acquisitionPack,contextOptions:options,live:liveNow,liveStatus:liveStatusNow,planner:this.planner}):undefined;
      const request={model:selected.model,prompt:prepared.composedPrompt,context,signal,...(tools?{tools}:{})};
      let reply;
      if(selected.authMode==='subscription'&&input.provider!=='ollama'){
        if(input.provider==='openai')reply=await this.chatgpt.ask(request);
        else if(input.provider==='anthropic')reply=await this.claude.ask({...request,context:input.shareProfile?this.ai.approvedProfile(profile,options):undefined,live:liveFrame?require('./companion-tools.cjs').liveSummary(liveFrame):undefined,...(talentText||factsText?{talents:[factsText,talentText].filter(Boolean).join('\n\n')}:{})});
        else throw Error('Subscription inference is unavailable for this provider. Choose API mode explicitly if desired.');
      }else{
        // The built-in engine starts on first use (a few seconds) and stays up until the app closes.
        if(input.provider==='local'){if(!this.localAi)throw Error('The free AI is unavailable.');await this.localAi.start();}
        reply=await this.ai.ask({provider:input.provider,...selected,apiKey:this.store.getKey(input.provider),...request});
      }
      if(signal.aborted)throw signal.reason;
      if(typeof reply!=='string'||!reply.trim()||reply.length>100000)throw Error('Provider response is invalid.');
      // Eligibility verifies the same current context before either main-owned commit.
      this.memory.complete(token,input.prompt,reply);
      if(!this.session.commit(prepared.token,{question:input.prompt,answer:reply,kind:'ai'}))throw Error('Provider response is no longer current.');
      this.travel?.clear();
      const lookups=tools?tools.trace.filter(t=>t.summary).slice(0,10).map(t=>t.summary):[];
      return {text:reply,kind:'ai',conversation:prepared.meta,...(lookups.length?{lookups}:{})};
    },{waitForSettlement:selected.authMode==='subscription'&&input.provider==='anthropic'});
  }
}
module.exports={CompanionService};
