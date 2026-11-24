# Backstage Forever community server: operations

How to run the service that sits behind `https://bf.backstagecoding.com`: the app's API under
`/v1/`, the Backstage Desk admin area under `/admin/`, and (section 9, Backstage Live) the realtime
stream, linked guilds, the party board and Discord's webhook under `/discord/`. One Node process, one SQLite file, no
paid services. What the app sends is in `CLIENT-CONTRACT.md`.

Everything below is done by the owner. Nothing here is automatic except the hourly housekeeping
and the nightly backup inside the service.

## Layout on the server

| Path (user `pback`) | What |
|---|---|
| `~/bf-community/current` | the running release (a link into `releases/`) |
| `~/bf-community/secrets/bf-community.env` | mode 600. The salt, and every setting below. Never in the repository |
| `~/bf-community/data/community.db` | the database (SQLite, WAL). `service.log` is next to it |
| `~/bf-community/backups/` | a snapshot taken before each deploy (last 10) |
| `~/bf-community/backups/nightly/` | one copy per night, written by the service (last 14) |
| `~/bf-community/admin` | the command-line tool: `~/bf-community/admin <command>` |

## 1. Deploy

1. Commit. Only committed files under `community-server/` are deployed.
2. From the repository: `bash community-server/deploy/deploy.sh` (default host `stacy`).
   It uploads the release, runs the server's tests there, takes a database snapshot, switches
   `current`, restarts the systemd user service and checks `/v1/health`. If the health check fails
   it switches back by itself.
3. The first deploy of Desk upgrades the database from schema 1 to schema 2 when the service
   starts. The upgrade only adds tables; no existing row is changed. The snapshot from step 2 is
   the way back (section 5).
   **Pack format minor 1** (seen days, NPC names, `POST /v1/mine`; CLIENT-CONTRACT.md sections 4a
   and 6a) changes nothing in the database: the first and last day per row were kept from the
   start, names are ordinary observation rows of kind `npcname`, and the schema stays 3. So this
   deploy has no upgrade step, and the release before it can open the same file after a rollback.
   (The Backstage Live release does raise the schema, to 4: section 9.1.)
   **One thing to do before running the older release on newer data:** it would publish nodes of
   kind `object` in the default pack, which apps up to 1.26 refuse. Remove them first with
   `sqlite3 community.db "DELETE FROM obs WHERE kind IN ('node','nodeitem') AND key LIKE 'object|%'"`
   (the `npcname` rows are simply never read by the older release). The web server block below already forwards
   `/v1/mine` and the `?v=2` query. **Deploy this server before the app version that uses it is
   released**: that app works against the older server too (it then sends no names and gets no
   "from you" list), but only the new server gives it the new fields.
4. Once, in cPanel: replace the `# BEGIN BF COMMUNITY` block in the `.htaccess` of the
   `bf.backstagecoding.com` document root with `deploy/htaccess-snippet.conf`. It now also sends
   `/admin/` to the service, HTTPS only. Until this is done the admin area answers 404 from the
   web server and the app is not affected.
5. Check: `curl -s https://bf.backstagecoding.com/v1/health` shows `"desk":true`, and
   `https://bf.backstagecoding.com/admin/` shows the sign-in page.
6. **Backstage Live** (schema 4, a new web-server block, optional Discord) has its own deploy
   order, rollback note and checks in section 9.

Old apps keep working: nothing in the existing API changed.

## 2. Create the first admin

There is no sign-up page. Accounts are made on the server:

```
ssh stacy
~/bf-community/admin admin-add yourname
```

- It asks for a password twice (at least 14 characters; it is not shown).
- It prints an authenticator secret and an `otpauth://` link **once**. Add it to an authenticator
  app straight away (type the secret in, or turn the link into a QR code on your own computer).
- Sign in at `/admin/` with name, password and the six-digit code.

**Without an authenticator.** An account can also be made with a password only:

```
~/bf-community/admin admin-add yourname --no-authenticator
```

