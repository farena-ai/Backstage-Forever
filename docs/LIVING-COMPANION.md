# Your Living Companion

BF has two useful views of your adventure:

- **Inside WoW:** Adventure Compass uses supported public game observations to update local guidance while you play, outside combat. No AI account or routine reload is needed for those changes.
- **On your desktop:** BF keeps the most recently saved character snapshots, your journal, references and optional AI connection. WoW writes new snapshots on logout, game exit or a voluntary UI reload. The desktop does not have a continuous character feed.

Once prepared, the addon's local guidance can run with the BF desktop app closed. Launch WoW normally and play. Open the desktop when you want your journal, deeper reference browsing, app/addon updates or optional AI.

## Start playing

Choose **Start my adventure** in BF. It looks for Forever, prepares its own companion files and verifies them. If several installations are found, choose the one you play; if none is found, choose the game folder once. Your provider connection is optional.

When Forever is closed, prepare the companion before launching the game. Use **Open Forever** where available, or your ordinary game launcher. Account sign-in remains yours. Enable Backstage Forever in the game's AddOns menu if needed. Adventure Compass then starts with your character and updates its guidance as permitted observations change.

If the game is already running, you can keep playing and load the companion on the next game launch. An already installed addon can generally load updated files with a voluntary UI reload; a brand-new addon that is not listed may require a game restart. BF never forces either action.

You can enter the desktop app once files are prepared. You do not have to create a manual character or submit an AI key to finish setup. Your saved characters appear automatically after the game writes their snapshots.

## Guidance while you play

The Compass prioritizes ready turn-ins and unfinished objectives, using current game titles and markers first. Its focus control lets you choose balanced guidance, nearby tasks or turn-ins. Session preference controls the size of the short plan, not a guaranteed completion time.

Compatible bundled Forever references can add approximate community locations. A reference point is labelled; it is not a guaranteed spawn or complete route. Unknown details stay unknown. A mentioned NPC is not automatically a quest finisher, and a reported chain link is not proof of every prerequisite.

Where a supported destination is available, use the Compass's waypoint action yourself. It checks the game build, quest state and supported marker APIs before placing a marker or printing coordinates. It does not move, target, interact, fight or open the game map for you.

The Compass hides during combat and resumes outside combat. Drag its title, collapse it with **−**, or close it with **X**. Use **/bf show**, **/bf hide** or **/bf status**. Position and display preferences belong to the current character.

## Switch characters

Each character you visit with the addon enabled can be captured. The Compass uses the character currently in the game. Saved captures reach the desktop when WoW saves them. BF can collect valid saved characters from more than one account folder in the connected Forever installation.

**Follow my last played character** controls the desktop selection after a new save. Deliberately selecting another character pauses following; switch it back on when you want automatic selection. Following off does not stop imports or remove the other characters. Existing notes and goals remain attached to their profiles.

Never-visited characters cannot be discovered through this addon. A stale desktop timestamp does not mean that native in-game guidance has stopped.

## When you want fresh desktop or AI context

Usually, let logout or game exit save naturally. If you want the desktop to reflect current progress immediately, voluntarily **/reload** in WoW and let BF import the saved file. Refreshing BF cannot force WoW to write unsaved data.

After loading a newly updated addon, another save may be necessary before the desktop receives fields captured by that version. This is an activation/save boundary, not something to repeat after every objective or level. The Compass can already use its current public observations while the desktop is waiting for a save.

Optional AI questions use the approved bounded public context shown in their preview. That context remains last-saved. The local Compass does not send questions or incur AI charges in the background.

## Compatibility and privacy

The native planner uses the bundled, build-specific reference slice. Desktop reference refreshes do not inject executable Lua into a running game. New bundled addon resources arrive through app updates and load when the game loads the addon. [Reference coverage and attribution](FOREVER-DATA.md) describe the limits.

Local running-game checks look only for the configured client through bounded OS process metadata. They do not read game memory or authenticate to your account. Unknown process status does not block setup. [Privacy](PRIVACY.md) explains what stays local and what an explicitly submitted AI question can share.

[Validation](VALIDATION.md) separates automated fixtures from actual in-client acceptance. An API being present does not certify that every feature works on every Forever build.
