#!/bin/bash
set -e
cd "$(dirname "$0")"
# Azure App Service startup: build client if missing, then run server
if [ ! -f client/dist/index.html ]; then
  echo "Building client..."
  npm run build
fi
exec npm start --prefix server