Sign in with the name and the password and leave the code field empty. This is allowed, but it
is the weaker choice: anyone who learns or guesses that one password is in, and the admin area
holds every player report. **Add an authenticator as soon as you can.** It takes two minutes: sign
in, click your name (top right, "My account"), "Add an authenticator", type the secret into the
app and confirm with one code. Until then the Dashboard and the Admins page say "This account
signs in with a password only".

On the My account page each admin can change their own password (the current one is asked for;
every other session of theirs is signed out), add an authenticator (it takes effect only after a
correct code) and remove it again (the current password is asked for).

Other account commands:

| Command | What it does |
|---|---|
| `admins` | list accounts, last sign-in, open sessions |
| `admin-password <name>` | set a new password; signs that admin out everywhere |
| `admin-set-authenticator <name>` | give an account an authenticator, or a new one (lost phone); prints the setup once; signs that admin out. `admin-reset-totp` is the same command under its old name |
| `admin-remove-authenticator <name>` | back to password only; signs that admin out |
| `admin-disable <name>` / `admin-enable <name>` | switch an account off or on. Disabling can also be done in the admin area; enabling cannot |
| `admin-unlock <name>` | clear a sign-in lock straight away |

Sign-in rules: five wrong tries in 15 minutes lock that name for 15 minutes. If the same name is
locked again within a day of the last lock ending, each lock lasts twice as long: 30 minutes, 1, 2,
4, 8, 16 hours, then 24 hours each time. A correct sign-in, `admin-unlock`, or a quiet day starts
over at 15 minutes. That leaves someone guessing a password about 5 tries a day once it has run
up, which is what protects a password-only account. 100 wrong tries in 15 minutes lock sign-in for
everyone for 15 minutes; ten tries per network in 15 minutes. Wrong "current password" entries on
the My account page count the same way, and the fifth one also ends that admin's sessions.

The rules are the same for every name, with or without an authenticator and whether or not the
name exists, on purpose: the sign-in page gives nothing away about an account until its password
has been typed correctly. That is why password-only accounts do not get a different limit of
their own; everyone got the stricter, growing lock instead. A session lasts 12 hours
at most and ends after 1 hour without use. Every sign-in and every action is in the Audit log page.

## 3. Settings (the env file)

Edit `~/bf-community/secrets/bf-community.env`, then `systemctl --user restart bf-community`.
All are optional except the salt, which the first deploy made.

| Variable | Default | Meaning |
|---|---|---|
| `BF_COMMUNITY_SALT` | made at first deploy | keys the install hashes and protects the authenticator secrets. See section 6 before touching it |
| `BF_DESK_PUBLIC_ORIGIN` | `https://bf.backstagecoding.com` | the address browsers use. Forms sent from anywhere else are refused; alert e-mails link to it |
| `BF_DESK_ADMIN` | `1` | `0` switches the whole admin area off (every `/admin/` address answers 404) |
| `BF_DESK_NOTIFY_EMAIL` | empty = off | who gets alert e-mails, comma separated |
| `BF_DESK_NOTIFY_FROM` | empty | the From address of alert e-mails. Empty lets sendmail choose |
| `BF_DESK_NOTIFY_REPLY_TO` | empty | optional Reply-To |
| `BF_DESK_NOTIFY_MAX_PER_HOUR` | `30` | cap per hour, per channel, so a burst cannot flood an inbox |
| `BF_DESK_SENDMAIL` | `/usr/sbin/sendmail` | the local sendmail program |
| `BF_DESK_DISCORD_WEBHOOK` | empty = off | a Discord webhook URL |
| `BF_DESK_BACKUP_DIR` | `~/bf-community/backups/nightly` | `off` switches nightly backups off |
| `BF_DESK_BACKUP_KEEP` | `14` | how many nightly copies to keep |
| `BF_DESK_MAX_OPEN_TICKETS` | `5000` | above this, new reports get "inbox full" |
| `BF_DESK_DOWNLOADS` | on | `off` stops the hourly question to GitHub about download counts |
| `BF_DESK_GITHUB_REPO` | `farena-ai/Backstage-Forever` | which public repository's releases are counted |
| `BF_DESK_GITHUB_TOKEN` | empty | optional GitHub token, only to get a higher request allowance. Not needed |
| `BF_DESK_SCRYPT_LOG2N` | `17` | password hashing cost (17 needs 128 MB for a moment at each sign-in). Lower it to 15 or 16 only if the host cannot spare the memory |

