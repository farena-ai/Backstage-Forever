#!/usr/bin/env bash
# Runs ON the server from inside a freshly extracted release (called by deploy.sh).
# Idempotent: first run provisions dirs, the secrets env file and the unit.
set -euo pipefail
REL="$1"; PORT="${2:-5081}"
BASE="$HOME/bf-community"; D="$BASE/releases/$REL"; NODE=/usr/local/bin/node
NODE_FLAGS=(--disable-warning=ExperimentalWarning)
UNIT=bf-community.service
umask 077

mkdir -p "$BASE/secrets" "$BASE/data" "$BASE/backups" "$HOME/.config/systemd/user"
chmod 700 "$BASE" "$BASE/secrets" "$BASE/data" "$BASE/backups"

ENVF="$BASE/secrets/bf-community.env"
if [ ! -f "$ENVF" ]; then
  salt="$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')"
  printf 'BF_COMMUNITY_SALT=%s\nBF_COMMUNITY_HOST=127.0.0.1\nBF_COMMUNITY_PORT=%s\nBF_COMMUNITY_DB=%s\n' \
    "$salt" "$PORT" "$BASE/data/community.db" > "$ENVF"
  unset salt
  echo "generated $ENVF (mode 600, contents not shown)"
fi
chmod 600 "$ENVF"

if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl --user is-active --quiet "$UNIT"; then
  echo "port $PORT is in use by something else; aborting" >&2; exit 1
fi

echo "running tests on server ($("$NODE" --version))"
(cd "$D" && "$NODE" "${NODE_FLAGS[@]}" --test --test-concurrency=1 "test/*.test.js" >/dev/null) \
  || { echo "server-side tests failed; current release unchanged" >&2; exit 1; }

if [ -f "$BASE/data/community.db" ]; then
  "$NODE" "${NODE_FLAGS[@]}" -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dst] = process.argv.slice(-2);
    new DatabaseSync(src).exec(`VACUUM INTO '"'"'${dst}'"'"'`);' "$BASE/data/community.db" "$BASE/backups/community-$REL.db"
  ls -1t "$BASE"/backups/community-*.db | tail -n +11 | xargs -r rm -f
fi

cat > "$BASE/admin" <<ADMIN
#!/usr/bin/env bash
exec $NODE ${NODE_FLAGS[*]} "\$HOME/bf-community/current/admin.js" "\$@"
ADMIN
chmod 700 "$BASE/admin"

prev="$(readlink "$BASE/current" || true)"
ln -sfn "$D" "$BASE/current"
install -m 600 "$D/deploy/$UNIT" "$HOME/.config/systemd/user/$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null 2>&1
systemctl --user restart "$UNIT"

for _ in $(seq 1 15); do
  sleep 1
  if out="$(curl -fsS "http://127.0.0.1:$PORT/v1/health" 2>/dev/null)"; then
    echo "deployed $REL: $out"
    ls -1dt "$BASE"/releases/r* | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
done

echo "health check failed; rolling back to ${prev:-nothing}" >&2
if [ -n "$prev" ]; then ln -sfn "$prev" "$BASE/current"; systemctl --user restart "$UNIT"; else systemctl --user stop "$UNIT"; fi
exit 1
