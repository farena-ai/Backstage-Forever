"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
test("supply advice: ammo, food, pet, shards and poisons, each only when it matters", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverSupplies.lua')
local function keys(r) local k={} for _,a in ipairs(BackstageForeverSupplyAdvice(r)) do k[#k+1]=a.key end return table.concat(k,',') end
assert(keys({className='Hunter',level=20,ranged='bow',ammo=40,food=10})=='ammo-out')
assert(keys({className='Hunter',level=20,ranged='gun',ammo=150,food=10})=='ammo-low')
local a=BackstageForeverSupplyAdvice({className='Hunter',level=20,ranged='gun',ammo=150,food=10})[1]
assert(a.title:find('bullets',1,true) and a.sub:find('/bf find vendor',1,true))
assert(keys({className='Hunter',level=20,ranged='bow',ammo=900,food=10,petHappiness=1})=='pet-unhappy')
assert(keys({className='Mage',level=12,food=0})=='food-out')
assert(keys({className='Mage',level=3,food=0})=='','new characters are not nagged about food')
assert(keys({className='Warlock',level=20,shards=0,food=9})=='shards-out')
assert(keys({className='Rogue',level=25,instance=true,poisoned=false,food=9})=='poison')
assert(keys({className='Rogue',level=25,instance=false,poisoned=false,food=9})=='')
assert(keys(nil)=='')
`));
test("/bf supplies reads bags and the ammo slot and lists what to restock; reminders fire once per problem", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local toasts={} BackstageForeverToast=function(t,s) toasts[#toasts+1]=t end
local handler
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,_,fn) handler=fn end} end
UnitLevel=function() return 22 end UnitClass=function() return 'Hunter' end
GetInventorySlotInfo=function() return 0 end GetInventoryItemID=function() return 2504 end
GetItemInfo=function() return 'Bow',nil,nil,nil,nil,'Weapon','Bows' end
local ammo=120 GetInventoryItemCount=function() return ammo end
UnitExists=function() return true end GetPetHappiness=function() return 3 end
C_Container={GetContainerNumSlots=function(b) return b==0 and 2 or 0 end,GetContainerItemInfo=function(_,s) return {itemID=s==1 and 4540 or 25,stackCount=s==1 and 3 or 1} end}
GetItemInfoInstant=function(id) if id==4540 then return id,'Consumable','Food & Drink',nil,nil,0,5 end return id,'Weapon','Swords',nil,nil,2,7 end
InCombatLockdown=function() return false end
local t=0 GetTime=function() t=t+5 return t end
dofile('addon/BackstageForever/BackstageForeverSupplies.lua')
BackstageForeverSuppliesCommand('supplies')
assert(said[1]=='Backstage Forever: Supplies: 120 arrows, pet happy, 3 food and drink.',said[1])
handler(nil,'PLAYER_LOGIN')
assert(#toasts==0,'no pop-ups at login')
handler(nil,'BAG_UPDATE_DELAYED')
handler(nil,'BAG_UPDATE_DELAYED')
assert(#toasts==0,'already known problems stay quiet')
ammo=1000 handler(nil,'BAG_UPDATE_DELAYED') ammo=30 handler(nil,'BAG_UPDATE_DELAYED')
assert(#toasts==1 and toasts[1]=='Almost out of arrows',toasts[1])
BackstageForeverSuppliesCommand('supplies off') assert(BackstageForeverSuppliesSettings.enabled==false)
`));
