#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  printf "[OK] %s\n" "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf "[FAIL] %s\n" "$1"
}

run_check() {
  local name="$1"
  shift
  if "$@" >"${TMPDIR:-/tmp}/codex-eurotrip-test.out" 2>"${TMPDIR:-/tmp}/codex-eurotrip-test.err"; then
    ok "$name"
  else
    fail "$name"
    sed 's/^/  stdout: /' "${TMPDIR:-/tmp}/codex-eurotrip-test.out" || true
    sed 's/^/  stderr: /' "${TMPDIR:-/tmp}/codex-eurotrip-test.err" || true
  fi
}

run_check "doctor" bash ./doctor.sh

run_check "timeout command available" command -v timeout

run_check "configured wrapper exposes tools/list" bash -c '
  {
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test-suite\",\"version\":\"1.0\"}}}"
    sleep 0.2
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
    sleep 0.2
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}"
    sleep 1
  } | timeout 5 bash ./run-computer-use-mcp.sh | grep -q "\"get_app_state\""
'

run_check "configured wrapper handles list_apps" bash -c '
  {
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test-suite\",\"version\":\"1.0\"}}}"
    sleep 0.2
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
    sleep 0.2
    printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_apps\",\"arguments\":{}}}"
    sleep 1
  } | timeout 5 bash ./run-computer-use-mcp.sh >"${TMPDIR:-/tmp}/codex-eurotrip-list-apps.out"
  grep -q "\"result\"" "${TMPDIR:-/tmp}/codex-eurotrip-list-apps.out"
  grep -q "bundleIdentifier" "${TMPDIR:-/tmp}/codex-eurotrip-list-apps.out"
'

run_check "start-here targets configured wrapper" bash -c '
  grep -q "run-computer-use-mcp.sh" ./start-here.sh
  ! grep -q "run-mcp-proxy.sh" ./start-here.sh
'

run_check "Codex config points to native wrapper" bash -c '
  grep -A3 "mcp_servers.computer-use-local" "$HOME/.codex/config.toml" \
    | grep -q "$(pwd)/run-computer-use-mcp.sh"
'

if pgrep -f "$ROOT/local-list-apps.js" >/dev/null 2>&1; then
  ok "main Codex server is using list_apps proxy"
else
  warn_msg="No running local-list-apps.js process found. Restart Codex after this change so it loads the fixed wrapper."
  printf "[WARN] %s\n" "$warn_msg"
fi

printf "\nSummary: %s passed, %s failed\n" "$PASS" "$FAIL"
test "$FAIL" -eq 0
