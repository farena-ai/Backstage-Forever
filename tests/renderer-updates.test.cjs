"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function harness(overrides = {}) {
  const handlers = {}, documentHandlers = {}, timeouts = [];
  const automatic = {
    dataset: { updatePref: "automatic" },
    checked: true,
    matches: () => false,
    closest: () => null,
  };
  const installOnQuit = {
    dataset: { updatePref: "installOnQuit" },
    checked: true,
    matches: () => false,
    closest: () => null,
  };
  const summary = { textContent: "" };
  const label = { textContent: "" };
  const nodes = {
    "[data-update-summary]": summary,
    "[data-update-progress]": {},
    "[data-update-version]": {},
    '[data-command="install-update"]': {},
    '[data-command="check-updates"]': {},
  };
  const root = {
    addEventListener: (name, fn) => (handlers[name] ??= []).push(fn),
    querySelector: (selector) => select(selector)[0] || null,
    querySelectorAll: select,
  };
  const polls = [];
  function select(selector) {
    if (selector.includes("data-update-pref")) {
      if (selector.includes("installOnQuit")) return [installOnQuit];
      if (selector.includes("automatic")) return [automatic];
      return [automatic, installOnQuit];
    }
    if (selector === "[data-update-label]") return [label];
    return nodes[selector] ? [nodes[selector]] : [];
  }
  const context = vm.createContext({
    window: {
      backstage: { bootstrap: () => new Promise(() => {}), ...overrides },
    },
    document: {
      addEventListener: (name, fn) => (documentHandlers[name] ??= []).push(fn),
      body: { dataset: {} },
      hidden: false,
      getElementById: (id) => (id === "app" ? root : {}),
      querySelector: (selector) => select(selector)[0] || null,
      querySelectorAll: select,
    },
    setInterval: (fn) => {
      polls.push(fn);
      return polls.length;
    },
    setTimeout: fn => {timeouts.push(fn);return timeouts.length;},
    clearTimeout: () => {},
    crypto: {},
    console,
    structuredClone,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/renderer/quest-guide.js"), "utf8"),
    context,
  );
  context.QuestGuide = context.window.QuestGuide;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/living-setup.js"), "utf8"), context);
  context.LivingSetup = context.window.LivingSetup;
  for (const name of ["interaction", "command-center", "director"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/renderer/${name}.js`), "utf8"), context);
  }
  context.InteractionGuard = context.window.InteractionGuard;
  context.Director = context.window.Director;
  context.CommandCenter = context.window.CommandCenter;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/company.js"), "utf8"), context);
  context.Company = context.window.Company;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/preparation.js"), "utf8"), context);
  context.Preparation = context.window.Preparation;
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8"),
    context,
  );
  vm.runInContext("state = { onboarded: true };", context);
  return {
    context,
    handlers,
    documentHandlers,
    flushEvents: () => timeouts.splice(0).forEach(fn=>fn()),
    polls,
    automatic,
    installOnQuit,
    summary,
    poll: () => polls.forEach((fn) => fn()),
    change: (node, checked) => {
      node.checked = checked;
      return Promise.all(handlers.change.map((fn) => fn({ target: node })));
    },
    info: () =>
      JSON.parse(vm.runInContext("JSON.stringify(updateInfo)", context)),
  };
}

test("Company render deferral follows the current pointer and native-select lifecycle", () => {
  const h=harness();let rendered=0;
  vm.runInContext("state={onboarded:true,profiles:[]};page='company';setupOpen=false;",h.context);
  const input={dataset:{},tagName:"INPUT",isConnected:true,closest:()=>null,matches:()=>false};
  h.context.document.activeElement=input;
  const down=node=>h.handlers.pointerdown.forEach(fn=>fn({target:node,button:0}));
  const up=()=>h.documentHandlers.pointerup.forEach(fn=>fn({}));
  h.handlers.focusout.forEach(fn=>fn({target:input}));
  let transferred=0;
  assert.equal(h.context.Company.deferRender(()=>transferred++),true,"Keyboard focus transfer must finish before repaint");
  h.flushEvents();assert.equal(transferred,1);
  down(input);
  assert.equal(h.context.Company.deferRender(()=>rendered++),true);
  h.handlers.focusout.forEach(fn=>fn({target:input}));h.flushEvents();
  assert.equal(rendered,0,"Blur must not end an unfinished physical press");
  up();down(input);h.flushEvents();
  assert.equal(rendered,0,"An older pointerup task cannot unlock a newer press");
  assert.equal(h.context.Company.deferRender(()=>rendered++),true);
  up();h.flushEvents();assert.equal(rendered,1,"The latest pending root render flushes once after dispatch");
  const select={...input,tagName:"SELECT",hasAttribute:()=>false,closest:selector=>selector==="select"?select:null};
  h.context.document.activeElement=select;down(select);up();h.flushEvents();
  assert.equal(h.context.Company.deferRender(()=>rendered++),true,"Pointerup must keep an open native menu alive");
  h.handlers.keydown.forEach(fn=>fn({target:select,key:"Escape"}));h.flushEvents();
  assert.equal(rendered,2,"Native cancellation flushes the pending render");
  down(select);up();h.flushEvents();h.context.Company.deferRender(()=>rendered++);
  h.handlers.change.forEach(fn=>fn({target:select}));h.flushEvents();
  assert.equal(rendered,3,"Native selection completion flushes the pending render");
  down(input);h.context.Company.deferRender(()=>rendered++);h.context.Company.invalidate();
  up();h.flushEvents();assert.equal(rendered,3,"View invalidation drops obsolete deferred presentation");
});

test("accepted Company blur writes drain across view invalidation and cancelled replacements", async () => {
  for (const boundary of ["navigate", "select", "import", "reset", "open-character"]) {
    const held = deferred(), calls = [];
    let savedTitle = "Original";
    const h = harness({
      journeyAction: async input => {
        calls.push(input); savedTitle = input.title;
        return {state:{...vm.runInContext("state",h.context),journeys:[{id:"j",title:savedTitle,steps:[]}]},company:{characters:[],journeys:[],totals:{}}};
      },
      saveState: async edited => edited,
      importData: async () => null,
      resetData: async () => null,
    });
    h.context.heldQueue = held.promise;
    vm.runInContext(`state={onboarded:true,profiles:[{id:'p',name:'One',className:'Mage'},{id:'q',name:'Two',className:'Warrior'}],activeProfileId:'p',journeys:[{id:'j',title:'Original',steps:[]}]};page='company';setupOpen=false;autosaveQueue=heldQueue;render=()=>{};`,h.context);
    const title = {dataset:{companyField:JSON.stringify(["title","j",""]),companyEdit:"title"},value:`Accepted ${boundary}`,isConnected:true,
      closest:selector=>selector==="[data-company-journey]"?{dataset:{companyJourney:"j"}}:null,matches:()=>false};
    for(const fn of h.handlers.input)fn({target:title});
    for(const fn of h.handlers.focusout)fn({target:title});
    const queued = vm.runInContext("autosaveQueue",h.context);
    assert.equal(calls.length,0,"Blur must be accepted behind the held queue");
    let changing;
    if(boundary==="select") {
      const node={dataset:{},id:"active-character",value:"q",closest:()=>null,matches:()=>false};
      changing=Promise.all(h.handlers.change.map(fn=>fn({target:node})));
    } else if(boundary==="open-character") {
      const button={dataset:{companyOpen:"q"},hasAttribute:name=>name==="data-company-open",closest:selector=>selector==="button"?button:selector==="[data-company]"?{}:null};
      h.handlers.click.forEach(fn=>fn({target:button}));
    } else {
      const button={dataset:boundary==="navigate"?{nav:"adventure"}:{command:boundary},hasAttribute:()=>false,closest:selector=>selector==="button"?button:null};
      h.handlers.click.forEach(fn=>fn({target:button}));
    }
    held.resolve();await queued;await changing;
    for(let i=0;i<12;i++)await Promise.resolve();
    assert.equal(calls.length,1,`${boundary}: view lifetime must not cancel an accepted write`);
    assert.equal(savedTitle,`Accepted ${boundary}`);
    if(["select","open-character"].includes(boundary))assert.equal(vm.runInContext("state.activeProfileId",h.context),"q","Late write cannot undo selection");
  }
});

test("Company header responds to same-ID saved character and connection inputs, ignoring checkedAt-only polls", async () => {
  let snapshot;
  const h=harness({gameSnapshot:async()=>snapshot});
  vm.runInContext(`state={onboarded:true,profiles:[{id:'p',name:'One',level:31,className:'Mage',faction:'Alliance',source:{updatedAt:'2026-11-08T12:00:00.000Z'}},{id:'q',name:'Two',level:20}],activeProfileId:'p'};page='company';setupOpen=false;gameStatus={connected:true,runtime:{state:'not-running',checkedAt:'old'}};globalThis.headerRenders=0;render=()=>{headerRenders++};`,h.context);
  snapshot={state:structuredClone(vm.runInContext("state",h.context)),gameStatus:{connected:true,runtime:{state:"not-running",checkedAt:"new"}}};
  await h.polls[1]();assert.equal(vm.runInContext("headerRenders",h.context),0,"A runtime check clock alone stays quiet");
  snapshot=structuredClone(snapshot);
  snapshot.state.profiles[0]={...snapshot.state.profiles[0],name:"New One",level:32,className:"Warrior",faction:"Horde",source:{updatedAt:"2026-11-09T12:00:00.000Z"}};
  await h.polls[1]();assert.equal(vm.runInContext("headerRenders",h.context),1,"Same-ID character facts refresh header/theme");
  snapshot={...snapshot,state:structuredClone(snapshot.state)};snapshot.state.profiles[1].name="New selector option";
  await h.polls[1]();assert.equal(vm.runInContext("headerRenders",h.context),2,"Other selector option labels refresh");
  snapshot={...snapshot,gameStatus:{connected:false,runtime:{state:"not-running",checkedAt:"later"}}};
  await h.polls[1]();assert.equal(vm.runInContext("headerRenders",h.context),3,"Meaningful connection changes refresh");
});

test("a successful replacement generation still cancels obsolete queued Company work", async () => {
  const held=deferred(),calls=[];
  const h=harness({journeyAction:async input=>{calls.push(input);throw Error("Obsolete write reached main");}});
  h.context.heldQueue=held.promise;
  vm.runInContext(`state={onboarded:true,profiles:[],activeProfileId:null,journeys:[]};page='company';setupOpen=false;autosaveQueue=heldQueue;`,h.context);
  const node={dataset:{companyField:JSON.stringify(["title","old",""]),companyEdit:"title"},value:"Old replacement draft",isConnected:true,closest:s=>s==="[data-company-journey]"?{dataset:{companyJourney:"old"}}:null,matches:()=>false};
  h.handlers.input.forEach(fn=>fn({target:node}));h.handlers.focusout.forEach(fn=>fn({target:node}));
  const queued=vm.runInContext("autosaveQueue",h.context);
  vm.runInContext(`autosaveGeneration++;Company.invalidate(true);state={onboarded:true,profiles:[],activeProfileId:null,journeys:[]};`,h.context);
  held.resolve();await queued;
  assert.equal(calls.length,0,"Replacement cancellation is independent of view invalidation");
  assert.equal(vm.runInContext("state.journeys.length",h.context),0);
});

test("overlapping preference changes cannot silently re-enable automatic updates", async () => {
  const requests = [];
  const h = harness({
    setUpdatePreferences: (input) => {
      const wait = deferred();
      requests.push({ input: { ...input }, wait });
      return wait.promise;
    },
  });
  const first = h.change(h.automatic, false);
  const second = h.change(h.installOnQuit, false);
  assert.equal(requests[0].input.automatic, false);
  assert.equal(
    requests.some(({ input }) => input.automatic === true),
    false,
    "a second pending checkbox change must not restore stale automatic:true",
  );
  for (const { input, wait } of requests)
    wait.resolve({ ...input, phase: "disabled" });
  await Promise.all([first, second]);
  assert.equal(h.info().automatic, false);
  assert.equal(h.automatic.checked, h.info().automatic);
  assert.equal(h.installOnQuit.checked, h.info().installOnQuit);
});

test("a stale status poll cannot overwrite an acknowledged opt-out", async () => {
  const poll = deferred();
  let reads = 0;
  const save = deferred();
  const h = harness({
    updateStatus: () => {
      reads++;
      return poll.promise;
    },
    setUpdatePreferences: () => save.promise,
  });
  h.poll();
  assert.equal(reads, 1);
  const saving = h.change(h.automatic, false);
  save.resolve({ automatic: false, installOnQuit: true, phase: "disabled" });
  await saving;
  poll.resolve({ automatic: true, installOnQuit: true, phase: "idle" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.info().automatic, false);
  assert.equal(h.automatic.checked, false);
});

test("manual update checks report their actual phase when automatic checks are off", () => {
  const h = harness();
  for (const [phase, expected] of [
    ["checking", /checking/i],
    ["downloading", /download/i],
    ["ready", /ready/i],
    ["error", /fixture verification failure/i],
  ]) {
    vm.runInContext(
      `updateInfo = { automatic: false, installOnQuit: false, phase: ${JSON.stringify(phase)}, message: "Fixture verification failure" }; refreshUpdateWidgets();`,
      h.context,
    );
    assert.match(
      h.summary.textContent,
      expected,
      `${phase} feedback should not be masked by automatic opt-out`,
    );
  }
});

test("a failed newer download remains visible beside the older ready installer", () => {
  const h = harness();
  vm.runInContext(
    'updateInfo = { phase: "ready", readyVersion: "0.4.0", availableVersion: "0.5.0", message: "The update download was interrupted. Retry, or use the Releases page." }; refreshUpdateWidgets();',
    h.context,
  );
  assert.match(h.summary.textContent, /interrupted/);
  assert.match(h.summary.textContent, /0\.4\.0.*ready/i);
  assert.equal(
    vm.runInContext(
      "document.querySelector('[data-command=\"check-updates\"]').textContent",
      h.context,
    ),
    "Retry update",
  );
  assert.match(
    vm.runInContext("updatesPage()", h.context),
    /data-link="releases"/,
  );
});


test("accepted Director work drains across navigation, new-character and replacement lifecycles without stale painting", async () => {
  for (const boundary of ["navigate", "select", "new-character", "import", "reset"]) {
    const held=deferred(),calls=[];
    const replacement={onboarded:true,profiles:[{id:"p",name:"Replacement"}],activeProfileId:"p",journeys:[],provider:{id:"ollama",model:""}};
    const h=harness({
      startDirectorSession:async(id,options)=>{calls.push({id,options});return {state:{...vm.runInContext("state",h.context),journeys:[{id:"saved-session"}]},journeyId:"saved-session",created:true};},
      saveState:async state=>state,importData:async()=>replacement,resetData:async()=>({...replacement,onboarded:false,profiles:[],activeProfileId:null}),
      gameStatus:async()=>({}),subscriptionStatus:async()=>({}),
    });
    h.context.heldQueue=held.promise;
    vm.runInContext(`state={onboarded:true,profiles:[{id:'p',name:'One'},{id:'q',name:'Two'}],activeProfileId:'p',journeys:[],provider:{id:'ollama',model:''}};page='adventure';setupOpen=false;guidanceProfileId='p';guidance={director:{session:{available:true}}};autosaveQueue=heldQueue;render=()=>{};`,h.context);
    const start={dataset:{},hasAttribute:name=>name==="data-director-start",closest:selector=>selector==="[data-director-start]"||selector==="button"?start:null};
    h.handlers.click.forEach(fn=>fn({target:start}));
    const accepted=vm.runInContext("autosaveQueue",h.context);assert.equal(calls.length,0);
    let changing;
    if(boundary==="select"){
      const select={id:"active-character",dataset:{},value:"q",closest:()=>null,matches:()=>false};changing=Promise.all(h.handlers.change.map(fn=>fn({target:select})));
    }else{
      const button={dataset:boundary==="navigate"?{nav:"guide"}:{command:boundary},hasAttribute:()=>false,closest:selector=>selector==="button"?button:null};h.handlers.click.forEach(fn=>fn({target:button}));
    }
    held.resolve();await accepted;await changing;for(let i=0;i<30;i++)await Promise.resolve();
    assert.equal(calls.length,1,`${boundary}: accepted session must reach the owner queue once`);
    assert.notEqual(vm.runInContext("page",h.context),"company",`${boundary}: stale session cannot navigate back`);
    if(boundary==="select")assert.equal(vm.runInContext("state.activeProfileId",h.context),"q");
    if(boundary==="new-character")assert.equal(vm.runInContext("state.activeProfileId",h.context),null);
    if(boundary==="import")assert.equal(vm.runInContext("state.profiles[0].name",h.context),"Replacement");
    if(boundary==="reset")assert.equal(vm.runInContext("state.profiles.length",h.context),0);
  }
});


test("a changed saved active character clears the previous Director pending presentation", async()=>{
  const held=deferred(),h=harness({startDirectorSession:()=>held.promise});
  vm.runInContext(`state={onboarded:true,profiles:[{id:'p'},{id:'q'}],activeProfileId:'p'};page='adventure';setupOpen=false;guidanceProfileId='p';guidance={director:{session:{available:true}}};render=()=>{};`,h.context);
  const start={dataset:{},hasAttribute:name=>name==="data-director-start",closest:selector=>selector==="[data-director-start]"||selector==="button"?start:null};
  h.handlers.click.forEach(fn=>fn({target:start}));await Promise.resolve();
  vm.runInContext(`state.activeProfileId='q';acceptBrief({briefProfileId:'q',brief:{guidance:{steps:[]},director:{session:{available:true}}}});`,h.context);
  const html=vm.runInContext("Director.panel(guidance.director)",h.context);
  assert.doesNotMatch(html,/Saving quest session/);
  held.resolve({state:{profiles:[{id:'p'}],activeProfileId:'p'},journeyId:'obsolete',created:true});
  await vm.runInContext("autosaveQueue",h.context);assert.equal(vm.runInContext("state.activeProfileId",h.context),'q');
});
test('a saved active-character replacement clears queued Preparation pending presentation',async()=>{
 const queue=deferred(),snapshot={onboarded:true,profiles:[{id:'p',name:'One'},{id:'q',name:'Two'}],activeProfileId:'q',provider:{id:'ollama',model:''}},m={character:{id:'p',name:'One'},selection:{recipeId:100,crafts:1},selectedRecipe:{id:100,name:'Formula'},planning:{checklistAvailable:true},recipes:[],shoppingRows:[],otherCharacters:[]};
 const h=harness({gameSnapshot:async()=>({state:snapshot}),preparationBrief:async id=>({...m,character:{id,name:id}}),createPreparationJourney:async()=>({state:snapshot,journeyId:'saved'})});h.context.heldQueue=queue.promise;
 vm.runInContext(`state={onboarded:true,profiles:[{id:'p',name:'One'},{id:'q',name:'Two'}],activeProfileId:'p',provider:{id:'ollama',model:''}};page='preparation';setupOpen=false;render=()=>{};autosaveQueue=heldQueue;Preparation.refresh();`,h.context);for(let i=0;i<5;i++)await Promise.resolve();
 const button={dataset:{},hasAttribute:name=>name==='data-preparation-add',closest:selector=>selector==='[data-preparation-add]'||selector==='button'?button:null};h.handlers.click.forEach(fn=>fn({target:button}));assert.match(vm.runInContext('Preparation.page()',h.context),/Saving shopping checklist/);
 await h.polls.at(-1)();assert.doesNotMatch(vm.runInContext('Preparation.page()',h.context),/Saving shopping checklist/);queue.resolve();await vm.runInContext('autosaveQueue',h.context);assert.equal(vm.runInContext('state.activeProfileId',h.context),'q');
});
