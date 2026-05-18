#!/bin/bash
set -euo pipefail

# MCP proxy that intercepts list_apps and uses local NSWorkspace
# All other tools are forwarded to the native SkyComputerUseClient

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/local-list-apps.js"
