#!/usr/bin/env bash
# Clear ports 3000 and 3001, then start backend + frontend. Run with: npm start
set -e
cd "$(dirname "$0")/.."
echo "Clearing ports 3000 and 3001..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1
echo "Starting backend and frontend..."
exec npx concurrently "npm run server" "npm run client"
