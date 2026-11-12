"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), { spawnSync } = require("node:child_process");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: body, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout;
}
const pure = String.raw`
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
BackstageForeverAdvisorData={givers={[1420]={
  {q=1,t='Fresh Start',l=2,s='H',n='Giver A',x=.3,y=.6},
  {q=2,t='Too Hard',l=9,m=8,s='H',n='Giver B',x=.4,y=.5},
  {q=3,t='Alliance Only',l=2,s='A',n='Giver C',x=.5,y=.5},
  {q=4,t='Already Done',l=2,s='H',n='Giver D',x=.6,y=.5},
  {q=5,t='In My Log',l=2,n='Giver E',x=.7,y=.5}}},
  npcs={[1420]={{k='c',n='Dark Cleric',r='Priest Trainer',s='H',x=.31,y=.66},{k='c',n='Mage Person',r='Mage Trainer',s='H',x=.32,y=.66},
                {k='c',n='Weapons',r='Weapon Master',s='B',x=.33,y=.66},{k='p',n='Cook',r='Cooking Trainer',s='H',x=.34,y=.66},{k='f',n='Bat Handler',r='Flight Master',s='A',x=.35,y=.66}}},zones={}}
BackstageForeverReference={quests={[5]={title='In My Log',turnIn={mapId=1420,x=.2,y=.2,name='Turn In NPC'}}}}
dofile('addon/BackstageForever/BackstageForeverAdvisorMap.lua')
local who={level=3,faction='H',className='Priest'}
`;

test("pick-ups respect level, faction, completion and the quest log; trainers respect class and faction", () => {
  lua(pure + String.raw`
  local rows=BackstageForeverAdvisorPoints(1420,who,{[4]=true},{[5]=true},{[5]=true})
  local by={};for _,r in ipairs(rows)do by[r.layer]=by[r.layer] or {};table.insert(by[r.layer],r.title)end
  assert(#by.pickup==1 and by.pickup[1]=='Giver A','only the fitting Horde quest not done and not in log')
  assert(#by.handin==1 and by.handin[1]=='Turn In NPC','finished quest in log shows its hand-in')
  assert(#by.class==2,'own class trainer and weapon master, not the mage trainer')
  assert(#by.profession==1 and by.flight==nil,'Alliance flight master hidden from Horde')
  -- layers can be turned off; unknown map or level gives nothing
  assert(#BackstageForeverAdvisorPoints(1420,who,{},{},{},{pickup=false,handin=false,class=false,profession=false,flight=false})==0)
  assert(#BackstageForeverAdvisorPoints(9999,who,{},{},{})==0)
  assert(#BackstageForeverAdvisorPoints(1420,{faction='H'},{},{},{})==0)
  -- a level 9 character sees the harder quest
  local high=BackstageForeverAdvisorPoints(1420,{level=9,faction='H',className='Priest'},{},{},{},{handin=false,class=false,profession=false,flight=false})
  assert(#high==1 and high[1].title=='Giver B')
  `);
});

test("the generated advisor data loads in Lua and holds givers, trainers and zones", () => {
  const out = lua(String.raw`dofile('addon/BackstageForever/BackstageForeverAdvisorData.lua')
  local g,n=0,0;for _,rows in pairs(BackstageForeverAdvisorData.givers)do g=g+#rows end;for _,rows in pairs(BackstageForeverAdvisorData.npcs)do n=n+#rows end
  print(g,n,#BackstageForeverAdvisorData.zones)`).trim().split(/\s+/).map(Number);
  assert.ok(out[0] > 200 && out[1] > 20 && out[2] >= 30, out.join(","));
});

