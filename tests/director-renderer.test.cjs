"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
function renderer() {
  const listeners={},root={addEventListener(type,fn){(listeners[type]??=[]).push(fn);},querySelectorAll:()=>[],querySelector:()=>null};
  const context={window:{},document:{addEventListener(){}},setTimeout,localStorage:{getItem:()=>null},console};
  vm.createContext(context);
  for(const [file,name] of [["interaction","InteractionGuard"],["command-center","CommandCenter"],["director","Director"]]){
    vm.runInContext(fs.readFileSync(require.resolve(`../src/renderer/${file}.js`),"utf8"),context);context[name]=context.window[name];
  }
  context.Director.init({root,esc:v=>String(v??"").replaceAll("<","&lt;"),active:()=>true,profileId:()=>"profile",options:()=>({minutes:30,focus:"balanced"})});
  return context;
}
test("Director keeps mention-only reference clues out of destination geometry",()=>{
  const c=renderer(),choice={title:"A public clue",reason:"Clue only",priority:3,questId:1,kind:"objectives",sourceKind:"reference-clue",distance:null,source:{},referenceDestination:{mapId:1,x:.2,y:.3,evidence:"mentioned-in-objective"}};
  const html=c.Director.panel({primary:choice,alternatives:[],session:{available:true}});
  assert.match(html,/location clue only; no destination confirmed/);assert.doesNotMatch(html,/20\.0%|Approximate community location/);
});
test("Explain whitelist omits Director private goals even when present beside steps",()=>{
  const c=renderer();const draft=c.CommandCenter.draft({steps:[{title:"Public quest",source:{observedAt:"now"}}],director:{privateGoals:[{text:"PRIVATE_SENTINEL"}]}},{minutes:30,focus:"balanced"});
  assert.match(draft,/Public quest/);assert.doesNotMatch(draft,/PRIVATE_SENTINEL|privateGoals/);
});
test("Director labels the exact public observation and provenance without overriding game destinations",()=>{
  const c=renderer(),choice={title:"Observed trail",reason:"Same map",kind:"objective",sourceKind:"reference",source:{},referenceDestination:{mapId:1,x:.2,y:.3,evidence:"observed-objective-gain",observedThrough:"2026-10-31"},knowledge:{provenance:{build:"1.15.8.64000",attribution:"Synthetic public observation"}}};
  const html=c.Director.panel({primary:choice,alternatives:[],session:{available:true}});
  assert.match(html,/Observed objective progress location/);assert.match(html,/2026-10-31/);assert.match(html,/Synthetic public observation/);
  choice.destination={mapId:2,x:.4,y:.5,text:"Current game marker"};choice.sourceKind="game-snapshot";
  const game=c.Director.panel({primary:choice,alternatives:[],session:{available:true}});
  assert.match(game,/Current game marker/);assert.doesNotMatch(game,/20\.0%|Observed objective progress location/);
});
test("Director disclosure identity includes profile, quest and disclosure kind",()=>{
  const c=renderer(),choice={questId:101,title:"Quest",sourceKind:"game-snapshot",source:{}};
  const html=c.Director.panel({primary:choice,alternatives:[],session:{available:true},privateGoals:[{text:"Local goal"}]});
  assert.ok(html.includes(`data-interaction-key='${JSON.stringify(["profile",101,"quest-evidence"])}'`) || html.includes(`data-interaction-key="${JSON.stringify(["profile",101,"quest-evidence"])}"`));
  assert.ok(html.includes(JSON.stringify(["profile","private-goals"])));
});