### Alerts to admins

The Tickets entry in the admin area shows how many tickets wait for the team; that is the main
inbox. Alerts are an extra nudge. Both kinds are **off until set here**, and both carry only: the
ticket number, kind, area, app version and the first 80 characters of the summary. One alert per
new ticket and one per player reply.

**E-mail.** Put the recipients in the env file, for example:

```
BF_DESK_NOTIFY_EMAIL=owner@example.com,second@example.com
BF_DESK_NOTIFY_FROM=desk@example.com
```

Real addresses belong only in that file on the server, never in the repository. Mail is handed to
the local `sendmail`; the server makes no outside connection for it.

**Discord.** In Discord: Server settings, Integrations, Webhooks, New webhook, Copy URL. Then:

```
BF_DESK_DISCORD_WEBHOOK=https://discord.com/api/webhooks/<id>/<token>
```

Only `discord.com` and `discordapp.com` webhook addresses are accepted; anything else stops the
service from starting, with a message that names the setting (not its value). The URL is a secret:
anyone who has it can post to that channel.

**Test it.** After a restart:

```
~/bf-community/admin notify-test
```

sends one harmless message ("This is a test message from Backstage Desk...") to whatever is set
and says for each channel whether it was handed over. "No alerts are configured" means both are
off. A failed alert never holds up a player's report; the service log gets one line such as
`notify email failed: exit 75`, with no addresses and no text.

### Download counts from GitHub

The dashboard's Downloads section shows how often the files of each GitHub release were
downloaded. For that the service asks GitHub's **public** API, at most once an hour:

```
GET https://api.github.com/repos/farena-ai/Backstage-Forever/releases?per_page=100
```

- This is the only outside address the service calls by itself (alerts aside). The host is fixed
  to `api.github.com`; redirects are not followed; the request carries only a `User-Agent`
  (`backstage-forever-desk`) and, if set, the token. Nothing about players is sent or received.
- It keeps one number per release file per UTC day (GitHub's running total; the last reading of
  the day wins). Daily downloads on the dashboard are the differences. The first day has no
  difference, so the page says when tracking started. If GitHub lowers a count, that day shows 0.
- An unchanged list costs nothing (GitHub answers "not modified"). If GitHub says "too many
  requests" the service waits until the time GitHub names (six hours at most). After a failure it
  tries again after 1, 2, 4, then every 6 hours, and writes one line to the service log, such as
  `downloads fetch failed: status 503`. A failed check never affects the app or the admin area.
- Installer downloads include the automatic updates of existing installs. Downloads are not new
  players; the page says so.
- No token is needed: without one GitHub allows 60 requests an hour per server address and this
  uses one or two. Set `BF_DESK_GITHUB_TOKEN` only if the server shares its address with other
  heavy users of GitHub. A token with no permissions at all is enough; it is never logged.
- By hand: `~/bf-community/admin downloads-fetch` asks now (it still respects a wait GitHub asked
  for) and prints what it found. `BF_DESK_DOWNLOADS=off` plus a restart stops all of it; the
  numbers already stored stay and the section then says it is switched off.

## 4. Housekeeping the service does by itself

Every hour: heartbeat rows older than 13 months are turned into monthly totals and deleted (a
whole calendar month at a time); expired admin sessions and old sign-in counters are removed;
guild events dated more than 14 days ago are deleted (section 9.5 has all of the Live housekeeping).
After 03:00 UTC, once a day: the database is copied to
`backups/nightly/community-YYYY-MM-DD.db` and copies beyond the newest 14 are removed. Closed
tickets are never removed automatically.

