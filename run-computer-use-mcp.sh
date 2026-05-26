#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/local-list-apps.js"

# Always use the local proxy. The native client can hang waiting for nested MCP
# elicitation when launched directly, so the proxy must stay in control of all
# tool calls from both Codex Desktop and CLI contexts.
NODE_BIN=""

if [ ! -f "$PROXY" ]; then
  echo "Computer Use proxy missing: $PROXY" >&2
  exit 1
fi

codex_bundled_node() {
  local codex_app
  codex_app=$(/usr/bin/osascript -e 'POSIX path of (path to application id "com.openai.codex")' 2>/dev/null || true)
  if [ -n "$codex_app" ]; then
    printf '%s\n' "${codex_app%/}/Contents/Resources/node"
  fi
}

for candidate in \
  "${COMPUTER_USE_NODE_BIN:-}" \
  "$(command -v node || true)" \
  "$(codex_bundled_node)"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "Node.js not found. Set COMPUTER_USE_NODE_BIN, install Node, or install Codex.app." >&2
  exit 1
fi

if [ "${1:-}" = "--print-node" ]; then
  printf '%s\n' "$NODE_BIN"
  exit 0
fi

exec "$NODE_BIN" "$PROXY"
