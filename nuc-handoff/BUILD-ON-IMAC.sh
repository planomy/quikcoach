#!/usr/bin/env bash
# Build iBOARD for a Linux NUC and export a single file for a USB stick.
# Run from the Feedback repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$ROOT/.tools"
IMAGE="iboard:poc"
TAR="$OUT_DIR/iboard-poc.tar"
PLATFORM="${PLATFORM:-linux/amd64}"

# Prefer Docker Desktop; fall back to Colima + bundled CLI in .tools/
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_BIN=docker
elif [[ -x "$TOOLS/docker" ]] && [[ -x "$TOOLS/colima" ]]; then
  export PATH="$TOOLS:$PATH"
  if ! "$TOOLS/colima" status >/dev/null 2>&1; then
    echo "Starting Colima (first run downloads a VM; allow a few minutes)..."
    "$TOOLS/colima" start --cpu 2 --memory 4 --disk 20
  fi
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
  DOCKER_BIN="$TOOLS/docker"
elif command -v docker >/dev/null 2>&1; then
  echo "Docker is installed but not running. Open Docker Desktop, wait until it is ready, then run this again."
  exit 1
else
  echo "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "==> Building $IMAGE for $PLATFORM ..."
cd "$ROOT"

if "$DOCKER_BIN" buildx version >/dev/null 2>&1; then
  "$DOCKER_BIN" buildx build --platform "$PLATFORM" -t "$IMAGE" --load .
else
  "$DOCKER_BIN" build -t "$IMAGE" .
fi

echo "==> Exporting image to $TAR ..."
"$DOCKER_BIN" save "$IMAGE" -o "$TAR"

BYTES=$(wc -c < "$TAR" | tr -d ' ')
echo "==> Done. Image size: $(echo "$BYTES" | awk '{printf "%.1f MB", $1/1024/1024}')"
echo ""
echo "Copy everything in nuc-handoff/ to the thumb drive:"
echo "  $OUT_DIR/"
echo ""
echo "Rob runs LOAD-AND-RUN.sh on the NUC (see README.md)."
