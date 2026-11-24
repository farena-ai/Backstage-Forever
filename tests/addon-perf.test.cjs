"use strict";
// 1.26 (roadmap F8): /bf perf on times each module's event handler and holds it against a budget.
// Off means the handlers are the modules' own functions, untouched.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const PERF = "dofile('addon/BackstageForever/BackstageForeverPerf.lua')\n";
// Frames with a script slot, a clock that moves only when a handler says so.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local function frame() local f={scripts={}} f.SetScript=function(self,k,fn) self.scripts[k]=fn end f.GetScript=function(self,k) return self.scripts[k] end f.RegisterEvent=function() end return f end
local frames={} CreateFrame=function() local f=frame() frames[#frames+1]=f return f end
local ms=0 debugprofilestop=function() return ms end
local combat=false InCombatLockdown=function() return combat end
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
`;

test("the numbers: events and time per module, a budget each, the slowest first", () => lua(PERF + String.raw`
local A,O,L,B=BackstageForeverPerfAdd,BackstageForeverPerfOver,BackstageForeverPerfLines,BackstageForeverPerfBudgetFor
local s={}
A(s,'HUD',2) A(s,'HUD',4) A(s,'Guild',.5) A(s,'Guild',nil) A(s,'Guild',-1) A(s,'Guild',0/0) A(s,5,1) A(nil,'x',1)
assert(s.HUD.events==2 and s.HUD.ms==6 and s.HUD.worst==4 and s.Guild.events==4 and s.Guild.ms==.5 and s.Guild.worst==.5 and s[5]==nil)
local budget={default=2,HUD=1,Route=3}
assert(B('HUD',budget)==1 and B('Guild',budget)==2 and B('Route2',budget)==3 and B('Options2',budget)==2,'a second frame of a module shares its budget')
local over=O(s,budget) assert(#over==1 and over[1].name=='HUD' and over[1].each==3 and over[1].budget==1)
assert(#O({},budget)==0 and #O(nil,budget)==0 and #O({X={events=0,ms=50}},budget)==0)
local lines=L(s,budget)
assert(#lines==3 and lines[1]=='Timed 6 events in 2 modules: 6.5 ms in all.',lines[1])
assert(lines[2]=='  HUD: 2, 6.0 ms, 3.00 ms each, slowest 4.0 ms - over its budget of 1.0 ms each',lines[2])
assert(lines[3]=='  Guild: 4, 0.5 ms, 0.13 ms each, slowest 0.5 ms',lines[3])
local many={} for i=1,15 do A(many,'M'..string.char(64+i),i) end
lines=L(many,budget,10) assert(#lines==12 and lines[2]:find('MO: 1, 15.0 ms',1,true) and lines[12]=='  and 5 more.')
assert(L({},budget)[1]:find('No events timed yet',1,true))
-- The shipped budget: a default and a positive number for every named module.
local shipped=BackstageForeverPerfBudget
assert(type(shipped.default)=='number' and shipped.default>0)
for name,value in pairs(shipped) do assert(type(name)=='string' and type(value)=='number' and value>0 and value<=50,name) end
`));

test("on wraps each registered handler, off puts the original back, and off costs nothing", () => lua(STUBS + PERF + String.raw`
local calls={}
local a,b=frame(),frame()
local handlerA=function(self,event,x) calls[#calls+1]='a:'..event..':'..tostring(x) ms=ms+3 end
local handlerB=function(self,event) calls[#calls+1]='b:'..event ms=ms+.5 end
assert(BackstageForeverPerfFrame('Alpha',a)==true and BackstageForeverPerfFrame('Beta',b)==true)
a:SetScript('OnEvent',handlerA) b:SetScript('OnEvent',handlerB)
assert(BackstageForeverPerfFrame('',a)==false and BackstageForeverPerfFrame('X','not a frame')==false and BackstageForeverPerfFrame(nil,a)==false)
assert(table.concat(BackstageForeverPerfModules(),',')=='Alpha,Beta')
-- Off: the handlers are the modules' own functions.
assert(BackstageForeverPerfOn()==false and a:GetScript('OnEvent')==handlerA and b:GetScript('OnEvent')==handlerB)
a.scripts.OnEvent(a,'E1',7) assert(next(BackstageForeverPerfStats)==nil,'nothing is counted while off')
-- On: every handler still runs with the same arguments, and is timed.
BackstageForeverPerfCommand=nil
assert(BackstageForeverPerfModuleCommand('perf on')==true and last():find('Timing is on for 2 event handlers',1,true),last())
assert(BackstageForeverPerfSettings.on==true and a:GetScript('OnEvent')~=handlerA)
a.scripts.OnEvent(a,'E2',8) a.scripts.OnEvent(a,'E3',9) b.scripts.OnEvent(b,'E4')
assert(table.concat(calls,' ')=='a:E1:7 a:E2:8 a:E3:9 b:E4',table.concat(calls,' '))
local s=BackstageForeverPerfStats
assert(s.Alpha.events==2 and s.Alpha.ms==6 and s.Alpha.worst==3 and s.Beta.events==1 and s.Beta.ms==.5)
-- An error in a handler reaches the game as before.
local c=frame() BackstageForeverPerfFrame('Gamma',c) c:SetScript('OnEvent',function() error('boom') end)
for _,fn in ipairs(timers) do fn() end
assert(not pcall(c.scripts.OnEvent,c,'E5'),'errors are not swallowed')
-- /bf perf prints the modules, the one over budget marked.
said={} BackstageForeverPerfModuleCommand('perf')
assert(said[1]:find('Timed 3 events in 2 modules',1,true) and said[2]:find('Alpha: 2, 6.0 ms, 3.00 ms each',1,true) and said[2]:find('over its budget of 2.0 ms each',1,true),said[2])
assert(not said[3]:find('over its budget',1,true))
-- A module that swapped its handler while timing was on keeps the new one after off.
local newer=function() end b:SetScript('OnEvent',newer)
combat=true BackstageForeverPerfModuleCommand('perf off') assert(last():find('outside combat',1,true) and BackstageForeverPerfOn()==true) combat=false
BackstageForeverPerfModuleCommand('perf off')
assert(BackstageForeverPerfOn()==false and BackstageForeverPerfSettings.on==false and a:GetScript('OnEvent')==handlerA and b:GetScript('OnEvent')==newer,'the originals are back')
said={} assert(BackstageForeverPerfModuleCommand('perf')==false and said[1]:find('Module timing is off',1,true))
-- Switching on again starts from zero.
BackstageForeverPerfModuleCommand('perf on') assert(next(BackstageForeverPerfStats)==nil)
BackstageForeverPerfModuleCommand('perf off')
-- No clock in the client: events are still counted, and nothing breaks.
debugprofilestop=nil BackstageForeverPerfSet(true) a.scripts.OnEvent(a,'E6',1)
assert(BackstageForeverPerfStats.Alpha.events==1 and BackstageForeverPerfStats.Alpha.ms==0) BackstageForeverPerfSet(false)
`));

test("a saved 'on' wraps the modules at login before their own login work; /bf perf shows memory then modules", () => lua(STUBS + PERF + String.raw`
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local own=frames[1]
local m=frame() BackstageForeverPerfFrame('Mod',m) m:SetScript('OnEvent',function() ms=ms+1 end)
own.scripts.OnEvent(own,'PLAYER_LOGIN') assert(BackstageForeverPerfOn()==false,'off unless saved on')
BackstageForeverPerfSettings={on=true}
own.scripts.OnEvent(own,'PLAYER_LOGIN') assert(BackstageForeverPerfOn()==true)
m.scripts.OnEvent(m,'PLAYER_LOGIN') assert(BackstageForeverPerfStats.Mod.events==1)
UpdateAddOnMemoryUsage=function() end GetAddOnMemoryUsage=function() return 2048 end GetTime=function() return 10 end
said={} BackstageForeverPerfCommand('perf')
assert(said[1]=='Backstage Forever: Memory in use: 2.0 MB.' and said[2]:find('Timed 1 events in 1 modules',1,true),said[2])
said={} BackstageForeverPerfCommand('perf off') assert(#said==1 and said[1]:find('Timing is off',1,true) and BackstageForeverPerfOn()==false)
said={} BackstageForeverPerfCommand('perf') assert(said[1]:find('Memory in use',1,true) and said[2]:find('Module timing is off',1,true))
`));

test("every module with an event handler registers with the readout, and every budget names a real module", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  assert.equal(toc[1], "BackstageForeverPerf.lua", "loaded right after the locale, before every module with a frame");
  const names = new Set();
  for (const file of toc) {
    if (file === "BackstageForeverPerf.lua") continue;
    const source = read("addon/BackstageForever/" + file);
    // Whole-line handler setups (the hide-on-combat one-liners inside window builders are left alone).
    const setups = source.split(/\r?\n/).filter((l) => /^\s*(pcall\((\w+)\.SetScript,\2,'OnEvent',|\w+:SetScript\('OnEvent',)/.test(l)).length;
    const registered = [...source.matchAll(/pcall\(BackstageForeverPerfFrame,'(\w+)',\w+\)/g)].map((m) => m[1]);
    assert.equal(registered.length, setups, `${file}: every event handler is registered`);
    for (const name of registered) { assert.ok(!names.has(name), `${name} is used once`); names.add(name); }
  }
  assert.ok(names.size >= 45, `registered: ${names.size}`);
  const perf = read("addon/BackstageForever/BackstageForeverPerf.lua");
  const budget = perf.match(/local BUDGET=\{([^}]*)\}/)[1].split(",").map((p) => p.split("=")[0]);
  assert.equal(budget[0], "default");
  for (const name of budget.slice(1)) assert.ok(names.has(name), `budget for ${name} names a registered module`);
  assert.doesNotMatch(perf, /hooksecurefunc|_G\[|setfenv/, "only frames handed over by the addon's own modules are touched");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /word=='perf' then\s+if type\(BackstageForeverPerfCommand\)=='function' then pcall\(BackstageForeverPerfCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /^## SavedVariablesPerCharacter:.*\bBackstageForeverPerfSettings\b/m);
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverPerf.lua"));
});
