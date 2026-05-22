#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use"
CLIENT_BIN="$PLUGIN_DIR/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
PROXY="$SCRIPT_DIR/local-list-apps.js"

# Detect if we're running inside the Codex Desktop app process tree.
# If so, exec the native binary directly — it gets proper XPC context.
# If not (codex CLI), fall back to the node proxy which intercepts list_apps
# and adds timeouts for XPC tools that won't work from CLI.
is_in_desktop_tree() {
  local codex_pid
  codex_pid=$(lsappinfo list 2>/dev/null \
    | grep -A1 'com.openai.codex' \
    | grep -oE 'pid = [0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+' || true)
  if [ -z "$codex_pid" ]; then return 1; fi

  local pid=$$
  for _ in $(seq 1 20); do
    if [ "$pid" -eq "$codex_pid" ]; then return 0; fi
    local ppid
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [ -z "$ppid" ] || [ "$ppid" -le 1 ] && break
    pid=$ppid
  done
  return 1
}

if [ -x "$CLIENT_BIN" ] && is_in_desktop_tree; then
  echo "[wrapper] Detected Codex Desktop context, exec-ing native client" >&2
  cd "$PLUGIN_DIR"
  exec "$CLIENT_BIN" mcp
fi

# CLI context — use node proxy
NODE_BIN=""

if [ ! -f "$PROXY" ]; then
  echo "Computer Use proxy missing: $PROXY" >&2
  exit 1
fi

for candidate in \
  "$(command -v node || true)" \
  "/Applications/Codex.app/Contents/Resources/node"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "Node.js not found. Install Node or launch this wrapper from Codex.app so it can use /Applications/Codex.app/Contents/Resources/node." >&2
  exit 1
fi

exec "$NODE_BIN" "$PROXY"