By hand: `~/bf-community/admin rollup` (retention now), `~/bf-community/admin backup` (today's
copy now), `~/bf-community/admin stats` (numbers, including when both last ran). The Data page in
the admin area shows the same status and the database size.

## 5. Back up and restore

A nightly copy is a complete, consistent database file. Copy it off the server now and then
(`scp stacy:bf-community/backups/nightly/community-YYYY-MM-DD.db .`). It holds everything the
service knows, so keep it as private as the server itself.

To restore:

```
systemctl --user stop bf-community
cd ~/bf-community/data
mv community.db community.db.broken
rm -f community.db-wal community.db-shm
cp ../backups/nightly/community-YYYY-MM-DD.db community.db
chmod 600 community.db
systemctl --user start bf-community
curl -s http://127.0.0.1:5081/v1/health
```

What a restore undoes: tickets, replies, heartbeats and community data that arrived after the
copy was made. Players whose newer tickets vanish see them removed from "My reports" at the next
check. If a deletion request was carried out after that copy, **carry it out again** after
restoring (section 7).

To go back to the release before Desk: restore the pre-deploy snapshot
`backups/community-<release>.db` the same way and point `current` at the older release. An older
release refuses to open a schema 2 database.

## 6. Rotating the salt (and what that breaks)

`BF_COMMUNITY_SALT` turns install ids into the hashes the database stores. Do not change it
unless it has leaked. If it is changed:

- Every install looks new: statistics count each one again as a first-time install, retention
  cohorts restart, and "ever seen" doubles up.
- Community data no longer adds up per install: the same player's old and new observations count
  as two reporters, and that player's "Forget me" no longer finds the old rows, tickets or
  heartbeats (the app only knows its id; the old hash cannot be recomputed without the old salt).
- Blocked installs are no longer blocked.
- A ticket's "same install" list no longer links old and new tickets. Ticket keys keep working:
  they do not depend on the salt, so players keep their conversations.
- Every admin's authenticator secret becomes unreadable. Run `admin-set-authenticator <name>` for
  each admin that had one, right after the restart. Passwords keep working, and password-only
  accounts are not affected.

So: keep the old salt somewhere safe until every deletion request that might still refer to old
data has been handled, and change it only together with a note in the release notes.

## 7. A deletion request

A player can do this alone: Settings, "Forget me" removes their observations, reports, tickets
and statistics and gives the app a new id; "Delete" on a report removes that one ticket.

When someone writes in instead:

1. Ask for the install id shown in the app's Settings (a UUID). Nothing else can find their data;
   there are no names, e-mail addresses or IP addresses to search by.
2. In the admin area: Data, "Purge an install", paste the id, tick the confirmation. Or on the
   server: `~/bf-community/admin purge-install <installId>`. Add `--block` (or tick "Also block")
   only for abuse, never for an ordinary request.
3. That removes, for that install: community observations, old one-way reports, every ticket with
   all messages and internal notes, all heartbeat rows and the first-seen day. It also takes the
   install out of every guild it joined (its character name, role, Discord tie and own sign-ups go;
   a guild left without members is deleted) and removes its party-board listing. A request about a
   whole guild, or from somebody without the app, is section 9.6. Automatic error
   reports were never linked to an install, so there is nothing of theirs to remove there.
4. Tell them it is done. Their data is still inside nightly copies for up to 14 days and inside
   the last ten pre-deploy snapshots until those are rotated out; say so if they ask. To be quick
   about it, delete the older copies by hand after checking that today's copy exists.
5. The audit log keeps "install purged" with the first 8 characters of the hash and the counts.
   It does not keep the id.

To remove one ticket only: open it in the admin area, "Delete ticket".

## 8. If something is wrong

