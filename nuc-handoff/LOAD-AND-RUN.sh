#!/usr/bin/env bash
# Load the iBOARD image from USB and start it on a Linux NUC (HTTP on TCP 80).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TAR="$DIR/iboard-poc.tar"
IMAGE="iboard:poc"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on this machine."
  echo "On Ubuntu/Debian: sudo apt update && sudo apt install -y docker.io docker-compose-v2"
  echo "Then: sudo usermod -aG docker \$USER   (log out and back in)"
  exit 1
fi

if [[ ! -f "$TAR" ]]; then
  echo "Missing $TAR"
  echo "Copy the whole nuc-handoff folder from the USB stick (must include iboard-poc.tar)."
  exit 1
fi

if [[ ! -f "$DIR/docker-compose.yml" ]]; then
  echo "Missing $DIR/docker-compose.yml"
  exit 1
fi

echo "==> Loading Docker image from USB ..."
docker load -i "$TAR"

echo "==> Starting iBOARD on port 80 (HTTP + Socket.IO; no TLS / no 443) ..."
cd "$DIR"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d
else
  echo "docker compose not found. Install docker-compose-v2, then re-run this script."
  exit 1
fi

sleep 3
if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
  echo "==> Health check OK on http://127.0.0.1 (80)."
else
  echo "==> Container started; waiting for health."
  echo "    Try: curl http://127.0.0.1/api/health"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
echo ""
echo "Open in a browser on the school network (firewall: allow TCP 80):"
echo "  http://${IP:-<nuc-ip>}/"
echo ""
echo "Live class uses Socket.IO on the same origin (path /socket.io/) — no port 443."
echo ""
echo "Stop:  docker compose -f \"$DIR/docker-compose.yml\" down"
echo "Logs:  docker logs -f iboard-poc"
