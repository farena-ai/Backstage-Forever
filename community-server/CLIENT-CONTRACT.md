# Backstage Forever community server: client contract

This is the exact API the desktop app uses to share and download community data.
Server code lives next to this file. API version: `v1`. Pack format: `1`.

- Base URL: `https://bf.backstagecoding.com` (HTTPS only; plain HTTP is redirected with 308).
- Every request and response body is JSON (UTF-8). POST requests must send
  `Content-Type: application/json` and must not compress the body.
- No cookies, no auth headers, no CORS on `/v1/*`. The service is meant for the desktop app only.
  (The one exception is the `X-BF-Ticket-Key` header of section 10. Cookies exist only under
  `/admin/`, the team's admin area, which the app never calls.)
- Unknown fields are rejected anywhere in a request. Send only the fields listed here.

## 1. Install id and the sharing switch

- On first run, generate a random UUID v4 locally (`crypto.randomUUID()`) and save it in the
  app's userData. It is not derived from the account, machine, character or anything else.
- The server stores only a salted SHA-256 (HMAC) of it. It uses the hash to count distinct
  reporters (k-anonymity) and to rate-limit. The raw id is never stored.
- **Community sharing is ON by default** and has an easy off switch in Settings. When it is off,
  the app sends no `submit` requests. Downloading the pack is an anonymous read and may stay on;
  give it its own toggle if you want one.
- Settings should also offer **Forget my contributions**, which calls `POST /v1/forget` (section 6)
  and then generates a new install id. Show the id (or its first 8 characters) so a user can quote
  it in a deletion request. The owner can also purge it with `admin.js purge-install <installId>`.

## 2. Common responses

| Status | Body | Client action |
|---|---|---|
| 200 / 201 | `{"ok":true,...}` | success |
| 304 | empty | pack unchanged (only for conditional GET) |
| 400 | `{"ok":false,"error":"invalid","detail":"observations.npcs[3].x: must be a number 0..1"}` or `"invalid_json"` | client bug: drop that batch, log `detail`, **do not retry** |
| 403 | `{"ok":false,"error":"blocked"}` | this install was blocked by the owner: stop submitting |
| 404 / 405 | `not_found` / `method_not_allowed` (with an `Allow` header) | client bug. For a ticket (section 10): the ticket is gone or the key is wrong; remove it locally |
| 413 | `body_too_large` | split the batch (submit) or trim the log (report) |
| 415 | `json_required` / `encoding_not_supported` | client bug |
| 429 | `rate_limited`, with a `Retry-After` header in seconds | wait at least `Retry-After`, then retry the same batch |
| 503 | `report_inbox_full` | report not stored; tell the user to try again later |
| 500 / 502 / 503 / 504 / network error | | keep the batch; retry with exponential backoff (1 min doubling to 6 h max) |

Errors never contain stack traces. Responses other than the pack are sent with `Cache-Control: no-store`.

## 3. `POST /v1/submit`: share observations

Body limit 256 KB. At most **500 entries in total** across all arrays in one request, and the
batch may expand to at most 5,000 stored facts (each node item, vendor item and drop item counts
as one). Send at most once every 10 minutes, plus once on exit. Limit: 30 requests per install
per hour.

```json
{
  "schema": 1,
  "installId": "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f",
  "build": "1.15.8.66000",
  "appVersion": "0.31.0",
  "observations": {
    "nodes":   [{ "kind": "herb", "objectId": 1617, "mapId": 1429, "x": 0.45, "y": 0.6, "itemIds": [2447] },
                { "kind": "ore", "name": "Copper Vein", "mapId": 1429, "x": 0.305, "y": 0.3 }],
    "npcs":    [{ "npcId": 197, "mapId": 1429, "x": 0.485, "y": 0.42 }],
    "vendors": [{ "npcId": 1213, "itemIds": [159, 4540] }],
    "drops":   [{ "npcId": 448, "loots": 10, "items": [{ "itemId": 1931, "count": 3 }] }],
    "recipes": [{ "source": "trainer", "npcId": 1215, "spellId": 2330 },
                { "source": "vendor", "npcId": 1250, "itemId": 2889 }]
  }
}
```

Top level: `schema` (must be `1`), `installId` (UUID v4), and `observations` (at least one entry)
are required. `build` is optional and must match `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$` (the
client build string). `appVersion` is optional and must match `^[0-9A-Za-z.+-]{1,32}$`.
Every array inside `observations` is optional.

All ids are integers from 1 to 2147483647. `mapId` is the UI map id. `x` and `y` are map
fractions from 0 to 1, as `C_Map` returns them.

**Round coordinates in the client before sending.** Use `Math.round(v * 200) / 200`, which
snaps to 0.5% of the map, so exact positions never leave the computer. The server rounds again
either way.

| Array | Entry fields | Rules |
|---|---|---|
| `nodes` | `kind` (`herb` \| `ore` \| `chest`), `objectId`?, `name`?, `mapId`, `x`, `y`, `itemIds`? | Needs `objectId` or `name`. When `objectId` is present it is the identity and `name` is ignored. Send `name` only when the object id is unknown: 1 to 120 characters, letters, digits, spaces and `'’.,:()&!-` only. `itemIds`: up to 16 unique ids gathered from that node. App mapping: `herbalism` → `herb`, `mining` → `ore`, `chest` → `chest`; `entityId` → `objectId`. |
| `npcs` | `npcId`, `mapId`, `x`, `y` | One position where the NPC was seen. |
| `vendors` | `npcId`, `itemIds` | 1 to 200 unique item ids that the vendor sells. |
| `drops` | `npcId`, `loots`, `items` | `loots` (1 to 1000) is the number of loot windows opened on that creature since the last successful submit. `items` (0 to 64) lists `{ "itemId", "count" }`, where `count` (1 to `loots`) is how many of those windows contained the item. Include kills that dropped nothing listed, with `items: []`; they are the denominator. **Send deltas only.** After a 200, reset the counters you sent. Never resend a batch that got a 200. |
| `recipes` | `source` (`trainer` \| `vendor`), `npcId`, `spellId`?, `itemId`? | Needs `spellId` (trainer-taught recipe spell) or `itemId` (recipe item sold by a vendor), or both. |

Never send character names, GUIDs, realm, account data, chat, guild or party info, or free text.
The schema has no place for them and the server rejects unknown fields.

Response: `200 {"ok":true,"stored":7}`. `stored` is the number of facts recorded. Duplicates
from the same install don't add reporters. Repeated spots and pairings are harmless (deduplicate
locally anyway to save bandwidth). Repeated drop deltas do inflate that install's counts, which
is why drops must be deltas.

