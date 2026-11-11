"use strict";
const v=require('./validation.cjs');
const {buildMemoryPrompt}=require('./memory.cjs');
const {scopeResponse}=require('./wow-policy.cjs');
const {ConversationSession}=require('./companion-conversation.cjs');
const {resolveNpcLocation}=require('./npc-location.cjs');
const {uuid}=require('./memory-data.cjs');
const {createCompanionTools}=require('./companion-tools.cjs');
// These events cancel work/drafts without changing completed conversation ownership.
const SOFT_REASONS=new Set(['renderer-context','response-stop','memory-save']);
class CompanionService {
  constructor({store,context,requests,memory,ai,chatgpt,claude,knowledge,travel,npcReference,travelReference=null,vendorPack=null,acquisitionPack=null,lookups=true,live=null,onReset=()=>{}}){
    Object.assign(this,{store,context,requests,memory,ai,chatgpt,claude,knowledge,travel,npcReference,travelReference,vendorPack,acquisitionPack,lookups,live,onReset});
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
      const prepared=this.session.prepare({owner:this.owner(profileId),shareProfile:input.shareProfile,memoryIds,prompt:input.prompt,currentPrompt:augmented.prompt});
      if(prepared.meta.resetReason==='scope-change')this.travel?.clear();
      const refusal=scopeResponse(input.prompt);
      if(refusal){this.travel?.clear();return {text:refusal,kind:'scope',conversation:prepared.meta};}
      const npc=resolveNpcLocation(prepared.questionForEvidence,{profile,shareProfile:input.shareProfile,currentIndex:input.shareProfile?this.knowledge.index(profile||{}):null,historicalPack:this.npcReference});
      if(npc){
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,npc.text);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:npc.text,kind:'npc'}))throw Error('Provider response is no longer current.');
        this.travel?.clear();return {text:npc.text,kind:'npc',npc:npc.dto,conversation:prepared.meta};
      }
      const local=this.travel?.resolve(input.prompt,{profileId,shareProfile:input.shareProfile});
      if(local){
        if(signal.aborted)throw signal.reason;
        this.memory.complete(token,input.prompt,local.text);
        if(!this.session.commit(prepared.token,{question:input.prompt,answer:local.text,kind:'travel'}))throw Error('Provider response is no longer current.');
        return {text:local.text,kind:'travel',conversation:prepared.meta,travel:this.travel.commit(local)};
      }
      if(!selected.model)throw Error('Choose a model in Connections for AI questions. Local NPC locations and travel need no model.');
      const options={knowledge:this.knowledge.index(profile||{}),prompt:prepared.questionForEvidence,reportedLocation:prepared.reportedLocation};
      // Live frames count only when they carry the selected character's identity.
      const {identityHash}=require('./live-bridge.cjs');
      const expected=profile?.source?.kind==='wow-addon'?identityHash(profile.source.id):null;
      const liveStatusNow=()=>{if(!input.shareProfile||!this.live?.status)return null;const s=this.live.status();if(s?.frame&&expected!==null&&s.frame.characterHash&&s.frame.characterHash!==expected)return {...s,signal:'other-character',frame:null};if(s?.frame&&expected!==null&&!s.frame.characterHash)return {...s,frame:{...s.frame,identityUnverified:true}};return s;};
      const liveNow=()=>liveStatusNow()?.frame||null;
      const liveStatus=liveStatusNow(),liveFrame=liveStatus?.frame||null;
      let context=this.ai.profileContext(state,profileId,input.shareProfile,options);
      // The live link is a current game reading; it outranks the saved snapshot for position.
      if(liveFrame&&context)context+='\n\nLive game link (read from the game screen '+Math.round((liveFrame.ageMs||0)/1000)+'s ago; current, overrides savedLocation for position/level/target): '+JSON.stringify(require('./companion-tools.cjs').liveSummary(liveFrame));
      // Read-only local lookups (NPCs, quests, items, travel, character) the model may call.
      const tools=this.lookups?createCompanionTools({profile,shareProfile:input.shareProfile,knowledgeIndex:options.knowledge||this.knowledge.bundled||null,npcReference:this.npcReference,travelReference:this.travelReference,vendorPack:this.vendorPack,acquisitionPack:this.acquisitionPack,contextOptions:options,live:liveNow,liveStatus:liveStatusNow}):undefined;
      const request={model:selected.model,prompt:prepared.composedPrompt,context,signal,...(tools?{tools}:{})};
      let reply;
      if(selected.authMode==='subscription'&&input.provider!=='ollama'){
        if(input.provider==='openai')reply=await this.chatgpt.ask(request);
        else if(input.provider==='anthropic')reply=await this.claude.ask({...request,context:input.shareProfile?this.ai.approvedProfile(profile,options):undefined,live:liveFrame?require('./companion-tools.cjs').liveSummary(liveFrame):undefined});
        else throw Error('Subscription inference is unavailable for this provider. Choose API mode explicitly if desired.');
      }else reply=await this.ai.ask({provider:input.provider,...selected,apiKey:this.store.getKey(input.provider),...request});
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
