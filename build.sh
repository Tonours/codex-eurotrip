#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

swiftc list-apps-helper.swift -o list-apps-helper
swiftc ax-action-helper.swift -o ax-action-helper

# Keep a stable explicit local signature after compilation. This is not for
# Gatekeeper distribution; it gives macOS a concrete code identity for local
# privacy prompts.
codesign --force --sign - \
  --identifier dev.local.codex-eurotrip.ax-action-helper \
  ax-action-helper >/dev/null 2>&1

chmod +x run-computer-use-mcp.sh list-apps-helper ax-action-helper \
  smoke-test.js schema-parity-test.js doctor.js ui-e2e-test.js

echo "build ok"
