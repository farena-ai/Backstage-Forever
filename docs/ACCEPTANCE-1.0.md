# 1.0 acceptance checklist

Backstage Forever goes to 1.0 after one hands-on session in the real game. This list covers what automated tests can't prove. It takes about an hour of normal play on Windows.

For each item, tick the box or write a few words about what you saw. Anything that doesn't match gets fixed and checked again before 1.0.

## Before you start

- [ ] Install the latest release candidate (or let the app update itself), then open the app.
- [ ] Log in to WoW Forever with any character and type `/reload` once.

## In the game

1. **Adventure Compass.** After `/reload`, the compact Compass shows your XP, pace, quests ready to hand in and the next step. Drag it by the title and collapse it; it hides during combat and comes back after.
   - [ ] Looks right and stays readable
2. **Guided route.** Type `/bf route guide`. A step frame appears with the game's arrow on the current step. Hand in or pick up a quest on the route: the guide moves to the next step by itself.
   - [ ] Steps match what you do
3. **Next step and finding things.** `/bf next`, `/bf train` and `/bf find flight` each point the arrow somewhere sensible near you.
   - [ ] Arrows point the right way
4. **Quest progress in tooltips.** Hover an enemy you need for a quest: its tooltip shows your progress (for example "3/8").
   - [ ] Shown on the right enemies
5. **Helpers.** Turn on `/bf qol dismount on`, then talk to a flight master while mounted: you get off your mount by yourself and can pick a flight. Visit a vendor with grey items: the Sell junk button sells only greys.
   - [ ] Both work
6. **Enemy player alerts** (only if you're on contested ground anyway). An enemy player nearby gives one quiet alert, not a stream of them.
   - [ ] Alert is useful, not noisy (or: not seen this session)
7. **Ask panel.** Click the owl on the minimap and ask "where is the nearest flight master?". The answer appears under your question, and Esc gives the keyboard back to the game. Try it in full-screen mode too.
   - [ ] Opens, answers and closes cleanly
8. **Professions.** Open one of your professions in game (for example Tailoring), close it, then type `/reload` so the game writes your save. On the desktop, Professions shows your recipes and the next one worth making, not "Open a profession in game once". Your professions are listed once each.
   - [ ] Recipes show up

## On the desktop

9. **Live link.** With the game running, Now follows you: your zone changes when you move, and a quest you hand in shows as done without `/reload`. Minimize WoW: the app says live updates are paused, then picks up again when you bring the game back.
   - [ ] Follows you and recovers
10. **Now and Mini Now.** "Do this next" matches what the game shows. Mini Now stays beside the game and shows the same step.
    - [ ] Matches
11. **World Map.** Your arrow is in the right place on your zone's map, and a "Show on map" link from Now opens the map on that exact spot.
    - [ ] Right place
12. **Log out.** Log out of the game. Within a few seconds the app shows the fresh save, and your notes and goals are still there.
    - [ ] Saved and nothing lost
13. **Problem report.** Help → Field guide → prepare a diagnostic report. Read it: no character names, no realm, nothing private.
    - [ ] Clean

## Known limits for 1.0

These are listed as unconfirmed rather than required for 1.0:

- **Party sync** needs a second player with the addon.
- **The Mac app** has been checked on GitHub's Macs, not yet on a real Mac by a person.
- **German messages in the game** need a German game client. The app's German is reviewed on every page.

If you happen to try any of them, note what you saw here and it moves out of this list.

## Record (2026-11-16)

Frank played on Windows with 0.57.0 to 0.58.0 and reported the app "functional". What came up and what was confirmed:

| Item | Result |
|---|---|
| 8. Professions | **Fixed and confirmed.** It kept saying "Open a profession in game once" even after the window was opened: the addon never read recipes on Forever. After 0.57.1 and 0.57.2, the real save held 41 Tailoring recipes with reagents and colours, and Professions advised "Gather supplies for Heavy Woolen Gloves". Each profession is listed once. |
| Update banner | **Fixed and confirmed.** It needed two `/reload`s after every update; 0.57.3 clears it after one. |
| 12. Log out / save | **Confirmed.** Several real saves (0.57.1 to 0.58.0) reached the app within seconds, with notes and characters intact. |
| Portraits | **Confirmed.** Rolica's save records Undead, female, Priest (0.58.0), and the app picks the matching portrait. |
| 13. Problem report | **Confirmed.** Generated from the real app state: no character name or realm appears. The report is built only from fixed values such as version, platform, counts and phases. |
| 1–7, 9–11 | Used during play and reported working. No problems reported. |

The 1.0 dry run (version 1.0.0, stable channel) passed all 55 release gates and built the 1.0 installer. It found one real bug, quest waypoints refusing 1.x addon saves, fixed in 0.58.
