# Backstage Forever community server: client contract

This is the exact API the desktop app uses to share and download community data.
Server code lives next to this file. API version: `v1`. Pack format: `1`.

- Base URL: `https://bf.backstagecoding.com` (HTTPS only; plain HTTP is redirected with 308).
- Every request and response body is JSON (UTF-8). POST requests must send
  `Content-Type: application/json` and must not compress the body.
- No cookies, no auth headers, no CORS. The service is meant for the desktop app only.
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
| 404 / 405 | `not_found` / `method_not_allowed` (with an `Allow` header) | client bug |
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

Deletes every observation and report from that install. Response:
`200 {"ok":true,"removed":{"observations":12,"reports":0}}`. Facts already published in a pack
disappear at the next rebuild if they drop below 3 installs. After a 200, generate a new install
id. Limit: 3 per install per hour.

## 7. `GET /v1/health`

`200 {"ok":true,"service":"bf-community","version":"1.0.0","packFormat":1,"uptimeSec":1234}`

## 8. Rate limits (in memory only)

| Scope | Limit |
|---|---|
| Per client IP, all endpoints (held only as a keyed hash in memory, never stored or logged) | 120 requests/minute |
| `submit` per install | 30/hour |
| `submit`, whole service | 300/minute |
| `report` per install | 5/hour |
| `report`, whole service | 60/hour |
| `forget` per install | 3/hour |

## 9. What the server stores (for the app's privacy page)

- Observations: one row per fact per hashed install, holding a counter and the first and last
  UTC **day** it was seen. No times of day, IPs, names, GUIDs, realms or account data.
- Daily submission counts per client build string. They are not linked to installs.
- Reports: category, text, app version, build, optional log, the install hash, and the creation
  time rounded to the minute.
- The service log records only the time, method, route, status and duration. It contains no IPs
  and no install ids.
- Published data contains only facts that at least 3 distinct installs agree on.
