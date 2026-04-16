#!/bin/bash
set -euo pipefail

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

if [ -z "$PLUGIN_DIR" ]; then
  echo "Computer Use plugin directory not found." >&2
  echo "Install and launch Codex once first, then retry." >&2
  exit 1
fi

CLIENT_BIN="$PLUGIN_DIR/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"

if [ ! -x "$CLIENT_BIN" ]; then
  echo "Computer Use client not executable: $CLIENT_BIN" >&2
  exit 1
fi

cd "$PLUGIN_DIR"
exec "$CLIENT_BIN" mcp
