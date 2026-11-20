# W7 7C / LIVE-X06 — Local plan pack

In **Help → Field guide → Local plan pack**, select a UTF-8 JSON file or paste the JSON and choose **Preview import**. Review the active and proposed checklists, then choose **Import reviewed plan** to activate the replacement. The dialog has a **Load example** button for a first import.

Version 1 supports exactly one scope: a manual preparation checklist for **The Deadmines in WoW Forever**. No live, build-specific or character evidence is inferred. For example:

```json
{
  "format": "backstage-forever-plan-pack",
  "version": 1,
  "scope": "forever:deadmines:preparation",
  "revision": 1,
  "steps": ["check-supplies", "repair-gear", "confirm-roles", "agree-meeting-point"]
}
```

Use one to four distinct step IDs from the example in the order to show them. A replacement revision must be a positive safe integer greater than the active revision. Unknown and duplicate fields, unrecognized steps, unsupported formats/versions/scopes, invalid JSON and input over 4,096 UTF-8 bytes are rejected. Imported strings are IDs, not authored instructions, commands, links or markup.

The first import has no rollback target. A successful replacement keeps the exact previous JSON in the same local store as the active pack. **Preview previous plan → Restore previous plan** restores those bytes, consumes that rollback copy and does not restore a journal. Cancelling or closing the preview does not commit anything. An interrupted or failed promotion never treats its staging file as an active plan.

The feature is offline and installation-local, not per character. It does not add a journey, modify profiles or game files, or appear in backups, Guild Run Packs or provider context. Current-version full reset removes it. Older versions do not know about this separate store; their resets do not remove it. The pack holds only the fixed-scope checklist, never character data.

Qualification:

```sh
node --test tests/local-plan-pack.test.cjs
node scripts/local-plan-pack-smoke.cjs
```
