# Compatibility and evidence

Evidence date: **2026-11-08**. The desktop's manual profiles do not depend on a game API. Windows installer signing, clean-machine acceptance and upgrade verification remain release gates. Automated provider fixtures are not live cloud authentication tests.

## Forever client

A local installation was inspected: `_forever_` exists, and `.build.info` identifies product `wowf`, version `1.60.1.70862`. This confirms files on disk, not addon compatibility. No in-client API test or modern API parity certification has been completed. Do not infer a supported interface number from that product version.

Blizzard's [Forever landing page](https://worldofwarcraft.blizzard.com/en-us/forever/) and [Midnight combat philosophy and addon disarmament](https://worldofwarcraft.blizzard.com/en-gb/news/24246290/combat-philosophy-and-addon-disarmament-in-midnight) were indexed in search, but direct retrieval returned HTTP 403. They are primary-source pointers, not directly retrieved API contracts. Third-party API claims are not certification for this client. Combat-related restrictions are one reason this project stays with explicit out-of-combat manual records.

## Experimental addon: deliberate local test only

The source contains `addon/BackstageForever/BackstageForever.toc.template`, not an install-ready `.toc`. It deliberately has no guessed interface number. All API calls in the prototype remain unverified in the intended client.

1. Back up your addon settings and close the game before copying anything. This project does not auto-install or modify the game.
2. In the intended client, outside combat, retrieve the interface number using `/dump select(4, GetBuildInfo())` if that diagnostic command is supported there. If it is unavailable or unclear, stop and seek client-specific primary documentation. Record the client version, build and fourth return value; do not substitute a retail interface number.
3. In a separate test copy of the addon folder, rename `BackstageForever.toc.template` to `BackstageForever.toc`, replace `REPLACE_WITH_VERIFIED_INTERFACE` with that verified integer, and save it as UTF-8. This only selects a loader version; it does not validate the rest of the API.
4. Manually place that test folder under the intended client's addon directory, commonly `_forever_/Interface/AddOns/BackstageForever`. Verify the path for your installation first. Restart the client and check its addon list/errors. Do not force-load incompatible code merely to suppress a warning.
5. Outside combat, try `/backstageforever`. Confirm the text matches your character and that Ctrl+C copies it. Starting combat should hide the panel; invoking the command during combat should refuse to open it. Record any errors and disable/remove the test addon if behavior differs.

The panel contains name, realm, class, level and build evidence. Enter relevant details manually in the desktop. It is not a supported import format, executable import, synchronization mechanism or real-time bridge. No addon is needed for normal desktop use. Validation of loading, APIs, combat behavior and uninstall is still pending; structural Node tests cannot replace these in-client checks.
