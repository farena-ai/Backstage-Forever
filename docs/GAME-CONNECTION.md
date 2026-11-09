# Game connection

Open Game Connection, choose your World of Warcraft: Forever client folder, and install the companion addon. The installer updates only BackstageForever's own addon files. Enable the addon in WoW; if the game was already running, load it on your next restart or voluntary UI reload.

The addon tracks public character information while you play, including name, realm, class, level, race, faction and available zone/location data. It remembers characters you have actually visited with the addon enabled. It cannot discover every character on your account through a magical account API.

**Levelled up or changed areas? Type `/reload` in WoW to refresh your companion.**

WoW writes the saved snapshot to disk on UI reload or logout. The desktop checks for saved exports while it is open and imports changes automatically. This is a saved snapshot, not a realtime feed: moving, levelling or changing areas in the game does not immediately write a desktop file. The displayed snapshot time tells you how old that information is. Backstage Forever never forces a reload, logs you out, reads game memory, or automates gameplay.

Follow my last played character starts enabled. The newest saved export selects its active character until you deliberately choose another profile; that pauses automatic selection while every character's saved details continue updating. Restore the checkbox in Game Connection to follow again. Imported characters keep their stable identity even after a name or realm change. Newer records update game fields; older records cannot roll them back. Your notes, goals and unrelated manual profiles stay intact. A manual profile becomes linked only when its exact name and realm uniquely identify one imported character. Ambiguous matches stay separate. The local roster is limited to 100 profiles; at the limit existing profiles can still update, but additional characters are skipped.

Disconnecting stops automatic imports and keeps the characters already imported. A missing or incomplete saved file also leaves your last good profiles intact. Reconnect or refresh after a valid export becomes available. Backups include character profiles and their snapshot metadata, but the machine-specific game-folder connection is stored separately. Account folder names, local paths and source identifiers are not automatically sent to the AI; the character context preview shows the game details offered to the provider.

Addon compatibility uses guarded public APIs and the Forever Interface 16001 declaration. Desktop parser and synthetic addon-runtime tests do not establish that a particular running game client has loaded the addon; confirm it is enabled and export a snapshot in your client.
