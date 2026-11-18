local lines={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,message) lines[#lines+1]=message end}
local level,money=18,0
UnitLevel=function() return level end
GetMoney=function() return money end
InCombatLockdown=function() return false end
BackstageForeverSavedFacts=function() return {level=40,money=10000000,quests=24,profession=74} end
issecretvalue=function(v) return type(v)=='table' and v.secret==true end
local function loadJournal() dofile('addon/BackstageForever/BackstageForeverJournal.lua') end
local function command(args)
    lines={}
    BackstageForeverBadgesCommand('badges'..(args and ' '..args or ''))
    return table.concat(lines,'\n')
end
local function includes(text,part)
    assert(type(text)=='string' and text:find(part,1,true),tostring(text)..' must contain '..part)
end
local events,refreshes
CreateFrame=function()
    events={registered={}}
    function events:RegisterEvent(event) self.registered[event]=true end
    function events:SetScript(_,fn) self.dispatch=fn end
    return events
end
local function fire(event,...)
    assert(events.registered[event],event..' not registered')
    events.dispatch(events,event,...)
end
loadJournal()
return function(flow)
    if flow=='pin and clear' then
        includes(command(),'/bf badges pin')
        local choices=command('pin')
        includes(choices,'Level 20 18/20')
        includes(choices,'/bf badges pin level-20')
        includes(choices,'Wanderer 0/5')
        includes(command('pin level-20'),'Pinned: Level 20')
        includes(BackstageForeverNextBadgeLine(),'Pinned: Level 20 18/20')
        level=19
        includes(BackstageForeverNextBadgeLine(),'Pinned: Level 20 19/20')
        loadJournal()
        includes(BackstageForeverNextBadgeLine(),'Pinned: Level 20 19/20')
        local firstCharacter=BackstageForeverJournalDB
        BackstageForeverJournalDB={}
        assert(not BackstageForeverNextBadgeLine():find('Pinned:',1,true))
        BackstageForeverJournalDB=firstCharacter
        level=20
        includes(BackstageForeverNextBadgeLine(),'Pinned: Level 20 (goal reached)')
        includes(command('clear'),'Cleared')
        assert(not BackstageForeverNextBadgeLine():find('Pinned:',1,true))
    elseif flow=='live evidence' then
        includes(command('pin gold-10'),'Pinned: Pocket money 0/10')
        money=99000
        includes(BackstageForeverNextBadgeLine(),'Pinned: Pocket money 9/10')
        money={secret=true}
        includes(BackstageForeverNextBadgeLine(),'Pinned: Pocket money (progress unavailable)')
        money=nil
        assert(not command('pin'):find('gold-10',1,true),'Must not suggest an unavailable balance')
        GetMoney=function() error('restricted') end
        includes(BackstageForeverNextBadgeLine(),'Pinned: Pocket money (progress unavailable)')
        command('clear')
        level=nil
        assert(BackstageForeverNextBadgeLine()==nil,'Unpinned Compass must not imply progress from saved facts')
        assert(not command():find('Next:',1,true),'Chat must not suggest progress from saved facts either')
    elseif flow=='invalid choices' then
        includes(command('pin explorer-5'),'Pinned: Wanderer 0/5')
        BackstageForeverJournalZone(10)
        BackstageForeverJournalZone(10)
        includes(BackstageForeverNextBadgeLine(),'Pinned: Wanderer 1/5')
        for _,args in ipairs({'pin level-10','pin quests-25','pin profession-75','pin nope','pin level-30 extra','clear extra'}) do
            assert(not command(args):find('Cleared',1,true))
            includes(BackstageForeverNextBadgeLine(),'Pinned: Wanderer 1/5')
        end
        InCombatLockdown=function()return true end
        command('pin level-30');command('clear')
        InCombatLockdown=function()return false end
        includes(BackstageForeverNextBadgeLine(),'Pinned: Wanderer 1/5')
        BackstageForeverJournalDB.pinnedBadge='removed-id'
        assert(not (BackstageForeverNextBadgeLine() or ''):find('Pinned:',1,true))
    elseif flow=='refresh events' then
        refreshes={}
        BackstageForeverHUDRefreshBadge=function()
            refreshes[#refreshes+1]=BackstageForeverPinnedBadgeLine() or 'cleared'
        end
        command('pin gold-10')
        includes(refreshes[1],'0/10')
        money=21000
        fire('PLAYER_MONEY')
        includes(refreshes[2],'2/10')
        command('pin explorer-5')
        includes(refreshes[3],'0/5')
        fire('PLAYER_MONEY')
        assert(#refreshes==3,'Unrelated money events must not redraw the badge')
        C_Map={GetBestMapForUnit=function()return 10 end,GetMapInfo=function()return {mapType=3}end}
        fire('ZONE_CHANGED_NEW_AREA')
        includes(refreshes[4],'1/5')
        fire('ZONE_CHANGED_NEW_AREA')
        assert(#refreshes==4,'Repeated zone events must not redraw the badge')
        command('clear')
        assert(refreshes[5]=='cleared')
    elseif flow=='durable completion' then
        -- The legacy toast history is not proof that this Compass goal was reached.
        BackstageForeverJournalDB={badges={'gold-10'}}
        includes(command('pin gold-10'),'Pinned: Pocket money 0/10')
        money=100000
        includes(BackstageForeverPinnedBadgeLine(),'Pinned: Pocket money (goal reached)')
        money=10000
        includes(BackstageForeverPinnedBadgeLine(),'Pinned: Pocket money (goal reached)')
        money={secret=true}
        loadJournal()
        includes(BackstageForeverPinnedBadgeLine(),'Pinned: Pocket money (goal reached)')
        local owner=BackstageForeverJournalDB
        BackstageForeverJournalDB={pinnedBadge='gold-10'}
        includes(BackstageForeverPinnedBadgeLine(),'progress unavailable')
        BackstageForeverJournalDB=owner
        command('clear')
        assert(BackstageForeverPinnedBadgeLine()==nil)
        money=95000
        assert(not command('pin'):find('Pocket money',1,true),'A confirmed goal must not be offered again')
        assert(not BackstageForeverNextBadgeLine():find('Pocket money',1,true),'A confirmed goal cannot be next')
        includes(command('pin gold-10'),'already at its goal')
        assert(BackstageForeverPinnedBadgeLine()==nil)
    elseif flow=='completion without HUD' then
        BackstageForeverJournalDB={badges={}}
        local refreshes=0
        BackstageForeverHUDRefreshBadge=function() refreshes=refreshes+1 end
        command('pin gold-10')
        InCombatLockdown=function()return true end
        money={secret=true}
        fire('PLAYER_MONEY')
        money=90000
        includes(BackstageForeverPinnedBadgeLine(),'9/10')
        money=100000
        fire('PLAYER_MONEY')
        money=0
        fire('PLAYER_MONEY')
        assert(refreshes==1,'There must be no badge repaint during combat')
        assert(#BackstageForeverJournalDB.badges==0,'Compass confirmation must not mutate legacy toast history')
        BackstageForeverHUDRefreshBadge=nil
        InCombatLockdown=function()return false end
        loadJournal()
        includes(BackstageForeverPinnedBadgeLine(),'Pinned: Pocket money (goal reached)')
    end
    print('ok')
end