## 4. `GET /v1/pack`: the community pack (once a day)

- Fetch at most once per 24 hours (plus on first run). Send `If-None-Match: <stored ETag>` and
  `Accept-Encoding: gzip`. A `304` means the cached pack is still current.
- Response headers: `ETag: "<version>"`, `Last-Modified`, `Cache-Control: public, max-age=3600`,
  `Vary: Accept-Encoding`, `Content-Encoding: gzip` when requested. `HEAD` is supported.
- The server rebuilds the pack at most every 5 minutes, and only when data changed. `version`
  (and so the ETag) depends only on the published content.

```json
{
  "format": 1,
  "version": "a1b2c3d4e5f6a7b8c9d0",
  "generatedAt": "2026-11-13T18:00:00.000Z",
  "minInstalls": 3,
  "coordStep": 0.005,
  "nodes":     { "columns": ["kind","objectId","name","mapId","x","y","installs"], "rows": [["herb",1617,null,1429,0.45,0.6,3]] },
  "nodeItems": { "columns": ["kind","objectId","name","itemId","installs"],      "rows": [["herb",1617,null,2447,3]] },
  "npcs":      { "columns": ["npcId","mapId","x","y","installs"],                 "rows": [[197,1429,0.485,0.42,3]] },
  "vendors":   { "columns": ["npcId","itemId","installs"],                        "rows": [[1213,159,3]] },
  "drops":     { "columns": ["npcId","itemId","rate","samples","installs"],      "rows": [[448,1931,0.3,30,3]] },
  "recipes":   { "columns": ["source","npcId","spellId","itemId","installs"],    "rows": [["trainer",1215,2330,null,3]] }
}
```

- A row appears only when at least `minInstalls` (3) distinct installs reported the same
  rounded spot or the same pairing. `installs` is that count.
- In `nodes` and `nodeItems`, exactly one of `objectId` and `name` is non-null.
- `x`/`y` are 0..1 fractions on the 0.005 grid (so the true spot is within ±0.0025).
- `drops.rate` is pooled across installs: total hits divided by total loot windows, 4 decimals.
  Each install counts for at most 500 loot windows per creature. `samples` is the pooled
  number of loot windows behind the rate.
