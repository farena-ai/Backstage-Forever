# Backstage Desk — API contract (v1 additions)

Authoritative for both the server agent and the app agent. It extends
`community-server/CLIENT-CONTRACT.md` (read that first: install id, common responses, strict
unknown-field rejection, rate limits, body rules all apply unchanged). The server agent copies this
into CLIENT-CONTRACT.md as new sections. If something here is impossible, the server agent says so
in its report; neither side silently changes the contract.

Shared rules
- JSON only, HTTPS only, no cookies and no auth headers on `/v1/*` (cookies exist only under `/admin`).
- `installId`: UUID v4 string. Server stores only `hashInstall(installId)` (existing salted HMAC).
- `appVersion`, `addonVersion`: `^\d{1,3}\.\d{1,3}\.\d{1,3}$` (addonVersion may be `null`).
- `build`: game build `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$` or `null`.
- `os`: `"windows" | "macos" | "linux"`; `osMajor`: string `^[0-9]{1,3}$` or `null`.
- `lang`: `"en" | "de" | "fr" | "es"`. `channel`: `"stable" | "beta" | "dev"`.
- Text fields are plain text, NFC, no control characters except `\n`; the server stores them as
  given and always HTML-escapes on output. Limits are in characters.
- The server never stores IP addresses; rate limiting is in memory.
- Times are ISO-8601 UTC strings (`2026-11-24T12:00:00Z`).

## D1. `POST /v1/heartbeat` — anonymous statistics (at most once per UTC day per install)
Body limit 2 KB. Limit: 6 per install per day (extra ones are accepted and ignored: 200).
```json
{ "schema": 1, "installId": "…", "appVersion": "1.26.0", "addonVersion": "1.26.0", "channel": "stable",
  "os": "windows", "osMajor": "11", "lang": "en", "build": "1.60.1.71037",
  "firstSeenWeek": "2026-W48",
  "flags": { "gameConnected": true, "addonInstalled": true, "liveLink": false, "sharing": true },
  "areas": ["now", "route", "map", "dungeons", "professions", "ledger", "talents", "journey", "companion"] }
```
- `firstSeenWeek`: ISO week the app first ran, `^\d{4}-W\d{2}$` (the app remembers it; the server
  also keeps its own first-seen date per hash and prefers its own).
- `flags`: exactly these four booleans. `areas`: subset of the nine names above, no duplicates.
- Response `200 {"ok":true}`. `403 blocked` as usual.
- Server keeps one row per (hash, UTC day): last values win.

## D2. `POST /v1/tickets` — open a report
Body limit 24 KB. Limits: 5 per install per day, 200 global per day; `503 report_inbox_full` when the
open-ticket cap is reached.
```json
{ "schema": 1, "installId": "…", "appVersion": "1.26.0", "addonVersion": "1.26.0", "os": "windows",
  "osMajor": "11", "lang": "en", "build": "1.60.1.71037",
  "kind": "bug", "area": "talents", "frequency": "always",
  "summary": "Planner shows the wrong tree", "details": "Steps…", "expected": "…",
  "diagnostics": { "screen": "talents", "lastError": "TypeError: … (paths removed)", "gameConnected": true, "addonInstalled": true } }
```
- `kind`: `"bug" | "data" | "translation" | "idea" | "other"`.
- `area`: one of `now, route, map, quests, dungeons, professions, ledger, talents, gear, journey,
  companion, travel, settings, addon-ingame, install-update, website, other`.
- `frequency`: `"once" | "sometimes" | "always" | null`.
- `summary` 5–140 chars; `details` 10–4000; `expected` 0–1000 (may be `""`).
- `diagnostics`: optional object or `null`; fields exactly as shown; `lastError` ≤ 2000 chars or `null`.
- Response `201 {"ok":true,"ticket":"BF-1042","key":"<43-char base64url secret>","status":"new","createdAt":"…"}`.
  The server stores only a hash of `key`. The key is shown once; the app stores it locally.

