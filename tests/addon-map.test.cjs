"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const prelude=String.raw`
issecretvalue=function(v)return type(v)=='table' and rawget(v,'secret')==true end
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
dofile('addon/BackstageForever/BackstageForeverAcquisition.lua')
dofile('addon/BackstageForever/BackstageForeverProfession.lua')
dofile('addon/BackstageForever/BackstageForeverGathering.lua')
dofile('addon/BackstageForever/BackstageForeverMapPlan.lua')
local function col(items)return {observedAt=100,complete=true,items=items}end
local c={id='PRIVATE_GUID',name='Synthetic',updatedAt=100,clientBuild='1.60.1.70862',locale='enUS',faction='Horde',level=12,location={mapId=1411,x=.5,y=.4},quests={},readiness={workshop={professions=col({{skillLineId=186,professionId=2,name='Mining',rank=20,maxRank=75}})}}}
for i=1,25 do c.quests[i]={id=i,title='Quest '..i,complete=true,objectives={},destination={mapId=i==25 and 1411 or 1412,x=.1,y=.2}}end
`;
function lua(body){assert.ok(fs.existsSync(path.resolve('addon/BackstageForever/BackstageForeverMapPlan.lua')),'Map model missing');const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:prelude+body,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');}
test('pure map drains full25 quest pool then filters; canonical copper material union is detached, bounded and private',()=>lua(`local m=BackstageForeverBuildMap(c,{mapId=1411});assert(m.status=='ready' and #m.points==4);local quests,materials=0,0;for _,p in ipairs(m.points)do assert(p.mapId==1411 and not p.id:find('PRIVATE',1,true));assert(not p.castGUID and not p.ownerGUID);if p.kind=='quest' then quests=quests+1;assert(p.questStep.questId==25 and p.precision=='game-marker')else materials=materials+1;assert(#p.itemIds==2 and p.itemIds[1]==2770 and p.itemIds[2]==2835 and p.qualification=='qualified-historical');assert(not p.questStep and not p.command);p.x=0 end end;assert(quests==1 and materials==3);assert(BackstageForeverBuildMap(c,{mapId=1411}).points[2].x~=0);c.clientBuild='1.60.1.70888';m=BackstageForeverBuildMap(c,{mapId=1411});assert(#m.points==1);m=BackstageForeverBuildMap(c,{mapId=1411,layers={olderReferences=true}});assert(#m.points==4 and m.points[2].qualification=='browse-only')`));
test('map same-map unknown/secret/dense guards and record qualification never create current node facts',()=>lua(`assert(BackstageForeverBuildMap(c,{mapId={secret=true}}).status=='unavailable');c.quests={c.quests[1],[3]=c.quests[25]};local m=BackstageForeverBuildMap(c,{mapId=1411,layers={ore=false}});assert(#m.points==0);c.gathering={schemaVersion=1,status='available',recording=true,observedAt=100,limited=false,totalRecords=1,records={{id='wowf:mining:1731:1411:5000:4000:1.60.1.70862',method='mining',entityId=1731,itemIds={2770},mapId=1411,x=.5,y=.4,observedAt=100,clientBuild='1.60.1.70862',name='Copper Vein',evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}}};m=BackstageForeverBuildMap(c,{mapId=1411,layers={ore=false}});assert(#m.points==1 and m.points[1].qualification=='own-recorded');assert(not m.points[1].availableNow and not m.points[1].questStep);c.gathering.records[2]={secret=true};assert(#BackstageForeverBuildMap(c,{mapId=1411,layers={ore=false}}).points==0)`));
test('owned virtual XML is parsed, correctly names engine creation callback and loads after Lua before capture',()=>{const file=path.resolve('addon/BackstageForever/BackstageForeverMap.xml');assert.ok(fs.existsSync(file),'Own map XML missing');const r=spawnSync('powershell.exe',['-NoProfile','-Command',`[xml]$x=Get-Content -LiteralPath '${file.replaceAll("'","''")}' -Raw; $n=New-Object System.Xml.XmlNamespaceManager($x.NameTable);$n.AddNamespace('w','http://www.blizzard.com/wow/ui/');$f=$x.SelectSingleNode('/w:Ui/w:Frame',$n);@{name=$f.name;virtual=$f.virtual;load=$f.Scripts.OnLoad.function;enter=$f.Scripts.OnEnter;leave=$f.Scripts.OnLeave;inherits=$f.inherits}|ConvertTo-Json -Compress`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const xml=JSON.parse(r.stdout);assert.equal(xml.name,'BackstageForeverMapPinTemplate');assert.equal(xml.virtual,'true');assert.equal(xml.load,'BackstageForeverMapPin_OnLoad');assert.equal(xml.enter,null);assert.equal(xml.leave,null);assert.notEqual(xml.inherits,'MapCanvasPinTemplate');const toc=fs.readFileSync('addon/BackstageForever/BackstageForever.toc','utf8');assert.ok(toc.indexOf('BackstageForeverMap.lua')<toc.indexOf('BackstageForeverMap.xml'));assert.ok(toc.indexOf('BackstageForeverMap.xml')<toc.indexOf('\nBackstageForever.lua'));assert.match(require('../package.json').build.extraResources.find(x=>x.to==='addon').filter.join(','),/xml/);});
const native=String.raw`
local frames,fighting={},false
local methods={};for _,key in ipairs({'SetSize','SetPoint','EnableMouse','SetTextColor','SetJustifyH','SetBackdrop','SetBackdropColor','RegisterForClicks','SetAllPoints','SetTexture','SetVertexColor','SetAtlas','SetFrameLevel','SetDrawLayer'})do methods[key]=function()end end
methods.SetScript=function(s,k,f)s[k]=f end;methods.HookScript=function(s,k,f)local prev=s[k];s[k]=function(...)if prev then prev(...)end;f(...)end end
methods.GetScript=function(s,k)return s[k]end;methods.RegisterEvent=function()end;methods.SetText=function(s,t)s.text=t end;methods.Show=function(s)s.visible=true end;methods.Hide=function(s)s.visible=false end;methods.IsShown=function(s)return s.visible~=false end
methods.CreateFontString=function()return setmetatable({},{__index=methods})end;methods.CreateTexture=methods.CreateFontString
CreateFrame=function(_,name)local f=setmetatable({name=name},{__index=methods});frames[#frames+1]=f;return f end
Mixin=function(t,...)for _,m in ipairs({...})do for k,v in pairs(m)do t[k]=v end end;return t end
InCombatLockdown=function()return fighting==true end
UnitGUID=function()return c.id end;GetBuildInfo=function()return '1.60.1','70862'end
local waypoints=0;C_Map={CanSetUserWaypointOnMap=function()return true end,SetUserWaypoint=function()waypoints=waypoints+1 end};UiMapPoint={CreateFromCoordinates=function(map,x,y)return {mapId=map,x=x,y=y}end}
GameTooltip={SetOwner=function(s,o)s.owner=o end,GetOwner=function(s)return s.owner end,SetText=function()end,AddLine=function()end,Show=function()end,Hide=function(s)s.owner=nil end}
local function event(e)for _,f in ipairs(frames)do if f.OnEvent then f.OnEvent(f,e)end end end
dofile('addon/BackstageForever/BackstageForeverMap.lua')
BackstageForeverMapUpdate(c)
assert(WorldMapFrame==nil)
local added,removed,released,order=0,0,0,{}
C_XMLUtil={GetTemplateInfo=function()return {type='Frame'}end}
MapCanvasPinMixin={OnClick=function(s,button)if button~='RightButton' and s.OnMouseClickAction then s:OnMouseClickAction(button)end end,SetOwningMap=function(s,m)order[#order+1]='SetOwningMap';s.map=m end,GetMap=function(s)return s.map end,CheckMouseButtonPassthrough=function(s,b)assert(b=='RightButton');s.rightPass=true end,SetPosition=function(s,x,y)s.map:SetPinPosition(s,x,y);order[#order+1]='SetPosition' end,OnReleased=function(s)released=released+1;s.tag=nil end}
MapCanvasDataProviderMixin={OnAdded=function(s,m)s.owningMap=m end,GetMap=function(s)return s.owningMap end,OnRemoved=function(s)s.owningMap=nil end}
local pool,pins={},{}
WorldMapFrame=setmetatable({mapId=1411,visible=true},{__index=methods})
function WorldMapFrame:GetMapID()return self.mapId end
function WorldMapFrame:SetPinPosition(pin,x,y)pin.x=x;pin.y=y end
function WorldMapFrame:AddDataProvider(p)added=added+1;self.provider=p;p:OnAdded(self)end
function WorldMapFrame:AcquirePin(template,...)
 assert(template=='BackstageForeverMapPinTemplate');local pin=table.remove(pool)
 if not pin then pin=CreateFrame('Frame');order[#order+1]='XML';BackstageForeverMapPin_OnLoad(pin);assert(type(pin.SetOwningMap)=='function','XML creation must provide full native base BEFORE pool return');pin:SetOwningMap(self);assert(pin:GetScript('OnEnter')==nil and pin:GetScript('OnLeave')==nil);pin:SetScript('OnEnter',pin.OnMouseEnter);pin:SetScript('OnLeave',pin.OnMouseLeave);pin:OnLoad()else pin:SetOwningMap(self)end
 pin:OnAcquired(...);pin:CheckMouseButtonPassthrough('RightButton');pins[#pins+1]=pin;return pin
end
function WorldMapFrame:RemoveAllPinsByTemplate(template)assert(template=='BackstageForeverMapPinTemplate','Cannot remove foreign pins');removed=removed+1;for _,p in ipairs(pins)do p:OnReleased();p:SetOwningMap(nil);pool[#pool+1]=p end;pins={} end
function WorldMapFrame:RemoveDataProvider(p)p:RemoveAllData();p:OnRemoved(self);self.provider=nil end
event('ADDON_LOADED')
`;
test('real native creation order, explicit visible attach, release/reuse, map/hide/show/combat and stale actions',()=>lua(native+`assert(added==1 and #pins==4);assert(order[1]=='XML' and order[2]=='SetOwningMap');event('ADDON_LOADED');assert(added==1);local pin=pins[2];local old=pin.OnMouseClickAction;pin:OnClick('RightButton');assert(waypoints==0);pin:OnClick('LeftButton');assert(waypoints==1);WorldMapFrame.mapId=1412;WorldMapFrame.provider:OnMapChanged();assert(#pins==24);old(pin,'LeftButton');assert(waypoints==1);WorldMapFrame.visible=false;WorldMapFrame.provider:OnHide();assert(#pins==0 and released>=4);WorldMapFrame.mapId=1411;WorldMapFrame.visible=true;WorldMapFrame.provider:OnShow();assert(#pins==4);fighting=true;event('PLAYER_REGEN_DISABLED');assert(#pins==0);fighting=false;event('PLAYER_REGEN_ENABLED');assert(#pins==4);BackstageForeverMapUpdate(nil);assert(#pins==0);BackstageForeverMapUpdate(c);assert(#pins==4);WorldMapFrame:RemoveDataProvider(WorldMapFrame.provider);assert(#pins==0)`));

test('native layers/settings and deliberately scoped clear, missing template, late frame and goal refresh retire stale callbacks',()=>lua(native+`
 local function named(name)for _,f in ipairs(frames)do if f.name==name then return f end end end
 local details=named('BackstageForeverMapDetails');details.OnClick();local toggle=named('BackstageForeverMapLayers');toggle.OnClick();assert(#pins==0 and not BackstageForeverMapSettings.enabled);toggle.OnClick();assert(#pins==4);
 local ore=named('BackstageForeverMapLayerore');local old=ore.OnClick;ore.OnClick();assert(#pins==1 and not BackstageForeverMapSettings.layers.ore);old();assert(#pins==1);ore.OnClick();assert(#pins==4);
 local marker=pins[2];assert(marker.x==.5483 and marker.y==.1777);marker:OnMouseEnter();assert(GameTooltip.owner==marker);WorldMapFrame.provider:RefreshAllData();assert(GameTooltip.owner==nil);local action=pins[2].OnMouseClickAction;BackstageForeverMapGoalChanged();action(pins[2],'LeftButton');assert(waypoints==0);
 c.id='NEW_OWNER';action(pins[2],'LeftButton');assert(waypoints==0);BackstageForeverMapUpdate(c);assert(#pins==4);
 WorldMapFrame:RemoveDataProvider(WorldMapFrame.provider);C_XMLUtil.GetTemplateInfo=function()return nil end;event('ADDON_LOADED');assert(not WorldMapFrame.provider and #pins==0);C_XMLUtil.GetTemplateInfo=function()return {type='Frame'}end;event('ADDON_LOADED');assert(WorldMapFrame.provider and #pins==4);
 WorldMapFrame.mapId={secret=true};WorldMapFrame.provider:OnMapChanged();assert(#pins==0);
`));

test('native clear requires confirmation and cannot redisplay an old capture before the coalesced replacement',()=>lua(native+`
 BackstageForeverGatheringSession('PLAYER_LOGIN')
 local function named(name)for _,f in ipairs(frames)do if f.name==name then return f end end end
 local record={id='wowf:mining:1731:1411:5000:4000:1.60.1.70862',method='mining',entityId=1731,itemIds={2770},mapId=1411,x=.5,y=.4,observedAt=100,clientBuild='1.60.1.70862',name='Copper Vein',evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
 BackstageForeverGatheringDB.records={record};c.gathering={schemaVersion=1,status='unavailable',recording=true,observedAt=100,limited=false,totalRecords=1,records={record}};BackstageForeverMapUpdate(c);assert(#pins==5)
 named('BackstageForeverMapDetails').OnClick();local clear=named('BackstageForeverMapClear');clear.OnClick();assert(#BackstageForeverGatheringDB.records==1);local stale=clear.OnClick;BackstageForeverMapGoalChanged();stale();assert(#BackstageForeverGatheringDB.records==1)
 clear.OnClick();clear.OnClick();assert(#BackstageForeverGatheringDB.records==0);WorldMapFrame.provider:RefreshAllData();assert(#pins==0,'Cleared observations must wait for a fresh capture, not revive old points')
`));

test('native base releases before owned row retirement and tooltip truncation cannot leave a single WoW pipe',()=>lua(native+`
 local sawRow=false;local original=MapCanvasPinMixin.OnReleased;MapCanvasPinMixin.OnReleased=function(pin)sawRow=pin.bfRow~=nil;original(pin)end
 WorldMapFrame.provider:RefreshAllData();assert(sawRow,'Native release must run before owned data is discarded')
 local title;GameTooltip.SetText=function(_,value)title=value end;c.quests[25].title=string.rep('Q',119)..'|cffff0000';BackstageForeverMapUpdate(c);pins[1]:OnMouseEnter();assert(title);local stripped=title:gsub('||','');assert(not stripped:find('|',1,true),'Truncation must not split escaped pipe pairs')
`));

const actualGuide=String.raw`
local currentComplete,currentIndex=true,1
local guideMessages,placed={},nil
DEFAULT_CHAT_FRAME={AddMessage=function(_,value)guideMessages[#guideMessages+1]=value end}
C_QuestLog={GetLogIndexForQuestID=function(id)return id==25 and currentIndex or nil end,IsComplete=function(id)return id==25 and currentComplete or false end}
C_Map.GetMapInfo=function(id)return {name='Synthetic map '..id}end
C_Map.SetUserWaypoint=function(value)waypoints=waypoints+1;placed=value end
dofile('addon/BackstageForever/BackstageForever.lua')
`;
test('review P1 quest pin adapts the unchanged Plan command into the actual Guide and places the chosen waypoint',()=>lua(native+actualGuide+`
local pin=pins[1];assert(pin.bfRow.kind=='quest' and pin.bfRow.questStep.command:find('/bf guide ',1,true)==1)
pin:OnClick('LeftButton');assert(waypoints==1,'Valid quest pin must reach the actual Guide waypoint setter');assert(placed.mapId==1411 and placed.x==.1 and placed.y==.2);assert(guideMessages[#guideMessages]:find('Quest waypoint:',1,true))
`));
test('review P1 actual quest Guide rejects forged command coordinates and stale quest/build/owner/generation/combat state',()=>lua(native+actualGuide+`
local pin=pins[1];local row=pin.bfRow;local original=row.questStep.command
for _,bad in ipairs({'/run something','/bf guide 999 t 1411 0.1 0.2 1.60.1.70862','/bf guide 25 r 1411 0.1 0.2 1.60.1.70862','/bf guide 25 t 1412 0.1 0.2 1.60.1.70862','/bf guide 25 t 1411 0.3 0.2 1.60.1.70862','/bf guide 25 t 1411 0.1 0.2 1.60.1.70888'})do row.questStep.command=bad;pin:OnClick('LeftButton');assert(waypoints==0,'Forged path must not place a marker')end
row.questStep.command=original;currentComplete=false;pin:OnClick('LeftButton');assert(waypoints==0);currentComplete=true;currentIndex=nil;pin:OnClick('LeftButton');assert(waypoints==0);currentIndex=1
fighting=true;pin:OnClick('LeftButton');assert(waypoints==0);fighting=false
local oldBuild=GetBuildInfo;GetBuildInfo=function()return '1.60.1','70888'end;pin:OnClick('LeftButton');assert(waypoints==0);GetBuildInfo=oldBuild
local oldOwner=UnitGUID;UnitGUID=function()return 'OTHER'end;pin:OnClick('LeftButton');assert(waypoints==0);UnitGUID=oldOwner
local oldClick=pin.OnMouseClickAction;BackstageForeverMapUpdate(c);oldClick(pin,'LeftButton');assert(waypoints==0);pins[1]:OnClick('LeftButton');assert(waypoints==1,'Current valid replacement must recover')
`));