- `recipes`: `spellId` or `itemId` may be null.
- Client validation: require `format === 1`. Read each section by its `columns` names, not by
  position. Ignore unknown top-level keys. A future incompatible change bumps `format`, and old
  clients should then keep their last good pack. Treat the pack as untrusted data: bound sizes,
  validate types, and never execute it.

### `GET /v1/pack/meta`

Small freshness check (`Cache-Control: public, max-age=300`):

```json
{ "ok": true, "format": 1, "version": "a1b2c3d4e5f6a7b8c9d0", "generatedAt": "2026-11-13T18:00:00.000Z",
  "minInstalls": 3, "bytes": 18234, "gzipBytes": 4120,
  "counts": { "nodes": 1, "nodeItems": 1, "npcs": 1, "vendors": 1, "drops": 1, "recipes": 1 } }
```

If `version` equals the cached version, the app can skip `GET /v1/pack`.

## 5. `POST /v1/report`: problem reports

Body limit 160 KB. Limit: 5 reports per install per hour.

```json
{
  "schema": 1,
  "installId": "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f",
  "category": "data",
  "text": "The Peacebloom pin near Goldshire is in the lake.",
  "appVersion": "0.31.0",
  "build": "1.15.8.66000",
  "log": "…optional app log…"
}
```

- `category`: `bug` | `data` | `crash` | `suggestion` | `other`.
- `text`: required, 1 to 2,000 characters after trimming. Newlines and tabs are allowed. Other
  control characters, including ANSI escapes and bidi overrides, are rejected.
- `appVersion`: required. `build`: optional (same format as in submit).
- `log`: optional, at most 64 KB (65,536 UTF-8 bytes), with the same character rules.
  **The app must show the user the exact log text it will attach before sending, and let them
  remove it.** Strip local paths and the Windows user name from the log before showing it.
- Response: `201 {"ok":true,"id":42}`. Show the id to the user as a reference number.

## 6. `POST /v1/forget`: delete my contributions

```json
{ "schema": 1, "installId": "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }
```

Deletes every observation and report from that install, and also every ticket (with its whole
conversation), every heartbeat row and the first-seen day of that install (section 10). Response:
`200 {"ok":true,"removed":{"observations":12,"reports":0}}` (the shape is unchanged; tickets and
heartbeats are removed without being counted in it). Facts already published in a pack
disappear at the next rebuild if they drop below 3 installs. After a 200, generate a new install
id. Limit: 3 per install per hour.

## 7. `GET /v1/health`

`200 {"ok":true,"service":"bf-community","version":"1.0.0","packFormat":1,"desk":true,"uptimeSec":1234}`

`"desk": true` means the Backstage Desk endpoints of section 10 are there.

## 8. Rate limits (in memory only)

| Scope | Limit |
|---|---|
| Per client IP, all endpoints (held only as a keyed hash in memory, never stored or logged) | 120 requests/minute |
| `submit` per install | 30/hour |
| `submit`, whole service | 300/minute |
| `report` per install | 5/hour |
| `report`, whole service | 60/hour |
| `forget` per install | 3/hour |
| `heartbeat` per install | 6/day (more are answered 200 and ignored) |
| `tickets` (open a report) per install | 5/day |
| `tickets` (open a report), whole service | 200/day; `503 report_inbox_full` at 5,000 open tickets |
| read one ticket, per ticket key | 120/hour |
| player replies, per ticket | 20/day |
| delete a ticket, per ticket key | 10/hour |
| `errors` per install | 10/day |

"Per day" is a 24-hour window that starts with the first request. All of these are counted in
memory only, keyed by the install hash or by a hash of the ticket key.

## 9. What the server stores (for the app's privacy page)

Field by field. Nothing else is kept. The install id is never stored: only `hashInstall(installId)`,
a salted HMAC-SHA-256 of it, called "the install hash" below. IP addresses are used in memory for
rate limits (as a keyed hash) and are never written to the database or the log. Country is not
derived. There are no cookies on `/v1/*`.

**Community data (sections 3 to 6)**
- Observations: one row per fact per install hash, holding a counter and the first and last UTC
  **day** it was seen. No times of day, names, GUIDs, realms or account data.
