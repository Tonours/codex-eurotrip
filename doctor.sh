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

printf "\nReady. In Codex, add this MCP command:\n\n"
printf "  %s\n\n" "$ROOT/run-computer-use-mcp.sh"
