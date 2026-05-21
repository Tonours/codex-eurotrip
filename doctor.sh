#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PLUGIN_DIR=""
for candidate in \
  "$HOME/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use" \
  "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use"
do
  if [ -d "$candidate" ]; then
    PLUGIN_DIR="$candidate"
    break
  fi
done

APP_PATH="$PLUGIN_DIR/Codex Computer Use.app"
CLIENT_BIN="$APP_PATH/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
SERVICE_BIN="$APP_PATH/Contents/MacOS/SkyComputerUseService"

ok() { printf "[OK] %s\n" "$1"; }
fail() { printf "[FAIL] %s\n" "$1"; exit 1; }
warn() { printf "[WARN] %s\n" "$1"; }

[ -n "$PLUGIN_DIR" ] || fail "Plugin directory missing. Install Codex, launch it once, then retry."
printf "[INFO] Using plugin directory: %s\n" "$PLUGIN_DIR"
ok "Plugin directory exists"

[ -d "$APP_PATH" ] || fail "App bundle missing: $APP_PATH"
ok "App bundle exists"

[ -x "$CLIENT_BIN" ] || fail "Client binary missing or not executable: $CLIENT_BIN"
ok "Client binary is executable"

[ -x "$SERVICE_BIN" ] || fail "Service binary missing or not executable: $SERVICE_BIN"
ok "Service binary is executable"

if codesign -vv "$APP_PATH" >/dev/null 2>&1; then
  ok "App signature is valid"
else
  warn "App signature check failed"
fi

# Check list_apps proxy components used by the configured wrapper
HELPER_BIN="$ROOT/list-apps-helper"
PROXY_BIN="$ROOT/local-list-apps.js"
PROXY_SCRIPT="$ROOT/run-mcp-proxy.sh"
WRAPPER_SCRIPT="$ROOT/run-computer-use-mcp.sh"
NODE_BIN=""

for candidate in \
  "$(command -v node || true)" \
  "/Applications/Codex.app/Contents/Resources/node"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

[ -n "$NODE_BIN" ] || fail "Node.js not found. Install Node or use Codex.app with bundled Node at /Applications/Codex.app/Contents/Resources/node."
ok "Node.js runtime available: $NODE_BIN"

if [ -x "$HELPER_BIN" ]; then
  # Check architecture compatibility
  HELPER_ARCH=$(file "$HELPER_BIN" 2>/dev/null | grep -o 'arm64\|x86_64' | head -1)
  HOST_ARCH=$(uname -m)
  if [ -n "$HELPER_ARCH" ] && [ "$HELPER_ARCH" != "$HOST_ARCH" ]; then
    warn "list-apps-helper is $HELPER_ARCH but this Mac is $HOST_ARCH. Rebuild: swiftc $ROOT/list-apps-helper.swift -o $HELPER_BIN"
  fi
else
  fail "list_apps-helper not found. Build it: swiftc $ROOT/list-apps-helper.swift -o $HELPER_BIN"
fi
[ -f "$PROXY_BIN" ] || fail "local-list-apps.js not found"
[ -x "$PROXY_SCRIPT" ] || warn "run-mcp-proxy.sh not found or not executable"
[ -x "$WRAPPER_SCRIPT" ] || fail "run-computer-use-mcp.sh not found or not executable"

if [ -x "$HELPER_BIN" ] && [ -f "$PROXY_BIN" ] && [ -x "$WRAPPER_SCRIPT" ]; then
  ok "list_apps proxy components ready"
fi

printf "\nReady. In Codex, add this MCP command:\n\n"
printf "  %s\n\n" "$ROOT/run-computer-use-mcp.sh"