| Sign | Look at |
|---|---|
| service does not start | `tail ~/bf-community/data/service.log`. A bad setting is named there ("BF_DESK_DISCORD_WEBHOOK must be ...") |
| admin area: "This form has expired or was not sent from this site" on every form | `BF_DESK_PUBLIC_ORIGIN` does not match the address in the browser |
| sign-in page loads, signing in always returns to it | the page is not reached over HTTPS (the session cookie is Secure). Check the `.htaccess` block |
| sign-in fails for everyone after a salt change | section 6: `admin-set-authenticator` |
| "Sign-in is locked for a while" and it keeps getting longer | someone (or a typo habit) keeps failing on that name. `admin-unlock <name>` clears it; if it was not you, change the password and add an authenticator |
| sign-in is very slow or the service is killed at sign-in | the host cannot spare 128 MB: set `BF_DESK_SCRYPT_LOG2N=16`, restart, then `admin-password` for each admin |
| "Too many failed attempts" | wait 15 minutes, or `admin-unlock <name>` |
| Downloads section says "No download counts yet" for more than two hours | `~/bf-community/admin downloads-fetch` and read what it prints; the host may block outbound HTTPS |
| no alert e-mail | `admin notify-test`; then the mail log of the host |
| the app's guild panel never says "live" | section 9.2: run `tools/stream-check.js` against the public address |
| the app says "Discord connection is not available yet" | the four `BF_DISCORD_` values are not all set, or the service was not restarted (section 9.3) |
| Discord's portal will not save the Interactions Endpoint URL | section 9.3 step 6 |
| a guild shows a Discord problem | the sentence on its page in **Guilds** says which permission or channel; the guild's own Discord managers fix it there, and it clears with the next event change |
| `service.log` has many `discord job failed: http 401` lines | the bot token was reset in the portal: put the new one in the env file and restart |
| slash commands do not appear in Discord | `admin discord-register-commands`; wait a few minutes; the server must have added the bot with the link from the app |

## 9. Backstage Live (realtime stream, guilds, party board, Discord)

What it is for the app is in CLIENT-CONTRACT.md section 11. This section is what the owner does.
Guilds, events, the party board and the realtime stream work as soon as the release is deployed
and the web-server block is replaced. **Discord is a separate switch**: it stays off, and the app
says "Discord connection is not available yet", until the four `BF_DISCORD_` values are in the
env file.

### 9.1 Deploy order

1. Deploy this server release (section 1). The service upgrades the database from schema 3 to
   schema 4 when it starts: eight new tables, nothing else is touched. The pre-deploy snapshot is
   the way back.
2. Replace the `# BEGIN BF COMMUNITY` block in the `.htaccess` (section 9.2). Until then `/v1/`
   keeps working as before and `/discord/` answers 404 from the web server.
3. Check: `curl -s https://bf.backstagecoding.com/v1/health` shows `"live":true,"discord":false`,
   then run the stream check (section 9.2).
4. Only then release the app version that uses it. (That app also works against the older server:
   it then finds no `"live":true` and keeps its guild panel offline.)
5. Discord, whenever you want it: section 9.3. It needs a restart of the service, no new deploy.

**Rolling back to the release before Live.** The older release refuses a database whose schema
number is higher than its own. Either restore the pre-deploy snapshot (section 5; that loses what
arrived since), or keep the data and only set the number back. The Live tables then just sit
there unused:

```
systemctl --user stop bf-community
cd ~/bf-community/data
node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('community.db');d.exec('PRAGMA user_version = 3');d.close()"
ln -sfn ~/bf-community/releases/<the older release> ~/bf-community/current
systemctl --user start bf-community
```

Deploying the Live release again later sets it to 4 again and finds its tables as they were.
The deploy script does this by itself in the one case where it switches back on its own (the
health check after the restart fails): it notes the schema number before the restart and sets it
back before starting the previous release.

### 9.2 The web server

`deploy/htaccess-snippet.conf` now forwards three things to the service, HTTPS only: `/v1/`,
`/admin/` and `/discord/`. One address needs care: `/v1/live/stream` is a connection that stays
open for up to 55 minutes and must hand each event to the app the moment it is sent.

