# Backstage Forever community server: client contract

This is the exact API the desktop app uses to share and download community data.
Server code lives next to this file. API version: `v1`. Pack format: `1`, minor `1` (section 4a).

- Base URL: `https://bf.backstagecoding.com` (HTTPS only; plain HTTP is redirected with 308).
- Every request and response body is JSON (UTF-8). POST requests must send
  `Content-Type: application/json` and must not compress the body.
- No cookies, no auth headers, no CORS on `/v1/*`. The service is meant for the desktop app only.
  (The two exceptions are the `X-BF-Ticket-Key` header of section 10 and the `X-BF-Member` header of
  section 11. Cookies exist only under `/admin/`, the team's admin area, which the app never calls.)
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
    "npcs":    [{ "npcId": 197, "mapId": 1429, "x": 0.485, "y": 0.42, "name": "Marshal McBride" }],
    "vendors": [{ "npcId": 1213, "itemIds": [159, 4540], "name": "Godric Rothgar" }],
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
| `nodes` | `kind` (`herb` \| `ore` \| `chest` \| `object`), `objectId`?, `name`?, `mapId`, `x`, `y`, `itemIds`? | `object` (minor 1) is any other game object the player looted from, for example a quest object. Needs `objectId` or `name`. When `objectId` is present it is the identity and `name` is ignored. Send `name` only when the object id is unknown: 1 to 120 characters, letters, digits, spaces and `'’.,:()&!-` only. `itemIds`: up to 16 unique ids gathered from that node. App mapping: `herbalism` → `herb`, `mining` → `ore`, `chest` → `chest`; `entityId` → `objectId`. |
| `npcs` | `npcId`, `mapId`, `x`, `y`, `name`? | One position where the NPC was seen. `name` (minor 1): see "NPC names" below. |
| `vendors` | `npcId`, `itemIds`, `name`? | 1 to 200 unique item ids that the vendor sells. `name` (minor 1): see "NPC names" below. |
| `drops` | `npcId`, `loots`, `items` | `loots` (1 to 1000) is the number of loot windows opened on that creature since the last successful submit. `items` (0 to 64) lists `{ "itemId", "count" }`, where `count` (1 to `loots`) is how many of those windows contained the item. Include kills that dropped nothing listed, with `items: []`; they are the denominator. **Send deltas only.** After a 200, reset the counters you sent. Never resend a batch that got a 200. |
| `recipes` | `source` (`trainer` \| `vendor`), `npcId`, `spellId`?, `itemId`? | Needs `spellId` (trainer-taught recipe spell) or `itemId` (recipe item sold by a vendor), or both. |

**NPC names (minor 1).** `name` on an `npcs` or `vendors` entry is the NPC's name exactly as the
game client shows it (`UnitName`), never anything a player typed. 1 to 80 characters after trimming,
letters, digits, spaces and `'’.,:()&!-` only. Send it **only from English (enUS) game clients**, so
the published names are in one language, and once per NPC is enough. The server stores it as its own
fact (`npcId` + name) per install hash and publishes a name only when at least 3 distinct installs
sent the same name for the same id (section 4a).

**Send the minor-1 fields only to a server that knows them.** A server from before minor 1 answers
`400` to a `name` on these entries or to `kind: "object"`, and the client then drops the whole batch.
The app therefore adds them only after it has downloaded a pack that says `"minor": 1` or higher.
`vendors` without `name` has been part of the contract from the start and needs no such check.

What the app sends today: `nodes` (herb, ore, chest; with minor 1 also `object`, from objects the
player looted a quest item from), `npcs` (where the player looted a creature, and where the player
stood when a vendor window was opened), `vendors` (from vendor windows the player opened). It sends
no `drops`: the addon counts looted quest items, not loot windows, so there is no honest `loots`
denominator. It sends no `recipes`: the addon records no trainer or recipe listings.

**Freshness.** The server keeps, per fact and install hash, the first and the last UTC day it
received that fact. To keep "last seen" true, the app sends a spot once more when the player saw it
again on a later day (its local memory of what was sent holds the day; the day is never sent). The
day the server records is the day the submit arrived.

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

### 4a. `GET /v1/pack?v=2`: pack format minor 1

The default pack above never changes shape: apps up to 1.26 reject a node `kind` they do not know
(and would then keep their last good pack for ever), so nothing new is ever added to it. An app that
understands minor 1 asks for `?v=2`. Any other value of `v` gets the default pack. The two packs have
their own `version` and ETag. An older server ignores the query and sends the default pack, which a
minor-1 client must accept as well (no `minor`, no day columns, no `npcNames`).

```json
{
  "format": 1,
  "minor": 1,
  "version": "0f1e2d3c4b5a69788796",
  "generatedAt": "2026-11-24T18:00:00.000Z",
  "minInstalls": 3,
  "coordStep": 0.005,
  "nodes":     { "columns": ["kind","objectId","name","mapId","x","y","installs","firstSeen","lastSeen"],
                 "rows": [["herb",1617,null,1429,0.45,0.6,3,"2026-11-02","2026-11-23"], ["object",2843,null,1429,0.3,0.3,3,"2026-11-20","2026-11-20"]] },
  "nodeItems": { "columns": ["kind","objectId","name","itemId","installs"], "rows": [["herb",1617,null,2447,3]] },
  "npcs":      { "columns": ["npcId","mapId","x","y","installs","firstSeen","lastSeen"], "rows": [[197,1429,0.485,0.42,3,"2026-11-02","2026-11-23"]] },
  "vendors":   { "columns": ["npcId","itemId","installs","firstSeen","lastSeen"], "rows": [[1213,159,3,"2026-11-02","2026-11-23"]] },
  "drops":     { "columns": ["npcId","itemId","rate","samples","installs"], "rows": [] },
  "recipes":   { "columns": ["source","npcId","spellId","itemId","installs"], "rows": [] },
  "npcNames":  { "columns": ["npcId","name","installs"], "rows": [[197,"Marshal McBride",3]] }
}
```

What minor 1 adds, and nothing else:

- `minor`: `1`. A client that knows a lower minor ignores what it does not know.
- `firstSeen`, `lastSeen` on `nodes`, `npcs` and `vendors`: the earliest and the latest **UTC day**
  (`YYYY-MM-DD`) on which any install's submit carrying that fact arrived. Day precision only; there
  is no time of day anywhere in the pack. They are computed over the same rows as `installs`, so a
  fact with fewer than `minInstalls` reporters publishes no date either.
- `nodes` and `nodeItems` rows of `kind` `"object"`.
- `npcNames`: at most one row per `npcId`. A name appears only when at least `minInstalls` distinct
  installs sent that exact name for that id; if several names qualify, the one with the most
  installs wins (ties: the alphabetically first). `installs` counts the installs behind the name.
- Nothing per install: the pack never says which install reported a fact. For that see section 6a.

### `GET /v1/pack/meta`

Small freshness check (`Cache-Control: public, max-age=300`):

```json
{ "ok": true, "format": 1, "version": "a1b2c3d4e5f6a7b8c9d0", "generatedAt": "2026-11-13T18:00:00.000Z",
  "minInstalls": 3, "bytes": 18234, "gzipBytes": 4120,
  "counts": { "nodes": 1, "nodeItems": 1, "npcs": 1, "vendors": 1, "drops": 1, "recipes": 1 } }
```

If `version` equals the cached version, the app can skip `GET /v1/pack`. `GET /v1/pack/meta?v=2`
describes the minor-1 pack instead (it adds `"minor": 1` and `counts.npcNames`).

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
id. Limit: 3 per install per hour. Because `/v1/mine` (section 6a) reads the same observation rows,
it answers with an empty list for that install id from then on; the app deletes its saved copy.

## 6a. `POST /v1/mine`: which facts did this install contribute

So the app can mark "from you" exactly. The shared pack holds no per-install data; this is a read
of the caller's own rows, and the install id is the only credential.

```json
{ "schema": 1, "installId": "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }
```

Body limit 1 KB, unknown fields rejected, same install id rules as everywhere. Limit: 12 per install
per hour. Response (`Cache-Control: no-store`):

```json
{ "ok": true, "total": 4, "truncated": false,
  "counts": { "1429": { "herb": 1, "npc": 1 } },
  "keys": {
    "nodes":   { "columns": ["kind","objectId","name","mapId","x","y"], "rows": [["herb",1617,null,1429,0.45,0.6]] },
    "npcs":    { "columns": ["npcId","mapId","x","y"], "rows": [[197,1429,0.485,0.42]] },
    "vendors": { "columns": ["npcId","itemId"], "rows": [[1213,159],[1213,4540]] } } }
```

- `keys` lists the spots, NPC places and vendor wares this install hash reported, in the pack's own
  rounded coordinates, whether or not they are published yet. At most 6,000 keys; `total` is the real
  number and `truncated` says whether some were left out. `counts` is the number of returned spots
  and NPC places per `mapId` and kind (`herb`, `ore`, `chest`, `object`, `npc`).
- Drops, recipes, node items and names are not listed.
- An install id the server has never seen, one that was forgotten and one that is blocked all get
  the same `200` with empty lists. The answer never says whether an id exists, and never contains an
  install id or hash.
- Only what the caller's own id maps to is read: there is no way to ask about another install
  without knowing its random id.
- The app asks only while sharing is on and something was shared: at most every 6 hours, or 10
  minutes after a new submit. A `404`/`405` means an older server: keep working without the list.

## 7. `GET /v1/health`

`200 {"ok":true,"service":"bf-community","version":"1.0.0","packFormat":1,"packMinor":1,"mine":true,"desk":true,"live":true,"discord":false,"uptimeSec":1234}`

`"desk": true` means the Backstage Desk endpoints of section 10 are there. `"packMinor": 1` and
`"mine": true` (both absent on older servers) mean sections 4a and 6a are there. `"live": true`
(absent on older servers) means section 11 is there; `"discord"` says whether its Discord part is
switched on.

## 8. Rate limits (in memory only)

| Scope | Limit |
|---|---|
| Per client IP, all endpoints (held only as a keyed hash in memory, never stored or logged) | 120 requests/minute |
| `submit` per install | 30/hour |
| `submit`, whole service | 300/minute |
| `report` per install | 5/hour |
| `report`, whole service | 60/hour |
| `forget` per install | 3/hour |
| `mine` per install | 12/hour |
| `heartbeat` per install | 6/day (more are answered 200 and ignored) |
| `tickets` (open a report) per install | 5/day |
| `tickets` (open a report), whole service | 200/day; `503 report_inbox_full` at 5,000 open tickets |
| read one ticket, per ticket key | 120/hour |
| player replies, per ticket | 20/day |
| delete a ticket, per ticket key | 10/hour |
| `errors` per install | 10/day |
| `live/session` per install | 120/hour |
| streams open at once | 2 per install (a third closes the oldest); 2,000 in all (`503 busy`) |
| link a guild (`POST /v1/guilds`) per install | 3/day |
| join a guild, per install | 30/hour |
| join a guild, per link code | 60/hour |
| wrong link codes and wrong Discord link codes, per client IP | 20/hour |
| calls inside a guild, per member token | 1,200/hour |
| start a Discord connection, per guild | 10/hour |
| Discord test post, per guild | 6/hour |
| put or delete a party-board listing, per install | 60/hour |
| read the party board, per client IP | 600/hour |
| Discord's webhook (`/discord/interactions`), whole service | 3,000/minute; not counted per IP |

"Per day" is a 24-hour window that starts with the first request. All of these are counted in
memory only, keyed by the install hash, a hash of the ticket key, the hash of the member token or
the guild id.

## 9. What the server stores (for the app's privacy page)

Field by field. Nothing else is kept. Only the Backstage Live part (the last block before the log, opt-in) holds
names of characters and guilds; nothing else does. The install id is never stored: only `hashInstall(installId)`,
a salted HMAC-SHA-256 of it, called "the install hash" below. IP addresses are used in memory for
rate limits (as a keyed hash) and are never written to the database or the log. Country is not
derived. There are no cookies on `/v1/*`.

**Community data (sections 3 to 6)**
- Observations: one row per fact per install hash, holding a counter and the first and last UTC
  **day** the server received it. No times of day, GUIDs, realms, or account, character or guild
  names. Field by field, a row is exactly: the kind of fact, the fact key, the install hash, the
  counter, the first day, the last day. The fact keys are:

  | Kind | Key | From the request |
  |---|---|---|
  | `node` | node kind, object id or node name, map id, rounded x, rounded y | `observations.nodes[]` |
  | `nodeitem` | node kind, object id or node name, item id | `observations.nodes[].itemIds` |
  | `npc` | NPC id, map id, rounded x, rounded y | `observations.npcs[]` |
  | `npcname` | NPC id, the name the game shows for it | `observations.npcs[].name`, `observations.vendors[].name` |
  | `vendor` | NPC id, item id | `observations.vendors[]` |
  | `droploot`, `drop` | NPC id (and item id), with the counter holding loot windows or hits | `observations.drops[]` |
  | `recipe` | source, NPC id, spell id, item id | `observations.recipes[]` |

  The only names stored are game strings: a node's name when its object id is unknown, and an NPC's
  displayed name. Nothing typed by a player is accepted in an observation.
- `POST /v1/mine` stores nothing: it reads the caller's own observation rows and is rate-limited in
  memory by the install hash.
- The first and last day were already kept per row since the first version of the service, so pack
  format minor 1 needed no change to the database. (Backstage Live, section 11, added tables of its
  own and made the schema version `4`; no older table or row changed. OPERATIONS.md section 1 says
  what going back to an older server needs.)
- Daily submission counts per client build string. Not linked to installs.
- Old one-way reports (`/v1/report`): category, text, app version, build, optional log, the
  install hash, and the creation time rounded to the minute.
- Published data contains only facts that at least 3 distinct installs agree on. That holds for
  the seen days (computed over those same installs) and for NPC names (3 installs, same id, same name).

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

**Admin area** - admin name, scrypt password hash, encrypted authenticator secret (for accounts that have one), session
hashes, sign-in failure counters (keyed by a hash of the typed name), and an audit log of admin
actions (who, what, when, which ticket). The audit log never contains what a player wrote.

**Alerts to admins** - if switched on by the owner, a new ticket or a player reply sends an e-mail
and/or a Discord message holding only: ticket number, kind, area, app version, and the first 80
characters of the summary.

**GitHub download counts** - public data only, nothing from or about players. About once an hour
the server asks GitHub's public API for the release list of the project and stores, per release tag
and file name, GitHub's running download count per UTC day, plus each release's publication date.
The request carries no player data. The app is not involved.

**Backstage Live (section 11)** - this is the one part of the service that stores names. It is
opt-in: nothing below exists for a guild until its leader linked it, and no character name is taken
from an app before its user agreed on the consent screen. It is kept apart from the anonymous
statistics: no statistics row, observation or ticket is linked to a guild or a character.

*A linked guild* - one row, kept until the guild is deleted (by its leader, by the last member
leaving, by an admin, or on request):

| Stored | From |
|---|---|
| guild id (`g_…`) | made by the server |
| guild name, realm, faction | `guildName`, `realm`, `faction` of G1 |
| HMAC of the link code (keyed with the server's secret) | the code itself is sent once and never stored |
| the three rank thresholds | G4 |
| time linked; time of last activity (changes at most once an hour) | set by the server |
| Discord, if connected: the Discord server id and name, the channel id and name, the state, and the last problem sentence | Discord's answer in D1, `/backstage channel` |

*A member* - one row per character per guild, kept until that member leaves, is removed, uses
Forget, or the guild is deleted:

| Stored | From |
|---|---|
| character name and realm | `character` of G1/G2 |
| role and in-game rank index | `rankIndex` of G1/G2 and the thresholds |
| install hash | `installId` (hashed); never shown to other members |
| SHA-256 of the member token | the token itself is sent once and never stored |
| time joined; time last seen (changes at most every 10 minutes) | set by the server |
| for a member who linked Discord: the Discord user id and the display name at that moment | D3; removed by `DELETE …/discord/link`, by disconnecting Discord, by leaving |

*Events* - kept until **14 days after the event's date**, then deleted with their sign-ups:
id, version, creator name and realm, editor name and realm, date and time, place id, title, note,
the three role numbers, called off or not, whether the copy was passed on, times created and
changed, and (Discord) the ids of the bot's message and of the Discord scheduled event.
The creator of a passed-on event can be a guildmate who does not use the app.

*Sign-ups* - kept with their event (so at most 14 days after it), and removed earlier when their
member leaves: character name and realm, answer, version, where it was given (game, desktop,
Discord), whether somebody else passed it on, time. An officer can pass on the answer of a
guildmate who does not use the app.

*Past-event summary* - numbers only, **kept 180 days after the event's date**: event id, title,
place id, date, how many attended, bosses, duration. No names: the names sent with E3 go into the
Discord post and are dropped.

*Discord link codes* - HMAC of the code, the Discord server id, the Discord user id and display
name of whoever ran `/backstage link`; deleted when used, and after 15 minutes at the latest.

*Party-board listing* - one per install, kept until **30 minutes after its last refresh**, or
until it is deleted, replaced, or the install uses Forget: listing id, install hash (never sent to
anybody), realm, faction, kind, character name and realm, level, class, roles, place id, note,
what is needed, time of the last refresh.

*Counters* - per UTC day, a count each of: guilds linked, events created, sign-ups from the game,
from the desktop app and from Discord, listings put up. Counts only, linked to nothing; deleted
after 13 months.

*Not stored*: stream tokens and who is connected (memory only), anything sent on a stream, the
access token Discord returns while connecting (discarded at once), Discord messages or member
lists (the bot reads none), the names in an E3 summary.

*What reaches Discord* for a connected guild, in the channel its leader chose: event titles,
notes, dates, and the character names of members and guildmates who signed up; the E3 summary with
the names it was given. Other players on the same realm and faction see party-board listings.
Guild data is visible only to members of that guild, and to the service's admins (who handle abuse
and deletion requests; their actions are in the audit log, which names guilds only by id).

**Log** - the service log records only the time, method, route pattern (`/v1/tickets/:ticket`,
never the ticket number; `/v1/guilds/:guild/events/:event`, never a guild id or a name; the stream's
token is in the query string, which is never logged), status and duration. It contains no IPs,
install ids, ticket numbers, guild ids, character or guild names, keys, tokens, codes, e-mail
addresses or text. A failed Discord call is logged as its kind and status code only.

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

## 11. Backstage Live: realtime stream, guilds, events, Discord, party board

This section is the Backstage Live contract as agreed for app and server (2026-11-24). Everything
in sections 1, 2 and 8 applies: install id, common responses, strict unknown-field rejection, body
rules, in-memory rate limits, no stored IP addresses. `GET /v1/health` carries `"live": true` when
this section is there, and `"discord": true|false` for whether the Discord part is switched on.

Storing guild data on the service is opt-in and separate from the anonymous statistics: a guild
exists only after its leader linked it, a member's character name is stored only after that member
agreed on the consent screen (`"consent": true`), and Leave, Forget and Delete remove it again
(section 9 lists every stored field and how long it is kept).

**Shared rules**
- A character is `{ "name": "Abel", "realm": "Thunder Hold" }`, exactly as the game shows it.
  `name`: 2 to 24 letters (no digits, spaces or punctuation). `realm`: 2 to 40 letters, digits,
  spaces, `'` and `-`. `guildName`: 2 to 24 of the same plus `.`.
- `faction`: `"horde" | "alliance"`. Rank index: integer 0 to 9, 0 is the guild leader.
- Player text (`title`, `note`) is one line of plain text, NFC. Control characters, invisible
  direction characters, the game's colour and link codes (anything with `|`) and web addresses are
  refused with 400. Limits are in characters. Text is stored as given and escaped wherever it is shown.
- Times are `2026-11-27T19:00:00Z` (UTC, to the second, exactly this form).
- `memberToken`: 43 characters (32 random bytes, base64url), given once when a guild is linked or
  joined, stored only as a SHA-256. Every call inside a guild carries it in the header
  `X-BF-Member`. This and `X-BF-Ticket-Key` are the only two headers that carry a secret.
- **One answer for every "not yours"**: a missing or malformed token, a token nobody holds, a token
  of another guild, and a guild that does not exist all get `404 {"ok":false,"error":"not_found"}`.
  The service never says whether a guild exists. A member who may not do something gets
  `403 {"ok":false,"error":"forbidden"}`. A blocked install gets `403 blocked`.
- Roles: `leader`, `officer`, `member`. The member who linked the guild is `leader`. For everybody
  else the role follows the rank index the app reported when joining: rank 0 is `leader`, a rank up
  to `thresholds.officerRank` is `officer`, anything else `member`. The rank is self-reported (the
  server cannot see the game), so a leader can remove any member and make a new link code.

### L1. `POST /v1/live/session` - get a one-time stream token
Body limit 4 KB. Limit: 120 per install per hour.
```json
{ "schema": 1, "installId": "…", "subs": [
  { "t": "tickets", "tickets": [ { "ticket": "BF-1042", "key": "…" } ] },
  { "t": "guild", "guildId": "g_…", "member": "<memberToken>" },
  { "t": "lfg", "realm": "Thunder Hold", "faction": "horde" } ] }
```
- At most 12 entries in `subs`: one `tickets` entry (up to 40 tickets), up to 8 `guild` entries,
  up to 2 `lfg` entries. `subs` may be empty.
- Response `200 {"ok":true,"stream":"<43-character one-time token>","expiresIn":60}`.
- Every subscription is checked here, once: a ticket needs its key, a guild needs a member token of
  that guild. One that does not check out is **left out without an error** (the stream simply never
  carries it), so a stale ticket or a guild the member was removed from does not stop the others.
- `503 busy` when too many unused tokens are waiting.

### L2. `GET /v1/live/stream?s=<token>` - Server-Sent Events
`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`.
- The token works **once** and for 60 seconds. A used, expired or unknown token: `404 not_found`.
  A malformed or missing `s`, or any other query parameter: `400`. `HEAD` and `POST`: `405`.
- A comment line `: ping` every 20 seconds.
- The server ends the stream 55 minutes after it opened. The client then asks for a new session and
  connects again (backoff 2 s up to 5 min).
- At most 2 streams per install: opening a third closes the oldest one. At most 2,000 streams in
  all: beyond that `503 {"ok":false,"error":"busy"}` with `Retry-After`.
- **Nothing is replayed.** After every (re)connect the client does a full refetch (G3, E1 list, P1
  list, D5). A client that reads too slowly is cut off and reconnects the same way.
- Each event has `id:` (counts up from 1 per stream), `event:` and one `data:` line holding one JSON
  object:

| `event` | `data` | When |
|---|---|---|
| `hello` | `{"serverTime":"…"}` | first thing on every stream |
| `ticket` | `{"ticket":"BF-1042","status":"question","fixedIn":null,"unread":1,"lastId":3}` | the team replied, the status or fixed-in version changed, or the player replied from elsewhere |
| `guild.event` | `{"guildId":"g_…","event":{…E1…}}` | an event was accepted (new, changed or called off) |
| `guild.event.gone` | `{"guildId":"g_…","id":"…"}` | reserved; this server does not send it (an event leaves the list by expiry, which the refetch shows) |
| `guild.signup` | `{"guildId":"g_…","eventId":"…","signup":{…E2…}}` | a sign-up was accepted, from the app or a Discord button |
| `guild.member` | `{"guildId":"g_…","members":12}` | somebody joined, left or was removed. `members: 0` once, when the guild was deleted |
| `guild.discord` | `{"guildId":"g_…","state":"none"\|"pending"\|"connected"\|"problem"}` | the Discord state changed; read G3 for the reason |
| `lfg` | `{"op":"put"\|"gone","listing":{…P1…}}` | a listing on a subscribed realm and faction was put, refreshed, removed or ran out |

- `unread` in a `ticket` event counts the team's messages after the player's last own message (the
  stream does not know the app's `since`); `lastId` is the newest message id. For exact numbers use D5.
- A member who leaves or is removed stops receiving that guild at once, also on a stream that is
  already open. `POST /v1/forget` closes every stream of that install.

### G1. `POST /v1/guilds` - link a guild
Body limit 2 KB. Limit: 3 per install per day.
```json
{ "schema": 1, "installId": "…", "realm": "Thunder Hold", "faction": "horde", "guildName": "Night Watch",
  "character": { "name": "Abel", "realm": "Thunder Hold" }, "rankIndex": 0 }
```
- An optional `"consent": true` is accepted (anything else in that field is refused).
- Response `201 {"ok":true,"guildId":"g_…","linkCode":"BFG-7K2M-Q9XD","member":"<memberToken>","role":"leader"}`.
- `guildId`: `g_` and 16 characters. `linkCode`: `BFG-XXXX-XXXX` from the letters and digits
  `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no `0 O 1 I L`). The code and the token are shown once; the
  server keeps only hashes.
- A (realm, faction, guild name) that is already linked, compared without letter case:
  `409 {"ok":false,"error":"exists"}` and nothing more.

### G2. `POST /v1/guilds/join` - join with the code
Body limit 2 KB. Limits: 30 per install per hour, 60 per link code per hour; 20 wrong codes per
network address per hour.
```json
{ "schema": 1, "installId": "…", "linkCode": "BFG-7K2M-Q9XD", "character": { "name": "Bea", "realm": "Thunder Hold" },
  "rankIndex": 4, "consent": true }
```
- `consent` must be literally `true`. The code may be sent in lower case.
- Response `201 {"ok":true,"guildId":"g_…","guildName":"Night Watch","member":"<memberToken>","role":"member"}`.
- Wrong code: `404 not_found`.
- A character name that is already a member of that guild can be joined again **only from the same
  install**; that gives a new token and ends the old one. From any other install it is
  `409 {"ok":false,"error":"exists"}` (an officer removes the old entry first). `409 full` at 1,000 members.

### G3. `GET /v1/guilds/{guildId}` - the guild as one member sees it
```json
{ "ok": true, "guildId": "g_…", "guildName": "Night Watch", "realm": "Thunder Hold", "faction": "horde", "role": "member",
  "members": [ { "name": "Abel", "realm": "Thunder Hold", "role": "leader", "discord": null, "lastSeen": "2026-11-24T12:00:00Z" } ],
  "thresholds": { "officerRank": 1, "proposeRank": 9, "editRank": 1 },
  "discord": { "state": "none", "guildName": null, "channel": null, "problem": null } }
```
- `members[].discord`: the Discord display name of a member who linked Discord, else `null`.
  `lastSeen`: when that member's app last called the service (updated at most every 10 minutes).
- `discord.state`: `"none" | "pending" | "connected" | "problem"`; `guildName`: the Discord server's
  name; `channel`: `"#raids"`; `problem`: one plain sentence for the leader, e.g.
  `"The bot cannot post in #raids: missing permission Send Messages"`.
- Thresholds: a rank index up to `officerRank` is an officer; up to `proposeRank` may propose
  events; up to `editRank` may change other members' events.

### G4. `PATCH /v1/guilds/{guildId}` - leader only
`{ "schema": 1, "thresholds": { "officerRank": 2 }, "rotateCode": true }` - either or both; inside
`thresholds` any of the three, each 0 to 9. Response: the G3 shape, plus `"linkCode"` when a new code
was made (the old one stops working at once; members who already joined stay). Changing
`officerRank` re-derives every member's role from the rank they joined with.

### G5. Leave, remove, delete
- `POST /v1/guilds/{guildId}/leave` (any member; body `{"schema":1}` or none) -> `200 {"ok":true}`.
  Removes the member and that member's own sign-ups. When the last leader leaves, the member with
  the highest in-game rank becomes leader. When the last member leaves, the guild is deleted.
- `DELETE /v1/guilds/{guildId}/members/{name}` (officer or leader; `{name}` is not case sensitive).
  An officer removes members; only a leader removes an officer or another leader. Nobody removes
  themselves this way (`403`): use leave. An unknown name: `404`.
- `DELETE /v1/guilds/{guildId}` (leader) deletes the guild and everything stored for it, and asks
  the bot to leave its Discord server.
- `POST /v1/forget` (section 6) also takes that install out of every guild it joined (same effect
  as leave in each) and removes its party-board listing. Its answer shape does not change.

### E1. Events
```json
{ "id": "abc123", "version": 3, "creator": { "name": "Anna", "realm": "Thunder Hold" }, "editor": { "name": "Bob", "realm": "Thunder Hold" },
  "at": "2026-11-27T19:00:00Z", "place": "mc", "title": "Molten Core", "note": "Bring fire resist",
  "roles": { "tank": 2, "healer": 8, "damage": 30 }, "cancelled": false }
```
- `id`: 1 to 24 of `A-Z a-z 0-9 _ -` (the addon's event id). `version`: 1 to 9999. `place`: an Atlas
  id of the addon (`^[a-z][a-z0-9]{0,7}$`) or `"other"`. `title` 2 to 40 characters, `note` 0 to 80.
  `roles`: tank 0 to 9, healer 0 to 9, damage 0 to 40.
- `editor`, `note` and `cancelled` may be left out or (`editor`, `note`) be `null`. An editor that
  names the creator is the creator. In answers `editor` is always there (the creator when nobody
  else edited) and `note` is `""` when empty.

**`PUT /v1/guilds/{guildId}/events/{id}`** (body limit 4 KB). The body is the shape itself, the
shape with `"schema": 1` added, or `{ "schema": 1, "event": {…} }`: all three are accepted. `id`
must be the id in the address.

Response `200 {"ok":true,"accepted":true|false,"reason":"…","event":{…the stored event…}|null}`. A
version that loses is **not an error**: the answer carries what is stored so the app can show it.

The server is one more replica and merges exactly like the addon (`BackstageForeverEventMerge`); a
shared table of cases is run against both (`test/fixtures/event-merge-cases.json`). The call is
*direct* when the caller's own character is the event's author (its editor, else its creator),
otherwise it is a copy *passed on* (what the app heard on the guild channel):

| Stored | Arrives | Result (`reason`) |
|---|---|---|
| nothing | anything | accepted (`new`) |
| any | another creator for the same id | refused (`creator`) |
| a passed-on copy | direct | accepted, whatever the versions (`author`) |
| direct | direct, higher version | accepted (`newer`) |
| direct | direct, same version | the author name later in the alphabet wins (`tie`), else refused (`older`) |
| direct | direct, lower version | refused (`older`) |
| direct | passed on | refused, even with a higher version (`hearsay`) |
| a passed-on copy | passed on | accepted only with a higher version (`newer`), else refused (`older`) |

Names are compared the way the addon does: ASCII letters folded to lower case, then byte by byte.

- Permissions (direct calls): proposing needs a rank up to `proposeRank`, or being officer or
  leader; changing your own event is always allowed; changing somebody else's event (you are its
  `editor`) needs a rank up to `editRank`, or being leader. Otherwise `403 forbidden`. Any member
  may pass on an event.
- Time window, as in the addon: a new event that began more than 4 hours ago is not taken
  (`accepted:false`, `reason:"past"`, `event:null`); one more than 180 days ahead is not taken (`"ahead"`).
- At most 60 live events per guild (live: not yet 4 hours past its start): `409 {"ok":false,"error":"full"}`
  for a new one beyond that.

**`GET /v1/guilds/{guildId}/events?since=<time>`** -> `{"ok":true,"events":[…E1…],"signups":{"<eventId>":[…E2…]}}`.
Without `since`: every stored event (also called-off and recently past ones) - the full refetch.
With `since`: only events changed at or after that time, with all of their sign-ups.

### E2. Sign-ups
`{ "who": { "name": "Bea", "realm": "Thunder Hold" }, "answer": "healer", "version": 2, "via": "desktop" }`
- `answer`: `"tank" | "healer" | "damage" | "maybe" | "no"`. `version`: 1 to 9999. `via` from the app:
  `"game"` (the addon heard or made it) or `"desktop"`. `"discord"` is set only by the server.

**`PUT /v1/guilds/{guildId}/events/{id}/signups/{name}`** (body limit 2 KB): the shape, the shape
with `"schema": 1`, or `{ "schema": 1, "signup": {…} }`. `who.name` must be the `{name}` in the
address (not case sensitive).
- A member sets only their own character's answer; an officer or leader may set anybody's, also a
  guildmate's who does not use the app (`403 forbidden` otherwise).
- Response `200 {"ok":true,"accepted":true|false,"reason":"new"|"newer"|"older"|"closed"|"full","signup":{…stored…}|null}`.
  Your own answer is accepted with a higher version, or when the stored one was set by somebody
  else; an answer set for somebody else is accepted only with a higher version (the addon's rule).
- A called-off event, and one that began more than 4 hours ago, take no answers (`"closed"`).
  At most 40 sign-ups per event (`"full"`). An unknown event: `404`.
- A Discord button press of a linked member is stored as that member's own answer, one version on,
  `via: "discord"`. A later answer from the game needs a higher version, as always.

### E3. `POST /v1/guilds/{guildId}/events/{id}/summary` - officer or leader
Body limit 8 KB: `{ "schema": 1, "attended": ["Abel","Bea"], "bosses": 8, "durationSec": 9660 }`
(`attended` up to 80 character names, `bosses` 0 to 99, `durationSec` 0 to 86400).
Response `200 {"ok":true,"posted":true|false}` - `posted` says whether a Discord post was queued
(false when Discord is off or not connected). The server keeps only the numbers (how many attended,
bosses, duration); the names go into the Discord post and are not stored.

### Discord (D1 to D3)
Switched on only by the server's settings (`BF_DISCORD_APP_ID`, `BF_DISCORD_PUBLIC_KEY`,
`BF_DISCORD_BOT_TOKEN`, `BF_DISCORD_CLIENT_SECRET`). While any of them is missing, **every** route
below answers `503 {"ok":false,"error":"discord_off"}` before anything else is looked at, and the
app shows "Discord connection is not available yet". `GET /v1/health` says `"discord": false`.

**D1.** `POST /v1/guilds/{guildId}/discord/start` (officer or leader; body `{"schema":1}` or none;
10 per guild per hour) -> `{"ok":true,"url":"https://discord.com/oauth2/authorize?…"}`: Discord's own
add-bot page. Scopes `bot applications.commands`; permissions View Channel, Send Messages, Embed
Links, Manage Events and Create Events, nothing else. The address carries a signed `state` that
works once and for 15 minutes. The guild's state is `pending` until the browser comes back.
- `GET /discord/callback` (the browser, not the app) finishes it and shows a plain page: "Discord is
  connected. You can close this tab and go back to Backstage Forever." The Discord server is taken
  from Discord's own answer, never from the address. One Discord server serves one guild.
- The channel is the Discord server's system channel, or whatever `/backstage channel` chose. With
  neither, the state is `problem` with "No channel is chosen yet. Run /backstage channel in the
  Discord channel you want."
- `POST …/discord/test` (officer or leader; 6 per guild per hour) posts a test message and answers
  once the bot tried: `{"ok":true,"posted":true|false,"discord":{…as in G3…}}`. `409 not_connected`
  when no Discord server is linked.
- `DELETE …/discord` (officer or leader) removes the link and every member's Discord tie and asks
  the bot to leave the Discord server.

**D2.** `POST /discord/interactions` is Discord's webhook. The Ed25519 signature and the timestamp
(at most 5 minutes old) are checked on the raw bytes before anything is parsed; otherwise
`401 invalid_signature`. Buttons under an event post: Tank, Healer, Damage, Maybe, No. Slash
commands: `/backstage link`, `/backstage channel [channel]` (needs Manage Server in Discord),
`/backstage events`. All command answers are visible only to the person who typed them.

**D3.** `/backstage link`, and a button pressed by somebody not yet linked, answer with a one-time
code `BFL-XXXX-XXXX` (15 minutes, one use, hashed on the server) and the address
`https://bf.backstagecoding.com/discord/link?code=BFL-…`, a plain page showing the same code.
- `POST /v1/guilds/{guildId}/discord/link` (any member) `{ "schema": 1, "code": "BFL-7K2M-Q9XD" }` ->
  `200 {"ok":true,"discord":"<display name>"}`: ties **the calling member** to the Discord user who
  got that code. A wrong, used, expired or other guild's code: `404 not_found` (20 misses per
  network address per hour). One Discord user answers for one character per guild.
- `DELETE /v1/guilds/{guildId}/discord/link` unties the calling member -> `200 {"ok":true}`.
- Only the Discord user id and the display name at that moment are stored.

What the bot does for a connected guild: one message per event, edited in place (title, time,
note, the sign-up list by role), with the five buttons until 4 hours after the start; a reminder
15 minutes before (it names linked members who said yes or maybe, nobody else); a Discord scheduled
event that follows the event's title and time and is deleted when the event is called off; the E3
summary. Everything players typed is escaped, and every message is sent with
`allowed_mentions: {"parse": []}`, so no title, note or name can ping `@everyone` or anybody else.
A failure (missing permission, deleted channel, bot removed, Discord not answering) never fails an
app request: it sets `discord.state` to `problem` with the reason and sends `guild.discord`; the
next success sets it back to `connected`.

### P1. Party board - opt-in, visible to other users on the same realm and faction
```json
{ "id": "<16 characters>", "kind": "lfg", "who": { "name": "Abel", "realm": "Thunder Hold" }, "level": 34, "class": "hunter",
  "roles": ["damage"], "place": "sm", "note": "Any wing", "need": null, "at": "2026-11-24T12:00:00Z" }
```
- `id`: 16 of `A-Z a-z 0-9 _ -`, made by the app. `kind`: `"lfg" | "lfm"`. `level` 1 to 80. `class`:
  3 to 12 lower-case letters or `null`. `roles`: any of tank, healer, damage, no duplicates.
  `place`: as in E1. `note` 0 to 60 characters (`""` when empty). `need`: `null` or
  `{"tank":0-9,"healer":0-9,"damage":0-40}`. All ten fields must be sent.
- `at` must be a valid time; the server replaces it with the time it received the listing.

**`PUT /v1/lfg/{id}`** (body limit 4 KB; 60 per install per hour)
`{ "schema": 1, "installId": "…", "realm": "Thunder Hold", "faction": "horde", "listing": {…}, "consent": true }`
-> `200 {"ok":true,"listing":{…},"expiresIn":1800}`. `consent` must be `true`.
- A listing runs out 30 minutes after its last PUT: send it again to keep it.
- One listing per install: a PUT with another id (or another realm or faction) replaces the old one.
- An id that belongs to another install: `409 {"ok":false,"error":"exists"}`.

**`DELETE /v1/lfg/{id}`** `{ "schema": 1, "installId": "…" }` -> `200 {"ok":true}`; `404` when that
install has no such listing.

**`GET /v1/lfg?realm=Thunder+Hold&faction=horde`** -> `{"ok":true,"listings":[…]}`: at most 200,
newest first, only that realm (not case sensitive) and faction. Both parameters are required. No
install id is needed to read (600 per network address per hour).

### How this server implements the points the Live contract leaves open, and where it differs
- **Create Events permission.** The contract lists four bot permissions; this server also asks for
  Create Events, which Discord requires for making a scheduled event. Nothing else is asked for.
- **Event posts are plain messages, not embeds**, so they also show where a server member has
  embeds switched off. The Embed Links permission is still requested, as the contract says.
- **`guild.event.gone` is never sent** (see L2). Events leave by expiry only: 14 days after their date.
- **A name can be re-joined only from the same install** (G2, `409 exists`), so a guild member
  cannot take over another member's entry by typing that name.
- **Passed-on events** (E1) are accepted from any member, as in the game. Their creator need not be
  a member of the linked guild, so an event can carry the name of a guildmate who never used the app.
  The same is true for a sign-up an officer passes on.
- **The PUT bodies of E1 and E2** are accepted in three forms (bare, with `schema`, wrapped).
- **G1 has no `consent` field in the contract**; the server accepts an optional `"consent": true`.
- **Reasons** (`reason` in E1/E2 answers) and the `accepted` flag are additions; a stale version is
  a normal 200.
- **Leaving** removes the member row and that member's own sign-ups. An event that member created
  stays until it expires (its creator name is part of the event the guild planned).
- Title and note limits count characters; the addon counts bytes and cuts on its side.
