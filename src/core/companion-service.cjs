"use strict";
const v=require('./validation.cjs');
const {buildMemoryPrompt}=require('./memory.cjs');
const {scopeResponse}=require('./wow-policy.cjs');
const {ConversationSession}=require('./companion-conversation.cjs');
// These events cancel work/drafts without changing completed conversation ownership.
const SOFT_REASONS=new Set(['renderer-context','response-stop','memory-save']);
class CompanionService {
  constructor({store,context,requests,memory,ai,chatgpt,claude,knowledge,onReset=()=>{}}){
    Object.assign(this,{store,context,requests,memory,ai,chatgpt,claude,knowledge,onReset});
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
      const prepared=this.session.prepare({owner:{profileId,provider:selected,source:[profile?.source?.kind,profile?.source?.id],rootEpoch:this.rootEpoch},shareProfile:input.shareProfile,memoryIds,prompt:input.prompt,currentPrompt:augmented.prompt});
      const refusal=scopeResponse(input.prompt);
      if(refusal)return {text:refusal,kind:'scope',conversation:prepared.meta};
      const options={knowledge:this.knowledge.index(profile||{}),prompt:prepared.questionForEvidence};
      const context=this.ai.profileContext(state,profileId,input.shareProfile,options);
      const request={model:selected.model,prompt:prepared.composedPrompt,context,signal};
      let reply;
      if(selected.authMode==='subscription'&&input.provider!=='ollama'){
        if(input.provider==='openai')reply=await this.chatgpt.ask(request);
        else if(input.provider==='anthropic')reply=await this.claude.ask({...request,context:input.shareProfile?this.ai.approvedProfile(profile,options):undefined});
        else throw Error('Subscription inference is unavailable for this provider. Choose API mode explicitly if desired.');
      }else reply=await this.ai.ask({provider:input.provider,...selected,apiKey:this.store.getKey(input.provider),...request});
      if(signal.aborted)throw signal.reason;
      if(typeof reply!=='string'||!reply.trim()||reply.length>100000)throw Error('Provider response is invalid.');
      // Eligibility verifies the same current context before either main-owned commit.
      this.memory.complete(token,input.prompt,reply);
      if(!this.session.commit(prepared.token,{question:input.prompt,answer:reply,kind:'ai'}))throw Error('Provider response is no longer current.');
      return {text:reply,kind:'ai',conversation:prepared.meta};
    },{waitForSettlement:selected.authMode==='subscription'&&input.provider==='anthropic'});
  }
}
module.exports={CompanionService};
