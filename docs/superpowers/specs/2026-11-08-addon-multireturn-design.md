# Character snapshot multi-return repair

The live addon loads its HUD but writes a nil export. Class and race APIs return multiple values. Lua forwards those values to clean(value, limit), making a class token the numeric limit and aborting capture inside pcall.

Use explicit single-result parentheses at every default-limit public API string call. Alternatives are an extra local at every call (more repetition), or weakening clean to ignore invalid limits (masks caller errors). Preserve guards and API permissions. Test realistic class/race/faction tuples in the Lua VM, assert no interpreter stderr, run the full suite, then update only the owned addon capture script in the game and installed companion resources. Player-triggered reload is required; desktop disk export needs another reload/logout after first successful capture. No gameplay inputs or private character data are recorded in this spec.

## Compass usability extension

The owner reported title dragging failed and hiding was undiscoverable, then requested native WoW styling. Use the client dialog background/border and native close button, register drag on both parent and title, and provide a distinct collapse button. Keep reopen instructions visible before snapshots and while collapsed, and print `/bf show` after closing. Fit height to rendered text. Store validated position/visibility/collapse in per-character SavedVariables, which live separately from the account export and do not loosen the desktop parser. A full client restart may be necessary to register the new TOC declaration. Test drag, close, collapse, reopen, combat hiding and reload persistence in the Lua harness.
