#!/usr/bin/env bash
# Kill any process on port 3001, then start the backend (so you run the latest code).
set -e
cd "$(dirname "$0")/.."
echo "Stopping any process on port 3001..."
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:3001 | xargs kill -9 2>/dev/null || true
else
  echo "lsof not found; trying to kill with node..."
  pkill -f "node server/index.js" 2>/dev/null || true
fi
sleep 1
echo "Starting backend..."
exec node server/index.js
