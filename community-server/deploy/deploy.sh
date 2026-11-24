#!/usr/bin/env bash
# Deploys the committed community-server/ tree to gnome and (re)starts the
# systemd user service. Run from anywhere inside the repo:
#   bash community-server/deploy/deploy.sh [ssh-host]      (default host: stacy)
# If your key is only in Windows OpenSSH, prefix PATH="/c/Windows/System32/OpenSSH:$PATH".
#
# Layout on the server (user pback):
#   ~/bf-community/releases/<rel>/            one dir per deploy (git archive of community-server/)
#   ~/bf-community/current -> releases/<rel>
#   ~/bf-community/secrets/bf-community.env   mode 600; salt generated there once, never printed;
#                                             alert addresses and the Discord webhook also live only here
#   ~/bf-community/data/community.db          SQLite (WAL); service.log alongside
#   ~/bf-community/backups/                   pre-deploy DB snapshots (last 10 kept)
#   ~/bf-community/backups/nightly/           nightly copies written by the service (last 14 kept)
#   ~/bf-community/admin                      wrapper: ~/bf-community/admin stats | admin-add <name> | ...
# The database schema is upgraded by the service at start (idempotent; a
# pre-deploy snapshot is taken first). See ../OPERATIONS.md.
# Backstage Live: schema 4 adds tables only; the web-server block in htaccess-snippet.conf must be
# replaced once by hand (OPERATIONS.md section 9), and Discord stays off until its four values
# are in the env file.
#   ~/.config/systemd/user/bf-community.service
set -euo pipefail

HOST="${1:-stacy}"
PORT=5081
ROOT="$(git rev-parse --show-toplevel)"
REL="r$(date -u +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"

if ! git -C "$ROOT" diff --quiet HEAD -- community-server; then
  echo "note: uncommitted changes in community-server/ are NOT deployed (git archive uses HEAD)" >&2
fi

git -C "$ROOT" archive --format=tar HEAD:community-server | ssh "$HOST" "
  set -euo pipefail; umask 077
  d=\$HOME/bf-community/releases/$REL
  mkdir -p \$d && tar -xf - -C \$d
  bash \$d/deploy/remote-install.sh '$REL' '$PORT'
"
