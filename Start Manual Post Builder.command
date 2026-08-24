#!/bin/bash
# Double-click this file in Finder to start the manual post builder and
# open it in your browser -- no terminal typing needed.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js not found" message "Install Node.js, then double-click this file again."'
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

# Kill any previous instance still running on this port before starting fresh.
lsof -ti:4173 | xargs kill 2>/dev/null

node scripts/manual-server.mjs &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:4173; then
    break
  fi
  sleep 0.5
done

open http://localhost:4173

echo ""
echo "Manual post builder running. Close this window to stop the server."
wait $SERVER_PID
