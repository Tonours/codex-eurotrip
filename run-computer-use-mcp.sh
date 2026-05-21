#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/local-list-apps.js"
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