test("the map provider attaches, draws game icons, waypoints on click, hides in combat; /bf next picks the hand-in first", () => {
  lua(pure + String.raw`
  local frames,fighting={},false
  local methods={};for _,k in ipairs({'SetSize','SetPoint','ClearAllPoints','EnableMouse','SetBackdrop','SetBackdropColor','SetAllPoints','RegisterEvent'})do methods[k]=function()end end
  methods.SetScript=function(s,k,f)s[k]=f end;methods.HookScript=function(s,k,f)local p=s[k];s[k]=function(...)if p then p(...)end;f(...)end end
  methods.SetText=function(s,t)s.text=t end;methods.Show=function(s)s.visible=true end;methods.Hide=function(s)s.visible=false end;methods.IsShown=function(s)return s.visible==true end
  methods.SetTexture=function(s,t)s.texture=t end
  methods.CreateTexture=function()return setmetatable({},{__index=methods})end
  CreateFrame=function(_,name)local f=setmetatable({name=name},{__index=methods});frames[#frames+1]=f;return f end
  Mixin=function(t,...)for _,m in ipairs({...})do for k,v in pairs(m)do t[k]=v end end;return t end
  InCombatLockdown=function()return fighting end
  UnitLevel=function()return 3 end;UnitFactionGroup=function()return 'Horde' end;UnitClass=function()return 'Priest','PRIEST' end
  C_QuestLog={GetAllCompletedQuestIDs=function()return {4} end,GetNumQuestLogEntries=function()return 1 end,GetInfo=function()return {isHeader=false,questID=5,title='In My Log'} end,IsComplete=function(id)return id==5 end}
  local ways={};BackstageForeverWay=function(m)ways[#ways+1]=m end
  GameTooltip={SetOwner=function(s,o)s.owner=o end,GetOwner=function(s)return s.owner end,SetText=function()end,AddLine=function()end,Show=function()end,Hide=function(s)s.owner=nil end}
  C_XMLUtil={GetTemplateInfo=function()return {type='Frame'}end}
  MapCanvasPinMixin={SetOwningMap=function()end,OnReleased=function()end}
  MapCanvasDataProviderMixin={OnAdded=function(s,m)s.owningMap=m end,OnRemoved=function()end}
  local pins={}
  WorldMapFrame=setmetatable({mapId=1420,visible=true},{__index=methods})
  function WorldMapFrame:GetMapID()return self.mapId end
  function WorldMapFrame:AddDataProvider(p)self.provider=p;p:OnAdded(self)end
  function WorldMapFrame:AcquirePin(template,...)assert(template=='BackstageForeverAdvisorPinTemplate');local pin=CreateFrame('Frame');BackstageForeverAdvisorPin_OnLoad(pin);pin:OnLoad();pin.SetPosition=function(s,x,y)s.x=x;s.y=y end;pin:OnAcquired(...);pins[#pins+1]=pin;return pin end
  function WorldMapFrame:RemoveAllPinsByTemplate(t)assert(t=='BackstageForeverAdvisorPinTemplate');pins={}end
  dofile('addon/BackstageForever/BackstageForeverAdvisorMap.lua')
  for _,f in ipairs(frames)do if f.OnEvent then f.OnEvent(f,'PLAYER_LOGIN')end end
  assert(WorldMapFrame.provider,'provider attached')
  assert(#pins==5,'hand-in, pick-up, 2 class, 1 profession: '..#pins)
  local textures={};for _,p in ipairs(pins)do textures[p.bfIcon.texture]=true end
  assert(textures['Interface\\GossipFrame\\AvailableQuestIcon'] and textures['Interface\\GossipFrame\\ActiveQuestIcon'] and textures['Interface\\Minimap\\Tracking\\Class'])
  pins[1]:OnMouseClickAction('LeftButton');assert(#ways==1 and ways[1]:match('^way 1420 '))
  pins[1]:OnMouseEnter();assert(GameTooltip.owner==pins[1])
  fighting=true;for _,f in ipairs(frames)do if f.OnEvent then f.OnEvent(f,'PLAYER_REGEN_DISABLED')end end;assert(#pins==0,'combat clears pins')
  fighting=false;WorldMapFrame.provider:RefreshAllData();assert(#pins==5)
  -- layer toggle from the panel
  local function named(n)for _,f in ipairs(frames)do if f.name==n then return f end end end
  named('BackstageForeverAdvisorToggle').OnClick();assert(#pins==0 and BackstageForeverAdvisorSettings.enabled==false)
  named('BackstageForeverAdvisorToggle').OnClick();assert(#pins==5)
  -- /bf next: hand-in beats a nearer pick-up
  C_Map={GetBestMapForUnit=function()return 1420 end,GetPlayerMapPosition=function()return {GetXY=function()return .3,.6 end} end}
  local said={};DEFAULT_CHAT_FRAME={AddMessage=function(_,m)said[#said+1]=m end}
  BackstageForeverNext();assert(ways[#ways]:match('Turn In NPC') and said[#said]:match('Hand in'))
  `);
});