What the block does about that, and why:

| Directive | Why |
|---|---|
| `RewriteRule ^v1/live/stream$ … [P,L,QSA,E=no-gzip:1,E=dont-vary:1]`, placed before the general `/v1/` rule | the stream gets its own proxy rule so the two environment values can be set on it |
| `E=no-gzip:1` (and the `SetEnvIf Request_URI … no-gzip=1` line, the same thing set the other way) | switches `mod_deflate` off for this address. Compression collects output before sending it, which would hold events back |
| nothing for flushing | with `RewriteRule [P]`, `mod_proxy_http` passes on what it has whenever the service has nothing more to send at that moment. `flushpackets=on` is a `ProxyPass` option and cannot be written in `.htaccess`; it is not needed |
| nothing for timeouts | `Timeout` / `ProxyTimeout` cannot be set in `.htaccess` either. Their defaults are 60 seconds or more, and the service sends a `: ping` line every 20 seconds, so the connection is never idle that long |

The service itself sends `Cache-Control: no-store`, `X-Accel-Buffering: no` (for an nginx in front,
if the host has one), no `Content-Length` and no compression on that address.

**Check it on the live host** (this could not be tried here: there is no Apache on the build
machine; the tests use a stand-in proxy):

```
node ~/bf-community/current/tools/stream-check.js https://bf.backstagecoding.com
```

It opens one stream with a throwaway id and prints `hello after … ms`, then two pings about 20
seconds apart, then `OK`. It takes 40 seconds. What a `PROBLEM` line means:

| It says | Cause | What to do |
|---|---|---|
| no hello within 5 seconds: the stream is being buffered | something collects the answer: compression, a cache module, or a front proxy (nginx, LiteSpeed, Cloudflare) | make sure the whole new block is in `.htaccess`; in cPanel, "Optimize Website" must not be set to compress all content; if nginx sits in front of Apache, it honours `X-Accel-Buffering: no` unless proxy buffering is forced on |
| the answer is compressed (gzip) | `mod_deflate` or `mod_brotli` still handles it | the `no-gzip` lines are missing or `SetEnvIf`/`E=` is not allowed there; ask the host for `AllowOverride FileInfo`. For Brotli add `E=no-brotli:1` to the stream rule |
| no ping within 26 seconds of hello / the connection was closed early | the web server or a front proxy cuts idle or long connections | the host's `ProxyTimeout` is under 20 seconds, or a front proxy limits response time; that is a host setting |
| the stream answered 404 | the block was not replaced, or the stream rule is below the general `/v1/` rule | replace the whole block |
| the session call answered 5xx | the service is down | section 8 |

The app copes either way: when the stream does not work it falls back to its ordinary checks, so a
buffering web server costs "live", not function.

Also not verified here: that the host's Apache accepts `E=` flags on a per-directory `[P]` rule
exactly as written (it is standard mod_rewrite), that no security module rewrites or blocks
Discord's signed POST to `/discord/interactions` (the body must arrive byte for byte; the Discord
portal's own check in 9.3 step 6 proves it), and how many open connections the host allows per
account (each connected app holds one; the service stops at 2,000, `BF_LIVE_MAX_STREAMS`).

### 9.3 Discord: making the application (once)

All in the Discord Developer Portal, <https://discord.com/developers/applications>, signed in
with the Discord account that should own the bot. Nothing here costs money.

1. **New Application** (top right). Name: `Backstage Forever`. Tick the box, **Create**.
2. Page **General Information**: copy **Application ID** and **Public Key**. Optional: an icon and
   a description ("Guild events from Backstage Forever").
3. Page **Bot**: under Token press **Reset Token**, confirm, **Copy**. It is shown once.
   Switch **Public Bot** on (guild leaders add it to their own servers). Leave all three
   **Privileged Gateway Intents** off: the bot reads no messages and no member lists.
4. Page **OAuth2**: under Client Secret press **Reset Secret**, confirm, **Copy**.
   Under **Redirects** press **Add Redirect**, enter exactly
   `https://bf.backstagecoding.com/discord/callback`, **Save Changes**.
