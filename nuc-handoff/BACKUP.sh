#!/usr/bin/env bash
# Back up iBOARD class data (database, images, learning trails) from the NUC.
# Briefly stops the app so the SQLite database is copied in a consistent state.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="iboard-data-$STAMP.tgz"

mkdir -p "$OUT"
cd "$DIR"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
}

echo "==> Pausing iBOARD for a few seconds ..."
compose stop iboard

trap 'echo "==> Restarting iBOARD ..."; compose start iboard >/dev/null' EXIT

docker run --rm \
  -v iboard-data:/data:ro \
  -v "$OUT":/backup \
  --entrypoint tar \
  iboard:poc czf "/backup/$FILE" -C /data .

echo "==> Saved $OUT/$FILE"
echo "    Contains student writing. Keep it on school storage only."
