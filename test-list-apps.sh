#!/bin/bash
# Test list_apps through the experimental MCP proxy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/run-mcp-proxy.sh"
OUT_FILE="${TMPDIR:-/tmp}/mcp_proxy_test.txt"

if [ ! -x "$PROXY" ]; then
  echo "METRIC list_apps_success=0"
  echo "FAIL: run-mcp-proxy.sh not found or not executable"
  exit 1
fi

rm -f "$OUT_FILE"

{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_apps","arguments":{}}}'
  sleep 5
} | bash "$PROXY" > "$OUT_FILE" 2>/dev/null &
PID=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
fi
wait "$PID" 2>/dev/null || true

cat "$OUT_FILE"

if grep -q '"result"' "$OUT_FILE" && grep -q 'bundleIdentifier' "$OUT_FILE"; then
  echo "METRIC list_apps_success=1"
  echo "SUCCESS: list_apps returned app data via proxy"
else
  echo "METRIC list_apps_success=0"
  echo "FAIL: list_apps did not return app data"
fi