5. On the server, add the four values to `~/bf-community/secrets/bf-community.env` (mode 600):

   ```
   BF_DISCORD_APP_ID=<Application ID>
   BF_DISCORD_PUBLIC_KEY=<Public Key>
   BF_DISCORD_BOT_TOKEN=<the bot token>
   BF_DISCORD_CLIENT_SECRET=<the client secret>
   ```

   then `systemctl --user restart bf-community`. The first lines of `service.log` now say
   `discord for guilds on`, and `curl -s https://bf.backstagecoding.com/v1/health` shows
   `"discord":true`. With only some of the four set it stays off and the log says so; a value
   that does not look right stops the start and is named in the log.
6. Back in the portal, page **General Information**: set **Interactions Endpoint URL** to
   `https://bf.backstagecoding.com/discord/interactions` and **Save Changes**. Discord sends a
   signed test request at that moment; saving only works when the service answers it, so do this
   after step 5. If it says the URL could not be verified: the service is not reachable there, the
   public key in the env file is not this application's, or the web-server block is the old one.
7. Register the commands: `~/bf-community/admin discord-register-commands`. It prints
   "Discord now lists 1 command(s) for the bot". Run it again only when a new release changes the
   commands. They can take a few minutes to show up in Discord.

**Try it** with a test guild before telling anybody:

1. In the app, link a guild and open Guild, Discord, **Connect Discord**. The browser opens
   Discord's "add to server" page listing exactly these permissions: View Channels, Send Messages,
   Embed Links, Manage Events, Create Events. Pick a test server, **Authorise**.
2. The browser shows "Discord is connected. You can close this tab." The app's panel shows
   Connected with the server's name and the channel.
3. In the app press **Send a test message**: "Backstage Forever is connected…" appears in the channel.
4. In Discord type `/backstage channel` in the channel you want, then `/backstage link`, and type
   the code into the app. Create an event in the game or the app: one post appears with five
   buttons; pressing one changes the same post within a second and the app shows the sign-up.
5. Take the bot's Send Messages permission away in that channel and change the event: the app shows
   "The bot cannot post in #…: missing permission Send Messages". Give it back and change the event
   again: it clears by itself.

**What the bot can and cannot do.** It only calls Discord (outbound HTTPS to `discord.com`, a
fixed list of addresses) and answers Discord's webhook. It holds no open connection to Discord,
reads no messages, and knows a Discord user only after that user ran `/backstage link` or pressed
a button. Every message is sent so that it cannot ping anybody except, in the 15-minute reminder,
the linked members who said they are coming.

**If the token or the secret leaks**: Reset Token / Reset Secret in the portal, put the new value
in the env file, restart. Connected guilds keep working (they are tied to the application, not to
the token). To take Discord away entirely: remove the four lines and restart; every Discord route
answers "off" again and nothing is sent. Links already stored stay until the guilds disconnect.

### 9.4 Settings for Live

| Variable | Default | Meaning |
|---|---|---|
| `BF_DISCORD_APP_ID`, `BF_DISCORD_PUBLIC_KEY`, `BF_DISCORD_BOT_TOKEN`, `BF_DISCORD_CLIENT_SECRET` | empty = Discord off | section 9.3. All four or none |
| `BF_LIVE_MAX_STREAMS` | `2000` | realtime connections at once; beyond that apps are told to come back later |
| `BF_LIVE_MAX_GUILDS` | `20000` | linked guilds in all |
| `BF_LIVE_MAX_GUILD_MEMBERS` | `1000` | members per linked guild |
| `BF_LIVE_MAX_LISTINGS` | `5000` | live party-board listings in all |
| `BF_LIVE_RL_INTERACTIONS_PER_MIN` | `3000` | Discord webhook calls a minute, whole service |

`BF_DESK_PUBLIC_ORIGIN` (section 3) is also what the Discord redirect address and the link page
are built from: it must be the address in step 4 without `/discord/callback`.

