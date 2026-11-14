"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { validateReadiness } = require("../src/core/readiness.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const at = "2026-11-09T12:00:00.000Z";
const collection = items => ({ observedAt: at, complete: true, items });
const workshop = () => ({
  professions: collection([{ skillLineId: 171, professionId: 1, name: "Alchemy", rank: 20, maxRank: 75 }]),
  recipes: collection([{ id: 100, skillLineId: 171, name: "Synthetic potion", reagentsKnown: true, reagents: [{ itemId: 200, required: 3, name: "Herb" }], outputItemId: 300, outputMin: 1, outputMax: 2, canSkillUp: false }]),
  materials: { ...collection([{ itemId: 200, count: 2, name: "Herb" }]), scope: "bags-0-4" },
});
const contract = () => require("../src/core/preparation-data.cjs");
test("readiness accepts optional workshop without changing old schema1 snapshots", () => {
  const value = { bags: { free: 1, total: 16 }, workshop: workshop() };
  assert.deepEqual(validateReadiness(value), value);
  assert.equal(validateReadiness({}).workshop, undefined);
  const state = { ...defaultState(), profiles: [{ id: "p", name: "Example", realm: "Test", className: "Mage", notes: "", goals: [], level: 10, readiness: value }], activeProfileId: "p" };
  assert.deepEqual(validateState(state), state);
});
test("capture normalizes finite seconds and rejects workshop clocks newer than source save", () => {
  const value = workshop(), seconds = Date.parse(at) / 1000;
  for (const c of Object.values(value)) c.observedAt = seconds;
  const c = { id: "synthetic", name: "Example", realm: "Test", className: "Mage", level: 10, updatedAt: seconds, readiness: { workshop: value } };
  const raw = () => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: [c], activeId: c.id, observedAt: seconds }));
  assert.deepEqual(parseSavedVariables(raw()).characters[0].readiness.workshop, workshop());
  c.readiness.workshop.recipes.observedAt = seconds + 1;
  assert.throws(() => parseSavedVariables(raw()));
});
test("workshop is detached, unknown differs from known empty and partial observations", () => {
  const { validateWorkshop } = contract();
  assert.equal(validateWorkshop(undefined), undefined);
  assert.deepEqual(validateWorkshop({}), {});
  for (const complete of [true, false]) assert.deepEqual(validateWorkshop({ recipes: { ...collection([]), complete } }), { recipes: { ...collection([]), complete } });
  const input = workshop(), output = validateWorkshop(input); output.recipes.items[0].reagents[0].required = 99;
  assert.equal(input.recipes.items[0].reagents[0].required, 3);
});
test("strict workshop rejects unknown keys, malformed collections, booleans and dates", () => {
  const { validateWorkshop, normalizeWorkshopCapture } = contract();
  for (const bad of [null, [], { unknown: 1 }, { materials: { ...workshop().materials, bank: true } }, { professions: { ...collection([]), complete: 1 } }, { recipes: { ...collection([]), items: {} } }, { recipes: { ...collection([]), observedAt: 1794225600 } }, { recipes: { ...collection([]), observedAt: "2026-11-09T12:00:00Z" } }, { recipes: { ...collection([]), observedAt: "2026-02-30T12:00:00.000Z" } }, { materials: { ...workshop().materials, scope: "bank" } }]) assert.throws(() => validateWorkshop(bad));
  for (const bad of [NaN, Infinity, -Infinity, "2026-11-09T12:00:00Z", null]) assert.throws(() => normalizeWorkshopCapture({ recipes: { ...collection([]), observedAt: bad } }, at));
  assert.deepEqual(normalizeWorkshopCapture(workshop(), at), workshop());
  assert.deepEqual(normalizeWorkshopCapture(workshop(), Date.parse(at) / 1000), workshop());
  assert.throws(() => normalizeWorkshopCapture(workshop(), "bad"));
});
test("every ID/count/rank/output bound, name and actual boolean is strict", () => {
  const { validateWorkshop } = contract();
  const mutations = [
    w=>w.professions.items[0].rank=-1, w=>w.professions.items[0].maxRank=10001, w=>w.professions.items[0].rank=76,
    w=>w.recipes.items[0].id=0,w=>w.recipes.items[0].id=2147483648,w=>w.recipes.items[0].skillLineId=1.5,
    w=>w.professions.items[0].professionId=0,w=>w.professions.items[0].skillLineId=Infinity,
    w=>w.recipes.items[0].reagents[0].required=0,w=>w.recipes.items[0].reagents[0].required=100001,
    w=>w.recipes.items[0].reagents[0].itemId=0,w=>w.materials.items[0].count=0,w=>w.materials.items[0].count=1000001,
    w=>w.recipes.items[0].outputItemId=0,w=>w.recipes.items[0].outputMin=0,w=>w.recipes.items[0].outputMax=10001,w=>w.recipes.items[0].outputMin=3,
    w=>w.recipes.items[0].canSkillUp=1,w=>w.recipes.items[0].reagentsKnown="true",w=>w.recipes.items[0].reagentsKnown=false,
    w=>w.recipes.items[0].name=" ",w=>w.professions.items[0].name="x".repeat(201),w=>w.materials.items[0].name="bad\nname",w=>w.recipes.items[0].reagents[0].name="",
    w=>w.recipes.items[0].link="PRIVATE",w=>w.recipes.items[0].reagents[0].optional=true,w=>w.materials.items[0].tooltip="PRIVATE",
  ];
  for (const mutate of mutations) { const w = workshop(); mutate(w); assert.throws(() => validateWorkshop(w), mutate.toString()); }
  const w = workshop(); w.professions.items[0].rank=0;w.professions.items[0].maxRank=10000;w.recipes.items[0].reagents[0].required=100000;w.materials.items[0].count=1000000;w.recipes.items[0].id=2147483647;w.recipes.items[0].outputMin=10000;w.recipes.items[0].outputMax=10000;
  assert.deepEqual(validateWorkshop(w), w);
  for (const known of [true,false]) { const empty = workshop(); empty.recipes.items[0].reagentsKnown=known;empty.recipes.items[0].reagents=[];assert.deepEqual(validateWorkshop(empty),empty); }
});
test("collection limits and unique recipe/material/profession/reagent identifiers", () => {
  const { validateWorkshop } = contract();
  for (const [key,max,idKey] of [["professions",20,"skillLineId"],["recipes",100,"id"],["materials",256,"itemId"]]) {
    const w=workshop(), sample=w[key].items[0];w[key].items=Array.from({length:max},(_,i)=>({...sample,[idKey]:i+1,...(key === "professions" ? {professionId:i+1} : {})}));assert.doesNotThrow(()=>validateWorkshop(w));
    w[key].items.push({...sample,[idKey]:max+1,...(key === "professions" ? {professionId:max+1} : {})});assert.throws(()=>validateWorkshop(w));
    w[key].items=[sample,{...sample}];assert.throws(()=>validateWorkshop(w));
  }
  const w=workshop();w.recipes.items[0].reagents=Array.from({length:20},(_,i)=>({itemId:i+1,required:1}));assert.doesNotThrow(()=>validateWorkshop(w));w.recipes.items[0].reagents.push({itemId:21,required:1});assert.throws(()=>validateWorkshop(w));w.recipes.items[0].reagents=[{itemId:1,required:1},{itemId:1,required:2}];assert.throws(()=>validateWorkshop(w));
});
test("capture preserves strict malformed readiness rejection while normalizing only workshop dates",()=>{
 for(const readiness of [null,[],"bad",1,{workshop:null},{workshop:{},accessToken:"PRIVATE"}]){
  const c={id:"synthetic",name:"Example",realm:"Test",className:"Mage",level:10,updatedAt:1794225600,readiness};
  const raw="BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,characters:[c],activeId:c.id,observedAt:c.updatedAt}));
  assert.throws(()=>parseSavedVariables(raw));
 }
});
test("backups remain canonical and reject collection observations newer than an enclosing source",()=>{
 const p={id:"p",name:"Example",realm:"Test",className:"Mage",notes:"",goals:[],level:10,source:{kind:"wow-addon",id:"synthetic",updatedAt:at},readiness:{workshop:workshop()}};
 const s={...defaultState(),profiles:[p],activeProfileId:"p"};
 p.readiness.workshop.recipes.observedAt="2026-11-09T12:00:01.000Z";assert.throws(()=>validateState(s));
 p.readiness.workshop.recipes.observedAt=Date.parse(at)/1000;assert.throws(()=>validateState(s));
});
test("profession metadata cannot duplicate the same profession ID under another skill line",()=>{
 const w=workshop();w.professions.items.push({...w.professions.items[0],skillLineId:999});assert.throws(()=>contract().validateWorkshop(w));
});
test("optional skill-up colour is a strict enum consistent with canSkillUp; older saves stay valid", () => {
  const { validateWorkshop, DIFFICULTIES } = contract();
  assert.deepEqual(DIFFICULTIES, ["optimal", "medium", "easy", "trivial"]);
  const old = workshop();
  assert.equal(validateWorkshop(old).recipes.items[0].difficulty, undefined);
  for (const [difficulty, canSkillUp] of [["optimal", true], ["medium", true], ["easy", true], ["trivial", false], ["easy", undefined]]) {
    const value = workshop(), recipe = value.recipes.items[0];
    recipe.difficulty = difficulty; if (canSkillUp === undefined) delete recipe.canSkillUp; else recipe.canSkillUp = canSkillUp;
    assert.equal(validateWorkshop(value).recipes.items[0].difficulty, difficulty);
  }
  for (const [difficulty, canSkillUp] of [["orange", true], ["", true], [1, true], ["trivial", true], ["optimal", false], [null, false]]) {
    const value = workshop(); Object.assign(value.recipes.items[0], { difficulty, canSkillUp });
    assert.throws(() => validateWorkshop(value), `${difficulty}/${canSkillUp}`);
  }
});