## D3. `GET /v1/tickets/{ticket}` — read one ticket (the conversation)
Header `X-BF-Ticket-Key: <key>`. (This is the one place a header carries a secret.) Wrong or missing
key → `404 not_found` (never reveals whether the ticket exists). Limit: 120 per install-less client per
hour per ticket key hash.
Optional query `since=<message id>` returns only newer messages.
```json
{ "ok": true, "ticket": "BF-1042", "status": "question", "fixedIn": null, "kind": "bug", "area": "talents",
  "summary": "…", "createdAt": "…", "updatedAt": "…",
  "messages": [ { "id": 1, "from": "player", "text": "…", "at": "…" },
                { "id": 2, "from": "team", "text": "…", "at": "…" } ] }
```
- `status`: `"new" | "looking" | "question" | "fixed" | "closed"`; `fixedIn`: version string or `null`.
- Internal notes are never included. `from` is `"player"` or `"team"` (no admin names).

## D4. `POST /v1/tickets/{ticket}/messages` — player reply
Header `X-BF-Ticket-Key`. Body `{ "schema": 1, "text": "…" }`, text 1–4000 chars, body limit 12 KB.
Limit 20 per ticket per day. A reply to a `fixed` or `closed` ticket re-opens it as `looking`.
Response `201 {"ok":true,"id":3,"at":"…","status":"looking"}`.

## D5. `POST /v1/tickets/sync` — check many tickets at once (what the app polls)
Body limit 8 KB: `{ "schema": 1, "tickets": [ { "ticket": "BF-1042", "key": "…", "since": 2 } ] }` (max 50).
Response: `{ "ok": true, "tickets": [ { "ticket": "BF-1042", "status": "question", "fixedIn": null,
"updatedAt": "…", "unread": 1, "lastId": 3 } ], "gone": ["BF-0007"] }` — `gone` lists tickets that no
longer exist or whose key did not match (the app removes them). App polls at start, then every 3 hours
while it has tickets not `closed`, with the usual backoff.

## D6. `DELETE /v1/tickets/{ticket}` — player deletes a report
Header `X-BF-Ticket-Key`. Response `200 {"ok":true}`. Removes the ticket and its messages.
`POST /v1/forget` (existing) additionally deletes every ticket and heartbeat row of that install hash.

## D7. `POST /v1/errors` — automatic error report (only if the player switched it on)
Body limit 8 KB. Limits: 10 per install per day.
```json
{ "schema": 1, "installId": "…", "appVersion": "1.26.0", "os": "windows", "osMajor": "11", "lang": "en",
  "where": "main" , "name": "TypeError", "message": "… (paths removed)", "stack": ["at f (app.js:10:3)", "…"] }
```
- `where`: `"main" | "renderer"`. `name` ≤ 60, `message` ≤ 300, `stack`: ≤ 12 lines, each ≤ 200, file
  names only (no directories). The server groups by a signature of name + first three stack lines.
- Response `200 {"ok":true}`.

## D8. `GET /v1/announcements?appVersion=1.26.0&os=windows&lang=en` — messages from the team
Anonymous, cacheable for 1 hour (`Cache-Control: public, max-age=3600`, ETag, 304 supported).
```json
{ "ok": true, "announcements": [ { "id": 12, "title": "…", "text": "…", "level": "info",
  "from": "2026-11-24T00:00:00Z", "until": "2026-12-01T00:00:00Z", "link": null } ] }
```
- `level`: `"info" | "warning"`; `title` ≤ 80, `text` ≤ 600; `link` is `null` or an https URL on
  `github.com/farena-ai/Backstage-Forever` or `backstagecoding.com` only. The server filters by
  version range, OS and language server-side; the app shows each id once.

## D9. `GET /v1/health` gains `"desk": true`.

## Admin area (server only; the app never calls it)
`/admin/*`, HTML pages rendered by the server, cookie session. Not part of the app contract; the
server agent designs it to the roadmap in `C:\Users\faren\Projects\Backstage-Forever-Next-Roadmap.md`
Part 1B–1C. The web server must proxy `/admin/` to the service the same way it proxies `/v1/`.
