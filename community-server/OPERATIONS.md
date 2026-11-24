# Backstage Forever community server: operations

How to run the service that sits behind `https://bf.backstagecoding.com`: the app's API under
`/v1/` and the Backstage Desk admin area under `/admin/`. One Node process, one SQLite file, no
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
4. Once, in cPanel: replace the `# BEGIN BF COMMUNITY` block in the `.htaccess` of the
   `bf.backstagecoding.com` document root with `deploy/htaccess-snippet.conf`. It now also sends
   `/admin/` to the service, HTTPS only. Until this is done the admin area answers 404 from the
   web server and the app is not affected.
5. Check: `curl -s https://bf.backstagecoding.com/v1/health` shows `"desk":true`, and
   `https://bf.backstagecoding.com/admin/` shows the sign-in page.

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

Other account commands:

| Command | What it does |
|---|---|
| `admins` | list accounts, last sign-in, open sessions |
| `admin-password <name>` | set a new password; signs that admin out everywhere |
| `admin-reset-totp <name>` | new authenticator secret (lost phone); signs that admin out |
| `admin-disable <name>` / `admin-enable <name>` | switch an account off or on. Disabling can also be done in the admin area; enabling cannot |
| `admin-unlock <name>` | clear a sign-in lock straight away |

Sign-in rules: five wrong tries lock that name for 15 minutes; 100 wrong tries in 15 minutes lock
sign-in for everyone for 15 minutes; ten tries per network in 15 minutes. A session lasts 12 hours
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

## 4. Housekeeping the service does by itself

Every hour: heartbeat rows older than 13 months are turned into monthly totals and deleted (a
whole calendar month at a time); expired admin sessions and old sign-in counters are removed.
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
- Every admin's authenticator secret becomes unreadable. Run `admin-reset-totp <name>` for each
  admin right after the restart. Passwords keep working.

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
   all messages and internal notes, all heartbeat rows and the first-seen day. Automatic error
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
| sign-in fails for everyone after a salt change | section 6: `admin-reset-totp` |
| sign-in is very slow or the service is killed at sign-in | the host cannot spare 128 MB: set `BF_DESK_SCRYPT_LOG2N=16`, restart, then `admin-password` for each admin |
| "Too many failed attempts" | wait 15 minutes, or `admin-unlock <name>` |
| no alert e-mail | `admin notify-test`; then the mail log of the host |
