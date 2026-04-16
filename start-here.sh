#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$ROOT/run-computer-use-mcp.sh"
JSON_FILE="$ROOT/computer-use.mcp.json"

cat > "$JSON_FILE" <<EOF
{
  "mcpServers": {
    "computer-use-local": {
      "command": "$WRAPPER",
      "args": [],
      "cwd": "$ROOT"
    }
  }
}
EOF

bash "$ROOT/doctor.sh"

if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$WRAPPER" | pbcopy
  echo "Wrapper path copied to clipboard."
fi

cat <<EOF

Quick setup in Codex:

1. Open Codex
2. Go to Settings → MCP Servers
3. Add a server with:

   Name: computer-use-local
   Command: $WRAPPER
   Args: leave empty
   Working directory: $ROOT

4. Restart Codex
5. Test with:

   List the Mac apps you can control.

Optional import file regenerated for this location:
   $JSON_FILE

EOF
