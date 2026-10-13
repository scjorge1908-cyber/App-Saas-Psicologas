#!/usr/bin/env bash
# Sobe o ambiente local de desenvolvimento: banco limpo + gateway + app (vite).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/e2e-db.sh" >/dev/null
setsid nohup node "$ROOT/dev-gateway/server.mjs" > /tmp/psi-gateway.log 2>&1 < /dev/null &
if ! curl -s -o /dev/null http://127.0.0.1:5173/; then
  (cd "$ROOT/web" && setsid nohup npx vite --port 5173 > /tmp/psi-vite.log 2>&1 < /dev/null &)
fi
for i in $(seq 1 30); do curl -s http://127.0.0.1:54321/__health >/dev/null && break; sleep 0.3; done
echo "Gateway: http://localhost:54321   App: http://127.0.0.1:5173"
