#!/usr/bin/env bash
# Load the iBOARD image from USB and start it on a Linux NUC (edge on TCP 443).
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

if [[ ! -f "$DIR/Caddyfile" ]]; then
  echo "Missing $DIR/Caddyfile (needed for port 443)."
  exit 1
fi

if [[ ! -f "$DIR/certs/cert.pem" || ! -f "$DIR/certs/key.pem" ]]; then
  echo "Missing TLS files in $DIR/certs/ (cert.pem + key.pem)."
  echo "Regenerate on the Mac: openssl req -x509 -nodes -newkey rsa:2048 -days 825 \\"
  echo "  -keyout nuc-handoff/certs/key.pem -out nuc-handoff/certs/cert.pem \\"
  echo "  -subj '/CN=iboard.local/O=iBOARD NUC/C=AU'"
  exit 1
fi

echo "==> Loading Docker image from USB ..."
docker load -i "$TAR"

echo "==> Pulling Caddy edge image (HTTPS / port 443) ..."
docker pull caddy:2-alpine

echo "==> Starting iBOARD behind Caddy on ports 443 (HTTPS) and 80 (HTTP) ..."
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
if curl -fsSk "https://127.0.0.1/api/health" >/dev/null 2>&1; then
  echo "==> Health check OK on https://127.0.0.1 (443)."
elif curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
  echo "==> Health check OK on http://127.0.0.1 (80)."
else
  echo "==> Containers started; waiting for health."
  echo "    Try: curl -k https://127.0.0.1/api/health"
  echo "    Or:  curl http://127.0.0.1/api/health"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
echo ""
echo "Open in a browser on the school network (firewall: allow TCP 443):"
echo "  https://${IP:-<nuc-ip>}"
echo "  http://${IP:-<nuc-ip>}     (optional, if TCP 80 is open)"
echo ""
echo "First HTTPS visit may warn about the local certificate — proceed / Advanced → continue."
echo ""
echo "Stop:  docker compose -f \"$DIR/docker-compose.yml\" down"
echo "Logs:  docker logs -f iboard-poc   # app"
echo "       docker logs -f iboard-edge  # Caddy / 443"