- Daily submission counts per client build string. Not linked to installs.
- Old one-way reports (`/v1/report`): category, text, app version, build, optional log, the
  install hash, and the creation time rounded to the minute.
- Published data contains only facts that at least 3 distinct installs agree on.

**Statistics (`/v1/heartbeat`)** - one row per install hash per UTC day, last values win:

| Stored | From the request field |
|---|---|
| install hash | `installId` (hashed) |
| UTC day (no time of day) | set by the server |
| app version, addon version, release channel | `appVersion`, `addonVersion`, `channel` |
| operating system family and major version | `os`, `osMajor` |
| app language | `lang` |
| game build | `build` |
| first-seen week as the app remembers it | `firstSeenWeek` |
| four yes/no flags | `flags.gameConnected`, `flags.addonInstalled`, `flags.liveLink`, `flags.sharing` |
| which of the nine main areas were opened that day (yes/no each) | `areas` |

Also one row per install hash with the UTC day the server first saw it. Heartbeat rows are kept for
at most 13 months: older calendar months are turned into monthly totals (counts only, no install
hash) and the rows are deleted. A first-seen day is deleted once no heartbeat row of that install is
left. `POST /v1/forget` deletes all of it at once.

**Tickets (`/v1/tickets`)**

| Stored | From |
|---|---|
| ticket number | made by the server (`BF-1001`, `BF-1002`, ...) |
| SHA-256 of the ticket key | the key itself is sent once in the 201 answer and never stored |
| install hash | `installId` (hashed); shown to admins only as its first 8 characters |
| kind, area, how often | `kind`, `area`, `frequency` |
| summary, details, what was expected | `summary`, `details` (kept as message 1), `expected` |
| app version, addon version, OS family and major version, language, game build | the fields of the same name |
| diagnostics block, if the player left it in | `diagnostics.screen`, `.lastError`, `.gameConnected`, `.addonInstalled` |
| every later message, with who wrote it (player or team) and when | `text` of section D4, and the team's replies |
| times: opened, last change, first team reply, closed (to the second, UTC) | set by the server |
| handling data added by the team | status, fixed-in version, severity, tags, assigned admin, GitHub link, duplicate-of, internal notes |

A ticket stays until the player deletes it (`DELETE /v1/tickets/{ticket}` or `POST /v1/forget`) or
an admin deletes it; then the ticket and all of its messages and notes are removed.

**Automatic error reports (`/v1/errors`)** - never linked to an install: the install id is used
only for the rate limit and the block list, in memory, and is not stored with the error.

| Stored | From |
|---|---|
| per error group: error name, the message and stack of the first report, main or renderer | `name`, `message`, `stack`, `where` |
| per group, app version, OS family and UTC day: a count | `appVersion`, `os` |
| first and last UTC day, and a total | set by the server |

`osMajor` and `lang` are checked and then dropped. Folder names are removed from `stack` and
absolute paths from `message` by the server as well, whatever the app sent. Per-day counts older
than 13 months are deleted.

**Announcements (`/v1/announcements`)** - nothing is stored about the caller.

**Admin area** - admin name, scrypt password hash, encrypted authenticator secret, session
hashes, sign-in failure counters (keyed by a hash of the typed name), and an audit log of admin
actions (who, what, when, which ticket). The audit log never contains what a player wrote.

**Alerts to admins** - if switched on by the owner, a new ticket or a player reply sends an e-mail
and/or a Discord message holding only: ticket number, kind, area, app version, and the first 80
characters of the summary.

**GitHub download counts** - public data only, nothing from or about players. About once an hour
the server asks GitHub's public API for the release list of the project and stores, per release tag
and file name, GitHub's running download count per UTC day, plus each release's publication date.
The request carries no player data. The app is not involved.

**Log** - the service log records only the time, method, route pattern (`/v1/tickets/:ticket`,
never the ticket number), status and duration. It contains no IPs, install ids, ticket numbers,
keys, e-mail addresses or text.

## 10. Backstage Desk: reports with replies, statistics, error reports, announcements

This section is the Desk contract as agreed for app and server. Everything in sections 1, 2 and 8
(install id, common responses, strict unknown-field rejection, rate limits, body rules) applies
unchanged.

**Shared rules**
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

### D1. `POST /v1/heartbeat` — anonymous statistics (at most once per UTC day per install)
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