### 9.5 What the service does by itself for Live

Every second: pings and the 55-minute limit of the streams. Every 30 seconds: party-board listings
that ran out are removed, 15-minute reminders are posted, the buttons come off event posts 4 hours
after the start. Every hour (and with `admin rollup`): events dated more than 14 days ago are
deleted with their sign-ups, leaving a numbers-only summary for 180 days; used-up Discord link
codes and connections that were started but never finished are cleared; daily counters older than
13 months are dropped. Stream tokens and who is connected live in memory only: a restart
disconnects every app, and each reconnects by itself within seconds to minutes.

The dashboard's **Backstage Live** block shows connections now, stream errors since the last
start, guilds, Discord use, sign-ups by source and listings per day. `admin stats` prints the same
counts under `live`.

### 9.6 A guild deletion request

A guild's leader can do it alone: in the app, Guild, **Delete the link** removes the guild, every
member, event, sign-up and summary, and makes the bot leave the Discord server. A single member
uses **Leave** (their name and their own sign-ups go) or Settings, **Forget me** (the same for
every guild they joined, plus everything of section 7).

When somebody writes in instead:

1. **A member who wants out** and cannot use the app: ask for the guild name and realm and the
   character name. Admin area, **Guilds**, find the guild, **Remove** next to that character.
   If they want everything of theirs gone, also ask for the install id and do section 7: purging
   an install takes it out of every guild and removes its listing.
2. **A leader who wants the guild gone**: make sure it is the leader writing (the request should
   come with the guild id, which only members see in the app, and from the person named as leader
   on the guild's page). Admin area, **Guilds**, the guild, tick the box, **Delete guild**.
   Without the admin area: `~/bf-community/admin guilds` to find the id, then
   `~/bf-community/admin guild-delete <guildId>` (this one cannot ask the bot to leave; say so).
3. **Somebody who never used the app but is named** (as the creator of a passed-on event, or in a
   sign-up an officer passed on): the name leaves by itself 14 days after the event. To remove it
   now, delete the guild's link as in 2 if the leader agrees, or ask the leader to call the event
   off and remove the sign-up; there is no admin button for a single event.
4. What is left afterwards: nothing in the live database. As in section 7, nightly copies keep it
   for up to 14 days and pre-deploy snapshots until they rotate out. What the bot posted in
   Discord stays in that Discord server: the server's own moderators delete it there.
5. The audit log keeps "guild deleted" with the guild id and the counts. It never holds the guild's
   name or anybody's character name.

### 9.7 Abuse

| Case | What to do |
|---|---|
| A guild name or event text that should not be there | Guild names, realms and character names can only be letters, digits and a few marks; titles and notes are plain text without links, and are escaped on every page and in Discord. For offensive text: **Guilds**, the guild, **Remove** the member, or **Delete guild** |
| Somebody linked a guild that is not theirs (the name is taken) | the real leader writes in: delete the wrong link (**Delete guild**); the name is free again at once |
| A link code was posted in public | **Guilds**, the guild, **Rotate the code** and give the new one to the leader (it is shown once), or the leader does it in the app. Remove members who should not be there |
| A member claimed a rank they do not have | ranks are reported by the app and cannot be checked by the server. The leader removes the member and makes a new code; if the false "leader" removed the real one, delete the link and let the real leader link again |
| Party-board spam | **Party board**: **Remove** takes one listing away (it can be put up again); **Block install** removes it and refuses everything that install sends from now on |
| A flood of connections | the service stops at `BF_LIVE_MAX_STREAMS` and at 2 per install; the per-address limit of 120 requests a minute applies to opening them. The dashboard shows the count |
| The bot is misused in a Discord server | it only posts what a linked guild's events say, in the channel that server's own managers chose. **Guilds**, the guild, **Disconnect Discord** makes it leave |
| Discord reports the application | every route can be switched off at once by removing the four `BF_DISCORD_` lines and restarting |
