#!/usr/bin/env bash
# Deploys the committed community-server/ tree to gnome and (re)starts the
# systemd user service. Run from anywhere inside the repo:
#   bash community-server/deploy/deploy.sh [ssh-host]      (default host: stacy)
# If your key is only in Windows OpenSSH, prefix PATH="/c/Windows/System32/OpenSSH:$PATH".
#
# Layout on the server (user pback):
#   ~/bf-community/releases/<rel>/            one dir per deploy (git archive of community-server/)
#   ~/bf-community/current -> releases/<rel>
#   ~/bf-community/secrets/bf-community.env   mode 600; salt generated there once, never printed
#   ~/bf-community/data/community.db          SQLite (WAL); service.log alongside
#   ~/bf-community/backups/                   pre-deploy DB snapshots (last 10 kept)
#   ~/bf-community/admin                      wrapper: ~/bf-community/admin stats
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
  set -euo pipefail
  d=\$HOME/bf-community/releases/$REL
  mkdir -p \$d && tar -xf - -C \$d
  bash \$d/deploy/remote-install.sh '$REL' '$PORT'
"
