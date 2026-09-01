#!/usr/bin/env bash
# Load the iBOARD image from USB and start it on a Linux NUC.
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

echo "==> Loading Docker image from USB ..."
docker load -i "$TAR"

echo "==> Starting iBOARD on port 3001 ..."
cd "$DIR"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d
else
  echo "docker compose not found. Starting container directly ..."
  docker run -d --name iboard-poc --restart unless-stopped \
    -p 3001:3001 \
    -e PORT=3001 \
    -e DATA_DIR=/data \
    -v iboard-data:/data \
    "$IMAGE"
fi

sleep 2
if curl -fsS "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
  echo "==> Health check OK."
else
  echo "==> Container started; waiting for health (check: curl http://127.0.0.1:3001/api/health)"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
echo ""
echo "Open in a browser on the school network:"
echo "  http://${IP:-<nuc-ip>}:3001"
echo ""
echo "Stop:  docker compose -f \"$DIR/docker-compose.yml\" down"
echo "Logs:  docker logs -f iboard-poc"
