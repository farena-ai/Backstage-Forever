"use strict";
// Lockouts (roadmap "Dungeons and raids"): the game's saved instances as rows with a reset time,
// /bf lockouts with your other characters as last saved, the optional capture block, and an
// honest line when the game client has no list of saved instances. Also the guild events window:
// it is built from stubbed frames here, so a typo cannot hide until somebody opens it in game.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverLockouts.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local NOW=1795000000
local wall=NOW time=function(t) if t then return os.time(t) end return wall end date=os.date
local handlers={}
local combat=false InCombatLockdown=function() return combat end
`;

test("rows: only what you are locked to, with a reset time to the minute, soonest first, bounded", () => lua(FILE + String.raw`
local NOW=1795000000
local saved={
  {'Molten Core',101,3*86400+500,1,true,false,0,true,40,'40 Player',10,3},
  {'Stratholme',102,7200,1,true,false,0,false,5,'Normal',0,0},
  {'Zul\'Gurub',103,86400,1,false,false,0,true,20,'20 Player',10,10},   -- not locked: the game only remembers it
  {'Onyxia\'s Lair',104,0,1,true,false,0,true,40,'40 Player',1,1},       -- already reset
  {'|cffff0000Blackwing|r Lair',105,5*86400,1,true,false,0,true,40,nil,9,8},
  {nil,106,600,1,true}, {'Odd',107,'soon',1,true}, {'Too far',108,61*86400,1,true},
}
local rows=BackstageForeverLockoutRows(#saved,function(i) return (table.unpack or unpack)(saved[i],1,12) end,NOW)
assert(#rows==3,'kept: '..#rows)
assert(rows[1].n=='Stratholme' and rows[1].r%60==0 and math.abs(rows[1].r-(NOW+7200))<=30 and rows[1].raid==nil and rows[1].d=='Normal' and rows[1].t==nil,'a dungeon with no boss count')
assert(rows[2].n=='Molten Core' and rows[2].raid==true and rows[2].p==3 and rows[2].t==10 and rows[2].r%60==0 and math.abs(rows[2].r-(NOW+3*86400+500))<=30)
assert(rows[3].n=='Blackwing Lair' and rows[3].d==nil and rows[3].p==8 and rows[3].t==9,'colour codes are taken out')
-- The same lockout read a few seconds later is the same row.
local again=BackstageForeverLockoutRows(1,function() return 'Molten Core',101,3*86400+500-20,1,true,false,0,true,40,'40 Player',10,3 end,NOW+20) assert(again[1].r==rows[2].r)
-- A read that fails for one row does not cost the others; bad input gives nothing.
assert(#BackstageForeverLockoutRows(2,function(i) if i==1 then error('x') end return 'Stratholme',1,60,1,true end,NOW)==1)
assert(#BackstageForeverLockoutRows(nil,function() end,NOW)==0 and #BackstageForeverLockoutRows(1,nil,NOW)==0 and #BackstageForeverLockoutRows(1,function() return 'A',1,60,1,true end,5)==0)
local many=BackstageForeverLockoutRows(90,function(i) return 'Instance '..string.char(64+(i-1)%26+1)..i,i,i*60,1,true end,NOW) assert(#many==40)
local R=BackstageForeverLockoutRow
assert(R({n='A',r=NOW,p=5,t=3}).p==nil and R({n='',r=NOW})==nil and R({n='A',r=5})==nil and R(nil)==nil and #R({n=string.rep('n',90),r=NOW}).n==60)
local W=BackstageForeverLockoutWait
assert(W(3*86400+4*3600+59)=='3 days 4 h' and W(5*3600+20*60)=='5 h 20 min' and W(12*60)=='12 min' and W(20)=='1 min' and W(0)=='now' and W(-5)=='now' and W(nil)=='now')
`));

test("/bf lockouts: this character live, the others as last saved, and a plain line when the game has no list", () => lua(STUBS + FILE + String.raw`
-- No list of saved instances in this game client: say so, save that, never pretend the character is free.
BackstageForeverLockoutsCommand() assert(#said==1 and said[1]:find('does not tell addons which instances you are saved to',1,true),said[1])
local block=BackstageForeverLockoutSnapshot() assert(block.v==1 and block.na==true and #block.rows==0 and block.at==NOW)
-- With the list.
local saved={{'Molten Core',101,3*86400,1,true,false,0,true,40,'40 Player',10,3}}
local asked=0
GetNumSavedInstances=function() return #saved end GetSavedInstanceInfo=function(i) return (table.unpack or unpack)(saved[i]) end RequestRaidInfo=function() asked=asked+1 end
BackstageForeverRosterLockouts=function() return {
  {name='Altina',at=NOW-86400,rows={{n='Zul\'Gurub',r=NOW+7200,raid=true,p=10,t=10},{n='Old',r=NOW-60,raid=true},{n=5,r=NOW+60}}},
  {name='Bankalt',at=NOW-86400,rows={}}, 'junk' } end
said={} BackstageForeverLockoutsCommand()
assert(#said==4,'this character, its row, the alt, its row: '..#said)
assert(said[1]=='Backstage Forever: This character is saved to 1.' and said[2]=='Backstage Forever:   Molten Core (40 Player) 3 of 10 bosses: resets in 3 days 0 h',said[2])
assert(said[3]=='Backstage Forever: Altina, as last saved: 1.' and said[4]=='Backstage Forever:   Zul\'Gurub 10 of 10 bosses: resets in 2 h 0 min',said[4])
assert(asked==1,'and the game is asked for a fresh list')
block=BackstageForeverLockoutSnapshot() assert(block.na==nil and #block.rows==1 and block.rows[1].n=='Molten Core' and math.abs(block.rows[1].r-(NOW+3*86400))<=30)
saved={} said={} BackstageForeverLockoutsCommand() assert(said[1]=='Backstage Forever: This character is not saved to any dungeon or raid.' and #BackstageForeverLockoutSnapshot().rows==0)
-- The game could not answer right now: no block, so the last saved one is kept by the capture.
GetNumSavedInstances=function() error('busy') end assert(BackstageForeverLockoutSnapshot()==nil)
`));

test("the capture keeps the last lockout block when the game cannot answer, and hands the other characters to /bf lockouts", () => {
  const fs = require("node:fs");
  const main = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.lua"), "utf8");
  assert.match(main, /elseif type\(field\(previous,'lockouts'\)\)=='table' then character\.lockouts=previous\.lockouts end/);
  assert.match(main, /function BackstageForeverRosterLockouts\(\)[\s\S]{0,400}id~=guid and c\.lockouts/);
  const source = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverLockouts.lua"), "utf8");
  for (const banned of ["ResetInstances", "SetSavedInstanceExtend", "SendAddonMessage", "SendChatMessage"]) assert.ok(!source.includes(banned), `reading only: ${banned}`);
});

test("the guild events window builds, lists, answers and saves a new event through the api", () => lua(STUBS + String.raw`
local function widget(kind)
  local w={scripts={},shown=true,kind=kind}
  local methods={SetScript=function(self,k,fn) self.scripts[k]=fn end,SetText=function(self,t) self.text=t end,GetText=function(self) return self.text or '' end,
    Show=function(self) self.shown=true end,Hide=function(self) self.shown=false end,IsShown=function(self) return self.shown end,
    CreateFontString=function() return widget('text') end,CreateTexture=function() return widget('texture') end,
    LockHighlight=function(self) self.locked=true end,UnlockHighlight=function(self) self.locked=false end}
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
local buttons,boxes={},{}
CreateFrame=function(kind,name) local w=widget(kind);if name then _G[name]=w end;if kind=='Button' then buttons[#buttons+1]=w elseif kind=='EditBox' then boxes[#boxes+1]=w end;return w end
UIParent={} UISpecialFrames={}
local function click(label) for _,b in ipairs(buttons) do if b.text==label and b.shown then b.scripts.OnClick(b) return true end end error('no button '..label) end
-- A small api: two events, one of them yours.
local answered,created,changed
local list={{id='abc123',title='Molten Core',at=NOW+86400,dungeon='mc',creator='Ann',roles={t=2,h=4,d=14},note='Bring fire resist'},{id='mine01',title='Scholomance',at=NOW+7200,dungeon='scholo',creator='Me',roles={t=1,h=1,d=3}}}
BackstageForeverEventsApi={
  list=function() return list end,when=function(at) return 'T+'..(at-NOW) end,place=function(id) return id:upper() end,reason=function() return 'gone' end,
  mine=function(e) return e.id=='abc123' and 'h' or nil end,counts=function() return {t=1,h=1,d=0,m=0,n=0} end,names=function(e,s) return s=='t' and 'Bob' or s=='h' and 'Me' or '' end,
  mayEdit=function(e) return e.creator=='Me' end,places=function() return {{id='mc',name='Molten Core'},{id='scholo',name='Scholomance'},{id='other',name='Other'}} end,
  today=function() return {year=2026,month=11,day=18,hour=10,min=7} end,partsOf=function() return {year=2026,month=11,day=19,hour=20,min=40} end,
  dayStep=function(day,delta) return {year=day.year,month=day.month,day=day.day+delta} end,dayText=function(day) return day.year..'-'..day.month..'-'..day.day end,
  epoch=function(day,h,m) if h==2 then return nil,'gap' end return NOW+day.day*86400+h*3600+m*60 end,
  create=function(fields) created=fields if fields.title=='' then return nil,'Give the event a title.' end return {id='new001'} end,
  change=function(id,fields) changed={id,fields} return {id=id} end,
  answer=function(id,status) answered={id,status} return true end,
}
dofile('addon/BackstageForever/BackstageForeverEventsWindow.lua')
assert(BackstageForeverEventsWindowOpen()==true and BackstageForeverEvents.shown==true)
-- The first event is shown with its sign-ups; your answer is highlighted; you may not change Ann's event.
local function shown(text) for _,b in ipairs(buttons) do if b.text==text then return b.shown end end end
click('Tank') assert(answered[1]=='abc123' and answered[2]=='t')
click('No') assert(answered[2]=='n')
assert(shown('Change')==false and shown('Call off')==false,'not your event')
-- Pick your own event from the list (its row is a button without a label of its own).
for _,b in ipairs(buttons) do if b.event=='mine01' then b.scripts.OnClick(b) end end
assert(shown('Change')==true and shown('Call off')==true)
click('Call off') assert(changed[1]=='mine01' and changed[2].cancelled==true and last()=='Backstage Forever: Guild event called off: Scholomance.')
-- The form: a new event with the steppers, refused without a title, saved with one.
click('New event')
local title,note=boxes[1],boxes[2]
click('Save and share') assert(created.title=='' and created.dungeon=='mc' and created.roles.t==1 and created.roles.h==1 and created.roles.d==3)
title.text='Strat live' note.text='Bring holy water'
for _,b in ipairs(buttons) do if b.text=='>' and b.shown then b.scripts.OnClick(b) end end   -- every stepper one up: place, day, tanks, healers, damage
click('+1 h') click('+15') click('+15')
click('Save and share')
assert(created.title=='Strat live' and created.note=='Bring holy water' and created.dungeon=='scholo' and created.roles.t==2 and created.roles.h==2 and created.roles.d==4,created.dungeon)
assert(created.at==NOW+19*86400+21*3600+30*60,'the next day at 21:30: '..(created.at-NOW))
-- Changing your event opens the form with its values; a time the clocks skip is refused in words.
for _,b in ipairs(buttons) do if b.event=='mine01' then b.scripts.OnClick(b) end end
click('Change') assert(title.text=='Scholomance')
for i=1,6 do click('+1 h') end   -- 20:30 -> 02:30
changed=nil click('Save and share') assert(changed==nil,'not saved')
click('-1 h') click('Save and share') assert(changed[1]=='mine01' and changed[2].title=='Scholomance' and changed[2].dungeon=='scholo')
-- In combat it does not open, and it closes when a fight starts.
BackstageForeverEvents.scripts.OnEvent(BackstageForeverEvents) assert(BackstageForeverEvents.shown==false)
combat=true assert(BackstageForeverEventsWindowOpen()==false) combat=false
assert(BackstageForeverEventsWindowOpen('add')==true and BackstageForeverEvents.shown==true)
`));
