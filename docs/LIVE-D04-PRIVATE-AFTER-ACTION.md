# LIVE-D04 — Private after-action review

Open **Characters → Journey → Private after-action review**. The timeline shows observations from the last seven days for the selected character:

- **Live link:** recorded session start, recorded play, and recorded deaths, for sessions checkpointed against the same saved addon source. Older sessions without that association remain in Past sessions but cannot establish character ownership for this review. The date belongs to the session start, not to any death.
- **Addon save:** dated Deadmines boss defeats from the 5A progression projection, limited to five recent retained rows. The saved build qualifies the projection, but the individual defeat’s capture build is unknown.

Rows from the two sources are not joined into a dungeon run. Empty or partial coverage does not establish a failure, cause, score, completion, or exact time for an event that was not recorded.

The review has one optional note and one manually written next improvement. It can be saved, edited or cleared independently of the observed records and the private weekly timeline. It stays in main-process memory for the current app session (including renderer reloads), scoped by character, saved source identity and build. Successful journal replacement or reset retires it. The existing local session checkpoint records its saved-source association; there is no new live capture, journal schema change, or path for the review into Companion, backups, Guild Run Packs or officer exports.

Synthetic checks: `node --test tests/private-after-action.test.cjs` and `node scripts/private-after-action-smoke.cjs` (isolated Electron profile, no live client).