### D2. `POST /v1/tickets` — open a report
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

### D3. `GET /v1/tickets/{ticket}` — read one ticket (the conversation)
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

### D4. `POST /v1/tickets/{ticket}/messages` — player reply
Header `X-BF-Ticket-Key`. Body `{ "schema": 1, "text": "…" }`, text 1–4000 chars, body limit 12 KB.
Limit 20 per ticket per day. A reply to a `fixed` or `closed` ticket re-opens it as `looking`.
Response `201 {"ok":true,"id":3,"at":"…","status":"looking"}`.

### D5. `POST /v1/tickets/sync` — check many tickets at once (what the app polls)
Body limit 8 KB: `{ "schema": 1, "tickets": [ { "ticket": "BF-1042", "key": "…", "since": 2 } ] }` (max 50).
Response: `{ "ok": true, "tickets": [ { "ticket": "BF-1042", "status": "question", "fixedIn": null,
"updatedAt": "…", "unread": 1, "lastId": 3 } ], "gone": ["BF-0007"] }` — `gone` lists tickets that no
longer exist or whose key did not match (the app removes them). App polls at start, then every 3 hours
while it has tickets not `closed`, with the usual backoff.

### D6. `DELETE /v1/tickets/{ticket}` — player deletes a report
Header `X-BF-Ticket-Key`. Response `200 {"ok":true}`. Removes the ticket and its messages.
`POST /v1/forget` (existing) additionally deletes every ticket and heartbeat row of that install hash.

### D7. `POST /v1/errors` — automatic error report (only if the player switched it on)
Body limit 8 KB. Limits: 10 per install per day.
```json
{ "schema": 1, "installId": "…", "appVersion": "1.26.0", "os": "windows", "osMajor": "11", "lang": "en",
  "where": "main" , "name": "TypeError", "message": "… (paths removed)", "stack": ["at f (app.js:10:3)", "…"] }
```
- `where`: `"main" | "renderer"`. `name` ≤ 60, `message` ≤ 300, `stack`: ≤ 12 lines, each ≤ 200, file
  names only (no directories). The server groups by a signature of name + first three stack lines.
- Response `200 {"ok":true}`.

### D8. `GET /v1/announcements?appVersion=1.26.0&os=windows&lang=en` — messages from the team
Anonymous, cacheable for 1 hour (`Cache-Control: public, max-age=3600`, ETag, 304 supported).
```json
{ "ok": true, "announcements": [ { "id": 12, "title": "…", "text": "…", "level": "info",
  "from": "2026-11-24T00:00:00Z", "until": "2026-12-01T00:00:00Z", "link": null } ] }
```
- `level`: `"info" | "warning"`; `title` ≤ 80, `text` ≤ 600; `link` is `null` or an https URL on
  `github.com/farena-ai/Backstage-Forever` or `backstagecoding.com` only. The server filters by
  version range, OS and language server-side; the app shows each id once.

### D9. `GET /v1/health` gains `"desk": true`.

### How this server implements the points the contract leaves open

- Ticket numbers start at `BF-1001` and are never reused. A number is at least four digits.
- `details` becomes message 1 (`"from":"player"`). `expected` is stored with the ticket and shown
  to the team; it is not repeated in `messages`.
- Message ids count 1, 2, 3 ... per ticket over the messages the player can see. Internal notes
  take no id, so there are no gaps that would give them away.
- A player reply sets `question`, `fixed` and `closed` back to `looking`; `new` and `looking` stay.
- `since` in D5 may be left out (it then means 0). `unread` counts only messages from the team.
- D8: every query parameter is optional. Without `appVersion`, `os` or `lang` the server returns
  only announcements that do not target on that detail. Unknown parameters are refused with 400.
- D3 with a malformed ticket id or key answers `404 not_found`, the same as a wrong key. A key in
  the URL is never looked at.
- Text fields: a tab is tolerated besides the newline; `\r\n` is stored as `\n`; text is put
  into NFC. Other control characters are refused with 400. Limits count Unicode code points.
- D7: the group signature ignores line and column numbers, so one fault stays one group across
  releases. At most 5,000 groups are kept; reports for further new groups are answered 200 and dropped.
- D1: the server's own first-seen day is the UTC day of the first heartbeat it received.
- A blocked install gets `403 blocked` on D1, D2, D4 and D7. It can still read and delete its tickets.
