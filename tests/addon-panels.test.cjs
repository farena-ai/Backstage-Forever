"use strict";
// 1.24: the quest list by distance (/bf tracker) and the dungeon run panel (/bf run).
// Pure functions first, then the thin frame code with a stubbed game.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverPanels.lua')\n";

test("quest stops: every quest of the log with the spot the plan would use, and nothing from another patch", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local spot={approximate=true,evidence='observed-objective-gain',mapId=1413,x=.5,y=.5}
BackstageForeverReference={schemaVersion=1,build='1.60.1.71037',locale='enUS',license='CC BY 4.0',attribution='Data from a source',
  sourceCommit=('a'):rep(40),quests={
  [10]={title='Reference kill',objectives={{index=1,type='monster',required=8,destination=spot}}},
  [11]={title='Reference hand-in',turnIn={approximate=true,evidence='observed-turn-in-npc',kind='npc',mapId=1412,name='Bob',x=.2,y=.25}},
  [12]={title='Only a mention',mention={approximate=true,evidence='mentioned-in-objective',kind='npc',mapId=1412,name='Ann',x=.3,y=.3}},
}}
local function log(build)
  return {clientBuild=build,locale='enUS',level=12,quests={
    {id=1,title='Game marker',complete=false,level=12,zone='Durotar',objectives={{text='Boars slain: 1/8',done=false}},destination={mapId=1411,x=.41237,y=.6}},
    {id=10,title='Reference kill',complete=false,level=14,zone='The Barrens',objectives={{text='Raptors slain: 0/8',done=false,type='monster',required=8}}},
    {id=11,title='Reference hand-in',complete=true,level=9,zone='Mulgore',objectives={}},
    {id=12,title='Only a mention',complete=false,level=10,zone='Mulgore',objectives={{text='Speak with Ann',done=false,type='event'}}},
    {id=13,title='Nothing known',complete=false,zone='Mulgore',objectives={}},
    {id=1,title='Game marker',complete=false,objectives={}},
    'not a quest',
  }}
end
local stops=BackstageForeverQuestStops(log('1.60.1.71037'))
assert(#stops==5,'one row per quest, the repeat and the junk row dropped: '..#stops)
local by={} for _,s in ipairs(stops) do by[s.questId]=s end
assert(by[1].destination.mapId==1411 and by[1].destination.x==.4124 and by[1].source=='game' and by[1].ready==false and by[1].level==12 and by[1].zone=='Durotar')
assert(by[10].destination.mapId==1413 and by[10].source=='reference')
assert(by[11].ready==true and by[11].destination.mapId==1412 and by[11].destination.y==.25)
assert(by[12].destination==nil and by[12].source==nil,'a mentioned NPC is a clue, never a stop')
assert(by[13].destination==nil and by[13].level==nil)
-- Another build of the same patch still uses the reference; another patch does not.
assert(BackstageForeverQuestStops(log('1.60.1.70888'))[2].destination.mapId==1413)
local other=BackstageForeverQuestStops(log('1.60.2.1'))
assert(other[1].destination.mapId==1411 and other[2].destination==nil and other[3].destination==nil,'the game marker stays, the reference is refused')
assert(BackstageForeverQuestStops({})==nil and BackstageForeverQuestStops(nil)==nil,'an unreadable log is nil, not empty')
`));

test("level colour and distance: yards across maps when the world position is known, honest words otherwise", () => lua(FILE + String.raw`
local C=BackstageForeverQuestColor
assert(C(25,20)=='red' and C(23,20)=='orange' and C(22,20)=='yellow' and C(18,20)=='yellow' and C(17,20)=='green' and C(13,20)=='grey')
assert(C(14,20)=='green' and C(3,5)=='yellow' and C(1,60)=='grey' and C(nil,20)==nil and C(20,nil)==nil and C(0,20)==nil)
local D=BackstageForeverTrackerDistance
local here={mapId=1413,x=.5,y=.5,size={width=1000,height=2000}}
local d,kind=D(here,{mapId=1413,x=.6,y=.5}) assert(kind=='yards' and math.abs(d-100)<.001)
d,kind=D(here,{mapId=1413,x=.5,y=.6}) assert(kind=='yards' and math.abs(d-200)<.001)
d,kind=D({mapId=1413,x=.5,y=.5},{mapId=1413,x=.8,y=.9}) assert(kind=='map' and math.abs(d-.5)<.001,'no map size: a fraction of the map')
d,kind=D(here,{mapId=1411,x=.5,y=.5}) assert(d==nil and kind=='far')
d,kind=D(here,nil) assert(d==nil and kind=='none')
d,kind=D(here,{mapId=1413,x=2,y=.5}) assert(kind=='none')
d,kind=D(nil,{mapId=1413,x=.5,y=.5}) assert(kind=='far')
d,kind=D({mapId=1413},{mapId=1413,x=.5,y=.5}) assert(kind=='far','your position is not known')
-- World positions on the same continent measure across zone borders; another continent does not.
local w={mapId=1413,x=.5,y=.5,world={instance=1,x=100,y=100}}
d,kind=D(w,{mapId=1411,x=.1,y=.1,world={instance=1,x=400,y=500}}) assert(kind=='yards' and d==500)
d,kind=D(w,{mapId=1429,x=.1,y=.1,world={instance=0,x=400,y=500}}) assert(kind=='far')
local Tx=BackstageForeverTrackerDistanceText
assert(Tx(84.6,'yards')=='85 yd' and Tx(.4,'map')=='on this map' and Tx(nil,'far')=='elsewhere' and Tx(nil,'none')=='not known')
`));

test("the list: nearest zone first, nearest quest first inside it, Ready marked, marks beside the colour, never more lines than fit", () => lua(FILE + String.raw`
local here={mapId=1413,x=.5,y=.5,size={width=1000,height=1000}}
local stops={
  {questId=1,title='Far in the Barrens',level=14,zone='The Barrens',destination={mapId=1413,x=.9,y=.5}},
  {questId=2,title='Near in the Barrens',level=12,zone='The Barrens',ready=true,destination={mapId=1413,x=.55,y=.5}},
  {questId=3,title='Durotar errand',level=6,zone='Durotar',destination={mapId=1411,x=.5,y=.5}},
  {questId=4,title='No spot',level=30,zone='Durotar'},
  {questId=5,title='Nearest of all',level=17,zone='Stonetalon',destination={mapId=1413,x=.5,y=.51}},
  {questId=6,title='Loose quest',level=12,destination={mapId=1413,x=.5,y=.7}},
  'junk',
}
local groups=BackstageForeverTrackerGroups(stops,here,12)
assert(#groups==4 and groups[1].zone=='Stonetalon' and groups[2].zone=='The Barrens' and groups[3].zone=='' and groups[4].zone=='Durotar')
assert(groups[2].quests[1].questId==2 and groups[2].quests[2].questId==1)
assert(groups[4].quests[1].questId==3 and groups[4].quests[1].unit=='far' and groups[4].quests[2].unit=='none','a known spot elsewhere before no spot at all')
assert(groups[1].quests[1].color=='red' and groups[2].quests[1].color=='yellow' and groups[4].quests[1].color=='grey')
local lines=BackstageForeverTrackerLines(groups,18)
assert(#lines==10,'four zone names and six quests: '..#lines)
assert(lines[1].kind=='head' and lines[1].left=='Stonetalon' and lines[2].kind=='row' and lines[2].left=='|cffff3333[17] Nearest of all|r' and lines[2].right=='10 yd')
assert(lines[4].left=='|cffffd100[12] Near in the Barrens|r' and lines[4].right=='|cff40ff40Ready|r  50 yd' and lines[4].quest.questId==2)
assert(lines[6].left=='Other quests' and lines[8].left=='Durotar' and lines[9].right=='elsewhere' and lines[10].right=='not known')
-- Marks without colour: every colour but grey has its own text mark.
local marked=BackstageForeverTrackerLines(groups,18,function(kind) return ({danger='[!!] ',warn='[!] ',same='[=] ',good='[+] '})[kind] or '' end)
assert(marked[2].left=='|cffff3333[!!] [17] Nearest of all|r' and marked[4].left=='|cffffd100[=] [12] Near in the Barrens|r')
assert(marked[9].left=='|cff9d9d9d[6] Durotar errand|r','grey carries no mark, so it differs from every marked colour')
-- A short panel: never over the limit, the last line says how many are left out, no zone name left dangling.
for limit=3,10 do
  local cut=BackstageForeverTrackerLines(groups,limit)
  assert(#cut<=limit,'limit '..limit..' gave '..#cut)
  if limit<10 then
    assert(cut[#cut].kind=='note' and cut[#cut].left:match('^%+%d+ more in your quest log$'),limit..': '..cut[#cut].left)
    assert(cut[#cut-1].kind=='row','a zone name is never the last thing shown')
    local shown=0 for _,l in ipairs(cut) do if l.kind=='row' then shown=shown+1 end end
    assert(cut[#cut].left=='+'..(6-shown)..' more in your quest log')
  end
end
assert(BackstageForeverTrackerLines({},18)[1].left=='No quests in your log.')
-- Equal distance: the finished quest first, then the lower level, then the id.
local tie=BackstageForeverTrackerGroups({{questId=9,title='b',level=5,zone='Z'},{questId=8,title='a',level=7,zone='Z',ready=true},{questId=7,title='c',level=5,zone='Z'}},here,10)
assert(tie[1].quests[1].questId==8 and tie[1].quests[2].questId==7 and tie[1].quests[3].questId==9)
`));

test("the run: instance ids match the Atlas baseline, and a run survives a reload and a death run", () => {
  const { BASELINE } = require("../src/core/dungeon-atlas.cjs");
  const out = lua(FILE + String.raw`
local parts={}
for id,list in pairs(BackstageForeverRunInstances) do for _,slug in ipairs(list) do parts[#parts+1]=slug..':'..id end end
table.sort(parts) print(table.concat(parts,' '))
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
local rows=BackstageForeverRunRows(BackstageForeverAtlasData,36)
assert(#rows==1 and rows[1][2]=='The Deadmines')
rows=BackstageForeverRunRows(BackstageForeverAtlasData,229)
assert(#rows==2 and rows[1][1]=='lbrs' and rows[2][1]=='ubrs','one instance, two Atlas rows')
assert(#BackstageForeverRunRows(BackstageForeverAtlasData,999999)==0 and #BackstageForeverRunRows(nil,36)==0 and #BackstageForeverRunRows(BackstageForeverAtlasData,nil)==0)
local V=BackstageForeverRunVisit
local visit,fresh=V(nil,36,1000) assert(fresh==true and visit.map==36 and visit.startedAt==1000)
local again;again,fresh=V(visit,36,1600) assert(again==visit and fresh==false,'a reload keeps the run')
visit.leftAt=2000
again,fresh=V(visit,36,2000+29*60) assert(again==visit and fresh==false and visit.leftAt==nil,'back in within half an hour: the same run')
visit.leftAt=2000
again,fresh=V(visit,36,2000+31*60) assert(fresh==true and again.startedAt==2000+31*60,'away longer: a new run')
again,fresh=V({map=36,startedAt=1000},48,1100) assert(fresh==true and again.map==48,'another dungeon')
again,fresh=V({map=36,startedAt=1000},36,1000+9*3600) assert(fresh==true,'never one run for nine hours')
again,fresh=V({map=36,startedAt=5000},36,1000) assert(fresh==true,'a clock that went backwards starts over')
assert(V(nil,nil,1000)==nil)
local R=BackstageForeverRunTime
assert(R(40)=='under a minute' and R(23*60+59)=='23 min' and R(3600+5*60)=='1 h 05 min' and R(-1)==nil and R(nil)==nil)
`);
    const want = BASELINE.map((row) => `${row[0]}:${row[9]}`).sort().join(" ");
    assert.equal(out, want, "BackstageForeverRunInstances and src/core/dungeon-atlas.cjs name the same instances");
});

test("the run: bosses left from recorded wins, your quests, and wishes still possible", () => lua(FILE + String.raw`
local rows={{'dm','The Deadmines','d',17,26,'A',1436,.42,.72,
  {{"Rhahk'Zor",'872~40|5187~40'},{'Sneed','5194~60|5195~30'},{'Gilnid','1156~50|5199~50'},{'Edwin VanCleef','5193~33|5202~30|5191~40'}},
  {{166,'The Defias Brotherhood',22,'A','Gryan',1436,.5,.5},{214,'Red Silk Bandanas',17,'A','Scout',1436,.5,.5}}}}
local wins={
  {encounterId=1,name="Rhahk'Zor",instanceMap=36,at=1500},
  {encounterId=2,name='sneed',instanceMap=36,at=1600},
  {encounterId=3,name='Gilnid',instanceMap=36,at=900},           -- an earlier run
  {encounterId=4,name='Edwin VanCleef',instanceMap=48,at=1700},  -- another instance
  {encounterId=5,name='Cookie',instanceMap=36,at=1800},          -- not on the list
  'junk',
}
local b=BackstageForeverRunBosses(rows,wins,36,1000)
assert(b.total==4 and #b.left==2 and b.left[1].name=='Gilnid' and b.left[2].name=='Edwin VanCleef' and #b.killed==2)
assert(#b.other==1 and b.other[1]=='Cookie','a win the list does not name is counted apart')
b=BackstageForeverRunBosses(rows,nil,36,1000) assert(b.total==4 and #b.left==4 and #b.other==0)
b=BackstageForeverRunBosses(rows,wins,36,nil) assert(#b.left==4,'no run start: nothing is assumed dead')
-- Lower and Upper Blackrock Spire: both rows, a boss named twice counted once.
b=BackstageForeverRunBosses({{'a','A','d',1,2,'B',0,0,0,{{'One',''},{'Two',''}},{}},{'b','B','d',1,2,'B',0,0,0,{{'Two',''},{'Three',''}},{}}},{},1,0)
assert(b.total==3 and #b.left==3)
-- Quests: listed for the place, or filed under its name in your log.
local log={
  {id=166,title='The Defias Brotherhood',complete=false,zone='Westfall',objectives={{text='Head: 0/1',done=false,fulfilled=0,required=1}}},
  {id=214,title='Red Silk Bandanas',complete=true,zone='Westfall',objectives={{text='Bandanas: 10/10',done=true,fulfilled=10,required=10}}},
  {id=900,title='Filed under the dungeon',complete=false,zone='Die Todesminen',objectives={{text='Talk',done=false}}},
  {id=901,title='Elsewhere',complete=false,zone='Westfall',objectives={}},
}
local q=BackstageForeverRunQuests(rows,log,'Die Todesminen')
assert(#q==3 and q[1].title=='Red Silk Bandanas' and q[1].ready==true and q[2].title=='Filed under the dungeon' and q[2].progress==nil and q[3].progress=='0/1')
assert(#BackstageForeverRunQuests(rows,nil,'x')==0 and #BackstageForeverRunQuests(rows,log,nil)==2)
-- Items: only from bosses still standing; wishes first; one line per item with its best chance.
local left=BackstageForeverRunBosses(rows,wins,36,1000).left
local items=BackstageForeverRunItems(left,{[5193]=true,[872]=true,[5199]=true},{[1156]=true,[5199]=true,[5191]=true})
assert(#items==4,'872 is on a dead boss: '..#items)
assert(items[1].id==5199 and items[1].wish and items[1].up and items[1].boss=='Gilnid' and items[1].chance==50)
assert(items[2].id==5193 and items[2].wish and not items[2].up and items[3].id==1156 and items[4].id==5191)
assert(#BackstageForeverRunItems(left,{},{})==0 and #BackstageForeverRunItems(nil,nil,nil)==0)
local dup=BackstageForeverRunItems({{name='A',loot='7~10'},{name='B',loot='7~60'}},{[7]=true},{})
assert(#dup==1 and dup[1].boss=='B' and dup[1].chance==60)
-- The lines of the panel.
local lines=BackstageForeverRunLines({seconds=23*60,bosses=BackstageForeverRunBosses(rows,wins,36,1000),quests=q,items=items,handed=true},function(id) return 'Item '..id end)
local function find(left) for i,l in ipairs(lines) do if l.left==left then return l,i end end end
assert(lines[1].left=='Time in the run' and lines[1].right=='23 min')
assert(find('Bosses left').right=='2 / 4' and find('  Gilnid') and find('  Edwin VanCleef') and not find("  Rhahk'Zor"))
assert(find('  1 win not matched to this list').kind=='note')
assert(find('Your quests here').right=='3' and find('  Red Silk Bandanas').right=='|cff40ff40Ready|r' and find('  The Defias Brotherhood').right=='0/1' and find('  Filed under the dungeon').right=='open')
assert(find('Still possible').right=='4' and find('  |cffffd100Wish|r Item 5199').right=='50%' and find('  |cff40ff40Upgrade|r Item 1156').item.boss=='Gilnid')
assert(#lines<=25,'fits the panel: '..#lines)
-- Nothing to show is said plainly, and the two empty reasons differ.
local empty=BackstageForeverRunLines({seconds=5,bosses={total=2,left={},killed={'a','b'},other={}},quests={},items={},handed=false})
local text={} for _,l in ipairs(empty) do text[#text+1]=l.left end text=table.concat(text,'|')
assert(text:find('Every listed boss is down.',1,true) and text:find('None in your log.',1,true) and text:find('No wishes or upgrades from the desktop app.',1,true),text)
empty=BackstageForeverRunLines({seconds=5,bosses={total=2,left={},killed={},other={}},quests={},items={},handed=true})
assert(empty[#empty].left=='  No wish or upgrade left here.')
-- The fullest panel is exactly the 25 lines the frame has.
local many={total=20,left={},killed={},other={'x','y'}} for i=1,20 do many.left[i]={name='Boss '..i,loot=''} end
local mq,mi={},{} for i=1,9 do mq[i]={questId=i,title='Q'..i} mi[i]={id=i,boss='B',chance=5,wish=true} end
local full=BackstageForeverRunLines({seconds=5,bosses=many,quests=mq,items=mi,handed=true})
assert(#full==25,'1 + 1+8+1+1 + 1+4+1 + 1+5+1 lines: '..#full)
`));

// A small game: frames that remember what was done to them, a clock, a place, an instance.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local combat=false InCombatLockdown=function() return combat end
local made,handlers={},{}
local function widget(kind,name)
  local w={kind=kind,name=name,scripts={},shown=true,points={}}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn;if k=='OnEvent' then handlers[#handlers+1]=fn end end,
    SetText=function(self,t) self.text=t end, SetWidth=function(self,v) self.width=v end, SetHeight=function(self,v) self.height=v end,
    SetSize=function(self,a,b) self.width,self.height=a,b end,
    SetPoint=function(self,...) self.points[#self.points+1]={...} end,
    ClearAllPoints=function(self) self.points={} end,
    GetLeft=function(self) return self.atLeft end, GetTop=function(self) return self.atTop end,
    SetWordWrap=function(self,v) self.wrap=v end,
    SetClampedToScreen=function(self,v) self.clamped=v end, SetMovable=function(self,v) self.movable=v end,
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end, IsShown=function(self) return self.shown end,
    CreateFontString=function() return widget('FontString') end, CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
CreateFrame=function(kind,name) local w=widget(kind,name);made[#made+1]=w;if name then _G[name]=w end;return w end
UIParent={} GameTooltip=widget('GameTooltip')
local function fire(event,...) for _,h in ipairs(handlers) do h(nil,event,...) end end
local clockNow=10000 time=function() return clockNow end
local level=12 UnitLevel=function() return level end UnitName=function() return 'Tester' end GetRealmName=function() return 'Realm' end
local map,px,py=1413,.5,.5
CreateVector2D=function(x,y) return {x=x,y=y,GetXY=function(self) return self.x,self.y end} end
C_Map={GetBestMapForUnit=function() return map end,
  GetPlayerMapPosition=function() return CreateVector2D(px,py) end,
  -- Every zone map is 1000 x 1000 yards, side by side on continent 1.
  GetWorldPosFromMapPos=function(m,v) return 1,CreateVector2D(-v.y*1000,-(v.x*1000+(m-1411)*1000)) end}
local inside,kind,instanceMap,instanceName=false,'none',0,''
GetInstanceInfo=function() return instanceName,kind,1,'Normal',5,0,false,instanceMap end
local ways={} BackstageForeverWay=function(m) ways[#ways+1]=m end
BackstageForeverQuestStops=function(character) return character.stops end
local function lines(panel) local out={} for _,l in ipairs(panel.lines) do if l.shown then out[#out+1]=l end end return out end
`;

test("/bf tracker: off until switched on, a click sets the waypoint, hidden in combat, position kept per character", () => lua(STUBS + FILE + String.raw`
fire('PLAYER_LOGIN')
assert(BackstageForeverPanelEnabled('tracker')==false and BackstageForeverTracker==nil,'nothing is built while it is off')
BackstageForeverPanelsUpdate({stops={
  {questId=1,title='Far one',level=12,zone='The Barrens',destination={mapId=1413,x=.9,y=.5}},
  {questId=2,title='Near one',level=12,zone='The Barrens',ready=true,destination={mapId=1413,x=.6,y=.5}},
  {questId=3,title='Next zone',level=12,zone='Durotar',destination={mapId=1411,x=.5,y=.5}},
  {questId=4,title='No spot',level=12,zone='Durotar'},
}})
assert(BackstageForeverTracker==nil)
assert(BackstageForeverTrackerCommand('tracker on')==true and last():find('The game\'s own tracker is left alone',1,true))
local f=BackstageForeverTracker
assert(f and f.shown==true and f.clamped==true and f.movable==true and BackstageForeverPanelSettings.tracker==true)
local shown=lines(f)
assert(#shown==6 and shown[1].left.text=='|cffffd100The Barrens|r' and shown[2].left.text=='|cffffd100[12] Near one|r' and shown[2].right.text=='|cff40ff40Ready|r  100 yd')
assert(shown[3].right.text=='400 yd' and shown[5].right.text=='2000 yd' and shown[6].right.text=='not known','another zone on the same continent is measured too')
-- Text never wraps, and the two columns of a line never meet.
for _,l in ipairs(f.lines) do
  assert(l.left.wrap==false and l.right.wrap==false)
  if l.shown and l.right.text~='' then assert(l.left.width+l.right.width<=l.width,'columns overlap') end
end
assert(shown[1].left.width==shown[1].width,'a zone name has the whole line')
assert(f.height==BackstageForeverPanelHeight(6) and BackstageForeverPanelHeight(6)>=32+6*14,'the frame is as tall as its lines')
-- Click: a waypoint, in map fractions. Never from anything but the click, never in combat.
assert(#ways==0)
shown[2].scripts.OnClick(shown[2])
assert(#ways==1 and ways[1]=='way 1413 0.6000 0.5000 Near one',ways[1])
shown[6].scripts.OnClick(shown[6]) assert(#ways==1 and last():find('No spot is known',1,true))
shown[1].scripts.OnClick(shown[1]) assert(#ways==1,'a zone name does nothing')
combat=true shown[2].scripts.OnClick(shown[2]) assert(#ways==1 and last():find('leave combat',1,true)) combat=false
-- You walk: the slow ticker re-sorts.
px=.95 BackstageForeverPanelsTick()
shown=lines(f) assert(shown[2].left.text=='|cffffd100[12] Far one|r' and shown[2].right.text=='50 yd')
-- Combat hides it and nothing repaints; it comes back afterwards.
combat=true fire('PLAYER_REGEN_DISABLED') assert(f.shown==false)
px=.5 BackstageForeverPanelsTick() BackstageForeverPanelsUpdate({stops={}}) assert(f.shown==false)
combat=false fire('PLAYER_REGEN_ENABLED') assert(f.shown==true and lines(f)[1].left.text=='|cff9d9d9dNo quests in your log.|r')
BackstageForeverPanelsUpdate({}) assert(lines(f)[1].left.text=='|cff9d9d9dYour quest log is not readable right now.|r')
-- It starts at the left edge, hanging from its top-left corner so the title never moves as the list grows.
assert(#f.points==1 and f.points[1][1]=='TOPLEFT' and f.points[1][3]=='TOPLEFT' and f.points[1][4]==24 and f.points[1][5]==-150)
-- Dragging keeps the place for this character, again as the top-left corner.
f.atLeft,f.atTop=120,600 f.scripts.OnDragStop(f)
local p=BackstageForeverPanelSettings.pos.tracker assert(p.x==120 and p.y==600)
assert(#f.points==1 and f.points[1][1]=='TOPLEFT' and f.points[1][3]=='BOTTOMLEFT' and f.points[1][4]==120 and f.points[1][5]==600)
local x,y=BackstageForeverPanelPlace(BackstageForeverPanelSettings,'tracker') assert(x==120 and y==600)
assert(BackstageForeverPanelPlace(BackstageForeverPanelSettings,'run')==nil and BackstageForeverPanelPlace(nil,'tracker')==nil)
assert(BackstageForeverPanelPlace({pos={tracker={x='a',y=1}}},'tracker')==nil and BackstageForeverPanelPlace({pos={tracker={x=-5,y=1}}},'tracker')==nil)
f.atLeft=nil f.scripts.OnDragStop(f) assert(BackstageForeverPanelSettings.pos.tracker.x==120,'an unreadable place changes nothing')
-- Off: hidden, and stays hidden.
assert(BackstageForeverTrackerCommand('tracker off')==false and f.shown==false and last():find('off',1,true))
BackstageForeverPanelsTick() assert(f.shown==false)
combat=true assert(BackstageForeverTrackerCommand('tracker')==true and f.shown==false and last():find('when you leave combat',1,true))
combat=false BackstageForeverPanelsTick() assert(f.shown==true)
`));

test("/bf run: appears inside a known dungeon, counts recorded wins, hides in combat unless asked to stay", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
` + FILE + String.raw`
fire('PLAYER_LOGIN')
BackstageForeverPanelsUpdate({quests={{id=166,title='The Defias Brotherhood',complete=false,zone='Westfall',objectives={{text='x',done=false,fulfilled=0,required=1}}}}})
fire('PLAYER_ENTERING_WORLD') assert(BackstageForeverRunPanel==nil,'outside: no panel')
BackstageForeverRunCommand('run on') assert(last():find('It appears inside a dungeon or raid',1,true))
-- A dungeon the Atlas does not know: still nothing.
kind,instanceMap,instanceName='party',999999,'Unknown Place' fire('PLAYER_ENTERING_WORLD') assert(BackstageForeverRunPanel==nil)
BackstageForeverRunCommand('run reset') assert(last():find('not in a dungeon or raid the Instance Atlas knows',1,true))
-- The Deadmines.
kind,instanceMap,instanceName='party',36,'Die Todesminen' fire('PLAYER_ENTERING_WORLD')
local f=BackstageForeverRunPanel
assert(f and f.shown==true and f.title.text=='Die Todesminen','the game\'s own name for the place')
assert(f.points[1][1]=='TOPLEFT' and f.points[1][4]==24 and f.points[1][5]==-150,'alone, it takes the left edge')
assert(BackstageForeverPanelSettings.visit.map==36 and BackstageForeverPanelSettings.visit.startedAt==10000)
local function text() local out={} for _,l in ipairs(lines(f)) do out[#out+1]=(l.left.text or '')..'>'..(l.right.text or '') end return table.concat(out,'\n') end
local bosses=#BackstageForeverAtlasData[3][10]
assert(BackstageForeverAtlasData[3][1]=='dm' and text():find('Bosses left|r>|cffffd100'..bosses..' / '..bosses,1,true),text())
assert(text():find('Time in the run>under a minute',1,true) and text():find('  The Defias Brotherhood>0/1',1,true))
assert(text():find('No wishes or upgrades from the desktop app.',1,true))
for _,l in ipairs(f.lines) do if l.shown and l.right.text~='' then assert(l.left.width+l.right.width<=l.width) end end
-- A win the Journal recorded, and time passing.
BackstageForeverJournalDB={encounters={{encounterId=1,name=BackstageForeverAtlasData[3][10][1][1],instanceMap=36,instanceType='party',difficultyId=1,at=10300}}}
clockNow=10000+12*60 BackstageForeverPanelsTick()
assert(text():find((bosses-1)..' / '..bosses,1,true) and text():find('Time in the run>12 min',1,true) and not text():find('  '..BackstageForeverAtlasData[3][10][1][1]..'>',1,true))
-- A wish on a boss still standing shows up with its chance.
local wishBoss=BackstageForeverAtlasData[3][10][bosses]
local wishId,chance=wishBoss[2]:match('(%d+)~(%d+)')
BackstageForeverDesktopData={schema=1,characters={['Tester-Realm']={wish={tonumber(wishId)}}}}
GetItemInfo=function(id) return 'Named '..id end
BackstageForeverPanelsTick()
assert(text():find('Wish|r Named '..wishId..'>'..chance..'%',1,true),text())
-- Combat: hidden by default.
combat=true fire('PLAYER_REGEN_DISABLED') assert(f.shown==false)
combat=false fire('PLAYER_REGEN_ENABLED') assert(f.shown==true)
-- "Stays in combat": it stays, but it is not repainted until combat ends.
BackstageForeverRunCommand('run combat on') assert(BackstageForeverPanelSettings.runCombat==true and last():find('stays on screen in combat',1,true))
combat=true fire('PLAYER_REGEN_DISABLED') assert(f.shown==true)
clockNow=10000+40*60 BackstageForeverPanelsTick() assert(text():find('Time in the run>12 min',1,true),'no work in combat')
combat=false fire('PLAYER_REGEN_ENABLED') assert(text():find('Time in the run>40 min',1,true))
BackstageForeverRunCommand('run combat off') assert(BackstageForeverPanelSettings.runCombat==false)
-- A death: outside for a few minutes, then back in. The same run.
kind,instanceMap='none',0 clockNow=10000+45*60 fire('PLAYER_ENTERING_WORLD')
assert(f.shown==false and BackstageForeverPanelSettings.visit.leftAt==clockNow)
kind,instanceMap='party',36 clockNow=10000+50*60 fire('PLAYER_ENTERING_WORLD')
assert(f.shown==true and BackstageForeverPanelSettings.visit.startedAt==10000 and text():find('Time in the run>50 min',1,true))
-- /bf run reset: the clock and the bosses start over.
BackstageForeverRunCommand('run reset')
assert(BackstageForeverPanelSettings.visit.startedAt==clockNow and text():find('Time in the run>under a minute',1,true) and text():find(bosses..' / '..bosses,1,true))
-- Off and on again.
assert(BackstageForeverRunCommand('run off')==false and f.shown==false)
BackstageForeverPanelsTick() fire('PLAYER_ENTERING_WORLD') assert(f.shown==false)
assert(BackstageForeverRunCommand('run')==true and f.shown==true)
-- The close button switches it off, like the command.
local close for _,w in ipairs(made) do if w.kind=='Button' and w.scripts.OnClick and w~=f and type(w.left)~='table' then close=w end end
close.scripts.OnClick(close) assert(BackstageForeverPanelSettings.run==false and last():find('/bf run',1,true))
`));

test("the panels are wired in: files, saved settings, commands, switches, the capture, and the game's tracker untouched", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverPanelSettings\b/m);
  assert.doesNotMatch(toc.split(/\r?\n/).find((l) => l.startsWith("## SavedVariables:")), /Panel/, "per character only");
  const order = toc.split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  for (const before of ["BackstageForeverPlan.lua", "BackstageForeverSocial.lua", "BackstageForeverAtlas.lua", "BackstageForeverJournal.lua", "BackstageForeverHUD.lua"]) {
    assert.ok(order.indexOf(before) < order.indexOf("BackstageForeverPanels.lua"), before + " loads first");
  }
  assert.ok(order.indexOf("BackstageForeverPanels.lua") < order.indexOf("BackstageForeverWish.lua"));
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const [word, fn] of [["tracker", "BackstageForeverTrackerCommand"], ["run", "BackstageForeverRunCommand"]]) {
    assert.ok(hud.includes(`if word=='${word}' then\n                if type(${fn})=='function' then pcall(${fn},message)end`), word);
  }
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /pcall\(BackstageForeverPanelsUpdate,character\)/);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.ok(options.includes("off('BackstageForeverPanelSettings','tracker'),'tracker'"), "the quest list is off by default");
  assert.ok(options.includes("on('BackstageForeverPanelSettings','run'),'run'"));
  assert.ok(options.includes("off('BackstageForeverPanelSettings','runCombat'),'run combat'"));
  const source = read("addon/BackstageForever/BackstageForeverPanels.lua");
  for (const name of ["ObjectiveTracker", "QuestWatchFrame", "WatchFrame", "QuestTimerFrame", "hooksecurefunc", "SetAttribute", "RegisterStateDriver"]) {
    assert.ok(!source.includes(name), `the panels never touch ${name}`);
  }
  assert.ok(!/C_Map\.SetUserWaypoint|SetSuperTracked/.test(source), "a waypoint only through the shared click-or-command path");
  assert.equal((source.match(/BackstageForeverWay,/g) || []).length, 1, "one waypoint call, in the click handler");
  const de = JSON.parse(read("data/i18n/de.json")).addon.plain;
  for (const text of ["Quests by distance", "Ready", "Bosses left", "Your quests here", "Still possible", "Time in the run", "Quest list by distance", "Dungeon run panel", "Run panel stays in combat", "Panels",
    "Quest list by distance: off.", "Dungeon run panel: off.", "No quests in your log.", "elsewhere", "not known"]) assert.ok(de[text], `German for: ${text}`);
});
